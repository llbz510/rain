use sqlx::{Acquire, SqliteConnection};

pub async fn delete_video_atomically_on_connection(
    connection: &mut SqliteConnection,
    video_id: &str,
) -> Result<(), sqlx::Error> {
    let mut transaction = connection.begin().await?;
    let result = async {
        sqlx::query(
            "DELETE FROM note_sentence WHERE note_id IN (SELECT id FROM note WHERE video_id = ?)",
        )
        .bind(video_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "DELETE FROM sentence WHERE node_id = ? OR node_id IN (SELECT id FROM node WHERE video_id = ?)",
        )
        .bind(video_id)
        .bind(video_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query("DELETE FROM note WHERE video_id = ?")
            .bind(video_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM node WHERE video_id = ?")
            .bind(video_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM import_checkpoint WHERE video_id = ?")
            .bind(video_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM video WHERE id = ?")
            .bind(video_id)
            .execute(&mut *transaction)
            .await?;
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
    use sqlx::{Connection, SqliteConnection};

    async fn deletion_database() -> SqliteConnection {
        let mut connection = SqliteConnection::connect(":memory:").await.unwrap();
        for statement in [
            "CREATE TABLE video (id TEXT PRIMARY KEY)",
            "CREATE TABLE node (id TEXT PRIMARY KEY, video_id TEXT NOT NULL)",
            "CREATE TABLE sentence (id TEXT PRIMARY KEY, node_id TEXT NOT NULL)",
            "CREATE TABLE note (id TEXT PRIMARY KEY, video_id TEXT NOT NULL)",
            "CREATE TABLE note_sentence (note_id TEXT NOT NULL, sentence_id TEXT NOT NULL, PRIMARY KEY (note_id, sentence_id))",
            "CREATE TABLE import_checkpoint (video_id TEXT PRIMARY KEY)",
        ] {
            sqlx::query(statement)
                .execute(&mut connection)
                .await
                .unwrap();
        }
        connection
    }

    async fn seed_video(connection: &mut SqliteConnection, suffix: &str) {
        let video_id = format!("video-{suffix}");
        let node_id = format!("node-{suffix}");
        let sentence_id = format!("sentence-{suffix}");
        let note_id = format!("note-{suffix}");

        sqlx::query("INSERT INTO video (id) VALUES (?)")
            .bind(&video_id)
            .execute(&mut *connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO node (id, video_id) VALUES (?, ?)")
            .bind(&node_id)
            .bind(&video_id)
            .execute(&mut *connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO sentence (id, node_id) VALUES (?, ?)")
            .bind(&sentence_id)
            .bind(&node_id)
            .execute(&mut *connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO note (id, video_id) VALUES (?, ?)")
            .bind(&note_id)
            .bind(&video_id)
            .execute(&mut *connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO note_sentence (note_id, sentence_id) VALUES (?, ?)")
            .bind(&note_id)
            .bind(&sentence_id)
            .execute(&mut *connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO import_checkpoint (video_id) VALUES (?)")
            .bind(&video_id)
            .execute(&mut *connection)
            .await
            .unwrap();
    }

    async fn table_count(connection: &mut SqliteConnection, table: &str) -> i64 {
        let query = format!("SELECT COUNT(*) FROM {table}");
        sqlx::query_scalar(&query)
            .fetch_one(connection)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn deletes_all_owned_rows_and_preserves_another_video() {
        let mut connection = deletion_database().await;
        seed_video(&mut connection, "1").await;
        seed_video(&mut connection, "2").await;
        sqlx::query("INSERT INTO sentence (id, node_id) VALUES ('placeholder-1', 'video-1')")
            .execute(&mut connection)
            .await
            .unwrap();

        delete_video_atomically_on_connection(&mut connection, "video-1")
            .await
            .unwrap();

        for table in [
            "video",
            "node",
            "sentence",
            "note",
            "note_sentence",
            "import_checkpoint",
        ] {
            assert_eq!(table_count(&mut connection, table).await, 1, "{table}");
        }
        let remaining_video: String = sqlx::query_scalar("SELECT id FROM video")
            .fetch_one(&mut connection)
            .await
            .unwrap();
        assert_eq!(remaining_video, "video-2");
    }

    #[tokio::test]
    async fn rolls_back_every_table_when_the_final_delete_fails() {
        let mut connection = deletion_database().await;
        seed_video(&mut connection, "1").await;
        sqlx::query("INSERT INTO sentence (id, node_id) VALUES ('placeholder-1', 'video-1')")
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query(
            "CREATE TRIGGER block_video_delete
             BEFORE DELETE ON video
             WHEN OLD.id = 'video-1'
             BEGIN
               SELECT RAISE(ABORT, 'delete blocked');
             END",
        )
        .execute(&mut connection)
        .await
        .unwrap();

        let result = delete_video_atomically_on_connection(&mut connection, "video-1").await;

        assert!(result.is_err());
        for (table, expected) in [
            ("video", 1),
            ("node", 1),
            ("sentence", 2),
            ("note", 1),
            ("note_sentence", 1),
            ("import_checkpoint", 1),
        ] {
            assert_eq!(
                table_count(&mut connection, table).await,
                expected,
                "{table}"
            );
        }
    }

    #[tokio::test]
    async fn deleting_a_missing_video_is_idempotent() {
        let mut connection = deletion_database().await;
        seed_video(&mut connection, "1").await;

        delete_video_atomically_on_connection(&mut connection, "missing")
            .await
            .unwrap();

        for table in [
            "video",
            "node",
            "sentence",
            "note",
            "note_sentence",
            "import_checkpoint",
        ] {
            assert_eq!(table_count(&mut connection, table).await, 1, "{table}");
        }
    }
}
