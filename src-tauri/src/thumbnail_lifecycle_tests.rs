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

#[cfg(windows)]
mod occupying_handle {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    type Handle = *mut c_void;

    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
    const GENERIC_READ: u32 = 0x8000_0000;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const OPEN_EXISTING: u32 = 3;

    #[link(name = "Kernel32")]
    extern "system" {
        fn CreateFileW(
            file_name: *const u16,
            desired_access: u32,
            share_mode: u32,
            security_attributes: *const c_void,
            creation_disposition: u32,
            flags_and_attributes: u32,
            template_file: Handle,
        ) -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
    }

    /// Holds a real handle on the app-owned thumbnail while deliberately
    /// withholding `FILE_SHARE_DELETE`, so the production deletion attempt
    /// fails with a genuine Windows sharing violation instead of succeeding.
    /// This is a real access failure, not a simulated one.
    pub(super) struct OccupyingHandle(Handle);

    impl OccupyingHandle {
        pub(super) fn open(path: &Path) -> Self {
            let wide_path: Vec<u16> = path
                .as_os_str()
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let handle = unsafe {
                CreateFileW(
                    wide_path.as_ptr(),
                    GENERIC_READ,
                    FILE_SHARE_READ,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    0,
                    std::ptr::null_mut(),
                )
            };
            assert_ne!(
                handle,
                INVALID_HANDLE_VALUE,
                "open occupying handle: {}",
                std::io::Error::last_os_error()
            );
            Self(handle)
        }
    }

    impl Drop for OccupyingHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
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

// Covers `thumbnail_lifecycle.rs:242-244`: the app-data root itself is absent,
// so `std::fs::canonicalize` returns NotFound and the seam commits the database
// delete without any filesystem side effect. The far more common
// "app-data/thumbnails exists, <videoId>.jpg is absent" variant is a separate
// Judge below; the two must not be conflated.
#[tokio::test]
async fn accepts_a_missing_app_data_root_after_deleting_the_videos_rows() {
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
async fn accepts_a_missing_owned_thumbnail_when_the_controlled_directory_exists() {
    let test_root = std::env::temp_dir().join(format!(
        "rain-thumbnail-lifecycle-missing-file-{}",
        uuid::Uuid::new_v4()
    ));
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    let thumbnail = thumbnail_directory.join("video-1.jpg");
    let unrelated_entry = thumbnail_directory.join("unrelated.txt");
    std::fs::create_dir_all(&thumbnail_directory).unwrap();
    std::fs::write(&unrelated_entry, b"unrelated-bytes").unwrap();
    let mut connection = lifecycle_database().await;
    seed_video(&mut connection, "video-1").await;

    for attempt in 0..2 {
        thumbnail_lifecycle::delete_video_and_thumbnail_on_connection(
            &mut connection,
            Path::new(&app_data),
            "video-1",
        )
        .await
        .unwrap_or_else(|error| panic!("attempt {attempt} on a missing owned thumbnail: {error}"));
        assert_eq!(
            table_count(&mut connection, "video").await,
            0,
            "attempt {attempt}"
        );
    }

    assert!(!thumbnail.exists());
    assert!(thumbnail_directory.is_dir());
    assert_eq!(std::fs::read(&unrelated_entry).unwrap(), b"unrelated-bytes");
    let mut entries: Vec<String> = std::fs::read_dir(&thumbnail_directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    entries.sort();
    assert_eq!(
        entries,
        vec!["unrelated.txt".to_string()],
        "a missing owned thumbnail must not create, rename or remove directory entries"
    );

    std::fs::remove_dir_all(&test_root).unwrap();
}

// Covers `thumbnail_lifecycle.rs:27-29`: when the existing SQLite cascade fails,
// the seam must return before any filesystem side effect. The trigger reproduces
// the same real late-failure shape used by `video_deletion::tests`.
#[tokio::test]
async fn keeps_the_owned_thumbnail_and_source_when_the_database_delete_aborts() {
    let test_root = std::env::temp_dir().join(format!(
        "rain-thumbnail-lifecycle-database-abort-{}",
        uuid::Uuid::new_v4()
    ));
    let app_data = test_root.join("app-data");
    let thumbnail = app_data.join("thumbnails").join("video-1.jpg");
    let source_video = test_root.join("source-video.mp4");
    std::fs::create_dir_all(thumbnail.parent().unwrap()).unwrap();
    std::fs::write(&thumbnail, b"app-owned-thumbnail").unwrap();
    std::fs::write(&source_video, b"source-video-bytes").unwrap();
    let mut connection = lifecycle_database().await;
    seed_video(&mut connection, "video-1").await;
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

    let result = thumbnail_lifecycle::delete_video_and_thumbnail_on_connection(
        &mut connection,
        Path::new(&app_data),
        "video-1",
    )
    .await;

    assert!(result.is_err());
    for (table, expected) in [
        ("video", 1),
        ("node", 1),
        ("sentence", 1),
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
    assert_eq!(
        std::fs::read(&thumbnail).unwrap(),
        b"app-owned-thumbnail",
        "a failed database cascade must not touch the app-owned thumbnail"
    );
    assert_eq!(std::fs::read(&source_video).unwrap(), b"source-video-bytes");

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn reports_a_visible_error_when_the_owned_thumbnail_cannot_be_opened_for_deletion() {
    let test_root = std::env::temp_dir().join(format!(
        "rain-thumbnail-lifecycle-access-denied-{}",
        uuid::Uuid::new_v4()
    ));
    let app_data = test_root.join("app-data");
    let thumbnail = app_data.join("thumbnails").join("video-1.jpg");
    let source_video = test_root.join("source-video.mp4");
    std::fs::create_dir_all(thumbnail.parent().unwrap()).unwrap();
    std::fs::write(&thumbnail, b"app-owned-thumbnail").unwrap();
    std::fs::write(&source_video, b"source-video-bytes").unwrap();
    let mut connection = lifecycle_database().await;
    seed_video(&mut connection, "video-1").await;

    let occupying = occupying_handle::OccupyingHandle::open(&thumbnail);
    assert!(thumbnail.is_file());

    let first_result = thumbnail_lifecycle::delete_video_and_thumbnail_on_connection(
        &mut connection,
        Path::new(&app_data),
        "video-1",
    )
    .await;

    let error = first_result.expect_err("a real access failure must not be reported as success");
    assert!(
        error.to_string().contains("app-owned thumbnail"),
        "the diagnostic must attribute the failure: {error}"
    );
    assert_eq!(table_count(&mut connection, "video").await, 0);
    assert_eq!(
        std::fs::read(&thumbnail).unwrap(),
        b"app-owned-thumbnail",
        "a failed deletion must leave the thumbnail intact, never truncated or renamed"
    );
    assert_eq!(
        table_count(&mut connection, "note").await,
        0,
        "the committed cascade must stay committed, not partially reverted"
    );
    assert_eq!(std::fs::read(&source_video).unwrap(), b"source-video-bytes");

    drop(occupying);

    thumbnail_lifecycle::delete_video_and_thumbnail_on_connection(
        &mut connection,
        Path::new(&app_data),
        "video-1",
    )
    .await
    .expect("retry after the occupying handle is released deletes the owned thumbnail");

    assert!(!thumbnail.exists());
    assert_eq!(table_count(&mut connection, "video").await, 0);
    assert_eq!(std::fs::read(&source_video).unwrap(), b"source-video-bytes");

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
