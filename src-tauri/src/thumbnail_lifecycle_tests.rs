use crate::thumbnail_lifecycle;
use sqlx::{Connection, SqliteConnection};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

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

// ---------------------------------------------------------------------------
// AC-VL-06: app-owned orphan thumbnail collection
// ---------------------------------------------------------------------------

fn orphan_policy(
    max_candidates: usize,
    max_failures: usize,
    recent_protection: Duration,
) -> thumbnail_lifecycle::OrphanCollectionPolicy {
    thumbnail_lifecycle::OrphanCollectionPolicy {
        max_candidates,
        max_failures,
        recent_protection,
    }
}

/// Ages a thumbnail on disk so the production protection window no longer
/// covers it. Uses the real file-system timestamp, never a simulated clock.
fn age_thumbnail(path: &Path, age: Duration) {
    let file = std::fs::File::options()
        .write(true)
        .open(path)
        .expect("open thumbnail for aging");
    let aged = SystemTime::now()
        .checked_sub(age)
        .expect("subtract the requested age");
    file.set_modified(aged).expect("age the thumbnail file");
}

fn gc_root(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "rain-thumbnail-gc-{label}-{}",
        uuid::Uuid::new_v4()
    ))
}

async fn collect_orphans(
    connection: &mut SqliteConnection,
    app_data_root: &Path,
    policy: &thumbnail_lifecycle::OrphanCollectionPolicy,
) -> thumbnail_lifecycle::OrphanCollectionResult {
    thumbnail_lifecycle::collect_orphan_thumbnails_on_connection(connection, app_data_root, policy)
        .await
}

#[test]
fn protection_window_covers_fresh_and_future_timestamps_only() {
    let now = SystemTime::now();
    let window = Duration::from_secs(600);

    assert!(thumbnail_lifecycle::within_protection_window(
        now - Duration::from_secs(1),
        now,
        window
    ));
    assert!(!thumbnail_lifecycle::within_protection_window(
        now - Duration::from_secs(601),
        now,
        window
    ));
    assert!(!thumbnail_lifecycle::within_protection_window(
        now - window,
        now,
        window
    ));
    // A timestamp ahead of the local clock is retained conservatively.
    assert!(thumbnail_lifecycle::within_protection_window(
        now + Duration::from_secs(5),
        now,
        window
    ));
    // `Duration::ZERO` explicitly means "no protection".
    assert!(!thumbnail_lifecycle::within_protection_window(
        now,
        now,
        Duration::ZERO
    ));
}

#[tokio::test]
async fn collects_only_aged_orphans_inside_the_controlled_directory() {
    let test_root = gc_root("basic");
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    let orphan = thumbnail_directory.join("orphan-1.jpg");
    let kept = thumbnail_directory.join("kept-1.jpg");
    let partial = thumbnail_directory.join(".kept-1.deadbeef.partial.jpg");
    let unrelated = thumbnail_directory.join("readme.txt");
    let source_video = app_data.join("source-video.mp4");
    let model_file = app_data.join("whisper-models").join("ggml-tiny.bin");
    let outside_thumbnail = test_root.join("user-selected-thumbnail.jpg");
    std::fs::create_dir_all(&thumbnail_directory).unwrap();
    std::fs::create_dir_all(model_file.parent().unwrap()).unwrap();
    std::fs::write(&orphan, b"app-owned-thumbnail").unwrap();
    std::fs::write(&kept, b"app-owned-thumbnail").unwrap();
    std::fs::write(&partial, b"app-owned-thumbnail").unwrap();
    std::fs::write(&unrelated, b"app-owned-thumbnail").unwrap();
    std::fs::write(&source_video, b"source-video-bytes").unwrap();
    std::fs::write(&model_file, b"model-bytes").unwrap();
    std::fs::write(&outside_thumbnail, b"user-thumbnail-bytes").unwrap();
    age_thumbnail(&orphan, Duration::from_secs(3600));
    age_thumbnail(&kept, Duration::from_secs(3600));
    let mut connection = lifecycle_database().await;
    seed_video(&mut connection, "kept-1").await;

    let result = collect_orphans(
        &mut connection,
        Path::new(&app_data),
        &thumbnail_lifecycle::ORPHAN_COLLECTION_POLICY,
    )
    .await;

    assert!(
        matches!(
            result,
            thumbnail_lifecycle::OrphanCollectionResult::Completed(_)
        ),
        "expected a completed round: {result:?}"
    );
    let report = result.report().expect("completed round reports a summary");
    assert_eq!(report.deleted, vec!["orphan-1.jpg".to_string()]);
    assert!(!orphan.exists());
    assert_eq!(report.retained_in_keep_set, 1);
    assert!(report.skipped_not_app_owned >= 2, "{report:?}");
    assert!(report.failures.is_empty(), "{report:?}");
    assert_eq!(std::fs::read(&kept).unwrap(), b"app-owned-thumbnail");
    assert_eq!(std::fs::read(&partial).unwrap(), b"app-owned-thumbnail");
    assert_eq!(std::fs::read(&unrelated).unwrap(), b"app-owned-thumbnail");
    assert_eq!(std::fs::read(&source_video).unwrap(), b"source-video-bytes");
    assert_eq!(std::fs::read(&model_file).unwrap(), b"model-bytes");
    assert_eq!(
        std::fs::read(&outside_thumbnail).unwrap(),
        b"user-thumbnail-bytes"
    );

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[tokio::test]
async fn repeated_rounds_are_idempotent() {
    let test_root = gc_root("idempotent");
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    let orphan = thumbnail_directory.join("orphan-1.jpg");
    std::fs::create_dir_all(&thumbnail_directory).unwrap();
    std::fs::write(&orphan, b"app-owned-thumbnail").unwrap();
    age_thumbnail(&orphan, Duration::from_secs(3600));
    let mut connection = lifecycle_database().await;

    let first = collect_orphans(
        &mut connection,
        Path::new(&app_data),
        &thumbnail_lifecycle::ORPHAN_COLLECTION_POLICY,
    )
    .await;
    assert_eq!(
        first.report().expect("first round").deleted,
        vec!["orphan-1.jpg".to_string()]
    );

    for round in 0..2 {
        let repeat = collect_orphans(
            &mut connection,
            Path::new(&app_data),
            &thumbnail_lifecycle::ORPHAN_COLLECTION_POLICY,
        )
        .await;
        assert!(
            matches!(
                repeat,
                thumbnail_lifecycle::OrphanCollectionResult::Completed(_)
            ),
            "round {round} must report a clean completion: {repeat:?}"
        );
        let report = repeat.report().expect("repeat round reports a summary");
        assert!(report.deleted.is_empty(), "round {round}: {report:?}");
        assert!(report.failures.is_empty(), "round {round}: {report:?}");
    }
    assert!(thumbnail_directory.is_dir());
    assert_eq!(std::fs::read_dir(&thumbnail_directory).unwrap().count(), 0);

    std::fs::remove_dir_all(&test_root).unwrap();
}

/// Replays the real production ordering from `video-import-controller.ts`: the
/// thumbnail is written at `:512` while the `video` row is only inserted at
/// `:534`. A round running inside that window must not delete the thumbnail.
#[tokio::test]
async fn keeps_a_thumbnail_written_before_its_database_row_is_inserted() {
    let test_root = gc_root("in-flight-ordered");
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    let in_flight = thumbnail_directory.join("video-1.jpg");
    std::fs::create_dir_all(&thumbnail_directory).unwrap();
    std::fs::write(&in_flight, b"in-flight-thumbnail").unwrap();
    let mut connection = lifecycle_database().await;

    // `:512` wrote the file; the row does not exist yet.
    let inside_window = collect_orphans(
        &mut connection,
        Path::new(&app_data),
        &thumbnail_lifecycle::ORPHAN_COLLECTION_POLICY,
    )
    .await;
    assert!(
        !inside_window.is_skipped(),
        "the round must run: {inside_window:?}"
    );
    let report = inside_window.report().expect("round reports a summary");
    assert!(report.deleted.is_empty(), "{report:?}");
    assert_eq!(report.retained_recent, vec!["video-1.jpg".to_string()]);
    assert_eq!(
        std::fs::read(&in_flight).unwrap(),
        b"in-flight-thumbnail",
        "a thumbnail inside the import window must survive the round"
    );

    // `:534` finally inserts the row.
    seed_video(&mut connection, "video-1").await;

    let after_commit = collect_orphans(
        &mut connection,
        Path::new(&app_data),
        &thumbnail_lifecycle::ORPHAN_COLLECTION_POLICY,
    )
    .await;
    assert_eq!(
        std::fs::read(&in_flight).unwrap(),
        b"in-flight-thumbnail",
        "the committed Video must keep its thumbnail"
    );
    assert!(
        after_commit
            .report()
            .expect("round reports a summary")
            .deleted
            .is_empty(),
        "{after_commit:?}"
    );

    std::fs::remove_dir_all(&test_root).unwrap();
}

/// Runs a real round while another thread keeps writing thumbnails into the
/// controlled directory, so a concurrent import can never lose its file.
#[tokio::test]
async fn never_deletes_thumbnails_written_while_a_round_is_running() {
    let test_root = gc_root("concurrent-writer");
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    std::fs::create_dir_all(&thumbnail_directory).unwrap();
    let mut connection = lifecycle_database().await;

    let writer_directory = thumbnail_directory.clone();
    let (started_sender, started_receiver) = std::sync::mpsc::channel::<()>();
    let writer = std::thread::spawn(move || {
        let mut written = Vec::new();
        for index in 0..64 {
            let path = writer_directory.join(format!("in-flight-{index}.jpg"));
            std::fs::write(&path, b"concurrent-thumbnail").unwrap();
            written.push(path);
            if index == 0 {
                let _ = started_sender.send(());
            }
        }
        written
    });
    started_receiver
        .recv_timeout(Duration::from_secs(60))
        .expect("the concurrent writer must start");

    let result = collect_orphans(
        &mut connection,
        Path::new(&app_data),
        &thumbnail_lifecycle::ORPHAN_COLLECTION_POLICY,
    )
    .await;

    let written = writer.join().expect("join the concurrent writer");
    assert!(!result.is_skipped(), "{result:?}");
    for path in &written {
        assert!(
            path.is_file(),
            "{} was deleted by a concurrent round",
            path.display()
        );
        assert_eq!(std::fs::read(path).unwrap(), b"concurrent-thumbnail");
    }

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[tokio::test]
async fn retains_illegal_entries_and_reports_them() {
    let test_root = gc_root("illegal");
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    let legal_name_but_directory = thumbnail_directory.join("orphan-1.jpg");
    let wrong_extension = thumbnail_directory.join("orphan-2.png");
    let partial = thumbnail_directory.join(".orphan-3.deadbeef.partial.jpg");
    let nested = thumbnail_directory.join("nested");
    std::fs::create_dir_all(&legal_name_but_directory).unwrap();
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::write(&wrong_extension, b"wrong-extension").unwrap();
    std::fs::write(&partial, b"partial-write").unwrap();
    let mut connection = lifecycle_database().await;

    let result = collect_orphans(
        &mut connection,
        Path::new(&app_data),
        &thumbnail_lifecycle::ORPHAN_COLLECTION_POLICY,
    )
    .await;

    let report = result.report().expect("round reports a summary");
    assert!(report.deleted.is_empty(), "{report:?}");
    assert!(report.failures.is_empty(), "{report:?}");
    assert_eq!(report.skipped_not_app_owned, 4, "{report:?}");
    assert!(legal_name_but_directory.is_dir());
    assert_eq!(std::fs::read(&wrong_extension).unwrap(), b"wrong-extension");
    assert_eq!(std::fs::read(&partial).unwrap(), b"partial-write");
    assert!(nested.is_dir());

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn never_deletes_outside_a_redirected_controlled_directory() {
    let test_root = gc_root("redirected");
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    let external_directory = test_root.join("external");
    let external_orphan = external_directory.join("orphan-1.jpg");
    std::fs::create_dir_all(&app_data).unwrap();
    std::fs::create_dir_all(&external_directory).unwrap();
    std::fs::write(&external_orphan, b"external-thumbnail-bytes").unwrap();
    age_thumbnail(&external_orphan, Duration::from_secs(3600));
    create_directory_junction(&thumbnail_directory, &external_directory);
    let mut connection = lifecycle_database().await;

    let result = collect_orphans(
        &mut connection,
        Path::new(&app_data),
        &thumbnail_lifecycle::ORPHAN_COLLECTION_POLICY,
    )
    .await;

    assert_eq!(
        std::fs::read(&external_orphan).unwrap(),
        b"external-thumbnail-bytes",
        "round result was {result:?}"
    );
    assert!(external_orphan.is_file());

    std::fs::remove_dir(&thumbnail_directory).unwrap();
    std::fs::remove_dir_all(&test_root).unwrap();
}

#[tokio::test]
async fn skips_without_deleting_when_the_controlled_directory_is_not_a_plain_directory() {
    let test_root = gc_root("directory-unavailable");
    let app_data = test_root.join("app-data");
    let source_video = app_data.join("source-video.mp4");
    std::fs::create_dir_all(&app_data).unwrap();
    std::fs::write(app_data.join("thumbnails"), b"not-a-directory").unwrap();
    std::fs::write(&source_video, b"source-video-bytes").unwrap();
    let mut connection = lifecycle_database().await;

    let result = collect_orphans(
        &mut connection,
        Path::new(&app_data),
        &thumbnail_lifecycle::ORPHAN_COLLECTION_POLICY,
    )
    .await;

    assert!(
        matches!(
            result,
            thumbnail_lifecycle::OrphanCollectionResult::Skipped(
                thumbnail_lifecycle::OrphanCollectionSkip::ControlledDirectoryUnavailable(_)
            )
        ),
        "{result:?}"
    );
    assert_eq!(std::fs::read(&source_video).unwrap(), b"source-video-bytes");

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[tokio::test]
async fn skips_without_deleting_when_the_keep_set_cannot_be_read() {
    let test_root = gc_root("keep-set-unavailable");
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    let orphan = thumbnail_directory.join("orphan-1.jpg");
    std::fs::create_dir_all(&thumbnail_directory).unwrap();
    std::fs::write(&orphan, b"app-owned-thumbnail").unwrap();
    age_thumbnail(&orphan, Duration::from_secs(3600));
    let mut connection = lifecycle_database().await;
    sqlx::query("DROP TABLE video")
        .execute(&mut connection)
        .await
        .unwrap();

    let result = collect_orphans(
        &mut connection,
        Path::new(&app_data),
        &thumbnail_lifecycle::ORPHAN_COLLECTION_POLICY,
    )
    .await;

    assert!(
        matches!(
            result,
            thumbnail_lifecycle::OrphanCollectionResult::Skipped(
                thumbnail_lifecycle::OrphanCollectionSkip::KeepSetUnavailable(_)
            )
        ),
        "{result:?}"
    );
    assert_eq!(
        std::fs::read(&orphan).unwrap(),
        b"app-owned-thumbnail",
        "an unreadable keep-set must fail closed"
    );

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[tokio::test]
async fn caps_examined_entries_per_round_and_converges_across_rounds() {
    let test_root = gc_root("candidate-cap");
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    std::fs::create_dir_all(&thumbnail_directory).unwrap();
    for index in 0..10 {
        let orphan = thumbnail_directory.join(format!("orphan-{index}.jpg"));
        std::fs::write(&orphan, b"app-owned-thumbnail").unwrap();
        age_thumbnail(&orphan, Duration::from_secs(3600));
    }
    let mut connection = lifecycle_database().await;
    let policy = orphan_policy(4, 5, Duration::from_secs(300));

    let mut total_deleted = 0;
    let mut saw_candidate_cap = false;
    for round in 0..10 {
        let result = collect_orphans(&mut connection, Path::new(&app_data), &policy).await;
        let report = result.report().expect("round reports a summary");
        assert!(report.candidates_examined <= 4, "round {round}: {report:?}");
        assert!(report.deleted.len() <= 4, "round {round}: {report:?}");
        total_deleted += report.deleted.len();
        if matches!(
            result,
            thumbnail_lifecycle::OrphanCollectionResult::CappedByCandidateLimit(_)
        ) {
            saw_candidate_cap = true;
            assert_eq!(report.candidates_examined, 4, "round {round}: {report:?}");
        }
        if report.deleted.is_empty()
            && matches!(
                result,
                thumbnail_lifecycle::OrphanCollectionResult::Completed(_)
            )
        {
            break;
        }
    }

    assert!(saw_candidate_cap, "the candidate cap must be observable");
    assert_eq!(total_deleted, 10);
    assert_eq!(std::fs::read_dir(&thumbnail_directory).unwrap().count(), 0);

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn continues_past_a_failed_deletion_and_reports_it() {
    let test_root = gc_root("partial-failure");
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    let blocked = thumbnail_directory.join("blocked-1.jpg");
    let orphan = thumbnail_directory.join("orphan-2.jpg");
    let source_video = test_root.join("source-video.mp4");
    std::fs::create_dir_all(&thumbnail_directory).unwrap();
    std::fs::write(&blocked, b"app-owned-thumbnail").unwrap();
    std::fs::write(&orphan, b"app-owned-thumbnail").unwrap();
    std::fs::write(&source_video, b"source-video-bytes").unwrap();
    age_thumbnail(&blocked, Duration::from_secs(3600));
    age_thumbnail(&orphan, Duration::from_secs(3600));
    let mut connection = lifecycle_database().await;
    let policy = orphan_policy(200, 5, Duration::from_secs(300));
    let occupying = occupying_handle::OccupyingHandle::open(&blocked);

    let result = collect_orphans(&mut connection, Path::new(&app_data), &policy).await;

    assert!(
        matches!(
            result,
            thumbnail_lifecycle::OrphanCollectionResult::CompletedWithFailures(_)
        ),
        "a partial failure must not abort the round: {result:?}"
    );
    let report = result.report().expect("round reports a summary");
    assert_eq!(report.deleted, vec!["orphan-2.jpg".to_string()]);
    assert_eq!(report.failures.len(), 1, "{report:?}");
    assert_eq!(report.failures[0].name, "blocked-1.jpg");
    assert!(
        report.failures[0]
            .diagnostic
            .contains("app-owned thumbnail"),
        "{}",
        report.failures[0].diagnostic
    );
    assert_eq!(std::fs::read(&blocked).unwrap(), b"app-owned-thumbnail");
    assert_eq!(std::fs::read(&source_video).unwrap(), b"source-video-bytes");

    drop(occupying);

    let retry = collect_orphans(&mut connection, Path::new(&app_data), &policy).await;
    assert!(!blocked.exists(), "{retry:?}");
    assert_eq!(
        retry.report().expect("retry reports a summary").deleted,
        vec!["blocked-1.jpg".to_string()]
    );

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn stops_at_the_failure_cap_and_reports_each_failure() {
    let test_root = gc_root("failure-cap");
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    let first_blocked = thumbnail_directory.join("blocked-1.jpg");
    let second_blocked = thumbnail_directory.join("blocked-2.jpg");
    let orphan = thumbnail_directory.join("orphan-3.jpg");
    std::fs::create_dir_all(&thumbnail_directory).unwrap();
    for path in [&first_blocked, &second_blocked, &orphan] {
        std::fs::write(path, b"app-owned-thumbnail").unwrap();
        age_thumbnail(path, Duration::from_secs(3600));
    }
    let mut connection = lifecycle_database().await;
    let policy = orphan_policy(200, 1, Duration::from_secs(300));
    let first_occupying = occupying_handle::OccupyingHandle::open(&first_blocked);
    let second_occupying = occupying_handle::OccupyingHandle::open(&second_blocked);

    let result = collect_orphans(&mut connection, Path::new(&app_data), &policy).await;

    assert!(
        matches!(
            result,
            thumbnail_lifecycle::OrphanCollectionResult::CappedByFailureLimit(_)
        ),
        "{result:?}"
    );
    let report = result.report().expect("round reports a summary");
    assert_eq!(report.failures.len(), 1, "{report:?}");
    assert!(first_blocked.is_file());
    assert!(second_blocked.is_file());

    drop(first_occupying);
    drop(second_occupying);

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[tokio::test]
async fn refuses_to_reenter_the_same_app_data_root_and_allows_other_roots() {
    let first_root = gc_root("reentry-a");
    let second_root = gc_root("reentry-b");
    let first_app_data = first_root.join("app-data");
    let second_app_data = second_root.join("app-data");
    let first_thumbnail_directory = first_app_data.join("thumbnails");
    let second_thumbnail_directory = second_app_data.join("thumbnails");
    let first_orphan = first_thumbnail_directory.join("orphan-1.jpg");
    let second_orphan = second_thumbnail_directory.join("orphan-1.jpg");
    std::fs::create_dir_all(&first_thumbnail_directory).unwrap();
    std::fs::create_dir_all(&second_thumbnail_directory).unwrap();
    std::fs::write(&first_orphan, b"app-owned-thumbnail").unwrap();
    std::fs::write(&second_orphan, b"app-owned-thumbnail").unwrap();
    age_thumbnail(&first_orphan, Duration::from_secs(3600));
    age_thumbnail(&second_orphan, Duration::from_secs(3600));
    let mut first_connection = lifecycle_database().await;
    let mut second_connection = lifecycle_database().await;
    let policy = orphan_policy(200, 5, Duration::from_secs(300));

    let guard = thumbnail_lifecycle::OrphanCollectionGuard::try_acquire(Path::new(&first_app_data))
        .expect("acquire the in-process guard");

    let blocked = collect_orphans(&mut first_connection, Path::new(&first_app_data), &policy).await;
    assert!(
        matches!(
            blocked,
            thumbnail_lifecycle::OrphanCollectionResult::Skipped(
                thumbnail_lifecycle::OrphanCollectionSkip::AlreadyRunning
            )
        ),
        "{blocked:?}"
    );
    assert_eq!(
        std::fs::read(&first_orphan).unwrap(),
        b"app-owned-thumbnail"
    );

    let independent =
        collect_orphans(&mut second_connection, Path::new(&second_app_data), &policy).await;
    assert!(!independent.is_skipped(), "{independent:?}");
    assert!(!second_orphan.exists());

    drop(guard);

    let after_release =
        collect_orphans(&mut first_connection, Path::new(&first_app_data), &policy).await;
    assert!(!after_release.is_skipped(), "{after_release:?}");
    assert!(!first_orphan.exists());

    std::fs::remove_dir_all(&first_root).unwrap();
    std::fs::remove_dir_all(&second_root).unwrap();
}

#[tokio::test]
async fn reports_a_diagnostic_only_when_a_round_changed_or_was_skipped() {
    let test_root = gc_root("diagnostic");
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    let orphan = thumbnail_directory.join("orphan-1.jpg");
    std::fs::create_dir_all(&thumbnail_directory).unwrap();
    let mut connection = lifecycle_database().await;
    let policy = orphan_policy(200, 5, Duration::from_secs(300));

    let idle = collect_orphans(&mut connection, Path::new(&app_data), &policy).await;
    assert_eq!(
        thumbnail_lifecycle::orphan_collection_diagnostic(&idle),
        None
    );

    std::fs::write(&orphan, b"app-owned-thumbnail").unwrap();
    age_thumbnail(&orphan, Duration::from_secs(3600));
    let collected = collect_orphans(&mut connection, Path::new(&app_data), &policy).await;
    let collected_diagnostic = thumbnail_lifecycle::orphan_collection_diagnostic(&collected)
        .expect("a diagnostic line for a round that deleted a file");
    assert!(
        collected_diagnostic.contains("deleted=1"),
        "{collected_diagnostic}"
    );
    assert!(
        collected_diagnostic.contains("completed"),
        "{collected_diagnostic}"
    );

    let guarded = thumbnail_lifecycle::OrphanCollectionGuard::try_acquire(Path::new(&app_data))
        .expect("acquire the in-process guard");
    let skipped = collect_orphans(&mut connection, Path::new(&app_data), &policy).await;
    drop(guarded);
    let skipped_diagnostic = thumbnail_lifecycle::orphan_collection_diagnostic(&skipped)
        .expect("a diagnostic line for a skipped round");
    assert!(
        skipped_diagnostic.contains("already_running"),
        "{skipped_diagnostic}"
    );

    std::fs::remove_dir_all(&test_root).unwrap();
}

/// `D2`: a round runs only after the database delete committed, and the round's
/// own outcome never changes the delete result.
#[tokio::test]
async fn collects_after_a_successful_delete_without_changing_the_delete_result() {
    let test_root = gc_root("delete-then-collect");
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    let orphan = thumbnail_directory.join("orphan-1.jpg");
    let source_video = test_root.join("source-video.mp4");
    std::fs::create_dir_all(&thumbnail_directory).unwrap();
    std::fs::write(&orphan, b"app-owned-thumbnail").unwrap();
    std::fs::write(&source_video, b"source-video-bytes").unwrap();
    age_thumbnail(&orphan, Duration::from_secs(3600));
    let mut connection = lifecycle_database().await;
    seed_video(&mut connection, "video-1").await;

    let outcome = thumbnail_lifecycle::delete_video_and_collect_orphans_on_connection(
        &mut connection,
        Path::new(&app_data),
        "video-1",
        &thumbnail_lifecycle::ORPHAN_COLLECTION_POLICY,
    )
    .await
    .expect("a successful delete reports the round");

    assert_eq!(table_count(&mut connection, "video").await, 0);
    assert!(!orphan.exists(), "{outcome:?}");
    assert_eq!(
        outcome.report().expect("round reports a summary").deleted,
        vec!["orphan-1.jpg".to_string()]
    );
    assert_eq!(std::fs::read(&source_video).unwrap(), b"source-video-bytes");

    // A round that cannot run must still leave the delete itself successful.
    std::fs::remove_dir_all(&thumbnail_directory).unwrap();
    std::fs::write(app_data.join("thumbnails"), b"not-a-directory").unwrap();
    let mut second_connection = lifecycle_database().await;
    seed_video(&mut second_connection, "video-2").await;
    let tolerated = thumbnail_lifecycle::delete_video_and_collect_orphans_on_connection(
        &mut second_connection,
        Path::new(&app_data),
        "video-2",
        &thumbnail_lifecycle::ORPHAN_COLLECTION_POLICY,
    )
    .await
    .expect("a skipped round must not turn the delete into a failure");
    assert!(tolerated.is_skipped(), "{tolerated:?}");
    assert_eq!(table_count(&mut second_connection, "video").await, 0);

    std::fs::remove_dir_all(&test_root).unwrap();
}

#[tokio::test]
async fn does_not_run_a_round_when_the_delete_did_not_commit() {
    let test_root = gc_root("delete-failed");
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    let orphan = thumbnail_directory.join("orphan-1.jpg");
    std::fs::create_dir_all(&thumbnail_directory).unwrap();
    std::fs::write(&orphan, b"app-owned-thumbnail").unwrap();
    age_thumbnail(&orphan, Duration::from_secs(3600));
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

    let result = thumbnail_lifecycle::delete_video_and_collect_orphans_on_connection(
        &mut connection,
        Path::new(&app_data),
        "video-1",
        &thumbnail_lifecycle::ORPHAN_COLLECTION_POLICY,
    )
    .await;

    assert!(result.is_err());
    assert_eq!(table_count(&mut connection, "video").await, 1);
    assert_eq!(
        std::fs::read(&orphan).unwrap(),
        b"app-owned-thumbnail",
        "no round may run when the delete did not commit"
    );

    std::fs::remove_dir_all(&test_root).unwrap();
}
