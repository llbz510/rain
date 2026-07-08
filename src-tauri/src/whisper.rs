// src-tauri/src/whisper.rs
// ========================================
// whisper-rs 封装（决策94）
// ========================================

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
}

pub fn load_model(model_path: &str) -> Result<(), WhisperError> {
    if model_path.is_empty() {
        return Err(WhisperError::ModelNotFound("Empty path".to_string()));
    }
    // 实际实现：whisper_rs::WhisperContext::new(model_path)
    Ok(())
}

pub fn transcribe(
    model_path: &str,
    audio_path: &str,
    _auto_detect_language: bool,
) -> Result<WhisperResult, WhisperError> {
    // 实际实现：加载模型 → 读取音频 → 推理 → 返回词级时间戳
    Ok(WhisperResult {
        segments: Vec::new(),
        detected_language: "zh".to_string(),
    })
}
