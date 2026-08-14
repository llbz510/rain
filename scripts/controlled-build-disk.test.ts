import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const modulePath = join(__dirname, 'controlled-build-disk.psm1')

function invoke(script: string) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8', windowsHide: true,
  })
}

describe('controlled build disk gates', () => {
  it('probes every distinct volume represented by the actual stage paths', () => {
    const result = invoke([
      `$module = Import-Module -Name '${modulePath.replace(/'/g, "''")}' -Force -PassThru`,
      `$probe = { param([string]$VolumeRoot) if ($VolumeRoot -eq 'C:\\') { return 30GB }; if ($VolumeRoot -eq 'D:\\') { return 20GB }; throw "unexpected $VolumeRoot" }`,
      `Assert-ControlledBuildPathsFreeBytes -Stage 'multi-volume' -Paths @('C:\\runner\\temp', 'D:\\work\\rain', 'D:\\work\\rain\\target') -MinimumBytes 12GB -VolumeProbe $probe | ConvertTo-Json -Compress`,
    ].join('; '))
    expect(result.status).toBe(0)
    const records = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!)
    expect(records).toHaveLength(2)
    expect(records.map((record: { volumeRoot: string }) => record.volumeRoot).sort()).toEqual(['C:\\', 'D:\\'])
  })

  it('fails when the non-system volume hosting a build root is below threshold', () => {
    const result = invoke([
      `$module = Import-Module -Name '${modulePath.replace(/'/g, "''")}' -Force -PassThru`,
      `$probe = { param([string]$VolumeRoot) if ($VolumeRoot -eq 'C:\\') { return 30GB } else { return 2GB } }`,
      `Assert-ControlledBuildPathsFreeBytes -Stage 'multi-volume' -Paths @('C:\\runner\\temp', 'D:\\work\\rain\\target') -MinimumBytes 12GB -VolumeProbe $probe`,
    ].join('; '))
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('D:\\')
    expect(`${result.stdout}\n${result.stderr}`).toContain('multi-volume')
  })
})
