import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const settingsUiRoot = resolve(repoRoot, 'src/ui/components/settings')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry) ? [path] : []
  })
}

describe('settings UI boundary', () => {
  it('hydrates and persists runtime settings only through the Store interface', () => {
    const forbiddenModules = ['@/models/database', '@/models/db-singleton']
    const violations = sourceFiles(settingsUiRoot).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return forbiddenModules
        .filter((moduleName) => source.includes(moduleName))
        .map((moduleName) => `${relative(repoRoot, path)} -> ${moduleName}`)
    })

    expect(violations).toEqual([])
  })
})
