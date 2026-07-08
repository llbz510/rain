// src-tauri/src/ffmpeg.rs
// ========================================
// ffmpeg / ffprobe 封装
// ========================================

use std::path::Path;

#[derive(Debug, Clone)]
pub enum FfmpegError {
    FileNotFound,
    ProbeFailed(String),
    ThumbnailFailed(String),
}

pub fn probe_duration(video_path: &str) -> Result<f64, FfmpegError> {
    if !Path::new(video_path).exists() {
        return Err(FfmpegError::FileNotFound);
    }
    // 实际实现：ffprobe -v error -show_entries format=duration -of csv=p=0 <path>
    Ok(0.0)
}

pub fn extract_thumbnail(
    video_path: &str,
    output_path: &str,
    _timestamp: f64,
) -> Result<String, FfmpegError> {
    if !Path::new(video_path).exists() {
        return Err(FfmpegError::FileNotFound);
    }
    // 实际实现：ffmpeg -ss <timestamp> -i <video> -vframes 1 <output>
    Ok(output_path.to_string())
}
