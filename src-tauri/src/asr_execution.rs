use crate::asr_transcript::{build_asr_transcript, AsrSentence};
use crate::events::{self, ProgressPayload};
use crate::scheduler::{CancellationToken, ImportScheduler, TaskFinish};
use crate::whisper;
use std::sync::Arc;
use tauri::AppHandle;

pub struct AsrExecutionRequest {
    pub video_id: String,
    pub file_path: String,
    pub tier: String,
    pub model_path: Option<String>,
    pub language: Option<String>,
}

trait AsrBackend: Send + Sync + 'static {
    fn validate_request(&self, file_path: &str, model_path: &str) -> Result<(), String>;
    fn convert_to_wav(
        &self,
        input: &str,
        output: &str,
        cancellation: &CancellationToken,
    ) -> Result<(), String>;
    fn transcribe_wav(
        &self,
        model_path: &str,
        wav_path: &str,
        language: Option<&str>,
        cancellation: &CancellationToken,
    ) -> Result<whisper::WhisperResult, String>;
}

struct WhisperAsrBackend;

impl AsrBackend for WhisperAsrBackend {
    fn validate_request(&self, file_path: &str, model_path: &str) -> Result<(), String> {
        whisper::validate_asr_request(file_path, model_path)
    }

    fn convert_to_wav(
        &self,
        input: &str,
        output: &str,
        cancellation: &CancellationToken,
    ) -> Result<(), String> {
        whisper::convert_to_wav_cancellable(input, output, Some(cancellation))
            .map_err(|error| error.to_string())
    }

    fn transcribe_wav(
        &self,
        model_path: &str,
        wav_path: &str,
        language: Option<&str>,
        cancellation: &CancellationToken,
    ) -> Result<whisper::WhisperResult, String> {
        whisper::transcribe_wav_with_language(
            model_path,
            wav_path,
            language,
            Some(cancellation.clone()),
        )
        .map_err(|error| error.to_string())
    }
}

trait AsrReporter {
    fn progress(&self, video_id: &str, stage: &str, percent: u32);
    fn failed(&self, video_id: String, error: String);
    fn cancelled(&self, video_id: String);
}

struct TauriAsrReporter<'a> {
    app: &'a AppHandle,
}

impl AsrReporter for TauriAsrReporter<'_> {
    fn progress(&self, video_id: &str, stage: &str, percent: u32) {
        let _ = events::emit_progress(self.app, ProgressPayload::new(video_id, stage, percent));
    }

    fn failed(&self, video_id: String, error: String) {
        let _ = events::emit_import_failed(self.app, video_id, error);
    }

    fn cancelled(&self, video_id: String) {
        let _ = events::emit_import_cancelled(self.app, video_id);
    }
}

pub async fn execute_asr(
    app: &AppHandle,
    scheduler: &ImportScheduler,
    request: AsrExecutionRequest,
) -> Result<Vec<AsrSentence>, String> {
    execute_asr_with_adapters(
        scheduler,
        request,
        Arc::new(WhisperAsrBackend),
        &TauriAsrReporter { app },
    )
    .await
}

async fn execute_asr_with_adapters<B: AsrBackend, R: AsrReporter>(
    scheduler: &ImportScheduler,
    request: AsrExecutionRequest,
    backend: Arc<B>,
    reporter: &R,
) -> Result<Vec<AsrSentence>, String> {
    if let Err(error) = validate_asr_tier(&request.tier) {
        reporter.failed(request.video_id, error.clone());
        return Err(error);
    }

    let model = request.model_path.unwrap_or_default();
    let language = normalize_asr_language(request.language)?;
    if let Err(error) = backend.validate_request(&request.file_path, &model) {
        reporter.failed(request.video_id, error.clone());
        return Err(error);
    }

    let task = scheduler.start_video_task(request.video_id.clone()).await;
    let token = task.token();
    let result = run_whisper_asr(
        reporter,
        &request.video_id,
        &request.file_path,
        &model,
        &language,
        token.clone(),
        backend,
    )
    .await;

    let response = match result {
        Ok(sentences) => match scheduler.finish_success(&token).await {
            TaskFinish::Completed => {
                reporter.progress(&request.video_id, "asr", 100);
                Ok(sentences)
            }
            TaskFinish::Cancelled => {
                reporter.cancelled(request.video_id);
                Err("ASR cancelled".to_string())
            }
            TaskFinish::Stale | TaskFinish::Failed => Err("ASR task was superseded".to_string()),
        },
        Err(error) => match scheduler.finish_failure(&token, error.clone()).await {
            TaskFinish::Failed => {
                reporter.failed(request.video_id, error.clone());
                Err(error)
            }
            TaskFinish::Cancelled => {
                reporter.cancelled(request.video_id);
                Err("ASR cancelled".to_string())
            }
            TaskFinish::Stale | TaskFinish::Completed => Err("ASR task was superseded".to_string()),
        },
    };
    drop(task);
    response
}

fn validate_asr_tier(tier: &str) -> Result<(), String> {
    if tier == "whisper" {
        Ok(())
    } else {
        Err(format!(
            "ASR tier '{tier}' is not supported; configure local Whisper"
        ))
    }
}

fn normalize_asr_language(language: Option<String>) -> Result<String, String> {
    let normalized = language
        .unwrap_or_else(|| "zh".to_string())
        .trim()
        .to_ascii_lowercase();
    match normalized.as_str() {
        "zh" | "en" | "auto" => Ok(normalized),
        _ => Err(format!(
            "ASR language '{normalized}' is not supported; use zh, en, or auto"
        )),
    }
}

async fn run_whisper_asr<B: AsrBackend, R: AsrReporter>(
    reporter: &R,
    video_id: &str,
    file_path: &str,
    model_path: &str,
    language: &str,
    token: CancellationToken,
    backend: Arc<B>,
) -> Result<Vec<AsrSentence>, String> {
    ensure_asr_not_cancelled(&token)?;
    reporter.progress(video_id, "asr_extraction", 10);

    let temp_wav = whisper::temporary_wav_path(file_path);
    if let Some(parent) = temp_wav.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Create ASR temp dir failed: {error}"))?;
    }
    let _temp_guard = whisper::TemporaryWavGuard::new(temp_wav.clone());
    let temp_wav_string = temp_wav
        .to_str()
        .ok_or_else(|| "Temporary WAV path is not valid UTF-8".to_string())?
        .to_string();

    let input = file_path.to_string();
    let output = temp_wav_string.clone();
    let conversion_token = token.clone();
    let conversion_backend = Arc::clone(&backend);
    tokio::task::spawn_blocking(move || {
        conversion_backend.convert_to_wav(&input, &output, &conversion_token)
    })
    .await
    .map_err(|error| format!("ASR extraction task failed: {error}"))??;

    ensure_asr_not_cancelled(&token)?;
    reporter.progress(video_id, "asr_transcription", 35);

    let model = model_path.to_string();
    let wav = temp_wav_string;
    let inference_token = token.clone();
    let whisper_language = if language == "auto" {
        None
    } else {
        Some(language.to_string())
    };
    let inference_backend = Arc::clone(&backend);
    let whisper_result = tokio::task::spawn_blocking(move || {
        inference_backend.transcribe_wav(
            &model,
            &wav,
            whisper_language.as_deref(),
            &inference_token,
        )
    })
    .await
    .map_err(|error| format!("Whisper task failed: {error}"))??;

    ensure_asr_not_cancelled(&token)?;
    reporter.progress(video_id, "asr_finalization", 90);

    build_asr_transcript(&whisper_result)
}

fn ensure_asr_not_cancelled(token: &CancellationToken) -> Result<(), String> {
    if token.is_cancelled() {
        Err("ASR cancelled".to_string())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheduler::TaskState;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    enum FakeMode {
        Success,
        Failure,
        CancelDuringConversion,
    }

    struct FakeAsrBackend {
        mode: FakeMode,
    }

    #[derive(Default)]
    struct RecordingReporter {
        progress: Mutex<Vec<(String, u32)>>,
        failures: Mutex<Vec<String>>,
        cancelled: AtomicUsize,
    }

    impl AsrReporter for RecordingReporter {
        fn progress(&self, _video_id: &str, stage: &str, percent: u32) {
            self.progress
                .lock()
                .unwrap()
                .push((stage.to_string(), percent));
        }

        fn failed(&self, _video_id: String, error: String) {
            self.failures.lock().unwrap().push(error);
        }

        fn cancelled(&self, _video_id: String) {
            self.cancelled.fetch_add(1, Ordering::SeqCst);
        }
    }

    impl AsrBackend for FakeAsrBackend {
        fn validate_request(&self, _file_path: &str, _model_path: &str) -> Result<(), String> {
            Ok(())
        }

        fn convert_to_wav(
            &self,
            _input: &str,
            _output: &str,
            cancellation: &CancellationToken,
        ) -> Result<(), String> {
            if matches!(self.mode, FakeMode::CancelDuringConversion) {
                cancellation.cancel();
                Err("ASR cancelled".to_string())
            } else {
                Ok(())
            }
        }

        fn transcribe_wav(
            &self,
            _model_path: &str,
            _wav_path: &str,
            _language: Option<&str>,
            _cancellation: &CancellationToken,
        ) -> Result<whisper::WhisperResult, String> {
            if matches!(self.mode, FakeMode::Failure) {
                return Err("fake transcription failed".to_string());
            }
            Ok(whisper::WhisperResult {
                segments: vec![whisper::WhisperSegment {
                    text: "hello.".to_string(),
                    start_time: 0.0,
                    end_time: 1.0,
                    word_level: Vec::new(),
                }],
                detected_language: "en".to_string(),
            })
        }
    }

    fn request() -> AsrExecutionRequest {
        AsrExecutionRequest {
            video_id: "video-1".to_string(),
            file_path: "fake-video.mp4".to_string(),
            tier: "whisper".to_string(),
            model_path: Some("fake-model.bin".to_string()),
            language: Some("en".to_string()),
        }
    }

    #[test]
    fn cancelled_asr_token_is_rejected() {
        let token = CancellationToken::new();
        token.cancel();
        assert_eq!(
            ensure_asr_not_cancelled(&token).unwrap_err(),
            "ASR cancelled"
        );
    }

    #[test]
    fn unsupported_asr_tiers_fail_closed() {
        assert!(validate_asr_tier("whisper").is_ok());
        assert_eq!(
            validate_asr_tier("subtitle").unwrap_err(),
            "ASR tier 'subtitle' is not supported; configure local Whisper"
        );
        assert!(validate_asr_tier("api").is_err());
    }

    #[test]
    fn asr_language_defaults_to_chinese_and_fails_closed() {
        assert_eq!(normalize_asr_language(None).unwrap(), "zh");
        assert_eq!(
            normalize_asr_language(Some("AUTO".to_string())).unwrap(),
            "auto"
        );
        assert!(normalize_asr_language(Some("fr".to_string()))
            .unwrap_err()
            .contains("zh, en, or auto"));
    }

    #[tokio::test]
    async fn execution_reports_ordered_progress_and_completes_the_task() {
        let scheduler = ImportScheduler::new();
        let reporter = RecordingReporter::default();

        let sentences = execute_asr_with_adapters(
            &scheduler,
            request(),
            Arc::new(FakeAsrBackend {
                mode: FakeMode::Success,
            }),
            &reporter,
        )
        .await
        .unwrap();

        assert_eq!(sentences.len(), 1);
        assert_eq!(scheduler.get_state().await, TaskState::Completed);
        assert_eq!(
            *reporter.progress.lock().unwrap(),
            vec![
                ("asr_extraction".to_string(), 10),
                ("asr_transcription".to_string(), 35),
                ("asr_finalization".to_string(), 90),
                ("asr".to_string(), 100),
            ]
        );
    }

    #[tokio::test]
    async fn execution_records_backend_failure_and_emits_the_error() {
        let scheduler = ImportScheduler::new();
        let reporter = RecordingReporter::default();

        let error = execute_asr_with_adapters(
            &scheduler,
            request(),
            Arc::new(FakeAsrBackend {
                mode: FakeMode::Failure,
            }),
            &reporter,
        )
        .await
        .unwrap_err();

        assert_eq!(error, "fake transcription failed");
        assert_eq!(
            scheduler.get_state().await,
            TaskState::Failed("fake transcription failed".to_string())
        );
        assert_eq!(
            *reporter.failures.lock().unwrap(),
            vec!["fake transcription failed".to_string()]
        );
    }

    #[tokio::test]
    async fn execution_classifies_backend_cancellation_and_emits_cancelled() {
        let scheduler = ImportScheduler::new();
        let reporter = RecordingReporter::default();

        let error = execute_asr_with_adapters(
            &scheduler,
            request(),
            Arc::new(FakeAsrBackend {
                mode: FakeMode::CancelDuringConversion,
            }),
            &reporter,
        )
        .await
        .unwrap_err();

        assert_eq!(error, "ASR cancelled");
        assert_eq!(scheduler.get_state().await, TaskState::Cancelled);
        assert_eq!(reporter.cancelled.load(Ordering::SeqCst), 1);
    }
}
