Set-StrictMode -Version Latest

function Get-ControlledBuildVolumeRoot([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Controlled build disk path must not be blank.' }
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $volumeRoot = [System.IO.Path]::GetPathRoot($fullPath)
  if ([string]::IsNullOrWhiteSpace($volumeRoot)) { throw "Could not resolve a volume root for controlled build path: $Path" }
  return $volumeRoot
}

function Get-ControlledBuildDefaultVolumeProbe {
  return {
    param([string]$VolumeRoot)
    $deviceId = $VolumeRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$deviceId'" -ErrorAction Stop
    if ($null -eq $disk) { throw "Could not inspect controlled build volume $VolumeRoot." }
    return [int64]$disk.FreeSpace
  }
}

function Assert-ControlledBuildPathsFreeBytes {
  param(
    [Parameter(Mandatory = $true)][string]$Stage,
    [Parameter(Mandatory = $true)][string[]]$Paths,
    [Parameter(Mandatory = $true)][int64]$MinimumBytes,
    [scriptblock]$VolumeProbe = (Get-ControlledBuildDefaultVolumeProbe)
  )
  if ($Paths.Count -eq 0) { throw "Controlled build disk stage $Stage has no paths to inspect." }
  $volumeRoots = @($Paths | ForEach-Object { Get-ControlledBuildVolumeRoot $_ } | Sort-Object -Unique)
  $records = foreach ($volumeRoot in $volumeRoots) {
    $freeBytes = [int64](& $VolumeProbe $volumeRoot)
    Write-Host "disk stage=$Stage volumeRoot=$volumeRoot freeBytes=$freeBytes minimumBytes=$MinimumBytes"
    if ($freeBytes -lt $MinimumBytes) {
      throw "Hosted Windows runner volume $volumeRoot lacks required disk space for ${Stage}: $freeBytes bytes free, $MinimumBytes required."
    }
    [pscustomobject]@{ stage = $Stage; volumeRoot = $volumeRoot; freeBytes = $freeBytes; minimumBytes = $MinimumBytes }
  }
  return @($records)
}

Export-ModuleMember -Function 'Assert-ControlledBuildPathsFreeBytes'
