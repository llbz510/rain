// src-tauri/src/scheduler.rs
// ========================================
// tokio 任务调度（决策98/83）
// ========================================

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex;

#[derive(Debug, Clone, PartialEq)]
pub enum TaskState {
    Idle,
    Running,
    Cancelled,
    Completed,
    Failed(String),
}

/// 取消令牌（跨 async task 共享，决策83/98）
#[derive(Debug)]
pub struct CancellationToken {
    cancelled: Arc<AtomicBool>,
}

impl CancellationToken {
    pub fn new() -> Self {
        CancellationToken {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// 在任务循环中检查取消，如果取消则返回 true
    pub async fn check_cancelled(&self) -> bool {
        self.is_cancelled()
    }

    /// 等待取消（用于 select! 分支）
    pub async fn cancelled(&self) {
        while !self.is_cancelled() {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }
    }
}

impl Clone for CancellationToken {
    fn clone(&self) -> Self {
        CancellationToken {
            cancelled: Arc::clone(&self.cancelled),
        }
    }
}

impl Default for CancellationToken {
    fn default() -> Self {
        Self::new()
    }
}

/// 导入调度器（并发=1，决策55/98）
pub struct ImportScheduler {
    current_token: Arc<Mutex<Option<CancellationToken>>>,
    state: Arc<Mutex<TaskState>>,
}

impl ImportScheduler {
    pub fn new() -> Self {
        ImportScheduler {
            current_token: Arc::new(Mutex::new(None)),
            state: Arc::new(Mutex::new(TaskState::Idle)),
        }
    }

    /// 启动新任务，返回取消令牌
    /// 如果有正在运行的任务，会等待它完成或取消
    pub async fn start_task(&self) -> CancellationToken {
        // 等待并取消之前的任务
        if let Some(old_token) = self.current_token.lock().await.take() {
            old_token.cancel();
        }

        let token = CancellationToken::new();
        *self.current_token.lock().await = Some(token.clone());
        *self.state.lock().await = TaskState::Running;
        token
    }

    /// 取消当前任务
    pub async fn cancel(&self) {
        if let Some(token) = self.current_token.lock().await.take() {
            token.cancel();
        }
        *self.state.lock().await = TaskState::Cancelled;
    }

    /// 标记任务完成
    pub async fn complete(&self) {
        *self.current_token.lock().await = None;
        *self.state.lock().await = TaskState::Completed;
    }

    /// 标记任务失败
    pub async fn fail(&self, error: String) {
        *self.current_token.lock().await = None;
        *self.state.lock().await = TaskState::Failed(error);
    }

    pub async fn get_state(&self) -> TaskState {
        self.state.lock().await.clone()
    }

    /// 是否有任务正在运行
    pub async fn is_running(&self) -> bool {
        matches!(self.state.lock().await.clone(), TaskState::Running)
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
}
