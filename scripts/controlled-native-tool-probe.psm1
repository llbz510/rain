Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-RainControlledNativeToolProbeAdapter {
  return {
    param([string]$Path, [string[]]$Arguments)
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $output = & $Path @Arguments 2>&1
      $exitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    return [pscustomobject]@{ output = [string]($output | Out-String); exitCode = [int]$exitCode }
  }
}

function Invoke-RainControlledNativeToolProbe {
  param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$Name,
    [Parameter(Mandatory = $true)][string]$Path,
    [string[]]$Arguments = @(),
    [scriptblock]$Adapter = $null
  )
  $adapterToUse = if ($null -eq $Adapter) { New-RainControlledNativeToolProbeAdapter } else { $Adapter }
  $probe = & $adapterToUse -Path $Path -Arguments $Arguments
  if ($null -eq $probe -or -not ($probe.PSObject.Properties.Name -contains 'exitCode') -or -not ($probe.PSObject.Properties.Name -contains 'output')) {
    throw "Native tool probe '$Name' did not return output and exitCode facts."
  }
  $output = ([string]$probe.output).Trim()
  $exitCode = [int]$probe.exitCode
  if ($exitCode -ne 0) {
    throw "Native tool probe '$Name' failed with exit code ${exitCode}: $output"
  }
  if ([string]::IsNullOrWhiteSpace($output)) {
    throw "Native tool probe '$Name' returned blank version output."
  }
  return [pscustomobject]@{ name = $Name; path = $Path; arguments = @($Arguments); output = $output; exitCode = 0 }
}

Export-ModuleMember -Function 'Invoke-RainControlledNativeToolProbe'
