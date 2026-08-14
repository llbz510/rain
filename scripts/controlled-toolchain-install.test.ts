import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..')
const modulePath = join(repoRoot, 'scripts', 'controlled-toolchain-install.psm1')
const ownedDirectoryModulePath = join(repoRoot, 'scripts', 'controlled-owned-directory.psm1')
const temporaryRoots: string[] = []

function resolvePowerShellExecutable() {
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    const probe = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$null'], { encoding: 'utf8', windowsHide: true })
    if (probe.status === 0) return candidate
  }
  throw new Error('controlled toolchain tests require PowerShell.')
}

const powerShellExecutable = resolvePowerShellExecutable()

function psQuoted(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function newTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'rain-toolchain-test-'))
  temporaryRoots.push(root)
  return root
}

function invokeScript(lines: string[]) {
  const output = execFileSync(powerShellExecutable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', lines.join('; ')], { encoding: 'utf8', windowsHide: true })
  return JSON.parse(output.trim().split(/\r?\n/).at(-1)!)
}

function ownedSetup(parent: string, downloads: string, cmake: string) {
  return [
    `Import-Module ${psQuoted(ownedDirectoryModulePath)} -Force`,
    `$downloadsReservation = New-RainControlledDirectoryReservation -Path ${psQuoted(downloads)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret'`,
    `New-Item -ItemType Directory -Path ${psQuoted(downloads)} | Out-Null`,
    `$cmakeReservation = New-RainControlledDirectoryReservation -Path ${psQuoted(cmake)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret'`,
  ]
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('controlled toolchain install transaction', () => {
  it('rejects an unowned DownloadsRoot token before installing or deleting anything', () => {
    const result = invokeScript([
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${psQuoted(modulePath)} -Force`,
      '$events = [System.Collections.Generic.List[string]]::new()',
      "$adapter = [pscustomobject]@{ install = { [void]$events.Add('install') }; remove = { [void]$events.Add('remove') }; expand = { [void]$events.Add('expand') }; pathExists = { return $false }; cmakeVersion = { return '4.0.0' }; appendLine = {}; diskGate = { [void]$events.Add('disk-gate') } }",
      '$errorText = $null',
      "try { Invoke-RainControlledToolchainInstall -DownloadsRoot 'C:\\unowned' -CmakeExtractRoot 'C:\\unowned-cmake' -OwnershipParent 'C:\\' -OwnerId 'run-123-1' -DownloadsReservationToken 'forged-download-token' -CmakeReservationToken 'forged-cmake-token' -CleanupAuthorityToken 'authority-secret' -ExpectedCmakeVersion '4.0.0' -GitHubPathFile 'C:\\fixture\\github-path' -GitHubEnvFile 'C:\\fixture\\github-env' -Adapter $adapter } catch { $errorText = $_.Exception.Message }",
      '[ordered]@{ events = @($events); error = $errorText } | ConvertTo-Json -Compress',
    ])
    expect(result.error).toMatch(/reservation|token/i)
    expect(result.events).toEqual([])
  })

  it('attempts every owned cleanup and the disk gate before aggregating the main and cleanup failures', () => {
    const parent = newTemporaryRoot()
    const downloads = join(parent, 'downloads')
    const cmake = join(parent, 'cmake')
    const result = invokeScript([
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${psQuoted(modulePath)} -Force`,
      ...ownedSetup(parent, downloads, cmake),
      '$events = [System.Collections.Generic.List[string]]::new()',
      "$adapter = [pscustomobject]@{ install = {}; remove = {}; expand = { param($archive, $destination) New-Item -ItemType Directory -Path $destination | Out-Null }; pathExists = { param($path, $kind) if ($kind -eq 'container') { return Test-Path -LiteralPath $path -PathType Container }; return $true }; cmakeVersion = { throw 'simulated main verification failure' }; appendLine = {}; diskGate = { param($stage) [void]$events.Add(('disk-gate:' + $stage)); if ($stage -eq 'after-tool-install-cleanup') { throw 'simulated disk cleanup gate failure' } } }",
      "$cleanupAdapter = [pscustomobject]@{ removeDirectory = { param($path) $leaf = [System.IO.Path]::GetFileName($path); [void]$events.Add(('owned-remove:' + $leaf)); throw ('simulated ' + $leaf + ' cleanup failure') }; removeFile = { param($path) Remove-Item -LiteralPath $path -Force } }",
      '$errorText = $null',
      `try { Invoke-RainControlledToolchainInstall -DownloadsRoot ${psQuoted(downloads)} -CmakeExtractRoot ${psQuoted(cmake)} -OwnershipParent ${psQuoted(parent)} -OwnerId 'run-123-1' -DownloadsReservationToken $downloadsReservation.token -CmakeReservationToken $cmakeReservation.token -CleanupAuthorityToken 'authority-secret' -ExpectedCmakeVersion '4.0.0' -GitHubPathFile 'C:\\fixture\\github-path' -GitHubEnvFile 'C:\\fixture\\github-env' -Adapter $adapter -OwnershipCleanupAdapter $cleanupAdapter } catch { $errorText = $_.Exception.Message }`,
      '[ordered]@{ events = @($events); error = $errorText } | ConvertTo-Json -Compress',
    ])
    expect(result.events).toEqual(['disk-gate:before-install', 'owned-remove:downloads', 'owned-remove:cmake', 'disk-gate:after-tool-install-cleanup'])
    expect(result.error).toContain('simulated main verification failure')
    expect(result.error).toContain('simulated downloads cleanup failure')
    expect(result.error).toContain('simulated cmake cleanup failure')
    expect(result.error).toContain('simulated disk cleanup gate failure')
  })

  it('accepts matching reservations, cleans downloads through ownership, and retains ready CMake', () => {
    const parent = newTemporaryRoot()
    const downloads = join(parent, 'downloads')
    const cmake = join(parent, 'cmake')
    const result = invokeScript([
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${psQuoted(modulePath)} -Force`,
      ...ownedSetup(parent, downloads, cmake),
      '$state = [pscustomobject]@{ expanded = $false; removed = [System.Collections.Generic.List[string]]::new(); envLines = [System.Collections.Generic.List[string]]::new(); beforePaths = @() }',
      "$adapter = [pscustomobject]@{ install = {}; remove = { param($path) [void]$state.removed.Add($path) }; expand = { $state.expanded = $true }; pathExists = { param($path, $kind) if ($kind -eq 'container') { return $state.expanded }; return $true }; cmakeVersion = { return '4.0.0' }; appendLine = { param($path, $line) if ($path -like '*github-env') { [void]$state.envLines.Add($line) } }; diskGate = { param($stage, $paths) if ($stage -eq 'before-install') { $state.beforePaths = @($paths) } } }",
      `$toolchain = Invoke-RainControlledToolchainInstall -DownloadsRoot ${psQuoted(downloads)} -CmakeExtractRoot ${psQuoted(cmake)} -OwnershipParent ${psQuoted(parent)} -OwnerId 'run-123-1' -DownloadsReservationToken $downloadsReservation.token -CmakeReservationToken $cmakeReservation.token -CleanupAuthorityToken 'authority-secret' -ExpectedCmakeVersion '4.0.0' -GitHubPathFile 'C:\\fixture\\github-path' -GitHubEnvFile 'C:\\fixture\\github-env' -Adapter $adapter`,
      '[ordered]@{ toolchain = $toolchain; removed = @($state.removed); envLines = @($state.envLines); beforePaths = @($state.beforePaths) } | ConvertTo-Json -Depth 5 -Compress',
    ])
    expect(result.toolchain).toMatchObject({ cmakeReady: true, cmakeRoot: cmake })
    expect(result.removed).not.toContain(downloads)
    expect(result.removed).not.toContain(cmake)
    expect(result.envLines.at(-1)).toBe(`CMAKE_ROOT=${cmake}`)
    expect(result.beforePaths).toEqual([downloads, cmake, 'C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA\\v12.9', 'C:\\Program Files\\LLVM', 'C:\\Program Files (x86)\\NSIS'])
    expect(existsSync(downloads)).toBe(false)
  })

  it('refuses a pre-existing CMake root without installing tools or deleting that unowned directory', () => {
    const parent = newTemporaryRoot()
    const downloads = join(parent, 'downloads')
    const cmake = join(parent, 'preexisting-cmake')
    const sentinel = join(cmake, 'keep.txt')
    mkdirSync(cmake)
    writeFileSync(sentinel, 'user-owned fixture')
    const result = invokeScript([
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${psQuoted(modulePath)} -Force`,
      `Import-Module ${psQuoted(ownedDirectoryModulePath)} -Force`,
      `$downloadsReservation = New-RainControlledDirectoryReservation -Path ${psQuoted(downloads)} -AllowedParent ${psQuoted(parent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret'`,
      `New-Item -ItemType Directory -Path ${psQuoted(downloads)} | Out-Null`,
      '$events = [System.Collections.Generic.List[string]]::new()',
      "$adapter = [pscustomobject]@{ install = { [void]$events.Add('install') }; remove = { [void]$events.Add('remove') }; expand = { [void]$events.Add('expand') }; pathExists = { return $false }; cmakeVersion = { return '4.0.0' }; appendLine = {}; diskGate = { [void]$events.Add('disk-gate') } }",
      '$errorText = $null',
      `try { Invoke-RainControlledToolchainInstall -DownloadsRoot ${psQuoted(downloads)} -CmakeExtractRoot ${psQuoted(cmake)} -OwnershipParent ${psQuoted(parent)} -OwnerId 'run-123-1' -DownloadsReservationToken $downloadsReservation.token -CmakeReservationToken 'forged-cmake-token' -CleanupAuthorityToken 'authority-secret' -ExpectedCmakeVersion '4.0.0' -GitHubPathFile 'C:\\fixture\\github-path' -GitHubEnvFile 'C:\\fixture\\github-env' -Adapter $adapter } catch { $errorText = $_.Exception.Message }`,
      '[ordered]@{ events = @($events); error = $errorText } | ConvertTo-Json -Compress',
    ])
    expect(result.error).toMatch(/reservation|token/i)
    expect(result.events).toEqual([])
    expect(existsSync(sentinel)).toBe(true)
  })
})
