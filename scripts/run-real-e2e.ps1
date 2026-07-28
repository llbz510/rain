param(
  [string]$VideoPath = $env:RAIN_E2E_VIDEO_PATH,
  [string]$WhisperModelPath = $env:RAIN_WHISPER_MODEL_PATH,
  [string]$LlmBaseUrl = $(if ([string]::IsNullOrWhiteSpace($env:RAIN_E2E_LLM_BASE_URL)) { 'https://dashscope.aliyuncs.com/compatible-mode/v1' } else { $env:RAIN_E2E_LLM_BASE_URL }),
  [string]$LlmModel = $(if ([string]::IsNullOrWhiteSpace($env:RAIN_E2E_LLM_MODEL)) { 'qwen3-omni-flash' } else { $env:RAIN_E2E_LLM_MODEL }),
  [string]$EvidenceRoot = 'evidence',
  [ValidateSet('full', 'ui-proof')]
  [string]$RunMode = 'full',
  [string]$ExistingEvidenceManifest = '',
  [int]$DriverPort = 4444,
  [int]$NativeDriverPort = 4445,
  [int]$MaxMinutes = 240,
  [ValidateSet('cuda', 'cpu')]
  [string]$WhisperBackend = $(if ([string]::IsNullOrWhiteSpace($env:RAIN_WHISPER_BACKEND)) { 'cuda' } else { $env:RAIN_WHISPER_BACKEND.ToLowerInvariant() })
)

$ErrorActionPreference = 'Stop'
$expectedHash = '3870B5BD62E574685AC99A8E44295F5E44AC44B76343666742C1C4CA48365F8A'
$localToolPaths = @(
  'D:\gongju\shengcan\rain\.worktrees\.tooling\cargo-bin\bin',
  'D:\gongju\shengcan\rain\.worktrees\.tooling\msedgedriver'
) | Where-Object { Test-Path -LiteralPath $_ }
if ($localToolPaths.Count -gt 0) {
  $currentPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
  [Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
  [Environment]::SetEnvironmentVariable('Path', (($localToolPaths -join [System.IO.Path]::PathSeparator) + [System.IO.Path]::PathSeparator + $currentPath), 'Process')
}

function Write-JsonFile([string]$Path, $Value) {
  $json = ConvertTo-Json -InputObject $Value -Depth 100
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function Redact-Secret([string]$Value) {
  if ($null -eq $Value) { return '' }
  return ($Value -replace 'sk-[A-Za-z0-9._-]+', '[REDACTED]')
}

function Require-Command([string]$Name, [string]$InstallHint) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "$Name is required for real desktop E2E. $InstallHint" }
  return $command.Source
}

function Find-CudaNvcc() {
  $command = Get-Command 'nvcc.exe' -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $localNvcc = 'D:\gongju\shengcan\rain\.worktrees\.tooling\cuda-12.9-redist-root\bin\nvcc.exe'
  if (Test-Path -LiteralPath $localNvcc) { return $localNvcc }
  $cudaRoot = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA'
  if (-not (Test-Path -LiteralPath $cudaRoot)) { return $null }
  $matches = @(Get-ChildItem -LiteralPath $cudaRoot -Filter 'nvcc.exe' -Recurse -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)
  if ($matches.Count -gt 0) { return $matches[0].FullName }
  return $null
}

function Find-Ninja() {
  $command = Get-Command 'ninja.exe' -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $localNinja = 'D:\gongju\shengcan\rain\.worktrees\.tooling\ninja\ninja.exe'
  if (Test-Path -LiteralPath $localNinja) { return $localNinja }
  return $null
}

function Find-VcVars64() {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path -LiteralPath $vswhere) {
    $installation = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($installation)) {
      $candidate = Join-Path ([string]$installation) 'VC\Auxiliary\Build\vcvars64.bat'
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
  }
  $fallback = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
  if (Test-Path -LiteralPath $fallback) { return $fallback }
  return $null
}

function Quote-CmdArg([string]$Value) {
  return '"' + ($Value -replace '"', '""') + '"'
}

function Invoke-BuildCommand([string]$FilePath, [string[]]$Arguments, [string]$VcVarsPath = '') {
  if ([string]::IsNullOrWhiteSpace($VcVarsPath)) {
    & $FilePath @Arguments
    return
  }
  $argumentText = ($Arguments | ForEach-Object { Quote-CmdArg ([string]$_) }) -join ' '
  $commandLine = 'call ' + (Quote-CmdArg $VcVarsPath) + ' >nul && ' + (Quote-CmdArg $FilePath) + ' ' + $argumentText
  & cmd.exe /d /s /c $commandLine
  return
}

function Find-RealVideo() {
  if (-not [string]::IsNullOrWhiteSpace($VideoPath)) { return (Resolve-Path -LiteralPath $VideoPath).Path }
  $root = 'D:\xiazaiwenjian\bilidown'
  if (-not (Test-Path -LiteralPath $root)) { throw 'VideoPath is required; default bilidown root was not found.' }
  $candidates = Get-ChildItem -LiteralPath $root -Recurse -File -Filter '1.2.1*.mp4' -ErrorAction Stop
  foreach ($candidate in $candidates) {
    $hash = (Get-FileHash -LiteralPath $candidate.FullName -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($hash -eq $expectedHash) { return $candidate.FullName }
  }
  throw 'Could not locate the required MP4 by SHA256. Pass -VideoPath explicitly.'
}

function Find-WhisperModel() {
  if ($WhisperModelPath -and (Test-Path -LiteralPath $WhisperModelPath)) { return (Resolve-Path -LiteralPath $WhisperModelPath).Path }
  $candidates = @(
    'C:\Users\24627\AppData\Roaming\com.rain.app\whisper-models\ggml-large-v3.bin',
    'C:\Users\24627\AppData\Local\com.rain.app\whisper-models\ggml-large-v3.bin',
    'D:\gongju\shengcan\rain\models\ggml-large-v3.bin'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  throw 'Whisper large-v3 model not found. Set RAIN_WHISPER_MODEL_PATH to ggml-large-v3.bin.'
}

function Wait-WebDriver([int]$Port) {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    try {
      Invoke-RestMethod -Uri "http://127.0.0.1:$Port/status" -Method Get -TimeoutSec 2 | Out-Null
      return
    } catch {
      Start-Sleep -Milliseconds 500
    }
  } while ((Get-Date) -lt $deadline)
  throw 'tauri-driver did not become ready on time.'
}

function Invoke-WebDriver([string]$Method, [string]$Path, $Body = $null) {
  $uri = "http://127.0.0.1:$DriverPort$Path"
  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $uri -TimeoutSec 180
  }
  return Invoke-RestMethod -Method $Method -Uri $uri -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 20) -TimeoutSec 180
}

function New-WebDriverSession([string]$ApplicationPath) {
  $body = @{
    capabilities = @{
      alwaysMatch = @{
        browserName = 'wry'
        'tauri:options' = @{ application = $ApplicationPath }
      }
    }
  }
  $response = Invoke-WebDriver 'Post' '/session' $body
  if ($response.value.sessionId) { return $response.value.sessionId }
  if ($response.sessionId) { return $response.sessionId }
  throw 'Could not create WebDriver session.'
}

function Invoke-WebDriverScript([string]$SessionId, [string]$Script) {
  $response = Invoke-WebDriver 'Post' "/session/$SessionId/execute/sync" @{ script = $Script; args = @() }
  return $response.value
}

function Save-WebDriverScreenshot([string]$SessionId, [string]$Path) {
  $response = Invoke-WebDriver 'Get' "/session/$SessionId/screenshot"
  $base64 = if ($response.value) { $response.value } else { $response }
  [System.IO.File]::WriteAllBytes($Path, [Convert]::FromBase64String([string]$base64))
}

$existingManifest = $null
if ($RunMode -eq 'ui-proof') {
  if ([string]::IsNullOrWhiteSpace($ExistingEvidenceManifest)) { throw 'ExistingEvidenceManifest is required for ui-proof mode.' }
  $manifestPath = (Resolve-Path -LiteralPath $ExistingEvidenceManifest).Path
  $existingManifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([int]$existingManifest.schemaVersion -ne 2) { throw 'ui-proof mode requires a schema v2 manifest.' }
  $video = (Resolve-Path -LiteralPath ([string]$existingManifest.video.path)).Path
  $LlmBaseUrl = [string]$existingManifest.runtime.llmBaseUrl
  $LlmModel = [string]$existingManifest.runtime.llmModel
  $WhisperBackend = [string]$existingManifest.runtime.whisperBackend
  $llmApiKey = ''
} else {
  $llmApiKey = $env:RAIN_E2E_LLM_API_KEY
  if ([string]::IsNullOrWhiteSpace($llmApiKey)) { $llmApiKey = $env:RAIN_QWEN_API_KEY }
  if ([string]::IsNullOrWhiteSpace($llmApiKey)) { throw 'RAIN_E2E_LLM_API_KEY is required for live LLM evidence.' }
  $video = Find-RealVideo
}
if ([string]::IsNullOrWhiteSpace($LlmBaseUrl) -or $LlmBaseUrl -notmatch '^https?://') { throw 'LlmBaseUrl must be an absolute HTTP(S) URL.' }
if ([string]::IsNullOrWhiteSpace($LlmModel)) { throw 'LlmModel is required for live LLM evidence.' }
$modelPath = Find-WhisperModel
$hash = (Get-FileHash -LiteralPath $video -Algorithm SHA256).Hash.ToUpperInvariant()
if ($hash -ne $expectedHash) { throw "Unexpected video hash: $hash" }

$tauriDriver = Require-Command 'tauri-driver' 'Install with: cargo install tauri-driver --locked'
$edgeDriver = Require-Command 'msedgedriver' 'Install a matching Microsoft Edge driver or use msedgedriver-tool.'
$ffprobe = Require-Command 'ffprobe' 'Install ffmpeg/ffprobe and add them to PATH.'

$selectedWhisperBackend = $WhisperBackend.ToLowerInvariant()
$vcVarsForBuild = ''
if ($selectedWhisperBackend -eq 'cuda') {
  $nvcc = Find-CudaNvcc
  if ([string]::IsNullOrWhiteSpace($nvcc)) {
    throw 'Whisper GPU was requested, but CUDA Toolkit nvcc.exe was not found. Install CUDA Toolkit 12.x or set PATH to its bin directory; the NVIDIA display driver alone is not enough to compile whisper.cpp CUDA.'
  }
  $cudaBin = Split-Path -Parent $nvcc
  $cudaRoot = Split-Path -Parent $cudaBin
  $cudaLib = Join-Path $cudaRoot 'lib\x64'
  $cudaNvvmBin = Join-Path $cudaRoot 'nvvm\bin'
  $env:CUDA_PATH = $cudaRoot
  $env:CUDA_HOME = $cudaRoot
  $env:CUDAToolkit_ROOT = $cudaRoot
  $env:CUDACXX = $nvcc
  $env:CMAKE_CUDA_COMPILER = $nvcc
  $ninja = Find-Ninja
  if ([string]::IsNullOrWhiteSpace($ninja)) {
    throw 'Whisper GPU was requested, but ninja.exe was not found. Put ninja.exe at D:\gongju\shengcan\rain\.worktrees\.tooling\ninja\ninja.exe or add it to PATH.'
  }
  $env:CMAKE_GENERATOR = 'Ninja'
  $env:CMAKE_MAKE_PROGRAM = $ninja
  $currentPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
  $cudaPathEntries = @($cudaBin, $cudaLib, $cudaNvvmBin, (Split-Path -Parent $ninja)) | Where-Object { Test-Path -LiteralPath $_ }
  [array]::Reverse($cudaPathEntries)
  foreach ($entry in $cudaPathEntries) {
    if ($currentPath -notlike "*$entry*") { $currentPath = $entry + [System.IO.Path]::PathSeparator + $currentPath }
  }
  [Environment]::SetEnvironmentVariable('Path', $currentPath, 'Process')
  if (-not (Get-Command 'cl.exe' -ErrorAction SilentlyContinue)) {
    $vcVarsForBuild = Find-VcVars64
    if ([string]::IsNullOrWhiteSpace($vcVarsForBuild)) {
      throw 'Whisper GPU was requested, but MSVC vcvars64.bat was not found. Install Visual Studio 2022 Build Tools with the C++ workload.'
    }
  }
}

if ($RunMode -eq 'ui-proof') {
  $evidenceId = [string]$existingManifest.evidenceId
  $root = Get-Item -LiteralPath (Split-Path -Parent $manifestPath)
} else {
  $runId = Get-Date -Format 'yyyyMMdd-HHmmss'
  $evidenceId = "rain-real-e2e-$runId"
  $root = New-Item -ItemType Directory -Force -Path (Join-Path $EvidenceRoot $evidenceId)
}
$tmp = New-Item -ItemType Directory -Force -Path (Join-Path $root.FullName 'tmp')
$dbPath = Join-Path $root.FullName 'rain-e2e.db'
$screenshots = New-Item -ItemType Directory -Force -Path (Join-Path $root.FullName 'screenshots')
$logs = New-Item -ItemType Directory -Force -Path (Join-Path $root.FullName 'logs')

$env:RAIN_TEMP_DIR = $tmp.FullName
$env:RAIN_E2E_MODE = '1'
$env:RAIN_E2E_BUILD = '1'
$env:RAIN_E2E_RUN_MODE = $RunMode
$env:RAIN_E2E_VIDEO_PATH = $video
$env:RAIN_E2E_WHISPER_MODEL_PATH = $modelPath
$env:RAIN_E2E_DB_PATH = $dbPath
$env:RAIN_E2E_EVIDENCE_ID = $evidenceId
$env:RAIN_E2E_LLM_BASE_URL = $LlmBaseUrl.TrimEnd('/')
$env:RAIN_E2E_LLM_MODEL = $LlmModel
$env:RAIN_E2E_LLM_API_KEY = $llmApiKey
$env:LIBCLANG_PATH = if ($env:LIBCLANG_PATH) { $env:LIBCLANG_PATH } else { 'C:\Program Files\LLVM\bin' }
$env:CMAKE_CXX_FLAGS = '/utf-8'
$env:CMAKE_C_FLAGS = '/utf-8'
$env:CARGO_TARGET_DIR = if ($selectedWhisperBackend -eq 'cuda') { 'D:\gongju\shengcan\rain\.worktrees\.cargo-target-rain-real-e2e-cuda' } else { 'D:\gongju\shengcan\rain\.worktrees\.cargo-target-rain-real-e2e' }

$probePath = Join-Path $root.FullName 'probe.json'
$probeRaw = & $ffprobe -v error -print_format json -show_format -show_streams $video
[System.IO.File]::WriteAllText($probePath, $probeRaw, [System.Text.UTF8Encoding]::new($false))

$npmCmd = (Get-Command 'npm.cmd' -ErrorAction Stop).Source
& $npmCmd run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
$tauriBuildArgs = @('run', 'tauri', '--', 'build', '--debug', '--no-bundle')
if ($selectedWhisperBackend -eq 'cuda') { $tauriBuildArgs += @('--features', 'cuda-whisper') }
Invoke-BuildCommand $npmCmd $tauriBuildArgs $vcVarsForBuild
if ($LASTEXITCODE -ne 0) { throw 'Tauri debug build failed' }
$appBinary = Join-Path $env:CARGO_TARGET_DIR 'debug\rain.exe'
if (-not (Test-Path -LiteralPath $appBinary)) { throw "Rain debug binary not found: $appBinary" }

$driverLogName = if ($RunMode -eq 'ui-proof') { 'tauri-driver.ui-proof.log' } else { 'tauri-driver.log' }
$driverErrName = if ($RunMode -eq 'ui-proof') { 'tauri-driver.ui-proof.err.log' } else { 'tauri-driver.err.log' }
$driverLog = Join-Path $logs.FullName $driverLogName
$driverErr = Join-Path $logs.FullName $driverErrName
$driverArgs = @('--port', [string]$DriverPort, '--native-port', [string]$NativeDriverPort, '--native-driver', $edgeDriver)
$driverProcess = Start-Process -FilePath $tauriDriver -ArgumentList $driverArgs -RedirectStandardOutput $driverLog -RedirectStandardError $driverErr -WindowStyle Hidden -PassThru
$sessionId = $null
try {
  Wait-WebDriver $DriverPort
  $sessionId = New-WebDriverSession $appBinary
  Invoke-WebDriverScript $sessionId 'window.__RAIN_E2E_START__ = true; return true' | Out-Null
  $deadline = (Get-Date).AddMinutes($MaxMinutes)
  $lastStatus = $null
  do {
    $value = Invoke-WebDriverScript $sessionId 'return window.__RAIN_E2E_RESULT__ || null'
    if ($null -ne $value) {
      $lastStatus = [string]$value.status
      if ($lastStatus -eq 'passed') { break }
      if ($lastStatus -eq 'failed') { throw (Redact-Secret ([string]$value.error)) }
    }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $deadline)
  if ($lastStatus -ne 'passed') { throw "Rain E2E did not finish before timeout. lastStatus=$lastStatus" }

  $result = Invoke-WebDriverScript $sessionId 'return window.__RAIN_E2E_RESULT__'
  $uiState = Invoke-WebDriverScript $sessionId @'
const study = document.querySelector('[data-testid="study-interface"]');
const player = document.querySelector('[data-testid="video-player"]');
const paragraphs = document.querySelectorAll('[data-testid^="paragraph-"]');
return {
  source: 'rain-webdriver-dom',
  page: study ? 'study' : 'other',
  videoId: window.__RAIN_E2E_RESULT__?.videoId || '',
  studyInterfaceVisible: Boolean(study && study.getBoundingClientRect().width > 0 && study.getBoundingClientRect().height > 0),
  videoPlayerVisible: Boolean(player && player.getBoundingClientRect().width > 0 && player.getBoundingClientRect().height > 0),
  paragraphCount: paragraphs.length,
  capturedAt: new Date().toISOString()
};
'@
  if ($uiState.page -ne 'study' -or $uiState.studyInterfaceVisible -ne $true -or $uiState.videoPlayerVisible -ne $true -or [int]$uiState.paragraphCount -le 0) {
    throw 'Production study UI was not ready for evidence capture.'
  }
  $readyScreenshot = Join-Path $screenshots.FullName 'study-ready.png'
  Save-WebDriverScreenshot $sessionId $readyScreenshot

  Write-JsonFile (Join-Path $root.FullName 'ui-state.json') $uiState

  if ($RunMode -eq 'ui-proof') {
    $appEventsPath = Join-Path $root.FullName ([string]$existingManifest.artifacts.appEvents)
    $existingEvents = @(
      Get-Content -LiteralPath $appEventsPath -Raw -Encoding UTF8 |
        ConvertFrom-Json |
        Where-Object { $_.PSObject.Properties.Name -contains 'event' }
    )
    if ($existingEvents.Count -eq 0) {
      $restartProofPath = Join-Path $root.FullName ([string]$existingManifest.restart.artifact)
      $restartProof = Get-Content -LiteralPath $restartProofPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $existingEvents = @($restartProof.events | ForEach-Object {
        [pscustomobject]@{ event = [string]$_; recoveredFrom = [string]$existingManifest.restart.artifact }
      })
      $existingManifest | Add-Member -NotePropertyName appEventsRecoveredFrom -NotePropertyValue ([string]$existingManifest.restart.artifact) -Force
    }
    $combinedEvents = [object[]](@($existingEvents) + @($result.events))
    Write-JsonFile -Path $appEventsPath -Value $combinedEvents
    if ($null -eq $existingManifest.artifacts.uiState) {
      $existingManifest.artifacts | Add-Member -NotePropertyName uiState -NotePropertyValue 'ui-state.json'
    }
    $existingManifest.artifacts | Add-Member -NotePropertyName cudaRuntimeLog -NotePropertyValue "logs/$driverErrName" -Force
    $existingManifest | Add-Member -NotePropertyName uiCapturedAt -NotePropertyValue ([string]$uiState.capturedAt) -Force
    $existingManifest | Add-Member -NotePropertyName evidencePhases -NotePropertyValue ([ordered]@{
      pipelineGeneratedAt = [string]$existingManifest.generatedAt
      uiProofCapturedAt = [string]$uiState.capturedAt
      cudaProof = 'ui-proof-asr-capability'
    }) -Force
    Write-JsonFile $manifestPath $existingManifest
  } else {
    Write-JsonFile (Join-Path $root.FullName 'transcript.json') $result.transcript
    Write-JsonFile (Join-Path $root.FullName 'structuring-blocks.json') @($result.structuringBlocks)
    Write-JsonFile (Join-Path $root.FullName 'database-summary.json') $result.database
    Write-JsonFile (Join-Path $root.FullName 'cancellation-proof.json') $result.cancellation
    Write-JsonFile (Join-Path $root.FullName 'restart-proof.json') $result.restart
    Write-JsonFile (Join-Path $root.FullName 'app-events.json') @($result.events)
    Write-JsonFile (Join-Path $root.FullName 'capabilities.json') $result.capabilities
    Write-JsonFile (Join-Path $root.FullName 'runtime-gates.json') $result.runtimeGates

    $sentences = @($result.transcript.sentences)
    $manualSamples = @($sentences | Select-Object -First 10)
    $manifest = [ordered]@{
      schemaVersion = 2
      evidenceId = $evidenceId
      generatedAt = (Get-Date).ToUniversalTime().ToString('o')
      video = @{ path = $video; sha256 = $hash; probe = 'probe.json' }
      databasePath = $dbPath
      runtime = $result.runtime
      timings = $result.timings
      asr = @{ detectedLanguage = $result.transcript.detectedLanguage; sentenceCount = $sentences.Count; manualReviewSamples = $manualSamples }
      structuring = @{ blockCount = @($result.structuringBlocks).Count }
      validation = @{ sentenceCoverage = 'computed-by-validator'; noDemoSentences = 'computed-by-validator'; noDemoIds = 'computed-by-validator' }
      cancellation = @{ result = 'passed'; artifact = 'cancellation-proof.json' }
      restart = @{ result = 'passed'; artifact = 'restart-proof.json' }
      secretsDetected = $false
      artifacts = @{
        transcript = 'transcript.json'
        structuringBlocks = 'structuring-blocks.json'
        database = 'database-summary.json'
        probe = 'probe.json'
        screenshots = @('screenshots/study-ready.png')
        appEvents = 'app-events.json'
        capabilities = 'capabilities.json'
        runtimeGates = 'runtime-gates.json'
        uiState = 'ui-state.json'
        cudaRuntimeLog = 'logs/tauri-driver.err.log'
      }
    }
    $manifestPath = Join-Path $root.FullName 'manifest.json'
    Write-JsonFile $manifestPath $manifest
  }
  & powershell.exe -ExecutionPolicy Bypass -File scripts/validate-evidence.ps1 -EvidenceManifest $manifestPath -ExpectedWhisperBackend $selectedWhisperBackend
  if ($LASTEXITCODE -ne 0) { throw 'Evidence validation failed' }
  Write-Output "EVIDENCE_MANIFEST=$manifestPath"
} finally {
  if ($sessionId) {
    try { Invoke-WebDriver 'Delete' "/session/$sessionId" | Out-Null } catch { }
  }
  if ($driverProcess -and -not $driverProcess.HasExited) {
    try { Stop-Process -Id $driverProcess.Id -Force } catch { }
  }
}
