param(
  [ValidateSet('debug', 'release')]
  [string]$Configuration = 'release',
  [string]$OutputRoot = '',
  [string]$ProjectRoot = '',
  [string]$CudaRoot = '',
  [string]$NinjaPath = '',
  [string]$CmakePath = '',
  [string]$VcVarsPath = '',
  [string]$CargoPath = '',
  [string]$LlvmBinPath = '',
  [string]$WorkerTargetRoot = '',
  [string]$WorkerInvocationId = '',
  [switch]$PruneWorkerTarget,
  [switch]$AssertPruneOwnershipOnly,
  [switch]$AssertOwnershipCreationOnly,
  $OwnershipMarkerAdapter = $null
)

$ErrorActionPreference = 'Stop'

function Resolve-WorkerFile([string]$Path, [string]$Description) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Description does not exist: $Path"
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

function Resolve-WorkerDirectory([string]$Path, [string]$Description) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "$Description does not exist: $Path"
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

function Get-WorkerAbsolutePath([string]$Path, [string]$BasePath) {
  if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Path must not be blank.' }
  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $BasePath $Path))
}

function Test-WorkerChildPath([string]$Path, [string]$Parent) {
  $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/')
  $pathFull = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
  return $pathFull.StartsWith($parentFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Find-CudaNvcc([string]$ConfiguredCudaRoot) {
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredCudaRoot)) {
    $cudaRoot = Resolve-WorkerDirectory $ConfiguredCudaRoot 'Configured CUDA root'
    return Resolve-WorkerFile (Join-Path $cudaRoot 'bin\nvcc.exe') 'Configured CUDA nvcc.exe'
  }

  $command = Get-Command 'nvcc.exe' -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  if (-not [string]::IsNullOrWhiteSpace($env:CUDA_PATH)) {
    $candidate = Join-Path $env:CUDA_PATH 'bin\nvcc.exe'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  return $null
}

function Find-Ninja([string]$ConfiguredNinjaPath) {
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredNinjaPath)) {
    return Resolve-WorkerFile $ConfiguredNinjaPath 'Configured Ninja executable'
  }
  $command = Get-Command 'ninja.exe' -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

function Find-Cmake([string]$ConfiguredCmakePath) {
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredCmakePath)) {
    return Resolve-WorkerFile $ConfiguredCmakePath 'Configured CMake executable'
  }
  foreach ($name in @('cmake.exe', 'cmake')) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
  }
  return $null
}

function Assert-WorkerCmakeVersion([string]$CmakeExecutable) {
  $cmakeText = (& $CmakeExecutable --version 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "CMake version probe failed with exit code $LASTEXITCODE."
  }
  $versionText = [regex]::Match($cmakeText, '\d+(?:\.\d+){2}').Value
  if ([string]::IsNullOrWhiteSpace($versionText) -or [version]$versionText -ne [version]'4.0.0') {
    throw "Pinned CMake 4.0.0 is required to build the Rain CUDA worker; observed $versionText."
  }
  return $versionText
}

function Find-VcVars64([string]$ConfiguredVcVarsPath) {
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredVcVarsPath)) {
    return Resolve-WorkerFile $ConfiguredVcVarsPath 'Configured Visual Studio vcvars64.bat'
  }
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (Test-Path -LiteralPath $vswhere) {
    $installation = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($installation)) {
      $candidate = Join-Path ([string]$installation) 'VC\Auxiliary\Build\vcvars64.bat'
      if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
  }
  return $null
}

function Find-Cargo([string]$ConfiguredCargoPath) {
  if (-not [string]::IsNullOrWhiteSpace($ConfiguredCargoPath)) {
    return Resolve-WorkerFile $ConfiguredCargoPath 'Configured Cargo executable'
  }
  return (Get-Command 'cargo.exe' -ErrorAction Stop).Source
}

function Quote-CmdArg([string]$Value) {
  return '"' + ($Value -replace '"', '""') + '"'
}

function Find-CudaRuntimeDll([string]$ResolvedCudaRoot, [string]$Name) {
  $direct = Join-Path $ResolvedCudaRoot "bin\$Name"
  if (Test-Path -LiteralPath $direct) { return (Resolve-Path -LiteralPath $direct).Path }
  $matches = @(
    Get-ChildItem -LiteralPath $ResolvedCudaRoot -Filter $Name -Recurse -File -ErrorAction SilentlyContinue |
      Sort-Object -Property FullName
  )
  if ($matches.Count -gt 0) { return $matches[0].FullName }
  throw "Required CUDA redistributable was not found: $Name under $ResolvedCudaRoot"
}

function Get-WorkerTargetOwnershipMarkerPath([string]$WorkerTarget) {
  return Join-Path $WorkerTarget '.rain-controlled-worker-ownership.json'
}

function Assert-WorkerInvocationId([string]$InvocationId) {
  if ($InvocationId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{3,127}$') {
    throw 'WorkerInvocationId must be a 4-128 character controlled invocation identifier.'
  }
  return $InvocationId
}

function Assert-WorkerTargetCanBePruned([string]$WorkerTarget, [string]$ResolvedProjectRoot, [string]$StageRoot, [string]$InvocationId) {
  $target = [System.IO.Path]::GetFullPath($WorkerTarget).TrimEnd('\', '/')
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
  if (-not (Test-WorkerChildPath $target $tempRoot)) {
    throw "Worker target pruning is only allowed below the operating-system TEMP directory: $target"
  }
  if ($target.Equals([System.IO.Path]::GetFullPath($StageRoot).TrimEnd('\', '/'), [System.StringComparison]::OrdinalIgnoreCase) -or
      (Test-WorkerChildPath $StageRoot $target)) {
    throw "Worker target pruning must not remove the staged payload: $target"
  }
  $normalizedInvocationId = Assert-WorkerInvocationId $InvocationId
  $markerPath = Get-WorkerTargetOwnershipMarkerPath $target
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
    throw "Worker target pruning requires the same-invocation ownership marker: $markerPath"
  }
  try {
    $marker = Get-Content -LiteralPath $markerPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Worker target ownership marker is not valid JSON: $($_.Exception.Message)"
  }
  if ([int]$marker.schemaVersion -ne 1 -or
      [string]$marker.invocationId -ne $normalizedInvocationId -or
      [System.IO.Path]::GetFullPath([string]$marker.workerTargetRoot).TrimEnd('\', '/') -ne $target) {
    throw 'Worker target pruning requires a same-invocation ownership marker for this exact target root.'
  }
  return $target
}

function New-WorkerOwnershipMarkerAdapter {
  return [pscustomobject]@{
    createDirectory = { param([string]$Path) New-Item -ItemType Directory -Path $Path -ErrorAction Stop | Out-Null }
    writeText = { param([string]$Path, [string]$Text) [System.IO.File]::WriteAllText($Path, $Text, [System.Text.UTF8Encoding]::new($false)) }
    publish = { param([string]$Source, [string]$Destination) [System.IO.File]::Move($Source, $Destination) }
    removeTemporary = { param([string]$Path) Remove-Item -LiteralPath $Path -Force -ErrorAction Stop }
    removeTarget = { param([string]$Path) Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop }
  }
}

function Resolve-WorkerOwnershipMarkerAdapter($Adapter) {
  if ($null -eq $Adapter) { return New-WorkerOwnershipMarkerAdapter }
  foreach ($method in @('createDirectory', 'writeText', 'publish', 'removeTemporary', 'removeTarget')) {
    if (-not ($Adapter.PSObject.Properties.Name -contains $method) -or $Adapter.$method -isnot [scriptblock]) {
      throw "Worker ownership-marker adapter '$method' must be a script block."
    }
  }
  return $Adapter
}

function New-WorkerTargetOwnershipMarker([string]$WorkerTarget, [string]$InvocationId, $Adapter) {
  $target = [System.IO.Path]::GetFullPath($WorkerTarget).TrimEnd('\', '/')
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
  if (-not (Test-WorkerChildPath $target $tempRoot)) {
    throw "Prunable worker target must be a unique child of the operating-system TEMP directory: $target"
  }
  $normalizedInvocationId = Assert-WorkerInvocationId $InvocationId
  if (Test-Path -LiteralPath $target) {
    throw "Prunable worker target must be newly created by this invocation, not reused: $target"
  }
  $operations = Resolve-WorkerOwnershipMarkerAdapter $Adapter
  & $operations.createDirectory $target
  $markerPath = Get-WorkerTargetOwnershipMarkerPath $target
  $temporary = Join-Path $target ('.' + [Guid]::NewGuid().ToString('N') + '.tmp')
  $markerError = $null
  $cleanupErrors = [System.Collections.Generic.List[string]]::new()
  try {
    $markerJson = ConvertTo-Json -InputObject ([ordered]@{
      schemaVersion = 1
      invocationId = $normalizedInvocationId
      workerTargetRoot = $target
    }) -Depth 4
    & $operations.writeText $temporary $markerJson
    & $operations.publish $temporary $markerPath
  } catch {
    $markerError = $_
  } finally {
    if (Test-Path -LiteralPath $temporary) {
      try { & $operations.removeTemporary $temporary } catch { [void]$cleanupErrors.Add("marker temporary cleanup failed: $($_.Exception.Message)") }
    }
    if ($null -ne $markerError -and (Test-Path -LiteralPath $target)) {
      try { & $operations.removeTarget $target } catch { [void]$cleanupErrors.Add("owned worker target cleanup failed: $($_.Exception.Message)") }
    }
  }
  if ($null -ne $markerError) {
    $message = "Worker ownership marker creation failed: $($markerError.Exception.Message)"
    if ($cleanupErrors.Count -gt 0) { $message += "; additionally, $($cleanupErrors -join '; ')" }
    throw $message
  }
  return $target
}

$defaultProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$projectRoot = if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $defaultProjectRoot
} else {
  Resolve-WorkerDirectory $ProjectRoot 'Project root'
}
$manifestPath = Join-Path $projectRoot 'src-tauri\Cargo.toml'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Rain Cargo manifest does not exist under project root: $manifestPath"
}
$projectTargetRoot = Join-Path $projectRoot 'src-tauri\target'
$workerTarget = if ([string]::IsNullOrWhiteSpace($WorkerTargetRoot)) {
  Join-Path $projectTargetRoot 'whisper-gpu-worker'
} else {
  Get-WorkerAbsolutePath $WorkerTargetRoot $projectRoot
}
$stageRoot = if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  Join-Path $projectTargetRoot 'whisper-gpu-bundle\whisper-backends'
} else {
  Get-WorkerAbsolutePath $OutputRoot $projectRoot
}
if ($workerTarget.Equals($stageRoot, [System.StringComparison]::OrdinalIgnoreCase) -or (Test-WorkerChildPath $stageRoot $workerTarget)) {
  throw 'Worker target root must not contain the staged payload root.'
}

if ($AssertPruneOwnershipOnly) {
  if (-not $PruneWorkerTarget) { throw '-AssertPruneOwnershipOnly requires -PruneWorkerTarget.' }
  [void](Assert-WorkerTargetCanBePruned $workerTarget $projectRoot $stageRoot $WorkerInvocationId)
  Write-Output 'Worker target ownership is valid for controlled pruning.'
  return
}

$ownedPrunableWorkerTarget = $false
if ($PruneWorkerTarget) {
  if ($env:GITHUB_ACTIONS -ne 'true') {
    throw '-PruneWorkerTarget is restricted to a GitHub Actions controlled build.'
  }
  $workerTarget = New-WorkerTargetOwnershipMarker $workerTarget $WorkerInvocationId $OwnershipMarkerAdapter
  $ownedPrunableWorkerTarget = $true
}

if ($AssertOwnershipCreationOnly) {
  if (-not $PruneWorkerTarget) { throw '-AssertOwnershipCreationOnly requires -PruneWorkerTarget.' }
  $ownershipSeamCleanupError = $null
  try {
    [void](Assert-WorkerTargetCanBePruned $workerTarget $projectRoot $stageRoot $WorkerInvocationId)
    Remove-Item -LiteralPath $workerTarget -Recurse -Force -ErrorAction Stop
  } catch {
    $ownershipSeamCleanupError = $_
  }
  if ($null -ne $ownershipSeamCleanupError) {
    throw "Worker ownership creation seam cleanup failed: $($ownershipSeamCleanupError.Exception.Message)"
  }
  Write-Output 'Worker target ownership marker creation and cleanup completed.'
  return
}

$workerBuildError = $null
$workerCleanupError = $null
try {
$nvcc = Find-CudaNvcc $CudaRoot
if ([string]::IsNullOrWhiteSpace($nvcc)) {
  throw 'CUDA Toolkit 12.x nvcc.exe is required to build the Rain CUDA worker.'
}
$cudaBin = Split-Path -Parent $nvcc
$cudaRoot = Split-Path -Parent $cudaBin
$ninja = Find-Ninja $NinjaPath
if ([string]::IsNullOrWhiteSpace($ninja)) {
  throw 'ninja.exe is required to build the Rain CUDA worker.'
}
$cmake = Find-Cmake $CmakePath
if ([string]::IsNullOrWhiteSpace($cmake)) {
  throw 'CMake 4 or newer is required to build the Rain CUDA worker.'
}
$cmakeVersion = Assert-WorkerCmakeVersion $cmake
$vcVars = Find-VcVars64 $VcVarsPath
if ([string]::IsNullOrWhiteSpace($vcVars)) {
  throw 'Visual Studio 2022 C++ Build Tools are required to build the Rain CUDA worker.'
}
$cargo = Find-Cargo $CargoPath
$llvmBin = if ([string]::IsNullOrWhiteSpace($LlvmBinPath)) {
  if (-not [string]::IsNullOrWhiteSpace($env:LIBCLANG_PATH)) { $env:LIBCLANG_PATH } else { 'C:\Program Files\LLVM\bin' }
} else {
  Resolve-WorkerDirectory $LlvmBinPath 'Configured LLVM bin directory'
}
if (-not (Test-Path -LiteralPath $llvmBin -PathType Container)) {
  throw "LLVM libclang directory does not exist: $llvmBin"
}

$env:CUDA_PATH = $cudaRoot
$env:CUDA_HOME = $cudaRoot
$env:CUDAToolkit_ROOT = $cudaRoot
$env:CUDACXX = $nvcc
$env:CMAKE_CUDA_COMPILER = $nvcc
$env:CMAKE_GENERATOR = 'Ninja'
$env:CMAKE_MAKE_PROGRAM = $ninja
# NVIDIA lists GeForce RTX 5060 Ti as compute capability 12.0; CMake uses 120.
$env:CMAKE_CUDA_ARCHITECTURES = '120'
$env:LIBCLANG_PATH = $llvmBin
$env:CMAKE_CXX_FLAGS = '/utf-8'
$env:CMAKE_C_FLAGS = '/utf-8'
# CMAKE_ROOT is CMake's internal module root; the cmake crate maps CMAKE_* environment values to -D arguments.
Remove-Item -LiteralPath Env:CMAKE_ROOT -ErrorAction SilentlyContinue

$pathEntries = @($cudaBin, (Join-Path $cudaRoot 'lib\x64'), (Join-Path $cudaRoot 'nvvm\bin'), (Split-Path -Parent $ninja), (Split-Path -Parent $cmake), $llvmBin) |
  Where-Object { Test-Path -LiteralPath $_ }
$processPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
foreach ($entry in $pathEntries) {
  if ($processPath -notlike "*$entry*") {
    $processPath = $entry + [System.IO.Path]::PathSeparator + $processPath
  }
}
[Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')

$cargoArgs = @(
  'build',
  '--locked',
  '--manifest-path', $manifestPath,
  '--bin', 'rain-whisper-cuda',
  '--features', 'cuda-whisper',
  '--target-dir', $workerTarget
)
if ($Configuration -eq 'release') { $cargoArgs += '--release' }
$argumentText = ($cargoArgs | ForEach-Object { Quote-CmdArg ([string]$_) }) -join ' '
$commandLine = 'call ' + (Quote-CmdArg $vcVars) + ' >nul && ' + (Quote-CmdArg $cargo) + ' ' + $argumentText
& cmd.exe /d /s /c $commandLine
if ($LASTEXITCODE -ne 0) { throw "CUDA worker build failed with exit code $LASTEXITCODE" }

$profile = if ($Configuration -eq 'release') { 'release' } else { 'debug' }
$workerBinary = Join-Path $workerTarget "$profile\rain-whisper-cuda.exe"
if (-not (Test-Path -LiteralPath $workerBinary)) {
  throw "CUDA worker binary was not produced: $workerBinary"
}

New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null
$payloadSources = @(
  $workerBinary,
  (Find-CudaRuntimeDll $cudaRoot 'cublas64_12.dll'),
  (Find-CudaRuntimeDll $cudaRoot 'cublasLt64_12.dll'),
  (Find-CudaRuntimeDll $cudaRoot 'cudart64_12.dll')
)
$stagedFileNames = @('rain-whisper-cuda.exe', 'cublas64_12.dll', 'cublasLt64_12.dll', 'cudart64_12.dll', 'payload-manifest.json')
foreach ($name in $stagedFileNames) {
  $stale = Join-Path $stageRoot $name
  if (Test-Path -LiteralPath $stale -PathType Leaf) { Remove-Item -LiteralPath $stale -Force }
}
foreach ($source in $payloadSources) {
  Copy-Item -LiteralPath $source -Destination (Join-Path $stageRoot (Split-Path -Leaf $source)) -Force
}

$payload = foreach ($source in $payloadSources) {
  $destination = Join-Path $stageRoot (Split-Path -Leaf $source)
  $item = Get-Item -LiteralPath $destination
  [ordered]@{
    name = $item.Name
    sizeBytes = $item.Length
    sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}
$manifest = [ordered]@{
  schemaVersion = 1
  workerProtocolVersion = 1
  configuration = $Configuration
  driverLibraryBundled = $false
  driverLibrary = 'nvcuda.dll is supplied by the installed NVIDIA display driver'
  files = @($payload)
}
$manifestJson = ConvertTo-Json -InputObject $manifest -Depth 10
[System.IO.File]::WriteAllText(
  (Join-Path $stageRoot 'payload-manifest.json'),
  $manifestJson,
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Rain CUDA worker payload staged at $stageRoot"
} catch {
  $workerBuildError = $_
} finally {
  if ($ownedPrunableWorkerTarget) {
    try {
      [void](Assert-WorkerTargetCanBePruned $workerTarget $projectRoot $stageRoot $WorkerInvocationId)
      Remove-Item -LiteralPath $workerTarget -Recurse -Force -ErrorAction Stop
    } catch {
      $workerCleanupError = $_
    }
  }
}
if ($null -ne $workerBuildError) {
  if ($null -ne $workerCleanupError) {
    throw "Worker build failed: $($workerBuildError.Exception.Message); additionally, worker target cleanup failed: $($workerCleanupError.Exception.Message)"
  }
  throw $workerBuildError
}
if ($null -ne $workerCleanupError) {
  throw "Worker target cleanup failed: $($workerCleanupError.Exception.Message)"
}
