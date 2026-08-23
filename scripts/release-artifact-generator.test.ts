import { createHash } from 'node:crypto'
import { execFile, spawnSync, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..')
const generatorModulePath = join(repoRoot, 'scripts', 'release-artifact-generator.psm1')
const temporaryRoots: string[] = []
const powerShellTestBudgets = Object.freeze({
  generatorProcessTimeoutMs: 10_000,
  cleanupExitTimeoutMs: 2_000,
})

type ChildProcessResult = {
  status: number | null
  stdout: string
  stderr: string
  error?: string
  timedOut: boolean
}

type ActiveChildProcess = {
  child: ChildProcess
  exited: Promise<void>
  terminateForCleanup: () => void
}

type ChildProcessCompletion = (
  error: (Error & { code?: string | number }) | null,
  stdout: string,
  stderr: string,
) => void

type ChildProcessStart = (
  executable: string,
  arguments_: string[],
  completion: ChildProcessCompletion,
) => Pick<ChildProcess, 'pid' | 'kill'>

type TimeoutAdapter = {
  schedule: (callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>
  clear: (timeoutHandle: ReturnType<typeof setTimeout>) => void
}

type TrackedPowerShellOptions = {
  startChild?: ChildProcessStart
  timeoutAdapter?: TimeoutAdapter
  timeoutMs?: number
}

const activePowerShellProcesses = new Set<ActiveChildProcess>()
const defaultTimeoutAdapter: TimeoutAdapter = {
  schedule: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
  clear: (timeoutHandle) => clearTimeout(timeoutHandle),
}

function resolvePowerShellExecutable() {
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    const probe = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$null'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (probe.status === 0) return candidate
  }
  throw new Error('release-artifact generator tests require pwsh.exe or powershell.exe.')
}

const powerShellExecutable = resolvePowerShellExecutable()
const pinnedNsisDirectUrl = 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.11/nsis-3.11-setup.exe'
const legacyNsisDownloadPageUrl = 'https://sourceforge.net/projects/nsis/files/NSIS%203/3.11/nsis-3.11-setup.exe/download'

function runTrackedPowerShell(arguments_: string[], options: TrackedPowerShellOptions = {}) {
  const timeoutMs = options.timeoutMs ?? powerShellTestBudgets.generatorProcessTimeoutMs
  const startChild: ChildProcessStart = options.startChild ?? ((file, args, completion) => execFile(file, args, {
    encoding: 'utf8',
    windowsHide: true,
  }, completion))
  const timeoutAdapter = options.timeoutAdapter ?? defaultTimeoutAdapter
  let active!: ActiveChildProcess
  let termination: { kind: 'timeout'; timeoutMs: number } | { kind: 'cleanup' } | undefined
  let terminationFailure: Error | undefined
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  let resultWasSettled = false
  let resolveResult!: (result: ChildProcessResult) => void
  let resolveExited!: () => void
  const result = new Promise<ChildProcessResult>((resolve) => {
    resolveResult = resolve
  })
  const exited = new Promise<void>((resolve) => {
    resolveExited = resolve
  })
  const settleResult = (value: ChildProcessResult) => {
    if (resultWasSettled) return
    resultWasSettled = true
    resolveResult(value)
  }
  const clearTrackedTimeout = () => {
    if (timeoutHandle === undefined) return
    const scheduledTimeout = timeoutHandle
    timeoutHandle = undefined
    timeoutAdapter.clear(scheduledTimeout)
  }
  const child = startChild(powerShellExecutable, arguments_, (error, stdout, stderr) => {
    let callbackFailure: Error | undefined
    try {
      clearTrackedTimeout()
    } catch (callbackError) {
      callbackFailure = callbackError instanceof Error ? callbackError : new Error(String(callbackError))
    }
    activePowerShellProcesses.delete(active)
    resolveExited()
    const timedOut = termination?.kind === 'timeout'
    settleResult({
      status: termination ? null : error ? (typeof error.code === 'number' ? error.code : 1) : 0,
      stdout: String(stdout),
      stderr: String(stderr),
      error: callbackFailure
        ? `PowerShell process completion cleanup failed: ${callbackFailure.message}`
        : timedOut
        ? `PowerShell process timed out after ${termination.timeoutMs} ms and was terminated: ${powerShellExecutable}`
        : termination?.kind === 'cleanup'
          ? `PowerShell process was terminated during test cleanup: ${powerShellExecutable}`
          : error?.message,
      timedOut,
    })
  })
  const terminate = (reason: typeof termination) => {
    if (termination) return terminationFailure
    termination = reason
    if (reason?.kind === 'cleanup') clearTrackedTimeout()
    try {
      if (!child.kill('SIGKILL')) {
        throw new Error('the PowerShell child process rejected SIGKILL')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      terminationFailure = error instanceof Error ? error : new Error(message)
      settleResult({
        status: null,
        stdout: '',
        stderr: '',
        error: reason?.kind === 'timeout'
          ? `PowerShell process timed out after ${reason.timeoutMs} ms but termination failed: ${message}`
          : `PowerShell process cleanup termination failed: ${message}`,
        timedOut: reason?.kind === 'timeout',
      })
      return terminationFailure
    }
  }
  active = {
    child: child as ChildProcess,
    exited,
    terminateForCleanup: () => {
      const cleanupFailure = terminate({ kind: 'cleanup' })
      if (cleanupFailure) throw cleanupFailure
    },
  }
  activePowerShellProcesses.add(active)
  timeoutHandle = timeoutAdapter.schedule(() => {
    try {
      terminate({ kind: 'timeout', timeoutMs })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      settleResult({
        status: null,
        stdout: '',
        stderr: '',
        error: `PowerShell timeout callback failed: ${message}`,
        timedOut: true,
      })
    }
  }, timeoutMs)
  return result
}

async function runPowerShell(arguments_: string[], options?: TrackedPowerShellOptions) {
  const result = await runTrackedPowerShell(arguments_, options)
  if (result.status === 0 && !result.timedOut) return result.stdout
  const message = [result.error, result.stderr.trim()].filter((value): value is string => Boolean(value)).join('\n')
  throw new Error(message || `PowerShell process failed without a diagnostic: ${powerShellExecutable}`)
}

async function waitForChildExit(
  process: ActiveChildProcess,
  timeoutMs: number,
): Promise<{ kind: 'exited' } | { kind: 'failed'; error: unknown } | { kind: 'timeout' }> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<{ kind: 'timeout' }>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs)
  })
  const exit = process.exited.then(
    () => ({ kind: 'exited' as const }),
    (error: unknown) => ({ kind: 'failed' as const, error }),
  )
  const outcome = await Promise.race([exit, timeout])
  if (timeoutHandle) clearTimeout(timeoutHandle)
  return outcome
}

async function cleanupPowerShellTestResources(cleanupExitTimeoutMs = powerShellTestBudgets.cleanupExitTimeoutMs) {
  const cleanupErrors: string[] = []
  const active = Array.from(activePowerShellProcesses)
  for (const process of active) {
    try {
      process.terminateForCleanup()
    } catch (error) {
      cleanupErrors.push(`terminate child ${process.child.pid ?? 'unknown'}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const exits = await Promise.all(active.map(async (process) => ({
    process,
    outcome: await waitForChildExit(process, cleanupExitTimeoutMs),
  })))
  for (const { process, outcome } of exits) {
    if (outcome.kind === 'timeout') {
      cleanupErrors.push(`child ${process.child.pid ?? 'unknown'} did not exit within ${cleanupExitTimeoutMs} ms`)
    } else if (outcome.kind === 'failed') {
      cleanupErrors.push(`observe child ${process.child.pid ?? 'unknown'} exit: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`)
    }
  }
  if (activePowerShellProcesses.size > 0) {
    cleanupErrors.push(`${activePowerShellProcesses.size} PowerShell child process(es) remained active after cleanup`)
    for (const root of temporaryRoots) cleanupErrors.push(`preserved TEMP root ${root} because a child process may still access it`)
  } else {
    for (const root of temporaryRoots.splice(0)) {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch (error) {
        cleanupErrors.push(`remove TEMP root ${root}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  if (cleanupErrors.length > 0) {
    throw new Error(`PowerShell test cleanup failed: ${cleanupErrors.join('; ')}`)
  }
}

function sha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function expectSameExistingFile(actualPath: string, expectedPath: string) {
  expect(existsSync(actualPath)).toBe(true)
  expect(existsSync(expectedPath)).toBe(true)
  expect(realpathSync.native(actualPath)).toBe(realpathSync.native(expectedPath))
  expect(readFileSync(actualPath)).toEqual(readFileSync(expectedPath))
}

async function observeEventLoopWhileRunning<T>(operation: () => T | Promise<T>) {
  let timerAdvanced = false
  const timer = new Promise<void>((resolve) => {
    setTimeout(() => {
      timerAdvanced = true
      resolve()
    }, 0)
  })
  const value = await operation()
  const timerAdvancedBeforeCompletion = timerAdvanced
  await timer
  return { value, timerAdvancedBeforeCompletion }
}

async function windowsShortPath(path: string) {
  const command = `(New-Object -ComObject Scripting.FileSystemObject).GetFolder(${psQuoted(path)}).ShortPath`
  return (await runPowerShell([
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ])).trim()
}

function newTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'rain-release-artifact-generator-test-'))
  temporaryRoots.push(root)
  return root
}

function psQuoted(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function writeFixtureFile(path: string, contents: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents, 'utf8')
}

function writePeFixture(path: string, machine: number) {
  const bytes = Buffer.alloc(512)
  bytes.write('MZ', 0, 'ascii')
  bytes.writeUInt32LE(0x80, 0x3c)
  bytes.write('PE\0\0', 0x80, 'ascii')
  bytes.writeUInt16LE(machine, 0x84)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, bytes)
}

function writeNsisInstallerFixture(path: string, machine = 0x8664) {
  writePeFixture(path, machine)
  const bytes = readFileSync(path)
  bytes.write('Nullsoft Install System', 0x120, 'ascii')
  writeFileSync(path, bytes)
}

function writeTauriMetadataFixture(root: string, metadata: {
  productName?: string
  version?: string
  identifier?: string
} = {}) {
  const sourceTauriRoot = join(root, 'src-tauri')
  writeFixtureFile(join(sourceTauriRoot, 'tauri.conf.json'), JSON.stringify({
    productName: metadata.productName ?? 'Rain',
    version: metadata.version ?? '0.1.0',
    identifier: metadata.identifier ?? 'com.rain.app',
  }))
  writeFixtureFile(join(sourceTauriRoot, 'tauri.gpu.conf.json'), JSON.stringify({
    bundle: {
      active: true,
      targets: ['nsis'],
      resources: {
        'target/whisper-gpu-bundle/whisper-backends/rain-whisper-cuda.exe': 'whisper-backends/rain-whisper-cuda.exe',
        'target/whisper-gpu-bundle/whisper-backends/cublas64_12.dll': 'whisper-backends/cublas64_12.dll',
        'target/whisper-gpu-bundle/whisper-backends/cublasLt64_12.dll': 'whisper-backends/cublasLt64_12.dll',
        'target/whisper-gpu-bundle/whisper-backends/cudart64_12.dll': 'whisper-backends/cudart64_12.dll',
        'target/whisper-gpu-bundle/whisper-backends/payload-manifest.json': 'whisper-backends/payload-manifest.json',
      },
    },
  }))
}

function writeControlledToolchainRecordFixture(root: string) {
  const toolchainRecordPath = join(root, 'controlled-toolchain-record.json')
  writeFixtureFile(toolchainRecordPath, JSON.stringify({
    schemaVersion: 1,
    runner: {
      image: 'windows-2025',
      imageVersion: '2026.08.01.1',
      os: 'Microsoft Windows Server 2025',
      osVersion: '10.0.26100',
      architecture: 'X64',
    },
    cmake: { version: '4.0.0', minimumVersion: '4.0.0' },
    cuda: {
      toolkitVersion: '12.9.1',
      architectures: ['120'],
      architectureBasisUrl: 'https://developer.nvidia.com/cuda-gpus',
    },
    ninja: { version: '1.12.1' },
    llvm: { version: '22.1.7' },
    rust: { version: '1.96.1' },
    node: { version: 'v24.0.0' },
    npm: { version: '11.0.0' },
    cargo: { version: 'cargo 1.96.1' },
    msvc: { version: '14.44.35207', hostArchitecture: 'x64', targetArchitecture: 'x64' },
    nsis: { version: 'v3.11' },
    downloads: {
      cmake: {
        url: 'https://github.com/Kitware/CMake/releases/download/v4.0.0/cmake-4.0.0-windows-x86_64.zip',
        sha256: '89e87f3e297b70f1349ee7c5f90783ca96efb986b70c558c799c3c9b1b716456',
      },
      cuda: {
        url: 'https://developer.download.nvidia.com/compute/cuda/12.9.1/local_installers/cuda_12.9.1_576.57_windows.exe',
        sha256: 'f0ca7cc7b4cea2fac2c4951819d2a9caea31e04000e9110e2048719525f8ea0e',
      },
      llvm: {
        url: 'https://github.com/llvm/llvm-project/releases/download/llvmorg-22.1.7/LLVM-22.1.7-win64.exe',
        sha256: 'e091fcf965ce589c83c0f7c5356b2fcf3e658a8ec990bfcf79cce4389a0d1eb3',
      },
      nsis: {
        url: pinnedNsisDirectUrl,
        sha256: '38d49f8fe09b1c332b01d0940e57b7258f4447733643273a01c59959ad9d3b0a',
      },
    },
  }))
  return toolchainRecordPath
}

function createInstalledTreeFixture(root: string) {
  const installRoot = join(root, 'installed')
  const payloadRoot = join(installRoot, 'resources', 'whisper-backends')
  const installerPath = join(root, 'Rain_0.1.0_x64-setup.exe')
  const archiveRoot = join(root, 'installer-archive')
  const mainExecutable = join(installRoot, 'rain.exe')
  const worker = join(payloadRoot, 'rain-whisper-cuda.exe')
  const payloadFiles = [
    worker,
    join(payloadRoot, 'cublas64_12.dll'),
    join(payloadRoot, 'cublasLt64_12.dll'),
    join(payloadRoot, 'cudart64_12.dll'),
  ]

  writeNsisInstallerFixture(installerPath)
  writePeFixture(join(archiveRoot, 'embedded-bootstrapper.exe'), 0x14c)
  // 7z's NSIS handler removes its virtual $INSTDIR prefix from exported paths.
  // The physical extraction root is therefore the application root; the
  // separate, literal $PLUGINSDIR directory remains visible beside it.
  const archivePayloadBase = archiveRoot
  mkdirSync(join(archiveRoot, '$PLUGINSDIR'), { recursive: true })
  writePeFixture(join(archivePayloadBase, 'Rain.exe'), 0x8664)
  const archivePayloadRoot = join(archivePayloadBase, 'resources', 'whisper-backends')
  const archivePayloadFiles = [
    join(archivePayloadRoot, 'rain-whisper-cuda.exe'),
    join(archivePayloadRoot, 'cublas64_12.dll'),
    join(archivePayloadRoot, 'cublasLt64_12.dll'),
    join(archivePayloadRoot, 'cudart64_12.dll'),
  ]
  for (const path of archivePayloadFiles) writeFixtureFile(path, `archive fixture ${path.split('\\').pop()}`)
  writeFixtureFile(join(archivePayloadRoot, 'payload-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    configuration: 'release',
    workerProtocolVersion: 1,
    driverLibraryBundled: false,
    files: archivePayloadFiles.map((path) => ({
      name: path.split('\\').pop(),
      sizeBytes: readFileSync(path).length,
      sha256: sha256(path),
    })),
  }))
  writeTauriMetadataFixture(root)
  const toolchainRecordPath = writeControlledToolchainRecordFixture(root)
  writePeFixture(mainExecutable, 0x8664)
  for (const path of payloadFiles) writeFixtureFile(path, `fixture ${path.split('\\').pop()}`)

  writeFixtureFile(join(payloadRoot, 'payload-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    configuration: 'release',
    workerProtocolVersion: 1,
    driverLibraryBundled: false,
    files: payloadFiles.map((path) => ({
      name: path.split('\\').pop(),
      sizeBytes: readFileSync(path).length,
      sha256: sha256(path),
    })),
  }, null, 2))

  return { installRoot, installerPath, payloadRoot, toolchainRecordPath, archiveRoot }
}

function createNsisInstallationProof(installerPath: string, installRoot: string) {
  return {
    kind: 'rain-nsis-install-proof-v1',
    schemaVersion: 1,
    installerPath,
    installerSha256: sha256(installerPath),
    installRoot,
    mainExecutable: join(installRoot, 'rain.exe'),
    mainExecutableMachine: 0x8664,
    payloadManifestPath: join(installRoot, 'resources', 'whisper-backends', 'payload-manifest.json'),
    silentInstall: {
      arguments: ['/S', `/D=${installRoot}`],
      waited: true,
      exitCode: 0,
    },
  }
}

async function runGenerator({
  installerPath,
  installRoot,
  outputRoot,
  sourceRoot = installRoot.includes('installed') ? installRoot.slice(0, installRoot.lastIndexOf('installed')).replace(/[\\/]$/, '') : installRoot,
  toolchainRecordPath = join(sourceRoot, 'controlled-toolchain-record.json'),
  archiveRoot = join(sourceRoot, 'installer-archive'),
  importReader = "{ param([string]$Path) 'DLL Name: KERNEL32.dll`nDLL Name: USER32.dll' }",
  repository = 'llbz510/rain',
  sourceRepository = 'https://github.com/llbz510/rain.git',
  manifestOnly = false,
  omitInstallationProof = false,
  installationProof,
}: {
  installerPath: string
  installRoot: string
  outputRoot: string
  sourceRoot?: string
  toolchainRecordPath?: string
  archiveRoot?: string
  importReader?: string
  repository?: string
  sourceRepository?: string
  manifestOnly?: boolean
  omitInstallationProof?: boolean
  installationProof?: ReturnType<typeof createNsisInstallationProof>
}) {
  const candidateTarget = '3006757838b972b511917663e4ba8328804607d6'
  const toolingCommit = '1111111111111111111111111111111111111111'
  const proof = installationProof ?? createNsisInstallationProof(installerPath, installRoot)
  const proofBase64 = Buffer.from(JSON.stringify(proof), 'utf8').toString('base64')
  const proofPreamble = omitInstallationProof
    ? ''
    : `$nsisInstallationProof = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${proofBase64}')) | ConvertFrom-Json`
  const proofArgument = omitInstallationProof ? '' : ' -NsisInstallationProof $nsisInstallationProof'
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$module = Import-Module -Name ${psQuoted(generatorModulePath)} -Force -PassThru`,
    proofPreamble,
    `$result = New-RainControlledReleaseArtifacts ${manifestOnly ? '-ManifestOnly ' : ''}-InstallerPath ${psQuoted(installerPath)} -InstalledRoot ${psQuoted(installRoot)} -InstallerArchiveRoot ${psQuoted(archiveRoot)} -CandidateSourceRoot ${psQuoted(sourceRoot)} -ToolchainRecordPath ${psQuoted(toolchainRecordPath)} -OutputDirectory ${psQuoted(outputRoot)} -CandidateTargetCommit ${psQuoted(candidateTarget)} -ToolingCommit ${psQuoted(toolingCommit)} -Repository ${psQuoted(repository)} -SourceRepository ${psQuoted(sourceRepository)} -GeneratorId 'rain-controlled-artifact-generator' -GeneratorVersion '1' -BuildRecordId 'test-build-001' -BuiltAt '2026-08-11T12:00:00.0000000+00:00' -WorkflowFile '.github/workflows/controlled-gpu-artifact-build.yml' -WorkflowRunUrl 'https://github.com/llbz510/rain/actions/runs/123/attempts/1' -WorkflowEvent 'workflow_dispatch' -WorkflowRef 'refs/heads/master' -WorkflowRunId '123' -WorkflowRunAttempt 1 -WorkflowDefinitionCommit ${psQuoted(toolingCommit)} -CandidateMasterReachable $true -ToolingMasterReachable $true -CoreArtifactName 'rain-candidate-core' -CoreArtifactDigest '${'2'.repeat(64)}' -GetPeImportText ${importReader}${proofArgument}`,
    '$result | ConvertTo-Json -Depth 30 -Compress',
  ].join('; ')
  const stdout = await runPowerShell([
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ])
  return JSON.parse(stdout)
}

async function runControlledBuildRecord({
  installerPath,
  artifactManifestPath,
  sourceRoot,
  outputRoot,
  manifestReadAdapter,
}: {
  installerPath: string
  artifactManifestPath: string
  sourceRoot: string
  outputRoot: string
  manifestReadAdapter: string
}) {
  const candidateTarget = '3006757838b972b511917663e4ba8328804607d6'
  const toolingCommit = '1111111111111111111111111111111111111111'
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `Import-Module -Name ${psQuoted(generatorModulePath)} -Force`,
    `$manifestReadAdapter = ${manifestReadAdapter}`,
    `$result = New-RainControlledBuildRecord -InstallerPath ${psQuoted(installerPath)} -ArtifactManifestPath ${psQuoted(artifactManifestPath)} -CandidateSourceRoot ${psQuoted(sourceRoot)} -ToolchainRecordPath (Join-Path ${psQuoted(sourceRoot)} 'controlled-toolchain-record.json') -OutputDirectory ${psQuoted(outputRoot)} -CandidateTargetCommit ${psQuoted(candidateTarget)} -ToolingCommit ${psQuoted(toolingCommit)} -Repository 'llbz510/rain' -SourceRepository 'https://github.com/llbz510/rain.git' -GeneratorId 'rain-controlled-artifact-generator' -GeneratorVersion '1' -BuildRecordId 'test-build-001' -BuiltAt '2026-08-11T12:00:00.0000000+00:00' -WorkflowFile '.github/workflows/controlled-gpu-artifact-build.yml' -WorkflowRunUrl 'https://github.com/llbz510/rain/actions/runs/123/attempts/1' -WorkflowEvent 'workflow_dispatch' -WorkflowRef 'refs/heads/master' -WorkflowRunId '123' -WorkflowRunAttempt 1 -WorkflowDefinitionCommit ${psQuoted(toolingCommit)} -CandidateMasterReachable $true -ToolingMasterReachable $true -CoreArtifactName 'rain-candidate-core' -CoreArtifactDigest '${'2'.repeat(64)}' -ManifestReadAdapter $manifestReadAdapter`,
    '$result | ConvertTo-Json -Depth 30 -Compress',
  ].join('; ')
  const stdout = await runPowerShell([
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ])
  return JSON.parse(stdout)
}

afterEach(() => cleanupPowerShellTestResources())

describe('controlled release artifact generator', () => {
  it('settles and reports a cleanup-denied PowerShell child without a later timer throw', async () => {
    const root = newTemporaryRoot()
    let completion!: ChildProcessCompletion
    let capturedTimeout: (() => void) | undefined
    let timeoutCleared = false
    const invocation = runPowerShell(['-NoProfile'], {
      timeoutMs: 10,
      startChild: (_executable, _arguments, callback) => {
        completion = callback
        return {
          pid: 12345,
          kill: () => {
            throw new Error('simulated cleanup kill denial')
          },
        }
      },
      timeoutAdapter: {
        schedule: (callback) => {
          capturedTimeout = callback
          return {} as ReturnType<typeof setTimeout>
        },
        clear: () => {
          timeoutCleared = true
        },
      },
    })
    const invocationOutcomePromise = invocation.then(
      () => ({ kind: 'resolved' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, message: error instanceof Error ? error.message : String(error) }),
    )

    let cleanupError: Error | undefined
    try {
      await cleanupPowerShellTestResources(20)
    } catch (error) {
      cleanupError = error instanceof Error ? error : new Error(String(error))
    }
    const invocationOutcome = await Promise.race([
      invocationOutcomePromise,
      new Promise<{ kind: 'pending' }>((resolve) => setTimeout(() => resolve({ kind: 'pending' }), 0)),
    ])
    let laterTimerError: unknown
    try {
      capturedTimeout?.()
    } catch (error) {
      laterTimerError = error
    }
    completion(new Error('simulated child callback after cleanup'), '', '')

    expect(cleanupError?.message).toMatch(/terminate child 12345: simulated cleanup kill denial/i)
    expect(cleanupError?.message).toMatch(/did not exit within 20 ms/i)
    expect(cleanupError?.message).toMatch(/remained active after cleanup/i)
    expect(cleanupError?.message).toMatch(/preserved TEMP root/i)
    expect(existsSync(root)).toBe(true)
    expect(invocationOutcome).toMatchObject({ kind: 'rejected' })
    if (invocationOutcome.kind === 'rejected') {
      expect(invocationOutcome.message).toMatch(/cleanup termination failed: simulated cleanup kill denial/i)
    }
    expect(timeoutCleared).toBe(true)
    expect(laterTimerError).toBeUndefined()
  })

  // Clean Windows Harness run 31806779813 exceeded Vitest's default 5 s while
  // this test exercised two isolated generator subprocesses (one pass, one rejection).
  it('accepts a bound NSIS proof expressed through the real Windows 8.3 alias but still rejects a different existing path', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const shortRoot = await windowsShortPath(root)
    expect(shortRoot.toLowerCase()).not.toBe(root.toLowerCase())

    const shortInstallerPath = installerPath.replace(root, shortRoot)
    const shortInstallRoot = installRoot.replace(root, shortRoot)
    const aliasedProof = createNsisInstallationProof(shortInstallerPath, shortInstallRoot)
    const accepted = await observeEventLoopWhileRunning(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
      installationProof: aliasedProof,
      manifestOnly: true,
    }))
    expect(accepted.timerAdvancedBeforeCompletion).toBe(true)

    const escapedProof = createNsisInstallationProof(shortInstallerPath, shortInstallRoot)
    escapedProof.mainExecutable = shortInstallerPath
    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'escaped-output'),
      installationProof: escapedProof,
      manifestOnly: true,
    })).rejects.toThrow(/exact application-root layout/i)
    expect(activePowerShellProcesses.size).toBe(0)
  }, 15_000)

  it('serializes the normalized remote toolchain record into the core manifest', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const result = await runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
      manifestOnly: true,
    })
    const manifest = JSON.parse(readFileSync(result.artifactManifestPath, 'utf8'))
    expect(manifest.controlledBuild.toolchain).toMatchObject({
      record: expect.objectContaining({ fileName: 'controlled-toolchain-record.json' }),
      cuda: { toolkitVersion: '12.9.1', architectures: ['120'] },
      runner: expect.objectContaining({ image: 'windows-2025', architecture: 'X64' }),
      node: { version: 'v24.0.0' },
      npm: { version: '11.0.0' },
      cargo: { version: 'cargo 1.96.1' },
      msvc: { version: '14.44.35207', hostArchitecture: 'x64', targetArchitecture: 'x64' },
      nsis: { version: 'v3.11' },
      downloads: expect.objectContaining({
        cmake: expect.objectContaining({ sha256: '89e87f3e297b70f1349ee7c5f90783ca96efb986b70c558c799c3c9b1b716456' }),
        cuda: expect.objectContaining({ sha256: 'f0ca7cc7b4cea2fac2c4951819d2a9caea31e04000e9110e2048719525f8ea0e' }),
        llvm: expect.objectContaining({ sha256: 'e091fcf965ce589c83c0f7c5356b2fcf3e658a8ec990bfcf79cce4389a0d1eb3' }),
        nsis: expect.objectContaining({
          url: pinnedNsisDirectUrl,
          sha256: '38d49f8fe09b1c332b01d0940e57b7258f4447733643273a01c59959ad9d3b0a',
        }),
      }),
    })
  })

  it('rejects the legacy NSIS HTML download page even when the pinned SHA-256 is retained', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, toolchainRecordPath } = createInstalledTreeFixture(root)
    const toolchain = JSON.parse(readFileSync(toolchainRecordPath, 'utf8'))
    toolchain.downloads.nsis.url = legacyNsisDownloadPageUrl
    writeFixtureFile(toolchainRecordPath, JSON.stringify(toolchain))

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
      manifestOnly: true,
    })).rejects.toThrow(/downloads nsis url must be the pinned download URL/i)
  })

  it('fails closed when a controlled toolchain record omits a pinned download hash', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, toolchainRecordPath } = createInstalledTreeFixture(root)
    const toolchain = JSON.parse(readFileSync(toolchainRecordPath, 'utf8'))
    delete toolchain.downloads.nsis.sha256
    writeFixtureFile(toolchainRecordPath, JSON.stringify(toolchain))

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).rejects.toThrow(/downloads nsis sha256/i)
  })

  it('refuses a remote toolchain record that omits the explicit Blackwell-compatible CUDA architecture', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, toolchainRecordPath } = createInstalledTreeFixture(root)
    const toolchain = JSON.parse(readFileSync(toolchainRecordPath, 'utf8'))
    toolchain.cuda.architectures = ['89']
    writeFixtureFile(toolchainRecordPath, JSON.stringify(toolchain))

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).rejects.toThrow(/cuda\.architectures must be exactly 120/i)
  })

  it('derives a target-bound manifest and independent record from actual candidate bytes', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const outputRoot = join(root, 'candidate-output')
    const candidateTarget = '3006757838b972b511917663e4ba8328804607d6'
    const toolingCommit = '1111111111111111111111111111111111111111'
    const result = await runGenerator({ installerPath, installRoot, outputRoot })
    const manifestPath = result.artifactManifestPath as string
    const recordPath = result.controlledBuildRecordPath as string
    expect(existsSync(manifestPath)).toBe(true)
    expect(existsSync(recordPath)).toBe(true)

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const serializedManifest = readFileSync(manifestPath, 'utf8')
    const record = JSON.parse(readFileSync(recordPath, 'utf8'))
    expect(manifest.targetCommit).toBe(candidateTarget)
    expect(manifest).toMatchObject({
      productName: 'Rain',
      version: '0.1.0',
      identifier: 'com.rain.app',
      installer: expect.objectContaining({ kind: 'nsis-windows-x64' }),
    })
    expect(manifest.controlledBuild.targetCommit).toBe(candidateTarget)
    expect(manifest.controlledBuild.toolingCommit).toBe(toolingCommit)
    expect(manifest.mainExecutable.path).toBe('rain.exe')
    expect(manifest.resources.cudaWorker.path).toBe('resources/whisper-backends/rain-whisper-cuda.exe')
    expect(manifest.resources.cudaPayloadManifest).toMatchObject({
      path: 'resources/whisper-backends/payload-manifest.json',
      configuration: 'release',
    })
    expect(manifest.resources.cudaRuntime.files.map((file: { name: string }) => file.name).sort()).toEqual([
      'cublas64_12.dll',
      'cublasLt64_12.dll',
      'cudart64_12.dll',
    ])
    expect(manifest.hygieneScopes).toEqual(['installed-tree', 'installer-archive'])
    expect(manifest.installationProof).toEqual({
      kind: 'rain-nsis-install-proof-v2',
      schemaVersion: 2,
      installerSha256: sha256(installerPath),
      mainExecutable: { path: 'rain.exe', machine: 0x8664 },
      payloadManifest: { path: 'resources/whisper-backends/payload-manifest.json' },
      silentInstall: { mode: 'silent', destinationKind: 'unique-runner-temp', waited: true, exitCode: 0 },
    })
    expect(serializedManifest).not.toContain(installRoot)
    expect(serializedManifest).not.toContain('/D=')
    expect(record.targetCommit).toBe(candidateTarget)
    expect(record.toolingCommit).toBe(toolingCommit)
    expect(record.repository).toBe('llbz510/rain')
    expect(record.sourceRepository).toBe('https://github.com/llbz510/rain.git')
    expect(record.workflow).toMatchObject({
      runUrl: 'https://github.com/llbz510/rain/actions/runs/123/attempts/1',
      event: 'workflow_dispatch',
      ref: 'refs/heads/master',
      runId: '123',
      runAttempt: 1,
    })
    expect(record.masterReachability).toEqual({ candidate: true, tooling: true })
    expect(manifest.controlledBuild.toolchain).toMatchObject({
      cmake: { version: '4.0.0', minimumVersion: '4.0.0' },
      cuda: { toolkitVersion: '12.9.1', architectures: ['120'] },
    })
    expect(record.toolchain).toMatchObject({
      cmake: { version: '4.0.0', minimumVersion: '4.0.0' },
      cuda: { toolkitVersion: '12.9.1', architectures: ['120'] },
    })
    expect(record.artifactManifest.sha256).toBe(sha256(manifestPath))
    expect(record.installer.sha256).toBe(sha256(installerPath))
  })

  it('keeps installer archive/unpack hygiene scanning as an additive release judge', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    writeFixtureFile(join(archiveRoot, '.env.production'), 'SECRET_TOKEN=fixture-value')
    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/installer-archive.*secret|secret.*installer-archive/i)
  })

  it('accepts the 7z-reduced NSIS application root plus a separate direct $PLUGINSDIR plugin directory', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)

    await runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') })
  })

  it('rejects an archive that omits the required direct NSIS plugin directory', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    rmSync(join(archiveRoot, '$PLUGINSDIR'), { recursive: true, force: true })

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/exactly one explicit NSIS \$PLUGINSDIR plugin directory; found 0/i)
  })

  it('rejects an archive whose only exact NSIS plugin directory is nested', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    mkdirSync(join(archiveRoot, 'shadow'), { recursive: true })
    renameSync(join(archiveRoot, '$PLUGINSDIR'), join(archiveRoot, 'shadow', '$PLUGINSDIR'))

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/NSIS \$PLUGINSDIR plugin directory must be a direct child of the extraction root/i)
  })

  it('rejects a Rain executable placed below a physical $INSTDIR directory instead of the 7z-reduced extraction root', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    mkdirSync(join(archiveRoot, '$INSTDIR'), { recursive: true })
    renameSync(join(archiveRoot, 'Rain.exe'), join(archiveRoot, '$INSTDIR', 'Rain.exe'))

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/must not contain a physical NSIS \$INSTDIR marker; found 1/i)
  })

  it('rejects an otherwise empty physical $INSTDIR marker in the archive tree', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    mkdirSync(join(archiveRoot, '$INSTDIR'), { recursive: true })

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/must not contain a physical NSIS \$INSTDIR marker; found 1/i)
  })

  it('rejects a wrong-case physical $instdir marker even when it contains only an ordinary PE file', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    writePeFixture(join(archiveRoot, '$instdir', 'ordinary.exe'), 0x14c)

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/must not contain a physical NSIS \$INSTDIR marker; found 1/i)
  })

  it('rejects a Rain executable placed in the direct plugin directory instead of the extraction root', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    renameSync(join(archiveRoot, 'Rain.exe'), join(archiveRoot, '$PLUGINSDIR', 'Rain.exe'))

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/Rain executable must be located at the extraction root as Rain\.exe/i)
  })

  it('rejects a second AMD64 Rain executable anywhere in the extracted archive', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    writePeFixture(join(archiveRoot, 'shadow', 'Rain.exe'), 0x8664)

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/exactly one AMD64 Rain executable; found 2/i)
  })

  it('rejects a wrong-case NSIS plugin directory name instead of treating it as the exact plugin directory', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    renameSync(join(archiveRoot, '$PLUGINSDIR'), join(archiveRoot, '$pluginsdir'))

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/exactly one explicit NSIS \$PLUGINSDIR plugin directory; found 0/i)
  })

  it('rejects a nested second exact NSIS plugin directory even when it contains no Rain payload', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    mkdirSync(join(archiveRoot, 'shadow', '$PLUGINSDIR'), { recursive: true })

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/exactly one explicit NSIS \$PLUGINSDIR plugin directory; found 2/i)
  })

  it('rejects a duplicate CUDA worker outside the unique NSIS application payload root', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    writeFixtureFile(join(archiveRoot, 'shadow', 'rain-whisper-cuda.exe'), 'duplicate archive worker')

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/exactly one required CUDA payload file 'rain-whisper-cuda\.exe'; found 2/i)
  })

  it('rejects an unexpected file in the NSIS CUDA payload directory instead of accepting a superset', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    writeFixtureFile(join(archiveRoot, 'resources', 'whisper-backends', 'unexpected.dll'), 'unexpected archive runtime')

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/payload directory must contain exactly the payload manifest, worker, and three CUDA runtime DLLs/i)
  })

  it('rejects a CUDA payload moved into the plugin directory instead of the extraction-root application payload', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    const applicationPayload = join(archiveRoot, 'resources', 'whisper-backends')
    const pluginPayload = join(archiveRoot, '$PLUGINSDIR', 'resources', 'whisper-backends')
    cpSync(applicationPayload, pluginPayload, { recursive: true })
    rmSync(applicationPayload, { recursive: true, force: true })

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/CUDA payload manifest must be located at resources\/whisper-backends\/payload-manifest\.json below the\s+extraction root/i)
  })

  it('rejects a CUDA payload moved into a physical $INSTDIR directory instead of the extraction-root application payload', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    const applicationPayload = join(archiveRoot, 'resources', 'whisper-backends')
    const instdirPayload = join(archiveRoot, '$INSTDIR', 'resources', 'whisper-backends')
    cpSync(applicationPayload, instdirPayload, { recursive: true })
    rmSync(applicationPayload, { recursive: true, force: true })

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/must not contain a physical NSIS \$INSTDIR marker; found 1/i)
  })

  it('rejects an empty installer archive extraction instead of declaring an unscanned scope clean', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    rmSync(archiveRoot, { recursive: true, force: true })
    mkdirSync(archiveRoot, { recursive: true })

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/installer archive.*empty|archive.*no files/i)
  })

  it('rejects an installer archive extraction that lacks the Rain executable or CUDA payload manifest', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    rmSync(archiveRoot, { recursive: true, force: true })
    writeFixtureFile(join(archiveRoot, 'unrelated-file.txt'), 'not a Rain payload')

    await expect(runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/installer archive.*AMD64 Rain executable|archive.*CUDA payload/i)
  })

  it('rejects a controlled toolchain record whose CMake version drifts above the pinned 4.0.0', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, toolchainRecordPath } = createInstalledTreeFixture(root)
    const toolchain = JSON.parse(readFileSync(toolchainRecordPath, 'utf8'))
    toolchain.cmake.version = '4.0.1'
    writeFixtureFile(toolchainRecordPath, JSON.stringify(toolchain))

    await expect(runGenerator({ installerPath, installRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/cmake\.version must be exactly 4\.0\.0/i)
  })

  it('rejects a text file that merely has an .exe name instead of a PE/NSIS installer artifact', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeFixtureFile(installerPath, 'this is not an NSIS installer')

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).rejects.toThrow(/basic PE artifact/i)
  })

  it('rejects an installer whose source-derived product metadata does not match the expected NSIS artifact name', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeTauriMetadataFixture(root, { productName: 'Different Product' })

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).rejects.toThrow(/source-derived NSIS installer file name/i)
  })

  it('accepts an I386 NSIS bootstrapper when the installed Rain executable is AMD64', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeNsisInstallerFixture(installerPath, 0x14c)

    await runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })
  })

  it('does not accept a name-matched random PE without a successful bound NSIS installation proof', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writePeFixture(installerPath, 0x14c)

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
      omitInstallationProof: true,
    })).rejects.toThrow(/successful bound NSIS installation proof/i)
  })

  it('rejects an installed Rain executable outside the exact application-root layout', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    rmSync(join(installRoot, 'rain.exe'))
    writePeFixture(join(installRoot, 'unexpected', 'rain.exe'), 0x8664)

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).rejects.toThrow(/Rain main executable must be installed at rain\.exe/i)
  })

  it('rejects an installed NVIDIA driver DLL that is outside the approved CUDA payload', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, payloadRoot } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', 'nvcuda.dll'), 'fixture driver dll')

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).rejects.toThrow(/forbidden DLL/i)
  })

  it('rejects installed text that exposes an absolute builder path', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, payloadRoot } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', 'build-metadata.json'), JSON.stringify({
      sourceRoot: 'D:\\agent\\_work\\rain',
    }))

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).rejects.toThrow(/absolute builder path/i)
  })

  it.each([
    ['an OpenAI-style key', 'const credential = "sk-rain-fixture-not-a-real-key";', /secret/i],
    ['a Bearer credential', 'Authorization: Bearer rain-fixture-token-value', /secret/i],
    ['a JSON quoted API secret', '{"apiSecret":"rain-fixture-secret-value"}', /secret/i],
    ['a Windows user-profile path', '{"cache":"C:\\Users\\fixture-user\\AppData\\Local\\Rain"}', /absolute builder path/i],
  ])('rejects installed text that exposes %s', async (_label, contents, expectedError) => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', 'fixture-config.json'), contents)

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).rejects.toThrow(expectedError)
  })

  it.each([
    ['an environment variant', '.env.production', 'SAFE_FIXTURE=true', /secret/i],
    ['a PEM credential container', 'fixture.pem', 'fixture certificate', /secret/i],
    ['a private-key container', 'fixture.key', 'fixture key', /secret/i],
    ['an AWS access key in properties', 'fixture.properties', 'aws.accessKeyId=AKIA1234567890ABCDEF', /secret/i],
    ['a temporary AWS access key in properties', 'temporary.properties', 'aws.accessKeyId=ASIA1234567890ABCDEF', /secret/i],
    ['a PEM private-key body in unknown readable text', 'fixture.bundle', '-----BEGIN PRIVATE KEY-----\nfixture-private-material', /secret/i],
    ['an unknown readable text artifact', 'fixture.bundle', 'readable text with no known extension', /unscanned text artifact/i],
    ['a debug symbol', 'rain.pdb', 'fixture debug symbols', /debug artifact/i],
  ])('rejects installed artifact hygiene risk: %s', async (_label, name, contents, expectedError) => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', name), contents)
    await expect(runGenerator({ installerPath, installRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(expectedError)
  })

  it.each([
    ['ASCII', Buffer.from('MZ\0\0fixture ASIA1234567890ABCDEF payload', 'ascii')],
    ['UTF-16LE', Buffer.from('MZ fixture -----BEGIN PRIVATE KEY----- payload', 'utf16le')],
  ])('rejects a PE-like binary that embeds a %s secret token without treating ordinary PE bytes as text', async (_encoding, bytes) => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const binaryPath = join(installRoot, 'resources', 'fixture-helper.dll')
    mkdirSync(join(binaryPath, '..'), { recursive: true })
    writeFileSync(binaryPath, bytes)

    await expect(runGenerator({ installerPath, installRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/secret/i)
  })

  it('accepts ordinary PE-like binary bytes that do not contain a sensitive token', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writePeFixture(join(installRoot, 'resources', 'ordinary-helper.dll'), 0x8664)

    await runGenerator({ installerPath, installRoot, outputRoot: join(root, 'candidate-output') })
  })

  it('requires the CUDA payload manifest to declare release configuration', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, payloadRoot } = createInstalledTreeFixture(root)
    const manifestPath = join(payloadRoot, 'payload-manifest.json')
    const payloadManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    payloadManifest.configuration = 'debug'
    writeFixtureFile(manifestPath, JSON.stringify(payloadManifest))
    await expect(runGenerator({ installerPath, installRoot, outputRoot: join(root, 'candidate-output') }))
      .rejects.toThrow(/configuration must be release/i)
  })

  it('rejects an installed E2E automation marker', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', 'frontend.js'), 'window.__RAIN_E2E_READY__ = true')

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).rejects.toThrow(/E2E marker/i)
  })

  it('rejects an installed model payload file', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', 'whisper-models', 'ggml-large-v3.bin'), 'not a real model')

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).rejects.toThrow(/model file/i)
  })

  it('requires whisper-backends to contain exactly the declared worker, CUDA runtime, and payload manifest', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, payloadRoot } = createInstalledTreeFixture(root)
    writeFixtureFile(join(payloadRoot, 'unexpected-worker-note.txt'), 'unexpected payload file')

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).rejects.toThrow(/exact declared payload set/i)
  })

  it('rejects a second CUDA worker or allowed CUDA runtime DLL outside whisper-backends', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', 'duplicate', 'rain-whisper-cuda.exe'), 'duplicate worker')

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).rejects.toThrow(/must occur exactly once in whisper-backends/i)
  })

  it('rejects source maps and RAIN_WHISPER_CUDA_WORKER release-build markers from the installed tree', async () => {
    const sourceMapRoot = newTemporaryRoot()
    const sourceMapFixture = createInstalledTreeFixture(sourceMapRoot)
    writeFixtureFile(join(sourceMapFixture.installRoot, 'resources', 'frontend.js.map'), '{"sources":["src/main.tsx"]}')
    await expect(runGenerator({
      installerPath: sourceMapFixture.installerPath,
      installRoot: sourceMapFixture.installRoot,
      outputRoot: join(sourceMapRoot, 'candidate-output'),
    })).rejects.toThrow(/source map/i)

    const markerRoot = newTemporaryRoot()
    const markerFixture = createInstalledTreeFixture(markerRoot)
    writeFixtureFile(join(markerFixture.installRoot, 'resources', 'frontend.js'), 'window.RAIN_WHISPER_CUDA_WORKER = true')
    await expect(runGenerator({
      installerPath: markerFixture.installerPath,
      installRoot: markerFixture.installRoot,
      outputRoot: join(markerRoot, 'candidate-output'),
    })).rejects.toThrow(/E2E marker/i)
  })

  it('rejects a CUDA import in the CPU-safe main executable', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
      importReader: "{ param([string]$Path) 'DLL Name: cudart64_12.dll' }",
    })).rejects.toThrow(/CUDA or NVIDIA driver DLL/i)
  })

  it.each([
    'cudnn64_9.dll',
    'nvrtc64_120_0.dll',
    'cufft64_11.dll',
    'cusolver64_11.dll',
    'cusparse64_12.dll',
    'curand64_10.dll',
    'cupti64_2025.1.dll',
    'cufile.dll',
    'nvblas64_12.dll',
    'nvToolsExt64_1.dll',
    'nvopencl64.dll',
    'nppif64_12.dll',
  ])('rejects every shared CUDA/NVIDIA runtime-family import: %s', async (dllName) => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
      importReader: `{ param([string]$Path) 'DLL Name: ${dllName}' }`,
    })).rejects.toThrow(/CUDA or NVIDIA driver DLL/i)
  })

  it('rejects a fork repository before it can generate a controlled artifact record', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)

    await expect(runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
      repository: 'untrusted-fork/rain',
    })).rejects.toThrow(/Repository must be llbz510\/rain/i)
  })

  it('defers the controlled-build record until a first core-upload digest is available', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const outputRoot = join(root, 'candidate-output')
    const candidateTarget = '3006757838b972b511917663e4ba8328804607d6'
    const toolingCommit = '1111111111111111111111111111111111111111'
    const coreDigest = '2'.repeat(64)
    const importReader = "{ param([string]$Path) 'DLL Name: KERNEL32.dll`nDLL Name: USER32.dll' }"
    const proofBase64 = Buffer.from(JSON.stringify(createNsisInstallationProof(installerPath, installRoot)), 'utf8').toString('base64')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `Import-Module -Name ${psQuoted(generatorModulePath)} -Force`,
      `$nsisInstallationProof = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${proofBase64}')) | ConvertFrom-Json`,
      `$manifestResult = New-RainControlledReleaseArtifacts -ManifestOnly -InstallerPath ${psQuoted(installerPath)} -InstalledRoot ${psQuoted(installRoot)} -InstallerArchiveRoot (Join-Path ${psQuoted(root)} 'installer-archive') -CandidateSourceRoot ${psQuoted(root)} -ToolchainRecordPath (Join-Path ${psQuoted(root)} 'controlled-toolchain-record.json') -OutputDirectory ${psQuoted(outputRoot)} -CandidateTargetCommit ${psQuoted(candidateTarget)} -ToolingCommit ${psQuoted(toolingCommit)} -Repository 'llbz510/rain' -SourceRepository 'https://github.com/llbz510/rain.git' -GeneratorId 'rain-controlled-artifact-generator' -GeneratorVersion '1' -BuildRecordId 'test-build-001' -BuiltAt '2026-08-11T12:00:00.0000000+00:00' -WorkflowFile '.github/workflows/controlled-gpu-artifact-build.yml' -WorkflowRunUrl 'https://github.com/llbz510/rain/actions/runs/123/attempts/1' -WorkflowEvent 'workflow_dispatch' -WorkflowRef 'refs/heads/master' -WorkflowRunId '123' -WorkflowRunAttempt 1 -WorkflowDefinitionCommit ${psQuoted(toolingCommit)} -CandidateMasterReachable $true -ToolingMasterReachable $true -GetPeImportText ${importReader} -NsisInstallationProof $nsisInstallationProof`,
      `$noRecordBeforeCoreUploadDigest = -not (Test-Path -LiteralPath (Join-Path ${psQuoted(outputRoot)} 'controlled-build-record.json'))`,
      `$manifestReadAdapter = { param($path) $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json; $value.controlledBuild.buildMetadata.builtAt = [DateTime]::Parse([string]$value.controlledBuild.buildMetadata.builtAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind); return $value }`,
      `$recordResult = New-RainControlledBuildRecord -InstallerPath ${psQuoted(installerPath)} -ArtifactManifestPath $manifestResult.artifactManifestPath -CandidateSourceRoot ${psQuoted(root)} -ToolchainRecordPath (Join-Path ${psQuoted(root)} 'controlled-toolchain-record.json') -OutputDirectory ${psQuoted(outputRoot)} -CandidateTargetCommit ${psQuoted(candidateTarget)} -ToolingCommit ${psQuoted(toolingCommit)} -Repository 'llbz510/rain' -SourceRepository 'https://github.com/llbz510/rain.git' -GeneratorId 'rain-controlled-artifact-generator' -GeneratorVersion '1' -BuildRecordId 'test-build-001' -BuiltAt '2026-08-11T12:00:00.0000000+00:00' -WorkflowFile '.github/workflows/controlled-gpu-artifact-build.yml' -WorkflowRunUrl 'https://github.com/llbz510/rain/actions/runs/123/attempts/1' -WorkflowEvent 'workflow_dispatch' -WorkflowRef 'refs/heads/master' -WorkflowRunId '123' -WorkflowRunAttempt 1 -WorkflowDefinitionCommit ${psQuoted(toolingCommit)} -CandidateMasterReachable $true -ToolingMasterReachable $true -CoreArtifactName 'rain-candidate-core' -CoreArtifactDigest ${psQuoted(coreDigest)} -ManifestReadAdapter $manifestReadAdapter`,
      `[ordered]@{ manifestPath = $manifestResult.artifactManifestPath; recordPath = $recordResult.controlledBuildRecordPath; noRecordBeforeCoreUploadDigest = $noRecordBeforeCoreUploadDigest } | ConvertTo-Json -Compress`,
    ].join('; ')

    const stdout = await runPowerShell([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command,
    ])
    const result = JSON.parse(stdout)
    expectSameExistingFile(result.manifestPath, join(outputRoot, 'release-artifact-manifest.json'))
    expectSameExistingFile(result.recordPath, join(outputRoot, 'controlled-build-record.json'))
    expect(result.noRecordBeforeCoreUploadDigest).toBe(true)
    const record = JSON.parse(readFileSync(result.recordPath, 'utf8'))
    expect(record.coreArtifact).toEqual({ name: 'rain-candidate-core', digest: coreDigest })
  })

  // Clean Windows Harness run 31806779813 exceeded Vitest's default 5 s while
  // this test exercised one manifest plus four isolated controlled-record subprocesses.
  it('accepts the same instant parsed as DateTime but fails closed for different, invalid, or missing manifest builtAt metadata', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const sourceRoot = root
    const manifestResult = await runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'manifest-output'),
      manifestOnly: true,
    })
    const readAsDateTime = "{ param($path) $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json; $value.controlledBuild.buildMetadata.builtAt = [DateTime]::Parse([string]$value.controlledBuild.buildMetadata.builtAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind); return $value }"

    const accepted = await runControlledBuildRecord({
      installerPath,
      artifactManifestPath: manifestResult.artifactManifestPath,
      sourceRoot,
      outputRoot: join(root, 'same-instant-record'),
      manifestReadAdapter: readAsDateTime,
    })
    expectSameExistingFile(accepted.controlledBuildRecordPath, join(root, 'same-instant-record', 'controlled-build-record.json'))

    const readDifferentDateTime = "{ param($path) $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json; $value.controlledBuild.buildMetadata.builtAt = [DateTime]::Parse('2026-08-11T12:00:01.0000000+00:00', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind); return $value }"
    await expect(runControlledBuildRecord({
      installerPath,
      artifactManifestPath: manifestResult.artifactManifestPath,
      sourceRoot,
      outputRoot: join(root, 'different-instant-record'),
      manifestReadAdapter: readDifferentDateTime,
    })).rejects.toThrow(/controlled-build metadata does not match/i)

    const readInvalidTimestamp = "{ param($path) $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json; $value.controlledBuild.buildMetadata.builtAt = 'not-an-iso-8601-timestamp'; return $value }"
    await expect(runControlledBuildRecord({
      installerPath,
      artifactManifestPath: manifestResult.artifactManifestPath,
      sourceRoot,
      outputRoot: join(root, 'invalid-timestamp-record'),
      manifestReadAdapter: readInvalidTimestamp,
    })).rejects.toThrow(/controlled-build metadata does not match/i)

    const readMissingTimestamp = "{ param($path) $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json; [void]$value.controlledBuild.buildMetadata.PSObject.Properties.Remove('builtAt'); return $value }"
    await expect(runControlledBuildRecord({
      installerPath,
      artifactManifestPath: manifestResult.artifactManifestPath,
      sourceRoot,
      outputRoot: join(root, 'missing-timestamp-record'),
      manifestReadAdapter: readMissingTimestamp,
    })).rejects.toThrow(/builtAt/i)
  }, 30_000)

  it('retries atomic manifest and record publication without leaving a partial temporary file', async () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const outputRoot = join(root, 'candidate-output')
    const candidateTarget = '3006757838b972b511917663e4ba8328804607d6'
    const toolingCommit = '1111111111111111111111111111111111111111'
    const proofBase64 = Buffer.from(JSON.stringify(createNsisInstallationProof(installerPath, installRoot)), 'utf8').toString('base64')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `Import-Module -Name ${psQuoted(generatorModulePath)} -Force`,
      '$state = [pscustomobject]@{ attempts = 0 }',
      "$adapter = [pscustomobject]@{ writeText = { param($path, $text) [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false)) }; publish = { param($temporary, $destination) $state.attempts++; if ($state.attempts -eq 1) { throw [System.IO.IOException]::new('simulated sharing violation') }; [System.IO.File]::Move($temporary, $destination) }; remove = { param($path) if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }; sleep = { param($attempt) } }",
      `$nsisInstallationProof = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${proofBase64}')) | ConvertFrom-Json`,
      `$result = New-RainControlledReleaseArtifacts -InstallerPath ${psQuoted(installerPath)} -InstalledRoot ${psQuoted(installRoot)} -InstallerArchiveRoot (Join-Path ${psQuoted(root)} 'installer-archive') -CandidateSourceRoot ${psQuoted(root)} -ToolchainRecordPath (Join-Path ${psQuoted(root)} 'controlled-toolchain-record.json') -OutputDirectory ${psQuoted(outputRoot)} -CandidateTargetCommit ${psQuoted(candidateTarget)} -ToolingCommit ${psQuoted(toolingCommit)} -Repository 'llbz510/rain' -SourceRepository 'https://github.com/llbz510/rain.git' -GeneratorId 'rain-controlled-artifact-generator' -GeneratorVersion '1' -BuildRecordId 'test-build-atomic' -BuiltAt '2026-08-11T12:00:00.0000000+00:00' -WorkflowFile '.github/workflows/controlled-gpu-artifact-build.yml' -WorkflowRunUrl 'https://github.com/llbz510/rain/actions/runs/123/attempts/1' -WorkflowEvent 'workflow_dispatch' -WorkflowRef 'refs/heads/master' -WorkflowRunId '123' -WorkflowRunAttempt 1 -WorkflowDefinitionCommit ${psQuoted(toolingCommit)} -CandidateMasterReachable $true -ToolingMasterReachable $true -CoreArtifactName 'rain-candidate-core' -CoreArtifactDigest '${'2'.repeat(64)}' -GetPeImportText { param([string]$Path) 'DLL Name: KERNEL32.dll' } -AtomicWriteAdapter $adapter -NsisInstallationProof $nsisInstallationProof`,
      `$temporaryFiles = @(Get-ChildItem -LiteralPath ${psQuoted(outputRoot)} -Force -Filter '*.tmp' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)`,
      '[ordered]@{ attempts = $state.attempts; manifest = $result.artifactManifestPath; record = $result.controlledBuildRecordPath; temporaryFiles = @($temporaryFiles) } | ConvertTo-Json -Compress',
    ].join('; ')
    const stdout = await runPowerShell([
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ])
    const result = JSON.parse(stdout)

    expect(result.attempts).toBe(3)
    expect(existsSync(result.manifest)).toBe(true)
    expect(existsSync(result.record)).toBe(true)
    expect(result.temporaryFiles).toEqual([])
  })

  it('fails explicitly instead of swallowing a release-artifact temporary cleanup failure', async () => {
    const root = newTemporaryRoot()
    const outputPath = join(root, 'candidate-output', 'release-artifact-manifest.json')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `$module = Import-Module -Name ${psQuoted(generatorModulePath)} -Force -PassThru`,
      "$adapter = [pscustomobject]@{ writeText = { param($path, $text) [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false)) }; publish = { param($temporary, $destination) [System.IO.File]::Move($temporary, $destination) }; remove = { param($path) throw [System.IO.IOException]::new('simulated temporary cleanup failure') }; sleep = { param($attempt) } }",
      `& $module { param($path, $adapter) Write-RainReleaseArtifactJson -Path $path -Value ([ordered]@{ fixture = $true }) -AtomicWriteAdapter $adapter } ${psQuoted(outputPath)} $adapter`,
    ].join('; ')

    await expect(runPowerShell([
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ])).rejects.toThrow(/release artifact temporary cleanup failed/i)
  })
})
