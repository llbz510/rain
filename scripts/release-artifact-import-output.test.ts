import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const modulePath = join(__dirname, 'release-artifact-generator.psm1')
const ps = ['pwsh.exe', 'powershell.exe'].find((candidate) => spawnSync(candidate, ['-NoProfile', '-Command', '$null'], { windowsHide: true }).status === 0)!
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`

function validate(output: string, exitCode = 0) {
  const command = `$ErrorActionPreference='Stop'; Import-Module ${quote(modulePath)} -Force; $errorText=$null; $value=$null; try { $value=Assert-RainReleaseArtifactPeImportOutput -Output ${quote(output)} -ExitCode ${exitCode} } catch { $errorText=$_.Exception.Message }; [ordered]@{value=$value;error=$errorText}|ConvertTo-Json -Compress`
  return JSON.parse(execFileSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).at(-1)!)
}

describe('release artifact PE import output', () => {
  it('rejects exit-zero blank and unrecognizable dumpbin output', () => {
    expect(validate('').error).toMatch(/blank/i)
    expect(validate('Microsoft (R) COFF/PE Dumper Version 14').error).toMatch(/import table/i)
    expect(validate('Section contains the following imports:\r\n    KERNEL32.dll', 7).error).toMatch(/exit code 7/i)
  })
  it('accepts a valid import table without CUDA imports', () => {
    expect(validate('Section contains the following imports:\r\n    KERNEL32.dll\r\n      123 ExitProcess').error).toBeNull()
  })
})
