Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module -Name (Join-Path $PSScriptRoot 'controlled-owned-directory.psm1') -Force

function New-RainControlledCandidateSourceAdapter {
  return [pscustomobject]@{
    gitArchive = {
      param([string]$CandidateRoot, [string]$CandidateTargetCommit, [string]$ArchivePath)
      & git -C $CandidateRoot archive --format=tar --output=$ArchivePath $CandidateTargetCommit
      return $LASTEXITCODE
    }
    tarExtract = {
      param([string]$ArchivePath, [string]$SourceRoot)
      & tar.exe -xf $ArchivePath -C $SourceRoot
      return $LASTEXITCODE
    }
    removeFile = { param([string]$Path) Remove-Item -LiteralPath $Path -Force -ErrorAction Stop }
    removeOwnedDirectory = {
      param($Reservation, [string]$OwnedParent, [string]$OwnerId, [string]$CleanupAuthorityToken)
      Remove-RainControlledOwnedDirectory -Path $Reservation.path -AllowedParent $OwnedParent -OwnerId $OwnerId -ReservationToken $Reservation.token -CleanupAuthorityToken $CleanupAuthorityToken
    }
  }
}

function Assert-RainControlledCandidateSourceAdapter($Adapter) {
  $adapterToUse = if ($null -eq $Adapter) { New-RainControlledCandidateSourceAdapter } else { $Adapter }
  foreach ($method in @('gitArchive', 'tarExtract', 'removeFile', 'removeOwnedDirectory')) {
    if (-not ($adapterToUse.PSObject.Properties.Name -contains $method) -or $adapterToUse.$method -isnot [scriptblock]) {
      throw "Controlled candidate source adapter '$method' must be a script block."
    }
  }
  return $adapterToUse
}

function Assert-RainControlledCandidateSourceExitCode($Value, [string]$Description) {
  if ($Value -isnot [int] -or $Value -ne 0) { throw "$Description failed with exit code $Value." }
}

function Open-RainControlledCandidateSource {
  param(
    [Parameter(Mandatory = $true)][string]$OwnedRoot,
    [Parameter(Mandatory = $true)][string]$SourceRoot,
    [Parameter(Mandatory = $true)][string]$OwnedParent,
    [Parameter(Mandatory = $true)][string]$OwnerId,
    [Parameter(Mandatory = $true)][string]$ReservationToken,
    [Parameter(Mandatory = $true)][string]$CleanupAuthorityToken
  )
  [void](Open-RainControlledDirectoryReservation -Path $OwnedRoot -AllowedParent $OwnedParent -OwnerId $OwnerId -ReservationToken $ReservationToken -CleanupAuthorityToken $CleanupAuthorityToken)
  $expectedSourceRoot = Join-Path $OwnedRoot 'candidate-source'
  if (-not [string]::Equals([System.IO.Path]::GetFullPath($SourceRoot), [System.IO.Path]::GetFullPath($expectedSourceRoot), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Controlled candidate source must be the exact candidate-source child of its owned root.'
  }
  if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
    throw "Controlled candidate-source directory is missing: $SourceRoot"
  }
  return [pscustomobject][ordered]@{ ownedRoot = (Get-Item -LiteralPath $OwnedRoot).FullName; sourceRoot = (Get-Item -LiteralPath $SourceRoot).FullName }
}

function New-RainControlledCandidateSource {
  param(
    [Parameter(Mandatory = $true)][string]$CandidateRoot,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$CandidateTargetCommit,
    [Parameter(Mandatory = $true)][string]$OwnedParent,
    [Parameter(Mandatory = $true)][string]$OwnerId,
    [Parameter(Mandatory = $true)][string]$CleanupAuthorityToken,
    $Adapter
  )
  $adapterToUse = Assert-RainControlledCandidateSourceAdapter $Adapter
  $ownedRoot = Join-Path $OwnedParent ('rain-controlled-build-tree-' + [Guid]::NewGuid().ToString('N'))
  $reservation = New-RainControlledDirectoryReservation -Path $ownedRoot -AllowedParent $OwnedParent -OwnerId $OwnerId -CleanupAuthorityToken $CleanupAuthorityToken
  $sourceRoot = Join-Path $ownedRoot 'candidate-source'
  $archivePath = Join-Path $ownedRoot 'candidate-tracked-files.tar'
  $primaryError = $null
  $cleanupErrors = [System.Collections.Generic.List[string]]::new()
  try {
    New-Item -ItemType Directory -Path $ownedRoot -ErrorAction Stop | Out-Null
    [void](Open-RainControlledDirectoryReservation -Path $ownedRoot -AllowedParent $OwnedParent -OwnerId $OwnerId -ReservationToken $reservation.token -CleanupAuthorityToken $CleanupAuthorityToken)
    New-Item -ItemType Directory -Path $sourceRoot -ErrorAction Stop | Out-Null
    Assert-RainControlledCandidateSourceExitCode (& $adapterToUse.gitArchive $CandidateRoot $CandidateTargetCommit $archivePath) 'git archive'
    Assert-RainControlledCandidateSourceExitCode (& $adapterToUse.tarExtract $archivePath $sourceRoot) 'tar extraction of exact candidate files'
    & $adapterToUse.removeFile $archivePath
    return [pscustomobject][ordered]@{ ownedRoot = $ownedRoot; sourceRoot = $sourceRoot; reservationToken = $reservation.token }
  } catch {
    $primaryError = $_
  } finally {
    if (Test-Path -LiteralPath $archivePath) {
      try { & $adapterToUse.removeFile $archivePath } catch { [void]$cleanupErrors.Add("candidate archive cleanup failed: $($_.Exception.Message)") }
    }
    if ($null -ne $primaryError) {
      try { & $adapterToUse.removeOwnedDirectory $reservation $OwnedParent $OwnerId $CleanupAuthorityToken } catch { [void]$cleanupErrors.Add("owned candidate source cleanup failed: $($_.Exception.Message)") }
    }
  }
  $message = "Controlled candidate source export failed: $($primaryError.Exception.Message)"
  if ($cleanupErrors.Count -gt 0) { $message += "; additionally, $($cleanupErrors -join '; ')" }
  throw $message
}

Export-ModuleMember -Function @('New-RainControlledCandidateSource', 'Open-RainControlledCandidateSource')
