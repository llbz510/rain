// src-tauri/src/events.rs
// ========================================
// Tauri event 推送（决策97）
// ========================================

use serde::{Deserialize, Serialize};
use tauri::Emitter;

pub const PROGRESS_EVENT: &str = "progress";
pub const IMPORT_COMPLETE_EVENT: &str = "import_complete";
pub const IMPORT_FAILED_EVENT: &str = "import_failed";
pub const IMPORT_CANCELLED_EVENT: &str = "import_cancelled";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressPayload {
    pub video_id: String,
    pub stage: String,
    pub block_current: u32,
    pub block_total: u32,
    pub percent: u32,
    pub retrying: bool,
}

pub fn emit_progress(
    app: &tauri::AppHandle,
    payload: ProgressPayload,
) -> Result<(), String> {
    app.emit(PROGRESS_EVENT, payload)
        .map_err(|e| e.to_string())
}

pub fn emit_import_complete(
    app: &tauri::AppHandle,
    video_id: String,
) -> Result<(), String> {
    app.emit(IMPORT_COMPLETE_EVENT, video_id)
        .map_err(|e| e.to_string())
}

pub fn emit_import_failed(
    app: &tauri::AppHandle,
    video_id: String,
    error: String,
) -> Result<(), String> {
    app.emit(IMPORT_FAILED_EVENT, serde_json::json!({ "video_id": video_id, "error": error }))
        .map_err(|e| e.to_string())
}

pub fn emit_import_cancelled(
    app: &tauri::AppHandle,
    video_id: String,
) -> Result<(), String> {
    app.emit(IMPORT_CANCELLED_EVENT, video_id)
        .map_err(|e| e.to_string())
}
