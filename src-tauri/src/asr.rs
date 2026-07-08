// src-tauri/src/asr.rs
// ========================================
// ASR 三档标准化（决策32/85）
// ========================================

#[derive(Debug, Clone)]
pub struct Sentence {
    pub id: String,
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
}

/// 字幕档：从 yt-dlp 字幕轨解析为 Sentence[]
pub fn normalize_subtitle_track(
    subtitle_text: &str,
    _language: &str,
) -> Vec<Sentence> {
    // 实际实现：解析 SRT/VTT → 按句末标点合并碎片 → Sentence[]
    Vec::new()
}

/// API 档：调用云端 ASR，返回句级时间戳
pub fn normalize_api_asr(
    api_response: &str,
) -> Vec<Sentence> {
    // 实际实现：解析供应商返回 JSON → Sentence[]
    Vec::new()
}

/// 本地档：whisper-rs 推理
pub fn run_local_whisper(
    model_path: &str,
    audio_path: &str,
) -> Vec<Sentence> {
    // 实际实现：调用 whisper::transcribe → 词级时间戳按标点分组为句级
    Vec::new()
}
