use super::*;
use std::fs;
use tauri::{
    test::{mock_builder, mock_context, noop_assets},
    utils::config::FsScope,
};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("rain-asset-scope-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("thumbnails")).unwrap();
        fs::create_dir_all(root.join("online-videos/video-1")).unwrap();
        fs::create_dir_all(root.join("selected/sub")).unwrap();
        Self(root)
    }

    fn file(&self, path: &str) -> PathBuf {
        let path = self.0.join(path);
        fs::write(&path, b"fixture bytes").unwrap();
        path
    }

    fn scope(&self) -> Scope {
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let patterns: Vec<PathBuf> = config["app"]["security"]["assetProtocol"]["scope"]
            .as_array()
            .unwrap()
            .iter()
            .map(|path| {
                PathBuf::from(
                    path.as_str()
                        .unwrap()
                        .replace("$APPDATA", &self.0.to_string_lossy()),
                )
            })
            .collect();
        Scope::new(&app, &FsScope::AllowedPaths(patterns)).unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[tokio::test]
async fn restores_only_persisted_selected_files_with_literal_and_normalized_paths() {
    let fixture = Fixture::new();
    let selected = fixture.file("selected/lesson [1].wav");
    let neighbor = fixture.file("selected/lesson 1.wav");
    let url_file = fixture.file("selected/not-selected.wav");
    let database = fixture.0.join("rain.db");
    let mut connection = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(&database)
            .create_if_missing(true),
    )
    .await
    .unwrap();
    sqlx::query("CREATE TABLE video (source TEXT, file_path TEXT)")
        .execute(&mut connection)
        .await
        .unwrap();
    for (source, path) in [
        ("local", selected.to_string_lossy().to_string()),
        ("url", url_file.to_string_lossy().to_string()),
        ("local", "relative.wav".to_string()),
    ] {
        sqlx::query("INSERT INTO video (source, file_path) VALUES (?, ?)")
            .bind(source)
            .bind(path)
            .execute(&mut connection)
            .await
            .unwrap();
    }
    connection.close().await.unwrap();

    let scope = fixture.scope();
    assert!(!scope.is_allowed(&selected));
    restore_local_media_access(&database, &scope).await.unwrap();
    assert!(scope.is_allowed(&selected));
    assert!(scope.is_allowed(fixture.0.join("selected/sub/../lesson [1].wav")));
    assert!(!scope.is_allowed(&neighbor));
    assert!(!scope.is_allowed(&url_file));
    assert!(!scope.is_allowed("relative.wav"));
}

#[test]
fn static_scope_allows_owned_media_and_denies_other_real_files_and_traversal() {
    let fixture = Fixture::new();
    let thumbnail = fixture.file("thumbnails/video-1.png");
    let download = fixture.file("online-videos/video-1/video.mp4");
    let private = fixture.file("private.txt");
    let scope = fixture.scope();
    assert!(scope.is_allowed(&thumbnail));
    assert!(scope.is_allowed(&download));
    assert!(!scope.is_allowed(&private));
    assert!(!scope.is_allowed(fixture.0.join("thumbnails/../private.txt")));
    assert!(!scope.is_allowed(fixture.0.join("online-videos/video-1/../../private.txt")));
}

#[tokio::test]
async fn new_database_does_not_create_files_or_grant_unselected_paths() {
    let fixture = Fixture::new();
    let private = fixture.file("private.txt");
    let database = fixture.0.join("rain.db");
    let scope = fixture.scope();
    restore_local_media_access(&database, &scope).await.unwrap();
    assert!(!database.exists());
    let connection = SqliteConnection::connect_with(
        &SqliteConnectOptions::new()
            .filename(&database)
            .create_if_missing(true),
    )
    .await
    .unwrap();
    connection.close().await.unwrap();
    restore_local_media_access(&database, &scope).await.unwrap();
    assert!(!scope.is_allowed(private));
}
