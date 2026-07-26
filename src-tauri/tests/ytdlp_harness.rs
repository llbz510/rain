// src-tauri/tests/ytdlp_harness.rs
// ========================================
// Rust Harness: yt-dlp boundary behavior
// URL workflow remains non-gating until its product AC is confirmed.
// Harness migration: 2026-07-26
// ========================================

use rain_lib::ytdlp::{
    check_ytdlp, download_video, fetch_subtitles, parse_video_info, YtdlpError,
};

#[test]
fn r01_check_ytdlp_returns_an_actionable_status() {
    let result = check_ytdlp();
    let message = result.message.expect("yt-dlp status must include a message");

    assert!(!message.trim().is_empty());
    if result.available {
        assert!(message.contains("yt-dlp"));
        assert!(message.contains("可用"));
    } else {
        assert!(message.contains("https://github.com/yt-dlp/yt-dlp"));
        assert!(message.contains("PATH"));
    }
}

#[test]
fn r03_parse_video_info_rejects_invalid_urls_before_starting_a_process() {
    assert!(matches!(
        parse_video_info("not-a-url"),
        Err(YtdlpError::InvalidUrl)
    ));
}

#[test]
fn r04_download_video_rejects_invalid_urls_before_starting_a_process() {
    assert!(matches!(
        download_video("", "unused-output"),
        Err(YtdlpError::InvalidUrl)
    ));
}

#[test]
fn r05_fetch_subtitles_rejects_invalid_urls_before_starting_a_process() {
    assert!(matches!(
        fetch_subtitles("ftp://example.com/video"),
        Err(YtdlpError::InvalidUrl)
    ));
}

#[test]
fn r06_ytdlp_errors_keep_actionable_context() {
    assert_eq!(YtdlpError::InvalidUrl.to_string(), "Invalid URL");
    assert_eq!(YtdlpError::NotInstalled.to_string(), "yt-dlp not installed");
    assert_eq!(
        YtdlpError::DownloadFailed("network".into()).to_string(),
        "Download failed: network"
    );
    assert_eq!(
        YtdlpError::ParseFailed("bad json".into()).to_string(),
        "Parse failed: bad json"
    );
}
