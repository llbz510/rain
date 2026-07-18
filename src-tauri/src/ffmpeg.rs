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
pub fn extract_frame(
    video_path: &str,
    output_path: &str,
    timestamp: f64,
) -> Result<String, FfmpegError> {
    if !Path::new(video_path).is_file() {
        return Err(FfmpegError::FileNotFound);
    }
    if !timestamp.is_finite() || timestamp < 0.0 {
        return Err(FfmpegError::ThumbnailFailed(
            "timestamp must be a finite non-negative number".to_string(),
        ));
    }

    let output = Path::new(output_path);
    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|error| {
                FfmpegError::ThumbnailFailed(format!("Create dir failed: {error}"))
            })?;
        }
    }
    if output.exists() {
        match same_file::is_same_file(video_path, output) {
            Ok(true) => {
                return Err(FfmpegError::ThumbnailFailed(
                    "frame output must not refer to the input video".to_string(),
                ));
            }
            Ok(false) => {}
            Err(error) => {
                return Err(FfmpegError::ThumbnailFailed(format!(
                    "Failed to compare frame paths: {error}"
                )));
            }
        }
        std::fs::remove_file(output).map_err(|error| {
            FfmpegError::ThumbnailFailed(format!("Remove stale frame failed: {error}"))
        })?;
    }

    let result = Command::new("ffmpeg")
        .arg("-y")
        .arg("-loglevel")
        .arg("error")
        .arg("-ss")
        .arg(format!("{timestamp:.3}"))
        .arg("-i")
        .arg(video_path)
        .arg("-frames:v")
        .arg("1")
        .arg("-q:v")
        .arg("2")
        .arg(output_path)
        .output()
        .map_err(|error| FfmpegError::ThumbnailFailed(format!("Failed to run ffmpeg: {error}")))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let _ = std::fs::remove_file(output);
        return Err(FfmpegError::ThumbnailFailed(stderr.to_string()));
    }

    validate_frame_output(output)?;
    Ok(output_path.to_string())
}

pub fn extract_thumbnail(
    video_path: &str,
    output_path: &str,
    timestamp: f64,
) -> Result<String, FfmpegError> {
    extract_frame(video_path, output_path, timestamp)
}

fn validate_frame_output(output: &Path) -> Result<(), FfmpegError> {
    let metadata = std::fs::metadata(output).map_err(|error| {
        FfmpegError::ThumbnailFailed(format!(
            "ffmpeg reported success but frame is missing: {error}"
        ))
    })?;
    if metadata.len() == 0 {
        let _ = std::fs::remove_file(output);
        return Err(FfmpegError::ThumbnailFailed(
            "ffmpeg produced an empty frame".to_string(),
        ));
    }
    Ok(())
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
    #[test]
    fn extract_frame_rejects_missing_video() {
        let result = extract_frame("missing-video.mp4", "unused-frame.jpg", 1.0);
        assert!(matches!(result, Err(FfmpegError::FileNotFound)));
    }

    #[test]
    fn empty_frame_output_is_rejected() {
        let output =
            std::env::temp_dir().join(format!("rain-empty-frame-{}.jpg", uuid::Uuid::new_v4()));
        std::fs::write(&output, []).unwrap();

        let result = validate_frame_output(&output);

        assert!(matches!(result, Err(FfmpegError::ThumbnailFailed(_))));
        assert!(!output.exists());
    }
    #[test]
    fn extract_frame_never_deletes_its_input() {
        let video = std::env::temp_dir().join(format!("rain-source-{}.mp4", uuid::Uuid::new_v4()));
        std::fs::write(&video, b"not-a-real-video").unwrap();
        let path = video.to_string_lossy().to_string();

        let result = extract_frame(&path, &path, 0.0);

        assert!(matches!(result, Err(FfmpegError::ThumbnailFailed(_))));
        assert!(video.exists());
        let _ = std::fs::remove_file(video);
    }
}
