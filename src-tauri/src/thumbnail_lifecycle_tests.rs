use crate::thumbnail_lifecycle;
use sqlx::{Connection, SqliteConnection};
use std::path::Path;

#[cfg(windows)]
fn create_directory_junction(link: &Path, target: &Path) {
    let output = std::process::Command::new("cmd")
        .arg("/c")
        .arg("mklink")
        .arg("/J")
        .arg(link)
        .arg(target)
        .output()
        .expect("run Windows junction command");
    assert!(
        output.status.success(),
        "create junction failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

async fn lifecycle_database() -> SqliteConnection {
    let mut connection = SqliteConnection::connect(":memory:").await.unwrap();
    for statement in [
        "CREATE TABLE video (id TEXT PRIMARY KEY)",
        "CREATE TABLE node (id TEXT PRIMARY KEY, video_id TEXT NOT NULL)",
        "CREATE TABLE sentence (id TEXT PRIMARY KEY, node_id TEXT NOT NULL)",
        "CREATE TABLE note (id TEXT PRIMARY KEY, video_id TEXT NOT NULL)",
        "CREATE TABLE note_sentence (note_id TEXT NOT NULL, sentence_id TEXT NOT NULL, PRIMARY KEY (note_id, sentence_id))",
        "CREATE TABLE import_checkpoint (video_id TEXT PRIMARY KEY)",
    ] {
        sqlx::query(statement).execute(&mut connection).await.unwrap();
    }
    connection
}

async fn seed_video(connection: &mut SqliteConnection, video_id: &str) {
    sqlx::query("INSERT INTO video (id) VALUES (?)")
        .bind(video_id)
        .execute(&mut *connection)
        .await
        .unwrap();
    sqlx::query("INSERT INTO node (id, video_id) VALUES ('node-1', ?)")
        .bind(video_id)
        .execute(&mut *connection)
        .await
        .unwrap();
    sqlx::query("INSERT INTO sentence (id, node_id) VALUES ('sentence-1', 'node-1')")
        .execute(&mut *connection)
        .await
        .unwrap();
    sqlx::query("INSERT INTO note (id, video_id) VALUES ('note-1', ?)")
        .bind(video_id)
        .execute(&mut *connection)
        .await
        .unwrap();
    sqlx::query("INSERT INTO note_sentence (note_id, sentence_id) VALUES ('note-1', 'sentence-1')")
        .execute(&mut *connection)
        .await
        .unwrap();
    sqlx::query("INSERT INTO import_checkpoint (video_id) VALUES (?)")
        .bind(video_id)
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
async fn deletes_a_committed_videos_owned_thumbnail_without_touching_source_or_arbitrary_files() {
    let test_root = std::env::temp_dir().join(format!(
        "rain-thumbnail-lifecycle-success-{}",
        uuid::Uuid::new_v4()
    ));
    let app_data = test_root.join("app-data");
    let thumbnail = app_data.join("thumbnails").join("video-1.jpg");
    let source_video = test_root.join("source-video.mp4");
    let arbitrary_file = test_root.join("user-selected-thumbnail.jpg");
    std::fs::create_dir_all(thumbnail.parent().unwrap()).unwrap();
    std::fs::write(&thumbnail, b"app-owned-thumbnail").unwrap();
    std::fs::write(&source_video, b"source-video-bytes").unwrap();
    std::fs::write(&arbitrary_file, b"arbitrary-thumbnail-bytes").unwrap();
    let mut connection = lifecycle_database().await;
    seed_video(&mut connection, "video-1").await;

    thumbnail_lifecycle::delete_video_and_thumbnail_on_connection(
        &mut connection,
        Path::new(&app_data),
        "video-1",
    )
    .await
    .expect("delete committed Video and its owned thumbnail");

    for table in [
        "video",
        "node",
        "sentence",
        "note",
        "note_sentence",
        "import_checkpoint",
    ] {
        assert_eq!(table_count(&mut connection, table).await, 0, "{table}");
    }
    assert!(!thumbnail.exists());
    assert_eq!(std::fs::read(&source_video).unwrap(), b"source-video-bytes");
    assert_eq!(
        std::fs::read(&arbitrary_file).unwrap(),
        b"arbitrary-thumbnail-bytes"
    );

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[tokio::test]
async fn rejects_path_like_video_ids_before_deleting_rows_or_files() {
    let test_root = std::env::temp_dir().join(format!(
        "rain-thumbnail-lifecycle-invalid-id-{}",
        uuid::Uuid::new_v4()
    ));
    let app_data = test_root.join("app-data");
    let arbitrary_file = test_root.join("user-selected-thumbnail.jpg");
    std::fs::create_dir_all(&app_data).unwrap();
    std::fs::write(&arbitrary_file, b"arbitrary-thumbnail-bytes").unwrap();
    let mut connection = lifecycle_database().await;
    seed_video(&mut connection, "../video-1").await;

    let result = thumbnail_lifecycle::delete_video_and_thumbnail_on_connection(
        &mut connection,
        Path::new(&app_data),
        "../video-1",
    )
    .await;

    assert!(result.is_err());
    assert_eq!(table_count(&mut connection, "video").await, 1);
    assert_eq!(table_count(&mut connection, "node").await, 1);
    assert_eq!(
        std::fs::read(&arbitrary_file).unwrap(),
        b"arbitrary-thumbnail-bytes"
    );

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[tokio::test]
async fn accepts_a_missing_owned_thumbnail_after_deleting_the_videos_rows() {
    let test_root = std::env::temp_dir().join(format!(
        "rain-thumbnail-lifecycle-missing-thumbnail-{}",
        uuid::Uuid::new_v4()
    ));
    let app_data = test_root.join("app-data");
    std::fs::create_dir_all(&test_root).unwrap();
    let mut connection = lifecycle_database().await;
    seed_video(&mut connection, "video-1").await;

    thumbnail_lifecycle::delete_video_and_thumbnail_on_connection(
        &mut connection,
        Path::new(&app_data),
        "video-1",
    )
    .await
    .expect("a missing app-owned thumbnail is idempotent");

    assert_eq!(table_count(&mut connection, "video").await, 0);
    assert!(!app_data.exists());

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[tokio::test]
async fn returns_a_real_thumbnail_deletion_failure_then_retries_after_the_video_is_absent() {
    let test_root = std::env::temp_dir().join(format!(
        "rain-thumbnail-lifecycle-retry-{}",
        uuid::Uuid::new_v4()
    ));
    let app_data = test_root.join("app-data");
    let thumbnail = app_data.join("thumbnails").join("video-1.jpg");
    let source_video = test_root.join("source-video.mp4");
    let arbitrary_file = test_root.join("user-selected-thumbnail.jpg");
    std::fs::create_dir_all(&thumbnail).unwrap();
    std::fs::write(&source_video, b"source-video-bytes").unwrap();
    std::fs::write(&arbitrary_file, b"arbitrary-thumbnail-bytes").unwrap();
    let mut connection = lifecycle_database().await;
    seed_video(&mut connection, "video-1").await;

    let first_result = thumbnail_lifecycle::delete_video_and_thumbnail_on_connection(
        &mut connection,
        Path::new(&app_data),
        "video-1",
    )
    .await;

    assert!(first_result.is_err());
    assert_eq!(table_count(&mut connection, "video").await, 0);
    assert!(thumbnail.is_dir());
    assert_eq!(std::fs::read(&source_video).unwrap(), b"source-video-bytes");
    assert_eq!(
        std::fs::read(&arbitrary_file).unwrap(),
        b"arbitrary-thumbnail-bytes"
    );

    std::fs::remove_dir(&thumbnail).unwrap();
    std::fs::write(&thumbnail, b"app-owned-thumbnail").unwrap();
    thumbnail_lifecycle::delete_video_and_thumbnail_on_connection(
        &mut connection,
        Path::new(&app_data),
        "video-1",
    )
    .await
    .expect("retry deletes the repaired owned thumbnail after the Video row is absent");

    assert!(!thumbnail.exists());
    assert_eq!(std::fs::read(&source_video).unwrap(), b"source-video-bytes");
    assert_eq!(
        std::fs::read(&arbitrary_file).unwrap(),
        b"arbitrary-thumbnail-bytes"
    );

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn rejects_a_thumbnail_directory_junction_before_it_can_delete_an_external_file() {
    let test_root = std::env::temp_dir().join(format!(
        "rain-thumbnail-lifecycle-junction-{}",
        uuid::Uuid::new_v4()
    ));
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    let external_directory = test_root.join("external");
    let external_thumbnail = external_directory.join("video-1.jpg");
    let source_video = test_root.join("source-video.mp4");
    std::fs::create_dir_all(&app_data).unwrap();
    std::fs::create_dir_all(&external_directory).unwrap();
    std::fs::write(&external_thumbnail, b"external-thumbnail-bytes").unwrap();
    std::fs::write(&source_video, b"source-video-bytes").unwrap();
    create_directory_junction(&thumbnail_directory, &external_directory);
    let mut connection = lifecycle_database().await;
    seed_video(&mut connection, "video-1").await;

    let result = thumbnail_lifecycle::delete_video_and_thumbnail_on_connection(
        &mut connection,
        Path::new(&app_data),
        "video-1",
    )
    .await;

    assert!(result.is_err());
    assert_eq!(table_count(&mut connection, "video").await, 0);
    assert_eq!(
        std::fs::read(&external_thumbnail).unwrap(),
        b"external-thumbnail-bytes"
    );
    assert_eq!(std::fs::read(&source_video).unwrap(), b"source-video-bytes");

    std::fs::remove_dir(&thumbnail_directory).unwrap();
    std::fs::remove_dir_all(&test_root).unwrap();
}
