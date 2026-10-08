import type { ProgressPayload } from '@/architecture/events'
import { PROGRESS_EVENT_NAME } from '@/architecture/events'

export type ProgressCallback = (payload: ProgressPayload) => void

let unlistenFn: (() => void) | null = null

export async function subscribeProgress(callback: ProgressCallback): Promise<() => void> {
  const { isTauri } = await import('@/lib/tauri-env')
  if (!isTauri()) return () => undefined
  const { listen } = await import('@tauri-apps/api/event')
  return listen<ProgressPayload>(PROGRESS_EVENT_NAME, (event) => callback(event.payload))
}

export async function listenProgress(callback: ProgressCallback): Promise<void> {
  const { isTauri } = await import('@/lib/tauri-env')
  if (!isTauri()) return

  unlistenFn?.()
  unlistenFn = await subscribeProgress(callback)
}

export function unlistenProgress(): void {
  if (unlistenFn) {
    unlistenFn()
    unlistenFn = null
  }
}
