// src-tauri/src/commands.rs
// ========================================
// Tauri command 层（决策92/96/98）
// ========================================

use crate::ytdlp;
use crate::ffmpeg;
use crate::whisper::{WhisperModelSize, WhisperError};

/// 启动导入（立即返回，后台 tokio task 跑，决策98）
#[tauri::command]
pub async fn start_import(
    _app: tauri::AppHandle,
    video_id: String,
    source: String,
    file_path: Option<String>,
    source_url: Option<String>,
) -> Result<(), String> {
    // 实际实现：启动 tokio task 跑 ASR → Stage2 → 合并
    Ok(())
}

/// 取消导入（通过 CancellationToken，决策83/98）
#[tauri::command]
pub async fn cancel_import(video_id: String) -> Result<(), String> {
    // 实际实现：找到对应 task 的 CancellationToken 并 cancel
    Ok(())
}

/// 检测 yt-dlp 可用性（决策95）
#[tauri::command]
pub async fn check_ytdlp_command() -> Result<ytdlp::YtdlpResult, String> {
    Ok(ytdlp::check_ytdlp())
}

/// 探测视频信息（时长/缩略图等，决策96）
#[tauri::command]
pub async fn probe_video_info(file_path: String) -> Result<ytdlp::VideoInfo, String> {
    ytdlp::parse_video_info(&file_path).map_err(|e| format!("{:?}", e))
}

/// 生成缩略图（决策96）
#[tauri::command]
pub async fn generate_thumbnail(
    file_path: String,
    output_path: String,
    timestamp: f64,
) -> Result<String, String> {
    ffmpeg::extract_thumbnail(&file_path, &output_path, timestamp)
        .map_err(|e| format!("{:?}", e))
}

/// 启动 ASR（决策32/94/85）
#[tauri::command]
pub async fn start_asr(
    _app: tauri::AppHandle,
    video_id: String,
    file_path: String,
    tier: String,
    model_path: Option<String>,
) -> Result<(), String> {
    // 实际实现：根据 tier 调用 subtitle/api/whisper ASR
    Ok(())
}

/// 下载 Whisper 模型（决策94）
#[tauri::command]
pub async fn download_whisper_model(
    model_size: String,
    output_dir: String,
) -> Result<String, String> {
    let size = match model_size.as_str() {
        "tiny" => WhisperModelSize::Tiny,
        "base" => WhisperModelSize::Base,
        "small" => WhisperModelSize::Small,
        "medium" => WhisperModelSize::Medium,
        "large-v3" => WhisperModelSize::LargeV3,
        _ => return Err(format!("Unknown model size: {}", model_size)),
    };
    let filename = size.as_filename();
    Ok(format!("{}/{}", output_dir, filename))
}

/// 列出已下载的 Whisper 模型
#[tauri::command]
pub async fn list_whisper_models(model_dir: String) -> Result<Vec<String>, String> {
    // 实际实现：扫描 model_dir 目录
    Ok(Vec::new())
}

/// 将本地文件路径转为 asset:// URL（决策96）
pub fn convert_file_src(file_path: &str) -> String {
    // Tauri 2 的 convertFileSrc 将路径转为 asset://localhost/path
    format!("asset://localhost{}", file_path)
}
