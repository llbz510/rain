Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ReservationSuffix = '.rain-controlled-owned.json'

function Assert-RainControlledNonblankToken([string]$Value, [string]$Description) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Description must not be blank." }
  return $Value
}

function Resolve-RainControlledDirectChildPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedParent
  )
  $parentFull = [System.IO.Path]::GetFullPath($AllowedParent)
  $parentRoot = [System.IO.Path]::GetPathRoot($parentFull)
  $parent = if ([string]::Equals($parentFull, $parentRoot, [System.StringComparison]::OrdinalIgnoreCase)) { $parentRoot } else { $parentFull.TrimEnd('\', '/') }
  $target = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
  if (-not [string]::Equals(
      [System.IO.Path]::GetDirectoryName($target),
      $parent,
      [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Controlled directory must be a direct child of its allowed parent: $target"
  }
  return [pscustomobject]@{ parent = $parent; target = $target }
}

function Get-RainControlledDirectoryReservationPath([string]$TargetPath) {
  $leaf = [System.IO.Path]::GetFileName($TargetPath)
  return Join-Path ([System.IO.Path]::GetDirectoryName($TargetPath)) ('.' + $leaf + $script:ReservationSuffix)
}

function Get-RainControlledReservationTokenSha256([string]$Token) {
  [void](Assert-RainControlledNonblankToken $Token 'Controlled directory reservation token')
  $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Token)
  try {
    return ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::HashData($bytes))).Replace('-', '').ToLowerInvariant()
  } catch {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
  }
}

function Get-RainControlledAuthorityHmac([string]$AuthorityToken, [string]$OwnerId, [string]$TargetPath, [string]$TokenSha256) {
  [void](Assert-RainControlledNonblankToken $AuthorityToken 'Controlled cleanup authority token')
  $key = [System.Text.UTF8Encoding]::new($false).GetBytes($AuthorityToken)
  $message = [System.Text.UTF8Encoding]::new($false).GetBytes("$OwnerId`n$TargetPath`n$TokenSha256")
  $hmac = [System.Security.Cryptography.HMACSHA256]::new($key)
  try { return ([BitConverter]::ToString($hmac.ComputeHash($message))).Replace('-', '').ToLowerInvariant() } finally { $hmac.Dispose() }
}

function New-RainControlledDirectoryReservation {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedParent,
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{3,127}$')][string]$OwnerId,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$CleanupAuthorityToken
  )
  [void](Assert-RainControlledNonblankToken $CleanupAuthorityToken 'Controlled cleanup authority token')
  $resolved = Resolve-RainControlledDirectChildPath -Path $Path -AllowedParent $AllowedParent
  if (Test-Path -LiteralPath $resolved.target) {
    throw "Refusing to reserve a controlled directory that already exists: $($resolved.target)"
  }
  $marker = Get-RainControlledDirectoryReservationPath $resolved.target
  if (Test-Path -LiteralPath $marker) {
    throw "Refusing to overwrite an existing controlled-directory reservation: $marker"
  }
  $tokenBytes = [byte[]]::new(32)
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($tokenBytes) } finally { $random.Dispose() }
  $token = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  $tokenSha256 = Get-RainControlledReservationTokenSha256 $token
  $value = [ordered]@{
    schemaVersion = 2
    ownerId = $OwnerId
    targetPath = $resolved.target
    tokenSha256 = $tokenSha256
    authorityHmac = Get-RainControlledAuthorityHmac $CleanupAuthorityToken $OwnerId $resolved.target $tokenSha256
  }
  $stream = $null
  try {
    $stream = [System.IO.File]::Open($marker, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes((ConvertTo-Json -InputObject $value -Depth 4))
    $stream.Write($bytes, 0, $bytes.Length)
  } finally {
    if ($stream) { $stream.Dispose() }
  }
  return [pscustomobject]@{ PSTypeName = 'Rain.ControlledDirectoryReservation.v2'; path = $resolved.target; markerPath = $marker; ownerId = $OwnerId; token = $token }
}

function Get-RainControlledDirectoryCleanupAdapter($Adapter) {
  if ($null -eq $Adapter) {
    return [pscustomobject]@{
      removeDirectory = { param([string]$Path) Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop }
      removeFile = { param([string]$Path) Remove-Item -LiteralPath $Path -Force -ErrorAction Stop }
    }
  }
  foreach ($method in @('removeDirectory', 'removeFile')) {
    if (-not ($Adapter.PSObject.Properties.Name -contains $method) -or $Adapter.$method -isnot [scriptblock]) {
      throw "Controlled directory cleanup adapter '$method' must be a script block."
    }
  }
  return $Adapter
}

function Get-RainControlledDirectoryReservation {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedParent,
    [Parameter(Mandatory = $true)][string]$OwnerId,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$ReservationToken,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$CleanupAuthorityToken
  )
  [void](Assert-RainControlledNonblankToken $ReservationToken 'Controlled directory reservation token')
  [void](Assert-RainControlledNonblankToken $CleanupAuthorityToken 'Controlled cleanup authority token')
  $resolved = Resolve-RainControlledDirectChildPath -Path $Path -AllowedParent $AllowedParent
  $marker = Get-RainControlledDirectoryReservationPath $resolved.target
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
    throw "Controlled directory cleanup requires its invocation reservation: $marker"
  }
  try {
    $value = Get-Content -LiteralPath $marker -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Controlled directory reservation is not valid JSON: $marker"
  }
  if ([int]$value.schemaVersion -ne 2 -or [string]$value.ownerId -ne $OwnerId -or
      -not [string]::Equals([System.IO.Path]::GetFullPath([string]$value.targetPath).TrimEnd('\', '/'), $resolved.target, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Controlled directory reservation does not belong to this invocation and exact target: $marker"
  }
  $expectedHmac = Get-RainControlledAuthorityHmac $CleanupAuthorityToken $OwnerId $resolved.target ([string]$value.tokenSha256)
  if (-not ($value.PSObject.Properties.Name -contains 'authorityHmac') -or
      -not [string]::Equals([string]$value.authorityHmac, $expectedHmac, [System.StringComparison]::Ordinal)) {
    throw "Controlled directory reservation authority HMAC does not match: $marker"
  }
  if (-not ($value.PSObject.Properties.Name -contains 'tokenSha256') -or
      -not [string]::Equals([string]$value.tokenSha256, (Get-RainControlledReservationTokenSha256 $ReservationToken), [System.StringComparison]::Ordinal)) {
    throw "Controlled directory reservation token does not match the invocation reservation: $marker"
  }
  return [pscustomobject]@{ path = $resolved.target; markerPath = $marker }
}

function Open-RainControlledDirectoryReservation {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedParent,
    [Parameter(Mandatory = $true)][string]$OwnerId,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$ReservationToken,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$CleanupAuthorityToken
  )
  [void](Assert-RainControlledNonblankToken $ReservationToken 'Controlled directory reservation token')
  [void](Assert-RainControlledNonblankToken $CleanupAuthorityToken 'Controlled cleanup authority token')
  $reservation = Get-RainControlledDirectoryReservation -Path $Path -AllowedParent $AllowedParent -OwnerId $OwnerId -ReservationToken $ReservationToken -CleanupAuthorityToken $CleanupAuthorityToken
  return [pscustomobject]@{ PSTypeName = 'Rain.ControlledDirectoryReservation.v2'; path = $reservation.path; markerPath = $reservation.markerPath; ownerId = $OwnerId; token = $ReservationToken }
}

function Remove-RainControlledOwnedDirectory {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedParent,
    [Parameter(Mandatory = $true)][string]$OwnerId,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$ReservationToken,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$CleanupAuthorityToken,
    $Adapter
  )
  [void](Assert-RainControlledNonblankToken $ReservationToken 'Controlled directory reservation token')
  [void](Assert-RainControlledNonblankToken $CleanupAuthorityToken 'Controlled cleanup authority token')
  $reservation = Get-RainControlledDirectoryReservation -Path $Path -AllowedParent $AllowedParent -OwnerId $OwnerId -ReservationToken $ReservationToken -CleanupAuthorityToken $CleanupAuthorityToken
  $operations = Get-RainControlledDirectoryCleanupAdapter $Adapter
  $errors = [System.Collections.Generic.List[string]]::new()
  if (Test-Path -LiteralPath $reservation.path) {
    try { & $operations.removeDirectory $reservation.path } catch { [void]$errors.Add("directory cleanup failed: $($_.Exception.Message)") }
  }
  if (Test-Path -LiteralPath $reservation.path) {
    if ($errors.Count -eq 0) { [void]$errors.Add('directory cleanup did not remove the owned target') }
  } elseif (Test-Path -LiteralPath $reservation.markerPath) {
    try { & $operations.removeFile $reservation.markerPath } catch { [void]$errors.Add("reservation cleanup failed: $($_.Exception.Message)") }
  }
  if ($errors.Count -gt 0) { throw "Controlled owned-directory cleanup failures for $Path`: $($errors -join '; ')" }
}

function Invoke-RainControlledDirectoryCleanup {
  param(
    [Parameter(Mandatory = $true)][string]$AllowedParent,
    [Parameter(Mandatory = $true)][string]$OwnerId,
    [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$CleanupAuthorityToken,
    $Adapter
  )
  [void](Assert-RainControlledNonblankToken $CleanupAuthorityToken 'Controlled cleanup authority token')
  $parent = [System.IO.Path]::GetFullPath($AllowedParent).TrimEnd('\', '/')
  $markers = @(Get-ChildItem -LiteralPath $parent -File -Force -Filter ('.*' + $script:ReservationSuffix) -ErrorAction Stop)
  $errors = [System.Collections.Generic.List[string]]::new()
  foreach ($marker in $markers) {
    $leaf = $marker.Name.Substring(1, $marker.Name.Length - 1 - $script:ReservationSuffix.Length)
    $target = Join-Path $parent $leaf
    try {
      $value = Get-Content -LiteralPath $marker.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
      if ([int]$value.schemaVersion -ne 2 -or [string]$value.ownerId -ne $OwnerId -or
          -not [string]::Equals([string]$value.targetPath, [System.IO.Path]::GetFullPath($target).TrimEnd('\', '/'), [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Controlled directory reservation does not belong to this invocation and exact target: $($marker.FullName)"
      }
      $expectedHmac = Get-RainControlledAuthorityHmac $CleanupAuthorityToken $OwnerId ([string]$value.targetPath) ([string]$value.tokenSha256)
      if (-not [string]::Equals([string]$value.authorityHmac, $expectedHmac, [System.StringComparison]::Ordinal)) { throw "Controlled directory reservation authority HMAC does not match: $($marker.FullName)" }
      $operations = Get-RainControlledDirectoryCleanupAdapter $Adapter
      if (Test-Path -LiteralPath $target) { & $operations.removeDirectory $target }
      if (Test-Path -LiteralPath $target) { throw "directory cleanup did not remove the owned target: $target" }
      & $operations.removeFile $marker.FullName
    } catch {
      [void]$errors.Add($_.Exception.Message)
    }
  }
  if ($errors.Count -gt 0) { throw "Controlled invocation directory cleanup failures: $($errors -join '; additionally, ')" }
}

Export-ModuleMember -Function @(
  'New-RainControlledDirectoryReservation',
  'Open-RainControlledDirectoryReservation',
  'Remove-RainControlledOwnedDirectory',
  'Invoke-RainControlledDirectoryCleanup'
)
