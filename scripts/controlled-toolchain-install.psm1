Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module -Name (Join-Path $PSScriptRoot 'controlled-build-disk.psm1') -Force -ErrorAction Stop
Import-Module -Name (Join-Path $PSScriptRoot 'controlled-owned-directory.psm1') -Force -ErrorAction Stop

function New-RainControlledToolchainInstallAdapter {
  return [pscustomobject]@{
    install = {
      param([string]$Path, [string[]]$Arguments, [string]$Description)
      $previousErrorActionPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        $output = & $Path @Arguments 2>&1
        $exitCode = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $previousErrorActionPreference
      }
      if ($exitCode -ne 0) {
        throw "$Description installation failed with exit code ${exitCode}: $([string]($output | Out-String).Trim())"
      }
    }
    remove = {
      param([string]$Path, [bool]$Recurse)
      if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse:$Recurse -Force -ErrorAction Stop
      }
    }
    expand = {
      param([string]$Archive, [string]$Destination)
      Expand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force
    }
    pathExists = {
      param([string]$Path, [string]$Kind)
      if ($Kind -eq 'leaf') { return Test-Path -LiteralPath $Path -PathType Leaf }
      if ($Kind -eq 'container') { return Test-Path -LiteralPath $Path -PathType Container }
      return Test-Path -LiteralPath $Path
    }
    cmakeVersion = {
      param([string]$Path)
      $previousErrorActionPreference = $ErrorActionPreference
      try {
        $ErrorActionPreference = 'Continue'
        $output = & $Path --version 2>&1
        $exitCode = $LASTEXITCODE
      } finally {
        $ErrorActionPreference = $previousErrorActionPreference
      }
      if ($exitCode -ne 0) { throw "Pinned CMake version command failed with exit code $exitCode." }
      return [regex]::Match(([string]($output | Out-String)), '\d+(?:\.\d+){2}').Value
    }
    appendLine = {
      param([string]$Path, [string]$Line)
      $Line | Out-File -FilePath $Path -Encoding utf8 -Append
    }
    diskGate = {
      param([string]$Stage, [string[]]$Paths, [int64]$MinimumBytes)
      Assert-ControlledBuildPathsFreeBytes -Stage $Stage -Paths $Paths -MinimumBytes $MinimumBytes | Out-Null
    }
  }
}

function Assert-RainControlledToolchainInstallAdapter($Adapter) {
  if ($null -eq $Adapter) { return New-RainControlledToolchainInstallAdapter }
  foreach ($method in @('install', 'remove', 'expand', 'pathExists', 'cmakeVersion', 'appendLine', 'diskGate')) {
    if (-not ($Adapter.PSObject.Properties.Name -contains $method) -or $Adapter.$method -isnot [scriptblock]) {
      throw "Controlled toolchain install adapter '$method' must be a script block."
    }
  }
  return $Adapter
}

function Invoke-RainControlledToolchainInstall {
  param(
    [Parameter(Mandatory = $true)][string]$DownloadsRoot,
    [Parameter(Mandatory = $true)][string]$CmakeExtractRoot,
    [Parameter(Mandatory = $true)][string]$OwnershipParent,
    [Parameter(Mandatory = $true)][string]$OwnerId,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$CleanupAuthorityToken,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$DownloadsReservationToken,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$CmakeReservationToken,
    [Parameter(Mandatory = $true)][string]$ExpectedCmakeVersion,
    [Parameter(Mandatory = $true)][string]$GitHubPathFile,
    [Parameter(Mandatory = $true)][string]$GitHubEnvFile,
    $Adapter,
    $OwnershipCleanupAdapter
  )

  foreach ($tokenFact in @(
    @{ description = 'Controlled cleanup authority token'; value = $CleanupAuthorityToken },
    @{ description = 'Downloads reservation token'; value = $DownloadsReservationToken },
    @{ description = 'CMake reservation token'; value = $CmakeReservationToken }
  )) {
    if ([string]::IsNullOrWhiteSpace([string]$tokenFact.value)) { throw "$($tokenFact.description) must not be blank." }
  }

  [void](Open-RainControlledDirectoryReservation -Path $DownloadsRoot -AllowedParent $OwnershipParent -OwnerId $OwnerId -ReservationToken $DownloadsReservationToken -CleanupAuthorityToken $CleanupAuthorityToken)
  [void](Open-RainControlledDirectoryReservation -Path $CmakeExtractRoot -AllowedParent $OwnershipParent -OwnerId $OwnerId -ReservationToken $CmakeReservationToken -CleanupAuthorityToken $CleanupAuthorityToken)
  $adapterToUse = Assert-RainControlledToolchainInstallAdapter $Adapter
  $cudaRoot = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.9'
  $llvmRoot = 'C:\Program Files\LLVM'
  $llvmBin = Join-Path $llvmRoot 'bin'
  $nsisHome = 'C:\Program Files (x86)\NSIS'
  $cmakeBin = Join-Path $CmakeExtractRoot 'cmake-4.0.0-windows-x86_64\bin'
  $cmakePath = Join-Path $cmakeBin 'cmake.exe'
  $errors = [System.Collections.Generic.List[string]]::new()
  $cmakeReady = $false
  $cmakeRootOwnedByInvocation = $false

  try {
    & $adapterToUse.diskGate 'before-install' @($DownloadsRoot, $CmakeExtractRoot, $cudaRoot, $llvmRoot, $nsisHome) 20GB
    if (& $adapterToUse.pathExists $CmakeExtractRoot 'container') {
      throw "Refusing to reuse an existing pinned CMake directory: $CmakeExtractRoot"
    }
    & $adapterToUse.install (Join-Path $DownloadsRoot 'cuda.exe') @('-s') 'CUDA'
    & $adapterToUse.remove (Join-Path $DownloadsRoot 'cuda.exe') $false
    & $adapterToUse.install (Join-Path $DownloadsRoot 'llvm.exe') @('/S') 'LLVM'
    & $adapterToUse.remove (Join-Path $DownloadsRoot 'llvm.exe') $false
    & $adapterToUse.install (Join-Path $DownloadsRoot 'nsis.exe') @('/S') 'NSIS'
    & $adapterToUse.remove (Join-Path $DownloadsRoot 'nsis.exe') $false
    $cmakeRootOwnedByInvocation = $true
    & $adapterToUse.expand (Join-Path $DownloadsRoot 'cmake.zip') $CmakeExtractRoot
    & $adapterToUse.remove (Join-Path $DownloadsRoot 'cmake.zip') $false
    if (-not (& $adapterToUse.pathExists $cmakePath 'leaf')) { throw "Pinned CMake was not extracted: $cmakePath" }
    $cmakeVersion = [string](& $adapterToUse.cmakeVersion $cmakePath)
    if ($cmakeVersion -ne $ExpectedCmakeVersion) {
      throw "Pinned CMake version verification failed: expected $ExpectedCmakeVersion, observed $cmakeVersion."
    }
    foreach ($requiredPath in @(
      (Join-Path $cudaRoot 'bin\nvcc.exe'),
      (Join-Path $llvmBin 'libclang.dll'),
      (Join-Path $nsisHome 'makensis.exe')
    )) {
      if (-not (& $adapterToUse.pathExists $requiredPath 'leaf')) { throw "Pinned native tool was not installed: $requiredPath" }
    }
    foreach ($pathLine in @($llvmBin, $nsisHome, $cmakeBin)) {
      & $adapterToUse.appendLine $GitHubPathFile $pathLine
    }
    foreach ($envLine in @(
      "CUDA_ROOT=$cudaRoot",
      "LLVM_BIN=$llvmBin",
      "NSIS_HOME=$nsisHome",
      "CMAKE_PATH=$cmakePath",
      "CMAKE=$cmakePath",
      "CMAKE_ROOT=$CmakeExtractRoot"
    )) {
      & $adapterToUse.appendLine $GitHubEnvFile $envLine
    }
    $cmakeReady = $true
  } catch {
    [void]$errors.Add("Toolchain install failed: $($_.Exception.Message)")
  } finally {
    try {
      Remove-RainControlledOwnedDirectory -Path $DownloadsRoot -AllowedParent $OwnershipParent -OwnerId $OwnerId -ReservationToken $DownloadsReservationToken -CleanupAuthorityToken $CleanupAuthorityToken -Adapter $OwnershipCleanupAdapter
    } catch {
      [void]$errors.Add("Pinned download cleanup failed: $($_.Exception.Message)")
    }
    if (-not $cmakeReady -and $cmakeRootOwnedByInvocation) {
      try {
        Remove-RainControlledOwnedDirectory -Path $CmakeExtractRoot -AllowedParent $OwnershipParent -OwnerId $OwnerId -ReservationToken $CmakeReservationToken -CleanupAuthorityToken $CleanupAuthorityToken -Adapter $OwnershipCleanupAdapter
      } catch {
        [void]$errors.Add("Incomplete CMake cleanup failed: $($_.Exception.Message)")
      }
    }
    try {
      & $adapterToUse.diskGate 'after-tool-install-cleanup' @($DownloadsRoot, $CmakeExtractRoot) 14GB
    } catch {
      [void]$errors.Add("Post-tool-install disk gate failed: $($_.Exception.Message)")
    }
  }

  if ($errors.Count -gt 0) { throw "Controlled toolchain install failures: $($errors -join '; ')" }
  return [pscustomobject]@{
    cmakeReady = $true
    cmakeRoot = $CmakeExtractRoot
    cmakePath = $cmakePath
    cudaRoot = $cudaRoot
    llvmBin = $llvmBin
    nsisHome = $nsisHome
  }
}

Export-ModuleMember -Function @(
  'Invoke-RainControlledToolchainInstall'
)
