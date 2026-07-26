// src-tauri/tests/ffmpeg_harness.rs
// ========================================
// Rust Harness: ffmpeg / ffprobe failure behavior
// Harness migration: 2026-07-26
// ========================================

use rain_lib::ffmpeg::{extract_thumbnail, probe_duration, FfmpegError};

#[test]
fn r12_probe_missing_video_returns_file_not_found() {
    let result = probe_duration("definitely-missing-rain-video.mp4");
    assert!(matches!(result, Err(FfmpegError::FileNotFound)));
}

#[test]
fn r13_thumbnail_missing_video_returns_file_not_found_without_creating_output() {
    let output = std::env::temp_dir().join(format!(
        "rain-missing-thumbnail-{}.jpg",
        uuid::Uuid::new_v4()
    ));
    let result = extract_thumbnail(
        "definitely-missing-rain-video.mp4",
        output.to_string_lossy().as_ref(),
        1.0,
    );

    assert!(matches!(result, Err(FfmpegError::FileNotFound)));
    assert!(!output.exists());
}

#[test]
fn r14_ffmpeg_errors_have_user_facing_context() {
    assert_eq!(FfmpegError::FileNotFound.to_string(), "Video file not found");
    assert_eq!(
        FfmpegError::ProbeFailed("bad stream".into()).to_string(),
        "ffprobe failed: bad stream"
    );
    assert_eq!(
        FfmpegError::ThumbnailFailed("bad frame".into()).to_string(),
        "ffmpeg thumbnail failed: bad frame"
    );
}
