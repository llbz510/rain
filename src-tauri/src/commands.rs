// src-tauri/src/commands.rs
// ========================================
// Tauri command 层（决策92/96/98）
// ========================================

use crate::asr_persistence::{self, PersistedSentence};
use crate::asr_transcript::{build_asr_transcript, AsrSentence};
use crate::events::{self, ProgressPayload};
use crate::ffmpeg;
use crate::import_state_persistence::{self, ImportState};
use crate::note_persistence::{self, PersistedNote};
use crate::scheduler::{CancellationToken, ImportScheduler, TaskFinish};
use crate::settings_persistence::{self, SettingMutation};
use crate::structure_persistence::{self, PersistedNode, SentenceAssignment};
use crate::video_deletion;
use crate::whisper::{self, WhisperModelSize};
use crate::ytdlp;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

/// 取消导入（通过 CancellationToken，决策83/98）
#[tauri::command]
pub async fn cancel_import(
    scheduler: State<'_, Arc<ImportScheduler>>,
    video_id: String,
) -> Result<(), String> {
    scheduler.cancel_if_current(&video_id).await;
    Ok(())
}

/// 检测 yt-dlp 可用性（决策95）
#[tauri::command]
pub async fn check_ytdlp_command() -> Result<ytdlp::YtdlpResult, String> {
    Ok(ytdlp::check_ytdlp())
}

/// 读取当前桌面运行能力（用于前端运行前自检）
#[tauri::command]
pub async fn get_runtime_capability() -> Result<crate::runtime::RuntimeCapability, String> {
    Ok(crate::runtime::runtime_capability())
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
    tokio::task::spawn_blocking(move || ffmpeg::extract_frame(&file_path, &output_path, timestamp))
        .await
        .map_err(|error| format!("Thumbnail task failed: {error}"))?
        .map_err(|error| error.to_string())
}

/// 启动 ASR（决策32/94/85）
/// tier: "subtitle" | "api" | "whisper"
#[tauri::command]
pub async fn start_asr(
    app: AppHandle,
    scheduler: State<'_, Arc<ImportScheduler>>,
    video_id: String,
    file_path: String,
    tier: String,
    model_path: Option<String>,
    language: Option<String>,
) -> Result<Vec<AsrSentence>, String> {
    if let Err(error) = validate_asr_tier(&tier) {
        let _ = events::emit_import_failed(&app, video_id, error.clone());
        return Err(error);
    }

    let model = model_path.unwrap_or_default();
    let language = normalize_asr_language(language)?;
    if let Err(error) = whisper::validate_asr_request(&file_path, &model) {
        let _ = events::emit_import_failed(&app, video_id, error.clone());
        return Err(error);
    }

    let task = scheduler.start_video_task(video_id.clone()).await;
    let token = task.token();
    let result = run_whisper_asr(&app, &video_id, &file_path, &model, &language, token.clone()).await;

    let response = match result {
        Ok(sentences) => match scheduler.finish_success(&token).await {
            TaskFinish::Completed => {
                let _ = events::emit_progress(&app, ProgressPayload::new(&video_id, "asr", 100));
                Ok(sentences)
            }
            TaskFinish::Cancelled => {
                let _ = events::emit_import_cancelled(&app, video_id);
                Err("ASR cancelled".to_string())
            }
            TaskFinish::Stale | TaskFinish::Failed => Err("ASR task was superseded".to_string()),
        },
        Err(error) => match scheduler.finish_failure(&token, error.clone()).await {
            TaskFinish::Failed => {
                let _ = events::emit_import_failed(&app, video_id, error.clone());
                Err(error)
            }
            TaskFinish::Cancelled => {
                let _ = events::emit_import_cancelled(&app, video_id);
                Err("ASR cancelled".to_string())
            }
            TaskFinish::Stale | TaskFinish::Completed => Err("ASR task was superseded".to_string()),
        },
    };
    drop(task);
    response
}

fn rain_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    if std::env::var("RAIN_E2E_MODE").ok().as_deref() == Some("1") {
        if let Ok(path) = std::env::var("RAIN_E2E_DB_PATH") {
            let database_path = PathBuf::from(path);
            if let Some(parent) = database_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|error| format!("Create E2E database dir: {error}"))?;
            }
            return Ok(database_path);
        }
    }
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Cannot resolve app config dir: {error}"))?;
    Ok(config_dir.join("rain.db"))
}
#[tauri::command]
pub async fn save_asr_atomically(
    app: AppHandle,
    video_id: String,
    language: String,
    sentences: Vec<PersistedSentence>,
) -> Result<(), String> {
    use sqlx::{Connection, SqliteConnection};
    let database_path = rain_database_path(&app)?;
    let mut connection = SqliteConnection::connect(database_path.to_string_lossy().as_ref())
        .await
        .map_err(|error| format!("Open Rain database: {error}"))?;
    asr_persistence::save_asr_atomically_on_connection(
        &mut connection,
        &video_id,
        &language,
        &sentences,
    )
    .await
    .map_err(|error| format!("Persist ASR atomically: {error}"))
}

#[tauri::command]
pub async fn insert_note_atomically(app: AppHandle, note: PersistedNote) -> Result<(), String> {
    use sqlx::{Connection, SqliteConnection};
    let database_path = rain_database_path(&app)?;
    let mut connection = SqliteConnection::connect(database_path.to_string_lossy().as_ref())
        .await
        .map_err(|error| format!("Open Rain database: {error}"))?;
    note_persistence::insert_note_atomically_on_connection(&mut connection, &note)
        .await
        .map_err(|error| format!("Persist note atomically: {error}"))
}

#[tauri::command]
pub async fn delete_video_atomically(app: AppHandle, video_id: String) -> Result<(), String> {
    use sqlx::{Connection, SqliteConnection};
    let database_path = rain_database_path(&app)?;
    let mut connection = SqliteConnection::connect(database_path.to_string_lossy().as_ref())
        .await
        .map_err(|error| format!("Open Rain database: {error}"))?;
    video_deletion::delete_video_atomically_on_connection(&mut connection, &video_id)
        .await
        .map_err(|error| format!("Delete video atomically: {error}"))
}

#[tauri::command]
pub async fn apply_settings_atomically(
    app: AppHandle,
    mutations: Vec<SettingMutation>,
) -> Result<(), String> {
    use sqlx::{Connection, SqliteConnection};
    let database_path = rain_database_path(&app)?;
    let mut connection = SqliteConnection::connect(database_path.to_string_lossy().as_ref())
        .await
        .map_err(|error| format!("Open Rain database: {error}"))?;
    settings_persistence::apply_settings_atomically_on_connection(&mut connection, &mutations)
        .await
        .map_err(|error| format!("Apply settings atomically: {error}"))
}

#[tauri::command]
pub async fn assign_asr_sentences_atomically(
    app: AppHandle,
    video_id: String,
    assignments: Vec<SentenceAssignment>,
) -> Result<(), String> {
    use sqlx::{Connection, SqliteConnection};
    let database_path = rain_database_path(&app)?;
    let mut connection = SqliteConnection::connect(database_path.to_string_lossy().as_ref())
        .await
        .map_err(|error| format!("Open Rain database: {error}"))?;
    structure_persistence::assign_asr_sentences_to_nodes_on_connection(
        &mut connection,
        &video_id,
        &assignments,
    )
    .await
    .map_err(|error| format!("Assign ASR sentences atomically: {error}"))
}
#[tauri::command]
pub async fn transition_video_import_state(
    app: AppHandle,
    video_id: String,
    expected: ImportState,
    next: ImportState,
) -> Result<(), String> {
    use sqlx::{Connection, SqliteConnection};
    let database_path = rain_database_path(&app)?;
    let mut connection = SqliteConnection::connect(database_path.to_string_lossy().as_ref())
        .await
        .map_err(|error| format!("Open Rain database: {error}"))?;
    import_state_persistence::transition_import_state_on_connection(
        &mut connection,
        &video_id,
        &expected,
        &next,
    )
    .await
    .map_err(|error| format!("Transition import state: {error}"))
}

#[tauri::command]
pub async fn merge_import_atomically(
    app: AppHandle,
    video_id: String,
    nodes: Vec<PersistedNode>,
    assignments: Vec<SentenceAssignment>,
) -> Result<(), String> {
    use sqlx::{Connection, SqliteConnection};
    let database_path = rain_database_path(&app)?;
    let mut connection = SqliteConnection::connect(database_path.to_string_lossy().as_ref())
        .await
        .map_err(|error| format!("Open Rain database: {error}"))?;
    structure_persistence::merge_import_on_connection(
        &mut connection,
        &video_id,
        &nodes,
        &assignments,
    )
    .await
    .map_err(|error| format!("Merge import atomically: {error}"))
}
fn validate_asr_tier(tier: &str) -> Result<(), String> {
    if tier == "whisper" {
        Ok(())
    } else {
        Err(format!(
            "ASR tier '{tier}' is not supported; configure local Whisper"
        ))
    }
}

fn normalize_asr_language(language: Option<String>) -> Result<String, String> {
    let normalized = language
        .unwrap_or_else(|| "zh".to_string())
        .trim()
        .to_ascii_lowercase();
    match normalized.as_str() {
        "zh" | "en" | "auto" => Ok(normalized),
        _ => Err(format!("ASR language '{normalized}' is not supported; use zh, en, or auto")),
    }
}
async fn run_whisper_asr(
    app: &AppHandle,
    video_id: &str,
    file_path: &str,
    model_path: &str,
    language: &str,
    token: CancellationToken,
) -> Result<Vec<AsrSentence>, String> {
    ensure_asr_not_cancelled(&token)?;
    let _ = events::emit_progress(app, ProgressPayload::new(video_id, "asr_extraction", 10));

    let temp_wav = whisper::temporary_wav_path(file_path);
    if let Some(parent) = temp_wav.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Create ASR temp dir failed: {error}"))?;
    }
    let _temp_guard = whisper::TemporaryWavGuard::new(temp_wav.clone());
    let temp_wav_string = temp_wav
        .to_str()
        .ok_or_else(|| "Temporary WAV path is not valid UTF-8".to_string())?
        .to_string();

    let input = file_path.to_string();
    let output = temp_wav_string.clone();
    let conversion_token = token.clone();
    tokio::task::spawn_blocking(move || {
        whisper::convert_to_wav_cancellable(&input, &output, Some(&conversion_token))
    })
    .await
    .map_err(|error| format!("ASR extraction task failed: {error}"))?
    .map_err(|error| error.to_string())?;

    ensure_asr_not_cancelled(&token)?;
    let _ = events::emit_progress(app, ProgressPayload::new(video_id, "asr_transcription", 35));

    let model = model_path.to_string();
    let wav = temp_wav_string;
    let inference_token = token.clone();
    let whisper_language = if language == "auto" { None } else { Some(language.to_string()) };
    let whisper_result = tokio::task::spawn_blocking(move || {
        whisper::transcribe_wav_with_language(&model, &wav, whisper_language.as_deref(), Some(inference_token))
    })
    .await
    .map_err(|error| format!("Whisper task failed: {error}"))?
    .map_err(|error| error.to_string())?;

    ensure_asr_not_cancelled(&token)?;
    let _ = events::emit_progress(app, ProgressPayload::new(video_id, "asr_finalization", 90));

    build_asr_transcript(&whisper_result)
}

fn ensure_asr_not_cancelled(token: &CancellationToken) -> Result<(), String> {
    if token.is_cancelled() {
        Err("ASR cancelled".to_string())
    } else {
        Ok(())
    }
}

/// 下载 Whisper 模型（决策94）
#[tauri::command]
pub async fn download_whisper_model(app: AppHandle, model_size: String) -> Result<String, String> {
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

    std::fs::create_dir_all(&output_dir).map_err(|e| format!("Create dir failed: {}", e))?;

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

    std::fs::write(&output_path, &bytes).map_err(|e| format!("Write file failed: {}", e))?;

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
            found.push(path.to_string_lossy().to_string());
        }
    }

    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelled_asr_token_is_rejected() {
        let token = crate::scheduler::CancellationToken::new();
        token.cancel();
        assert_eq!(
            ensure_asr_not_cancelled(&token).unwrap_err(),
            "ASR cancelled"
        );
    }
    #[test]
    fn unsupported_asr_tiers_fail_closed() {
        assert!(validate_asr_tier("whisper").is_ok());
        assert_eq!(
            validate_asr_tier("subtitle").unwrap_err(),
            "ASR tier 'subtitle' is not supported; configure local Whisper"
        );
        assert!(validate_asr_tier("api").is_err());
    }

    #[test]
    fn asr_language_defaults_to_chinese_and_fails_closed() {
        assert_eq!(normalize_asr_language(None).unwrap(), "zh");
        assert_eq!(normalize_asr_language(Some("AUTO".to_string())).unwrap(), "auto");
        assert!(normalize_asr_language(Some("fr".to_string())).unwrap_err().contains("zh, en, or auto"));
    }
}
