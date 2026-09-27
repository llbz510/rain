param(
  [int]$DriverPort = 4458,
  [int]$NativeDriverPort = 4459,
  [int]$MaxSeconds = 90,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Get-Item -LiteralPath (Split-Path -Parent $PSScriptRoot)).FullName
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$diagnosticsRoot = Join-Path $temporaryRoot 'rain-study-catalog-e2e-latest-failure'
$attachmentRoot = Join-Path $temporaryRoot 'rain-study-catalog-e2e-attachment'
$runRoot = Join-Path $temporaryRoot ("rain-study-catalog-e2e-" + [Guid]::NewGuid().ToString('N'))
$runRoot = (New-Item -ItemType Directory -Path $runRoot).FullName
$databasePath = Join-Path $runRoot 'rain-study-catalog.db'
$driverLog = Join-Path $runRoot 'tauri-driver.log'
$driverErrorLog = Join-Path $runRoot 'tauri-driver.err.log'
$screenshotPath = Join-Path $attachmentRoot 'study-catalog-desktop-dom.png'
$attachmentNoticePath = Join-Path $attachmentRoot 'ATTACHMENT-NOTICE.txt'
$webDriverRequestSeconds = [Math]::Max(30, $MaxSeconds)
$elementKey = 'element-6066-11e4-a52e-4f735466cecf'
$fixtureInterface = 'window.__RAIN_STUDY_CATALOG_FIXTURE__'

# 脚本自持的独立期望合同（受控 fixture，不含用户数据、真实路径或密钥）。
# 目录时间轴必须落在 media 的真实时长内；时长由 fixture 显式声明并写入诊断（t30b）。
$catalogTitle = 'E2E 长目录样本'
$catalogVideoId = 'rain-e2e-study-catalog-video'
$mediaDeclarationSeconds = 0
$pageSelector = '[data-testid="study-interface"]'
$listPageSelector = '[data-testid="video-list-page"]'
$catalogBarSelector = '[data-testid="catalog-bar"]'
$structureRowSelector = '[data-catalog-scroll-row="structure"]'
$paragraphRowSelector = '[data-catalog-scroll-row="paragraph"]'

$script:missingConditions = New-Object System.Collections.Generic.List[string]
$script:facts = [ordered]@{}

$secretVariableNames = @('RAIN_E2E_LLM_API_KEY', 'RAIN_QWEN_API_KEY', 'RAIN_LIVE_LLM_API_KEY')
$diagnosticSecrets = @($secretVariableNames | ForEach-Object {
  [Environment]::GetEnvironmentVariable($_, 'Process')
} | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
foreach ($secretVariable in $secretVariableNames) {
  [Environment]::SetEnvironmentVariable($secretVariable, $null, 'Process')
}

function Require-Command([string]$Name, [string]$InstallHint) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "$Name is required for Study Catalog desktop E2E. $InstallHint" }
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

function Get-GuardedTemporaryPath([string]$Leaf) {
  $allowedLeaves = @('rain-study-catalog-e2e-latest-failure', 'rain-study-catalog-e2e-attachment')
  if ($allowedLeaves -notcontains $Leaf) {
    throw "Refusing to modify unexpected Study Catalog E2E directory leaf: $Leaf"
  }
  $resolved = [System.IO.Path]::GetFullPath((Join-Path $temporaryRoot $Leaf))
  if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify Study Catalog E2E directory outside the temporary root: $resolved"
  }
  return $resolved
}

function Reset-AttachmentDirectory() {
  $resolved = Get-GuardedTemporaryPath 'rain-study-catalog-e2e-attachment'
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
  New-Item -ItemType Directory -Path $resolved | Out-Null
  return $resolved
}

function Fail-Condition([string]$Condition, [string]$Detail) {
  if (-not [string]::IsNullOrWhiteSpace($Condition)) { $script:missingConditions.Add($Condition) }
  if ([string]::IsNullOrWhiteSpace($Detail)) { throw $Condition }
  throw "$Condition | $Detail"
}

function Save-FailureDiagnostics([string]$Phase, $ErrorRecord) {
  $resolvedDiagnostics = Get-GuardedTemporaryPath 'rain-study-catalog-e2e-latest-failure'
  if (Test-Path -LiteralPath $resolvedDiagnostics) { Remove-Item -LiteralPath $resolvedDiagnostics -Recurse -Force }
  New-Item -ItemType Directory -Path $resolvedDiagnostics | Out-Null
  $summary = [ordered]@{
    version = 1
    status = 'failed'
    phase = $Phase
    error = Protect-DiagnosticText ([string]$ErrorRecord.Exception.Message)
    missingConditions = @($script:missingConditions | ForEach-Object { Protect-DiagnosticText $_ })
    observed = $script:facts
    mediaDeclarationSeconds = $mediaDeclarationSeconds
    createdAt = [DateTimeOffset]::Now.ToString('o')
    command = 'npm run e2e:study-catalog'
  }
  [System.IO.File]::WriteAllText(
    (Join-Path $resolvedDiagnostics 'summary.json'),
    (ConvertTo-Json -InputObject $summary -Depth 6),
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
  Write-Warning "Study Catalog E2E diagnostics retained at: $resolvedDiagnostics"
}

function Remove-FailureDiagnostics() {
  $resolvedDiagnostics = Get-GuardedTemporaryPath 'rain-study-catalog-e2e-latest-failure'
  if (Test-Path -LiteralPath $resolvedDiagnostics) { Remove-Item -LiteralPath $resolvedDiagnostics -Recurse -Force }
}

function Wait-WebDriver([int]$Port) {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    try {
      Invoke-RestMethod -Uri "http://127.0.0.1:$Port/status" -Method Get -TimeoutSec 2 | Out-Null
      return
    } catch { Start-Sleep -Milliseconds 250 }
  } while ((Get-Date) -lt $deadline)
  throw 'tauri-driver did not become ready on time.'
}

function Invoke-WebDriver([string]$Method, [string]$Path, $Body = $null) {
  $uri = "http://127.0.0.1:$DriverPort$Path"
  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $uri -TimeoutSec $webDriverRequestSeconds
  }
  # Windows PowerShell 5.1 会把字符串 body 按 ANSI 编码发送，选择器与注入脚本里的中文会变成 '?'，
  # 导致本可命中的真实桌面 DOM 查询 404。这里统一按 UTF-8 字节发送并声明 charset。
  $payload = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Depth 20))
  return Invoke-RestMethod -Method $Method -Uri $uri -ContentType 'application/json; charset=utf-8' -Body $payload -TimeoutSec $webDriverRequestSeconds
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

function Close-WebDriverSession([string]$SessionId) {
  if ([string]::IsNullOrWhiteSpace($SessionId)) { return }
  Invoke-WebDriver 'Delete' "/session/$SessionId" | Out-Null
}

function Invoke-WebDriverScript([string]$SessionId, [string]$Script) {
  $response = Invoke-WebDriver 'Post' "/session/$SessionId/execute/sync" @{ script = $Script; args = @() }
  return $response.value
}

function Wait-WebDriverCondition([string]$SessionId, [string]$Description, [string]$Script) {
  $deadline = (Get-Date).AddSeconds($MaxSeconds)
  do {
    if ((Invoke-WebDriverScript $SessionId $Script) -eq $true) { return }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Description."
}

function Find-WebDriverElement([string]$SessionId, [string]$Selector, [switch]$AllowMissing) {
  try {
    $response = Invoke-WebDriver 'Post' "/session/$SessionId/element" @{ using = 'css selector'; value = $Selector }
  } catch {
    if ($AllowMissing) { return $null }
    throw "WebDriver could not query element '$Selector': $($_.Exception.Message)"
  }
  if ($response.value -and $response.value.$elementKey) { return [string]$response.value.$elementKey }
  if ($AllowMissing) { return $null }
  throw "WebDriver returned no element for selector: $Selector"
}

function Find-WebDriverElements([string]$SessionId, [string]$Selector) {
  $response = Invoke-WebDriver 'Post' "/session/$SessionId/elements" @{ using = 'css selector'; value = $Selector }
  if ($null -eq $response.value) { return @() }
  return @($response.value | ForEach-Object { [string]$_.$elementKey })
}

function Get-WebDriverElementText([string]$SessionId, [string]$ElementId) {
  return [string](Invoke-WebDriver 'Get' "/session/$SessionId/element/$ElementId/text").value
}

function Get-WebDriverElementAttribute([string]$SessionId, [string]$ElementId, [string]$Name) {
  return [string](Invoke-WebDriver 'Get' "/session/$SessionId/element/$ElementId/attribute/$Name").value
}

function Invoke-WebDriverElementClick([string]$SessionId, [string]$ElementId) {
  Invoke-WebDriver 'Post' "/session/$SessionId/element/$ElementId/click" @{} | Out-Null
}

function Get-WebDriverElementRect([string]$SessionId, [string]$ElementId) {
  $response = Invoke-WebDriver 'Get' "/session/$SessionId/element/$ElementId/rect"
  return $response.value
}

function Save-WebDriverScreenshot([string]$SessionId) {
  try {
    $payload = [string](Invoke-WebDriver 'Get' "/session/$SessionId/screenshot").value
    if ([string]::IsNullOrWhiteSpace($payload)) { throw 'empty screenshot payload' }
    [System.IO.File]::WriteAllBytes($screenshotPath, [Convert]::FromBase64String($payload))
    $notice = @(
      '仅附件，不构成 Visual Evidence。',
      'AC-SU-01 的裁判是真实 WebDriver 读到的桌面 DOM 与真实操作/滚动；本目录只允许 1 张来自隔离 fixture 的截图。',
      'command: npm run e2e:study-catalog',
      "mediaDeclarationSeconds: $mediaDeclarationSeconds",
      "headSha: $($env:GITHUB_SHA)",
      "runId: $($env:GITHUB_RUN_ID)",
      "webView2Runtime: $($env:RAIN_E2E_WEBVIEW2_VERSION)",
      'noKeysOrUserData: true'
    ) -join [Environment]::NewLine
    [System.IO.File]::WriteAllText($attachmentNoticePath, $notice + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    Write-Output "Study Catalog E2E phase: screenshot attachment written to $screenshotPath"
  } catch {
    Write-Warning "Study Catalog E2E screenshot attachment unavailable: $($_.Exception.Message)"
  }
}

# 能力探针：本段（t34）必须回答宿主是否支持 /element/{id}/rect 与 W3C /actions；
# 结论只作事实记录，不支持时由裁判逐条如实降级，绝不声称已覆盖该行为。
function Assert-HostCapabilities([string]$SessionId) {
  $rectSupported = $false
  try {
    $rect = Get-WebDriverElementRect $SessionId (Find-WebDriverElement $SessionId 'html')
    $rectSupported = ($null -ne $rect -and $null -ne $rect.width)
  } catch {
    $script:facts['rectProbeError'] = Protect-DiagnosticText ([string]$_.Exception.Message)
  }
  $script:facts['elementRectEndpoint'] = if ($rectSupported) { 'supported' } else { 'unsupported' }

  $actionsSupported = $false
  try {
    Invoke-WebDriver 'Post' "/session/$SessionId/actions" @{
      actions = @(@{ type = 'wheel'; id = 'probe-wheel'; actions = @(@{ type = 'scroll'; x = 0; y = 0; deltaX = 0; deltaY = 0; duration = 0 }) })
    }
    Invoke-WebDriver 'Delete' "/session/$SessionId/actions" | Out-Null
    $actionsSupported = $true
  } catch {
    $script:facts['actionsProbeError'] = Protect-DiagnosticText ([string]$_.Exception.Message)
  }
  $script:facts['actionsEndpoint'] = if ($actionsSupported) { 'supported' } else { 'unsupported' }
}

function Assert-CatalogFixtureAvailability([string]$SessionId) {
  $status = [string](Invoke-WebDriverScript $SessionId @"
const fixture = $fixtureInterface;
if (!fixture || typeof fixture !== 'object') return 'absent';
return String(fixture.status || 'unknown');
"@)
  $script:facts['fixtureInterfaceStatus'] = $status
  $script:facts['catalogBarPresent'] = [bool](Find-WebDriverElement $SessionId $listPageSelector -AllowMissing)
  if ($status -eq 'absent') {
    Fail-Condition 'AC-SU-01 的四项桌面条件无法判定：学习页长目录受控夹具公开接口未建立（两行结构/当前项居中跟随/边缘渐隐 owner/暂停后不再强制跟随都缺少夹具）' "interface=$fixtureInterface status=absent"
  }
  if ($status -eq 'failed') {
    Fail-Condition '学习页长目录受控夹具公开接口报告建立失败' "status=failed"
  }
  Fail-Condition '本段（t34）尚未实现四项裁判：夹具已建立但裁判实现属 t30b，禁止静默通过' "status=$status"
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
  Reset-AttachmentDirectory | Out-Null

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
  if (-not (Test-Path -LiteralPath $appBinary)) { throw "Rain debug binary not found: $appBinary" }

  # 合成媒体优先（无外部工具依赖）：WAV 由 Node 生成，时长显式声明并写入诊断。
  # 该文件是否被 <video> 接受、currentTime 是否真实推进，由 t30b 的学习页探针回答。
  $mediaPath = Join-Path $runRoot 'rain-study-catalog-media.wav'
  $mediaDeclarationSeconds = 14
  & node -e @"
const fs = require('fs')
const rate = 8000, seconds = $mediaDeclarationSeconds, samples = rate * seconds
const data = Buffer.alloc(samples * 2)
const header = Buffer.alloc(44)
header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8)
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
header.write('data', 36); header.writeUInt32LE(data.length, 40)
fs.writeFileSync(process.argv[1], Buffer.concat([header, data]))
"@ $mediaPath
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $mediaPath)) { throw 'Synthetic WAV fixture generation failed.' }
  $script:facts['mediaPath'] = 'isolated-run-root (not uploaded)'
  $script:facts['mediaDeclarationSeconds'] = $mediaDeclarationSeconds
  $script:facts['mediaBytes'] = (Get-Item -LiteralPath $mediaPath).Length

  $env:RAIN_E2E_MODE = '1'
  $env:RAIN_E2E_RUN_MODE = 'study-catalog'
  $env:RAIN_E2E_DB_PATH = $databasePath
  $env:RAIN_E2E_VIDEO_PATH = $mediaPath

  $phase = 'driver-start'
  $driverProcess = Start-Process -FilePath $tauriDriver -ArgumentList @(
    '--port', [string]$DriverPort,
    '--native-port', [string]$NativeDriverPort,
    '--native-driver', $edgeDriver
  ) -RedirectStandardOutput $driverLog -RedirectStandardError $driverErrorLog -WindowStyle Hidden -PassThru
  Wait-WebDriver $DriverPort

  $phase = 'initial-startup'
  $sessionId = New-WebDriverSession $appBinary
  Wait-WebDriverCondition $sessionId 'the video list page' "return Boolean(document.querySelector('$listPageSelector'));"

  $phase = 'capability-probe'
  Write-Output 'Study Catalog E2E phase: host capability probe (/element/{id}/rect, W3C /actions)'
  Assert-HostCapabilities $sessionId
  Write-Output "Study Catalog E2E probe: rect=$($script:facts['elementRectEndpoint']) actions=$($script:facts['actionsEndpoint'])"

  $phase = 'fixture-availability'
  Write-Output 'Study Catalog E2E phase: catalog fixture availability'
  Assert-CatalogFixtureAvailability $sessionId

  $runSucceeded = $true
  Write-Output 'Study Catalog desktop E2E passed.'
} catch {
  $primaryError = $_
} finally {
  if ($sessionId) { try { Close-WebDriverSession $sessionId } catch { } }
  if ($driverProcess -and -not $driverProcess.HasExited) {
    Stop-Process -Id $driverProcess.Id -Force -ErrorAction SilentlyContinue
    $driverProcess.WaitForExit(5000) | Out-Null
  }
  if ($primaryError) {
    try { Save-FailureDiagnostics $phase $primaryError } catch {
      Write-Warning "Study Catalog E2E diagnostic capture also failed: $($_.Exception.Message)"
    }
  }
  if (Test-Path -LiteralPath $runRoot) {
    $resolvedRunRoot = [System.IO.Path]::GetFullPath($runRoot)
    $safePrefix = $temporaryRoot.TrimEnd('\') + '\rain-study-catalog-e2e-'
    if (-not $resolvedRunRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove unexpected Study Catalog E2E directory: $resolvedRunRoot"
    }
    for ($attempt = 0; $attempt -lt 10 -and (Test-Path -LiteralPath $resolvedRunRoot); $attempt++) {
      try { Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force } catch { Start-Sleep -Milliseconds 250 }
    }
  }
  if (-not $primaryError) { Remove-FailureDiagnostics }
}
if ($primaryError) { throw $primaryError }
