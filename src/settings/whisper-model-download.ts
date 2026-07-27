import { tauriInvoke, tauriListen } from '@/lib/tauri-env'

export const WHISPER_MODEL_DOWNLOAD_PROGRESS_EVENT = 'whisper_model_download_progress'

const MODEL_FILENAMES: Record<string, string> = {
  tiny: 'ggml-tiny.bin',
  base: 'ggml-base.bin',
  small: 'ggml-small.bin',
  medium: 'ggml-medium.bin',
  'large-v3': 'ggml-large-v3.bin',
}

export interface WhisperModelDownloadProgress {
  modelSize: string
  downloadedBytes: number
  totalBytes: number | null
  percent: number | null
}

export interface WhisperModelDownloadSession {
  run(): Promise<string>
  cancel(): Promise<boolean>
  dispose(): void
}

export async function createWhisperModelDownloadSession(
  modelSize: string,
  onProgress: (progress: WhisperModelDownloadProgress) => void,
): Promise<WhisperModelDownloadSession> {
  let disposed = false
  const unlisten = await tauriListen<WhisperModelDownloadProgress>(
    WHISPER_MODEL_DOWNLOAD_PROGRESS_EVENT,
    (progress) => {
      if (!disposed && progress.modelSize === modelSize) onProgress(progress)
    },
  )

  return {
    async run() {
      const downloadedPath = await tauriInvoke<string>('download_whisper_model', {
        modelSize,
      })
      const installedPaths = await tauriInvoke<string[]>('list_whisper_models')
      const expectedFilename = MODEL_FILENAMES[modelSize]
      const installed = installedPaths.some((path) => (
        path.replaceAll('\\', '/').endsWith(`/${expectedFilename}`)
      ))
      if (!installed) {
        throw new Error(`Downloaded model is not installed: ${expectedFilename}`)
      }
      return downloadedPath
    },

    cancel() {
      return tauriInvoke<boolean>('cancel_whisper_model_download', { modelSize })
    },

    dispose() {
      if (disposed) return
      disposed = true
      unlisten()
    },
  }
}

export function isWhisperDownloadCancelled(error: unknown): boolean {
  return String(error).toLowerCase().includes('cancelled')
}
