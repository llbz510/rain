param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath,
  [string]$WhisperModelPath = '',
  [ValidateSet('tiny', 'base', 'small', 'medium', 'large-v3')]
  [string]$WhisperModelSize = 'tiny',
  [string]$OutputRoot = '',
  [string]$InstallDir = '',
  [int]$DriverPort = 4464,
  [int]$NativeDriverPort = 4465,
  [int]$MaxSeconds = 180,
  [switch]$KeepInstall
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Get-Item -LiteralPath (Split-Path -Parent $PSScriptRoot)).FullName
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runRoot = if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  Join-Path $repoRoot "evidence\release-no-nvidia-cpu-$timestamp"
} else {
  [System.IO.Path]::GetFullPath($OutputRoot, $repoRoot)
}
$runRoot = (New-Item -ItemType Directory -Force -Path $runRoot).FullName
$logDir = New-Item -ItemType Directory -Force -Path (Join-Path $runRoot 'logs')
$driverLog = Join-Path $logDir.FullName 'tauri-driver.log'
$driverErrorLog = Join-Path $logDir.FullName 'tauri-driver.err.log'
$installRoot = if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  Join-Path $env:TEMP ("rain-release-install-" + [Guid]::NewGuid().ToString('N'))
} else {
  [System.IO.Path]::GetFullPath($InstallDir)
}
$installRoot = (New-Item -ItemType Directory -Force -Path $installRoot).FullName
$manifestPath = Join-Path $runRoot 'manifest.json'
$asrProofPath = Join-Path $runRoot 'cpu-short-sample.json'
$environmentPath = Join-Path $runRoot 'environment.json'
$artifactPath = Join-Path $runRoot 'artifact.json'

$modelFiles = @{
  tiny = 'ggml-tiny.bin'
  base = 'ggml-base.bin'
  small = 'ggml-small.bin'
  medium = 'ggml-medium.bin'
  'large-v3' = 'ggml-large-v3.bin'
}

function Require-Command([string]$Name, [string]$InstallHint) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "$Name is required for no-NVIDIA CPU evidence. $InstallHint" }
  return $command.Source
}

function Write-JsonFile([string]$Path, $Value) {
  $json = ConvertTo-Json -InputObject $Value -Depth 20
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function Protect-DiagnosticText([string]$Value) {
  if ($null -eq $Value) { return '' }
  $protected = [regex]::Replace($Value, 'sk-[A-Za-z0-9._-]+', '[REDACTED]')
  return [regex]::Replace($protected, '(?i)Bearer\s+[^\s"'']+', 'Bearer [REDACTED]')
}

function Invoke-WebDriver([string]$Method, [string]$Path, $Body = $null) {
  $uri = "http://127.0.0.1:$DriverPort$Path"
  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $uri -TimeoutSec $MaxSeconds
  }
  return Invoke-RestMethod -Method $Method -Uri $uri -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 20) -TimeoutSec $MaxSeconds
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

function Get-PeImportText([string]$Path) {
  $llvmObjdump = Get-Command 'llvm-objdump.exe' -ErrorAction SilentlyContinue
  if ($llvmObjdump) {
    return (& $llvmObjdump.Source -p $Path 2>&1 | Out-String)
  }
  $dumpbin = Get-Command 'dumpbin.exe' -ErrorAction SilentlyContinue
  if ($dumpbin) {
    return (& $dumpbin.Source /imports $Path 2>&1 | Out-String)
  }
  throw 'llvm-objdump.exe or dumpbin.exe is required to inspect PE imports.'
}

function Assert-NoNvidiaEnvironment {
  $videoControllers = @(Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue | ForEach-Object {
    [ordered]@{
      name = [string]$_.Name
      adapterCompatibility = [string]$_.AdapterCompatibility
      driverVersion = [string]$_.DriverVersion
    }
  })
  $nvidiaControllers = @($videoControllers | Where-Object {
    $_.name -match '(?i)nvidia' -or $_.adapterCompatibility -match '(?i)nvidia'
  })
  $nvidiaSmi = Get-Command 'nvidia-smi.exe' -ErrorAction SilentlyContinue
  $systemNvcuda = @(
    (Join-Path $env:SystemRoot 'System32\nvcuda.dll'),
    (Join-Path $env:SystemRoot 'SysWOW64\nvcuda.dll')
  ) | Where-Object { Test-Path -LiteralPath $_ }

  $environment = [ordered]@{
    os = [System.Environment]::OSVersion.VersionString
    machineName = $env:COMPUTERNAME
    videoControllers = @($videoControllers)
    nvidiaControllerCount = $nvidiaControllers.Count
    nvidiaSmiPresent = [bool]$nvidiaSmi
    systemNvcudaDlls = @($systemNvcuda)
    cudaPath = [Environment]::GetEnvironmentVariable('CUDA_PATH', 'Machine')
    cudaHome = [Environment]::GetEnvironmentVariable('CUDA_HOME', 'Machine')
  }
  Write-JsonFile $environmentPath $environment

  if ($nvidiaControllers.Count -gt 0) {
    throw "No-NVIDIA evidence requires zero NVIDIA display adapters; found $($nvidiaControllers.Count)."
  }
  if ($nvidiaSmi) {
    throw "No-NVIDIA evidence requires nvidia-smi.exe to be absent; found $($nvidiaSmi.Source)."
  }
  if ($systemNvcuda.Count -gt 0) {
    throw "No-NVIDIA evidence requires system driver nvcuda.dll to be absent; found $($systemNvcuda -join ', ')."
  }
  return $environment
}

function Install-RainCandidate([string]$Installer, [string]$Destination) {
  $arguments = @('/S', "/D=$Destination")
  $process = Start-Process -FilePath $Installer -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) {
    throw "Rain installer failed with exit code $($process.ExitCode)."
  }
  $binary = Get-ChildItem -LiteralPath $Destination -Recurse -Filter 'rain.exe' -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $binary) {
    throw "Installed rain.exe was not found under $Destination."
  }
  return $binary.FullName
}

function Find-ProbeMedia([string]$InstalledRoot) {
  $sample = Get-ChildItem -LiteralPath $InstalledRoot -Recurse -Filter 'sample.mp4' -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -replace '/', '\' -match 'asr-capability\\sample\.mp4$' } |
    Select-Object -First 1
  if (-not $sample) {
    throw "Bundled ASR probe sample was not found under $InstalledRoot."
  }
  return $sample.FullName
}

function Invoke-TauriCommand([string]$SessionId, [string]$Command, $Args) {
  $argsJson = ConvertTo-Json -InputObject $Args -Depth 20 -Compress
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
  $result = $response.value
  if ($result.ok -ne $true) {
    throw "Tauri command '$Command' failed: $($result.error)"
  }
  return $result.value
}

$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
$installerItem = Get-Item -LiteralPath $installer
$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
$modelHash = $null
$modelPath = $null
if (-not [string]::IsNullOrWhiteSpace($WhisperModelPath)) {
  $modelPath = (Resolve-Path -LiteralPath $WhisperModelPath).Path
  $modelHash = (Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

$sessionId = $null
$driverProcess = $null
$primaryError = $null
$phase = 'bootstrap'
$installedBinary = $null
try {
  $tauriDriver = Require-Command 'tauri-driver' 'Install with: cargo install tauri-driver --version 2.0.6 --locked'
  $edgeDriver = Require-Command 'msedgedriver' 'Install a Microsoft Edge driver matching the local WebView2 runtime.'
  $environment = Assert-NoNvidiaEnvironment

  $phase = 'install'
  $installedBinary = Install-RainCandidate $installer $installRoot
  $installedRoot = Split-Path -Parent $installedBinary
  $probeMedia = Find-ProbeMedia $installedRoot
  $importText = Get-PeImportText $installedBinary
  $forbiddenImports = @('cublas64_12.dll', 'cublasLt64_12.dll', 'cudart64_12.dll', 'nvcuda.dll') |
    Where-Object { $importText -match [regex]::Escape($_) }
  if ($forbiddenImports.Count -gt 0) {
    throw "Rain main executable imports CUDA libraries: $($forbiddenImports -join ', ')"
  }
  Write-JsonFile $artifactPath ([ordered]@{
    installer = @{
      path = $installer
      fileName = $installerItem.Name
      sizeBytes = $installerItem.Length
      sha256 = $installerHash
    }
    installedMainExecutable = @{
      path = $installedBinary
      sha256 = (Get-FileHash -LiteralPath $installedBinary -Algorithm SHA256).Hash.ToLowerInvariant()
      cudaImportsPresent = $false
    }
    installedRoot = $installedRoot
    bundledProbeMedia = $probeMedia
  })

  $phase = 'driver-start'
  $driverProcess = Start-Process -FilePath $tauriDriver -ArgumentList @(
    '--port', [string]$DriverPort,
    '--native-port', [string]$NativeDriverPort,
    '--native-driver', $edgeDriver
  ) -RedirectStandardOutput $driverLog -RedirectStandardError $driverErrorLog -WindowStyle Hidden -PassThru
  Wait-WebDriver

  $phase = 'startup'
  $sessionId = New-WebDriverSession $installedBinary
  Wait-WebDriverCondition $sessionId 'the production video list page' @'
return Boolean(document.querySelector('[data-testid="video-list-page"]'));
'@
  $openedSettings = Invoke-WebDriverScript $sessionId @'
const button = document.querySelector('[data-testid="open-settings"]');
if (!button) return false;
button.click();
return true;
'@
  if ($openedSettings -ne $true) { throw 'Could not open Settings from the installed app.' }
  Wait-WebDriverCondition $sessionId 'Runtime Settings readiness' @'
const page = document.querySelector('[data-testid="settings-page"]');
return page?.getAttribute('data-runtime-settings-status') === 'ready';
'@

  $phase = 'runtime-capability'
  $capability = Invoke-TauriCommand $sessionId 'get_runtime_capability' @{ backendPreference = 'auto' }
  if ($capability.whisperBackend -ne 'cpu') {
    throw "Auto backend did not select CPU on no-NVIDIA evidence host: $($capability | ConvertTo-Json -Compress)"
  }
  if ([string]::IsNullOrWhiteSpace([string]$capability.fallbackReason)) {
    throw 'Auto CPU fallback did not include a visible reason.'
  }
  $phase = 'visible-fallback'
  $preflightStarted = Invoke-WebDriverScript $sessionId @'
const buttons = [...document.querySelectorAll('button')];
const button = buttons.find((candidate) => candidate.textContent?.includes('运行自检'));
if (!button || button.disabled) return false;
button.click();
return true;
'@
  if ($preflightStarted -ne $true) {
    throw 'Could not start the production Runtime Settings preflight.'
  }
  $fallbackReason = [string]$capability.fallbackReason
  Wait-WebDriverCondition $sessionId 'visible Auto CPU fallback reason' @"
const text = document.body?.innerText || '';
return text.includes('Whisper 后端：CPU') && text.includes('$($fallbackReason.Replace('\', '\\').Replace("'", "\'"))');
"@
  $visibleFallbackText = Invoke-WebDriverScript $sessionId @'
return document.body?.innerText || '';
'@

  if (-not $modelPath) {
    $phase = 'model-download'
    $clickedAdd = Invoke-WebDriverScript $sessionId @'
const button = document.querySelector('[data-testid="add-model"]');
if (!button) return false;
button.click();
return true;
'@
    if ($clickedAdd -ne $true) { throw 'Could not open Add Model form.' }
    Wait-WebDriverCondition $sessionId 'Add Model form' @'
return Boolean(document.querySelector('[data-testid="add-model-form"]'));
'@
    $selectedWhisper = Invoke-WebDriverScript $sessionId @"
const form = document.querySelector('[data-testid="add-model-form"]');
const radio = [...form.querySelectorAll('input[type="radio"]')].find((input) => input.value === 'whisper-local');
const select = form.querySelector('select');
if (!radio || !select) return false;
radio.click();
select.value = '$WhisperModelSize';
select.dispatchEvent(new Event('change', { bubbles: true }));
return true;
"@
    if ($selectedWhisper -ne $true) { throw 'Could not select the local Whisper model size.' }
    $startedDownload = Invoke-WebDriverScript $sessionId @'
const button = document.querySelector('[data-testid="whisper-download-action"]');
if (!button || button.disabled) return false;
button.click();
return true;
'@
    if ($startedDownload -ne $true) { throw 'Could not start Whisper model download.' }
    Wait-WebDriverCondition $sessionId 'Whisper model download completion' @'
const status = document.querySelector('[data-testid="whisper-download-status"]');
return Boolean(status?.textContent?.includes('模型已下载'));
'@
    $listed = Invoke-TauriCommand $sessionId 'list_whisper_models' @{}
    $expectedName = $modelFiles[$WhisperModelSize]
    $modelPath = [string](@($listed) | Where-Object { ([string]$_).Replace('/', '\').EndsWith("\$expectedName") } | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($modelPath)) {
      throw "Downloaded model $expectedName was not listed by the installed app."
    }
    $modelHash = (Get-FileHash -LiteralPath $modelPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }

  $phase = 'cpu-short-sample'
  $sentences = Invoke-TauriCommand $sessionId 'start_asr' @{
    videoId = 'rain-release-no-nvidia-cpu-sample'
    filePath = $probeMedia
    tier = 'whisper'
    modelPath = $modelPath
    language = 'en'
    backendPreference = 'auto'
  }
  if (-not ($sentences -is [array]) -or $sentences.Count -le 0) {
    throw 'CPU short sample did not return a non-empty sentence array.'
  }
  $previousEnd = 0.0
  foreach ($sentence in $sentences) {
    if ([string]::IsNullOrWhiteSpace([string]$sentence.text)) {
      throw 'CPU short sample returned a blank sentence.'
    }
    $start = [double]$sentence.start_time
    $end = [double]$sentence.end_time
    if ($start -lt 0 -or $start -ge $end -or $start -lt $previousEnd) {
      throw "CPU short sample timestamps are not monotonic: $($sentence | ConvertTo-Json -Compress)"
    }
    $previousEnd = $end
  }
  Write-JsonFile $asrProofPath ([ordered]@{
    result = 'passed'
    backend = 'cpu'
    fallbackReason = [string]$capability.fallbackReason
    visibleFallbackConfirmed = $true
    visibleFallbackExcerpt = if ($visibleFallbackText.Length -gt 500) { $visibleFallbackText.Substring(0, 500) } else { $visibleFallbackText }
    model = @{
      size = $WhisperModelSize
      path = $modelPath
      sha256 = $modelHash
    }
    probeMedia = @{
      path = $probeMedia
      sha256 = (Get-FileHash -LiteralPath $probeMedia -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    sentenceCount = $sentences.Count
    sentences = @($sentences | Select-Object id, text, start_time, end_time)
  })

  Write-JsonFile $manifestPath ([ordered]@{
    schemaVersion = 1
    evidenceId = Split-Path -Leaf $runRoot
    targetCommit = (git -C $repoRoot rev-parse HEAD)
    installerSha256 = $installerHash
    environment = 'environment.json'
    artifact = 'artifact.json'
    cpuShortSample = 'cpu-short-sample.json'
    logs = @('logs/tauri-driver.log', 'logs/tauri-driver.err.log')
    result = 'passed'
    generatedAt = [DateTimeOffset]::Now.ToString('o')
  })
  Write-Output "NO_NVIDIA_CPU_EVIDENCE_MANIFEST=$manifestPath"
} catch {
  $primaryError = $_
  Write-JsonFile $manifestPath ([ordered]@{
    schemaVersion = 1
    evidenceId = Split-Path -Leaf $runRoot
    targetCommit = (git -C $repoRoot rev-parse HEAD)
    installerSha256 = $installerHash
    phase = $phase
    result = 'failed'
    error = Protect-DiagnosticText ([string]$_.Exception.Message)
    generatedAt = [DateTimeOffset]::Now.ToString('o')
  })
} finally {
  if ($sessionId) {
    try { Close-WebDriverSession $sessionId } catch { }
  }
  if ($driverProcess -and -not $driverProcess.HasExited) {
    Stop-Process -Id $driverProcess.Id -Force -ErrorAction SilentlyContinue
    $driverProcess.WaitForExit(5000) | Out-Null
  }
  if (-not $KeepInstall -and (Test-Path -LiteralPath $installRoot)) {
    $resolvedInstall = [System.IO.Path]::GetFullPath($installRoot)
    $tempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if (-not $resolvedInstall.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove install directory outside TEMP: $resolvedInstall"
    }
    Remove-Item -LiteralPath $resolvedInstall -Recurse -Force -ErrorAction SilentlyContinue
  }
}
if ($primaryError) { throw $primaryError }
