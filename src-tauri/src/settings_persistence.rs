use serde::{Deserialize, Serialize};
use sqlx::{Acquire, SqliteConnection};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum SettingMutation {
    Set { key: String, value: String },
    Delete { key: String },
}

pub async fn apply_settings_atomically_on_connection(
    connection: &mut SqliteConnection,
    mutations: &[SettingMutation],
) -> Result<(), sqlx::Error> {
    let mut transaction = connection.begin().await?;
    let result = async {
        for mutation in mutations {
            match mutation {
                SettingMutation::Set { key, value } => {
                    sqlx::query(
                        "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    )
                    .bind(key)
                    .bind(value)
                    .execute(&mut *transaction)
                    .await?;
                }
                SettingMutation::Delete { key } => {
                    sqlx::query("DELETE FROM setting WHERE key = ?")
                        .bind(key)
                        .execute(&mut *transaction)
                        .await?;
                }
            }
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
    use sqlx::{Connection, SqliteConnection};

    async fn settings_database() -> SqliteConnection {
        let mut connection = SqliteConnection::connect(":memory:").await.unwrap();
        sqlx::query("CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&mut connection)
            .await
            .unwrap();
        connection
    }

    async fn value(connection: &mut SqliteConnection, key: &str) -> Option<String> {
        sqlx::query_scalar("SELECT value FROM setting WHERE key = ?")
            .bind(key)
            .fetch_optional(connection)
            .await
            .unwrap()
    }

    async fn seed(connection: &mut SqliteConnection, key: &str, value: &str) {
        sqlx::query("INSERT INTO setting (key, value) VALUES (?, ?)")
            .bind(key)
            .bind(value)
            .execute(connection)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn applies_the_complete_batch_and_preserves_unrelated_settings() {
        let mut connection = settings_database().await;
        seed(&mut connection, "model_pool", "old-models").await;
        seed(&mut connection, "api_key.removed", "old-key").await;
        seed(&mut connection, "unrelated", "keep").await;

        apply_settings_atomically_on_connection(
            &mut connection,
            &[
                SettingMutation::Set {
                    key: "model_pool".into(),
                    value: "new-models".into(),
                },
                SettingMutation::Set {
                    key: "role_assistant".into(),
                    value: "model-1".into(),
                },
                SettingMutation::Delete {
                    key: "api_key.removed".into(),
                },
            ],
        )
        .await
        .unwrap();

        assert_eq!(
            value(&mut connection, "model_pool").await.as_deref(),
            Some("new-models")
        );
        assert_eq!(
            value(&mut connection, "role_assistant").await.as_deref(),
            Some("model-1")
        );
        assert_eq!(value(&mut connection, "api_key.removed").await, None);
        assert_eq!(
            value(&mut connection, "unrelated").await.as_deref(),
            Some("keep")
        );
    }

    #[tokio::test]
    async fn rolls_back_the_complete_batch_when_the_final_mutation_fails() {
        let mut connection = settings_database().await;
        seed(&mut connection, "model_pool", "old-models").await;
        seed(&mut connection, "blocked", "keep").await;
        seed(&mut connection, "unrelated", "keep").await;
        sqlx::query(
            "CREATE TRIGGER block_setting_delete
             BEFORE DELETE ON setting
             WHEN OLD.key = 'blocked'
             BEGIN
               SELECT RAISE(ABORT, 'delete blocked');
             END",
        )
        .execute(&mut connection)
        .await
        .unwrap();

        let result = apply_settings_atomically_on_connection(
            &mut connection,
            &[
                SettingMutation::Set {
                    key: "model_pool".into(),
                    value: "new-models".into(),
                },
                SettingMutation::Set {
                    key: "role_assistant".into(),
                    value: "model-1".into(),
                },
                SettingMutation::Delete {
                    key: "blocked".into(),
                },
            ],
        )
        .await;

        assert!(result.is_err());
        assert_eq!(
            value(&mut connection, "model_pool").await.as_deref(),
            Some("old-models")
        );
        assert_eq!(value(&mut connection, "role_assistant").await, None);
        assert_eq!(
            value(&mut connection, "blocked").await.as_deref(),
            Some("keep")
        );
        assert_eq!(
            value(&mut connection, "unrelated").await.as_deref(),
            Some("keep")
        );
    }
}
