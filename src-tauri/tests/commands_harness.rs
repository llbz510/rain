// src-tauri/tests/commands_harness.rs
// ========================================
// Rust Harness: scheduler and event payload behavior
// Harness migration: 2026-07-26
// ========================================

use rain_lib::events::ProgressPayload;
use rain_lib::scheduler::{CancellationToken, ImportScheduler, TaskFinish, TaskState};
use std::sync::Arc;
use tokio::time::{sleep, timeout, Duration};

#[test]
fn r20_progress_payload_serializes_to_the_frontend_contract() {
    let payload = ProgressPayload::with_block("v1", "asr_transcription", 2, 4, 50, true);
    let json = serde_json::to_value(payload).unwrap();

    assert_eq!(json["videoId"], "v1");
    assert_eq!(json["stage"], "asr_transcription");
    assert_eq!(json["blockCurrent"], 2);
    assert_eq!(json["blockTotal"], 4);
    assert_eq!(json["percent"], 50);
    assert_eq!(json["retrying"], true);
    assert!(json.get("video_id").is_none());
}

#[test]
fn r25_cancellation_token_is_shared_by_clones() {
    let token = CancellationToken::new();
    let clone = token.clone();

    assert!(!token.is_cancelled());
    clone.cancel();
    assert!(token.is_cancelled());
}

#[tokio::test]
async fn r23_scheduler_serializes_imports_and_cancels_the_superseded_task() {
    let scheduler = Arc::new(ImportScheduler::new());
    let first = scheduler.start_video_task("video-1").await;
    assert_eq!(scheduler.get_state().await, TaskState::Running);

    let next_scheduler = Arc::clone(&scheduler);
    let second_task =
        tokio::spawn(async move { next_scheduler.start_video_task("video-2").await });
    sleep(Duration::from_millis(20)).await;

    assert!(first.is_cancelled());
    assert!(!second_task.is_finished());

    drop(first);
    let second = timeout(Duration::from_secs(1), second_task)
        .await
        .expect("second import should acquire the serial permit")
        .expect("second import task should not panic");
    assert!(!second.is_cancelled());

    let token = second.token();
    assert_eq!(
        scheduler.finish_success(&token).await,
        TaskFinish::Completed
    );
    assert_eq!(scheduler.get_state().await, TaskState::Completed);
}

#[tokio::test]
async fn r16_cancel_only_matches_the_requested_video() {
    let scheduler = ImportScheduler::new();
    let lease = scheduler.start_video_task("video-1").await;

    assert!(!scheduler.cancel_if_current("other-video").await);
    assert!(!lease.is_cancelled());
    assert!(scheduler.cancel_if_current("video-1").await);
    assert!(lease.is_cancelled());
    assert_eq!(scheduler.get_state().await, TaskState::Cancelled);
}
