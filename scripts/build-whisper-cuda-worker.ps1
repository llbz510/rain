param(
  [ValidateSet('debug', 'release')]
  [string]$Configuration = 'release',
  [string]$OutputRoot = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$manifestPath = Join-Path $projectRoot 'src-tauri\Cargo.toml'
$workerTarget = Join-Path $projectRoot 'src-tauri\target\whisper-gpu-worker'
$stageRoot = if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  Join-Path $projectRoot 'src-tauri\target\whisper-gpu-bundle\whisper-backends'
} else {
  [System.IO.Path]::GetFullPath($OutputRoot, $projectRoot)
}

function Find-CudaNvcc {
  $command = Get-Command 'nvcc.exe' -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $localNvcc = Join-Path $projectRoot '.worktrees\.tooling\cuda-12.9-redist-root\bin\nvcc.exe'
  if (Test-Path -LiteralPath $localNvcc) { return $localNvcc }

  $cudaRoot = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA'
  if (-not (Test-Path -LiteralPath $cudaRoot)) { return $null }
  $matches = @(Get-ChildItem -LiteralPath $cudaRoot -Filter 'nvcc.exe' -Recurse -File -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)
  if ($matches.Count -gt 0) { return $matches[0].FullName }
  return $null
}

function Find-Ninja {
  $command = Get-Command 'ninja.exe' -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $localNinja = Join-Path $projectRoot '.worktrees\.tooling\ninja\ninja.exe'
  if (Test-Path -LiteralPath $localNinja) { return $localNinja }
  return $null
}

function Find-VcVars64 {
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

function Find-CudaRuntimeDll([string]$CudaRoot, [string]$Name) {
  $direct = Join-Path $CudaRoot "bin\$Name"
  if (Test-Path -LiteralPath $direct) { return (Resolve-Path -LiteralPath $direct).Path }
  $match = Get-ChildItem -LiteralPath $CudaRoot -Filter $Name -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($match) { return $match.FullName }
  throw "Required CUDA redistributable was not found: $Name under $CudaRoot"
}

$nvcc = Find-CudaNvcc
if ([string]::IsNullOrWhiteSpace($nvcc)) {
  throw 'CUDA Toolkit 12.x nvcc.exe is required to build the Rain CUDA worker.'
}
$cudaBin = Split-Path -Parent $nvcc
$cudaRoot = Split-Path -Parent $cudaBin
$ninja = Find-Ninja
if ([string]::IsNullOrWhiteSpace($ninja)) {
  throw 'ninja.exe is required to build the Rain CUDA worker.'
}
$vcVars = Find-VcVars64
if ([string]::IsNullOrWhiteSpace($vcVars)) {
  throw 'Visual Studio 2022 C++ Build Tools are required to build the Rain CUDA worker.'
}

$env:CUDA_PATH = $cudaRoot
$env:CUDA_HOME = $cudaRoot
$env:CUDAToolkit_ROOT = $cudaRoot
$env:CUDACXX = $nvcc
$env:CMAKE_CUDA_COMPILER = $nvcc
$env:CMAKE_GENERATOR = 'Ninja'
$env:CMAKE_MAKE_PROGRAM = $ninja
$env:LIBCLANG_PATH = if ($env:LIBCLANG_PATH) { $env:LIBCLANG_PATH } else { 'C:\Program Files\LLVM\bin' }
$env:CMAKE_CXX_FLAGS = '/utf-8'
$env:CMAKE_C_FLAGS = '/utf-8'

$pathEntries = @($cudaBin, (Join-Path $cudaRoot 'lib\x64'), (Join-Path $cudaRoot 'nvvm\bin'), (Split-Path -Parent $ninja)) |
  Where-Object { Test-Path -LiteralPath $_ }
$processPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
foreach ($entry in $pathEntries) {
  if ($processPath -notlike "*$entry*") {
    $processPath = $entry + [System.IO.Path]::PathSeparator + $processPath
  }
}
[Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')

$cargo = (Get-Command 'cargo.exe' -ErrorAction Stop).Source
$cargoArgs = @(
  'build',
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
  cudaRoot = $cudaRoot
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
