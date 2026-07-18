use serde::Deserialize;
use sqlx::SqliteConnection;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportState {
    pub status: String,
    pub stage: Option<String>,
    pub error_message: Option<String>,
}

pub async fn transition_import_state_on_connection(
    connection: &mut SqliteConnection,
    video_id: &str,
    expected: &ImportState,
    next: &ImportState,
) -> Result<(), sqlx::Error> {
    let update = sqlx::query(
        "UPDATE video SET status = ?, stage = ?, error_message = ? WHERE id = ? AND status = ? AND ((stage IS NULL AND ? IS NULL) OR stage = ?)",
    )
    .bind(&next.status)
    .bind(&next.stage)
    .bind(&next.error_message)
    .bind(video_id)
    .bind(&expected.status)
    .bind(&expected.stage)
    .bind(&expected.stage)
    .execute(connection)
    .await?;
    if update.rows_affected() != 1 {
        return Err(sqlx::Error::RowNotFound);
    }
    Ok(())
}
