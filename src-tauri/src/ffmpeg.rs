// src-tauri/src/ffmpeg.rs
// ========================================
// ffmpeg / ffprobe 封装
// ========================================

use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone)]
pub enum FfmpegError {
    FileNotFound,
    ProbeFailed(String),
    ThumbnailFailed(String),
}

impl std::fmt::Display for FfmpegError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FfmpegError::FileNotFound => write!(f, "Video file not found"),
            FfmpegError::ProbeFailed(msg) => write!(f, "ffprobe failed: {}", msg),
            FfmpegError::ThumbnailFailed(msg) => write!(f, "ffmpeg thumbnail failed: {}", msg),
        }
    }
}

impl std::error::Error for FfmpegError {}

/// 探测视频时长（秒）
/// 调用 ffprobe -v error -show_entries format=duration -of csv=p=0
pub fn probe_duration(video_path: &str) -> Result<f64, FfmpegError> {
    if !Path::new(video_path).exists() {
        return Err(FfmpegError::FileNotFound);
    }

    let output = Command::new("ffprobe")
        .arg("-v")
        .arg("error")
        .arg("-show_entries")
        .arg("format=duration")
        .arg("-of")
        .arg("csv=p=0")
        .arg(video_path)
        .output()
        .map_err(|e| FfmpegError::ProbeFailed(format!("Failed to run ffprobe: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(FfmpegError::ProbeFailed(stderr.to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let duration: f64 = stdout
        .trim()
        .parse()
        .map_err(|e| FfmpegError::ProbeFailed(format!("Parse duration failed: {}", e)))?;

    Ok(duration)
}

/// 在指定时间戳抽取一帧作为缩略图
/// 调用 ffmpeg -ss <timestamp> -i <video> -vframes 1 -q:v 2 <output>
pub fn extract_thumbnail(
    video_path: &str,
    output_path: &str,
    timestamp: f64,
) -> Result<String, FfmpegError> {
    if !Path::new(video_path).exists() {
        return Err(FfmpegError::FileNotFound);
    }

    // 确保输出目录存在
    if let Some(parent) = Path::new(output_path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| {
                FfmpegError::ThumbnailFailed(format!("Create dir failed: {}", e))
            })?;
        }
    }

    let ts_str = format!("{:.2}", timestamp);

    let output = Command::new("ffmpeg")
        .arg("-y")
        .arg("-ss")
        .arg(&ts_str)
        .arg("-i")
        .arg(video_path)
        .arg("-vframes")
        .arg("1")
        .arg("-q:v")
        .arg("2")
        .arg(output_path)
        .output()
        .map_err(|e| FfmpegError::ThumbnailFailed(format!("Failed to run ffmpeg: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(FfmpegError::ThumbnailFailed(stderr.to_string()));
    }

    // 验证输出文件存在
    if !Path::new(output_path).exists() {
        return Err(FfmpegError::ThumbnailFailed(
            "Output file not created".to_string(),
        ));
    }

    Ok(output_path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_not_found() {
        let result = probe_duration("/nonexistent/video.mp4");
        assert!(matches!(result, Err(FfmpegError::FileNotFound)));
    }

    #[test]
    fn test_thumbnail_file_not_found() {
        let result = extract_thumbnail("/nonexistent/video.mp4", "/tmp/out.jpg", 1.0);
        assert!(matches!(result, Err(FfmpegError::FileNotFound)));
    }
}
