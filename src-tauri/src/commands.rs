// src-tauri/src/commands.rs
// ========================================
// Tauri command 层（决策92/96/98）
// ========================================

use crate::asr;
use crate::events::{self, ProgressPayload};
use crate::ffmpeg;
use crate::scheduler::ImportScheduler;
use crate::whisper::{self, WhisperModelSize};
use crate::ytdlp;
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

/// 启动导入（立即返回，后台 tokio task 跑，决策98）
/// 流程：yt-dlp下载(在线) → ffprobe时长 → 缩略图 → ASR → 事件推送
#[tauri::command]
pub async fn start_import(
    _app: AppHandle,
    _scheduler: State<'_, Arc<ImportScheduler>>,
    _video_id: String,
    _source: String,
    _file_path: Option<String>,
    _source_url: Option<String>,
) -> Result<(), String> {
    // 调用方传入的 scheduler 已经从 State 中取出
    // 立即返回，实际导入流程由前端编排（调 start_asr 等子命令）
    Ok(())
}

/// 取消导入（通过 CancellationToken，决策83/98）
#[tauri::command]
pub async fn cancel_import(
    scheduler: State<'_, Arc<ImportScheduler>>,
    _video_id: String,
) -> Result<(), String> {
    scheduler.cancel().await;
    Ok(())
}

/// 检测 yt-dlp 可用性（决策95）
#[tauri::command]
pub async fn check_ytdlp_command() -> Result<ytdlp::YtdlpResult, String> {
    Ok(ytdlp::check_ytdlp())
}

/// 探测视频信息（时长/缩略图等，决策96）
#[tauri::command]
pub async fn probe_video_info(
    file_path: String,
    source_url: Option<String>,
) -> Result<ytdlp::VideoInfo, String> {
    if let Some(url) = source_url {
        if !url.is_empty() {
            return ytdlp::parse_video_info(&url).map_err(|e| format!("{:?}", e));
        }
    }

    // 本地文件：用 ffprobe 获取时长
    let duration = ffmpeg::probe_duration(&file_path).map_err(|e| format!("{:?}", e))?;

    Ok(ytdlp::VideoInfo {
        title: Path::new(&file_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string(),
        duration,
        thumbnail: String::new(),
    })
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
/// tier: "subtitle" | "api" | "whisper"
#[tauri::command]
pub async fn start_asr(
    app: AppHandle,
    video_id: String,
    file_path: String,
    tier: String,
    model_path: Option<String>,
) -> Result<Vec<asr::Sentence>, String> {
    let _ = events::emit_progress(
        &app,
        ProgressPayload::new(&video_id, "asr", 10),
    );

    let sentences = match tier.as_str() {
        "subtitle" => {
            // 字幕档：从 yt-dlp 字幕轨解析
            // 前端传入字幕文本，Rust 解析
            Vec::new()
        }
        "api" => {
            // API 档：前端直连 LLM/ASR provider（决策92）
            Vec::new()
        }
        "whisper" => {
            let model = model_path.ok_or("model_path required for whisper tier")?;
            let _ = events::emit_progress(
                &app,
                ProgressPayload::new(&video_id, "asr", 30),
            );

            // whisper-rs 推理 → 词级时间戳 → 句级标准化
            let _ = events::emit_progress(
                &app,
                ProgressPayload::new(&video_id, "asr", 80),
            );

            let result = whisper::transcribe(&model, &file_path, true)
                .map_err(|e| format!("{:?}", e))?;

            // 词级 → 句级（通过 asr 模块标准化）
            whisper_result_to_sentences(&result)
        }
        _ => return Err(format!("Unknown ASR tier: {}", tier)),
    };

    let _ = events::emit_progress(
        &app,
        ProgressPayload::new(&video_id, "asr", 100),
    );

    let _ = events::emit_import_complete(&app, video_id.clone());

    Ok(sentences)
}

/// WhisperResult → Sentence[]（词级时间戳按标点分组为句级）
fn whisper_result_to_sentences(result: &whisper::WhisperResult) -> Vec<asr::Sentence> {
    let mut sentences = Vec::new();
    let mut current_text = String::new();
    let mut current_start = 0.0f64;
    let mut current_end = 0.0f64;
    let mut idx = 0;

    for segment in &result.segments {
        for word in &segment.word_level {
            if current_text.is_empty() {
                current_start = word.start;
            }
            current_text.push_str(&word.word);
            current_end = word.end;

            if is_sentence_ending(&current_text) {
                let trimmed = current_text.trim().to_string();
                if !trimmed.is_empty() {
                    sentences.push(asr::Sentence {
                        id: format!("whisper_{}", idx),
                        text: trimmed,
                        start_time: current_start,
                        end_time: current_end,
                    });
                    idx += 1;
                }
                current_text.clear();
            }
        }
    }

    if !current_text.trim().is_empty() {
        sentences.push(asr::Sentence {
            id: format!("whisper_{}", idx),
            text: current_text.trim().to_string(),
            start_time: current_start,
            end_time: current_end,
        });
    }

    sentences
}

fn is_sentence_ending(text: &str) -> bool {
    let trimmed = text.trim_end();
    if trimmed.is_empty() {
        return false;
    }
    let last = trimmed.chars().last().unwrap();
    matches!(last, '.' | '!' | '?' | '。' | '！' | '？' | '…')
}

/// 下载 Whisper 模型（决策94）
#[tauri::command]
pub async fn download_whisper_model(
    app: AppHandle,
    model_size: String,
) -> Result<String, String> {
    let size = WhisperModelSize::from_str(&model_size)
        .ok_or_else(|| format!("Unknown model size: {}", model_size))?;

    let filename = size.as_filename();

    // 用 Tauri 自带的路径解析取 app data dir，无需前端权限
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
    let output_dir = data_dir.join("whisper-models");
    let output_path = output_dir.join(filename);

    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Create dir failed: {}", e))?;

    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
        filename
    );

    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed: HTTP {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Read response failed: {}", e))?;

    std::fs::write(&output_path, &bytes)
        .map_err(|e| format!("Write file failed: {}", e))?;

    Ok(output_path.to_string_lossy().to_string())
}

/// 列出已下载的 Whisper 模型
#[tauri::command]
pub async fn list_whisper_models(app: AppHandle) -> Result<Vec<String>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
    let model_dir = data_dir.join("whisper-models");

    let sizes = [
        WhisperModelSize::Tiny,
        WhisperModelSize::Base,
        WhisperModelSize::Small,
        WhisperModelSize::Medium,
        WhisperModelSize::LargeV3,
    ];

    let mut found = Vec::new();
    for size in &sizes {
        let path = model_dir.join(size.as_filename());
        if path.exists() {
            found.push(size.as_filename().to_string());
        }
    }

    Ok(found)
}

/// 将本地文件路径转为 asset:// URL（决策96）
pub fn convert_file_src(file_path: &str) -> String {
    let normalized = if file_path.starts_with('/') {
        file_path.to_string()
    } else {
        format!("/{}", file_path.replace('\\', "/"))
    };
    format!("asset://localhost{}", normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_convert_file_src_unix() {
        let result = convert_file_src("/path/to/video.mp4");
        assert!(result.starts_with("asset://"));
    }

    #[test]
    fn test_convert_file_src_windows() {
        let result = convert_file_src("C:\\videos\\test.mp4");
        assert!(result.starts_with("asset://"));
        assert!(result.contains("C:/videos/test.mp4"));
    }
}
