use serde::Deserialize;
use sqlx::{Acquire, SqliteConnection};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentenceAssignment {
    pub id: String,
    pub node_id: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedNode {
    pub id: String,
    pub video_id: String,
    pub parent_id: Option<String>,
    pub kind: String,
    pub title: String,
    #[serde(rename = "type")]
    pub node_type: Option<String>,
    pub start_time: f64,
    pub end_time: f64,
    pub text: Option<String>,
    pub translation: Option<String>,
    pub sort_order: i64,
}

async fn apply_assignment(
    connection: &mut SqliteConnection,
    video_id: &str,
    assignment: &SentenceAssignment,
) -> Result<(), sqlx::Error> {
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
    .execute(connection)
    .await?;
    if update.rows_affected() != 1 {
        return Err(sqlx::Error::RowNotFound);
    }
    Ok(())
}

pub async fn assign_asr_sentences_to_nodes_on_connection(
    connection: &mut SqliteConnection,
    video_id: &str,
    assignments: &[SentenceAssignment],
) -> Result<(), sqlx::Error> {
    let mut transaction = connection.begin().await?;
    for assignment in assignments {
        if let Err(error) = apply_assignment(&mut transaction, video_id, assignment).await {
            transaction.rollback().await?;
            return Err(error);
        }
    }
    transaction.commit().await
}

pub async fn merge_import_on_connection(
    connection: &mut SqliteConnection,
    video_id: &str,
    nodes: &[PersistedNode],
    assignments: &[SentenceAssignment],
) -> Result<(), sqlx::Error> {
    let mut transaction = connection.begin().await?;
    for node in nodes {
        if node.video_id != video_id {
            transaction.rollback().await?;
            return Err(sqlx::Error::RowNotFound);
        }
        let insert = sqlx::query("INSERT INTO node (id, video_id, parent_id, kind, title, type, start_time, end_time, text, translation, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&node.id)
            .bind(&node.video_id)
            .bind(&node.parent_id)
            .bind(&node.kind)
            .bind(&node.title)
            .bind(&node.node_type)
            .bind(node.start_time)
            .bind(node.end_time)
            .bind(&node.text)
            .bind(&node.translation)
            .bind(node.sort_order)
            .execute(&mut *transaction)
            .await;
        if let Err(error) = insert {
            transaction.rollback().await?;
            return Err(error);
        }
    }
    for assignment in assignments {
        if let Err(error) = apply_assignment(&mut transaction, video_id, assignment).await {
            transaction.rollback().await?;
            return Err(error);
        }
    }
    let ready = sqlx::query("UPDATE video SET status = 'ready', stage = NULL, error_message = NULL WHERE id = ? AND status = 'processing' AND stage = 'merging'")
        .bind(video_id)
        .execute(&mut *transaction)
        .await;
    let ready = match ready {
        Ok(ready) => ready,
        Err(error) => {
            transaction.rollback().await?;
            return Err(error);
        }
    };
    if ready.rows_affected() != 1 {
        transaction.rollback().await?;
        return Err(sqlx::Error::RowNotFound);
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

    #[tokio::test]
    async fn atomic_merge_rolls_back_nodes_and_assignments_on_late_failure() {
        let mut connection = SqliteConnection::connect(":memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE video (id TEXT PRIMARY KEY, status TEXT, stage TEXT, error_message TEXT)",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        sqlx::query("CREATE TABLE node (id TEXT PRIMARY KEY, video_id TEXT NOT NULL, parent_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, type TEXT, start_time REAL, end_time REAL, text TEXT, translation TEXT, sort_order INTEGER)")
            .execute(&mut connection).await.unwrap();
        sqlx::query("CREATE TABLE sentence (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, sort_order INTEGER)")
            .execute(&mut connection).await.unwrap();
        sqlx::query("INSERT INTO video (id, status, stage) VALUES ('v1', 'processing', 'merging')")
            .execute(&mut connection)
            .await
            .unwrap();
        sqlx::query("INSERT INTO sentence (id, node_id, sort_order) VALUES ('s1', 'v1', 0), ('s2', 'v1', 1)")
            .execute(&mut connection).await.unwrap();
        let nodes = vec![PersistedNode {
            id: "new-paragraph".into(),
            video_id: "v1".into(),
            parent_id: None,
            kind: "paragraph".into(),
            title: "New".into(),
            node_type: Some("concept".into()),
            start_time: 0.0,
            end_time: 2.0,
            text: None,
            translation: None,
            sort_order: 0,
        }];
        let assignments = vec![
            SentenceAssignment {
                id: "s1".into(),
                node_id: "new-paragraph".into(),
                sort_order: 10,
            },
            SentenceAssignment {
                id: "s2".into(),
                node_id: "missing-node".into(),
                sort_order: 20,
            },
        ];

        assert!(
            merge_import_on_connection(&mut connection, "v1", &nodes, &assignments)
                .await
                .is_err()
        );
        let node_count: i64 = sqlx::query("SELECT COUNT(*) AS count FROM node")
            .fetch_one(&mut connection)
            .await
            .unwrap()
            .get("count");
        let rows = sqlx::query("SELECT id, node_id, sort_order FROM sentence ORDER BY id")
            .fetch_all(&mut connection)
            .await
            .unwrap();
        let video = sqlx::query("SELECT status, stage FROM video WHERE id = 'v1'")
            .fetch_one(&mut connection)
            .await
            .unwrap();
        assert_eq!(node_count, 0);
        assert_eq!(rows[0].get::<String, _>("node_id"), "v1");
        assert_eq!(rows[0].get::<i64, _>("sort_order"), 0);
        assert_eq!(rows[1].get::<String, _>("node_id"), "v1");
        assert_eq!(rows[1].get::<i64, _>("sort_order"), 1);
        assert_eq!(video.get::<String, _>("status"), "processing");
        assert_eq!(video.get::<String, _>("stage"), "merging");
    }

    #[tokio::test]
    async fn persisted_transition_cas_preserves_a_ready_row() {
        use crate::import_state_persistence::{transition_import_state_on_connection, ImportState};
        let mut connection = SqliteConnection::connect(":memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE video (id TEXT PRIMARY KEY, status TEXT, stage TEXT, error_message TEXT)",
        )
        .execute(&mut connection)
        .await
        .unwrap();
        sqlx::query("INSERT INTO video (id, status, stage) VALUES ('v1', 'ready', NULL)")
            .execute(&mut connection)
            .await
            .unwrap();

        assert!(transition_import_state_on_connection(
            &mut connection,
            "v1",
            &ImportState {
                status: "pending".into(),
                stage: None,
                error_message: None
            },
            &ImportState {
                status: "processing".into(),
                stage: Some("asr".into()),
                error_message: None
            },
        )
        .await
        .is_err());
        let row = sqlx::query("SELECT status, stage FROM video WHERE id = 'v1'")
            .fetch_one(&mut connection)
            .await
            .unwrap();
        assert_eq!(row.get::<String, _>("status"), "ready");
        assert_eq!(row.get::<Option<String>, _>("stage"), None);
    }
}
