import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error The production policy is a directly executable Node ESM module.
import { validateDatabaseArchitectureSources } from './database-architecture-policy.mjs'

function productionSources(): Record<string, string> {
  const repoRoot = process.cwd()
  const sourceRoot = resolve(repoRoot, 'src')
  const sources: Record<string, string> = {}
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) {
        if (path !== resolve(sourceRoot, '__tests__')) visit(path)
      } else if (/\.tsx?$/.test(entry)) {
        sources[relative(repoRoot, path).replaceAll('\\', '/')] = readFileSync(path, 'utf8')
      }
    }
  }
  visit(sourceRoot)
  return sources
}

describe('AC-AR-01 database architecture policy', () => {
  it('rejects loading the Tauri SQL plugin outside the public database entry', () => {
    const errors = validateDatabaseArchitectureSources({
      'src/models/database.ts': `
        import type TauriSqlPlugin from '@tauri-apps/plugin-sql'
        export async function createDatabase() {
          return import('@tauri-apps/plugin-sql')
        }
      `,
      'src/pages/BadPage.tsx': `
        import Database from '@tauri-apps/plugin-sql'
        export const BadPage = () => Database
      `,
    })

    expect(errors).toEqual([
      'src/pages/BadPage.tsx loads @tauri-apps/plugin-sql outside src/models/database.ts.',
    ])
  })

  it('rejects production callers that bypass the public database entry', () => {
    const errors = validateDatabaseArchitectureSources({
      'src/models/database-settings.ts': `
        import type { Database } from './database-adapter'
        export const save = (db: Database) => db
      `,
      'src/store/bad-settings.ts': `
        import { setSetting } from '@/models/database-settings'
        export const save = setSetting
      `,
    })

    expect(errors).toEqual([
      'src/store/bad-settings.ts imports internal database module @/models/database-settings outside src/models.',
    ])
  })

  it('rejects relative imports that bypass the public database entry', () => {
    const errors = validateDatabaseArchitectureSources({
      'src/pages/BadPage.tsx': `
        import { setSetting } from '../models/database-settings'
        export const save = setSetting
      `,
    })

    expect(errors).toEqual([
      'src/pages/BadPage.tsx imports internal database module ../models/database-settings outside src/models.',
    ])
  })

  it('rejects newly added database internals without a policy allowlist update', () => {
    const errors = validateDatabaseArchitectureSources({
      'src/pipeline/bad-import.ts': `
        import { save } from '@/models/database-future-feature'
        export const run = save
      `,
    })

    expect(errors).toEqual([
      'src/pipeline/bad-import.ts imports internal database module @/models/database-future-feature outside src/models.',
    ])
  })

  it('rejects frontend modules that orchestrate SQL transactions', () => {
    const errors = validateDatabaseArchitectureSources({
      'src/models/database-import-atomic.ts': `
        export async function save(db: { exec(sql: string): Promise<void> }) {
          await db.exec('BEGIN')
          try {
            await db.exec('INSERT INTO sentence (id) VALUES ($1)')
            await db.exec('COMMIT')
          } catch (error) {
            await db.exec('ROLLBACK')
            throw error
          }
        }
      `,
    })

    expect(errors).toEqual([
      'src/models/database-import-atomic.ts orchestrates a frontend SQL transaction; use one Rust transaction command.',
    ])
  })

  it('keeps the real production tree inside the confirmed database boundary', () => {
    expect(validateDatabaseArchitectureSources(productionSources())).toEqual([])
  })
})
