use sqlx::{sqlite::SqliteConnectOptions, Connection, SqliteConnection};
use std::path::{Path, PathBuf};
use tauri::scope::fs::Scope;

/// Native dialogs grant only the selected file in the current process. Restore
/// those exact grants from Rain's persisted local Video facts after a restart.
/// App-owned thumbnails/downloads are covered by the static asset scope.
pub async fn restore_local_media_access(database_path: &Path, scope: &Scope) -> Result<(), String> {
    if !database_path.exists() {
        return Ok(());
    }
    let options = SqliteConnectOptions::new()
        .filename(database_path)
        .read_only(true);
    let mut connection = SqliteConnection::connect_with(&options)
        .await
        .map_err(|error| format!("Read local media access: {error}"))?;
    let has_video_table: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='video')",
    )
    .fetch_one(&mut connection)
    .await
    .map_err(|error| format!("Read local media schema: {error}"))?;
    if !has_video_table {
        connection
            .close()
            .await
            .map_err(|error| format!("Close local media database: {error}"))?;
        return Ok(());
    }
    let paths: Vec<String> = sqlx::query_scalar(
        "SELECT file_path FROM video WHERE source='local' AND file_path IS NOT NULL",
    )
    .fetch_all(&mut connection)
    .await
    .map_err(|error| format!("Read selected media paths: {error}"))?;
    connection
        .close()
        .await
        .map_err(|error| format!("Close local media database: {error}"))?;
    for path in paths {
        let path = PathBuf::from(path);
        if path.is_absolute() {
            // Tauri canonicalizes and escapes literal glob characters. Never
            // grant the containing directory or use file_path as a glob.
            scope
                .allow_file(path)
                .map_err(|error| format!("Restore selected media access: {error}"))?;
        }
    }
    Ok(())
}
