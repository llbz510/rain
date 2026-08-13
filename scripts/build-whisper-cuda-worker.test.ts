import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..')
const workerBuildScriptPath = join(repoRoot, 'scripts', 'build-whisper-cuda-worker.ps1')
const workerBuildScript = readFileSync(workerBuildScriptPath, 'utf8')
const temporaryRoots: string[] = []

function resolvePowerShellExecutable() {
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    const probe = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$null'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (probe.status === 0) return candidate
  }
  throw new Error('CUDA worker portability tests require pwsh.exe or powershell.exe.')
}

const powerShellExecutable = resolvePowerShellExecutable()

function newTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'rain-cuda-worker-contract-test-'))
  temporaryRoots.push(root)
  return root
}

function psQuoted(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function invokeOwnershipContract(workerTarget: string, invocationId: string) {
  const stageRoot = join(workerTarget, '..', 'stage')
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `& ${psQuoted(workerBuildScriptPath)} -ProjectRoot ${psQuoted(repoRoot)} -WorkerTargetRoot ${psQuoted(workerTarget)} -OutputRoot ${psQuoted(stageRoot)} -WorkerInvocationId ${psQuoted(invocationId)} -PruneWorkerTarget -AssertPruneOwnershipOnly`,
  ].join('; ')
  return execFileSync(powerShellExecutable, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
  ], { encoding: 'utf8', windowsHide: true })
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CUDA worker controlled-build portability contract', () => {
  it('accepts explicit remote toolchain and target paths instead of relying on a developer checkout', () => {
    for (const parameter of [
      'ProjectRoot',
      'CudaRoot',
      'NinjaPath',
      'VcVarsPath',
      'CargoPath',
      'LlvmBinPath',
      'WorkerTargetRoot',
    ]) {
      expect(workerBuildScript).toMatch(new RegExp(`\\[string\\]\\$${parameter}\\s*=`))
    }
  })

  it('uses Cargo.lock and leaves no builder CUDA root in the staged payload manifest', () => {
    expect(workerBuildScript).toContain("'--locked'")
    const payloadManifest = workerBuildScript.slice(workerBuildScript.indexOf('$manifest = [ordered]@{'))
    expect(payloadManifest).not.toMatch(/^\s*cudaRoot\s*=/m)
  })

  it('requires exactly pinned CMake 4.0.0 and sets the explicit Blackwell-compatible CUDA architecture for the isolated worker build', () => {
    expect(workerBuildScript).toMatch(/\[string\]\$CmakePath\s*=/)
    expect(workerBuildScript).toContain('Assert-WorkerCmakeVersion')
    expect(workerBuildScript).toContain("-ne [version]'4.0.0'")
    expect(workerBuildScript).toContain("$env:CMAKE_CUDA_ARCHITECTURES = '120'")
  })

  it('aggregates ownership-marker publication and cleanup failures while removing the owned target', () => {
    const root = newTemporaryRoot()
    const workerTarget = join(root, 'owned-worker-target')
    const stageRoot = join(root, 'stage')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `$env:GITHUB_ACTIONS = 'true'`,
      `$adapter = [pscustomobject]@{ createDirectory = { param($p) [void][IO.Directory]::CreateDirectory($p) }; writeText = { param($p,$t) [IO.File]::WriteAllText($p,$t); throw 'simulated marker write failure' }; publish = { param($a,$b) [IO.File]::Move($a,$b) }; removeTemporary = { param($p) throw 'simulated marker temp cleanup failure' }; removeTarget = { param($p) Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction Stop } }`,
      `& ${psQuoted(workerBuildScriptPath)} -ProjectRoot ${psQuoted(repoRoot)} -WorkerTargetRoot ${psQuoted(workerTarget)} -OutputRoot ${psQuoted(stageRoot)} -WorkerInvocationId 'run-123-attempt-1' -PruneWorkerTarget -AssertOwnershipCreationOnly -OwnershipMarkerAdapter $adapter`,
    ].join('; ')
    const result = spawnSync(powerShellExecutable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      encoding: 'utf8', windowsHide: true,
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('simulated marker write failure')
    expect(`${result.stdout}\n${result.stderr}`).toContain('simulated marker temp cleanup failure')
    expect(() => readFileSync(join(workerTarget, '.rain-controlled-worker-ownership.json'))).toThrow()
  })

  it('does not leave a controlled TEMP worker target behind at the ownership-creation test seam', () => {
    const root = newTemporaryRoot()
    const workerTarget = join(root, 'owned-worker-target')
    const stageRoot = join(root, 'stage')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      "$env:GITHUB_ACTIONS = 'true'",
      `& ${psQuoted(workerBuildScriptPath)} -ProjectRoot ${psQuoted(repoRoot)} -WorkerTargetRoot ${psQuoted(workerTarget)} -OutputRoot ${psQuoted(stageRoot)} -WorkerInvocationId 'run-123-attempt-1' -PruneWorkerTarget -AssertOwnershipCreationOnly`,
    ].join('; ')

    expect(() => execFileSync(powerShellExecutable, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true })).not.toThrow()
    expect(existsSync(workerTarget)).toBe(false)
  })

  it('keeps both the worker build failure and verified target cleanup failure observable', () => {
    expect(workerBuildScript).toContain('$workerBuildError')
    expect(workerBuildScript).toContain('$workerCleanupError')
    expect(workerBuildScript).toContain('additionally, worker target cleanup failed')
  })

  it('can prune only its verified worker target after payload staging succeeds', () => {
    expect(workerBuildScript).toMatch(/\[switch\]\$PruneWorkerTarget/)
    expect(workerBuildScript).toMatch(/Assert-WorkerTargetCanBePruned/)
    const stageWrite = workerBuildScript.indexOf('payload-manifest.json')
    const prune = workerBuildScript.lastIndexOf('Remove-Item -LiteralPath $workerTarget -Recurse -Force')
    expect(stageWrite).toBeGreaterThan(-1)
    expect(prune).toBeGreaterThan(stageWrite)
  })

  it('requires a same-invocation ownership marker before a temporary worker target can be pruned', () => {
    const root = newTemporaryRoot()
    const workerTarget = join(root, 'owned-worker-target')
    const invocationId = 'run-123-attempt-1'
    mkdirSync(workerTarget, { recursive: true })
    writeFileSync(join(workerTarget, '.rain-controlled-worker-ownership.json'), JSON.stringify({
      schemaVersion: 1,
      invocationId,
      workerTargetRoot: workerTarget,
    }))

    expect(() => invokeOwnershipContract(workerTarget, invocationId)).not.toThrow()
  })

  it('fails closed when a temporary worker target marker belongs to a different invocation', () => {
    const root = newTemporaryRoot()
    const workerTarget = join(root, 'owned-worker-target')
    mkdirSync(workerTarget, { recursive: true })
    writeFileSync(join(workerTarget, '.rain-controlled-worker-ownership.json'), JSON.stringify({
      schemaVersion: 1,
      invocationId: 'prior-run-999',
      workerTargetRoot: workerTarget,
    }))

    expect(() => invokeOwnershipContract(workerTarget, 'run-123-attempt-1')).toThrow(/same invocation|ownership/i)
  })
})
