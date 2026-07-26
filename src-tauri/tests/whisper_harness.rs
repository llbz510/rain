// src-tauri/tests/whisper_harness.rs
// ========================================
// Rust Harness: whisper-rs request and cancellation behavior
// Harness migration: 2026-07-26
// ========================================

use rain_lib::scheduler::CancellationToken;
use rain_lib::whisper::{
    load_model, transcribe, transcribe_cancellable, WhisperError, WhisperModelSize,
};

#[test]
fn r07_load_model_rejects_a_missing_file() {
    assert!(matches!(
        load_model("definitely-missing-whisper-model.bin"),
        Err(WhisperError::ModelNotFound(_))
    ));
}

#[test]
fn r08_transcribe_rejects_a_missing_model_before_audio_processing() {
    assert!(matches!(
        transcribe(
            "definitely-missing-whisper-model.bin",
            "definitely-missing-audio.mp4",
            true
        ),
        Err(WhisperError::ModelNotFound(_))
    ));
}

#[test]
fn r09_cancelled_transcription_stops_before_ffmpeg_or_model_loading() {
    let id = uuid::Uuid::new_v4();
    let model = std::env::temp_dir().join(format!("rain-model-{id}.bin"));
    let audio = std::env::temp_dir().join(format!("rain-audio-{id}.wav"));
    std::fs::write(&model, b"not-a-real-model").unwrap();
    std::fs::write(&audio, b"not-real-audio").unwrap();
    let token = CancellationToken::new();
    token.cancel();

    let result = transcribe_cancellable(
        model.to_string_lossy().as_ref(),
        audio.to_string_lossy().as_ref(),
        true,
        Some(token),
    );

    assert!(matches!(result, Err(WhisperError::Cancelled)));
    let _ = std::fs::remove_file(model);
    let _ = std::fs::remove_file(audio);
}

#[test]
fn r10_model_size_names_match_downloaded_file_contract() {
    let cases = [
        ("tiny", WhisperModelSize::Tiny, "ggml-tiny.bin"),
        ("base", WhisperModelSize::Base, "ggml-base.bin"),
        ("small", WhisperModelSize::Small, "ggml-small.bin"),
        ("medium", WhisperModelSize::Medium, "ggml-medium.bin"),
        ("large-v3", WhisperModelSize::LargeV3, "ggml-large-v3.bin"),
    ];

    for (name, size, filename) in cases {
        assert_eq!(WhisperModelSize::from_str(name), Some(size));
        assert_eq!(size.as_filename(), filename);
    }
    assert_eq!(WhisperModelSize::from_str("unsupported"), None);
}

#[test]
fn r11_whisper_errors_keep_actionable_context() {
    assert_eq!(
        WhisperError::ModelNotFound("model.bin".into()).to_string(),
        "Model not found: model.bin"
    );
    assert_eq!(WhisperError::Cancelled.to_string(), "ASR cancelled");
}
