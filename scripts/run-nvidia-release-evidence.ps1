param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [Parameter(Mandatory = $true)]
  [string]$WhisperModelPath,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$ExpectedTargetCommit,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{64}$')]
  [string]$ExpectedInstallerSha256,
  [Parameter(Mandatory = $true)]
  [Alias('InstallerAttestationPath')]
  [string]$ArtifactManifestPath,
  [Parameter(Mandatory = $true)]
  [string]$ControlledBuildRecordPath,
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{64}$')]
  [string]$ExpectedArtifactManifestSha256,
  [string]$OutputRoot = '',
  [string]$InstallDir = '',
  [int]$DriverPort = 4474,
  [int]$NativeDriverPort = 4475,
  [int]$MaxSeconds = 600,
  [switch]$KeepInstall
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Get-Item -LiteralPath (Split-Path -Parent $PSScriptRoot)).FullName
Import-Module -Name (Join-Path $PSScriptRoot 'nvidia-release-evidence-contract.psm1') -Force
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$installRootIsTemporary = [string]::IsNullOrWhiteSpace($InstallDir)
$runRoot = if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  Join-Path $repoRoot "evidence\release-nvidia-$timestamp"
} else {
  if ([System.IO.Path]::IsPathRooted($OutputRoot)) {
    [System.IO.Path]::GetFullPath($OutputRoot)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputRoot))
  }
}
if (Test-Path -LiteralPath $runRoot) {
  throw "Refusing to overwrite an existing NVIDIA Evidence directory: $runRoot"
}
$runRoot = (New-Item -ItemType Directory -Path $runRoot).FullName
$logDir = (New-Item -ItemType Directory -Path (Join-Path $runRoot 'logs')).FullName
$driverLog = Join-Path $logDir 'tauri-driver.log'
$driverErrorLog = Join-Path $logDir 'tauri-driver.err.log'
$manifestPath = Join-Path $runRoot 'manifest.json'
$environmentPath = Join-Path $runRoot 'environment.json'
$artifactPath = Join-Path $runRoot 'artifact.json'
$capabilityPath = Join-Path $runRoot 'runtime-capability.json'
$runtimePath = Join-Path $runRoot 'runtime-evidence.json'
$databasePath = Join-Path $runRoot 'rain-evidence.db'
$invalidModelPath = Join-Path $runRoot 'invalid-model.bin'
$installRoot = if ($installRootIsTemporary) {
  Join-Path $env:TEMP ("rain-nvidia-release-install-" + [Guid]::NewGuid().ToString('N'))
} else {
  [System.IO.Path]::GetFullPath($InstallDir)
}
$memoryHeadroomBytes = 512L * 1024L * 1024L
$requiredEvidencePhases = @(
  'install-directory-ownership',
  'input-validation',
  'control-tooling-checkout',
  'runtime-adapter-readiness',
  'host-qualification',
  'install',
  'install-reconciliation',
  'payload-validation',
  'driver-start',
  'startup',
  'runtime-capability',
  'auto-cuda-short-sample',
  'forced-cuda-short-sample',
  'forced-cpu-short-sample',
  'cancellation',
  'worker-failure-injection',
  'model-error',
  'runtime-evidence'
)
$evidenceWriter = New-ReleaseEvidenceWriter -RunRoot $runRoot -EvidenceId (Split-Path -Leaf $runRoot) -ExpectedTargetCommit $ExpectedTargetCommit -ExpectedInstallerSha256 $ExpectedInstallerSha256 -ExpectedArtifactManifestSha256 $ExpectedArtifactManifestSha256 -RequiredPhases $requiredEvidencePhases

function Require-Command([string]$Name, [string]$InstallHint) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "$Name is required for NVIDIA Release Evidence. $InstallHint" }
  return $command.Source
}

function Merge-ErrorRecord($Primary, $Secondary, [string]$Context) {
  if (-not $Primary) { return $Secondary }
  $exception = [System.Exception]::new(
    "$($Primary.Exception.Message) ${Context}: $($Secondary.Exception.Message)",
    $Primary.Exception
  )
  return [System.Management.Automation.ErrorRecord]::new(
    $exception,
    'RainEvidenceCleanupFailure',
    [System.Management.Automation.ErrorCategory]::OperationStopped,
    $null
  )
}

function Invoke-WebDriver([string]$Method, [string]$Path, $Body = $null) {
  $uri = "http://127.0.0.1:$DriverPort$Path"
  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $uri -TimeoutSec $MaxSeconds
  }
  return Invoke-RestMethod -Method $Method -Uri $uri -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 30) -TimeoutSec $MaxSeconds
}

function Wait-WebDriver {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    try {
      Invoke-RestMethod -Uri "http://127.0.0.1:$DriverPort/status" -Method Get -TimeoutSec 2 | Out-Null
      return
    } catch {
      Start-Sleep -Milliseconds 250
    }
  } while ((Get-Date) -lt $deadline)
  throw 'tauri-driver did not become ready on time.'
}

function New-WebDriverSession([string]$ApplicationPath) {
  $response = Invoke-WebDriver 'Post' '/session' @{
    capabilities = @{
      alwaysMatch = @{
        browserName = 'wry'
        'tauri:options' = @{ application = $ApplicationPath }
      }
    }
  }
  if ($response.value.sessionId) { return [string]$response.value.sessionId }
  if ($response.sessionId) { return [string]$response.sessionId }
  throw 'Could not create WebDriver session.'
}

function Invoke-WebDriverScript([string]$SessionId, [string]$Script) {
  $response = Invoke-WebDriver 'Post' "/session/$SessionId/execute/sync" @{
    script = $Script
    args = @()
  }
  return $response.value
}

function Wait-WebDriverCondition([string]$SessionId, [string]$Description, [string]$Script) {
  $deadline = (Get-Date).AddSeconds($MaxSeconds)
  do {
    $result = Invoke-WebDriverScript $SessionId $Script
    if ($result -eq $true) { return }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Description."
}

function Close-WebDriverSession([string]$SessionId) {
  if ([string]::IsNullOrWhiteSpace($SessionId)) { return }
  Invoke-WebDriver 'Delete' "/session/$SessionId" | Out-Null
}

function Invoke-TauriCommandResult([string]$SessionId, [string]$Command, $Args) {
  $argsJson = ConvertTo-Json -InputObject $Args -Depth 30 -Compress
  $script = @"
const done = arguments[0];
const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
if (typeof invoke !== 'function') {
  done({ ok: false, error: 'Tauri invoke bridge is unavailable.' });
} else {
  invoke('$Command', $argsJson).then(
    (value) => done({ ok: true, value }),
    (error) => done({ ok: false, error: String(error && error.message ? error.message : error) }),
  );
}
"@
  $response = Invoke-WebDriver 'Post' "/session/$SessionId/execute/async" @{
    script = $script
    args = @()
  }
  return $response.value
}

function Invoke-TauriCommand([string]$SessionId, [string]$Command, $Args) {
  $result = Invoke-TauriCommandResult $SessionId $Command $Args
  if ($result.ok -ne $true) {
    throw "Tauri command '$Command' failed: $($result.error)"
  }
  return $result.value
}

function Start-AsyncTauriCommand([string]$SessionId, [string]$Key, [string]$Command, $Args) {
  $argsJson = ConvertTo-Json -InputObject $Args -Depth 30 -Compress
  $script = @"
const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
if (typeof invoke !== 'function') return false;
window.__RAIN_NVIDIA_EVIDENCE_ASYNC__ ||= {};
const record = { status: 'running', command: '$Command', startedAt: Date.now() };
window.__RAIN_NVIDIA_EVIDENCE_ASYNC__['$Key'] = record;
invoke('$Command', $argsJson).then(
  (value) => Object.assign(record, { status: 'passed', value, completedAt: Date.now() }),
  (error) => Object.assign(record, {
    status: 'failed',
    error: String(error && error.message ? error.message : error),
    completedAt: Date.now(),
  }),
);
return true;
"@
  if ((Invoke-WebDriverScript $SessionId $script) -ne $true) {
    throw "Could not start asynchronous Tauri command '$Command'."
  }
}

function Get-AsyncTauriCommand([string]$SessionId, [string]$Key) {
  return Invoke-WebDriverScript $SessionId @"
return window.__RAIN_NVIDIA_EVIDENCE_ASYNC__?.['$Key'] || null;
"@
}

function Wait-AsyncTauriCommand([string]$SessionId, [string]$Key) {
  $deadline = (Get-Date).AddSeconds($MaxSeconds)
  do {
    $result = Get-AsyncTauriCommand $SessionId $Key
    if ($result -and $result.status -ne 'running') { return $result }
    Start-Sleep -Milliseconds 50
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for asynchronous Tauri command '$Key'."
}

function Initialize-ProgressCapture([string]$SessionId) {
  $script = @'
const done = arguments[0];
const internals = window.__TAURI_INTERNALS__;
if (!internals || typeof internals.invoke !== 'function' || typeof internals.transformCallback !== 'function') {
  done(false);
} else {
  window.__RAIN_NVIDIA_EVIDENCE_EVENTS__ = [];
  window.__RAIN_NVIDIA_EVIDENCE_EVENT_SEQUENCE__ = 0;
  const handler = internals.transformCallback((event) => {
    const callbackEpochMilliseconds = (
      typeof performance === 'object' &&
      Number.isFinite(performance.timeOrigin) &&
      typeof performance.now === 'function'
    ) ? performance.timeOrigin + performance.now() : Date.now();
    window.__RAIN_NVIDIA_EVIDENCE_EVENTS__.push({
      ...event.payload,
      evidenceReceivedAtEpochMilliseconds: callbackEpochMilliseconds,
      evidenceSequence: window.__RAIN_NVIDIA_EVIDENCE_EVENT_SEQUENCE__++,
    });
  });
  internals.invoke('plugin:event|listen', {
    event: 'progress',
    target: { kind: 'Any' },
    handler,
  }).then(
    (eventId) => {
      window.__RAIN_NVIDIA_EVIDENCE_EVENT_ID__ = eventId;
      done(true);
    },
    () => done(false),
  );
}
'@
  $response = Invoke-WebDriver 'Post' "/session/$SessionId/execute/async" @{
    script = $script
    args = @()
  }
  if ($response.value -ne $true) { throw 'Could not initialize production progress-event capture.' }
}

function Get-ProgressEvents([string]$SessionId, [string]$VideoId) {
  $safeVideoId = ConvertTo-Json -InputObject $VideoId -Compress
  return @(Invoke-WebDriverScript $SessionId @"
return (window.__RAIN_NVIDIA_EVIDENCE_EVENTS__ || []).filter((event) => event.videoId === $safeVideoId);
"@)
}

function Get-PeImportText([string]$Path) {
  $llvmObjdump = Get-Command 'llvm-objdump.exe' -ErrorAction SilentlyContinue
  if ($llvmObjdump) {
    $output = (& $llvmObjdump.Source -p $Path 2>&1 | Out-String)
    return Assert-PeImportInspectionResult -ToolName 'llvm-objdump.exe' -ExitCode $LASTEXITCODE -Output $output
  }
  $dumpbin = Get-Command 'dumpbin.exe' -ErrorAction SilentlyContinue
  if ($dumpbin) {
    $output = (& $dumpbin.Source /imports $Path 2>&1 | Out-String)
    return Assert-PeImportInspectionResult -ToolName 'dumpbin.exe' -ExitCode $LASTEXITCODE -Output $output
  }
  throw 'llvm-objdump.exe or dumpbin.exe is required to inspect PE imports.'
}

function Get-UniqueInstalledFile([string]$Root, [string]$Filter, [string]$Description) {
  $matches = @(Get-ChildItem -LiteralPath $Root -Recurse -Filter $Filter -File -ErrorAction SilentlyContinue)
  if ($matches.Count -ne 1) {
    throw "Expected exactly one installed $Description under $Root; found $($matches.Count)."
  }
  return $matches[0].FullName
}

function Install-RainCandidate([string]$Installer, [string]$Destination) {
  $process = Start-ReleaseEvidenceNsisInstaller -Installer $Installer -Destination $Destination
  if ($process.ExitCode -ne 0) { throw "Rain installer failed with exit code $($process.ExitCode)." }
  return Get-UniqueInstalledFile $Destination 'rain.exe' 'rain.exe'
}

function Find-ProbeMedia([string]$InstalledRoot) {
  $matches = @(Get-ChildItem -LiteralPath $InstalledRoot -Recurse -Filter 'sample.mp4' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -replace '/', '\' -match 'asr-capability\\sample\.mp4$' })
  if ($matches.Count -ne 1) {
    throw "Expected exactly one bundled ASR probe sample; found $($matches.Count)."
  }
  return $matches[0].FullName
}

function Assert-NvidiaEnvironment {
  $controllers = @(Get-CimInstance Win32_VideoController -ErrorAction Stop | ForEach-Object {
    [ordered]@{
      name = [string]$_.Name
      adapterCompatibility = [string]$_.AdapterCompatibility
      driverVersion = [string]$_.DriverVersion
      adapterRam = [uint64]$_.AdapterRAM
    }
  })
  $nvidiaControllers = @($controllers | Where-Object {
    $_.name -match '(?i)nvidia' -or $_.adapterCompatibility -match '(?i)nvidia'
  })
  if ($nvidiaControllers.Count -lt 1) { throw 'NVIDIA Release Evidence requires an NVIDIA display adapter.' }

  $nvidiaSmi = Require-Command 'nvidia-smi.exe' 'Install a compatible NVIDIA display driver.'
  $smiRows = @(& $nvidiaSmi --query-gpu=name,driver_version,memory.total,memory.free --format=csv,noheader,nounits 2>&1)
  if ($LASTEXITCODE -ne 0 -or $smiRows.Count -lt 1) { throw 'nvidia-smi failed to report GPU and driver facts.' }
  $systemNvcuda = @(@(
      (Join-Path $env:SystemRoot 'System32\nvcuda.dll'),
      (Join-Path $env:SystemRoot 'SysWOW64\nvcuda.dll')
    ) | Where-Object { Test-Path -LiteralPath $_ })
  if ($systemNvcuda.Count -lt 1) { throw 'Compatible NVIDIA driver nvcuda.dll was not found.' }

  $environment = [ordered]@{
    os = [System.Environment]::OSVersion.VersionString
    videoControllers = @($controllers)
    nvidiaControllerCount = $nvidiaControllers.Count
    nvidiaSmiAvailable = $true
    nvidiaSmiRows = @($smiRows | ForEach-Object { Protect-ReleaseEvidenceDiagnosticText ([string]$_) })
    systemNvcudaPresent = $true
  }
  return $environment
}

function Assert-Sentences($Value, [string]$Description) {
  $sentences = @($Value)
  if ($sentences.Count -le 0) { throw "$Description returned no sentences." }
  $previousEnd = 0.0
  foreach ($sentence in $sentences) {
    if ([string]::IsNullOrWhiteSpace([string]$sentence.text)) {
      throw "$Description returned a blank sentence."
    }
    $start = [double]$sentence.start_time
    $end = [double]$sentence.end_time
    if ($start -lt 0 -or $start -ge $end -or $start -lt $previousEnd) {
      throw "$Description timestamps are not monotonic: $($sentence | ConvertTo-Json -Compress)"
    }
    $previousEnd = $end
  }
  return @($sentences | Select-Object id, text, start_time, end_time)
}

function Assert-SelectedBackend($Events, [string]$Expected, [string]$Description) {
  $selected = @($Events | Where-Object {
    $_.stage -eq 'asr_transcription' -and -not [string]::IsNullOrWhiteSpace([string]$_.backend)
  })
  if (-not ($selected | Where-Object { $_.backend -eq $Expected })) {
    throw "$Description did not report backend '$Expected': $($Events | ConvertTo-Json -Compress)"
  }
  return @($selected)
}

function Assert-NoBackend($Events, [string]$Forbidden, [string]$Description) {
  if ($Events | Where-Object { $_.backend -eq $Forbidden }) {
    throw "$Description unexpectedly selected backend '$Forbidden': $($Events | ConvertTo-Json -Compress)"
  }
}

$installer = $null
$modelPath = $null
$modelItem = $null
$installerHash = $null
$modelHash = $null
$targetCommit = $null
$provenance = $null

$sessionId = $null
$driverProcess = $null
$workerObserver = $null
$primaryError = $null
$phase = 'bootstrap'
$installedBinary = $null
$workerPath = $null
$workerBackupPath = $null
$workerOriginalHash = $null
$installOwnership = $null
try {
  $phase = 'install-directory-ownership'
  if ($installRootIsTemporary) {
    if (Test-Path -LiteralPath $installRoot) {
      throw "Generated temporary InstallDir already exists: $installRoot"
    }
    $installOwnership = [ordered]@{
      path = $installRoot
      mode = 'generated-temporary'
      existedBeforeRun = $false
    }
  } else {
    if (-not $KeepInstall) {
      throw 'A custom InstallDir requires -KeepInstall; automatic cleanup is limited to generated TEMP paths.'
    }
    $installOwnership = Assert-ReleaseEvidenceInstallDirectory -InstallDir $installRoot
  }
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{ installDirectory = $installOwnership } | Out-Null

  $phase = 'input-validation'
  $provenance = Assert-CandidateArtifactProvenance `
    -InstallerPath $InstallerPath `
    -ExpectedTargetCommit $ExpectedTargetCommit `
    -ExpectedInstallerSha256 $ExpectedInstallerSha256 `
    -ArtifactManifestPath $ArtifactManifestPath `
    -ExpectedArtifactManifestSha256 $ExpectedArtifactManifestSha256 `
    -ControlledBuildRecordPath $ControlledBuildRecordPath
  $installer = [string]$provenance.installer.path
  $targetCommit = [string]$provenance.targetCommit
  $modelPath = (Resolve-Path -LiteralPath $WhisperModelPath).Path
  $modelItem = Get-Item -LiteralPath $modelPath
  $installerHash = [string]$provenance.installer.sha256
  $modelHash = Get-ReleaseEvidenceSha256 $modelPath
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data ([ordered]@{
    expectedTargetCommit = $ExpectedTargetCommit.ToLowerInvariant()
    installer = $provenance.installer
    artifactManifest = $provenance.artifactManifest
    controlledBuildRecord = $provenance.controlledBuildRecord
    evidenceModel = @{ path = $modelPath; sizeBytes = $modelItem.Length; sha256 = $modelHash }
  }) | Out-Null

  $phase = 'control-tooling-checkout'
  $toolingCommit = Assert-ReleaseEvidenceControlToolingCheckout -RepoRoot $repoRoot -ExpectedCommit ([string]$provenance.toolingCommit)
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{ toolingCommit = $toolingCommit; candidateTargetCommit = $targetCommit } | Out-Null

  $phase = 'runtime-adapter-readiness'
  $runtimeAdapterReadiness = Assert-ReleaseEvidenceRuntimeAdapterReadiness
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data $runtimeAdapterReadiness | Out-Null
  $installRoot = (New-Item -ItemType Directory -Force -Path $installRoot).FullName

  $tauriDriver = Require-Command 'tauri-driver' 'Install with: cargo install tauri-driver --version 2.0.6 --locked'
  $edgeDriver = Require-Command 'msedgedriver' 'Install a Microsoft Edge driver matching the local WebView2 runtime.'
  $phase = 'host-qualification'
  $environment = Assert-NvidiaEnvironment
  Write-AtomicJsonFile $environmentPath $environment
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{ artifact = 'environment.json' } | Out-Null

  $phase = 'install'
  $installedBinary = Install-RainCandidate $installer $installRoot
  $installedRoot = Split-Path -Parent $installedBinary
  $workerPath = Get-UniqueInstalledFile $installedRoot 'rain-whisper-cuda.exe' 'CUDA worker'
  $payloadManifestPath = Get-UniqueInstalledFile $installedRoot 'payload-manifest.json' 'CUDA payload manifest'
  $probeMedia = Find-ProbeMedia $installedRoot
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{
    installedMainExecutable = $installedBinary
    installedRoot = $installedRoot
    bundledProbeMedia = $probeMedia
  } | Out-Null

  $phase = 'install-reconciliation'
  $installedArtifactReconciliation = Assert-InstalledArtifactManifest -InstalledRoot $installedRoot -ArtifactManifestPath $ArtifactManifestPath
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{
    installedRoot = $installedRoot
    reconciledFiles = @($installedArtifactReconciliation.files)
  } | Out-Null

  $mainImports = Get-PeImportText $installedBinary
  Assert-ReleaseEvidenceMainExecutableImports -ImportText $mainImports | Out-Null

  $phase = 'payload-validation'
  $payloadValidation = Assert-InstalledCudaPayload -InstalledRoot $installedRoot -PayloadManifestPath $payloadManifestPath
  $payloadFiles = @($payloadValidation.files)
  $workerPath = [string]$payloadValidation.workerPath
  $workerOriginalHash = Get-ReleaseEvidenceSha256 $workerPath
  Write-AtomicJsonFile $artifactPath ([ordered]@{
    targetCommit = $targetCommit
    installer = $provenance.installer
    artifactManifest = $provenance.artifactManifest
    installedMainExecutable = @{
      path = $installedBinary
      sha256 = Get-ReleaseEvidenceSha256 $installedBinary
      cudaImportsPresent = $false
    }
    installedRoot = $installedRoot
    installedArtifactReconciliation = $installedArtifactReconciliation
    payloadManifest = $payloadManifestPath
    payloadFiles = @($payloadFiles)
    driverLibraryBundled = $false
    bundledProbeMedia = @{ path = $probeMedia; sha256 = Get-ReleaseEvidenceSha256 $probeMedia }
    evidenceModel = @{ path = $modelPath; sizeBytes = $modelItem.Length; sha256 = $modelHash }
  })
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{
    artifact = 'artifact.json'
    payloadFiles = $payloadFiles
    driverLibraryBundled = $false
  } | Out-Null

  $env:RAIN_E2E_MODE = '1'
  $env:RAIN_E2E_RUN_MODE = 'runtime-settings'
  $env:RAIN_E2E_DB_PATH = $databasePath
  $phase = 'driver-start'
  $driverArguments = Join-ReleaseEvidenceWindowsCommandLine -Arguments @(
    '--port', [string]$DriverPort,
    '--native-port', [string]$NativeDriverPort,
    '--native-driver', $edgeDriver
  )
  $driverProcess = Start-Process -FilePath $tauriDriver -ArgumentList $driverArguments -RedirectStandardOutput $driverLog -RedirectStandardError $driverErrorLog -WindowStyle Hidden -PassThru
  Wait-WebDriver
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{ driverPort = $DriverPort; nativeDriverPort = $NativeDriverPort } | Out-Null

  $phase = 'startup'
  $webDriverSessionStartedAt = [DateTimeOffset]::Now
  $sessionId = New-WebDriverSession $installedBinary
  $workerObserver = Start-ReleaseEvidenceSessionWorkerObserver `
    -ExpectedRainExecutablePath $installedBinary `
    -WebDriverSessionStartedAt $webDriverSessionStartedAt `
    -TrustedLauncherProcessId $driverProcess.Id `
    -TrustedLauncherStartedAt ([DateTimeOffset]::new($driverProcess.StartTime.ToUniversalTime()))
  Wait-WebDriverCondition $sessionId 'the installed production video list page' @'
return Boolean(document.querySelector('[data-testid="video-list-page"]'));
'@
  Initialize-ProgressCapture $sessionId
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{ installedMainExecutable = $installedBinary } | Out-Null

  $phase = 'runtime-capability'
  $capability = Invoke-TauriCommand $sessionId 'get_runtime_capability' @{ backendPreference = 'auto' }
  if ($capability.whisperBackend -ne 'cuda' -or $capability.cudaAvailable -ne $true) {
    throw "Production worker probe did not qualify this NVIDIA host: $($capability | ConvertTo-Json -Compress)"
  }
  if ([string]::IsNullOrWhiteSpace([string]$capability.cudaDevice) -or
      [int64]$capability.cudaFreeMemoryBytes -le 0 -or
      [int64]$capability.cudaTotalMemoryBytes -le 0 -or
      [int]$capability.workerProtocolVersion -ne 1) {
    throw "Production worker probe omitted required device/memory/protocol facts: $($capability | ConvertTo-Json -Compress)"
  }
  $requiredMemoryBytes = $modelItem.Length + $memoryHeadroomBytes
  if ([int64]$capability.cudaFreeMemoryBytes -lt $requiredMemoryBytes) {
    throw "Evidence model fails the production memory gate: free=$($capability.cudaFreeMemoryBytes), required=$requiredMemoryBytes."
  }
  Write-AtomicJsonFile $capabilityPath ([ordered]@{
    result = 'passed'
    eligibilityPredicate = 'production worker protocol probe + model bytes + 512 MiB headroom'
    capability = $capability
    modelSizeBytes = $modelItem.Length
    memoryHeadroomBytes = $memoryHeadroomBytes
    requiredMemoryBytes = $requiredMemoryBytes
    controlledBuildRecordOnly = $true
  })
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{ artifact = 'runtime-capability.json' } | Out-Null

  $commonArgs = @{
    filePath = $probeMedia
    tier = 'whisper'
    modelPath = $modelPath
    language = 'en'
  }
  $runtimeEvidence = [ordered]@{}

  $phase = 'auto-cuda-short-sample'
  $autoVideoId = 'rain-nvidia-auto-cuda'
  $autoSentences = Assert-Sentences (Invoke-TauriCommand $sessionId 'start_asr' ($commonArgs + @{
    videoId = $autoVideoId; backendPreference = 'auto'
  })) 'Auto CUDA short sample'
  $autoEvents = Get-ProgressEvents $sessionId $autoVideoId
  Assert-SelectedBackend $autoEvents 'cuda' 'Auto CUDA short sample' | Out-Null
  Assert-NoBackend $autoEvents 'cpu' 'Auto CUDA short sample'
  $runtimeEvidence['autoCuda'] = @{ sentences = @($autoSentences); progressEvents = @($autoEvents) }
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{ runtimeSection = 'autoCuda' } | Out-Null

  $phase = 'forced-cuda-short-sample'
  $cudaVideoId = 'rain-nvidia-forced-cuda'
  $cudaSentences = Assert-Sentences (Invoke-TauriCommand $sessionId 'start_asr' ($commonArgs + @{
    videoId = $cudaVideoId; backendPreference = 'cuda'
  })) 'Forced CUDA short sample'
  $cudaEvents = Get-ProgressEvents $sessionId $cudaVideoId
  Assert-SelectedBackend $cudaEvents 'cuda' 'Forced CUDA short sample' | Out-Null
  Assert-NoBackend $cudaEvents 'cpu' 'Forced CUDA short sample'
  $runtimeEvidence['forcedCuda'] = @{ sentences = @($cudaSentences); progressEvents = @($cudaEvents) }
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{ runtimeSection = 'forcedCuda' } | Out-Null

  $phase = 'forced-cpu-short-sample'
  $cpuVideoId = 'rain-nvidia-forced-cpu'
  $cpuObservationWindow = Start-ReleaseEvidenceWorkerObservationWindow -Observer $workerObserver
  Start-AsyncTauriCommand $sessionId 'forcedCpu' 'start_asr' ($commonArgs + @{
    videoId = $cpuVideoId; backendPreference = 'cpu'
  })
  $deadline = (Get-Date).AddSeconds($MaxSeconds)
  do {
    $cpuRun = Get-AsyncTauriCommand $sessionId 'forcedCpu'
    if ($cpuRun -and $cpuRun.status -ne 'running') { break }
    Start-Sleep -Milliseconds 25
  } while ((Get-Date) -lt $deadline)
  $cpuProcessObservation = Complete-ReleaseEvidenceWorkerObservationWindow -Window $cpuObservationWindow
  if (-not $cpuRun -or $cpuRun.status -eq 'running') { throw 'Forced CPU short sample timed out.' }
  if ($cpuRun.status -ne 'passed') { throw "Forced CPU short sample failed: $($cpuRun.error)" }
  if (@($cpuProcessObservation.workerStarts).Count -gt 0) { throw 'Forced CPU started a session-owned rain-whisper-cuda.exe.' }
  $cpuSentences = Assert-Sentences $cpuRun.value 'Forced CPU short sample'
  $cpuEvents = Get-ProgressEvents $sessionId $cpuVideoId
  Assert-SelectedBackend $cpuEvents 'cpu' 'Forced CPU short sample' | Out-Null
  Assert-NoBackend $cpuEvents 'cuda' 'Forced CPU short sample'
  $runtimeEvidence['forcedCpu'] = @{
    sentences = @($cpuSentences)
    progressEvents = @($cpuEvents)
    processObservation = $cpuProcessObservation
    cudaWorkerObserved = $false
  }
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{ runtimeSection = 'forcedCpu' } | Out-Null

  $phase = 'cancellation'
  $cancelVideoId = 'rain-nvidia-cancel'
  $runtimeEvidence['cancellation'] = Invoke-WithReleaseEvidenceCancellationFixture -Action {
    param($fixture)
    $cancelObservationWindow = Start-ReleaseEvidenceWorkerObservationWindow -Observer $workerObserver
    Start-AsyncTauriCommand $sessionId 'cancelRun' 'start_asr' @{
      filePath = $fixture.path
      tier = 'whisper'
      modelPath = $modelPath
      language = 'en'
      videoId = $cancelVideoId
      backendPreference = 'auto'
    }
    $deadline = (Get-Date).AddSeconds(30)
    $cudaSelected = $false
    do {
      $cancelEvents = Get-ProgressEvents $sessionId $cancelVideoId
      $cudaSelected = @($cancelEvents | Where-Object { $_.backend -eq 'cuda' }).Count -gt 0
      if ($cudaSelected) { break }
      $cancelRun = Get-AsyncTauriCommand $sessionId 'cancelRun'
      if ($cancelRun -and $cancelRun.status -ne 'running') { break }
      Start-Sleep -Milliseconds 25
    } while ((Get-Date) -lt $deadline)
    if (-not $cudaSelected) { throw 'Cancellation run did not reach the CUDA adapter before cancellation.' }
    $backendSelectedEvent = @($cancelEvents | Where-Object { $_.backend -eq 'cuda' } |
      Sort-Object evidenceSequence | Select-Object -First 1)
    if ($backendSelectedEvent.Count -ne 1) {
      throw 'Cancellation run could not identify one callback-captured CUDA selection event.'
    }
    $cancelRun = Get-AsyncTauriCommand $sessionId 'cancelRun'
    if (-not $cancelRun -or $cancelRun.status -ne 'running') {
      throw 'Cancellation fixture completed before cancellation could be requested.'
    }
    Invoke-TauriCommand $sessionId 'cancel_import' @{ videoId = $cancelVideoId } | Out-Null
    $cancelRequestCompletedAtEpochMilliseconds = [double](([DateTimeOffset]::UtcNow - [DateTimeOffset]::FromUnixTimeMilliseconds(0)).TotalMilliseconds)
    $cancelTiming = Assert-ReleaseEvidenceCancellationTiming `
      -BackendSelectedEvent $backendSelectedEvent[0] `
      -StatusBeforeRequest ([string]$cancelRun.status) `
      -CancelRequestCompletedAtEpochMilliseconds $cancelRequestCompletedAtEpochMilliseconds `
      -MaximumDelayMilliseconds $fixture.cancelAfterBackendSelectionWithinMilliseconds
    $cancelRun = Wait-AsyncTauriCommand $sessionId 'cancelRun'
    $cancelEvents = Get-ProgressEvents $sessionId $cancelVideoId
    $cancelProcessObservation = Complete-ReleaseEvidenceWorkerObservationWindow -Window $cancelObservationWindow
    if (@($cancelProcessObservation.workerStarts).Count -lt 1) {
      throw 'Cancellation run did not observe a session-owned CUDA worker start event.'
    }
    if ($cancelRun.status -ne 'failed' -or [string]$cancelRun.error -notmatch '(?i)cancel') {
      throw "CUDA cancellation did not return a classified cancellation: $($cancelRun | ConvertTo-Json -Compress)"
    }
    Assert-NoBackend $cancelEvents 'cpu' 'CUDA cancellation'
    return [ordered]@{
      result = $cancelRun
      progressEvents = @($cancelEvents)
      processObservation = $cancelProcessObservation
      fixture = [ordered]@{
        format = $fixture.format
        durationSeconds = $fixture.durationSeconds
        sizeBytes = $fixture.sizeBytes
        sha256 = $fixture.sha256
        cancelAfterBackendSelectionWithinMilliseconds = $fixture.cancelAfterBackendSelectionWithinMilliseconds
      }
      cancellationTiming = $cancelTiming
      cpuRetryObserved = $false
    }
  }
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{ runtimeSection = 'cancellation' } | Out-Null

  $phase = 'worker-failure-injection'
  $workerBackupPath = "$workerPath.rain-evidence-backup"
  if (Test-Path -LiteralPath $workerBackupPath) { throw "Worker backup path already exists: $workerBackupPath" }
  Move-Item -LiteralPath $workerPath -Destination $workerBackupPath
  Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\where.exe') -Destination $workerPath
  $stubHash = Get-ReleaseEvidenceSha256 $workerPath
  $fallbackCapability = Invoke-TauriCommand $sessionId 'get_runtime_capability' @{ backendPreference = 'auto' }
  if ($fallbackCapability.whisperBackend -ne 'cpu' -or [string]::IsNullOrWhiteSpace([string]$fallbackCapability.fallbackReason)) {
    throw "Auto did not classify the injected worker failure for CPU fallback: $($fallbackCapability | ConvertTo-Json -Compress)"
  }
  $fallbackVideoId = 'rain-nvidia-worker-fallback'
  $fallbackSentences = Assert-Sentences (Invoke-TauriCommand $sessionId 'start_asr' ($commonArgs + @{
    videoId = $fallbackVideoId; backendPreference = 'auto'
  })) 'Injected worker-failure CPU fallback sample'
  $fallbackEvents = Get-ProgressEvents $sessionId $fallbackVideoId
  Assert-SelectedBackend $fallbackEvents 'cpu' 'Injected worker-failure fallback' | Out-Null
  $fallbackSelected = @($fallbackEvents | Where-Object { $_.backend -eq 'cpu' } | Select-Object -Last 1)
  if ($fallbackSelected.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$fallbackSelected[0].fallbackReason)) {
    throw 'Injected worker-failure fallback did not expose a reason through the production progress event.'
  }
  $forcedFailureVideoId = 'rain-nvidia-worker-forced-failure'
  $forcedWorkerFailure = Invoke-TauriCommandResult $sessionId 'start_asr' ($commonArgs + @{
    videoId = $forcedFailureVideoId; backendPreference = 'cuda'
  })
  $forcedFailureEvents = Get-ProgressEvents $sessionId $forcedFailureVideoId
  if ($forcedWorkerFailure.ok -eq $true -or [string]$forcedWorkerFailure.error -notmatch '(?i)cuda|worker') {
    throw "Forced CUDA did not fail closed for the injected worker failure: $($forcedWorkerFailure | ConvertTo-Json -Compress)"
  }
  Assert-NoBackend $forcedFailureEvents 'cpu' 'Forced CUDA worker failure'
  Move-Item -LiteralPath $workerBackupPath -Destination $workerPath -Force
  $workerBackupPath = $null
  $restoredWorkerHash = Get-ReleaseEvidenceSha256 $workerPath
  if ($restoredWorkerHash -ne $workerOriginalHash) { throw 'CUDA worker restoration hash mismatch.' }
  $runtimeEvidence['workerFailure'] = @{
    injectedStubSha256 = $stubHash
    autoCapability = $fallbackCapability
    autoFallbackSentences = @($fallbackSentences)
    autoProgressEvents = @($fallbackEvents)
    forcedCudaResult = $forcedWorkerFailure
    forcedCudaProgressEvents = @($forcedFailureEvents)
    originalWorkerRestored = $true
    restoredWorkerSha256 = $restoredWorkerHash
  }
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{ runtimeSection = 'workerFailure' } | Out-Null

  $phase = 'model-error'
  [System.IO.File]::WriteAllBytes($invalidModelPath, [byte[]](0..63))
  $modelErrorVideoId = 'rain-nvidia-model-error'
  $modelErrorResult = Invoke-TauriCommandResult $sessionId 'start_asr' @{
    videoId = $modelErrorVideoId
    filePath = $probeMedia
    tier = 'whisper'
    modelPath = $invalidModelPath
    language = 'en'
    backendPreference = 'auto'
  }
  $modelErrorEvents = Get-ProgressEvents $sessionId $modelErrorVideoId
  if ($modelErrorResult.ok -eq $true) { throw 'Invalid model unexpectedly produced a successful ASR result.' }
  Assert-SelectedBackend $modelErrorEvents 'cuda' 'Model error injection' | Out-Null
  Assert-NoBackend $modelErrorEvents 'cpu' 'Model error injection'
  $runtimeEvidence['modelError'] = @{
    result = $modelErrorResult
    invalidModelSha256 = Get-ReleaseEvidenceSha256 $invalidModelPath
    progressEvents = @($modelErrorEvents)
    cpuRetryObserved = $false
  }
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{ runtimeSection = 'modelError' } | Out-Null

  $runtimeEvidence['workerRestoredAtEnd'] = ((Get-ReleaseEvidenceSha256 $workerPath) -eq $workerOriginalHash)
  if ($runtimeEvidence['workerRestoredAtEnd'] -ne $true) { throw 'Installed CUDA worker was not restored after failure injection.' }
  $phase = 'runtime-evidence'
  Write-AtomicJsonFile $runtimePath $runtimeEvidence
  Write-ReleaseEvidencePhase -Writer $evidenceWriter -Phase $phase -Result 'passed' -Data @{ artifact = 'runtime-evidence.json' } | Out-Null

  $manifestPath = Write-ReleaseEvidenceSuccessManifest -Writer $evidenceWriter -Facts ([ordered]@{
    targetCommit = $targetCommit
    installerSha256 = $installerHash
    modelSha256 = $modelHash
    exactConfigurationOnly = $true
    artifactManifest = $provenance.artifactManifest
    environment = 'environment.json'
    artifact = 'artifact.json'
    runtimeCapability = 'runtime-capability.json'
    runtimeEvidence = 'runtime-evidence.json'
    logs = @('logs/tauri-driver.log', 'logs/tauri-driver.err.log')
  })
  Write-Output "NVIDIA_RELEASE_EVIDENCE_MANIFEST=$manifestPath"
} catch {
  $primaryError = $_
} finally {
  if ($workerBackupPath -and (Test-Path -LiteralPath $workerBackupPath)) {
    try {
      if (Test-Path -LiteralPath $workerPath) { Remove-Item -LiteralPath $workerPath -Force }
      Move-Item -LiteralPath $workerBackupPath -Destination $workerPath -Force
    } catch {
      $primaryError = Merge-ErrorRecord $primaryError $_ 'Additionally, CUDA worker restoration failed'
    }
  }
  if ($workerObserver) {
    try { Stop-ReleaseEvidenceSessionWorkerObserver -Observer $workerObserver } catch {
      $primaryError = Merge-ErrorRecord $primaryError $_ 'Additionally, process observation cleanup failed'
    }
  }
  if ($sessionId) {
    try { Close-WebDriverSession $sessionId } catch { }
  }
  if ($driverProcess -and -not $driverProcess.HasExited) {
    Stop-Process -Id $driverProcess.Id -Force -ErrorAction SilentlyContinue
    $driverProcess.WaitForExit(5000) | Out-Null
  }
  try {
    Protect-ReleaseEvidenceLogFile $driverLog
    Protect-ReleaseEvidenceLogFile $driverErrorLog
    Assert-ReleaseEvidenceTreeRedacted -RunRoot $runRoot
  } catch {
    $primaryError = Merge-ErrorRecord $primaryError $_ 'Additionally, diagnostic redaction failed'
  }
  try {
    if (-not $KeepInstall -and $installRootIsTemporary -and (Test-Path -LiteralPath $installRoot)) {
      $resolvedInstall = [System.IO.Path]::GetFullPath($installRoot)
      $tempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
      if (-not $resolvedInstall.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove install directory outside TEMP: $resolvedInstall"
      }
      Remove-Item -LiteralPath $resolvedInstall -Recurse -Force
    }
  } catch {
    $primaryError = Merge-ErrorRecord $primaryError $_ 'Additionally, temporary install cleanup failed'
  }
}
if ($primaryError) {
  try {
    $manifestPath = Write-ReleaseEvidenceFailureManifest -Writer $evidenceWriter -Phase $phase -ErrorText ([string]$primaryError.Exception.Message) -Facts ([ordered]@{
      targetCommit = $targetCommit
      installerSha256 = $installerHash
      modelSha256 = $modelHash
      artifactManifest = if ($provenance) { $provenance.artifactManifest } else { $null }
      logs = @('logs/tauri-driver.log', 'logs/tauri-driver.err.log')
    })
    Assert-ReleaseEvidenceTreeRedacted -RunRoot $runRoot
  } catch {
    $primaryError = Merge-ErrorRecord $primaryError $_ 'Additionally, failure manifest persistence or redaction verification failed'
  }
  throw $primaryError
}
