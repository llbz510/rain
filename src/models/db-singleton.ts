// src/models/db-singleton.ts
import { createDatabase, type Database } from './database'
import { isTauri, tauriInvoke } from '@/lib/tauri-env'

let instance: Database | null = null
let initPromise: Promise<Database> | null = null

interface RealE2eDatabaseConfig {
  enabled?: boolean
  databasePath?: string
}

async function resolveDatabasePath(): Promise<string> {
  if (!isTauri()) return ':memory:'
  try {
    const config = await tauriInvoke<RealE2eDatabaseConfig | null>('get_real_e2e_config')
    if (config?.enabled && config.databasePath?.trim()) return config.databasePath
  } catch {
    // Normal desktop startup falls back to the application database.
  }
  return 'rain.db'
}

export async function getDb(): Promise<Database> {
  if (instance) return instance
  if (initPromise) return initPromise

  initPromise = resolveDatabasePath()
    .then((path) => createDatabase(path))
    .then((db) => {
      instance = db
      return db
    })

  return initPromise
}

export function resetDb(): void {
  instance = null
  initPromise = null
}
