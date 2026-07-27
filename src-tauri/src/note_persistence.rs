use serde::{Deserialize, Serialize};
use sqlx::{Acquire, SqliteConnection};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedNote {
    pub id: String,
    pub video_id: String,
    pub content: String,
    pub source: String,
    pub sentence_ids: Vec<String>,
    pub created_at: i64,
    pub sort_order: i64,
}

pub async fn insert_note_atomically_on_connection(
    connection: &mut SqliteConnection,
    note: &PersistedNote,
) -> Result<(), sqlx::Error> {
    let mut transaction = connection.begin().await?;
    let result = async {
        sqlx::query(
            "INSERT INTO note (id, video_id, content, source, created_at, derivation_id, sort_order) VALUES (?, ?, ?, ?, ?, NULL, ?)",
        )
        .bind(&note.id)
        .bind(&note.video_id)
        .bind(&note.content)
        .bind(&note.source)
        .bind(note.created_at)
        .bind(note.sort_order)
        .execute(&mut *transaction)
        .await?;

        for sentence_id in &note.sentence_ids {
            sqlx::query("INSERT INTO note_sentence (note_id, sentence_id) VALUES (?, ?)")
                .bind(&note.id)
                .bind(sentence_id)
                .execute(&mut *transaction)
                .await?;
        }
        Ok::<(), sqlx::Error>(())
    }
    .await;

    match result {
        Ok(()) => transaction.commit().await,
        Err(error) => {
            transaction.rollback().await?;
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Connection, Row, SqliteConnection};

    async fn note_database() -> SqliteConnection {
        let mut connection = SqliteConnection::connect(":memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE note (
                id TEXT PRIMARY KEY,
                video_id TEXT NOT NULL,
                content TEXT,
                source TEXT,
                created_at INTEGER,
                derivation_id TEXT,
                sort_order INTEGER
            )",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        sqlx::query(
            "CREATE TABLE note_sentence (
                note_id TEXT NOT NULL,
                sentence_id TEXT NOT NULL,
                PRIMARY KEY (note_id, sentence_id)
            )",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        connection
    }

    fn note(sentence_ids: Vec<&str>) -> PersistedNote {
        PersistedNote {
            id: "note-1".into(),
            video_id: "video-1".into(),
            content: "Signal.".into(),
            source: "excerpt".into(),
            sentence_ids: sentence_ids.into_iter().map(String::from).collect(),
            created_at: 10,
            sort_order: 0,
        }
    }

    #[tokio::test]
    async fn persists_the_note_and_all_sentence_references() {
        let mut connection = note_database().await;

        insert_note_atomically_on_connection(
            &mut connection,
            &note(vec!["sentence-1", "sentence-2"]),
        )
        .await
        .unwrap();

        let saved_note = sqlx::query(
            "SELECT video_id, content, source, created_at, sort_order FROM note WHERE id = 'note-1'",
        )
        .fetch_one(&mut connection)
        .await
        .unwrap();
        let references = sqlx::query(
            "SELECT sentence_id FROM note_sentence WHERE note_id = 'note-1' ORDER BY sentence_id",
        )
        .fetch_all(&mut connection)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.get::<String, _>("sentence_id"))
        .collect::<Vec<_>>();
        assert_eq!(saved_note.get::<String, _>("video_id"), "video-1");
        assert_eq!(saved_note.get::<String, _>("content"), "Signal.");
        assert_eq!(saved_note.get::<String, _>("source"), "excerpt");
        assert_eq!(saved_note.get::<i64, _>("created_at"), 10);
        assert_eq!(saved_note.get::<i64, _>("sort_order"), 0);
        assert_eq!(references, vec!["sentence-1", "sentence-2"]);
    }

    #[tokio::test]
    async fn rolls_back_the_note_when_a_reference_insert_fails() {
        let mut connection = note_database().await;

        let result = insert_note_atomically_on_connection(
            &mut connection,
            &note(vec!["sentence-1", "sentence-1"]),
        )
        .await;

        assert!(result.is_err());
        let note_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM note")
            .fetch_one(&mut connection)
            .await
            .unwrap()
            .get("count");
        let reference_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM note_sentence")
            .fetch_one(&mut connection)
            .await
            .unwrap()
            .get("count");
        assert_eq!(note_count, 0);
        assert_eq!(reference_count, 0);
    }
}
