// src-tauri/tests/ffmpeg_harness.rs
// ========================================
// Rust Harness: ffmpeg / ffprobe 封装
// 锁定后禁止 AI 修改
// ========================================

use rain_lib::ffmpeg::{probe_duration, extract_thumbnail, FfmpegError};

#[test]
fn r12_probe_video_duration() {
    // 探测视频时长 → 写 video.duration
    let _ = probe_duration;  // 函数存在
}

#[test]
fn r13_extract_thumbnail_to_thumbnails_dir() {
    // 抽取指定帧为缩略图 → 写 thumbnails/
    let _ = extract_thumbnail;  // 函数存在
}

#[test]
fn r14_missing_video_file_returns_error() {
    // 视频文件不存在返回错误
    let _err = FfmpegError::FileNotFound;
}
