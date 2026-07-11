// src/pipeline/progress-listener.ts
import type { ProgressPayload } from '@/architecture/events'

export type ProgressCallback = (payload: ProgressPayload) => void

export function listenProgress(_callback: ProgressCallback): void {
  // 阶段二实现：Tauri event 订阅
}

export function unlistenProgress(): void {
  // 阶段二实现：取消订阅
}
