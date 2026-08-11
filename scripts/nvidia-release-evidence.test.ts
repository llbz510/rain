import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile, spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..')
const runnerPath = join(repoRoot, 'scripts', 'run-nvidia-release-evidence.ps1')
const contractModulePath = join(repoRoot, 'scripts', 'nvidia-release-evidence-contract.psm1')
const temporaryRoots: string[] = []

function resolvePowerShellExecutable(
  environment: Record<string, string | undefined> = process.env,
  isAvailable: (candidate: string) => boolean = (candidate) => {
    const probe = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$null'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    return probe.status === 0
  },
) {
  const override = environment.RAIN_TEST_POWERSHELL_EXE?.trim()
  if (override) return override
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    if (isAvailable(candidate)) return candidate
  }
  throw new Error('NVIDIA release-evidence tests require pwsh.exe or powershell.exe.')
}

const powerShellExecutable = resolvePowerShellExecutable()

function runPowerShell(arguments_: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile(powerShellExecutable, arguments_, {
      encoding: 'utf8',
      windowsHide: true,
    }, (error, stdout, stderr) => {
      resolve({
        status: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        stdout: String(stdout),
        stderr: String(stderr),
      })
    })
  })
}

function newTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'rain-nvidia-evidence-test-'))
  temporaryRoots.push(root)
  return root
}

function sha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function writePcmWavFixture(path: string, durationSeconds: number) {
  const sampleRateHz = 16_000
  const dataBytes = sampleRateHz * 2 * durationSeconds
  const bytes = Buffer.alloc(44 + dataBytes)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(36 + dataBytes, 4)
  bytes.write('WAVE', 8, 'ascii')
  bytes.write('fmt ', 12, 'ascii')
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRateHz, 24)
  bytes.writeUInt32LE(sampleRateHz * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36, 'ascii')
  bytes.writeUInt32LE(dataBytes, 40)
  writeFileSync(path, bytes)
}

function psLiteral(value: string) {
  return value.replaceAll("'", "''")
}

async function invokeContract(request: Record<string, unknown>) {
  const script = `
$ErrorActionPreference = 'Stop'
try {
  Import-Module -Force '${psLiteral(contractModulePath)}'
  $request = @'
${JSON.stringify(request)}
'@ | ConvertFrom-Json
  if ($request.PSObject.Properties.Name -contains 'shadowGetFileHash' -and [bool]$request.shadowGetFileHash) {
    function global:Get-FileHash { throw 'Get-FileHash must not be used by the release-evidence contract.' }
  }
  $value = switch ([string]$request.operation) {
    'provenance' {
      Assert-CandidateArtifactProvenance -InstallerPath ([string]$request.installerPath) -ExpectedTargetCommit ([string]$request.expectedTargetCommit) -ExpectedInstallerSha256 ([string]$request.expectedInstallerSha256) -ArtifactManifestPath ([string]$request.artifactManifestPath) -ExpectedArtifactManifestSha256 ([string]$request.expectedArtifactManifestSha256)
      break
    }
    'payload' {
      Assert-InstalledCudaPayload -InstalledRoot ([string]$request.installedRoot) -PayloadManifestPath ([string]$request.payloadManifestPath)
      break
    }
    'payload-manifest-relative-identity' {
      Test-ReleaseEvidencePayloadManifestRelativeIdentity -RelativePath ([string]$request.relativePath) -ManifestLeafName ([string]$request.manifestLeafName)
      break
    }
    'writer' {
      $writer = New-ReleaseEvidenceWriter -RunRoot ([string]$request.runRoot) -EvidenceId ([string]$request.evidenceId) -ExpectedTargetCommit ([string]$request.expectedTargetCommit) -ExpectedInstallerSha256 ([string]$request.expectedInstallerSha256) -ExpectedArtifactManifestSha256 ([string]$request.expectedArtifactManifestSha256)
      Write-ReleaseEvidencePhase -Writer $writer -Phase 'input-validation' -Result 'passed' -Data @{ source = 'test' } | Out-Null
      $manifestPath = Write-ReleaseEvidenceFailureManifest -Writer $writer -Phase ([string]$request.failedPhase) -ErrorText ([string]$request.errorText)
      [ordered]@{ partialManifestPath = $writer.PartialManifestPath; manifestPath = $manifestPath }
      break
    }
    'tree-redaction-scan' {
      Assert-ReleaseEvidenceTreeRedacted -RunRoot ([string]$request.runRoot)
      break
    }
    'writer-success' {
      $writer = New-ReleaseEvidenceWriter -RunRoot ([string]$request.runRoot) -EvidenceId ([string]$request.evidenceId) -ExpectedTargetCommit ([string]$request.expectedTargetCommit) -ExpectedInstallerSha256 ([string]$request.expectedInstallerSha256) -ExpectedArtifactManifestSha256 ([string]$request.expectedArtifactManifestSha256) -RequiredPhases @($request.requiredPhases)
      foreach ($phase in @($request.phases)) {
        Write-ReleaseEvidencePhase -Writer $writer -Phase ([string]$phase) -Result 'passed' | Out-Null
      }
      $manifestPath = Write-ReleaseEvidenceSuccessManifest -Writer $writer -Facts @{ source = 'test' }
      [ordered]@{ partialManifestPath = $writer.PartialManifestPath; manifestPath = $manifestPath }
      break
    }
    'writer-duplicate-phase' {
      $writer = New-ReleaseEvidenceWriter -RunRoot ([string]$request.runRoot) -EvidenceId ([string]$request.evidenceId) -ExpectedTargetCommit ([string]$request.expectedTargetCommit) -ExpectedInstallerSha256 ([string]$request.expectedInstallerSha256) -ExpectedArtifactManifestSha256 ([string]$request.expectedArtifactManifestSha256)
      Write-ReleaseEvidencePhase -Writer $writer -Phase 'input-validation' -Result 'passed' -Data @{ marker = 'first' } | Out-Null
      $duplicateError = ''
      try {
        Write-ReleaseEvidencePhase -Writer $writer -Phase 'input-validation' -Result 'passed' -Data @{ marker = 'second' } | Out-Null
      } catch {
        $duplicateError = $_.Exception.Message
      }
      [ordered]@{
        duplicateError = $duplicateError
        phaseRecord = (Get-Content -LiteralPath (Join-Path $writer.RunRoot 'phases\\input-validation.json') -Raw | ConvertFrom-Json)
      }
      break
    }
    'pe-import-inspection' {
      Assert-PeImportInspectionResult -ToolName ([string]$request.toolName) -ExitCode ([int]$request.exitCode) -Output ([string]$request.output)
      break
    }
    'quote-process-arguments' {
      Join-ReleaseEvidenceWindowsCommandLine -Arguments @($request.arguments)
      break
    }
    'nsis-install-arguments' {
      Get-ReleaseEvidenceNsisInstallArguments -Destination ([string]$request.destination)
      break
    }
    'nsis-start-process-arguments' {
      Start-ReleaseEvidenceNsisInstaller -Installer 'C:\\fixture\\Rain_0.1.0_x64-setup.exe' -Destination ([string]$request.destination) -ProcessAdapter {
        param([string]$FilePath, [string[]]$ArgumentList, [switch]$Wait, [switch]$PassThru, [string]$WindowStyle)
        [pscustomobject]@{
          filePath = $FilePath
          argumentList = @($ArgumentList)
          wait = $Wait.IsPresent
          passThru = $PassThru.IsPresent
          windowStyle = $WindowStyle
        }
      }
      break
    }
    'main-executable-imports' {
      Assert-ReleaseEvidenceMainExecutableImports -ImportText ([string]$request.output)
      break
    }
    'install-directory' {
      Assert-ReleaseEvidenceInstallDirectory -InstallDir ([string]$request.installDir)
      break
    }
    'cancellation-fixture' {
      $actionError = ''
      $actionResult = $null
      try {
        $actionResult = Invoke-WithReleaseEvidenceCancellationFixture -TempRoot ([string]$request.tempRoot) -Action {
          param($fixture)
          if ([string]$request.actionMode -eq 'fail') {
            throw 'intentional fixture action failure'
          }
          $stream = [System.IO.File]::OpenRead([string]$fixture.path)
          try {
            $header = [byte[]]::new(44)
            if ($stream.Read($header, 0, $header.Length) -ne $header.Length) {
              throw 'fixture header was incomplete'
            }
          } finally {
            $stream.Dispose()
          }
          [pscustomobject]@{
            fixture = $fixture
            headerBase64 = [Convert]::ToBase64String($header)
          }
        }
      } catch {
        $actionError = $_.Exception.Message
      }
      $remainingFiles = @(Get-ChildItem -LiteralPath ([string]$request.tempRoot) -Recurse -File -ErrorAction SilentlyContinue)
      [pscustomobject]@{
        actionResult = $actionResult
        actionError = $actionError
        remainingFileCount = $remainingFiles.Count
        remainingBytes = [int64](($remainingFiles | Measure-Object -Property Length -Sum).Sum)
      }
      break
    }
    'cancellation-fixture-assert' {
      Assert-ReleaseEvidenceCancellationFixture -Path ([string]$request.path) -MinimumDurationSeconds ([int]$request.minimumDurationSeconds)
      break
    }
    'cancellation-fixture-io-failure' {
      $state = [pscustomobject]@{
        openAttempted = $false
        writerDisposed = $false
        streamDisposed = $false
        removeAttempted = $false
        createdPath = ''
      }
      $fakeStream = [pscustomobject]@{}
      Add-Member -InputObject $fakeStream -MemberType NoteProperty -Name InnerStream -Value $null
      Add-Member -InputObject $fakeStream -MemberType ScriptMethod -Name Write -Value { param($buffer, $offset, $count) }
      Add-Member -InputObject $fakeStream -MemberType ScriptMethod -Name Flush -Value { param($flushToDisk) }
      Add-Member -InputObject $fakeStream -MemberType ScriptMethod -Name Dispose -Value ({
        $state.streamDisposed = $true
        if ($this.InnerStream) { $this.InnerStream.Dispose() }
      }.GetNewClosure())
      $fakeWriter = [pscustomobject]@{}
      Add-Member -InputObject $fakeWriter -MemberType ScriptMethod -Name Write -Value { param($value) }
      Add-Member -InputObject $fakeWriter -MemberType ScriptMethod -Name Flush -Value { }
      Add-Member -InputObject $fakeWriter -MemberType ScriptMethod -Name Dispose -Value ({
        $state.writerDisposed = $true
        throw 'writer dispose failed'
      }.GetNewClosure())
      $adapter = [pscustomobject]@{
        kind = 'fake-fixture-io'
        open = {
          param($path)
          $state.openAttempted = $true
          if ([string]$request.mode -eq 'creation') { throw 'fixture open failed' }
          if ([string]$request.mode -eq 'writer-construction') {
            $state.createdPath = [string]$path
            $fakeStream.InnerStream = [System.IO.FileStream]::new(
              [string]$path,
              [System.IO.FileMode]::CreateNew,
              [System.IO.FileAccess]::Write,
              [System.IO.FileShare]::None
            )
            return $fakeStream
          }
          if ([string]$request.mode -eq 'action-cleanup') {
            $state.createdPath = [string]$path
            return [System.IO.FileStream]::new(
              [string]$path,
              [System.IO.FileMode]::CreateNew,
              [System.IO.FileAccess]::Write,
              [System.IO.FileShare]::None,
              64000,
              [System.IO.FileOptions]::SequentialScan
            )
          }
          return $fakeStream
        }.GetNewClosure()
        createWriter = {
          param($stream)
          if ([string]$request.mode -eq 'writer-construction') { throw 'fixture writer construction failed' }
          if ([string]$request.mode -eq 'action-cleanup') {
            return [System.IO.BinaryWriter]::new($stream, [System.Text.Encoding]::ASCII, $true)
          }
          return $fakeWriter
        }.GetNewClosure()
        remove = {
          param($path)
          $state.removeAttempted = $true
          if ([string]$request.mode -eq 'action-cleanup') { throw 'fixture cleanup failed' }
          if ([string]$request.mode -eq 'writer-construction' -and (Test-Path -LiteralPath ([string]$path))) {
            Remove-Item -LiteralPath ([string]$path) -Force -ErrorAction Stop
          }
        }.GetNewClosure()
      }
      $lifecycleError = ''
      try {
        Invoke-WithReleaseEvidenceCancellationFixture -TempRoot ([string]$request.tempRoot) -IoAdapter $adapter -Action {
          param($fixture)
          if ([string]$request.mode -eq 'action-cleanup') { throw 'fixture action failed' }
          return $fixture
        } | Out-Null
      } catch {
        $lifecycleError = $_.Exception.Message
      }
      if (-not [string]::IsNullOrWhiteSpace([string]$state.createdPath) -and (Test-Path -LiteralPath ([string]$state.createdPath))) {
        Remove-Item -LiteralPath ([string]$state.createdPath) -Force -ErrorAction Stop
      }
      $remainingFiles = @(Get-ChildItem -LiteralPath ([string]$request.tempRoot) -Recurse -File -ErrorAction SilentlyContinue)
      [pscustomobject]@{
        lifecycleError = $lifecycleError
        state = $state
        remainingFileCount = $remainingFiles.Count
      }
      break
    }
    'cancellation-timing' {
      $timingArguments = @{
        BackendSelectedEvent = $request.backendSelectedEvent
        StatusBeforeRequest = [string]$request.statusBeforeRequest
        CancelRequestCompletedAtEpochMilliseconds = [double]$request.cancelRequestCompletedAtEpochMilliseconds
        MaximumDelayMilliseconds = [int]$request.maximumDelayMilliseconds
      }
      Assert-ReleaseEvidenceCancellationTiming @timingArguments
      break
    }
    'runtime-adapter-readiness' {
      Assert-ReleaseEvidenceRuntimeAdapterReadiness
      break
    }
    'process-event-job-state' {
      if ([string]$request.state -eq 'missing') {
        Assert-ReleaseEvidenceProcessEventJobState
      } else {
        Assert-ReleaseEvidenceProcessEventJobState -Jobs @([pscustomobject]@{ State = [string]$request.state })
      }
      break
    }
    'process-subscription-cleanup' {
      $state = [pscustomobject]@{
        unregisterAttempted = $false
        removeEventsAttempted = $false
        removeJobAttempted = $false
        drainQueueAttempted = $false
        verifyAttempted = $false
        subscriberPresent = $false
        eventsPresent = $true
        jobPresent = $true
        queuePresent = $true
      }
      $cleanupAdapter = [pscustomobject]@{
        unregister = {
          param($token)
          $state.unregisterAttempted = $true
          throw 'subscriber already missing'
        }.GetNewClosure()
        removeEvents = {
          param($token)
          $state.removeEventsAttempted = $true
          $state.eventsPresent = $false
        }.GetNewClosure()
        removeJob = {
          param($token)
          $state.removeJobAttempted = $true
          $state.jobPresent = $false
        }.GetNewClosure()
        drainQueue = {
          param($token)
          $state.drainQueueAttempted = $true
          $state.queuePresent = $false
        }.GetNewClosure()
        verify = {
          param($token)
          $state.verifyAttempted = $true
          if ($state.subscriberPresent -or $state.eventsPresent -or $state.jobPresent -or $state.queuePresent) {
            throw 'process observation cleanup verification failed'
          }
        }.GetNewClosure()
      }
      $cleanupError = ''
      try {
        Invoke-ReleaseEvidenceProcessSubscriptionCleanup -Token ([pscustomobject]@{ sourceIdentifier = 'fake'; jobId = 1 }) -CleanupAdapter $cleanupAdapter
      } catch {
        $cleanupError = $_.Exception.Message
      }
      [pscustomobject]@{ cleanupError = $cleanupError; state = $state }
      break
    }
    'worker-observation' {
      $launcherStartedAt = [DateTimeOffset]::Parse('2026-08-11T00:00:00.000Z')
      $sessionStartedAt = [DateTimeOffset]::Parse('2026-08-11T00:00:10.000Z')
      $rainStartedAt = [DateTimeOffset]::Parse('2026-08-11T00:00:11.000Z')
      $state = [pscustomobject]@{
        started = $false
        stopped = $false
        readCount = 0
        healthChecks = 0
        observerHealth = 'active'
        snapshot = @(
          [pscustomobject]@{ processId = 40; parentProcessId = 4; executablePath = 'C:\\Tools\\tauri-driver.exe'; startedAt = $launcherStartedAt },
          [pscustomobject]@{ processId = 100; parentProcessId = 40; executablePath = 'C:\\Program Files\\Rain\\Rain.exe'; startedAt = $rainStartedAt },
          [pscustomobject]@{ processId = 200; parentProcessId = 41; executablePath = 'C:\\Program Files\\Rain\\Rain.exe'; startedAt = $rainStartedAt }
        )
        currentRoot = [pscustomobject]@{ processId = 100; parentProcessId = 40; executablePath = 'C:\\Program Files\\Rain\\Rain.exe'; startedAt = $rainStartedAt }
        events = @(
          [pscustomobject]@{ processId = 150; parentProcessId = 100; processName = 'rain-worker-host.exe'; startedAt = [DateTimeOffset]::Parse('2026-08-11T00:00:12.000Z') },
          [pscustomobject]@{ processId = 151; parentProcessId = 150; processName = 'rain-whisper-cuda.exe'; startedAt = [DateTimeOffset]::Parse('2026-08-11T00:00:12.100Z'); wasRunningAtRead = $false },
          [pscustomobject]@{ processId = 201; parentProcessId = 200; processName = 'rain-whisper-cuda.exe'; startedAt = [DateTimeOffset]::Parse('2026-08-11T00:00:12.200Z'); wasRunningAtRead = $false }
        )
      }
      if ($request.PSObject.Properties.Name -contains 'mode' -and [string]$request.mode -eq 'root-pid-reused') {
        $state.currentRoot = [pscustomobject]@{
          processId = 100
          parentProcessId = 40
          executablePath = 'C:\\Program Files\\Rain\\Rain.exe'
          startedAt = [DateTimeOffset]::Parse('2026-08-11T00:00:11.500Z')
        }
      }
      $adapter = [pscustomobject]@{
        kind = 'fake-process-start-events'
        now = { [DateTimeOffset]::Parse('2026-08-11T00:00:11.500Z') }
        getSnapshot = { @($state.snapshot) }.GetNewClosure()
        start = { param($identity) $state.started = $true; return [pscustomobject]@{ token = 'fake-subscription'; identity = $identity } }.GetNewClosure()
        read = {
          param($token)
          $state.readCount++
          if ($state.readCount -eq 1) { return @() }
          return @($state.events)
        }.GetNewClosure()
        validateRoot = { param($token, $identity) return $state.currentRoot }.GetNewClosure()
        assertHealthy = {
          param($token)
          $state.healthChecks++
          if ($state.observerHealth -ne 'active') {
            throw "Process observation subscription is not healthy: $($state.observerHealth)."
          }
        }.GetNewClosure()
        stop = { param($token) $state.stopped = $true }.GetNewClosure()
      }
      $observer = $null
      $observation = $null
      $observationError = ''
      try {
        $observerArguments = @{
          ExpectedRainExecutablePath = 'C:\\Program Files\\Rain\\Rain.exe'
          WebDriverSessionStartedAt = $sessionStartedAt
          TrustedLauncherProcessId = 40
          TrustedLauncherStartedAt = $launcherStartedAt
          EventAdapter = $adapter
        }
        $observer = Start-ReleaseEvidenceSessionWorkerObserver @observerArguments
        $window = Start-ReleaseEvidenceWorkerObservationWindow -Observer $observer
        if ($request.PSObject.Properties.Name -contains 'mode' -and [string]$request.mode -like 'subscription-*') {
          $state.observerHealth = ([string]$request.mode).Substring('subscription-'.Length)
        }
        try {
          $observation = Complete-ReleaseEvidenceWorkerObservationWindow -Window $window
        } catch {
          $observationError = $_.Exception.Message
        }
      } finally {
        if ($observer) { Stop-ReleaseEvidenceSessionWorkerObserver -Observer $observer }
      }
      [pscustomobject]@{
        observation = $observation
        observerRoot = $observer.rootIdentity
        adapterStarted = $state.started
        adapterStopped = $state.stopped
        readCount = $state.readCount
        healthChecks = $state.healthChecks
        observationError = $observationError
      }
      break
    }
    default { throw "Unknown test operation: $($request.operation)" }
  }
  [pscustomobject]@{ ok = $true; value = $value } | ConvertTo-Json -Depth 40 -Compress
} catch {
  [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Depth 40 -Compress
  exit 1
}
`
  const invocationRoot = newTemporaryRoot()
  const scriptPath = join(invocationRoot, 'invoke-contract.ps1')
  writeFileSync(scriptPath, `\uFEFF${script}`, 'utf8')
  const result = await runPowerShell([
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
  ])
  const line = result.stdout?.trim().split(/\r?\n/).filter(Boolean).at(-1)
  return {
    status: result.status,
    output: line ? JSON.parse(line) as { ok: boolean; value?: any; error?: string } : {
      ok: false,
      error: `${result.stdout}\n${result.stderr}`,
    },
  }
}

function assertContractSucceeded(result: Awaited<ReturnType<typeof invokeContract>>) {
  if (!result.output.ok) {
    throw new Error(`Contract invocation failed: ${result.output.error}`)
  }
}

function createPayloadFixture(root: string, options: {
  missing?: string
  duplicate?: boolean
  traversal?: boolean
  extra?: string
} = {}) {
  mkdirSync(root, { recursive: true })
  const payloadNames = [
    'rain-whisper-cuda.exe',
    'cublas64_12.dll',
    'cublasLt64_12.dll',
    'cudart64_12.dll',
  ]
  const entries = payloadNames.map((name) => {
    const path = join(root, name)
    if (options.missing !== name) writeFileSync(path, `fixture:${name}`)
    return {
      name,
      sizeBytes: options.missing === name ? `fixture:${name}`.length : readFileSync(path).byteLength,
      sha256: options.missing === name ? createHash('sha256').update(`fixture:${name}`).digest('hex') : sha256(path),
    }
  })
  if (options.duplicate) entries.push({ ...entries[0] })
  if (options.traversal) entries.push({ name: '../escape.dll', sizeBytes: 1, sha256: '0'.repeat(64) })
  if (options.extra) writeFileSync(join(root, options.extra), `fixture:${options.extra}`)
  const manifestPath = join(root, 'payload-manifest.json')
  writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    workerProtocolVersion: 1,
    driverLibraryBundled: false,
    files: entries,
  }))
  return manifestPath
}

function createArtifactFixture(root: string, targetCommit = 'a'.repeat(40)) {
  const installerPath = join(root, 'Rain_0.1.0_x64-setup.exe')
  writeFileSync(installerPath, 'candidate installer bytes')
  const installerHash = sha256(installerPath)
  const artifactManifestPath = join(root, 'artifact-manifest.json')
  writeFileSync(artifactManifestPath, JSON.stringify({
    schemaVersion: 1,
    productName: 'Rain',
    version: '0.1.0',
    identifier: 'com.rain.app',
    targetCommit,
    controlledBuild: {
      sourceRepository: 'https://example.invalid/rain.git',
      targetCommit,
      cleanTree: true,
      generator: { id: 'rain-controlled-build', version: '1.0.0' },
      buildMetadata: { buildRecordId: 'controlled-record-20260811', builtAt: '2026-08-11T00:00:00.000Z' },
    },
    installer: {
      fileName: 'Rain_0.1.0_x64-setup.exe',
      sha256: installerHash,
      sizeBytes: readFileSync(installerPath).byteLength,
      kind: 'nsis-windows-x64',
    },
    mainExecutable: {
      path: 'Rain.exe',
      sha256: '1'.repeat(64),
      cudaImportsPresent: false,
    },
    resources: {
      cudaWorker: {
        path: 'resources\\whisper-backends\\rain-whisper-cuda.exe',
        sha256: '2'.repeat(64),
        protocolVersion: 1,
      },
      cudaRuntime: {
        files: [
          { name: 'cublas64_12.dll', path: 'resources\\whisper-backends\\cublas64_12.dll', sizeBytes: 1, sha256: '3'.repeat(64) },
          { name: 'cublasLt64_12.dll', path: 'resources\\whisper-backends\\cublasLt64_12.dll', sizeBytes: 1, sha256: '4'.repeat(64) },
          { name: 'cudart64_12.dll', path: 'resources\\whisper-backends\\cudart64_12.dll', sizeBytes: 1, sha256: '5'.repeat(64) },
        ],
        driverLibraryBundled: false,
        distributionApproval: 'pending',
      },
    },
    forbiddenFindings: [],
    generatedAt: '2026-08-11T00:00:00.000Z',
    generator: { id: 'rain-release-artifact-generator', version: '1.0.0' },
  }))
  return {
    installerPath,
    installerHash,
    artifactManifestPath,
    artifactManifestHash: sha256(artifactManifestPath),
    targetCommit,
  }
}

function invokeRunner(arguments_: string[]) {
  return runPowerShell([
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    runnerPath,
    ...arguments_,
  ])
}

function allFileNames(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    return entry.isDirectory() ? allFileNames(path) : [path]
  })
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('M3-S3 NVIDIA Release Evidence runner contracts', () => {
  it('selects an explicit PowerShell test executable override before preferring pwsh', () => {
    expect(resolvePowerShellExecutable(
      { RAIN_TEST_POWERSHELL_EXE: 'fixture-powershell.exe' },
      () => true,
    )).toBe('fixture-powershell.exe')
    expect(resolvePowerShellExecutable(
      {},
      (candidate) => candidate === 'pwsh.exe' || candidate === 'powershell.exe',
    )).toBe('pwsh.exe')
    expect(resolvePowerShellExecutable(
      {},
      (candidate) => candidate === 'powershell.exe',
    )).toBe('powershell.exe')
  })

  it('keeps the Vitest worker event loop responsive while a PowerShell contract runs', async () => {
    let eventLoopTurnObserved = false
    const eventLoopTurn = new Promise<void>((resolve) => {
      setTimeout(() => {
        eventLoopTurnObserved = true
        resolve()
      }, 0)
    })

    const invocation = invokeContract({
      operation: 'payload-manifest-relative-identity',
      relativePath: 'payload-manifest.json',
      manifestLeafName: 'payload-manifest.json',
    })

    const firstCompleted = await Promise.race([
      eventLoopTurn.then(() => 'event-loop-turn'),
      Promise.resolve(invocation).then(() => 'contract-invocation'),
    ])
    expect(firstCompleted).toBe('event-loop-turn')
    expect(eventLoopTurnObserved).toBe(true)
    assertContractSucceeded(await invocation)
  })

  it('requires independent installer and controlled-build artifact-manifest trust inputs', () => {
    const script = `(Get-Command -Name '${psLiteral(runnerPath)}').Parameters.Keys | ConvertTo-Json -Compress`
    const result = spawnSync(powerShellExecutable, [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ], {
      encoding: 'utf8',
      windowsHide: true,
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toContain('ArtifactManifestPath')
    expect(JSON.parse(result.stdout)).toContain('ExpectedArtifactManifestSha256')
  })

  it('accepts only a controlled-build record whose manifest hash, metadata, target and installer bytes all match', async () => {
    const root = newTemporaryRoot()
    const candidate = createArtifactFixture(root)

    const accepted = await invokeContract({
      operation: 'provenance',
      installerPath: candidate.installerPath,
      expectedTargetCommit: candidate.targetCommit,
      expectedInstallerSha256: candidate.installerHash,
      artifactManifestPath: candidate.artifactManifestPath,
      expectedArtifactManifestSha256: candidate.artifactManifestHash,
    })
    expect(accepted.status).toBe(0)
    expect(accepted.output).toMatchObject({
      ok: true,
      value: {
        targetCommit: candidate.targetCommit,
        installer: { sha256: candidate.installerHash, fileName: 'Rain_0.1.0_x64-setup.exe' },
      },
    })

    const mismatched = JSON.parse(readFileSync(candidate.artifactManifestPath, 'utf8'))
    mismatched.targetCommit = 'b'.repeat(40)
    writeFileSync(candidate.artifactManifestPath, JSON.stringify(mismatched))
    const rejected = await invokeContract({
      operation: 'provenance',
      installerPath: candidate.installerPath,
      expectedTargetCommit: candidate.targetCommit,
      expectedInstallerSha256: candidate.installerHash,
      artifactManifestPath: candidate.artifactManifestPath,
      expectedArtifactManifestSha256: sha256(candidate.artifactManifestPath),
    })
    expect(rejected.status).toBe(1)
    expect(rejected.output.error).toContain('Artifact manifest target commit does not match the expected target commit')

    const controlledBuildMissing = JSON.parse(readFileSync(candidate.artifactManifestPath, 'utf8'))
    controlledBuildMissing.targetCommit = candidate.targetCommit
    delete controlledBuildMissing.controlledBuild.cleanTree
    writeFileSync(candidate.artifactManifestPath, JSON.stringify(controlledBuildMissing))
    const missingMetadata = await invokeContract({
      operation: 'provenance',
      installerPath: candidate.installerPath,
      expectedTargetCommit: candidate.targetCommit,
      expectedInstallerSha256: candidate.installerHash,
      artifactManifestPath: candidate.artifactManifestPath,
      expectedArtifactManifestSha256: sha256(candidate.artifactManifestPath),
    })
    expect(missingMetadata.status).toBe(1)
    expect(missingMetadata.output.error).toContain("Controlled-build record is missing required property 'cleanTree'")

    const wrongHash = await invokeContract({
      operation: 'provenance',
      installerPath: candidate.installerPath,
      expectedTargetCommit: candidate.targetCommit,
      expectedInstallerSha256: candidate.installerHash,
      artifactManifestPath: candidate.artifactManifestPath,
      expectedArtifactManifestSha256: '0'.repeat(64),
    })
    expect(wrongHash.status).toBe(1)
    expect(wrongHash.output.error).toContain('Artifact manifest SHA-256 does not match the expected controlled-build record')
  })

  it('validates provenance without PowerShell module autoload or Get-FileHash', async () => {
    const root = newTemporaryRoot()
    const candidate = createArtifactFixture(root)
    const result = await invokeContract({
      operation: 'provenance',
      shadowGetFileHash: true,
      installerPath: candidate.installerPath,
      expectedTargetCommit: candidate.targetCommit,
      expectedInstallerSha256: candidate.installerHash,
      artifactManifestPath: candidate.artifactManifestPath,
      expectedArtifactManifestSha256: candidate.artifactManifestHash,
    })
    assertContractSucceeded(result)
    expect(result.output.value.installer.sha256).toBe(candidate.installerHash)
  })

  it('requires every active release-artifact manifest minimum field before accepting provenance', async () => {
    const cases: Array<{ name: string; mutate: (manifest: any) => void; error: string }> = [
      {
        name: 'missing main executable',
        mutate: (manifest) => { delete manifest.mainExecutable },
        error: "Artifact manifest is missing required property 'mainExecutable'",
      },
      {
        name: 'wrong release version',
        mutate: (manifest) => { manifest.version = '0.1.1' },
        error: 'Artifact manifest version must be 0.1.0',
      },
      {
        name: 'missing CUDA worker protocol',
        mutate: (manifest) => { delete manifest.resources.cudaWorker.protocolVersion },
        error: "Artifact manifest CUDA worker is missing required property 'protocolVersion'",
      },
      {
        name: 'main executable claims CUDA imports',
        mutate: (manifest) => { manifest.mainExecutable.cudaImportsPresent = true },
        error: 'Artifact manifest mainExecutable.cudaImportsPresent must be false',
      },
      {
        name: 'missing forbidden findings',
        mutate: (manifest) => { delete manifest.forbiddenFindings },
        error: "Artifact manifest is missing required property 'forbiddenFindings'",
      },
      {
        name: 'missing generator metadata',
        mutate: (manifest) => { delete manifest.generator },
        error: "Artifact manifest is missing required property 'generator'",
      },
    ]

    for (const testCase of cases) {
      const candidate = createArtifactFixture(newTemporaryRoot())
      const manifest = JSON.parse(readFileSync(candidate.artifactManifestPath, 'utf8'))
      testCase.mutate(manifest)
      writeFileSync(candidate.artifactManifestPath, JSON.stringify(manifest))
      const result = await invokeContract({
        operation: 'provenance',
        installerPath: candidate.installerPath,
        expectedTargetCommit: candidate.targetCommit,
        expectedInstallerSha256: candidate.installerHash,
        artifactManifestPath: candidate.artifactManifestPath,
        expectedArtifactManifestSha256: sha256(candidate.artifactManifestPath),
      })
      expect(result.status, testCase.name).toBe(1)
      expect(result.output.error, testCase.name).toContain(testCase.error)
    }
  }, 15_000)

  it('constructs a raw final NSIS install-directory argument for paths with spaces', async () => {
    const destination = 'C:\\Program Files\\Rain Evidence Install'
    const result = await invokeContract({ operation: 'nsis-install-arguments', destination })

    assertContractSucceeded(result)
    expect(result.output.value).toEqual(['/S', `/D=${destination}`])
    expect(result.output.value.at(-1)).toBe(`/D=${destination}`)
    expect(result.output.value.at(-1)).not.toContain('"')

    const processInvocation = await invokeContract({ operation: 'nsis-start-process-arguments', destination })
    assertContractSucceeded(processInvocation)
    expect(processInvocation.output.value).toMatchObject({
      argumentList: ['/S', `/D=${destination}`],
      wait: true,
      passThru: true,
      windowStyle: 'Hidden',
    })
    expect(processInvocation.output.value.argumentList.at(-1)).not.toContain('"')
  })

  it('requires an exact, path-safe bidirectional installed CUDA payload set', async () => {
    const validRoot = newTemporaryRoot()
    const validManifest = createPayloadFixture(validRoot)
    const accepted = await invokeContract({ operation: 'payload', installedRoot: validRoot, payloadManifestPath: validManifest })
    assertContractSucceeded(accepted)
    expect(accepted.status).toBe(0)
    expect(accepted.output.value.files.map((file: { name: string }) => file.name).sort()).toEqual([
      'cublas64_12.dll',
      'cublasLt64_12.dll',
      'cudart64_12.dll',
      'rain-whisper-cuda.exe',
    ])

    const cases = [
      { name: 'missing required file', options: { missing: 'cudart64_12.dll' }, error: 'Installed CUDA payload file is missing' },
      { name: 'unmanifested extra DLL', options: { extra: 'rogue.dll' }, error: 'Installed CUDA payload contains files absent from its manifest' },
      { name: 'duplicate manifest entry', options: { duplicate: true }, error: 'CUDA payload manifest contains duplicate file name' },
      { name: 'path traversal entry', options: { traversal: true }, error: 'CUDA payload manifest file name is not a simple file name' },
      { name: 'bundled driver DLL', options: { extra: 'nvcuda.dll' }, error: 'Installed tree must not contain nvcuda.dll' },
    ] as const
    for (const testCase of cases) {
      const root = newTemporaryRoot()
      const manifestPath = createPayloadFixture(root, testCase.options)
      const rejected = await invokeContract({ operation: 'payload', installedRoot: root, payloadManifestPath: manifestPath })
      expect(rejected.status, testCase.name).toBe(1)
      expect(rejected.output.error, testCase.name).toContain(testCase.error)
    }

    const outsideRoot = newTemporaryRoot()
    const payloadRoot = join(outsideRoot, 'resources', 'whisper-backends')
    const outsideManifest = createPayloadFixture(payloadRoot)
    mkdirSync(join(outsideRoot, 'unexpected'), { recursive: true })
    writeFileSync(join(outsideRoot, 'unexpected', 'cufft64_12.dll'), 'unapproved CUDA DLL')
    const outsidePayload = await invokeContract({ operation: 'payload', installedRoot: outsideRoot, payloadManifestPath: outsideManifest })
    expect(outsidePayload.status).toBe(1)
    expect(outsidePayload.output.error).toContain('Installed tree contains unapproved CUDA/driver DLL outside the payload root')

    const outsideDriverRoot = newTemporaryRoot()
    const outsideDriverPayloadRoot = join(outsideDriverRoot, 'resources', 'whisper-backends')
    const outsideDriverManifest = createPayloadFixture(outsideDriverPayloadRoot)
    mkdirSync(join(outsideDriverRoot, 'unexpected'), { recursive: true })
    writeFileSync(join(outsideDriverRoot, 'unexpected', 'cudnn64_9.dll'), 'unapproved CUDA runtime DLL')
    const outsideDriverPayload = await invokeContract({ operation: 'payload', installedRoot: outsideDriverRoot, payloadManifestPath: outsideDriverManifest })
    expect(outsideDriverPayload.status).toBe(1)
    expect(outsideDriverPayload.output.error).toContain('Installed tree contains unapproved CUDA/driver DLL outside the payload root')

    for (const unapprovedDll of ['cupti64_2025.1.dll', 'cufile.dll', 'nvblas64_12.dll']) {
      const root = newTemporaryRoot()
      const payloadRoot = join(root, 'resources', 'whisper-backends')
      const manifestPath = createPayloadFixture(payloadRoot)
      mkdirSync(join(root, 'unexpected'), { recursive: true })
      writeFileSync(join(root, 'unexpected', unapprovedDll), 'unapproved CUDA or NVIDIA DLL')
      const rejected = await invokeContract({ operation: 'payload', installedRoot: root, payloadManifestPath: manifestPath })
      expect(rejected.status, unapprovedDll).toBe(1)
      expect(rejected.output.error, unapprovedDll).toContain('Installed tree contains unapproved CUDA/driver DLL outside the payload root')
    }
  }, 15_000)

  it('identifies the payload manifest by root-relative leaf instead of its short or long parent path', async () => {
    const manifest = await invokeContract({
      operation: 'payload-manifest-relative-identity',
      relativePath: 'payload-manifest.json',
      manifestLeafName: 'PAYLOAD-MANIFEST.JSON',
    })
    assertContractSucceeded(manifest)
    expect(manifest.output.value).toBe(true)

    const nested = await invokeContract({
      operation: 'payload-manifest-relative-identity',
      relativePath: 'nested\\payload-manifest.json',
      manifestLeafName: 'payload-manifest.json',
    })
    assertContractSucceeded(nested)
    expect(nested.output.value).toBe(false)
  })

  it('atomically persists partial phases and redacts secret and PII diagnostics in a uniform failure manifest', async () => {
    const root = newTemporaryRoot()
    const result = await invokeContract({
      operation: 'writer',
      runRoot: root,
      evidenceId: 'fixture-evidence',
      expectedTargetCommit: 'c'.repeat(40),
      expectedInstallerSha256: 'd'.repeat(64),
      expectedArtifactManifestSha256: 'e'.repeat(64),
      failedPhase: 'payload-validation',
      errorText: 'Bearer secret-token sk-secret AKIA1234567890ABCDEF apiKey=super-secret person@example.com C:\\Users\\alice\\private.txt {"apiKey":"quoted-secret","password":"json-password"} C:/Users/alice/other.txt C:\\Documents and Settings\\bob\\private.txt \\\\?\\C:\\Users\\carol\\private.txt',
    })
    assertContractSucceeded(result)
    expect(result.status).toBe(0)
    expect(result.output.ok).toBe(true)

    const partialManifest = JSON.parse(readFileSync(result.output.value.partialManifestPath, 'utf8'))
    const failureManifest = JSON.parse(readFileSync(result.output.value.manifestPath, 'utf8'))
    expect(partialManifest.phases).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'input-validation', result: 'passed' }),
      expect.objectContaining({ phase: 'payload-validation', result: 'failed' }),
    ]))
    expect(failureManifest).toMatchObject({
      result: 'failed',
      phase: 'payload-validation',
      partialManifest: 'partial-manifest.json',
    })
    const persistedText = allFileNames(root).map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(persistedText).not.toContain('secret-token')
    expect(persistedText).not.toContain('sk-secret')
    expect(persistedText).not.toContain('AKIA1234567890ABCDEF')
    expect(persistedText).not.toContain('super-secret')
    expect(persistedText).not.toContain('person@example.com')
    expect(persistedText).not.toContain('C:\\Users\\alice')
    expect(persistedText).not.toContain('quoted-secret')
    expect(persistedText).not.toContain('json-password')
    expect(persistedText).not.toContain('C:/Users/alice')
    expect(persistedText).not.toContain('Documents and Settings\\bob')
    expect(persistedText).not.toContain('C:\\Users\\carol')
    expect(allFileNames(root).some((path) => path.endsWith('.tmp'))).toBe(false)
    expect(existsSync(result.output.value.manifestPath)).toBe(true)
  })

  it('reports a single redaction finding without treating it as a scalar without Count', async () => {
    const root = newTemporaryRoot()
    writeFileSync(join(root, 'single.txt'), 'contact person@example.com')
    const result = await invokeContract({ operation: 'tree-redaction-scan', runRoot: root })
    expect(result.status).toBe(1)
    expect(result.output.error).toContain('single.txt: email address')
    expect(result.output.error).not.toContain("property 'Count'")
  })

  // This integration test intentionally starts five isolated PowerShell processes. The clean
  // Windows Harness measured 8.2 s under shared-runner load, so keep the larger budget local.
  it('refuses a success manifest unless every required phase is unique, passed and in order', async () => {
    const requiredPhases = ['input-validation', 'payload-validation']
    const common = {
      operation: 'writer-success',
      evidenceId: 'success-fixture',
      expectedTargetCommit: 'f'.repeat(40),
      expectedInstallerSha256: 'a'.repeat(64),
      expectedArtifactManifestSha256: 'b'.repeat(64),
      requiredPhases,
    }

    const incomplete = await invokeContract({ ...common, runRoot: newTemporaryRoot(), phases: ['input-validation'] })
    expect(incomplete.status).toBe(1)
    expect(incomplete.output.error).toContain('Evidence success is missing required phases: payload-validation')

    const outOfOrder = await invokeContract({ ...common, runRoot: newTemporaryRoot(), phases: ['payload-validation', 'input-validation'] })
    expect(outOfOrder.status).toBe(1)
    expect(outOfOrder.output.error).toContain('Evidence success phases are out of order')

    const duplicate = await invokeContract({ ...common, runRoot: newTemporaryRoot(), phases: ['input-validation', 'input-validation'] })
    expect(duplicate.status).toBe(1)
    expect(duplicate.output.error).toContain('Evidence phase was already recorded: input-validation')

    const duplicatePreservesArtifact = await invokeContract({
      operation: 'writer-duplicate-phase',
      runRoot: newTemporaryRoot(),
      evidenceId: 'duplicate-fixture',
      expectedTargetCommit: 'f'.repeat(40),
      expectedInstallerSha256: 'a'.repeat(64),
      expectedArtifactManifestSha256: 'b'.repeat(64),
    })
    assertContractSucceeded(duplicatePreservesArtifact)
    expect(duplicatePreservesArtifact.output.value.duplicateError).toContain('Evidence phase was already recorded: input-validation')
    expect(duplicatePreservesArtifact.output.value.phaseRecord.data).toMatchObject({ marker: 'first' })

    const complete = await invokeContract({ ...common, runRoot: newTemporaryRoot(), phases: requiredPhases })
    assertContractSucceeded(complete)
    expect(JSON.parse(readFileSync(complete.output.value.manifestPath, 'utf8'))).toMatchObject({ result: 'passed' })
  }, 15_000)

  it('rejects PE inspection failures and safely quotes a driver path that contains spaces', async () => {
    const failedTool = await invokeContract({ operation: 'pe-import-inspection', toolName: 'llvm-objdump.exe', exitCode: 1, output: 'tool error' })
    expect(failedTool.status).toBe(1)
    expect(failedTool.output.error).toContain('PE import inspection tool llvm-objdump.exe failed with exit code 1')

    const emptyOutput = await invokeContract({ operation: 'pe-import-inspection', toolName: 'dumpbin.exe', exitCode: 0, output: '' })
    expect(emptyOutput.status).toBe(1)
    expect(emptyOutput.output.error).toContain('PE import inspection tool dumpbin.exe produced no recognizable import output')

    const validOutput = await invokeContract({ operation: 'pe-import-inspection', toolName: 'dumpbin.exe', exitCode: 0, output: 'Dump of file rain.exe\n  Section contains the following imports:\n    KERNEL32.dll' })
    assertContractSucceeded(validOutput)

    const safeMainImports = await invokeContract({ operation: 'main-executable-imports', output: 'Section contains imports:\n KERNEL32.dll\n USER32.dll\n custom-ui.dll\n nvwidgets.dll' })
    assertContractSucceeded(safeMainImports)
    for (const forbiddenImport of ['cufft64_12.dll', 'cudnn64_9.dll', 'nvrtc64_120_0.dll', 'cusolver64_11.dll', 'cusparse64_12.dll', 'curand64_10.dll', 'cupti64_2025.1.dll', 'cufile.dll', 'nvblas64_12.dll', 'nvcuda.dll']) {
      const forbidden = await invokeContract({ operation: 'main-executable-imports', output: `Section contains imports:\n ${forbiddenImport}` })
      expect(forbidden.status, forbiddenImport).toBe(1)
      expect(forbidden.output.error, forbiddenImport).toContain(`Rain main executable imports CUDA/driver libraries: ${forbiddenImport}`)
    }

    const quoted = await invokeContract({ operation: 'quote-process-arguments', arguments: ['--native-driver', 'C:\\Program Files\\Rain Tools\\msedgedriver.exe'] })
    assertContractSucceeded(quoted)
    expect(quoted.output.value).toBe('--native-driver "C:\\Program Files\\Rain Tools\\msedgedriver.exe"')
  }, 15_000)

  it('rejects a non-empty custom install directory and owns only an empty custom directory', async () => {
    const nonEmpty = newTemporaryRoot()
    writeFileSync(join(nonEmpty, 'stale-installer-file.txt'), 'stale')
    const rejected = await invokeContract({ operation: 'install-directory', installDir: nonEmpty })
    expect(rejected.status).toBe(1)
    expect(rejected.output.error).toContain('Custom InstallDir must not contain existing files')

    const empty = newTemporaryRoot()
    const accepted = await invokeContract({ operation: 'install-directory', installDir: empty })
    assertContractSucceeded(accepted)
    expect(accepted.output.value).toMatchObject({ mode: 'custom-empty', path: realpathSync.native(empty) })
  })

  it('streams one deterministic cancellation WAV into TEMP and removes it after success or failure', async () => {
    const successRoot = newTemporaryRoot()
    const success = await invokeContract({ operation: 'cancellation-fixture', tempRoot: successRoot, actionMode: 'succeed' })
    assertContractSucceeded(success)
    expect(success.output.value).toMatchObject({ actionError: '', remainingFileCount: 0, remainingBytes: 0 })
    expect(success.output.value.actionResult.fixture).toMatchObject({
      format: 'pcm-s16le-wav',
      sampleRateHz: 16_000,
      channels: 1,
      bitsPerSample: 16,
      durationSeconds: 180,
      cancelAfterBackendSelectionWithinMilliseconds: 2_000,
      dataBytes: 5_760_000,
      sizeBytes: 5_760_044,
      sha256: '5545b8236a5eb7a03694955687d8adca43490b2f31efdb7f635a2c7409857045',
    })
    expect(success.output.value.actionResult.fixture.sizeBytes).toBeLessThanOrEqual(6 * 1024 * 1024)
    const header = Buffer.from(success.output.value.actionResult.headerBase64, 'base64')
    expect(header.subarray(0, 4).toString('ascii')).toBe('RIFF')
    expect(header.subarray(8, 12).toString('ascii')).toBe('WAVE')
    expect(header.subarray(12, 16).toString('ascii')).toBe('fmt ')
    expect(header.readUInt16LE(20)).toBe(1)
    expect(header.readUInt16LE(22)).toBe(1)
    expect(header.readUInt32LE(24)).toBe(16_000)
    expect(header.readUInt16LE(34)).toBe(16)
    expect(header.subarray(36, 40).toString('ascii')).toBe('data')
    expect(header.readUInt32LE(40)).toBe(5_760_000)

    const failureRoot = newTemporaryRoot()
    const failure = await invokeContract({ operation: 'cancellation-fixture', tempRoot: failureRoot, actionMode: 'fail' })
    assertContractSucceeded(failure)
    expect(failure.output.value).toMatchObject({
      actionError: 'intentional fixture action failure',
      remainingFileCount: 0,
      remainingBytes: 0,
    })
  }, 15_000)

  it('rejects a short cancellation WAV even when a caller tries to lower the fixed duration floor', async () => {
    const root = newTemporaryRoot()
    const shortPath = join(root, 'short-cancellation.wav')
    writePcmWavFixture(shortPath, 1)
    const rejected = await invokeContract({
      operation: 'cancellation-fixture-assert',
      path: shortPath,
      minimumDurationSeconds: 0,
    })
    expect(rejected.status).toBe(1)
    expect(rejected.output.error).toContain('Cancellation fixture duration must be at least 120 seconds')
  })

  it('surfaces cancellation fixture creation failure without leaving a TEMP file', async () => {
    const root = newTemporaryRoot()
    const result = await invokeContract({
      operation: 'cancellation-fixture-io-failure',
      mode: 'creation',
      tempRoot: root,
    })
    assertContractSucceeded(result)
    expect(result.output.value).toMatchObject({
      lifecycleError: expect.stringContaining('fixture open failed'),
      state: { openAttempted: true },
      remainingFileCount: 0,
    })
  })

  it('always disposes the fixture stream when writer disposal fails', async () => {
    const root = newTemporaryRoot()
    const result = await invokeContract({
      operation: 'cancellation-fixture-io-failure',
      mode: 'writer-disposal',
      tempRoot: root,
    })
    assertContractSucceeded(result)
    expect(result.output.value).toMatchObject({
      lifecycleError: expect.stringContaining('writer dispose failed'),
      state: {
        openAttempted: true,
        writerDisposed: true,
        streamDisposed: true,
        removeAttempted: true,
      },
      remainingFileCount: 0,
    })
  })

  it('disposes the opened stream and removes the file when writer construction fails', async () => {
    const root = newTemporaryRoot()
    const result = await invokeContract({
      operation: 'cancellation-fixture-io-failure',
      mode: 'writer-construction',
      tempRoot: root,
    })
    assertContractSucceeded(result)
    expect(result.output.value).toMatchObject({
      lifecycleError: expect.stringContaining('fixture writer construction failed'),
      state: {
        openAttempted: true,
        writerDisposed: false,
        streamDisposed: true,
        removeAttempted: true,
      },
      remainingFileCount: 0,
    })
  })

  it('fails closed with both Action and cleanup errors when fixture deletion fails', async () => {
    const root = newTemporaryRoot()
    const result = await invokeContract({
      operation: 'cancellation-fixture-io-failure',
      mode: 'action-cleanup',
      tempRoot: root,
    })
    assertContractSucceeded(result)
    expect(result.output.value.lifecycleError).toContain('fixture action failed')
    expect(result.output.value.lifecycleError).toContain('fixture cleanup failed')
    expect(result.output.value).toMatchObject({
      state: { removeAttempted: true },
      remainingFileCount: 0,
    })
  })

  it('rejects cancellation when a callback-captured backend selection was read after the two-second window', async () => {
    const result = await invokeContract({
      operation: 'cancellation-timing',
      backendSelectedEvent: {
        backend: 'cuda',
        evidenceReceivedAtEpochMilliseconds: 10_000,
        evidenceSequence: 7,
      },
      statusBeforeRequest: 'running',
      cancelRequestCompletedAtEpochMilliseconds: 12_001,
      maximumDelayMilliseconds: 2_000,
    })
    expect(result.status).toBe(1)
    expect(result.output.error).toContain('Cancellation request exceeded the backend-selection window')
  })

  it('safely registers, health-checks, drains and removes the production process-event job', async () => {
    const result = await invokeContract({ operation: 'runtime-adapter-readiness' })
    if (result.status === 0) {
      expect(result.output.value.processObservation).toMatchObject({
        source: 'Win32_ProcessStartTrace',
        smoke: {
          jobBacked: true,
          healthChecked: true,
          cleanupVerified: true,
        },
      })
    } else {
      expect(result.output.error).toContain('Production process-event job readiness failed closed')
    }
  })

  it('accepts an idle NotStarted action job as healthy', async () => {
    const result = await invokeContract({ operation: 'process-event-job-state', state: 'NotStarted' })
    assertContractSucceeded(result)
    expect(result.output.value).toMatchObject({ state: 'NotStarted', healthy: true })
  })

  it('accepts an active Running action job as healthy', async () => {
    const result = await invokeContract({ operation: 'process-event-job-state', state: 'Running' })
    assertContractSucceeded(result)
    expect(result.output.value).toMatchObject({ state: 'Running', healthy: true })
  })

  it.each(['Failed', 'Stopped', 'Disconnected', 'Completed'])('rejects an unhealthy %s action job', async (state) => {
    const result = await invokeContract({ operation: 'process-event-job-state', state })
    expect(result.status).toBe(1)
    expect(result.output.error).toContain(`event job is not healthy: ${state}`)
  })

  it('rejects a missing action job', async () => {
    const result = await invokeContract({ operation: 'process-event-job-state', state: 'missing' })
    expect(result.status).toBe(1)
    expect(result.output.error).toContain('requires exactly one event job; found 0')
  })

  it('continues process-subscription cleanup after the subscriber disappeared and still fails closed', async () => {
    const result = await invokeContract({ operation: 'process-subscription-cleanup' })
    assertContractSucceeded(result)
    expect(result.output.value.cleanupError).toContain('subscriber already missing')
    expect(result.output.value.state).toMatchObject({
      unregisterAttempted: true,
      removeEventsAttempted: true,
      removeJobAttempted: true,
      drainQueueAttempted: true,
      verifyAttempted: true,
      subscriberPresent: false,
      eventsPresent: false,
      jobPresent: false,
      queuePresent: false,
    })
  })

  it('attributes a short-lived CUDA worker only to the exact WebDriver Rain process tree and closes the event subscription', async () => {
    const result = await invokeContract({ operation: 'worker-observation' })
    assertContractSucceeded(result)
    expect(result.output.value).toMatchObject({
      adapterStarted: true,
      adapterStopped: true,
      readCount: 2,
      observerRoot: {
        processId: 100,
        executablePath: 'C:\\Program Files\\Rain\\Rain.exe',
        startedAt: '2026-08-11T00:00:11.0000000+00:00',
      },
      observation: {
        source: 'process-start-events',
        workerStarts: [{
          processId: 151,
          parentProcessId: 150,
          processName: 'rain-whisper-cuda.exe',
          ancestorProcessIds: [150, 100],
        }],
      },
    })
    expect(result.output.value.observation.workerStarts).toHaveLength(1)
    expect(result.output.value.observation.workerStarts[0].processId).not.toBe(201)
  })

  it('fails closed and removes the event subscription when the Rain root PID was reused', async () => {
    const result = await invokeContract({ operation: 'worker-observation', mode: 'root-pid-reused' })
    assertContractSucceeded(result)
    expect(result.output.value).toMatchObject({
      adapterStarted: true,
      adapterStopped: true,
      observation: null,
    })
    expect(result.output.value.observationError).toContain('Rain session process identity changed')
  })

  it.each(['missing', 'duplicate', 'stopped', 'failed'])(
    'fails closed when the process-event subscription is %s',
    async (health) => {
      const result = await invokeContract({ operation: 'worker-observation', mode: `subscription-${health}` })
      assertContractSucceeded(result)
      expect(result.output.value).toMatchObject({
        adapterStarted: true,
        adapterStopped: true,
        observation: null,
        readCount: 1,
      })
      expect(result.output.value.observationError).toContain(`Process observation subscription is not healthy: ${health}`)
    },
  )

  it('fails through the real runner CLI before expensive work when provenance or runtime enablement cannot be trusted, and persists a redacted failure', async () => {
    const root = newTemporaryRoot()
    const candidate = createArtifactFixture(root)
    const badProvenanceRoot = join(root, 'runner-bad-provenance')
    const missingSecretModelPath = join(root, 'sk-secret-person@example.com-model.bin')
    const badProvenance = await invokeRunner([
      '-InstallerPath', candidate.installerPath,
      '-ArtifactManifestPath', candidate.artifactManifestPath,
      '-ExpectedArtifactManifestSha256', '0'.repeat(64),
      '-WhisperModelPath', missingSecretModelPath,
      '-ExpectedTargetCommit', candidate.targetCommit,
      '-ExpectedInstallerSha256', candidate.installerHash,
      '-OutputRoot', badProvenanceRoot,
    ])

    expect(badProvenance.status).toBe(1)
    const badProvenanceManifest = JSON.parse(readFileSync(join(badProvenanceRoot, 'manifest.json'), 'utf8'))
    expect(badProvenanceManifest).toMatchObject({ result: 'failed', phase: 'input-validation' })
    expect(badProvenanceManifest.error).toContain('Artifact manifest SHA-256 does not match the expected controlled-build record')

    writeFileSync(missingSecretModelPath, 'not a real model, only a runner input fixture')
    const outputRoot = join(root, 'runner-target-checkout-blocked')
    const result = await invokeRunner([
      '-InstallerPath', candidate.installerPath,
      '-ArtifactManifestPath', candidate.artifactManifestPath,
      '-ExpectedArtifactManifestSha256', candidate.artifactManifestHash,
      '-WhisperModelPath', missingSecretModelPath,
      '-ExpectedTargetCommit', candidate.targetCommit,
      '-ExpectedInstallerSha256', candidate.installerHash,
      '-OutputRoot', outputRoot,
    ])

    expect(result.status).toBe(1)
    const manifestPath = join(outputRoot, 'manifest.json')
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(manifest.result).toBe('failed')
    expect(['runtime-adapter-readiness', 'target-checkout']).toContain(manifest.phase)
    if (manifest.phase === 'runtime-adapter-readiness') {
      expect(manifest.error).toContain('Production process-event job readiness failed closed')
    } else {
      expect(manifest.error).toContain('Target checkout mismatch')
    }
    expect(manifest.expectedArtifactManifestSha256).toBe(candidate.artifactManifestHash)
    const partial = JSON.parse(readFileSync(join(outputRoot, 'partial-manifest.json'), 'utf8'))
    if (manifest.phase === 'target-checkout') {
      expect(partial.phases).toEqual(expect.arrayContaining([
        expect.objectContaining({ phase: 'runtime-adapter-readiness', result: 'passed' }),
      ]))
    }
    const persistedText = allFileNames(outputRoot).map((path) => readFileSync(path, 'utf8')).join('\n')
    expect(persistedText).not.toContain('sk-secret')
    expect(persistedText).not.toContain('person@example.com')
    expect(persistedText).not.toContain('C:\\Users\\24627')
  })
})
