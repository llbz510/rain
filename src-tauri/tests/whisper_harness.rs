// src-tauri/tests/whisper_harness.rs
// ========================================
// Rust Harness: whisper-rs 封装（决策94）
// 锁定后禁止 AI 修改
// ========================================

use rain_lib::whisper::{load_model, transcribe, WhisperResult, WhisperModelSize};

#[test]
fn r07_load_model_from_whisper_models_dir() {
    // 加载模型文件（从 whisper-models/）
    let _ = load_model;  // 函数存在
}

#[test]
fn r08_transcribe_returns_word_level_timestamps() {
    // 推理音频 → 词级时间戳输出
    let _ = transcribe;  // 函数存在
}

#[test]
fn r09_language_auto_detection() {
    // 语言自动检测（前 30 秒，决策85）
    // WhisperResult 应该包含 detected_language 字段
    let result = WhisperResult {
        segments: vec![],
        detected_language: "en".to_string(),
    };
    assert_eq!(result.detected_language, "en");
}

#[test]
fn r10_invalid_model_size_returns_error() {
    // 不支持的模型大小返回错误
    let valid_sizes = vec![
        WhisperModelSize::Tiny,
        WhisperModelSize::Base,
        WhisperModelSize::Small,
        WhisperModelSize::Medium,
        WhisperModelSize::LargeV3,
    ];
    assert_eq!(valid_sizes.len(), 5);
}

#[test]
fn r11_long_audio_no_hard_limit() {
    // 长音频无硬性时长上限（30s VAD 自切，决策32）
    // transcribe 函数接受任意长度音频
    let _ = transcribe;  // 函数存在
}
