import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('waits for a hidden installer process, uses its ExitCode, and does not read LASTEXITCODE for installation', () => {
    const result = invokeScript([
      "$ErrorActionPreference = 'Stop'",
      'Import-Module ' + psQuoted(modulePath) + ' -Force',
      "$state = [pscustomobject]@{ filePath = $null; argumentList = @(); wait = $false; passThru = $false; windowStyle = $null }",
      "$processAdapter = { param([string]$FilePath, [string[]]$ArgumentList, [switch]$Wait, [switch]$PassThru, [string]$WindowStyle) $state.filePath = $FilePath; $state.argumentList = @($ArgumentList); $state.wait = $Wait.IsPresent; $state.passThru = $PassThru.IsPresent; $state.windowStyle = $WindowStyle; return [pscustomobject]@{ ExitCode = 0 } }",
      '$adapter = New-RainControlledToolchainInstallAdapter -ProcessAdapter $processAdapter',
      "& $adapter.install 'C:\\fixture\\cuda.exe' @('-s') 'CUDA'",
      "$nonzeroProcessAdapter = { param([string]$FilePath, [string[]]$ArgumentList, [switch]$Wait, [switch]$PassThru, [string]$WindowStyle) return [pscustomobject]@{ ExitCode = 23 } }",
      '$nonzeroAdapter = New-RainControlledToolchainInstallAdapter -ProcessAdapter $nonzeroProcessAdapter',
      '$errorText = $null',
      "try { & $nonzeroAdapter.install 'C:\\fixture\\cuda.exe' @('-s') 'CUDA' } catch { $errorText = $_.Exception.Message }",
      "$missingExitCodeProcessAdapter = { param([string]$FilePath, [string[]]$ArgumentList, [switch]$Wait, [switch]$PassThru, [string]$WindowStyle) return [pscustomobject]@{} }",
      '$missingExitCodeAdapter = New-RainControlledToolchainInstallAdapter -ProcessAdapter $missingExitCodeProcessAdapter',
      '$missingExitCodeError = $null',
      "try { & $missingExitCodeAdapter.install 'C:\\fixture\\cuda.exe' @('-s') 'CUDA' } catch { $missingExitCodeError = $_.Exception.Message }",
      '[ordered]@{ filePath = $state.filePath; argumentList = @($state.argumentList); wait = $state.wait; passThru = $state.passThru; windowStyle = $state.windowStyle; error = $errorText; missingExitCodeError = $missingExitCodeError } | ConvertTo-Json -Compress',
    ])
    const moduleSource = readFileSync(modulePath, 'utf8')
    const installStart = moduleSource.indexOf('install = {')
    const installEnd = moduleSource.indexOf('    remove = {', installStart)

    expect(result).toMatchObject({
      filePath: 'C:\\fixture\\cuda.exe',
      wait: true,
      passThru: true,
      windowStyle: 'Hidden',
    })
    expect([result.argumentList].flat()).toEqual(['-s'])
    expect(result.error).toMatch(/CUDA installation failed with exit code 23/i)
    expect(result.missingExitCodeError).toMatch(/CUDA installer did not return an exit code/i)
    expect(moduleSource).toContain('Start-Process -FilePath $Path -ArgumentList $Arguments -Wait -PassThru -WindowStyle Hidden')
    expect(installStart).toBeGreaterThanOrEqual(0)
    expect(installEnd).toBeGreaterThan(installStart)
    expect(moduleSource.slice(installStart, installEnd)).not.toContain('$LASTEXITCODE')
  })

  it('rejects null, text, fractional, and out-of-range installer exit codes', () => {
    const result = invokeScript([
      "$ErrorActionPreference = 'Stop'",
      'Import-Module ' + psQuoted(modulePath) + ' -Force',
      "$invalidExitCodes = [ordered]@{ nullValue = $null; whitespace = ' '; noninteger = '23.5'; outOfRange = [int64]2147483648 }",
      '$invalidExitCodeErrors = [ordered]@{}',
      "foreach ($entry in $invalidExitCodes.GetEnumerator()) { $exitCode = $entry.Value; $processAdapter = { param([string]$FilePath, [string[]]$ArgumentList, [switch]$Wait, [switch]$PassThru, [string]$WindowStyle) return [pscustomobject]@{ ExitCode = $exitCode } }.GetNewClosure(); $adapter = New-RainControlledToolchainInstallAdapter -ProcessAdapter $processAdapter; $errorText = $null; try { & $adapter.install 'C:\\fixture\\cuda.exe' @('-s') 'CUDA' } catch { $errorText = $_.Exception.Message }; $invalidExitCodeErrors[$entry.Key] = $errorText }",
      '[ordered]@{ invalidExitCodeErrors = $invalidExitCodeErrors } | ConvertTo-Json -Depth 5 -Compress',
    ])

    expect(Object.keys(result.invalidExitCodeErrors).sort()).toEqual(['noninteger', 'nullValue', 'outOfRange', 'whitespace'])
    for (const error of Object.values(result.invalidExitCodeErrors)) {
      expect(error).toMatch(/CUDA installer returned an invalid exit code/i)
    }
  })

  it('retries a transient locked installer file only after the installer fake has completed', () => {
    const parent = newTemporaryRoot()
    const downloads = join(parent, 'downloads')
    const cmake = join(parent, 'cmake')
    const cmakePackageRoot = join(cmake, 'cmake-4.0.0-windows-x86_64')
    const cmakePath = join(cmakePackageRoot, 'bin', 'cmake.exe')
    const result = invokeScript([
      "$ErrorActionPreference = 'Stop'",
      'Import-Module ' + psQuoted(modulePath) + ' -Force',
      ...ownedSetup(parent, downloads, cmake),
      '$state = [pscustomobject]@{ cudaInstallCompleted = $false; cudaDeleteAttempts = 0; expanded = $false; events = [System.Collections.Generic.List[string]]::new(); delays = [System.Collections.Generic.List[int]]::new() }',
      "$adapter = [pscustomobject]@{ install = { param($path, $arguments, $description) [void]$state.events.Add(('install:' + $description)); if ($description -eq 'CUDA') { $state.cudaInstallCompleted = $true } }; remove = { param($path, $recurse) $leaf = [System.IO.Path]::GetFileName($path); if ($leaf -eq 'cuda.exe') { if (-not $state.cudaInstallCompleted) { throw 'CUDA file cleanup started before the installer completed' }; $state.cudaDeleteAttempts++; [void]$state.events.Add(('remove:cuda.exe:' + $state.cudaDeleteAttempts)); if ($state.cudaDeleteAttempts -eq 1) { throw 'simulated transient CUDA lock' }; return }; [void]$state.events.Add(('remove:' + $leaf)) }; sleep = { param($milliseconds) [void]$state.delays.Add([int]$milliseconds); [void]$state.events.Add(('sleep:' + $milliseconds)) }; expand = { param($archive, $destination) $state.expanded = $true; [void]$state.events.Add('expand') }; pathExists = { param($path, $kind) if ($kind -eq 'container') { return $state.expanded }; return $true }; cmakeVersion = { return '4.0.0' }; appendLine = {}; diskGate = {} }",
      '$toolchain = Invoke-RainControlledToolchainInstall -DownloadsRoot ' + psQuoted(downloads) + ' -CmakeExtractRoot ' + psQuoted(cmake) + ' -OwnershipParent ' + psQuoted(parent) + " -OwnerId 'run-123-1' -DownloadsReservationToken $downloadsReservation.token -CmakeReservationToken $cmakeReservation.token -CleanupAuthorityToken 'authority-secret' -ExpectedCmakeVersion '4.0.0' -GitHubPathFile 'C:\\fixture\\github-path' -GitHubEnvFile 'C:\\fixture\\github-env' -Adapter $adapter",
      '[ordered]@{ toolchain = $toolchain; cudaDeleteAttempts = $state.cudaDeleteAttempts; events = @($state.events); delays = @($state.delays) } | ConvertTo-Json -Depth 5 -Compress',
    ])

    expect(result.toolchain).toMatchObject({ cmakeReady: true, cmakeRoot: cmakePackageRoot, cmakePath })
    expect(result.cudaDeleteAttempts).toBe(2)
    expect(result.delays).toEqual([250])
    expect(result.events).toEqual([
      'install:CUDA',
      'remove:cuda.exe:1',
      'sleep:250',
      'remove:cuda.exe:2',
      'install:LLVM',
      'remove:llvm.exe',
      'install:NSIS',
      'remove:nsis.exe',
      'expand',
      'remove:cmake.zip',
    ])
  })

  it('reports every bounded retry failure when an installer file remains locked', () => {
    const parent = newTemporaryRoot()
    const downloads = join(parent, 'downloads')
    const cmake = join(parent, 'cmake')
    const result = invokeScript([
      "$ErrorActionPreference = 'Stop'",
      'Import-Module ' + psQuoted(modulePath) + ' -Force',
      ...ownedSetup(parent, downloads, cmake),
      '$state = [pscustomobject]@{ attempts = 0; delays = [System.Collections.Generic.List[int]]::new(); events = [System.Collections.Generic.List[string]]::new() }',
      "$adapter = [pscustomobject]@{ install = { param($path, $arguments, $description) [void]$state.events.Add(('install:' + $description)) }; remove = { param($path, $recurse) if ([System.IO.Path]::GetFileName($path) -eq 'cuda.exe') { $state.attempts++; throw ('simulated persistent CUDA lock attempt ' + $state.attempts) } }; sleep = { param($milliseconds) [void]$state.delays.Add([int]$milliseconds) }; expand = {}; pathExists = { return $false }; cmakeVersion = { return '4.0.0' }; appendLine = {}; diskGate = {} }",
      '$errorText = $null',
      'try { Invoke-RainControlledToolchainInstall -DownloadsRoot ' + psQuoted(downloads) + ' -CmakeExtractRoot ' + psQuoted(cmake) + ' -OwnershipParent ' + psQuoted(parent) + " -OwnerId 'run-123-1' -DownloadsReservationToken $downloadsReservation.token -CmakeReservationToken $cmakeReservation.token -CleanupAuthorityToken 'authority-secret' -ExpectedCmakeVersion '4.0.0' -GitHubPathFile 'C:\\fixture\\github-path' -GitHubEnvFile 'C:\\fixture\\github-env' -Adapter $adapter } catch { $errorText = $_.Exception.Message }",
      '[ordered]@{ attempts = $state.attempts; delays = @($state.delays); events = @($state.events); error = $errorText } | ConvertTo-Json -Compress',
    ])

    expect(result.attempts).toBe(5)
    expect(result.delays).toEqual([250, 250, 250, 250])
    expect(result.events).toEqual(['install:CUDA'])
    expect(result.error).toContain('CUDA toolchain package cleanup failed after 5 attempt(s) (maximum 5)')
    for (const attempt of [1, 2, 3, 4, 5]) {
      expect(result.error).toContain('simulated persistent CUDA lock attempt ' + attempt)
    }
  })

  it('stops after a failed retry delay and reports the actual delete count with both failures', () => {
    const parent = newTemporaryRoot()
    const downloads = join(parent, 'downloads')
    const cmake = join(parent, 'cmake')
    const result = invokeScript([
      "$ErrorActionPreference = 'Stop'",
      'Import-Module ' + psQuoted(modulePath) + ' -Force',
      ...ownedSetup(parent, downloads, cmake),
      '$state = [pscustomobject]@{ deleteAttempts = 0; delayAttempts = 0 }',
      "$adapter = [pscustomobject]@{ install = {}; remove = { param($path, $recurse) if ([System.IO.Path]::GetFileName($path) -eq 'cuda.exe') { $state.deleteAttempts++; throw 'simulated CUDA package lock' } }; sleep = { param($milliseconds) $state.delayAttempts++; throw 'simulated retry delay failure' }; expand = {}; pathExists = { return $false }; cmakeVersion = { return '4.0.0' }; appendLine = {}; diskGate = {} }",
      '$errorText = $null',
      'try { Invoke-RainControlledToolchainInstall -DownloadsRoot ' + psQuoted(downloads) + ' -CmakeExtractRoot ' + psQuoted(cmake) + ' -OwnershipParent ' + psQuoted(parent) + " -OwnerId 'run-123-1' -DownloadsReservationToken $downloadsReservation.token -CmakeReservationToken $cmakeReservation.token -CleanupAuthorityToken 'authority-secret' -ExpectedCmakeVersion '4.0.0' -GitHubPathFile 'C:\\fixture\\github-path' -GitHubEnvFile 'C:\\fixture\\github-env' -Adapter $adapter } catch { $errorText = $_.Exception.Message }",
      '[ordered]@{ deleteAttempts = $state.deleteAttempts; delayAttempts = $state.delayAttempts; error = $errorText } | ConvertTo-Json -Compress',
    ])

    expect(result.deleteAttempts).toBe(1)
    expect(result.delayAttempts).toBe(1)
    expect(result.error).toContain('CUDA toolchain package cleanup failed after 1 attempt(s) (maximum 5)')
    expect(result.error).toContain('simulated CUDA package lock')
    expect(result.error).toContain('simulated retry delay failure')
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
    const cmakePackageRoot = join(cmake, 'cmake-4.0.0-windows-x86_64')
    const cmakePath = join(cmakePackageRoot, 'bin', 'cmake.exe')
    const result = invokeScript([
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${psQuoted(modulePath)} -Force`,
      ...ownedSetup(parent, downloads, cmake),
      '$state = [pscustomobject]@{ expanded = $false; installs = [System.Collections.Generic.List[string]]::new(); removed = [System.Collections.Generic.List[string]]::new(); events = [System.Collections.Generic.List[string]]::new(); envLines = [System.Collections.Generic.List[string]]::new(); beforePaths = @() }',
      "$adapter = [pscustomobject]@{ install = { param($path, $arguments, $description) $entry = ($description + ':' + [System.IO.Path]::GetFileName($path) + ':' + ($arguments -join ',')); [void]$state.installs.Add($entry); [void]$state.events.Add(('install:' + $description)) }; remove = { param($path) [void]$state.removed.Add($path); [void]$state.events.Add(('remove:' + [System.IO.Path]::GetFileName($path))) }; expand = { $state.expanded = $true; [void]$state.events.Add('expand') }; pathExists = { param($path, $kind) if ($kind -eq 'container') { return $state.expanded }; return $true }; cmakeVersion = { return '4.0.0' }; appendLine = { param($path, $line) if ($path -like '*github-env') { [void]$state.envLines.Add($line) } }; diskGate = { param($stage, $paths) if ($stage -eq 'before-install') { $state.beforePaths = @($paths) } } }",
      `$toolchain = Invoke-RainControlledToolchainInstall -DownloadsRoot ${psQuoted(downloads)} -CmakeExtractRoot ${psQuoted(cmake)} -OwnershipParent ${psQuoted(parent)} -OwnerId 'run-123-1' -DownloadsReservationToken $downloadsReservation.token -CmakeReservationToken $cmakeReservation.token -CleanupAuthorityToken 'authority-secret' -ExpectedCmakeVersion '4.0.0' -GitHubPathFile 'C:\\fixture\\github-path' -GitHubEnvFile 'C:\\fixture\\github-env' -Adapter $adapter`,
      '[ordered]@{ toolchain = $toolchain; installs = @($state.installs); removed = @($state.removed); events = @($state.events); envLines = @($state.envLines); beforePaths = @($state.beforePaths) } | ConvertTo-Json -Depth 5 -Compress',
    ])
    expect(result.toolchain).toMatchObject({ cmakeReady: true, cmakeRoot: cmakePackageRoot, cmakePath })
    expect(result.removed).not.toContain(downloads)
    expect(result.removed).not.toContain(cmake)
    expect(result.installs).toEqual(['CUDA:cuda.exe:-s', 'LLVM:llvm.exe:/S', 'NSIS:nsis.exe:/S'])
    expect(result.removed.map((path: string) => path.split(/[\\/]/).at(-1))).toEqual(['cuda.exe', 'llvm.exe', 'nsis.exe', 'cmake.zip'])
    expect(result.events).toEqual(['install:CUDA', 'remove:cuda.exe', 'install:LLVM', 'remove:llvm.exe', 'install:NSIS', 'remove:nsis.exe', 'expand', 'remove:cmake.zip'])
    expect(result.envLines).toContain(`CMAKE_PATH=${cmakePath}`)
    expect(result.envLines).toContain(`CMAKE=${cmakePath}`)
    expect(result.envLines).not.toContain(`CMAKE_ROOT=${cmake}`)
    expect(result.envLines.some((line: string) => line.startsWith('CMAKE_ROOT='))).toBe(false)
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
