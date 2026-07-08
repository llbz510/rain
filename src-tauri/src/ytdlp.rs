// src-tauri/src/ytdlp.rs
// ========================================
// yt-dlp 子进程封装（决策95）
// ========================================

use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct YtdlpResult {
    pub available: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
pub enum YtdlpError {
    InvalidUrl,
    NotInstalled,
    DownloadFailed(String),
    ParseFailed(String),
}

impl std::fmt::Display for YtdlpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            YtdlpError::InvalidUrl => write!(f, "Invalid URL"),
            YtdlpError::NotInstalled => write!(f, "yt-dlp not installed"),
            YtdlpError::DownloadFailed(msg) => write!(f, "Download failed: {}", msg),
            YtdlpError::ParseFailed(msg) => write!(f, "Parse failed: {}", msg),
        }
    }
}

impl std::error::Error for YtdlpError {}

pub fn check_ytdlp() -> YtdlpResult {
    let result = Command::new("yt-dlp").arg("--version").output();

    match result {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout);
            YtdlpResult {
                available: true,
                message: Some(format!("yt-dlp 可用: {}", version.trim())),
            }
        }
        _ => YtdlpResult {
            available: false,
            message: Some(
                "yt-dlp 未安装。请访问 https://github.com/yt-dlp/yt-dlp 下载安装并添加到 PATH。"
                    .to_string(),
            ),
        },
    }
}

fn is_valid_url(url: &str) -> bool {
    !url.is_empty() && (url.starts_with("http://") || url.starts_with("https://"))
}

pub fn parse_video_info(url: &str) -> Result<VideoInfo, YtdlpError> {
    if !is_valid_url(url) {
        return Err(YtdlpError::InvalidUrl);
    }

    let output = Command::new("yt-dlp")
        .arg("--dump-json")
        .arg("--no-playlist")
        .arg(url)
        .output()
        .map_err(|e| YtdlpError::ParseFailed(format!("Failed to run yt-dlp: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(YtdlpError::ParseFailed(stderr.to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| YtdlpError::ParseFailed(format!("JSON parse error: {}", e)))?;

    let title = json
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown")
        .to_string();

    let duration = json
        .get("duration")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let thumbnail = json
        .get("thumbnail")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok(VideoInfo {
        title,
        duration,
        thumbnail,
    })
}

pub fn download_video(url: &str, video_dir: &str) -> Result<String, YtdlpError> {
    if !is_valid_url(url) {
        return Err(YtdlpError::InvalidUrl);
    }

    let output_template = format!("{}/video.%(ext)s", video_dir);

    let output = Command::new("yt-dlp")
        .arg("--no-playlist")
        .arg("-o")
        .arg(&output_template)
        .arg("-f")
        .arg("bestvideo+bestaudio/best")
        .arg("--merge-output-format")
        .arg("mp4")
        .arg(url)
        .output()
        .map_err(|e| YtdlpError::DownloadFailed(format!("Failed to run yt-dlp: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(YtdlpError::DownloadFailed(stderr.to_string()));
    }

    Ok(format!("{}/video.mp4", video_dir))
}

pub fn fetch_subtitles(url: &str) -> Result<Vec<SubtitleTrack>, YtdlpError> {
    if !is_valid_url(url) {
        return Err(YtdlpError::InvalidUrl);
    }

    let output = Command::new("yt-dlp")
        .arg("--list-subs")
        .arg("--print-json")
        .arg(url)
        .output()
        .map_err(|e| YtdlpError::ParseFailed(format!("Failed to run yt-dlp: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(YtdlpError::ParseFailed(stderr.to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = serde_json::from_str(&stdout)
        .unwrap_or(serde_json::Value::Null);

    let mut tracks = Vec::new();

    if let Some(subs) = json.get("subtitles").and_then(|v| v.as_object()) {
        for (lang, variants) in subs {
            if let Some(arr) = variants.as_array() {
                if let Some(first) = arr.first() {
                    let url = first
                        .get("url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let ext = first
                        .get("ext")
                        .and_then(|v| v.as_str())
                        .unwrap_or("vtt")
                        .to_string();
                    tracks.push(SubtitleTrack {
                        language: lang.clone(),
                        url,
                        format: ext,
                    });
                }
            }
        }
    }

    // 自动字幕
    if let Some(auto_subs) = json.get("automatic_captions").and_then(|v| v.as_object()) {
        for (lang, variants) in auto_subs {
            if let Some(arr) = variants.as_array() {
                if let Some(first) = arr.first() {
                    let url = first
                        .get("url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let ext = first
                        .get("ext")
                        .and_then(|v| v.as_str())
                        .unwrap_or("vtt")
                        .to_string();
                    tracks.push(SubtitleTrack {
                        language: lang.clone(),
                        url,
                        format: ext,
                    });
                }
            }
        }
    }

    Ok(tracks)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoInfo {
    pub title: String,
    pub duration: f64,
    pub thumbnail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleTrack {
    pub language: String,
    pub url: String,
    pub format: String,
}
