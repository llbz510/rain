use serde::Deserialize;
use sqlx::{Acquire, SqliteConnection};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceAssignment {
    pub id: String,
    pub node_id: String,
    pub sort_order: i64,
}

pub async fn assign_asr_sentences_to_nodes_on_connection(
    connection: &mut SqliteConnection,
    video_id: &str,
    assignments: &[SentenceAssignment],
) -> Result<(), sqlx::Error> {
    let mut transaction = connection.begin().await?;
    for assignment in assignments {
        let update = sqlx::query(
            "UPDATE sentence SET node_id = ?, sort_order = ? WHERE id = ? AND EXISTS (SELECT 1 FROM node AS target_node WHERE target_node.id = ? AND target_node.video_id = ?) AND (sentence.node_id = ? OR EXISTS (SELECT 1 FROM node AS current_node WHERE current_node.id = sentence.node_id AND current_node.video_id = ?))",
        )
        .bind(&assignment.node_id)
        .bind(assignment.sort_order)
        .bind(&assignment.id)
        .bind(&assignment.node_id)
        .bind(video_id)
        .bind(video_id)
        .bind(video_id)
        .execute(&mut *transaction)
        .await;

        let update = match update {
            Ok(update) => update,
            Err(error) => {
                transaction.rollback().await?;
                return Err(error);
            }
        };
        if update.rows_affected() != 1 {
            transaction.rollback().await?;
            return Err(sqlx::Error::RowNotFound);
        }
    }
    transaction.commit().await
}
#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Connection, Row, SqliteConnection};

    #[tokio::test]
    async fn rolls_back_sentence_assignments_when_second_update_fails() {
        let mut connection = SqliteConnection::connect(":memory:").await.unwrap();
        sqlx::query("CREATE TABLE node (id TEXT PRIMARY KEY, video_id TEXT NOT NULL)")
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE sentence (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, sort_order INTEGER)")
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO node (id, video_id) VALUES ('para-v1', 'v1')")
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO sentence (id, node_id, sort_order) VALUES ('s1', 'v1', 0), ('s2', 'v1', 1)")
            .execute(&mut connection)
            .await
            .unwrap();

        let assignments = vec![
            SentenceAssignment {
                id: "s1".into(),
                node_id: "para-v1".into(),
                sort_order: 10,
            },
            SentenceAssignment {
                id: "s2".into(),
                node_id: "missing-node".into(),
                sort_order: 20,
            },
        ];
        assert!(
            assign_asr_sentences_to_nodes_on_connection(&mut connection, "v1", &assignments,)
                .await
                .is_err()
        );

        let rows = sqlx::query("SELECT id, node_id, sort_order FROM sentence ORDER BY id")
            .fetch_all(&mut connection)
            .await
            .unwrap();
        assert_eq!(rows[0].get::<String, _>("node_id"), "v1");
        assert_eq!(rows[0].get::<i64, _>("sort_order"), 0);
        assert_eq!(rows[1].get::<String, _>("node_id"), "v1");
        assert_eq!(rows[1].get::<i64, _>("sort_order"), 1);
    }
}
