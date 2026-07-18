import type { ProgressPayload } from '@/architecture/events'
import { PROGRESS_EVENT_NAME } from '@/architecture/events'

export type ProgressCallback = (payload: ProgressPayload) => void

let unlistenFn: (() => void) | null = null

export async function listenProgress(callback: ProgressCallback): Promise<void> {
  const { isTauri } = await import('@/lib/tauri-env')
  if (!isTauri()) return

  const { listen } = await import('@tauri-apps/api/event')
  unlistenFn?.()
  unlistenFn = await listen<ProgressPayload>(PROGRESS_EVENT_NAME, (event) => {
    callback(event.payload)
  })
}

export function unlistenProgress(): void {
  if (unlistenFn) {
    unlistenFn()
    unlistenFn = null
  }
}
