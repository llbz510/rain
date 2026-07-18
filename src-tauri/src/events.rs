// src-tauri/src/events.rs
// ========================================
// Tauri event 推送（决策97）
// ========================================

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

pub const PROGRESS_EVENT: &str = "progress";
pub const IMPORT_COMPLETE_EVENT: &str = "import_complete";
pub const IMPORT_FAILED_EVENT: &str = "import_failed";
pub const IMPORT_CANCELLED_EVENT: &str = "import_cancelled";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressPayload {
    pub video_id: String,
    pub stage: String,
    pub block_current: u32,
    pub block_total: u32,
    pub percent: u32,
    pub retrying: bool,
}

impl ProgressPayload {
    pub fn new(video_id: &str, stage: &str, percent: u32) -> Self {
        ProgressPayload {
            video_id: video_id.to_string(),
            stage: stage.to_string(),
            block_current: 0,
            block_total: 0,
            percent,
            retrying: false,
        }
    }

    pub fn with_block(
        video_id: &str,
        stage: &str,
        block_current: u32,
        block_total: u32,
        percent: u32,
        retrying: bool,
    ) -> Self {
        ProgressPayload {
            video_id: video_id.to_string(),
            stage: stage.to_string(),
            block_current,
            block_total,
            percent,
            retrying,
        }
    }
}

pub fn emit_progress(app: &AppHandle, payload: ProgressPayload) -> Result<(), String> {
    app.emit(PROGRESS_EVENT, payload).map_err(|e| e.to_string())
}

pub fn emit_import_complete(app: &AppHandle, video_id: String) -> Result<(), String> {
    app.emit(IMPORT_COMPLETE_EVENT, video_id)
        .map_err(|e| e.to_string())
}

pub fn emit_import_failed(app: &AppHandle, video_id: String, error: String) -> Result<(), String> {
    app.emit(
        IMPORT_FAILED_EVENT,
        serde_json::json!({ "videoId": video_id, "error": error }),
    )
    .map_err(|e| e.to_string())
}

pub fn emit_import_cancelled(app: &AppHandle, video_id: String) -> Result<(), String> {
    app.emit(IMPORT_CANCELLED_EVENT, video_id)
        .map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_payload_serializes_for_the_typescript_contract() {
        let value = serde_json::to_value(ProgressPayload::new("v1", "asr_extraction", 10)).unwrap();

        assert_eq!(value["videoId"], "v1");
        assert_eq!(value["blockCurrent"], 0);
        assert!(value.get("video_id").is_none());
        assert!(value.get("block_current").is_none());
    }
}
