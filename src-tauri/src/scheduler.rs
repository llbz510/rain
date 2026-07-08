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
}

impl Clone for CancellationToken {
    fn clone(&self) -> Self {
        CancellationToken {
            cancelled: Arc::clone(&self.cancelled),
        }
    }
}

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

    pub async fn start_task(&self) -> CancellationToken {
        let token = CancellationToken::new();
        *self.current_token.lock().await = Some(token.clone());
        *self.state.lock().await = TaskState::Running;
        token
    }

    pub async fn cancel(&self) {
        if let Some(token) = self.current_token.lock().await.take() {
            token.cancel();
        }
        *self.state.lock().await = TaskState::Cancelled;
    }

    pub async fn get_state(&self) -> TaskState {
        self.state.lock().await.clone()
    }
}

impl Default for ImportScheduler {
    fn default() -> Self {
        Self::new()
    }
}
