import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..')
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const gpuConfig = JSON.parse(
  readFileSync(join(repoRoot, 'src-tauri', 'tauri.gpu.conf.json'), 'utf8'),
)

describe('GPU release bundle contract', () => {
  it('builds the isolated worker before invoking the GPU Tauri overlay', () => {
    expect(packageJson.scripts['bundle:gpu']).toBe(
      'npm run build:whisper-gpu-worker && tauri build --config src-tauri/tauri.gpu.conf.json',
    )
  })

  it('emits one NSIS installer instead of only the release executable', () => {
    expect(gpuConfig.bundle.active).toBe(true)
    expect(gpuConfig.bundle.targets).toEqual(['nsis'])
  })
})
