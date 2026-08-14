import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..')
const launcherGeneratorPath = join(repoRoot, 'scripts', 'generate-nvidia-evidence-admin-launcher.ps1')
const controlledGitModulePath = join(repoRoot, 'scripts', 'controlled-git.psm1')
const temporaryRoots: string[] = []

function resolvePowerShellExecutable() {
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    const probe = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$null'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (probe.status === 0) return candidate
  }
  throw new Error('admin launcher tests require pwsh.exe or powershell.exe.')
}

const powerShellExecutable = resolvePowerShellExecutable()

function sha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function psQuoted(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function newTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'rain-admin-launcher-test-'))
  temporaryRoots.push(root)
  return root
}

function createCandidateBundle(root: string) {
  const bundleRoot = join(root, 'candidate-bundle')
  mkdirSync(bundleRoot, { recursive: true })
  const targetCommit = 'a'.repeat(40)
  const toolingCommit = 'b'.repeat(40)
  const installerPath = join(bundleRoot, 'Rain_0.1.0_x64-setup.exe')
  const artifactManifestPath = join(bundleRoot, 'release-artifact-manifest.json')
  const controlledBuildRecordPath = join(bundleRoot, 'controlled-build-record.json')
  writeFileSync(installerPath, 'fixture installer bytes')
  const installer = {
    fileName: 'Rain_0.1.0_x64-setup.exe',
    sizeBytes: readFileSync(installerPath).byteLength,
    sha256: sha256(installerPath),
    kind: 'nsis-windows-x64',
  }
  const controlledBuild = {
    repository: 'llbz510/rain',
    sourceRepository: 'https://github.com/llbz510/rain.git',
    targetCommit,
    toolingCommit,
    cleanTree: true,
    generator: { id: 'rain-controlled-artifact-generator', version: '1' },
    buildMetadata: { buildRecordId: 'fixture-build-record', builtAt: '2026-08-11T00:00:00.0000000+00:00' },
    masterReachability: { candidate: true, tooling: true },
  }
  writeFileSync(artifactManifestPath, JSON.stringify({
    schemaVersion: 1,
    targetCommit,
    controlledBuild,
    installer,
  }))
  writeFileSync(controlledBuildRecordPath, JSON.stringify({
    schemaVersion: 1,
    repository: 'llbz510/rain',
    ...controlledBuild,
    workflow: {
      file: '.github/workflows/controlled-gpu-artifact-build.yml',
      definitionCommit: toolingCommit,
      runUrl: 'https://github.com/llbz510/rain/actions/runs/123/attempts/1',
      event: 'workflow_dispatch',
      ref: 'refs/heads/master',
      runId: '123',
      runAttempt: 1,
    },
    coreArtifact: {
      name: 'rain-candidate-core',
      digest: 'c'.repeat(64),
    },
    installer,
    artifactManifest: {
      fileName: 'release-artifact-manifest.json',
      sizeBytes: readFileSync(artifactManifestPath).byteLength,
      sha256: sha256(artifactManifestPath),
    },
  }))
  return { bundleRoot, targetCommit, toolingCommit, installerPath, artifactManifestPath, controlledBuildRecordPath }
}

function generateLauncher(bundleRoot: string, outputPath: string) {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `& ${psQuoted(launcherGeneratorPath)} -CandidateBundleRoot ${psQuoted(bundleRoot)} -OutputPath ${psQuoted(outputPath)}`,
  ].join('; ')
  return execFileSync(powerShellExecutable, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ], { encoding: 'utf8', windowsHide: true })
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('NVIDIA Evidence administrator launcher contract', () => {
  it('generates a manually elevated, bundle-relative launcher bound to the separate tooling commit', () => {
    const bundle = createCandidateBundle(newTemporaryRoot())
    const outputPath = join(bundle.bundleRoot, 'run-nvidia-release-evidence-as-admin.ps1')

    generateLauncher(bundle.bundleRoot, outputPath)

    expect(existsSync(outputPath)).toBe(true)
    const launcher = readFileSync(outputPath, 'utf8')
    expect(launcher).toContain(`$expectedTargetCommit = '${bundle.targetCommit}'`)
    expect(launcher).toContain(`$expectedToolingCommit = '${bundle.toolingCommit}'`)
    expect(launcher).toContain(`$expectedControlledBuildRecordSha256 = '${sha256(bundle.controlledBuildRecordPath)}'`)
    expect(launcher).toContain('IsInRole')
    expect(launcher).toContain('Run this launcher manually from an elevated PowerShell')
    expect(launcher).toContain('Manual handoff prerequisite: verify the canonical workflow run URL and second control-artifact upload digest')
    expect(launcher).toContain('ControlledBuildRecordPath = $controlledBuildRecordPath')
    expect(launcher).toContain('function Invoke-RainControlledGitText')
    expect(launcher).not.toContain('Start-Process -Verb RunAs')
    expect(launcher).not.toContain(bundle.bundleRoot)
  })

  it('fails closed when a real temporary checkout cannot complete native Git provenance', () => {
    const notARepository = newTemporaryRoot()
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `Import-Module ${psQuoted(controlledGitModulePath)} -Force`,
      `Invoke-RainControlledGitText -RepositoryRoot ${psQuoted(notARepository)} -Description 'Temporary checkout HEAD' -GitArguments @('rev-parse', 'HEAD')`,
    ].join('; ')

    expect(() => execFileSync(powerShellExecutable, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true })).toThrow(/temporary checkout HEAD failed with exit code/i)
  })

  it('keeps the generated launcher embedded native Git helper fail-closed on every nonzero exit', () => {
    const bundle = createCandidateBundle(newTemporaryRoot())
    const outputPath = join(bundle.bundleRoot, 'run-nvidia-release-evidence-as-admin.ps1')
    const helperPath = join(bundle.bundleRoot, 'embedded-controlled-git-helper.ps1')

    generateLauncher(bundle.bundleRoot, outputPath)
    const launcher = readFileSync(outputPath, 'utf8')
    const helperStart = launcher.indexOf('function Invoke-RainControlledGitText')
    const helperEnd = launcher.indexOf('\n$identity =', helperStart)
    expect(helperStart).toBeGreaterThanOrEqual(0)
    expect(helperEnd).toBeGreaterThan(helperStart)
    writeFileSync(helperPath, launcher.slice(helperStart, helperEnd), 'utf8')

    const command = [
      "$ErrorActionPreference = 'Stop'",
      `. ${psQuoted(helperPath)}`,
      "$adapter = { param($root, $arguments) [pscustomobject]@{ exitCode = 43; output = 'simulated native Git failure' } }",
      "Invoke-RainControlledGitText -RepositoryRoot 'C:\\fixture\\control' -Description 'Embedded launcher Git provenance' -GitArguments @('rev-parse', 'HEAD') -CommandAdapter $adapter",
    ].join('; ')

    expect(() => execFileSync(powerShellExecutable, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true })).toThrow(/embedded launcher Git provenance failed with exit code 43/i)
  })

  it('rejects a record that confuses candidate source provenance with tooling provenance', () => {
    const bundle = createCandidateBundle(newTemporaryRoot())
    const record = JSON.parse(readFileSync(bundle.controlledBuildRecordPath, 'utf8'))
    record.toolingCommit = bundle.targetCommit
    record.workflow.definitionCommit = bundle.targetCommit
    writeFileSync(bundle.controlledBuildRecordPath, JSON.stringify(record))

    expect(() => generateLauncher(
      bundle.bundleRoot,
      join(bundle.bundleRoot, 'run-nvidia-release-evidence-as-admin.ps1'),
    )).toThrow(/toolingCommit must be distinct/i)
  })

  it('rejects a forked controlled-build record before generating an administrator launcher', () => {
    const bundle = createCandidateBundle(newTemporaryRoot())
    const record = JSON.parse(readFileSync(bundle.controlledBuildRecordPath, 'utf8'))
    record.repository = 'untrusted-fork/rain'
    writeFileSync(bundle.controlledBuildRecordPath, JSON.stringify(record))

    expect(() => generateLauncher(
      bundle.bundleRoot,
      join(bundle.bundleRoot, 'run-nvidia-release-evidence-as-admin.ps1'),
    )).toThrow(/repository must be llbz510\/rain/i)
  })

  it('requires the first core-upload digest binding before it generates a launcher', () => {
    const bundle = createCandidateBundle(newTemporaryRoot())
    const record = JSON.parse(readFileSync(bundle.controlledBuildRecordPath, 'utf8'))
    delete record.coreArtifact
    writeFileSync(bundle.controlledBuildRecordPath, JSON.stringify(record))

    expect(() => generateLauncher(
      bundle.bundleRoot,
      join(bundle.bundleRoot, 'run-nvidia-release-evidence-as-admin.ps1'),
    )).toThrow(/missing required property 'coreArtifact'/i)
  })

  it('refuses to write a launcher outside the candidate bundle', () => {
    const root = newTemporaryRoot()
    const bundle = createCandidateBundle(root)

    expect(() => generateLauncher(
      bundle.bundleRoot,
      join(root, 'run-nvidia-release-evidence-as-admin.ps1'),
    )).toThrow(/inside the candidate bundle/i)
  })

  it('retries atomic launcher publication and removes the failed temporary file', () => {
    const bundle = createCandidateBundle(newTemporaryRoot())
    const outputPath = join(bundle.bundleRoot, 'run-nvidia-release-evidence-as-admin.ps1')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      '$state = [pscustomobject]@{ attempts = 0 }',
      "$adapter = [pscustomobject]@{ writeText = { param($path, $text) [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false)) }; publish = { param($temporary, $destination) $state.attempts++; if ($state.attempts -eq 1) { throw [System.IO.IOException]::new('simulated sharing violation') }; [System.IO.File]::Move($temporary, $destination) }; remove = { param($path) if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }; sleep = { param($attempt) } }",
      `& ${psQuoted(launcherGeneratorPath)} -CandidateBundleRoot ${psQuoted(bundle.bundleRoot)} -OutputPath ${psQuoted(outputPath)} -AtomicWriteAdapter $adapter`,
      `$temporaryFiles = @(Get-ChildItem -LiteralPath ${psQuoted(bundle.bundleRoot)} -Force -Filter '*.tmp' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)`,
      '[ordered]@{ attempts = $state.attempts; temporaryFiles = @($temporaryFiles) } | ConvertTo-Json -Compress',
    ].join('; ')
    const stdout = execFileSync(powerShellExecutable, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true })
    const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1)!)

    expect(result.attempts).toBe(2)
    expect(existsSync(outputPath)).toBe(true)
    expect(result.temporaryFiles).toEqual([])
  })

  it('fails explicitly instead of swallowing an administrator-launcher temporary cleanup failure', () => {
    const bundle = createCandidateBundle(newTemporaryRoot())
    const outputPath = join(bundle.bundleRoot, 'run-nvidia-release-evidence-as-admin.ps1')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      "$adapter = [pscustomobject]@{ writeText = { param($path, $text) [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false)) }; publish = { param($temporary, $destination) [System.IO.File]::Move($temporary, $destination) }; remove = { param($path) throw [System.IO.IOException]::new('simulated temporary cleanup failure') }; sleep = { param($attempt) } }",
      `& ${psQuoted(launcherGeneratorPath)} -CandidateBundleRoot ${psQuoted(bundle.bundleRoot)} -OutputPath ${psQuoted(outputPath)} -AtomicWriteAdapter $adapter`,
    ].join('; ')

    expect(() => execFileSync(powerShellExecutable, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true })).toThrow(/administrator launcher temporary cleanup failed/i)
  })
})
