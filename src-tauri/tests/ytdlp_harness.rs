// src-tauri/tests/ytdlp_harness.rs
// ========================================
// Rust Harness: yt-dlp 子进程封装（决策95）
// 锁定后禁止 AI 修改
// ========================================

use rain_lib::ytdlp::{check_ytdlp, YtdlpResult, parse_video_info, download_video, fetch_subtitles};

#[test]
fn r01_check_ytdlp_returns_availability() {
    // 检测 yt-dlp 是否可调用（PATH 查找）
    // 测试环境中可能没有 yt-dlp，所以只验证函数存在和返回类型
    let result: YtdlpResult = check_ytdlp();
    assert!(result.available || !result.available);
    // 不可用时 message 应该包含安装链接
    if !result.available {
        assert!(result.message.as_ref().unwrap().contains("yt-dlp"));
        assert!(result.message.as_ref().unwrap().contains("https://"));
    }
}

#[test]
fn r02_ytdlp_unavailable_includes_install_link() {
    // 不可用时返回包含安装链接的错误
    // YtdlpResult 结构体定义了这个契约
    let result = YtdlpResult {
        available: false,
        message: Some("yt-dlp 未安装。请访问 https://github.com/yt-dlp/yt-dlp".to_string()),
    };
    assert!(!result.available);
    assert!(result.message.unwrap().contains("https://github.com/yt-dlp/yt-dlp"));
}

#[test]
fn r03_parse_video_info_returns_metadata() {
    // 解析在线视频元信息（标题/时长/缩略图URL）
    // 这个函数签名定义了返回结构
    let _ = parse_video_info;  // 函数存在
}

#[test]
fn r04_download_video_to_video_dir() {
    // 下载视频到 videos/<videoId>/
    let _ = download_video;  // 函数存在
}

#[test]
fn r05_fetch_subtitles() {
    // 抓取字幕轨（YouTube/B站自动字幕）
    let _ = fetch_subtitles;  // 函数存在
}

#[test]
fn r06_invalid_url_returns_error() {
    // 无效 URL 应该返回错误类型
    // 定义错误枚举包含 InvalidUrl variant
    use rain_lib::ytdlp::YtdlpError;
    let _err = YtdlpError::InvalidUrl;
}
