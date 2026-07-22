// src-tauri/src/whisper.rs
// ========================================
// whisper-rs 封装（决策94）
// ========================================

use crate::scheduler::CancellationToken;
use std::ffi::c_void;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

const MAX_FFMPEG_ERROR_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhisperModelSize {
    Tiny,
    Base,
    Small,
    Medium,
    LargeV3,
}

impl WhisperModelSize {
    pub fn as_filename(&self) -> &'static str {
        match self {
            WhisperModelSize::Tiny => "ggml-tiny.bin",
            WhisperModelSize::Base => "ggml-base.bin",
            WhisperModelSize::Small => "ggml-small.bin",
            WhisperModelSize::Medium => "ggml-medium.bin",
            WhisperModelSize::LargeV3 => "ggml-large-v3.bin",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "tiny" => Some(WhisperModelSize::Tiny),
            "base" => Some(WhisperModelSize::Base),
            "small" => Some(WhisperModelSize::Small),
            "medium" => Some(WhisperModelSize::Medium),
            "large-v3" | "large" => Some(WhisperModelSize::LargeV3),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct WhisperSegment {
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
    pub word_level: Vec<WordTimestamp>,
}

#[derive(Debug, Clone)]
pub struct WordTimestamp {
    pub word: String,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone)]
pub struct WhisperResult {
    pub segments: Vec<WhisperSegment>,
    pub detected_language: String,
}

#[derive(Debug, Clone)]
pub enum WhisperError {
    ModelNotFound(String),
    LoadFailed(String),
    TranscribeFailed(String),
    AudioConversionFailed(String),
    Cancelled,
}

impl std::fmt::Display for WhisperError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WhisperError::ModelNotFound(msg) => write!(f, "Model not found: {}", msg),
            WhisperError::LoadFailed(msg) => write!(f, "Model load failed: {}", msg),
            WhisperError::TranscribeFailed(msg) => write!(f, "Transcribe failed: {}", msg),
            WhisperError::AudioConversionFailed(msg) => {
                write!(f, "Audio conversion failed: {}", msg)
            }
            WhisperError::Cancelled => write!(f, "ASR cancelled"),
        }
    }
}

impl std::error::Error for WhisperError {}

pub fn validate_asr_request(video_path: &str, model_path: &str) -> Result<(), String> {
    if video_path.trim().is_empty() {
        return Err("video_path is required".to_string());
    }
    if model_path.trim().is_empty() {
        return Err("model_path is required for Whisper ASR".to_string());
    }
    if !Path::new(video_path).is_file() {
        return Err("video file does not exist".to_string());
    }
    if !Path::new(model_path).is_file() {
        return Err("Whisper model file does not exist".to_string());
    }
    Ok(())
}

pub fn temporary_wav_path(video_path: &str) -> PathBuf {
    let stem = Path::new(video_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("rain");
    let root = std::env::var_os("RAIN_TEMP_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    root.join(format!("rain-{stem}-{}.wav", uuid::Uuid::new_v4()))
}

pub(crate) struct TemporaryWavGuard {
    path: PathBuf,
}

impl TemporaryWavGuard {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl Drop for TemporaryWavGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn cancellation_requested(cancellation: Option<&CancellationToken>) -> bool {
    cancellation
        .map(CancellationToken::is_cancelled)
        .unwrap_or(false)
}

fn spawn_bounded_stderr_reader<R>(mut reader: R) -> thread::JoinHandle<String>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut tail = Vec::with_capacity(MAX_FFMPEG_ERROR_BYTES);
        let mut chunk = [0_u8; 8192];
        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(count) => {
                    let overflow = tail
                        .len()
                        .saturating_add(count)
                        .saturating_sub(MAX_FFMPEG_ERROR_BYTES);
                    if overflow > 0 {
                        tail.drain(..overflow.min(tail.len()));
                    }
                    tail.extend_from_slice(&chunk[..count]);
                }
                Err(error) => {
                    let message = format!("Failed to read ffmpeg stderr: {error}");
                    let overflow = tail
                        .len()
                        .saturating_add(message.len())
                        .saturating_sub(MAX_FFMPEG_ERROR_BYTES);
                    if overflow > 0 {
                        tail.drain(..overflow.min(tail.len()));
                    }
                    tail.extend_from_slice(message.as_bytes());
                    break;
                }
            }
        }
        String::from_utf8_lossy(&tail).into_owned()
    })
}

fn finish_stderr_reader(reader: &mut Option<thread::JoinHandle<String>>) -> String {
    reader
        .take()
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default()
}
unsafe extern "C" fn whisper_abort_callback(user_data: *mut c_void) -> bool {
    if user_data.is_null() {
        return false;
    }

    let token = unsafe { &*user_data.cast::<CancellationToken>() };
    token.is_cancelled()
}
/// 加载模型文件（验证可加载）
pub fn load_model(model_path: &str) -> Result<(), WhisperError> {
    if model_path.is_empty() || !Path::new(model_path).exists() {
        return Err(WhisperError::ModelNotFound(format!(
            "Model file not found: {}",
            model_path
        )));
    }

    let params = whisper_rs::WhisperContextParameters::default();
    match whisper_rs::WhisperContext::new_with_params(model_path, params) {
        Ok(_ctx) => Ok(()),
        Err(e) => Err(WhisperError::LoadFailed(e.to_string())),
    }
}

/// 推理音频 → 词级时间戳输出
/// auto_detect=true 时自动检测语言（前 30 秒，决策85）
/// 支持任意长度音频（长音频：30s VAD 自切，决策32）
pub fn transcribe(
    model_path: &str,
    audio_path: &str,
    auto_detect_language: bool,
) -> Result<WhisperResult, WhisperError> {
    transcribe_cancellable(model_path, audio_path, auto_detect_language, None)
}

pub fn transcribe_cancellable(
    model_path: &str,
    audio_path: &str,
    auto_detect_language: bool,
    cancellation: Option<CancellationToken>,
) -> Result<WhisperResult, WhisperError> {
    if !Path::new(model_path).is_file() {
        return Err(WhisperError::ModelNotFound(model_path.to_string()));
    }
    if !Path::new(audio_path).is_file() {
        return Err(WhisperError::TranscribeFailed(format!(
            "Audio file not found: {}",
            audio_path
        )));
    }
    if cancellation_requested(cancellation.as_ref()) {
        return Err(WhisperError::Cancelled);
    }

    let temp_wav = temporary_wav_path(audio_path);
    if let Some(parent) = temp_wav.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            WhisperError::AudioConversionFailed(format!("Create temp dir failed: {error}"))
        })?;
    }
    let _temp_guard = TemporaryWavGuard::new(temp_wav.clone());
    let temp_wav_str = temp_wav.to_str().ok_or_else(|| {
        WhisperError::AudioConversionFailed("Temporary WAV path is not valid UTF-8".to_string())
    })?;

    convert_to_wav_cancellable(audio_path, temp_wav_str, cancellation.as_ref())?;
    transcribe_wav(model_path, temp_wav_str, auto_detect_language, cancellation)
}

pub(crate) fn transcribe_wav(
    model_path: &str,
    wav_path: &str,
    auto_detect_language: bool,
    cancellation: Option<CancellationToken>,
) -> Result<WhisperResult, WhisperError> {
    let language = if auto_detect_language { None } else { Some("zh") };
    transcribe_wav_with_language(model_path, wav_path, language, cancellation)
}

pub(crate) fn transcribe_wav_with_language(
    model_path: &str,
    wav_path: &str,
    language: Option<&str>,
    cancellation: Option<CancellationToken>,
) -> Result<WhisperResult, WhisperError> {
    if cancellation_requested(cancellation.as_ref()) {
        return Err(WhisperError::Cancelled);
    }

    let samples = read_wav_samples(wav_path)
        .map_err(|error| WhisperError::TranscribeFailed(format!("Read WAV failed: {error}")))?;

    if cancellation_requested(cancellation.as_ref()) {
        return Err(WhisperError::Cancelled);
    }

    let ctx_params = whisper_rs::WhisperContextParameters::default();
    let ctx = whisper_rs::WhisperContext::new_with_params(model_path, ctx_params)
        .map_err(|error| WhisperError::LoadFailed(error.to_string()))?;
    let mut state = ctx
        .create_state()
        .map_err(|error| WhisperError::TranscribeFailed(format!("Create state failed: {error}")))?;

    if cancellation_requested(cancellation.as_ref()) {
        return Err(WhisperError::Cancelled);
    }

    let mut params =
        whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(language);
    params.set_n_threads(num_cpus() as i32);
    params.set_token_timestamps(true);

    let abort_token = cancellation.clone().map(Box::new);
    if let Some(cancel_token) = abort_token.as_deref() {
        let user_data = (cancel_token as *const CancellationToken).cast_mut().cast();
        unsafe {
            // `state.full` is synchronous. `abort_token` owns the stable allocation until it
            // returns, and the callback only reads the thread-safe cancellation token.
            params.set_abort_callback(Some(whisper_abort_callback));
            params.set_abort_callback_user_data(user_data);
        }
    }

    let inference = state.full(params, &samples);
    if cancellation_requested(cancellation.as_ref()) {
        return Err(WhisperError::Cancelled);
    }
    inference
        .map_err(|error| WhisperError::TranscribeFailed(format!("Inference failed: {error}")))?;

    let num_segments = state.full_n_segments();
    let mut segments = Vec::new();
    for i in 0..num_segments {
        let segment = match state.get_segment(i) {
            Some(segment) => segment,
            None => continue,
        };
        let text = segment
            .to_str_lossy()
            .map(|value| value.to_string())
            .unwrap_or_default();
        let start_time = segment.start_timestamp() as f64 * 0.01;
        let end_time = segment.end_timestamp() as f64 * 0.01;
        let mut word_level = Vec::new();

        for j in 0..segment.n_tokens() {
            if let Some(token) = segment.get_token(j) {
                let token_text = token
                    .to_str_lossy()
                    .map(|value| value.to_string())
                    .unwrap_or_default();
                let token_data = token.token_data();
                word_level.push(WordTimestamp {
                    word: token_text,
                    start: token_data.t0 as f64 * 0.01,
                    end: token_data.t1 as f64 * 0.01,
                });
            }
        }

        segments.push(WhisperSegment {
            text,
            start_time,
            end_time,
            word_level,
        });
    }

    let detected_language = language
        .map(ToString::to_string)
        .unwrap_or_else(|| detect_language_from_segments(&segments));

    Ok(WhisperResult {
        segments,
        detected_language,
    })
}
fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
}

/// 用 ffmpeg 将音频转为 16kHz mono 16-bit WAV
pub(crate) fn convert_to_wav_cancellable(
    input: &str,
    output: &str,
    cancellation: Option<&CancellationToken>,
) -> Result<(), WhisperError> {
    if cancellation_requested(cancellation) {
        return Err(WhisperError::Cancelled);
    }

    if let Some(parent) = Path::new(output).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|error| {
                WhisperError::AudioConversionFailed(format!("Create output dir failed: {error}"))
            })?;
        }
    }
    if Path::new(output).exists() {
        std::fs::remove_file(output).map_err(|error| {
            WhisperError::AudioConversionFailed(format!("Remove stale WAV failed: {error}"))
        })?;
    }

    let mut child = Command::new("ffmpeg")
        .arg("-y")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(input)
        .arg("-vn")
        .arg("-ar")
        .arg("16000")
        .arg("-ac")
        .arg("1")
        .arg("-sample_fmt")
        .arg("s16")
        .arg(output)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            WhisperError::AudioConversionFailed(format!("ffmpeg not found: {error}"))
        })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        let _ = child.kill();
        let _ = child.wait();
        WhisperError::AudioConversionFailed("ffmpeg stderr pipe unavailable".to_string())
    })?;
    let mut stderr_reader = Some(spawn_bounded_stderr_reader(stderr));

    loop {
        if cancellation_requested(cancellation) {
            let _ = child.kill();
            let _ = child.wait();
            let _ = finish_stderr_reader(&mut stderr_reader);
            let _ = std::fs::remove_file(output);
            return Err(WhisperError::Cancelled);
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                let stderr = finish_stderr_reader(&mut stderr_reader);
                if !status.success() {
                    let _ = std::fs::remove_file(output);
                    return Err(WhisperError::AudioConversionFailed(stderr));
                }

                let metadata = std::fs::metadata(output).map_err(|error| {
                    WhisperError::AudioConversionFailed(format!(
                        "ffmpeg reported success but WAV is missing: {error}"
                    ))
                })?;
                if metadata.len() <= 44 {
                    let _ = std::fs::remove_file(output);
                    return Err(WhisperError::AudioConversionFailed(
                        "ffmpeg produced an empty WAV".to_string(),
                    ));
                }
                return Ok(());
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = finish_stderr_reader(&mut stderr_reader);
                let _ = std::fs::remove_file(output);
                return Err(WhisperError::AudioConversionFailed(format!(
                    "Failed while waiting for ffmpeg: {error}"
                )));
            }
        }
    }
}
fn read_wav_samples(wav_path: &str) -> Result<Vec<f32>, String> {
    use std::io::Read;

    let mut file = std::fs::File::open(wav_path).map_err(|e| e.to_string())?;
    let mut data = Vec::new();
    file.read_to_end(&mut data).map_err(|e| e.to_string())?;

    if data.len() < 44 {
        return Err("WAV file too short".to_string());
    }

    // 找到 data chunk
    let mut pos = 12;
    while pos + 8 < data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size =
            u32::from_le_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]])
                as usize;

        if chunk_id == b"data" {
            let audio_start = pos + 8;
            let audio_end = (audio_start + chunk_size).min(data.len());
            let audio_data = &data[audio_start..audio_end];

            // 16-bit PCM → f32 samples
            let samples: Vec<f32> = audio_data
                .chunks_exact(2)
                .map(|chunk| {
                    let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
                    sample as f32 / 32768.0
                })
                .collect();

            return Ok(samples);
        }

        pos += 8 + chunk_size;
        if chunk_size % 2 != 0 {
            pos += 1;
        }
    }

    Err("No data chunk found in WAV".to_string())
}

fn detect_language_from_segments(segments: &[WhisperSegment]) -> String {
    let all_text: String = segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join("");

    let chinese_count = all_text
        .chars()
        .filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c))
        .count();
    let character_count = all_text.chars().count();

    if chinese_count > character_count / 4 {
        "zh".to_string()
    } else if all_text.chars().any(|c| c.is_ascii_alphabetic()) {
        "en".to_string()
    } else {
        "other".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asr_rejects_empty_model_path() {
        assert_eq!(
            validate_asr_request("video.mp4", "").unwrap_err(),
            "model_path is required for Whisper ASR"
        );
    }

    #[test]
    fn cancelled_request_stops_before_ffmpeg() {
        let token = crate::scheduler::CancellationToken::new();
        token.cancel();

        let error =
            convert_to_wav_cancellable("missing-video.mp4", "unused-output.wav", Some(&token))
                .unwrap_err();

        assert!(matches!(error, WhisperError::Cancelled));
    }

    #[test]
    fn temporary_wavs_are_unique() {
        assert_ne!(
            temporary_wav_path("video.mp4"),
            temporary_wav_path("video.mp4")
        );
    }

    #[test]
    fn abort_callback_borrows_the_callers_cancellation_token() {
        let token = Box::new(crate::scheduler::CancellationToken::new());
        let user_data = (&*token as *const CancellationToken).cast_mut().cast();

        assert!(!unsafe { whisper_abort_callback(user_data) });
        token.cancel();
        assert!(unsafe { whisper_abort_callback(user_data) });
    }

    #[test]
    fn language_detection_counts_unicode_code_points() {
        let segments = vec![WhisperSegment {
            text: "你好吗abcdefg".to_string(),
            start_time: 0.0,
            end_time: 1.0,
            word_level: Vec::new(),
        }];

        assert_eq!(detect_language_from_segments(&segments), "zh");
    }
    #[test]
    fn stderr_reader_drains_input_and_keeps_a_bounded_tail() {
        let mut bytes = vec![b'x'; MAX_FFMPEG_ERROR_BYTES + 4096];
        bytes.extend_from_slice(b"final-error");

        let stderr = spawn_bounded_stderr_reader(std::io::Cursor::new(bytes))
            .join()
            .unwrap();

        assert!(stderr.len() <= MAX_FFMPEG_ERROR_BYTES);
        assert!(stderr.ends_with("final-error"));
    }
}
