// src-tauri/src/commands.rs
// ========================================
// Tauri command 层（决策92/96/98）
// ========================================

use crate::asr;
use crate::asr_persistence::{self, PersistedSentence};
use crate::events::{self, ProgressPayload};
use crate::ffmpeg;
use crate::scheduler::{CancellationToken, ImportScheduler, TaskFinish};
use crate::structure_persistence::{self, SentenceAssignment};
use crate::whisper::{self, WhisperModelSize};
use crate::ytdlp;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

/// 启动导入（立即返回，后台 tokio task 跑，决策98）
/// 流程：yt-dlp下载(在线) → ffprobe时长 → 缩略图 → ASR → 事件推送
#[tauri::command]
pub async fn start_import(
    _app: AppHandle,
    _scheduler: State<'_, Arc<ImportScheduler>>,
    _video_id: String,
    _source: String,
    _file_path: Option<String>,
    _source_url: Option<String>,
) -> Result<(), String> {
    // 调用方传入的 scheduler 已经从 State 中取出
    // 立即返回，实际导入流程由前端编排（调 start_asr 等子命令）
    Ok(())
}

/// 取消导入（通过 CancellationToken，决策83/98）
#[tauri::command]
pub async fn cancel_import(
    scheduler: State<'_, Arc<ImportScheduler>>,
    video_id: String,
) -> Result<(), String> {
    scheduler.cancel_if_current(&video_id).await;
    Ok(())
}

/// 检测 yt-dlp 可用性（决策95）
#[tauri::command]
pub async fn check_ytdlp_command() -> Result<ytdlp::YtdlpResult, String> {
    Ok(ytdlp::check_ytdlp())
}

/// 探测视频信息（时长/缩略图等，决策96）
#[tauri::command]
pub async fn probe_video_info(
    file_path: String,
    source_url: Option<String>,
) -> Result<ytdlp::VideoInfo, String> {
    if let Some(url) = source_url {
        if !url.is_empty() {
            return ytdlp::parse_video_info(&url).map_err(|e| format!("{:?}", e));
        }
    }

    // 本地文件：用 ffprobe 获取时长
    let duration = ffmpeg::probe_duration(&file_path).map_err(|e| format!("{:?}", e))?;

    Ok(ytdlp::VideoInfo {
        title: Path::new(&file_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string(),
        duration,
        thumbnail: String::new(),
    })
}

/// 生成缩略图（决策96）
#[tauri::command]
pub async fn generate_thumbnail(
    file_path: String,
    output_path: String,
    timestamp: f64,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || ffmpeg::extract_frame(&file_path, &output_path, timestamp))
        .await
        .map_err(|error| format!("Thumbnail task failed: {error}"))?
        .map_err(|error| error.to_string())
}

/// 启动 ASR（决策32/94/85）
/// tier: "subtitle" | "api" | "whisper"
#[tauri::command]
pub async fn start_asr(
    app: AppHandle,
    scheduler: State<'_, Arc<ImportScheduler>>,
    video_id: String,
    file_path: String,
    tier: String,
    model_path: Option<String>,
) -> Result<Vec<asr::Sentence>, String> {
    if let Err(error) = validate_asr_tier(&tier) {
        let _ = events::emit_import_failed(&app, video_id, error.clone());
        return Err(error);
    }

    let model = model_path.unwrap_or_default();
    if let Err(error) = whisper::validate_asr_request(&file_path, &model) {
        let _ = events::emit_import_failed(&app, video_id, error.clone());
        return Err(error);
    }

    let task = scheduler.start_video_task(video_id.clone()).await;
    let token = task.token();
    let result = run_whisper_asr(&app, &video_id, &file_path, &model, token.clone()).await;

    let response = match result {
        Ok(sentences) => match scheduler.finish_success(&token).await {
            TaskFinish::Completed => {
                let _ = events::emit_progress(&app, ProgressPayload::new(&video_id, "asr", 100));
                Ok(sentences)
            }
            TaskFinish::Cancelled => {
                let _ = events::emit_import_cancelled(&app, video_id);
                Err("ASR cancelled".to_string())
            }
            TaskFinish::Stale | TaskFinish::Failed => Err("ASR task was superseded".to_string()),
        },
        Err(error) => match scheduler.finish_failure(&token, error.clone()).await {
            TaskFinish::Failed => {
                let _ = events::emit_import_failed(&app, video_id, error.clone());
                Err(error)
            }
            TaskFinish::Cancelled => {
                let _ = events::emit_import_cancelled(&app, video_id);
                Err("ASR cancelled".to_string())
            }
            TaskFinish::Stale | TaskFinish::Completed => Err("ASR task was superseded".to_string()),
        },
    };
    drop(task);
    response
}

#[tauri::command]
pub async fn save_asr_atomically(
    app: AppHandle,
    video_id: String,
    language: String,
    sentences: Vec<PersistedSentence>,
) -> Result<(), String> {
    use sqlx::{Connection, SqliteConnection};
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Cannot resolve app config dir: {error}"))?;
    let database_path = config_dir.join("rain.db");
    let mut connection = SqliteConnection::connect(database_path.to_string_lossy().as_ref())
        .await
        .map_err(|error| format!("Open Rain database: {error}"))?;
    asr_persistence::save_asr_atomically_on_connection(
        &mut connection,
        &video_id,
        &language,
        &sentences,
    )
    .await
    .map_err(|error| format!("Persist ASR atomically: {error}"))
}
#[tauri::command]
pub async fn assign_asr_sentences_atomically(
    app: AppHandle,
    video_id: String,
    assignments: Vec<SentenceAssignment>,
) -> Result<(), String> {
    use sqlx::{Connection, SqliteConnection};
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Cannot resolve app config dir: {error}"))?;
    let database_path = config_dir.join("rain.db");
    let mut connection = SqliteConnection::connect(database_path.to_string_lossy().as_ref())
        .await
        .map_err(|error| format!("Open Rain database: {error}"))?;
    structure_persistence::assign_asr_sentences_to_nodes_on_connection(
        &mut connection,
        &video_id,
        &assignments,
    )
    .await
    .map_err(|error| format!("Assign ASR sentences atomically: {error}"))
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
async fn run_whisper_asr(
    app: &AppHandle,
    video_id: &str,
    file_path: &str,
    model_path: &str,
    token: CancellationToken,
) -> Result<Vec<asr::Sentence>, String> {
    ensure_asr_not_cancelled(&token)?;
    let _ = events::emit_progress(app, ProgressPayload::new(video_id, "asr_extraction", 10));

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
    tokio::task::spawn_blocking(move || {
        whisper::convert_to_wav_cancellable(&input, &output, Some(&conversion_token))
    })
    .await
    .map_err(|error| format!("ASR extraction task failed: {error}"))?
    .map_err(|error| error.to_string())?;

    ensure_asr_not_cancelled(&token)?;
    let _ = events::emit_progress(app, ProgressPayload::new(video_id, "asr_transcription", 35));

    let model = model_path.to_string();
    let wav = temp_wav_string;
    let inference_token = token.clone();
    let whisper_result = tokio::task::spawn_blocking(move || {
        whisper::transcribe_wav(&model, &wav, true, Some(inference_token))
    })
    .await
    .map_err(|error| format!("Whisper task failed: {error}"))?
    .map_err(|error| error.to_string())?;

    ensure_asr_not_cancelled(&token)?;
    let _ = events::emit_progress(app, ProgressPayload::new(video_id, "asr_finalization", 90));

    let sentences = whisper_result_to_sentences(&whisper_result);
    validate_whisper_sentences(&sentences)?;
    Ok(sentences)
}

fn ensure_asr_not_cancelled(token: &CancellationToken) -> Result<(), String> {
    if token.is_cancelled() {
        Err("ASR cancelled".to_string())
    } else {
        Ok(())
    }
}

fn validate_whisper_sentences(sentences: &[asr::Sentence]) -> Result<(), String> {
    if sentences.is_empty() {
        return Err("Whisper ASR returned no sentences".to_string());
    }

    let mut previous = None;
    for (index, sentence) in sentences.iter().enumerate() {
        if sentence.text.trim().is_empty() {
            return Err(format!("Whisper sentence {index} has empty text"));
        }
        if !sentence.start_time.is_finite()
            || !sentence.end_time.is_finite()
            || sentence.start_time < 0.0
            || sentence.end_time <= sentence.start_time
        {
            return Err(format!("Whisper sentence {index} has invalid timestamps"));
        }
        if let Some((previous_start, previous_end)) = previous {
            if sentence.start_time < previous_start || sentence.end_time < previous_end {
                return Err(format!(
                    "Whisper sentence timestamps are not monotonic at index {index}"
                ));
            }
            if sentence.start_time < previous_end {
                return Err(format!(
                    "Whisper sentence timestamps overlap at index {index}"
                ));
            }
        }
        previous = Some((sentence.start_time, sentence.end_time));
    }

    Ok(())
}
/// Convert a complete Whisper result to sentence records.
fn whisper_result_to_sentences(result: &whisper::WhisperResult) -> Vec<asr::Sentence> {
    let mut sentences = Vec::new();
    let mut current_text = String::new();
    let mut current_start = 0.0f64;
    let mut current_end = 0.0f64;

    for segment in &result.segments {
        for word in &segment.word_level {
            if current_text.is_empty() {
                current_start = word.start;
            }
            current_text.push_str(&word.word);
            current_end = word.end;

            if is_sentence_ending(&current_text) {
                let trimmed = current_text.trim().to_string();
                if !trimmed.is_empty() {
                    sentences.push(asr::Sentence {
                        id: format!("whisper-{}", uuid::Uuid::new_v4()),
                        text: trimmed,
                        start_time: current_start,
                        end_time: current_end,
                    });
                }
                current_text.clear();
            }
        }
    }

    if !current_text.trim().is_empty() {
        sentences.push(asr::Sentence {
            id: format!("whisper-{}", uuid::Uuid::new_v4()),
            text: current_text.trim().to_string(),
            start_time: current_start,
            end_time: current_end,
        });
    }

    sentences
}

fn is_sentence_ending(text: &str) -> bool {
    let trimmed = text.trim_end();
    if trimmed.is_empty() {
        return false;
    }
    let last = trimmed.chars().last().unwrap();
    matches!(last, '.' | '!' | '?' | '。' | '！' | '？' | '…')
}

/// 下载 Whisper 模型（决策94）
#[tauri::command]
pub async fn download_whisper_model(app: AppHandle, model_size: String) -> Result<String, String> {
    let size = WhisperModelSize::from_str(&model_size)
        .ok_or_else(|| format!("Unknown model size: {}", model_size))?;

    let filename = size.as_filename();

    // 用 Tauri 自带的路径解析取 app data dir，无需前端权限
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
    let output_dir = data_dir.join("whisper-models");
    let output_path = output_dir.join(filename);

    std::fs::create_dir_all(&output_dir).map_err(|e| format!("Create dir failed: {}", e))?;

    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
        filename
    );

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Read response failed: {}", e))?;

    std::fs::write(&output_path, &bytes).map_err(|e| format!("Write file failed: {}", e))?;

    Ok(output_path.to_string_lossy().to_string())
}

/// 列出已下载的 Whisper 模型
#[tauri::command]
pub async fn list_whisper_models(app: AppHandle) -> Result<Vec<String>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
    let model_dir = data_dir.join("whisper-models");

    let sizes = [
        WhisperModelSize::Tiny,
        WhisperModelSize::Base,
        WhisperModelSize::Small,
        WhisperModelSize::Medium,
        WhisperModelSize::LargeV3,
    ];

    let mut found = Vec::new();
    for size in &sizes {
        let path = model_dir.join(size.as_filename());
        if path.exists() {
            found.push(path.to_string_lossy().to_string());
        }
    }

    Ok(found)
}

/// 将本地文件路径转为 asset:// URL（决策96）
pub fn convert_file_src(file_path: &str) -> String {
    let normalized = if file_path.starts_with('/') {
        file_path.to_string()
    } else {
        format!("/{}", file_path.replace('\\', "/"))
    };
    format!("asset://localhost{}", normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_file_src_unix() {
        let result = convert_file_src("/path/to/video.mp4");
        assert!(result.starts_with("asset://"));
    }

    #[test]
    fn test_convert_file_src_windows() {
        let result = convert_file_src("C:\\videos\\test.mp4");
        assert!(result.starts_with("asset://"));
        assert!(result.contains("C:/videos/test.mp4"));
    }
    #[test]
    fn cancelled_asr_token_is_rejected() {
        let token = crate::scheduler::CancellationToken::new();
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
    fn empty_whisper_output_fails_closed() {
        assert_eq!(
            validate_whisper_sentences(&[]).unwrap_err(),
            "Whisper ASR returned no sentences"
        );
    }
    #[test]
    fn whisper_output_rejects_empty_text() {
        let sentences = vec![asr::Sentence {
            id: "s1".to_string(),
            text: "   ".to_string(),
            start_time: 0.0,
            end_time: 1.0,
        }];

        assert_eq!(
            validate_whisper_sentences(&sentences).unwrap_err(),
            "Whisper sentence 0 has empty text"
        );
    }

    #[test]
    fn whisper_output_rejects_non_monotonic_timestamps() {
        let sentences = vec![
            asr::Sentence {
                id: "s1".to_string(),
                text: "first".to_string(),
                start_time: 1.0,
                end_time: 2.0,
            },
            asr::Sentence {
                id: "s2".to_string(),
                text: "second".to_string(),
                start_time: 0.5,
                end_time: 3.0,
            },
        ];

        assert_eq!(
            validate_whisper_sentences(&sentences).unwrap_err(),
            "Whisper sentence timestamps are not monotonic at index 1"
        );
    }
    #[test]
    fn whisper_output_rejects_invalid_timestamps() {
        let sentences = vec![asr::Sentence {
            id: "s1".to_string(),
            text: "invalid".to_string(),
            start_time: f64::NAN,
            end_time: 1.0,
        }];

        assert_eq!(
            validate_whisper_sentences(&sentences).unwrap_err(),
            "Whisper sentence 0 has invalid timestamps"
        );
    }
    #[test]
    fn sentence_ids_are_globally_unique() {
        let result = whisper::WhisperResult {
            segments: vec![whisper::WhisperSegment {
                text: "你好。".to_string(),
                start_time: 0.0,
                end_time: 1.0,
                word_level: vec![whisper::WordTimestamp {
                    word: "你好。".to_string(),
                    start: 0.0,
                    end: 1.0,
                }],
            }],
            detected_language: "zh".to_string(),
        };

        let first = whisper_result_to_sentences(&result);
        let second = whisper_result_to_sentences(&result);

        assert_ne!(first[0].id, second[0].id);
    }
    #[test]
    fn whisper_output_rejects_overlapping_sentences() {
        let sentences = vec![
            asr::Sentence {
                id: "s1".to_string(),
                text: "first".to_string(),
                start_time: 1.0,
                end_time: 2.0,
            },
            asr::Sentence {
                id: "s2".to_string(),
                text: "second".to_string(),
                start_time: 1.5,
                end_time: 3.0,
            },
        ];

        assert_eq!(
            validate_whisper_sentences(&sentences).unwrap_err(),
            "Whisper sentence timestamps overlap at index 1"
        );
    }
}
