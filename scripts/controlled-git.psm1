Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-RainControlledGitText {
  param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)][string[]]$GitArguments,
    [scriptblock]$CommandAdapter
  )

  if ($null -eq $CommandAdapter) {
    $git = Get-Command 'git.exe' -ErrorAction SilentlyContinue
    if (-not $git) { $git = Get-Command 'git' -ErrorAction Stop }
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $commandOutput = & $git.Source -C $RepositoryRoot @GitArguments 2>&1
      $commandExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    $result = [pscustomobject]@{
      exitCode = $commandExitCode
      output = [string]($commandOutput | Out-String)
    }
  } else {
    $result = & $CommandAdapter $RepositoryRoot $GitArguments
  }

  if ($null -eq $result -or
      -not ($result.PSObject.Properties.Name -contains 'exitCode') -or
      -not ($result.PSObject.Properties.Name -contains 'output')) {
    throw "$Description Git command adapter must return exitCode and output."
  }
  $exitCode = [int]$result.exitCode
  $output = [string]$result.output
  if ($exitCode -ne 0) {
    $diagnostic = $output.Trim()
    if ([string]::IsNullOrWhiteSpace($diagnostic)) { $diagnostic = 'no diagnostic output' }
    throw "$Description failed with exit code ${exitCode}: $diagnostic"
  }
  return $output.Trim()
}

function Get-RainControlledGitHelperSource {
  $definition = ${function:Invoke-RainControlledGitText}.ToString()
  return "function Invoke-RainControlledGitText {`r`n${definition}`r`n}"
}

Export-ModuleMember -Function @(
  'Invoke-RainControlledGitText',
  'Get-RainControlledGitHelperSource'
)
