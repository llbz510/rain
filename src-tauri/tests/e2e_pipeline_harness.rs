// src-tauri/tests/e2e_pipeline_harness.rs
// ========================================
// E2E Pipeline Harness: 完整管道集成测试
// probe → thumbnail → (whisper 可选)
// ========================================

use rain_lib::ffmpeg;
use std::path::Path;

fn fixture_path() -> String {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let path = Path::new(manifest_dir)
        .parent()
        .unwrap()
        .join("test-fixtures")
        .join("sample.mp4");
    path.to_string_lossy().to_string()
}

fn temp_thumbnail_path() -> String {
    let dir = std::env::temp_dir().join("rain_e2e_test");
    std::fs::create_dir_all(&dir).ok();
    dir.join("thumb_test.jpg").to_string_lossy().to_string()
}

#[test]
fn e01_probe_sample_video_duration() {
    let path = fixture_path();
    assert!(Path::new(&path).exists(), "required fixture is missing: {path}");
    let duration = ffmpeg::probe_duration(&path).expect("probe_duration failed");
    assert!(
        duration >= 1.5 && duration <= 2.5,
        "Expected duration ~2s, got {}",
        duration
    );
}

#[test]
fn e02_probe_file_stem_as_title() {
    let path = fixture_path();
    assert!(Path::new(&path).exists(), "required fixture is missing: {path}");
    let stem = Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown");
    assert_eq!(stem, "sample");
}

#[test]
fn e03_generate_thumbnail_creates_file() {
    let video_path = fixture_path();
    assert!(
        Path::new(&video_path).exists(),
        "required fixture is missing: {video_path}"
    );
    let thumb_path = temp_thumbnail_path();
    let _ = std::fs::remove_file(&thumb_path);

    let result = ffmpeg::extract_thumbnail(&video_path, &thumb_path, 1.0);
    assert!(result.is_ok(), "extract_thumbnail failed: {:?}", result.err());

    let meta = std::fs::metadata(&thumb_path);
    assert!(meta.is_ok(), "thumbnail file does not exist");
    assert!(meta.unwrap().len() > 0, "thumbnail file is empty");

    let _ = std::fs::remove_file(&thumb_path);
}

#[test]
fn e04_probe_nonexistent_file_returns_error() {
    let result = ffmpeg::probe_duration("/nonexistent/path/video.mp4");
    assert!(result.is_err());
}

#[test]
fn e05_thumbnail_nonexistent_file_returns_error() {
    let result = ffmpeg::extract_thumbnail(
        "/nonexistent/path/video.mp4",
        "/tmp/out.jpg",
        1.0,
    );
    assert!(result.is_err());
}

#[test]
#[ignore]
fn e06_whisper_transcribe_with_model() {
    let video_path = fixture_path();
    if !Path::new(&video_path).exists() {
        eprintln!("SKIP: test-fixtures/sample.mp4 not found");
        return;
    }

    let model_candidates = [
        "whisper-models/ggml-tiny.bin",
        "../whisper-models/ggml-tiny.bin",
    ];
    let model_path = model_candidates
        .iter()
        .find(|p| Path::new(p).exists());

    let model_path = match model_path {
        Some(p) => p.to_string(),
        None => {
            eprintln!("SKIP: whisper tiny model not found");
            return;
        }
    };

    let result = rain_lib::whisper::transcribe(&model_path, &video_path, true);
    assert!(result.is_ok(), "transcribe failed: {:?}", result.err());
}
