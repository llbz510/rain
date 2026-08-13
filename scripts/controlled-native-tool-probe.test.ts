import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const modulePath = join(__dirname, 'controlled-native-tool-probe.psm1')

function resolvePowerShellExecutable() {
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    const probe = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$null'], { encoding: 'utf8', windowsHide: true })
    if (probe.status === 0) return candidate
  }
  throw new Error('controlled native-tool probe tests require PowerShell.')
}

const powerShellExecutable = resolvePowerShellExecutable()

function psQuoted(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function invokeProbe(adapterBody: string) {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `Import-Module ${psQuoted(modulePath)} -Force`,
    `$adapter = { param($path, $arguments) ${adapterBody} }`,
    '$errorText = $null',
    '$result = $null',
    "try { $result = Invoke-RainControlledNativeToolProbe -Name 'fixture' -Path 'C:\\fixture\\tool.exe' -Arguments @('--version') -Adapter $adapter } catch { $errorText = $_.Exception.Message }",
    '[ordered]@{ result = $result; error = $errorText } | ConvertTo-Json -Depth 5 -Compress',
  ].join('; ')
  const output = execFileSync(powerShellExecutable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true })
  return JSON.parse(output.trim().split(/\r?\n/).at(-1)!)
}

describe('controlled native-tool probe', () => {
  it('rejects a nonzero native exit immediately even when the tool printed plausible version output', () => {
    const result = invokeProbe("return [pscustomobject]@{ output = 'fixture 9.9.9'; exitCode = 7 }")
    expect(result.result).toBeNull()
    expect(result.error).toContain("Native tool probe 'fixture' failed with exit code 7")
    expect(result.error).toContain('fixture 9.9.9')
  })

  it('returns normalized facts only after a zero-exit, nonblank probe', () => {
    const result = invokeProbe("return [pscustomobject]@{ output = \"fixture 1.2.3`r`n\"; exitCode = 0 }")
    expect(result.error).toBeNull()
    expect(result.result).toMatchObject({ name: 'fixture', path: 'C:\\fixture\\tool.exe', arguments: ['--version'], output: 'fixture 1.2.3', exitCode: 0 })
  })

  it('rejects a zero-exit probe whose output is blank', () => {
    const result = invokeProbe("return [pscustomobject]@{ output = '   '; exitCode = 0 }")
    expect(result.result).toBeNull()
    expect(result.error).toContain('blank version output')
  })
})
