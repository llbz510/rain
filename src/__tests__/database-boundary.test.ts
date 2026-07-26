import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDatabase } from '@/models/database'

const repoRoot = process.cwd()
const sourceRoot = resolve(repoRoot, 'src')
const modelsRoot = resolve(sourceRoot, 'models')

function sourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry)) files.push(path)
  }
  return files
}

describe('database adapter seam', () => {
  it('does not advertise raw SQL on the memory adapter', async () => {
    const db = await createDatabase(':memory:')

    expect(db.adapterKind).toBe('memory')
    expect(db).not.toHaveProperty('exec')
    expect(db).not.toHaveProperty('query')
  })

  it('keeps database internals behind the public database entry', () => {
    const internalModuleNames = [
      'database-adapter',
      'database-checkpoints',
      'database-import-state',
      'database-schema',
    ]
    const violations = sourceFiles(sourceRoot)
      .filter((path) => !path.includes(join('src', '__tests__')))
      .filter((path) => relative(modelsRoot, path).startsWith('..'))
      .flatMap((path) => {
        const source = readFileSync(path, 'utf8')
        return internalModuleNames
          .filter((moduleName) => source.includes(moduleName))
          .map((moduleName) => `${relative(repoRoot, path)} -> ${moduleName}`)
      })

    expect(violations).toEqual([])
  })
})
