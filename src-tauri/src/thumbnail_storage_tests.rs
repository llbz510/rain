use crate::thumbnail_storage::{cleanup_after_generation_failure, generate_thumbnail};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn fixture_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .join("test-fixtures")
        .join("sample.mp4")
}

fn directory_entries(path: &Path) -> BTreeSet<String> {
    std::fs::read_dir(path)
        .expect("read directory")
        .map(|entry| {
            entry
                .expect("read entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect()
}

#[test]
fn creates_a_non_empty_thumbnail_inside_app_data_without_touching_the_source_directory() {
    let fixture = fixture_path();
    assert!(fixture.is_file(), "sample.mp4 fixture must exist");
    let source_directory = fixture.parent().expect("fixture directory");
    let source_entries_before = directory_entries(source_directory);
    let app_data =
        std::env::temp_dir().join(format!("rain-thumbnail-storage-{}", uuid::Uuid::new_v4()));

    let result =
        generate_thumbnail(&app_data, "video-1", &fixture, 1.0).expect("generate thumbnail");

    assert_eq!(result, app_data.join("thumbnails").join("video-1.jpg"));
    assert!(result.is_file());
    assert!(
        std::fs::metadata(&result)
            .expect("thumbnail metadata")
            .len()
            > 0
    );
    assert_eq!(directory_entries(source_directory), source_entries_before);

    std::fs::remove_dir_all(&app_data).expect("remove isolated app data");
}

#[test]
fn rejects_path_like_video_ids_before_creating_any_output() {
    let app_data = std::env::temp_dir().join(format!(
        "rain-thumbnail-invalid-id-{}",
        uuid::Uuid::new_v4()
    ));

    let result = generate_thumbnail(&app_data, "../escape", &fixture_path(), 1.0);

    assert!(result.is_err());
    assert!(!app_data.exists());
}

#[test]
fn failed_generation_preserves_the_existing_thumbnail_and_leaves_no_partial_file() {
    let test_root =
        std::env::temp_dir().join(format!("rain-thumbnail-failure-{}", uuid::Uuid::new_v4()));
    let app_data = test_root.join("app-data");
    let thumbnail_directory = app_data.join("thumbnails");
    std::fs::create_dir_all(&thumbnail_directory).expect("create thumbnail directory");
    let destination = thumbnail_directory.join("video-1.jpg");
    let existing = b"existing-thumbnail";
    std::fs::write(&destination, existing).expect("write existing thumbnail");
    let invalid_video = test_root.join("broken.mp4");
    std::fs::write(&invalid_video, b"not a video").expect("write invalid video");

    let result = generate_thumbnail(&app_data, "video-1", &invalid_video, 1.0);
    let destination_after = std::fs::read(&destination).ok();
    let entries_after = directory_entries(&thumbnail_directory);
    std::fs::remove_dir_all(&test_root).expect("remove isolated test root");

    assert!(result.is_err());
    assert_eq!(destination_after.as_deref(), Some(existing.as_slice()));
    assert_eq!(entries_after, BTreeSet::from(["video-1.jpg".to_string()]));
}

#[test]
fn reports_cleanup_failure_after_a_generation_error() {
    let error = cleanup_after_generation_failure(
        Path::new("synthetic.partial.jpg"),
        "synthetic generation failure",
        |_| {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "partial is locked",
            ))
        },
    );

    assert!(error.to_string().contains("synthetic generation failure"));
    assert!(error
        .to_string()
        .contains("cleanup temporary thumbnail: partial is locked"));
}
