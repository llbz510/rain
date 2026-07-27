// src/lib/tauri-env.ts
// ========================================
// Tauri 环境检测 + 安全 invoke 包装
// ========================================

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`Tauri not available: cannot invoke '${cmd}'`)
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

export async function tauriListen<T>(
  eventName: string,
  callback: (payload: T) => void,
): Promise<() => void> {
  if (!isTauri()) {
    throw new Error(`Tauri not available: cannot listen to '${eventName}'`)
  }
  const { listen } = await import('@tauri-apps/api/event')
  return listen<T>(eventName, (event) => callback(event.payload))
}
