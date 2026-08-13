import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..')
const modulePath = join(repoRoot, 'scripts', 'controlled-owned-directory.psm1')
const temporaryRoots: string[] = []

function resolvePowerShellExecutable() {
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    const probe = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$null'], { encoding: 'utf8', windowsHide: true })
    if (probe.status === 0) return candidate
  }
  throw new Error('controlled owned-directory tests require PowerShell.')
}

const powerShellExecutable = resolvePowerShellExecutable()

function psQuoted(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function newTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'rain-owned-directory-test-'))
  temporaryRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('controlled build owned-directory lifecycle', () => {
  it('rejects whitespace reservation and authority tokens and returns only v2 reservations', () => {
    const parent = newTemporaryRoot()
    const target = join(parent, 'tokens')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${psQuoted(modulePath)} -Force`,
      '$errors = [System.Collections.Generic.List[string]]::new()',
      `try { New-RainControlledDirectoryReservation -Path ${psQuoted(target)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken '   ' } catch { [void]$errors.Add($_.Exception.Message) }`,
      `$reservation = New-RainControlledDirectoryReservation -Path ${psQuoted(target)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret'`,
      `try { Open-RainControlledDirectoryReservation -Path ${psQuoted(target)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -ReservationToken ([string][char]9) -CleanupAuthorityToken 'authority-secret' } catch { [void]$errors.Add($_.Exception.Message) }`,
      `try { Remove-RainControlledOwnedDirectory -Path ${psQuoted(target)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -ReservationToken $reservation.token -CleanupAuthorityToken ([string][char]9) } catch { [void]$errors.Add($_.Exception.Message) }`,
      `try { Invoke-RainControlledDirectoryCleanup -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken '   ' } catch { [void]$errors.Add($_.Exception.Message) }`,
      '[ordered]@{ errors = @($errors); typeNames = @($reservation.PSObject.TypeNames) } | ConvertTo-Json -Compress',
    ].join('; ')
    const output = execFileSync(powerShellExecutable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8', windowsHide: true })
    const result = JSON.parse(output.trim().split(/\r?\n/).at(-1)!)
    expect(result.errors).toHaveLength(4)
    expect(result.errors.join(' ')).toMatch(/blank|empty/i)
    expect(result.typeNames).toContain('Rain.ControlledDirectoryReservation.v2')
    expect(result.typeNames).not.toContain('Rain.ControlledDirectoryReservation.v1')
    expect(existsSync(target)).toBe(false)
  })

  it('requires tokens on direct APIs and preserves a same-owner forged marker and foreign directory during authority sweep', () => {
    const parent = newTemporaryRoot()
    const target = join(parent, 'foreign')
    mkdirSync(target)
    writeFileSync(join(target, 'keep.txt'), 'foreign')
    const marker = join(parent, '.foreign.rain-controlled-owned.json')
    writeFileSync(marker, JSON.stringify({ schemaVersion: 2, ownerId: 'run-123-1', targetPath: realpathSync.native(target), tokenSha256: '0'.repeat(64), authorityHmac: '0'.repeat(64) }))
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${psQuoted(modulePath)} -Force`,
      '$bindingErrors = [System.Collections.Generic.List[string]]::new()',
      `try { Open-RainControlledDirectoryReservation -Path ${psQuoted(target)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret' } catch { [void]$bindingErrors.Add($_.Exception.Message) }`,
      `try { Remove-RainControlledOwnedDirectory -Path ${psQuoted(target)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret' } catch { [void]$bindingErrors.Add($_.Exception.Message) }`,
      '$sweepError = $null',
      `try { Invoke-RainControlledDirectoryCleanup -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret' } catch { $sweepError = $_.Exception.Message }`,
      '[ordered]@{ bindingErrors = @($bindingErrors); sweepError = $sweepError } | ConvertTo-Json -Compress',
    ].join('; ')
    const output = execFileSync(powerShellExecutable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8', windowsHide: true })
    const result = JSON.parse(output.trim().split(/\r?\n/).at(-1)!)
    expect(result.bindingErrors.join(' ')).toMatch(/ReservationToken/i)
    expect(result.sweepError).toMatch(/HMAC|authority/i)
    expect(existsSync(join(target, 'keep.txt'))).toBe(true)
  })

  it('keeps the random reservation token out of the marker and rejects a forged token', () => {
    const parent = newTemporaryRoot()
    const target = join(parent, 'downloads')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${psQuoted(modulePath)} -Force`,
      `$reservation = New-RainControlledDirectoryReservation -Path ${psQuoted(target)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret'`,
      '$markerText = Get-Content -LiteralPath $reservation.markerPath -Raw',
      '$errorText = $null',
      `try { Open-RainControlledDirectoryReservation -Path ${psQuoted(target)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -ReservationToken 'forged-token' -CleanupAuthorityToken 'authority-secret' } catch { $errorText = $_.Exception.Message }`,
      '[ordered]@{ token = $reservation.token; markerText = $markerText; error = $errorText } | ConvertTo-Json -Compress',
    ].join('; ')
    const output = execFileSync(powerShellExecutable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8', windowsHide: true })
    const result = JSON.parse(output.trim().split(/\r?\n/).at(-1)!)
    expect(result.markerText).not.toContain(result.token)
    expect(result.error).toContain('token does not match')
  })

  it('refuses a pre-existing target and never removes that unowned directory', () => {
    const parent = newTemporaryRoot()
    const target = join(parent, 'preexisting-archive')
    mkdirSync(target)
    writeFileSync(join(target, 'keep.txt'), 'user-owned fixture')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${psQuoted(modulePath)} -Force`,
      '$errorText = $null',
      `try { New-RainControlledDirectoryReservation -Path ${psQuoted(target)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret' } catch { $errorText = $_.Exception.Message }`,
      `try { Remove-RainControlledOwnedDirectory -Path ${psQuoted(target)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -ReservationToken 'forged-token' -CleanupAuthorityToken 'authority-secret' } catch { }`,
      '[ordered]@{ error = $errorText } | ConvertTo-Json -Compress',
    ].join('; ')

    const output = execFileSync(powerShellExecutable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8', windowsHide: true })
    const result = JSON.parse(output.trim().split(/\r?\n/).at(-1)!)
    expect(result.error).toContain('already exists')
    expect(existsSync(join(target, 'keep.txt'))).toBe(true)
  })

  it('removes only a matching reservation and aggregates directory and marker cleanup failures', () => {
    const parent = newTemporaryRoot()
    const first = join(parent, 'downloads')
    const second = join(parent, 'archive')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${psQuoted(modulePath)} -Force`,
      `New-RainControlledDirectoryReservation -Path ${psQuoted(first)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret' | Out-Null`,
      `New-RainControlledDirectoryReservation -Path ${psQuoted(second)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret' | Out-Null`,
      `New-Item -ItemType Directory -Path ${psQuoted(first)}, ${psQuoted(second)} | Out-Null`,
      "$adapter = [pscustomobject]@{ removeDirectory = { param($path) if ($path -like '*downloads') { throw 'simulated directory cleanup failure' }; Remove-Item -LiteralPath $path -Recurse -Force }; removeFile = { param($path) if ($path -like '*archive*') { throw 'simulated marker cleanup failure' }; Remove-Item -LiteralPath $path -Force } }",
      '$errorText = $null',
      `try { Invoke-RainControlledDirectoryCleanup -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret' -Adapter $adapter } catch { $errorText = $_.Exception.Message }`,
      '[ordered]@{ error = $errorText; markers = @(Get-ChildItem -LiteralPath ' + psQuoted(parent) + " -Force -Filter '*.rain-controlled-owned.json').Count } | ConvertTo-Json -Compress",
    ].join('; ')

    const output = execFileSync(powerShellExecutable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { encoding: 'utf8', windowsHide: true })
    const result = JSON.parse(output.trim().split(/\r?\n/).at(-1)!)
    expect(result.error).toContain('simulated directory cleanup failure')
    expect(result.error).toContain('simulated marker cleanup failure')
    expect(result.markers).toBe(2)
    expect(existsSync(first)).toBe(true)
    expect(existsSync(second)).toBe(false)

    const retry = [
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${psQuoted(modulePath)} -Force`,
      `Invoke-RainControlledDirectoryCleanup -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret'`,
    ].join('; ')
    execFileSync(powerShellExecutable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', retry], { encoding: 'utf8', windowsHide: true })
    expect(existsSync(first)).toBe(false)
    expect(readdirSync(parent).filter((name) => name.endsWith('.rain-controlled-owned.json'))).toEqual([])
  })
})
