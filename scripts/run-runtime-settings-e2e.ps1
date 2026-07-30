param(
  [int]$DriverPort = 4454,
  [int]$NativeDriverPort = 4455,
  [int]$MaxSeconds = 90,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Get-Item -LiteralPath (Split-Path -Parent $PSScriptRoot)).FullName
$testAlias = 'Rain Runtime Settings E2E'
$testModel = 'rain-runtime-settings-e2e-model'
$pendingImportVideoId = 'rain-pending-import-recovery-e2e-video'
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$diagnosticsRoot = Join-Path $temporaryRoot 'rain-runtime-settings-e2e-latest-failure'
$runRoot = Join-Path $temporaryRoot ("rain-runtime-settings-e2e-" + [Guid]::NewGuid().ToString('N'))
$runRoot = (New-Item -ItemType Directory -Path $runRoot).FullName
$databasePath = Join-Path $runRoot 'rain-runtime-settings.db'
$driverLog = Join-Path $runRoot 'tauri-driver.log'
$driverErrorLog = Join-Path $runRoot 'tauri-driver.err.log'
$webDriverRequestSeconds = [Math]::Max(30, $MaxSeconds)
$secretVariableNames = @('RAIN_E2E_LLM_API_KEY', 'RAIN_QWEN_API_KEY', 'RAIN_LIVE_LLM_API_KEY')
$diagnosticSecrets = @($secretVariableNames | ForEach-Object {
  [Environment]::GetEnvironmentVariable($_, 'Process')
} | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
foreach ($secretVariable in $secretVariableNames) {
  [Environment]::SetEnvironmentVariable($secretVariable, $null, 'Process')
}

$localToolPaths = @(
  (Join-Path $repoRoot '.worktrees\.tooling\cargo-bin\bin'),
  (Join-Path $repoRoot '.worktrees\.tooling\msedgedriver')
) | Where-Object { Test-Path -LiteralPath $_ }
if ($localToolPaths.Count -gt 0) {
  $processPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
  [Environment]::SetEnvironmentVariable(
    'Path',
    (($localToolPaths -join [System.IO.Path]::PathSeparator) + [System.IO.Path]::PathSeparator + $processPath),
    'Process'
  )
}

function Require-Command([string]$Name, [string]$InstallHint) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "$Name is required for Runtime Settings desktop E2E. $InstallHint" }
  return $command.Source
}

function Protect-DiagnosticText([string]$Value) {
  if ($null -eq $Value) { return '' }
  $protected = $Value
  foreach ($secret in $diagnosticSecrets) {
    if ([string]::IsNullOrWhiteSpace([string]$secret)) { continue }
    $protected = $protected.Replace([string]$secret, '[REDACTED]')
  }
  $protected = [regex]::Replace($protected, 'sk-[A-Za-z0-9._-]+', '[REDACTED]')
  return [regex]::Replace($protected, '(?i)Bearer\s+[^\s"'']+', 'Bearer [REDACTED]')
}

function Assert-DiagnosticsPath() {
  $resolvedDiagnostics = [System.IO.Path]::GetFullPath($diagnosticsRoot)
  $expectedDiagnostics = [System.IO.Path]::GetFullPath(
    (Join-Path $temporaryRoot 'rain-runtime-settings-e2e-latest-failure')
  )
  if (-not $resolvedDiagnostics.Equals($expectedDiagnostics, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify unexpected Runtime Settings E2E diagnostics directory: $resolvedDiagnostics"
  }
  return $resolvedDiagnostics
}

function Save-FailureDiagnostics([string]$Phase, $ErrorRecord) {
  $resolvedDiagnostics = Assert-DiagnosticsPath
  if (Test-Path -LiteralPath $resolvedDiagnostics) {
    Remove-Item -LiteralPath $resolvedDiagnostics -Recurse -Force
  }
  New-Item -ItemType Directory -Path $resolvedDiagnostics | Out-Null

  $summary = [ordered]@{
    version = 1
    status = 'failed'
    phase = $Phase
    error = Protect-DiagnosticText ([string]$ErrorRecord.Exception.Message)
    createdAt = [DateTimeOffset]::Now.ToString('o')
    command = 'npm run e2e:runtime-settings'
  }
  $summaryJson = ConvertTo-Json -InputObject $summary -Depth 5
  [System.IO.File]::WriteAllText(
    (Join-Path $resolvedDiagnostics 'summary.json'),
    $summaryJson,
    [System.Text.UTF8Encoding]::new($false)
  )

  foreach ($log in @(
    @{ Source = $driverLog; Name = 'tauri-driver.log' },
    @{ Source = $driverErrorLog; Name = 'tauri-driver.err.log' }
  )) {
    if (-not (Test-Path -LiteralPath $log.Source)) { continue }
    $content = Get-Content -LiteralPath $log.Source -Raw -ErrorAction Stop
    [System.IO.File]::WriteAllText(
      (Join-Path $resolvedDiagnostics $log.Name),
      (Protect-DiagnosticText $content),
      [System.Text.UTF8Encoding]::new($false)
    )
  }
  Write-Warning "Runtime Settings E2E diagnostics retained at: $resolvedDiagnostics"
}

function Remove-FailureDiagnostics() {
  $resolvedDiagnostics = Assert-DiagnosticsPath
  if (Test-Path -LiteralPath $resolvedDiagnostics) {
    Remove-Item -LiteralPath $resolvedDiagnostics -Recurse -Force
  }
}

function Wait-WebDriver([int]$Port) {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    try {
      Invoke-RestMethod -Uri "http://127.0.0.1:$Port/status" -Method Get -TimeoutSec 2 | Out-Null
      return
    } catch {
      Start-Sleep -Milliseconds 250
    }
  } while ((Get-Date) -lt $deadline)
  throw 'tauri-driver did not become ready on time.'
}

function Invoke-WebDriver([string]$Method, [string]$Path, $Body = $null) {
  $uri = "http://127.0.0.1:$DriverPort$Path"
  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $uri -TimeoutSec $webDriverRequestSeconds
  }
  return Invoke-RestMethod -Method $Method -Uri $uri -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 20) -TimeoutSec $webDriverRequestSeconds
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

function Open-ReadySettingsPage([string]$SessionId) {
  Wait-WebDriverCondition $SessionId 'the video list page' @'
return Boolean(document.querySelector('[data-testid="video-list-page"]'));
'@
  $opened = Invoke-WebDriverScript $SessionId @'
const button = document.querySelector('[data-testid="open-settings"]');
if (!button) return false;
button.click();
return true;
'@
  if ($opened -ne $true) { throw 'Could not open the production Settings page.' }
  Wait-WebDriverCondition $SessionId 'Runtime Settings initialization' @'
const page = document.querySelector('[data-testid="settings-page"]');
return page?.getAttribute('data-runtime-settings-status') === 'ready';
'@
}

function Assert-RealDatabaseSchema([string]$SessionId) {
  Wait-WebDriverCondition $SessionId 'the real SQLite schema probe' @'
const status = window.__RAIN_RUNTIME_SETTINGS_SCHEMA__?.status;
return status === 'passed' || status === 'failed';
'@
  $result = Invoke-WebDriverScript $SessionId @'
const probe = window.__RAIN_RUNTIME_SETTINGS_SCHEMA__;
if (probe?.status === 'failed') {
  return { ok: false, error: `Schema probe failed: ${probe.error || 'unknown error'}` };
}
const expected = {
  video: [
    'id', 'title', 'source', 'source_url', 'file_path', 'thumbnail', 'duration',
    'language', 'status', 'stage', 'error_message', 'created_at', 'position',
    'last_studied_at',
  ],
  node: [
    'id', 'video_id', 'parent_id', 'kind', 'title', 'type', 'start_time',
    'end_time', 'text', 'translation', 'sort_order',
  ],
  sentence: ['id', 'node_id', 'text', 'start_time', 'end_time', 'sort_order'],
  note: [
    'id', 'video_id', 'content', 'source', 'created_at', 'derivation_id', 'sort_order',
  ],
  note_sentence: ['note_id', 'sentence_id'],
  setting: ['key', 'value'],
  import_checkpoint: [
    'video_id', 'stage', 'completed_blocks_json', 'error_message', 'updated_at',
  ],
};
const actual = probe?.tables || {};
const errors = [];
for (const [table, columns] of Object.entries(expected)) {
  if (!Object.prototype.hasOwnProperty.call(actual, table)) {
    errors.push(`missing table ${table}`);
    continue;
  }
  const missingColumns = columns.filter((column) => !actual[table].includes(column));
  if (missingColumns.length > 0) {
    errors.push(`${table} missing columns ${missingColumns.join(',')}`);
  }
}
return { ok: errors.length === 0, error: errors.join('; ') };
'@
  if ($result.ok -ne $true) {
    throw "Real SQLite schema did not satisfy the independent contract: $($result.error)"
  }
}

function Assert-PendingImportFixture(
  [string]$SessionId,
  [string]$ExpectedStatus,
  [AllowNull()][string]$ExpectedStage
) {
  $expectedStageExpression = if ([string]::IsNullOrEmpty($ExpectedStage)) {
    'null'
  } else {
    "'$ExpectedStage'"
  }
  Wait-WebDriverCondition $SessionId "pending import fixture status $ExpectedStatus" @"
const fixture = window.__RAIN_PENDING_IMPORT_RECOVERY__;
return fixture?.status === 'passed'
  && fixture.videoId === '$pendingImportVideoId'
  && fixture.videoStatus === '$ExpectedStatus'
  && (fixture.videoStage ?? null) === $expectedStageExpression;
"@
  $result = Invoke-WebDriverScript $SessionId @'
const fixture = window.__RAIN_PENDING_IMPORT_RECOVERY__;
return {
  status: fixture?.status || 'missing',
  error: fixture?.error || '',
  videoId: fixture?.videoId || '',
  videoStatus: fixture?.videoStatus || '',
  videoStage: fixture?.videoStage ?? null,
  matchingVideoCount: fixture?.matchingVideoCount ?? -1,
  totalVideoCount: fixture?.totalVideoCount ?? -1,
};
'@
  if ($result.status -ne 'passed') {
    throw "Pending import recovery fixture failed: $($result.error)"
  }
  if ($result.videoId -ne $pendingImportVideoId -or $result.videoStatus -ne $ExpectedStatus -or [string]$result.videoStage -ne [string]$ExpectedStage -or $result.matchingVideoCount -ne 1 -or $result.totalVideoCount -ne 1) {
    throw "Pending import fixture did not preserve one SQLite row: $($result | ConvertTo-Json -Compress)"
  }
}

function Open-PendingImportDialog([string]$SessionId) {
  Wait-WebDriverCondition $SessionId 'the pending import recovery card' @"
return Boolean(document.querySelector('[data-testid="card-$pendingImportVideoId"]'));
"@
  $opened = Invoke-WebDriverScript $SessionId @"
const card = document.querySelector('[data-testid="card-$pendingImportVideoId"]');
const title = card?.querySelector('span[aria-disabled]');
if (!title) return false;
title.click();
return true;
"@
  if ($opened -ne $true) { throw 'Could not open the pending import recovery task detail.' }
  Wait-WebDriverCondition $SessionId 'the pending import recovery dialog' @"
return Boolean(document.querySelector('[aria-labelledby="import-task-title-$pendingImportVideoId"]'));
"@
}

function Close-PendingImportDialog([string]$SessionId) {
  $closed = Invoke-WebDriverScript $SessionId @"
const dialog = document.querySelector('[aria-labelledby="import-task-title-$pendingImportVideoId"]');
const button = dialog?.querySelector('[data-testid="close-import-$pendingImportVideoId"]');
if (!button) return false;
button.click();
return true;
"@
  if ($closed -ne $true) { throw 'Could not close the pending import recovery task detail.' }
  Wait-WebDriverCondition $SessionId 'the pending import recovery dialog to close' @"
return !document.querySelector('[aria-labelledby="import-task-title-$pendingImportVideoId"]');
"@
}

function Continue-PendingImport([string]$SessionId) {
  $continued = Invoke-WebDriverScript $SessionId @"
const dialog = document.querySelector('[aria-labelledby="import-task-title-$pendingImportVideoId"]');
const button = dialog?.querySelector('[data-testid="continue-import-$pendingImportVideoId"]');
if (!button) return false;
button.click();
button.click();
return true;
"@
  if ($continued -ne $true) { throw 'The pending import detail did not expose the explicit continue action.' }
}

function Assert-PendingImportFailureVisible([string]$SessionId) {
  Wait-WebDriverCondition $SessionId 'the explicit pending import terminal result' @"
const dialog = document.querySelector('[aria-labelledby="import-task-title-$pendingImportVideoId"]');
const alert = dialog?.querySelector('[role="alert"]');
const retry = dialog?.querySelector('[data-testid="retry-import-$pendingImportVideoId"]');
return Boolean(alert?.textContent?.trim()) && Boolean(retry);
"@
}

function Test-ModelVisible([string]$SessionId) {
  return Invoke-WebDriverScript $SessionId @"
return [...document.querySelectorAll('[data-testid^="model-entry-"]')]
  .some((row) => row.textContent?.includes('$testAlias'));
"@
}

function Add-TestModel([string]$SessionId) {
  Write-Output 'Runtime Settings E2E phase: open add form'
  $opened = Invoke-WebDriverScript $SessionId @'
const button = document.querySelector('[data-testid="add-model"]');
if (!button) return false;
button.click();
return true;
'@
  if ($opened -ne $true) { throw 'Could not open the Add Model form.' }
  Wait-WebDriverCondition $SessionId 'the Add Model form' @'
return Boolean(document.querySelector('[data-testid="add-model-form"]'));
'@

  Write-Output 'Runtime Settings E2E phase: fill add form'
  $fillScript = @'
const form = document.querySelector('[data-testid="add-model-form"]');
if (!form) return false;
const setInput = (testId, value) => {
  const input = [...form.querySelectorAll('input')]
    .find((candidate) => candidate.getAttribute('data-testid') === testId);
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};
const keyInput = form.querySelector('[data-testid="model-api-key"]');
if (!keyInput || keyInput.value !== '') return false;
return setInput('model-name', '__TEST_MODEL__') && setInput('model-alias', '__TEST_ALIAS__');
'@
  $fillScript = $fillScript.Replace('__TEST_MODEL__', $testModel).Replace('__TEST_ALIAS__', $testAlias)
  $filled = Invoke-WebDriverScript $SessionId $fillScript
  if ($filled -ne $true) { throw 'Could not fill the Add Model form without an API Key.' }

  Write-Output 'Runtime Settings E2E phase: save add form'
  $saved = Invoke-WebDriverScript $SessionId @'
const form = document.querySelector('[data-testid="add-model-form"]');
const button = form?.querySelector('[data-testid="add-model-save"]');
if (!button || button.disabled) return false;
button.click();
return true;
'@
  if ($saved -ne $true) { throw 'Could not save the test model.' }
  Wait-WebDriverCondition $SessionId 'the saved model row' @"
return [...document.querySelectorAll('[data-testid^="model-entry-"]')]
  .some((row) => row.textContent?.includes('$testAlias'));
"@
}

function Remove-TestModel([string]$SessionId) {
  $removed = Invoke-WebDriverScript $SessionId @"
const row = [...document.querySelectorAll('[data-testid^="model-entry-"]')]
  .find((candidate) => candidate.textContent?.includes('$testAlias'));
const button = row?.querySelector('[data-testid^="remove-model-"]');
if (!button || button.disabled) return false;
button.click();
return true;
"@
  if ($removed -ne $true) { throw 'Could not remove the persisted test model.' }
  $deadline = (Get-Date).AddSeconds($MaxSeconds)
  do {
    $state = Invoke-WebDriverScript $SessionId @"
const row = [...document.querySelectorAll('[data-testid^="model-entry-"]')]
  .find((candidate) => candidate.textContent?.includes('$testAlias'));
const status = row?.querySelector('[role="status"]');
return { visible: Boolean(row), error: status?.textContent?.trim() || '' };
"@
    if ($state.visible -ne $true) { return }
    if (-not [string]::IsNullOrWhiteSpace([string]$state.error)) {
      throw "Model deletion failed in the production UI: $($state.error)"
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw 'Timed out waiting for the deleted model row to disappear.'
}

function Close-WebDriverSession([string]$SessionId) {
  if ([string]::IsNullOrWhiteSpace($SessionId)) { return }
  Invoke-WebDriver 'Delete' "/session/$SessionId" | Out-Null
}

$tauriDriver = $null
$driverProcess = $null
$sessionId = $null
$runSucceeded = $false
$phase = 'bootstrap'
$primaryError = $null
try {
  $tauriDriver = Require-Command 'tauri-driver' 'Install with: cargo install tauri-driver --locked'
  $edgeDriver = Require-Command 'msedgedriver' 'Install a Microsoft Edge driver matching the local browser.'
  $npmCmd = Require-Command 'npm.cmd' 'Install Node.js 18 or newer.'
  $env:RAIN_E2E_BUILD = '1'

  if (-not $SkipBuild) {
    $phase = 'build'
    & $npmCmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    $env:LIBCLANG_PATH = if ($env:LIBCLANG_PATH) { $env:LIBCLANG_PATH } else { 'C:\Program Files\LLVM\bin' }
    $env:CMAKE_CXX_FLAGS = '/utf-8'
    $env:CMAKE_C_FLAGS = '/utf-8'
    & $npmCmd run tauri -- build --debug --no-bundle
    if ($LASTEXITCODE -ne 0) { throw 'Tauri debug build failed.' }
  }

  $appBinary = Join-Path $repoRoot 'src-tauri\target\debug\rain.exe'
  if (-not (Test-Path -LiteralPath $appBinary)) {
    throw "Rain debug binary not found: $appBinary"
  }

  $env:RAIN_E2E_MODE = '1'
  $env:RAIN_E2E_RUN_MODE = 'runtime-settings'
  $env:RAIN_E2E_DB_PATH = $databasePath

  $phase = 'driver-start'
  $driverProcess = Start-Process -FilePath $tauriDriver -ArgumentList @(
    '--port', [string]$DriverPort,
    '--native-port', [string]$NativeDriverPort,
    '--native-driver', $edgeDriver
  ) -RedirectStandardOutput $driverLog -RedirectStandardError $driverErrorLog -WindowStyle Hidden -PassThru
  Wait-WebDriver $DriverPort

  $phase = 'initial-startup'
  $sessionId = New-WebDriverSession $appBinary
  Open-ReadySettingsPage $sessionId
  Write-Output 'Runtime Settings E2E phase: verify real SQLite schema'
  Assert-RealDatabaseSchema $sessionId
  $phase = 'initial-state'
  Write-Output 'Runtime Settings E2E phase: initial isolated state'
  if (Test-ModelVisible $sessionId) { throw 'The isolated database unexpectedly contained the test model.' }
  Write-Output 'Runtime Settings E2E phase: add model'
  $phase = 'add-model'
  Add-TestModel $sessionId
  Write-Output 'Runtime Settings E2E phase: seed pending import recovery fact'
  $phase = 'seed-pending-import'
  Assert-PendingImportFixture $sessionId 'pending' $null
  Close-WebDriverSession $sessionId
  $sessionId = $null

  $phase = 'first-restart'
  $sessionId = New-WebDriverSession $appBinary
  Wait-WebDriverCondition $sessionId 'the video list page after first restart' @'
return Boolean(document.querySelector('[data-testid="video-list-page"]'));
'@
  Write-Output 'Runtime Settings E2E phase: prove pending import remains idle after restart'
  Assert-PendingImportFixture $sessionId 'pending' $null
  Start-Sleep -Milliseconds 1000
  Assert-PendingImportFixture $sessionId 'pending' $null
  Open-PendingImportDialog $sessionId
  Close-PendingImportDialog $sessionId
  Assert-PendingImportFixture $sessionId 'pending' $null
  Open-PendingImportDialog $sessionId
  Write-Output 'Runtime Settings E2E phase: explicitly continue the same pending import'
  $phase = 'continue-pending-import'
  Continue-PendingImport $sessionId
  Assert-PendingImportFixture $sessionId 'failed' 'asr'
  Assert-PendingImportFailureVisible $sessionId
  Close-PendingImportDialog $sessionId
  Open-ReadySettingsPage $sessionId
  Write-Output 'Runtime Settings E2E phase: verify first restart'
  if (-not (Test-ModelVisible $sessionId)) { throw 'The test model did not survive the first desktop restart.' }
  Write-Output 'Runtime Settings E2E phase: delete model'
  $phase = 'delete-model'
  Remove-TestModel $sessionId
  Close-WebDriverSession $sessionId
  $sessionId = $null

  $phase = 'second-restart'
  $sessionId = New-WebDriverSession $appBinary
  Wait-WebDriverCondition $sessionId 'the video list page after second restart' @'
return Boolean(document.querySelector('[data-testid="video-list-page"]'));
'@
  Write-Output 'Runtime Settings E2E phase: verify pending import result survived restart'
  Assert-PendingImportFixture $sessionId 'failed' 'asr'
  Open-PendingImportDialog $sessionId
  Assert-PendingImportFailureVisible $sessionId
  Close-PendingImportDialog $sessionId
  Open-ReadySettingsPage $sessionId
  Write-Output 'Runtime Settings E2E phase: verify second restart'
  if (Test-ModelVisible $sessionId) { throw 'The deleted test model returned after the second desktop restart.' }

  $runSucceeded = $true
  Write-Output 'Runtime Settings desktop E2E passed: initialize -> add -> pending restart recovery -> delete -> restart.'
} catch {
  $primaryError = $_
} finally {
  if ($sessionId) {
    try { Close-WebDriverSession $sessionId } catch { }
  }
  if ($driverProcess -and -not $driverProcess.HasExited) {
    Stop-Process -Id $driverProcess.Id -Force -ErrorAction SilentlyContinue
    $driverProcess.WaitForExit(5000) | Out-Null
  }
  if ($primaryError) {
    try { Save-FailureDiagnostics $phase $primaryError } catch {
      Write-Warning "Runtime Settings E2E diagnostic capture also failed: $($_.Exception.Message)"
    }
  }
  if (Test-Path -LiteralPath $runRoot) {
    $resolvedRunRoot = [System.IO.Path]::GetFullPath($runRoot)
    $safePrefix = $temporaryRoot.TrimEnd('\') + '\rain-runtime-settings-e2e-'
    if (-not $resolvedRunRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove unexpected Runtime Settings E2E directory: $resolvedRunRoot"
    }
    $cleanupError = $null
    for ($attempt = 0; $attempt -lt 10 -and (Test-Path -LiteralPath $resolvedRunRoot); $attempt++) {
      try {
        Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force
        $cleanupError = $null
      } catch {
        $cleanupError = $_
        Start-Sleep -Milliseconds 250
      }
    }
    if (Test-Path -LiteralPath $resolvedRunRoot) {
      if ($runSucceeded) { throw $cleanupError }
      Write-Warning "Runtime Settings E2E cleanup also failed: $cleanupError"
    }
  }
  if (-not $primaryError) { Remove-FailureDiagnostics }
}
if ($primaryError) { throw $primaryError }
