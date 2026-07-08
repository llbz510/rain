// src-tauri/src/ytdlp.rs
// ========================================
// yt-dlp 子进程封装（决策95）
// ========================================

use std::process::Command;

#[derive(Debug, Clone)]
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

pub fn check_ytdlp() -> YtdlpResult {
    let result = Command::new("yt-dlp")
        .arg("--version")
        .output();

    match result {
        Ok(output) if output.status.success() => YtdlpResult {
            available: true,
            message: None,
        },
        _ => YtdlpResult {
            available: false,
            message: Some(
                "yt-dlp 未安装。请访问 https://github.com/yt-dlp/yt-dlp 下载安装并添加到 PATH。"
                    .to_string(),
            ),
        },
    }
}

pub fn parse_video_info(url: &str) -> Result<VideoInfo, YtdlpError> {
    if url.is_empty() || (!url.starts_with("http://") && !url.starts_with("https://")) {
        return Err(YtdlpError::InvalidUrl);
    }
    // 实际实现：yt-dlp --dump-json <url>
    Ok(VideoInfo {
        title: String::new(),
        duration: 0.0,
        thumbnail: String::new(),
    })
}

pub fn download_video(url: &str, video_dir: &str) -> Result<String, YtdlpError> {
    if url.is_empty() {
        return Err(YtdlpError::InvalidUrl);
    }
    // 实际实现：yt-dlp -o <video_dir>/video.mp4 <url>
    Ok(format!("{}/video.mp4", video_dir))
}

pub fn fetch_subtitles(url: &str) -> Result<Vec<SubtitleTrack>, YtdlpError> {
    if url.is_empty() {
        return Err(YtdlpError::InvalidUrl);
    }
    // 实际实现：yt-dlp --list-subs <url> 然后 --write-sub
    Ok(Vec::new())
}

#[derive(Debug, Clone)]
pub struct VideoInfo {
    pub title: String,
    pub duration: f64,
    pub thumbnail: String,
}

#[derive(Debug, Clone)]
pub struct SubtitleTrack {
    pub language: String,
    pub url: String,
}
