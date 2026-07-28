import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const verifier = resolve(process.cwd(), 'scripts/verify-e2e-build-isolation.mjs')
const fixtureRoots: string[] = []

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function createBuildFixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'rain-build-isolation-'))
  fixtureRoots.push(root)

  for (const [relativePath, contents] of Object.entries(files)) {
    const file = join(root, 'dist', relativePath)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, contents, 'utf8')
  }

  return root
}

describe('E2E build isolation verifier', () => {
  it('rejects an E2E marker hidden in a production source map', () => {
    const root = createBuildFixture({
      'assets/app.js': 'console.log("rain")',
      'assets/app.js.map': JSON.stringify({
        version: 3,
        sourcesContent: ['window.__RAIN_E2E_RESULT__ = {}'],
      }),
    })

    const result = spawnSync(process.execPath, [verifier, 'production'], {
      cwd: root,
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('__RAIN_E2E_RESULT__')
  })
})
