use serde::Deserialize;
use sqlx::{Acquire, SqliteConnection};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSentence {
    pub id: String,
    pub node_id: String,
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
    pub sort_order: i64,
}

pub async fn save_asr_atomically_on_connection(
    connection: &mut SqliteConnection,
    video_id: &str,
    language: &str,
    sentences: &[PersistedSentence],
) -> Result<(), sqlx::Error> {
    let mut transaction = connection.begin().await?;
    for sentence in sentences {
        sqlx::query("INSERT INTO sentence (id, node_id, text, start_time, end_time, sort_order) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(&sentence.id)
            .bind(&sentence.node_id)
            .bind(&sentence.text)
            .bind(sentence.start_time)
            .bind(sentence.end_time)
            .bind(sentence.sort_order)
            .execute(&mut *transaction)
            .await?;
    }
    let update = sqlx::query("UPDATE video SET language = ?, status = ?, stage = ? WHERE id = ?")
        .bind(language)
        .bind("processing")
        .bind("stage2")
        .bind(video_id)
        .execute(&mut *transaction)
        .await?;
    if update.rows_affected() != 1 {
        return Err(sqlx::Error::RowNotFound);
    }
    transaction.commit().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Connection, Row, SqliteConnection};

    #[tokio::test]
    async fn rolls_back_rows_and_video_when_second_insert_fails() {
        let mut connection = SqliteConnection::connect(":memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE video (id TEXT PRIMARY KEY, language TEXT, status TEXT, stage TEXT)",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        sqlx::query("CREATE TABLE sentence (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, text TEXT NOT NULL, start_time REAL, end_time REAL, sort_order INTEGER)").execute(&mut connection).await.unwrap();
        sqlx::query(
            "INSERT INTO video (id, language, status, stage) VALUES ('v1', 'en', 'failed', 'asr')",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        let rows = vec![
            PersistedSentence {
                id: "new".into(),
                node_id: "v1".into(),
                text: "first".into(),
                start_time: 0.0,
                end_time: 1.0,
                sort_order: 0,
            },
            PersistedSentence {
                id: "new".into(),
                node_id: "v1".into(),
                text: "second".into(),
                start_time: 1.0,
                end_time: 2.0,
                sort_order: 1,
            },
        ];
        assert!(
            save_asr_atomically_on_connection(&mut connection, "v1", "zh", &rows)
                .await
                .is_err()
        );
        let sentence_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM sentence")
            .fetch_one(&mut connection)
            .await
            .unwrap()
            .get("count");
        let video = sqlx::query("SELECT language, status, stage FROM video WHERE id = 'v1'")
            .fetch_one(&mut connection)
            .await
            .unwrap();
        assert_eq!(sentence_count, 0);
        assert_eq!(video.get::<String, _>("language"), "en");
        assert_eq!(video.get::<String, _>("status"), "failed");
        assert_eq!(video.get::<String, _>("stage"), "asr");
    }
}
