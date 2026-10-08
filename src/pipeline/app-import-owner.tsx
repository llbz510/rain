import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Database } from '@/models/database'
import { getDb } from '@/models/db-singleton'
import { useRainStore } from '@/store/rain-store'
import { createVideoImportController, type ImportProgress, type VideoImportController } from './video-import-controller'
import { subscribeProgress } from './progress-listener'

interface ImportSession {
  db: Database | null
  controller: VideoImportController | null
  databaseError: string
  revision: number
  progress: Record<string, ImportProgress>
  warning: string
  clearWarning: () => void
}

const ImportContext = createContext<ImportSession | null>(null)

export function AppImportOwner({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<Pick<ImportSession, 'db' | 'controller' | 'databaseError'>>({
    db: null, controller: null, databaseError: '',
  })
  const [revision, setRevision] = useState(0)
  const [progress, setProgress] = useState<ImportSession['progress']>({})
  const [warning, setWarning] = useState('')

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void getDb().then((db) => {
      if (disposed) return
      const controller = createVideoImportController({
        db,
        loadRuntimeSettings: async () => {
          await useRainStore.getState().loadRuntimeSettings()
          const configured = useRainStore.getState()
          return {
            ready: configured.settingsReady,
            error: configured.settingsError,
            models: configured.modelPool.map((model) => ({ ...model })),
            roles: { ...configured.roleAssignment },
            capabilities: configured.capabilityRecords.map((record) => ({ ...record })),
            whisperBackendPreference: configured.whisperBackendPreference,
          }
        },
        onChanged: () => setRevision((current) => current + 1),
        onProgress: (videoId, next) => setProgress((current) => {
          if (next) return { ...current, [videoId]: next }
          const { [videoId]: _removed, ...remaining } = current
          return remaining
        }),
        onError: (context, error) => console.error(`[AppImportOwner] ${context} error`, error),
        onWarning: (message, error) => {
          console.warn(`[AppImportOwner] ${message}`, error)
          const detail = error instanceof Error ? error.message : String(error)
          setWarning(detail ? `${message}：${detail}` : message)
        },
      })
      setConnection({ db, controller, databaseError: '' })
      void subscribeProgress(controller.acceptProgress).then((release) => {
        if (disposed) release()
        else unsubscribe = release
      }).catch((error) => console.error('[AppImportOwner] 进度订阅失败', error))
    }).catch((error) => {
      if (!disposed) setConnection({ db: null, controller: null, databaseError: error instanceof Error ? error.message : String(error) })
    })
    return () => { disposed = true; unsubscribe?.() }
  }, [])

  return <ImportContext.Provider value={{
    ...connection, revision, progress, warning, clearWarning: () => setWarning(''),
  }}>{children}</ImportContext.Provider>
}

export function useAppImport() {
  const session = useContext(ImportContext)
  if (!session) throw new Error('VideoListPage requires AppImportOwner')
  return session
}
