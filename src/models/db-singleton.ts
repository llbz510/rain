// src/models/db-singleton.ts
import { createDatabase, type Database } from './database'
import { isTauri } from '@/lib/tauri-env'

let instance: Database | null = null
let initPromise: Promise<Database> | null = null

export async function getDb(): Promise<Database> {
  if (instance) return instance
  if (initPromise) return initPromise

  initPromise = createDatabase(isTauri() ? 'rain.db' : ':memory:').then((db) => {
    instance = db
    return db
  })

  return initPromise
}

export function resetDb(): void {
  instance = null
  initPromise = null
}
