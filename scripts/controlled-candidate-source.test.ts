import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..')
const modulePath = join(repoRoot, 'scripts', 'controlled-candidate-source.psm1')
const ownedDirectoryModulePath = join(repoRoot, 'scripts', 'controlled-owned-directory.psm1')
const temporaryRoots: string[] = []

function powerShell() {
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    if (spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$null'], { encoding: 'utf8', windowsHide: true }).status === 0) return candidate
  }
  throw new Error('controlled candidate source tests require PowerShell.')
}

const powerShellExecutable = powerShell()
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`
const newRoot = () => { const root = mkdtempSync(join(tmpdir(), 'rain-controlled-candidate-source-')); temporaryRoots.push(root); return root }
const runGit = (root: string, args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim()

function invoke(lines: string[]) {
  const output = execFileSync(powerShellExecutable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', lines.join('; ')], { encoding: 'utf8', windowsHide: true })
  return JSON.parse(output.trim().split(/\r?\n/).at(-1)!)
}

function candidateFixture(root: string) {
  const candidate = join(root, 'canonical-candidate')
  mkdirSync(join(candidate, 'src'), { recursive: true })
  writeFileSync(join(candidate, 'src', 'tracked.txt'), 'tracked source')
  runGit(candidate, ['init'])
  runGit(candidate, ['config', 'user.email', 'rain-test@example.invalid'])
  runGit(candidate, ['config', 'user.name', 'Rain Test'])
  runGit(candidate, ['add', 'src/tracked.txt'])
  runGit(candidate, ['commit', '-m', 'tracked fixture'])
  mkdirSync(join(candidate, 'node_modules'), { recursive: true })
  mkdirSync(join(candidate, 'src-tauri', 'target'), { recursive: true })
  writeFileSync(join(candidate, 'node_modules', 'untracked.js'), 'untracked dependency')
  writeFileSync(join(candidate, 'src-tauri', 'target', 'untracked.bin'), 'untracked build output')
  writeFileSync(join(candidate, 'untracked.txt'), 'untracked source residue')
  return candidate
}

afterEach(() => { for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('controlled candidate source module', () => {
  it('keeps owned-directory reservation, cleanup, and candidate cross-step open callable after the workflow import order', () => {
    const root = newRoot()
    const ownedParent = join(root, 'runner-temp')
    const ownedRoot = join(ownedParent, 'workflow-owned-root')
    mkdirSync(ownedParent)
    const result = invoke([
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${quote(ownedDirectoryModulePath)} -Force`,
      `Import-Module ${quote(modulePath)} -Force`,
      `$reservation = New-RainControlledDirectoryReservation -Path ${quote(ownedRoot)} -AllowedParent ${quote(ownedParent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret'`,
      `New-Item -ItemType Directory -Path ${quote(ownedRoot)} -ErrorAction Stop | Out-Null`,
      `New-Item -ItemType Directory -Path ${quote(join(ownedRoot, 'candidate-source'))} -ErrorAction Stop | Out-Null`,
      `$opened = Open-RainControlledCandidateSource -OwnedRoot ${quote(ownedRoot)} -SourceRoot ${quote(join(ownedRoot, 'candidate-source'))} -OwnedParent ${quote(ownedParent)} -OwnerId 'run-123-1' -ReservationToken $reservation.token -CleanupAuthorityToken 'authority-secret'`,
      `$reservationCheck = Open-RainControlledDirectoryReservation -Path ${quote(ownedRoot)} -AllowedParent ${quote(ownedParent)} -OwnerId 'run-123-1' -ReservationToken $reservation.token -CleanupAuthorityToken 'authority-secret'`,
      `Remove-RainControlledOwnedDirectory -Path ${quote(ownedRoot)} -AllowedParent ${quote(ownedParent)} -OwnerId 'run-123-1' -ReservationToken $reservation.token -CleanupAuthorityToken 'authority-secret'`,
      '[ordered]@{ sourceRoot = $opened.sourceRoot; reservationPath = $reservationCheck.path; ownedRootExistsAfterCleanup = Test-Path -LiteralPath ' + quote(ownedRoot) + ' } | ConvertTo-Json -Compress',
    ])

    expect(result.sourceRoot).toBe(join(ownedRoot, 'candidate-source'))
    expect(result.reservationPath).toBe(ownedRoot)
    expect(result.ownedRootExistsAfterCleanup).toBe(false)
  })

  it('exports only exact tracked files into a pure child and leaves the canonical repository byte-for-byte untouched', () => {
    const root = newRoot()
    const candidate = candidateFixture(root)
    const ownedParent = join(root, 'runner-temp')
    mkdirSync(ownedParent)
    const commit = runGit(candidate, ['rev-parse', 'HEAD'])
    const beforeStatus = runGit(candidate, ['status', '--porcelain', '--untracked-files=all'])
    const result = invoke([
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${quote(modulePath)} -Force`,
      `$source = New-RainControlledCandidateSource -CandidateRoot ${quote(candidate)} -CandidateTargetCommit ${quote(commit)} -OwnedParent ${quote(ownedParent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret'`,
      `$opened = Open-RainControlledCandidateSource -OwnedRoot $source.ownedRoot -SourceRoot $source.sourceRoot -OwnedParent ${quote(ownedParent)} -OwnerId 'run-123-1' -ReservationToken $source.reservationToken -CleanupAuthorityToken 'authority-secret'`,
      '[ordered]@{ source = $source; opened = $opened } | ConvertTo-Json -Depth 8 -Compress',
    ])

    expect(result.opened.sourceRoot).toBe(result.source.sourceRoot)
    expect(readFileSync(join(result.source.sourceRoot, 'src', 'tracked.txt'), 'utf8')).toBe('tracked source')
    expect(existsSync(join(result.source.sourceRoot, '.git'))).toBe(false)
    expect(existsSync(join(result.source.sourceRoot, 'node_modules'))).toBe(false)
    expect(existsSync(join(result.source.sourceRoot, 'src-tauri', 'target'))).toBe(false)
    expect(existsSync(join(result.source.sourceRoot, 'untracked.txt'))).toBe(false)
    expect(runGit(candidate, ['status', '--porcelain', '--untracked-files=all'])).toBe(beforeStatus)
    expect(readFileSync(join(candidate, 'src', 'tracked.txt'), 'utf8')).toBe('tracked source')
    expect(readFileSync(join(candidate, 'node_modules', 'untracked.js'), 'utf8')).toBe('untracked dependency')
    expect(readFileSync(join(candidate, 'src-tauri', 'target', 'untracked.bin'), 'utf8')).toBe('untracked build output')
    expect(readFileSync(join(candidate, 'untracked.txt'), 'utf8')).toBe('untracked source residue')
  })

  it('fails closed when a later consumer presents the wrong token, owner, or source child', () => {
    const root = newRoot()
    const candidate = candidateFixture(root)
    const ownedParent = join(root, 'runner-temp')
    mkdirSync(ownedParent)
    const commit = runGit(candidate, ['rev-parse', 'HEAD'])
    const result = invoke([
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${quote(modulePath)} -Force`,
      `$source = New-RainControlledCandidateSource -CandidateRoot ${quote(candidate)} -CandidateTargetCommit ${quote(commit)} -OwnedParent ${quote(ownedParent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret'`,
      '$tokenError = $ownerError = $pathError = $null',
      "try { Open-RainControlledCandidateSource -OwnedRoot $source.ownedRoot -SourceRoot $source.sourceRoot -OwnedParent '" + ownedParent.replace(/'/g, "''") + "' -OwnerId 'run-123-1' -ReservationToken 'forged-token' -CleanupAuthorityToken 'authority-secret' } catch { $tokenError = $_.Exception.Message }",
      "try { Open-RainControlledCandidateSource -OwnedRoot $source.ownedRoot -SourceRoot $source.sourceRoot -OwnedParent '" + ownedParent.replace(/'/g, "''") + "' -OwnerId 'other-owner' -ReservationToken $source.reservationToken -CleanupAuthorityToken 'authority-secret' } catch { $ownerError = $_.Exception.Message }",
      "try { Open-RainControlledCandidateSource -OwnedRoot $source.ownedRoot -SourceRoot (Join-Path $source.ownedRoot 'other-child') -OwnedParent '" + ownedParent.replace(/'/g, "''") + "' -OwnerId 'run-123-1' -ReservationToken $source.reservationToken -CleanupAuthorityToken 'authority-secret' } catch { $pathError = $_.Exception.Message }",
      '[ordered]@{ tokenError = $tokenError; ownerError = $ownerError; pathError = $pathError } | ConvertTo-Json -Compress',
    ])
    expect(result.tokenError).toMatch(/token|reservation/i)
    expect(result.ownerError).toMatch(/invocation|owner|reservation/i)
    expect(result.pathError).toMatch(/candidate-source/i)
  })

  it('removes the owned root and reservation after a git failure without changing the canonical repository', () => {
    const root = newRoot()
    const candidate = candidateFixture(root)
    const ownedParent = join(root, 'runner-temp')
    mkdirSync(ownedParent)
    const commit = runGit(candidate, ['rev-parse', 'HEAD'])
    const beforeStatus = runGit(candidate, ['status', '--porcelain', '--untracked-files=all'])
    const result = invoke([
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${quote(modulePath)} -Force`,
      `Import-Module ${quote(ownedDirectoryModulePath)} -Force`,
      '$state = [pscustomobject]@{ ownedRoot = $null; tarCalls = 0 }; $errorText = $null',
      "$adapter = [pscustomobject]@{ gitArchive = { param($candidateRoot, $commit, $archivePath) $state.ownedRoot = Split-Path -Parent $archivePath; throw 'simulated git failure' }.GetNewClosure(); tarExtract = { $state.tarCalls++; return 0 }.GetNewClosure(); removeFile = {}; removeOwnedDirectory = { param($reservation, $parent, $owner, $authority) Remove-RainControlledOwnedDirectory -Path $reservation.path -AllowedParent $parent -OwnerId $owner -ReservationToken $reservation.token -CleanupAuthorityToken $authority } }",
      `try { New-RainControlledCandidateSource -CandidateRoot ${quote(candidate)} -CandidateTargetCommit ${quote(commit)} -OwnedParent ${quote(ownedParent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret' -Adapter $adapter | Out-Null } catch { $errorText = $_.Exception.Message }`,
      '[ordered]@{ error = $errorText; ownedRoot = $state.ownedRoot; tarCalls = $state.tarCalls; markers = @(Get-ChildItem -LiteralPath ' + quote(ownedParent) + " -Force -Filter '*.rain-controlled-owned.json').Count } | ConvertTo-Json -Compress",
    ])
    expect(result.error).toContain('simulated git failure')
    expect(result.tarCalls).toBe(0)
    expect(existsSync(result.ownedRoot)).toBe(false)
    expect(result.markers).toBe(0)
    expect(runGit(candidate, ['status', '--porcelain', '--untracked-files=all'])).toBe(beforeStatus)
  })

  it('reaches tar after a real git archive and removes the owned root and reservation on tar failure', () => {
    const root = newRoot()
    const candidate = candidateFixture(root)
    const ownedParent = join(root, 'runner-temp')
    mkdirSync(ownedParent)
    const commit = runGit(candidate, ['rev-parse', 'HEAD'])
    const result = invoke([
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${quote(modulePath)} -Force`,
      `Import-Module ${quote(ownedDirectoryModulePath)} -Force`,
      '$state = [pscustomobject]@{ ownedRoot = $null; tarCalls = 0 }; $errorText = $null',
      "$adapter = [pscustomobject]@{ gitArchive = { param($candidateRoot, $targetCommit, $archivePath) $state.ownedRoot = Split-Path -Parent $archivePath; & git -C $candidateRoot archive --format=tar --output=$archivePath $targetCommit; return $LASTEXITCODE }.GetNewClosure(); tarExtract = { param($archivePath, $sourceRoot) $state.tarCalls++; throw 'simulated tar failure' }.GetNewClosure(); removeFile = { param($path) if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }; removeOwnedDirectory = { param($reservation, $parent, $owner, $authority) Remove-RainControlledOwnedDirectory -Path $reservation.path -AllowedParent $parent -OwnerId $owner -ReservationToken $reservation.token -CleanupAuthorityToken $authority } }",
      `try { New-RainControlledCandidateSource -CandidateRoot ${quote(candidate)} -CandidateTargetCommit ${quote(commit)} -OwnedParent ${quote(ownedParent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret' -Adapter $adapter | Out-Null } catch { $errorText = $_.Exception.Message }`,
      '[ordered]@{ error = $errorText; ownedRoot = $state.ownedRoot; tarCalls = $state.tarCalls; markers = @(Get-ChildItem -LiteralPath ' + quote(ownedParent) + " -Force -Filter '*.rain-controlled-owned.json').Count } | ConvertTo-Json -Compress",
    ])
    expect(result.error).toContain('simulated tar failure')
    expect(result.tarCalls).toBe(1)
    expect(existsSync(result.ownedRoot)).toBe(false)
    expect(result.markers).toBe(0)
  })

  it('aggregates a primary failure with a denied owned cleanup and leaves the reservation for afterEach recovery', () => {
    const root = newRoot()
    const candidate = candidateFixture(root)
    const ownedParent = join(root, 'runner-temp')
    mkdirSync(ownedParent)
    const commit = runGit(candidate, ['rev-parse', 'HEAD'])
    const result = invoke([
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${quote(modulePath)} -Force`,
      '$state = [pscustomobject]@{ ownedRoot = $null }; $errorText = $null',
      "$adapter = [pscustomobject]@{ gitArchive = { param($candidateRoot, $targetCommit, $archivePath) $state.ownedRoot = Split-Path -Parent $archivePath; throw 'simulated git failure' }.GetNewClosure(); tarExtract = {}; removeFile = {}; removeOwnedDirectory = { throw 'simulated owned cleanup failure' } }",
      `try { New-RainControlledCandidateSource -CandidateRoot ${quote(candidate)} -CandidateTargetCommit ${quote(commit)} -OwnedParent ${quote(ownedParent)} -OwnerId 'run-123-1' -CleanupAuthorityToken 'authority-secret' -Adapter $adapter | Out-Null } catch { $errorText = $_.Exception.Message }`,
      '[ordered]@{ error = $errorText; ownedRoot = $state.ownedRoot; markers = @(Get-ChildItem -LiteralPath ' + quote(ownedParent) + " -Force -Filter '*.rain-controlled-owned.json').Count } | ConvertTo-Json -Compress",
    ])
    expect(result.error).toContain('simulated git failure')
    expect(result.error).toContain('simulated owned cleanup failure')
    expect(existsSync(result.ownedRoot)).toBe(true)
    expect(result.markers).toBe(1)
  })
})
