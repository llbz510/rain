param(
  [Parameter(Mandatory = $true)]
  [string]$CandidateBundleRoot,
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  $AtomicWriteAdapter
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$canonicalRepository = 'llbz510/rain'
$canonicalOrigin = 'https://github.com/llbz510/rain.git'
Import-Module -Name (Join-Path $PSScriptRoot 'controlled-git.psm1') -Force

function Resolve-AdminLauncherFile([string]$Path, [string]$Description) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Description does not exist: $Path"
  }
  return (Get-Item -LiteralPath $Path).FullName
}

function Resolve-AdminLauncherDirectory([string]$Path, [string]$Description) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "$Description does not exist: $Path"
  }
  return (Get-Item -LiteralPath $Path).FullName
}

function Get-AdminLauncherSha256([string]$Path) {
  $stream = $null
  $hasher = $null
  try {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    return ([System.BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  } finally {
    try {
      if ($hasher) { $hasher.Dispose() }
    } finally {
      if ($stream) { $stream.Dispose() }
    }
  }
}

function Get-AdminLauncherProperty($Value, [string]$Name, [string]$Description) {
  if ($null -eq $Value -or -not ($Value.PSObject.Properties.Name -contains $Name)) {
    throw "$Description is missing required property '$Name'."
  }
  return $Value.$Name
}

function Assert-AdminLauncherCommit([string]$Value, [string]$Description) {
  if ($Value -notmatch '^[0-9a-fA-F]{40}$') { throw "$Description must be a full 40-character Git SHA." }
  return $Value.ToLowerInvariant()
}

function Assert-AdminLauncherSha256([string]$Value, [string]$Description) {
  if ($Value -notmatch '^[0-9a-fA-F]{64}$') { throw "$Description must be a SHA-256." }
  return $Value.ToLowerInvariant()
}

function Assert-AdminLauncherLeafName([string]$Value, [string]$Description) {
  if ([string]::IsNullOrWhiteSpace($Value) -or
      $Value -ne [System.IO.Path]::GetFileName($Value) -or
      $Value.Contains(':') -or
      $Value.Contains('..')) {
    throw "$Description must be a simple bundle file name."
  }
  return $Value
}

function Test-AdminLauncherChildPath([string]$Path, [string]$Parent) {
  $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/')
  $pathFull = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
  return $pathFull.StartsWith($parentFull + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function New-AdminLauncherAtomicWriteAdapter {
  return [pscustomobject]@{
    writeText = {
      param([string]$TemporaryPath, [string]$Text)
      [System.IO.File]::WriteAllText($TemporaryPath, $Text, [System.Text.UTF8Encoding]::new($false))
    }
    publish = {
      param([string]$TemporaryPath, [string]$DestinationPath)
      if ([System.IO.File]::Exists($DestinationPath)) {
        [System.IO.File]::Replace($TemporaryPath, $DestinationPath, $null)
      } else {
        [System.IO.File]::Move($TemporaryPath, $DestinationPath)
      }
    }
    remove = {
      param([string]$Path)
      if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
      }
    }
    sleep = {
      param([int]$Attempt)
      Start-Sleep -Milliseconds (50 * $Attempt)
    }
  }
}

function Assert-AdminLauncherAtomicWriteAdapter($Adapter) {
  if ($null -eq $Adapter) { return New-AdminLauncherAtomicWriteAdapter }
  foreach ($method in @('writeText', 'publish', 'remove', 'sleep')) {
    if (-not ($Adapter.PSObject.Properties.Name -contains $method) -or $Adapter.$method -isnot [scriptblock]) {
      throw "Administrator launcher atomic-write adapter '$method' must be a script block."
    }
  }
  return $Adapter
}

function Write-AdminLauncherAtomicText {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Text,
    $Adapter
  )

  $adapterToUse = Assert-AdminLauncherAtomicWriteAdapter $Adapter
  $directory = Split-Path -Parent $Path
  $lastError = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $temporary = Join-Path $directory ('.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $operationError = $null
    $cleanupError = $null
    try {
      & $adapterToUse.writeText $temporary $Text
      & $adapterToUse.publish $temporary $Path
    } catch {
      $operationError = $_
    } finally {
      try {
        & $adapterToUse.remove $temporary
      } catch {
        $cleanupError = $_
      }
    }
    if ($null -ne $cleanupError) {
      if ($null -ne $operationError) {
        throw "Administrator launcher atomic write failed: $($operationError.Exception.Message); additionally, temporary cleanup failed for ${temporary}: $($cleanupError.Exception.Message)"
      }
      throw "Administrator launcher temporary cleanup failed for ${temporary}: $($cleanupError.Exception.Message)"
    }
    if ($null -eq $operationError) {
      return
    }
    if ($operationError.Exception -is [System.IO.IOException]) {
      $lastError = $operationError
      if ($attempt -ge 3) { break }
      & $adapterToUse.sleep $attempt
      continue
    }
    throw $operationError
  }
  throw "Could not atomically publish administrator launcher after 3 attempts: $($lastError.Exception.Message)"
}

$bundleRoot = Resolve-AdminLauncherDirectory $CandidateBundleRoot 'Candidate bundle root'
$outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
if (-not (Test-AdminLauncherChildPath $outputFullPath $bundleRoot)) {
  throw "OutputPath must be inside the candidate bundle: $outputFullPath"
}
if ([System.IO.Path]::GetExtension($outputFullPath) -ne '.ps1') {
  throw 'OutputPath must name a .ps1 launcher.'
}
if (Test-Path -LiteralPath $outputFullPath) {
  throw "Refusing to overwrite an existing administrator launcher: $outputFullPath"
}

$controlledBuildRecordPath = Resolve-AdminLauncherFile (Join-Path $bundleRoot 'controlled-build-record.json') 'Controlled-build record'
try {
  $record = Get-Content -LiteralPath $controlledBuildRecordPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  throw "Controlled-build record is not valid JSON: $($_.Exception.Message)"
}
if ([int](Get-AdminLauncherProperty $record 'schemaVersion' 'Controlled-build record') -ne 1) {
  throw 'Controlled-build record schemaVersion must be 1.'
}
$recordRepository = [string](Get-AdminLauncherProperty $record 'repository' 'Controlled-build record')
if ($recordRepository -ne $canonicalRepository) {
  throw "Controlled-build record repository must be $canonicalRepository."
}
$recordSourceRepository = [string](Get-AdminLauncherProperty $record 'sourceRepository' 'Controlled-build record')
if ($recordSourceRepository -ne $canonicalOrigin) {
  throw "Controlled-build record sourceRepository must be $canonicalOrigin."
}
$targetCommit = Assert-AdminLauncherCommit ([string](Get-AdminLauncherProperty $record 'targetCommit' 'Controlled-build record')) 'Controlled-build record targetCommit'
$toolingCommit = Assert-AdminLauncherCommit ([string](Get-AdminLauncherProperty $record 'toolingCommit' 'Controlled-build record')) 'Controlled-build record toolingCommit'
if ($targetCommit -eq $toolingCommit) {
  throw 'Controlled-build record toolingCommit must be distinct from candidate targetCommit.'
}
if ((Get-AdminLauncherProperty $record 'cleanTree' 'Controlled-build record') -ne $true) {
  throw 'Controlled-build record cleanTree must be true.'
}
$workflow = Get-AdminLauncherProperty $record 'workflow' 'Controlled-build record'
$workflowFile = [string](Get-AdminLauncherProperty $workflow 'file' 'Controlled-build record workflow')
if ($workflowFile -ne '.github/workflows/controlled-gpu-artifact-build.yml') {
  throw 'Controlled-build record workflow.file must be the controlled GPU artifact workflow.'
}
$workflowDefinitionCommit = Assert-AdminLauncherCommit ([string](Get-AdminLauncherProperty $workflow 'definitionCommit' 'Controlled-build record workflow')) 'Controlled-build record workflow.definitionCommit'
if ($workflowDefinitionCommit -ne $toolingCommit) {
  throw 'Controlled-build record workflow definition commit must match toolingCommit.'
}
$workflowRunId = [string](Get-AdminLauncherProperty $workflow 'runId' 'Controlled-build record workflow')
if ($workflowRunId -notmatch '^[0-9]+$') { throw 'Controlled-build record workflow.runId must be a GitHub run id.' }
$workflowRunAttempt = [int](Get-AdminLauncherProperty $workflow 'runAttempt' 'Controlled-build record workflow')
if ($workflowRunAttempt -lt 1) { throw 'Controlled-build record workflow.runAttempt must be positive.' }
if ([string](Get-AdminLauncherProperty $workflow 'event' 'Controlled-build record workflow') -ne 'workflow_dispatch') {
  throw 'Controlled-build record workflow.event must be workflow_dispatch.'
}
if ([string](Get-AdminLauncherProperty $workflow 'ref' 'Controlled-build record workflow') -ne 'refs/heads/master') {
  throw 'Controlled-build record workflow.ref must be refs/heads/master.'
}
$workflowRunUrl = [string](Get-AdminLauncherProperty $workflow 'runUrl' 'Controlled-build record workflow')
if ($workflowRunUrl -ne "https://github.com/$canonicalRepository/actions/runs/$workflowRunId/attempts/$workflowRunAttempt") {
  throw 'Controlled-build record workflow.runUrl must bind the canonical repository, run id, and attempt.'
}
$masterReachability = Get-AdminLauncherProperty $record 'masterReachability' 'Controlled-build record'
if ((Get-AdminLauncherProperty $masterReachability 'candidate' 'Controlled-build record masterReachability') -ne $true -or
    (Get-AdminLauncherProperty $masterReachability 'tooling' 'Controlled-build record masterReachability') -ne $true) {
  throw 'Controlled-build record must prove candidate and tooling reachability from canonical master.'
}
$coreArtifact = Get-AdminLauncherProperty $record 'coreArtifact' 'Controlled-build record'
$coreArtifactName = Assert-AdminLauncherLeafName ([string](Get-AdminLauncherProperty $coreArtifact 'name' 'Controlled-build record core artifact')) 'Controlled-build record coreArtifact.name'
$coreArtifactDigest = Assert-AdminLauncherSha256 ([string](Get-AdminLauncherProperty $coreArtifact 'digest' 'Controlled-build record core artifact')) 'Controlled-build record coreArtifact.digest'
$installer = Get-AdminLauncherProperty $record 'installer' 'Controlled-build record'
$installerFileName = Assert-AdminLauncherLeafName ([string](Get-AdminLauncherProperty $installer 'fileName' 'Controlled-build record installer')) 'Controlled-build record installer.fileName'
$installerHash = Assert-AdminLauncherSha256 ([string](Get-AdminLauncherProperty $installer 'sha256' 'Controlled-build record installer')) 'Controlled-build record installer.sha256'
$installerSize = [int64](Get-AdminLauncherProperty $installer 'sizeBytes' 'Controlled-build record installer')
$artifactManifest = Get-AdminLauncherProperty $record 'artifactManifest' 'Controlled-build record'
$artifactManifestFileName = Assert-AdminLauncherLeafName ([string](Get-AdminLauncherProperty $artifactManifest 'fileName' 'Controlled-build record artifact manifest')) 'Controlled-build record artifactManifest.fileName'
$artifactManifestHash = Assert-AdminLauncherSha256 ([string](Get-AdminLauncherProperty $artifactManifest 'sha256' 'Controlled-build record artifact manifest')) 'Controlled-build record artifactManifest.sha256'
$artifactManifestSize = [int64](Get-AdminLauncherProperty $artifactManifest 'sizeBytes' 'Controlled-build record artifact manifest')

$installerPath = Resolve-AdminLauncherFile (Join-Path $bundleRoot $installerFileName) 'Candidate installer'
$artifactManifestPath = Resolve-AdminLauncherFile (Join-Path $bundleRoot $artifactManifestFileName) 'Artifact manifest'
if ((Get-Item -LiteralPath $installerPath).Length -ne $installerSize -or (Get-AdminLauncherSha256 $installerPath) -ne $installerHash) {
  throw 'Candidate installer does not match the controlled-build record.'
}
if ((Get-Item -LiteralPath $artifactManifestPath).Length -ne $artifactManifestSize -or (Get-AdminLauncherSha256 $artifactManifestPath) -ne $artifactManifestHash) {
  throw 'Artifact manifest does not match the controlled-build record.'
}
try {
  $manifest = Get-Content -LiteralPath $artifactManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  throw "Artifact manifest is not valid JSON: $($_.Exception.Message)"
}
if ((Assert-AdminLauncherCommit ([string](Get-AdminLauncherProperty $manifest 'targetCommit' 'Artifact manifest')) 'Artifact manifest targetCommit') -ne $targetCommit) {
  throw 'Artifact manifest targetCommit does not match the controlled-build record.'
}
$manifestControlledBuild = Get-AdminLauncherProperty $manifest 'controlledBuild' 'Artifact manifest'
if ([string](Get-AdminLauncherProperty $manifestControlledBuild 'repository' 'Artifact manifest controlledBuild') -ne $canonicalRepository -or
    [string](Get-AdminLauncherProperty $manifestControlledBuild 'sourceRepository' 'Artifact manifest controlledBuild') -ne $canonicalOrigin -or
    (Assert-AdminLauncherCommit ([string](Get-AdminLauncherProperty $manifestControlledBuild 'targetCommit' 'Artifact manifest controlledBuild')) 'Artifact manifest controlledBuild.targetCommit') -ne $targetCommit -or
    (Assert-AdminLauncherCommit ([string](Get-AdminLauncherProperty $manifestControlledBuild 'toolingCommit' 'Artifact manifest controlledBuild')) 'Artifact manifest controlledBuild.toolingCommit') -ne $toolingCommit) {
  throw 'Artifact manifest controlled-build commits do not match the controlled-build record.'
}
$manifestMasterReachability = Get-AdminLauncherProperty $manifestControlledBuild 'masterReachability' 'Artifact manifest controlledBuild'
if ((Get-AdminLauncherProperty $manifestMasterReachability 'candidate' 'Artifact manifest controlledBuild masterReachability') -ne $true -or
    (Get-AdminLauncherProperty $manifestMasterReachability 'tooling' 'Artifact manifest controlledBuild masterReachability') -ne $true) {
  throw 'Artifact manifest must prove candidate and tooling reachability from canonical master.'
}
$manifestInstaller = Get-AdminLauncherProperty $manifest 'installer' 'Artifact manifest'
if ([string](Get-AdminLauncherProperty $manifestInstaller 'fileName' 'Artifact manifest installer') -ne $installerFileName -or
    (Assert-AdminLauncherSha256 ([string](Get-AdminLauncherProperty $manifestInstaller 'sha256' 'Artifact manifest installer')) 'Artifact manifest installer.sha256') -ne $installerHash -or
    [int64](Get-AdminLauncherProperty $manifestInstaller 'sizeBytes' 'Artifact manifest installer') -ne $installerSize) {
  throw 'Artifact manifest installer identity does not match the controlled-build record.'
}

$controlledBuildRecordHash = Get-AdminLauncherSha256 $controlledBuildRecordPath
$template = @'
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,
  [Parameter(Mandatory = $true)]
  [string]$WhisperModelPath,
  [string]$OutputRoot = '',
  [string]$InstallDir = '',
  [int]$DriverPort = 4474,
  [int]$NativeDriverPort = 4475,
  [int]$MaxSeconds = 600,
  [switch]$KeepInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$expectedTargetCommit = '__TARGET_COMMIT__'
$expectedToolingCommit = '__TOOLING_COMMIT__'
$expectedInstallerSha256 = '__INSTALLER_SHA256__'
$expectedArtifactManifestSha256 = '__MANIFEST_SHA256__'
$expectedControlledBuildRecordSha256 = '__RECORD_SHA256__'
$expectedRepository = '__REPOSITORY__'
$expectedSourceRepository = '__SOURCE_REPOSITORY__'
$expectedWorkflowRunUrl = '__WORKFLOW_RUN_URL__'
$expectedWorkflowRunId = '__WORKFLOW_RUN_ID__'
$expectedWorkflowRunAttempt = __WORKFLOW_RUN_ATTEMPT__
$installerFileName = '__INSTALLER_FILE_NAME__'
$artifactManifestFileName = '__MANIFEST_FILE_NAME__'
$controlledBuildRecordFileName = 'controlled-build-record.json'

function Get-LauncherSha256([string]$Path) {
  $stream = $null
  $hasher = $null
  try {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    return ([System.BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  } finally {
    try { if ($hasher) { $hasher.Dispose() } } finally { if ($stream) { $stream.Dispose() } }
  }
}

function Resolve-LauncherBundleFile([string]$BundleRoot, [string]$FileName, [string]$Description) {
  $path = Join-Path $BundleRoot $FileName
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Description does not exist: $path" }
  return (Get-Item -LiteralPath $path).FullName
}

__CONTROLLED_GIT_HELPER__

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this launcher manually from an elevated PowerShell. It will not self-elevate.'
}

Write-Host "Manual handoff prerequisite: verify the canonical workflow run URL and second control-artifact upload digest in GitHub Actions before continuing: $expectedWorkflowRunUrl"
Write-Host 'Keep the downloaded core and control artifact contents together in this directory.'

$bundleRoot = (Get-Item -LiteralPath $PSScriptRoot).FullName
$controlledBuildRecordPath = Resolve-LauncherBundleFile $bundleRoot $controlledBuildRecordFileName 'Controlled-build record'
$artifactManifestPath = Resolve-LauncherBundleFile $bundleRoot $artifactManifestFileName 'Artifact manifest'
$installerPath = Resolve-LauncherBundleFile $bundleRoot $installerFileName 'Candidate installer'
if ((Get-LauncherSha256 $controlledBuildRecordPath) -ne $expectedControlledBuildRecordSha256) {
  throw 'Controlled-build record SHA-256 does not match this generated launcher.'
}
if ((Get-LauncherSha256 $artifactManifestPath) -ne $expectedArtifactManifestSha256) {
  throw 'Artifact manifest SHA-256 does not match this generated launcher.'
}
if ((Get-LauncherSha256 $installerPath) -ne $expectedInstallerSha256) {
  throw 'Installer SHA-256 does not match this generated launcher.'
}
try {
  $record = Get-Content -LiteralPath $controlledBuildRecordPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  throw "Controlled-build record is not valid JSON: $($_.Exception.Message)"
}
if ([string]$record.targetCommit -ne $expectedTargetCommit -or [string]$record.toolingCommit -ne $expectedToolingCommit) {
  throw 'Controlled-build record commits do not match this generated launcher.'
}
if ([string]$record.repository -ne $expectedRepository -or [string]$record.sourceRepository -ne $expectedSourceRepository -or
    [string]$record.workflow.runUrl -ne $expectedWorkflowRunUrl -or [string]$record.workflow.runId -ne $expectedWorkflowRunId -or
    [int]$record.workflow.runAttempt -ne $expectedWorkflowRunAttempt -or [string]$record.workflow.event -ne 'workflow_dispatch' -or
    [string]$record.workflow.ref -ne 'refs/heads/master' -or $record.masterReachability.candidate -ne $true -or $record.masterReachability.tooling -ne $true) {
  throw 'Controlled-build record canonical run provenance does not match this generated launcher.'
}
if ([string]$record.artifactManifest.sha256 -ne $expectedArtifactManifestSha256 -or [string]$record.installer.sha256 -ne $expectedInstallerSha256) {
  throw 'Controlled-build record artifact hashes do not match this generated launcher.'
}

if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) { throw "RepoRoot does not exist: $RepoRoot" }
$controlRepoRoot = (Get-Item -LiteralPath $RepoRoot).FullName
$actualToolingCommit = (Invoke-RainControlledGitText -RepositoryRoot $controlRepoRoot -Description 'Control tooling HEAD' -GitArguments @('rev-parse', 'HEAD')).ToLowerInvariant()
if ($actualToolingCommit -ne $expectedToolingCommit) {
  throw "Control tooling checkout mismatch: expected $expectedToolingCommit, found $actualToolingCommit."
}
$controlOrigin = (Invoke-RainControlledGitText -RepositoryRoot $controlRepoRoot -Description 'Control tooling origin' -GitArguments @('remote', 'get-url', 'origin')).TrimEnd('/')
if ($controlOrigin -notin @($expectedSourceRepository, $expectedSourceRepository.Substring(0, $expectedSourceRepository.Length - 4))) {
  throw "Control tooling checkout origin is not canonical: $controlOrigin"
}
$trackedStatus = Invoke-RainControlledGitText -RepositoryRoot $controlRepoRoot -Description 'Control tooling status' -GitArguments @('status', '--porcelain', '--untracked-files=all')
if (-not [string]::IsNullOrWhiteSpace($trackedStatus)) {
  throw "Control tooling checkout is not clean at tooling commit $actualToolingCommit."
}
$runnerPath = Join-Path $controlRepoRoot 'scripts\run-nvidia-release-evidence.ps1'
if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) { throw "NVIDIA Evidence runner does not exist: $runnerPath" }

$runnerArguments = @{
  InstallerPath = $installerPath
  ArtifactManifestPath = $artifactManifestPath
  ControlledBuildRecordPath = $controlledBuildRecordPath
  ExpectedArtifactManifestSha256 = $expectedArtifactManifestSha256
  WhisperModelPath = $WhisperModelPath
  ExpectedTargetCommit = $expectedTargetCommit
  ExpectedInstallerSha256 = $expectedInstallerSha256
  OutputRoot = $OutputRoot
  InstallDir = $InstallDir
  DriverPort = $DriverPort
  NativeDriverPort = $NativeDriverPort
  MaxSeconds = $MaxSeconds
  KeepInstall = $KeepInstall
}
& $runnerPath @runnerArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
'@
$controlledGitHelperSource = Get-RainControlledGitHelperSource
$launcherText = $template.
  Replace('__CONTROLLED_GIT_HELPER__', $controlledGitHelperSource).
  Replace('__TARGET_COMMIT__', $targetCommit).
  Replace('__TOOLING_COMMIT__', $toolingCommit).
  Replace('__INSTALLER_SHA256__', $installerHash).
  Replace('__MANIFEST_SHA256__', $artifactManifestHash).
  Replace('__RECORD_SHA256__', $controlledBuildRecordHash).
  Replace('__REPOSITORY__', $recordRepository).
  Replace('__SOURCE_REPOSITORY__', $recordSourceRepository).
  Replace('__WORKFLOW_RUN_URL__', $workflowRunUrl).
  Replace('__WORKFLOW_RUN_ID__', $workflowRunId).
  Replace('__WORKFLOW_RUN_ATTEMPT__', [string]$workflowRunAttempt).
  Replace('__INSTALLER_FILE_NAME__', $installerFileName).
  Replace('__MANIFEST_FILE_NAME__', $artifactManifestFileName)
Write-AdminLauncherAtomicText -Path $outputFullPath -Text $launcherText -Adapter $AtomicWriteAdapter
Write-Output $outputFullPath
