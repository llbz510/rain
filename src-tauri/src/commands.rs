// src-tauri/src/commands.rs
// ========================================
// Tauri command 层（决策92/96/98）
// ========================================

use crate::asr_execution::{self, AsrExecutionRequest};
use crate::asr_persistence::{self, PersistedSentence};
use crate::asr_transcript::AsrSentence;
use crate::ffmpeg;
use crate::import_state_persistence::{self, ImportState};
use crate::note_persistence::{self, PersistedNote};
use crate::scheduler::ImportScheduler;
use crate::settings_persistence::{self, SettingMutation};
use crate::structure_persistence::{self, PersistedNode, SentenceAssignment};
use crate::video_deletion;
use crate::whisper::WhisperModelSize;
use crate::whisper_model_download::{self, ModelDownloadManager};
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
    asr_execution::execute_asr(
        &app,
        scheduler.inner().as_ref(),
        AsrExecutionRequest {
            video_id,
            file_path,
            tier,
            model_path,
            language,
        },
    )
    .await
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
/// 下载 Whisper 模型（决策94）
#[tauri::command]
pub async fn download_whisper_model(
    app: AppHandle,
    downloads: State<'_, Arc<ModelDownloadManager>>,
    model_size: String,
) -> Result<String, String> {
    let size = WhisperModelSize::from_str(&model_size)
        .ok_or_else(|| format!("Unknown model size: {}", model_size))?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
    let output_dir = data_dir.join("whisper-models");
    whisper_model_download::download_model(downloads.inner().as_ref(), &app, &output_dir, size)
        .await
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn cancel_whisper_model_download(
    downloads: State<'_, Arc<ModelDownloadManager>>,
    model_size: String,
) -> Result<bool, String> {
    let size = WhisperModelSize::from_str(&model_size)
        .ok_or_else(|| format!("Unknown model size: {}", model_size))?;
    Ok(whisper_model_download::cancel_model_download(downloads.inner().as_ref(), size).await)
}

/// 列出已下载的 Whisper 模型
#[tauri::command]
pub async fn list_whisper_models(app: AppHandle) -> Result<Vec<String>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {}", e))?;
    let model_dir = data_dir.join("whisper-models");

    Ok(whisper_model_download::list_models(&model_dir)
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect())
}
