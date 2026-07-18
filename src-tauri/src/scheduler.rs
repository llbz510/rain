// src-tauri/src/scheduler.rs
// ========================================
// Serial import scheduling and cancellation
// ========================================

use std::ops::Deref;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskState {
    Idle,
    Running,
    Cancelled,
    Completed,
    Failed(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskFinish {
    Completed,
    Failed,
    Cancelled,
    Stale,
}

#[derive(Debug)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    fn is_same_task(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.cancelled, &other.cancelled)
    }

    pub async fn check_cancelled(&self) -> bool {
        self.is_cancelled()
    }

    pub async fn cancelled(&self) {
        while !self.is_cancelled() {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    }
}

impl Clone for CancellationToken {
    fn clone(&self) -> Self {
        Self {
            cancelled: Arc::clone(&self.cancelled),
        }
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

pub struct TaskLease {
    token: CancellationToken,
    _permit: OwnedSemaphorePermit,
}

impl TaskLease {
    pub fn token(&self) -> CancellationToken {
        self.token.clone()
    }

    pub fn cancel(&self) {
        self.token.cancel();
    }

    pub fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }
}

impl Deref for TaskLease {
    type Target = CancellationToken;

    fn deref(&self) -> &Self::Target {
        &self.token
    }
}

struct CurrentTask {
    video_id: String,
    token: CancellationToken,
}

struct SchedulerInner {
    current: Option<CurrentTask>,
    pending: Option<CurrentTask>,
    state: TaskState,
}

pub struct ImportScheduler {
    inner: Arc<Mutex<SchedulerInner>>,
    gate: Arc<Semaphore>,
}

impl ImportScheduler {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(SchedulerInner {
                current: None,
                pending: None,
                state: TaskState::Idle,
            })),
            gate: Arc::new(Semaphore::new(1)),
        }
    }

    pub async fn start_task(&self) -> TaskLease {
        self.start_video_task("__legacy__").await
    }

    pub async fn start_video_task(&self, video_id: impl Into<String>) -> TaskLease {
        let token = CancellationToken::new();
        {
            let mut inner = self.inner.lock().await;
            if let Some(current) = inner.current.as_ref() {
                current.token.cancel();
            }
            if let Some(previous) = inner.pending.replace(CurrentTask {
                video_id: video_id.into(),
                token: token.clone(),
            }) {
                previous.token.cancel();
            }
        }

        let permit = Arc::clone(&self.gate)
            .acquire_owned()
            .await
            .expect("import semaphore must stay open");
        let mut inner = self.inner.lock().await;
        let is_pending = inner
            .pending
            .as_ref()
            .map(|pending| pending.token.is_same_task(&token))
            .unwrap_or(false);
        if is_pending && !token.is_cancelled() {
            inner.current = inner.pending.take();
            inner.state = TaskState::Running;
        } else {
            token.cancel();
            if is_pending {
                inner.pending.take();
            }
        }

        TaskLease {
            token,
            _permit: permit,
        }
    }

    pub async fn cancel(&self) {
        let mut inner = self.inner.lock().await;
        let mut cancelled = false;
        if let Some(current) = inner.current.take() {
            current.token.cancel();
            cancelled = true;
        }
        if let Some(pending) = inner.pending.take() {
            pending.token.cancel();
            cancelled = true;
        }
        if cancelled {
            inner.state = TaskState::Cancelled;
        }
    }

    pub async fn cancel_if_current(&self, video_id: &str) -> bool {
        let mut inner = self.inner.lock().await;
        let current_matches = inner
            .current
            .as_ref()
            .map(|current| current.video_id == video_id)
            .unwrap_or(false);
        let pending_matches = inner
            .pending
            .as_ref()
            .map(|pending| pending.video_id == video_id)
            .unwrap_or(false);

        if current_matches {
            let current = inner.current.take().expect("current task was checked");
            current.token.cancel();
            inner.state = TaskState::Cancelled;
        }
        if pending_matches {
            let pending = inner.pending.take().expect("pending task was checked");
            pending.token.cancel();
        }

        current_matches || pending_matches
    }

    pub async fn finish_success(&self, token: &CancellationToken) -> TaskFinish {
        let mut inner = self.inner.lock().await;
        let is_current = inner
            .current
            .as_ref()
            .map(|current| current.token.is_same_task(token))
            .unwrap_or(false);
        if !is_current {
            return if token.is_cancelled() {
                TaskFinish::Cancelled
            } else {
                TaskFinish::Stale
            };
        }

        inner.current.take();
        if token.is_cancelled() {
            inner.state = TaskState::Cancelled;
            TaskFinish::Cancelled
        } else {
            inner.state = TaskState::Completed;
            TaskFinish::Completed
        }
    }

    pub async fn finish_failure(&self, token: &CancellationToken, error: String) -> TaskFinish {
        let mut inner = self.inner.lock().await;
        let is_current = inner
            .current
            .as_ref()
            .map(|current| current.token.is_same_task(token))
            .unwrap_or(false);
        if !is_current {
            return if token.is_cancelled() {
                TaskFinish::Cancelled
            } else {
                TaskFinish::Stale
            };
        }

        inner.current.take();
        if token.is_cancelled() {
            inner.state = TaskState::Cancelled;
            TaskFinish::Cancelled
        } else {
            inner.state = TaskState::Failed(error);
            TaskFinish::Failed
        }
    }

    pub async fn mark_cancelled_if_current(&self, token: &CancellationToken) -> bool {
        let mut inner = self.inner.lock().await;
        let is_current = inner
            .current
            .as_ref()
            .map(|current| current.token.is_same_task(token))
            .unwrap_or(false);
        if !is_current {
            return false;
        }

        let current = inner.current.take().expect("current task was checked");
        current.token.cancel();
        inner.state = TaskState::Cancelled;
        true
    }

    pub async fn complete_if_current(&self, token: &CancellationToken) -> bool {
        self.finish_success(token).await == TaskFinish::Completed
    }

    pub async fn fail_if_current(&self, token: &CancellationToken, error: String) -> bool {
        self.finish_failure(token, error).await == TaskFinish::Failed
    }

    pub async fn complete(&self) {
        let mut inner = self.inner.lock().await;
        if inner.current.take().is_some() {
            inner.state = TaskState::Completed;
        }
    }

    pub async fn fail(&self, error: String) {
        let mut inner = self.inner.lock().await;
        if inner.current.take().is_some() {
            inner.state = TaskState::Failed(error);
        }
    }

    pub async fn get_state(&self) -> TaskState {
        self.inner.lock().await.state.clone()
    }

    pub async fn is_running(&self) -> bool {
        self.inner.lock().await.state == TaskState::Running
    }
}

impl Default for ImportScheduler {
    fn default() -> Self {
        Self::new()
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_scheduler_lifecycle() {
        let scheduler = ImportScheduler::new();
        assert_eq!(scheduler.get_state().await, TaskState::Idle);

        let token = scheduler.start_task().await;
        assert_eq!(scheduler.get_state().await, TaskState::Running);
        assert!(scheduler.is_running().await);

        scheduler.cancel().await;
        assert_eq!(scheduler.get_state().await, TaskState::Cancelled);
        assert!(token.is_cancelled());
    }

    #[tokio::test]
    async fn test_scheduler_complete() {
        let scheduler = ImportScheduler::new();
        scheduler.start_task().await;
        scheduler.complete().await;
        assert_eq!(scheduler.get_state().await, TaskState::Completed);
    }

    #[tokio::test]
    async fn test_scheduler_fail() {
        let scheduler = ImportScheduler::new();
        scheduler.start_task().await;
        scheduler.fail("test error".to_string()).await;
        assert!(matches!(
            scheduler.get_state().await,
            TaskState::Failed(e) if e == "test error"
        ));
    }

    #[tokio::test]
    async fn test_cancellation_token() {
        let token = CancellationToken::new();
        assert!(!token.is_cancelled());

        let token_clone = token.clone();
        token_clone.cancel();

        assert!(token.is_cancelled());
    }
    #[tokio::test]
    async fn stale_task_cannot_cancel_replacement() {
        let scheduler = ImportScheduler::new();
        let stale_lease = scheduler.start_task().await;
        let stale = stale_lease.token();
        stale.cancel();
        drop(stale_lease);
        let current = scheduler.start_task().await;

        assert!(stale.is_cancelled());
        assert!(!scheduler.mark_cancelled_if_current(&stale).await);
        assert!(!current.is_cancelled());
        assert_eq!(scheduler.get_state().await, TaskState::Running);
    }

    #[tokio::test]
    async fn stale_task_cannot_complete_replacement() {
        let scheduler = ImportScheduler::new();
        let stale_lease = scheduler.start_task().await;
        let stale = stale_lease.token();
        stale.cancel();
        drop(stale_lease);
        let _current = scheduler.start_task().await;

        assert!(!scheduler.complete_if_current(&stale).await);
        assert_eq!(scheduler.get_state().await, TaskState::Running);
    }
    #[tokio::test]
    async fn stale_task_cannot_fail_replacement() {
        let scheduler = ImportScheduler::new();
        let stale_lease = scheduler.start_task().await;
        let stale = stale_lease.token();
        stale.cancel();
        drop(stale_lease);
        let _current = scheduler.start_task().await;

        assert!(!scheduler.fail_if_current(&stale, "stale".to_string()).await);
        assert_eq!(scheduler.get_state().await, TaskState::Running);
    }

    #[tokio::test]
    async fn cancelling_without_a_current_task_does_not_overwrite_completion() {
        let scheduler = ImportScheduler::new();
        scheduler.start_task().await;
        scheduler.complete().await;

        scheduler.cancel().await;

        assert_eq!(scheduler.get_state().await, TaskState::Completed);
    }
    #[tokio::test]
    async fn stale_video_cancel_does_not_touch_current_task() {
        let scheduler = ImportScheduler::new();
        let current = scheduler.start_video_task("video-b").await;

        assert!(!scheduler.cancel_if_current("video-a").await);
        assert!(!current.is_cancelled());
        assert_eq!(scheduler.get_state().await, TaskState::Running);
    }

    #[tokio::test]
    async fn replacement_waits_until_the_previous_lease_is_dropped() {
        let scheduler = Arc::new(ImportScheduler::new());
        let first = scheduler.start_video_task("video-a").await;
        let replacement_scheduler = Arc::clone(&scheduler);
        let replacement =
            tokio::spawn(async move { replacement_scheduler.start_video_task("video-b").await });

        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            while !first.is_cancelled() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(!replacement.is_finished());

        drop(first);
        let second = tokio::time::timeout(std::time::Duration::from_secs(1), replacement)
            .await
            .unwrap()
            .unwrap();
        assert!(!second.is_cancelled());
    }

    #[tokio::test]
    async fn failure_after_user_cancel_is_classified_as_cancelled() {
        let scheduler = ImportScheduler::new();
        let task = scheduler.start_video_task("video-a").await;
        assert!(scheduler.cancel_if_current("video-a").await);

        assert_eq!(
            scheduler
                .finish_failure(&task, "late failure".to_string())
                .await,
            TaskFinish::Cancelled
        );
        assert_eq!(scheduler.get_state().await, TaskState::Cancelled);
    }

    #[tokio::test]
    async fn newest_queued_task_supersedes_older_queued_task() {
        let scheduler = Arc::new(ImportScheduler::new());
        let first = scheduler.start_video_task("video-a").await;

        let second_scheduler = Arc::clone(&scheduler);
        let second =
            tokio::spawn(async move { second_scheduler.start_video_task("video-b").await });
        while !first.is_cancelled() {
            tokio::task::yield_now().await;
        }

        let third_scheduler = Arc::clone(&scheduler);
        let third = tokio::spawn(async move { third_scheduler.start_video_task("video-c").await });
        tokio::task::yield_now().await;

        drop(first);
        let second = second.await.unwrap();
        assert!(second.is_cancelled());
        drop(second);

        let third = third.await.unwrap();
        assert!(!third.is_cancelled());
    }

    #[tokio::test]
    async fn queued_task_can_be_cancelled_by_video_id() {
        let scheduler = Arc::new(ImportScheduler::new());
        let first = scheduler.start_video_task("video-a").await;

        let queued_scheduler = Arc::clone(&scheduler);
        let queued =
            tokio::spawn(async move { queued_scheduler.start_video_task("video-b").await });
        while !first.is_cancelled() {
            tokio::task::yield_now().await;
        }

        assert!(scheduler.cancel_if_current("video-b").await);
        drop(first);
        assert!(queued.await.unwrap().is_cancelled());
    }
}
