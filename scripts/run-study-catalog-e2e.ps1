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
      'AC-SU-01 的裁判是真实 WebDriver 读到的桌面 DOM 与真实操作/滚动；截图最多 1 张，且只来自隔离 fixture。',
      '本目录还包含 success-facts.json（成功路径的判据事实；不是截图，同样不构成 Visual Evidence）。',
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

function Get-JudgeFactSnapshot() {
  # SR-t52-4：成功 run 也必须可审——按固定顺序取出判据事实（没有的值就是 null，绝不造值）。
  # 目的：使「② 的 2px 容差是否有托管实测依据」与握手等待在 GREEN run 上同样可观测。
  return [ordered]@{
    status = 'passed'
    phase = 'judge-complete'
    command = 'npm run e2e:study-catalog'
    createdAt = [DateTimeOffset]::Now.ToString('o')
    headSha = $env:GITHUB_SHA
    runId = $env:GITHUB_RUN_ID
    webView2Runtime = $env:RAIN_E2E_WEBVIEW2_VERSION
    mediaDeclarationSeconds = $mediaDeclarationSeconds
    mediaPath = 'isolated-run-root (not uploaded)'
    elementRectEndpoint = $script:facts['elementRectEndpoint']
    actionsEndpoint = $script:facts['actionsEndpoint']
    fixtureInterfaceStatus = $script:facts['fixtureInterfaceStatus']
    fixtureInterfaceWaitSamples = $script:facts['fixtureInterfaceWaitSamples']
    fixtureInterfaceWaitElapsedMs = $script:facts['fixtureInterfaceWaitElapsedMs']
    fixtureInterfaceWaitCriterion = $script:facts['fixtureInterfaceWaitCriterion']
    fixtureStatusAfterRestart = $script:facts['fixtureStatusAfterRestart']
    cardButtonCount = $script:facts['cardButtonCount']
    restartWaitSamples = $script:facts['restartWaitSamples']
    restartWaitElapsedMs = $script:facts['restartWaitElapsedMs']
    restartWaitLastState = $script:facts['restartWaitLastState']
    restartWaitCriterion = $script:facts['restartWaitCriterion']
    catalogFixtureDeclaration = $script:facts['catalogFixtureDeclaration']
    catalogExpectedItemCounts = $script:facts['catalogExpectedItemCounts']
    structureRowExtent = $script:facts['structureRowExtent']
    structureRowOwnerWidth = $script:facts['structureRowOwnerWidth']
    paragraphRowExtent = $script:facts['paragraphRowExtent']
    paragraphRowOwnerWidth = $script:facts['paragraphRowOwnerWidth']
    wavPlayback = $script:facts['wavPlayback']
    layoutProportions = $script:facts['layoutProportions']
    panelTabs = $script:facts['panelTabs']
    currentItemTargetText = $script:facts['currentItemTargetText']
    currentItemText = $script:facts['currentItemText']
    currentItemCenterDeltaPx = $script:facts['currentItemCenterDeltaPx']
    currentItemCenterTolerancePx = $script:facts['currentItemCenterTolerancePx']
    currentItemCenterSamples = $script:facts['currentItemCenterSamples']
    pauseFollowRowBaselineAtStart = $script:facts['pauseFollowRowBaselineAtStart']
    pauseFollowPlayAdvance = $script:facts['pauseFollowPlayAdvance']
    pauseFollowPlayCenteredDeltaPx = $script:facts['pauseFollowPlayCenteredDeltaPx']
    pauseFollowAfterPlayRoundTrip = $script:facts['pauseFollowAfterPlayRoundTrip']
    pauseFollowWitness = ($script:facts['pauseFollowWitness'] -join ' || ')
    structureRowScrollMetrics = $script:facts['structureRowScrollMetrics']
    paragraphRowScrollMetrics = $script:facts['paragraphRowScrollMetrics']
    note = '成功路径的判据事实（附件；不是截图，不构成 Visual Evidence）。'
  }
}

function Save-SuccessFacts() {
  # SR-t52-4：把成功路径的判据事实写到**成功时会上传的附件目录**（workflow 的 success 上传路径就是它）
  # 并打进运行日志，使 GREEN run 的 ② 容差、握手等待与夹具事实都可被独立复审读取，而不是只存在于失败 summary.json。
  $snapshot = Get-JudgeFactSnapshot
  [System.IO.File]::WriteAllText(
    (Join-Path $attachmentRoot 'success-facts.json'),
    (ConvertTo-Json -InputObject $snapshot -Depth 6),
    [System.Text.UTF8Encoding]::new($false)
  )
  Write-Output 'Study Catalog E2E success facts (also written to the attachment directory as success-facts.json):'
  Write-Output ("  judge2 currentItemText={0} currentItemCenterDeltaPx={1} currentItemCenterTolerancePx={2} samples={3}" -f $snapshot['currentItemText'], $snapshot['currentItemCenterDeltaPx'], $snapshot['currentItemCenterTolerancePx'], $snapshot['currentItemCenterSamples'])
  Write-Output ("  handshake fixtureInterfaceStatus={0} fixtureWaitSamples={1} fixtureWaitElapsedMs={2} fixtureStatusAfterRestart={3} cardButtonCount={4} restartWaitSamples={5} restartWaitElapsedMs={6} restartWaitLastState='{7}'" -f $snapshot['fixtureInterfaceStatus'], $snapshot['fixtureInterfaceWaitSamples'], $snapshot['fixtureInterfaceWaitElapsedMs'], $snapshot['fixtureStatusAfterRestart'], $snapshot['cardButtonCount'], $snapshot['restartWaitSamples'], $snapshot['restartWaitElapsedMs'], $snapshot['restartWaitLastState'])
  Write-Output ("  rows structure={0}/{1} paragraph={2}/{3} wavPlayback={4}" -f $snapshot['structureRowExtent'], $snapshot['structureRowOwnerWidth'], $snapshot['paragraphRowExtent'], $snapshot['paragraphRowOwnerWidth'], $snapshot['wavPlayback'])
  return $snapshot
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

function Wait-CatalogFixtureInterface([string]$SessionId, [int]$DeadlineSeconds) {
  # STD-69-11：夹具接口由 runner 异步武装——它先 `await getDb()` + `await getVideoById()`（查询解析完成后）
  # 才 `publishCatalogFixture(...)`（src/e2e/real-e2e-runner.tsx:809-815）。因此「生产列表页已存在」
  # ≠「接口已武装」：立即读取会拿到 absent，并被误归因为「隔离库没有夹具行」（1a80de5 的 run 36312689535
  # 读到 seeded + 2 张卡，9271305 的 run 36313834100 读到 absent + 0 张卡，同一段逻辑）。
  # 这里只做有界轮询、不做状态假设；超时后由调用方按 absent / idle / failed 三态分别报出。
  $deadline = (Get-Date).AddSeconds($DeadlineSeconds)
  $started = Get-Date
  $samples = 0
  $status = 'absent'
  do {
    $samples += 1
    $status = [string](Invoke-WebDriverScript $SessionId @"
const fixture = $fixtureInterface;
if (!fixture || typeof fixture !== 'object') return 'absent';
return String(fixture.status || 'unknown');
"@)
    if ($status -ne 'absent') { break }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  # 等待耗时也是判据事实（t55/SR-t52-4）：成功与失败两侧都写入 observed。
  return @{ status = $status; samples = $samples; elapsedMs = [int]((Get-Date) - $started).TotalMilliseconds }
}

function Assert-CatalogFixtureAvailability([string]$SessionId) {
  # 首次启动的**正确**状态就是 idle（真实空库），故这里只等「接口已武装」，不要求任何特定状态。
  $waitSeconds = [Math]::Min(30, $MaxSeconds)
  $probe = Wait-CatalogFixtureInterface $SessionId $waitSeconds
  $status = [string]$probe.status
  $script:facts['fixtureInterfaceStatus'] = $status
  $script:facts['fixtureInterfaceWaitSamples'] = $probe.samples
  $script:facts['fixtureInterfaceWaitElapsedMs'] = $probe.elapsedMs
  $script:facts['fixtureInterfaceWaitCriterion'] = "fixture interface published within $waitSeconds s (500ms poll)"
  # 该 fact 记录的是「生产视频列表页是否出现」，名字必须与语义一致（t34 自曝缺陷的修正）。
  $script:facts['videoListPagePresent'] = [bool](Find-WebDriverElement $SessionId $listPageSelector -AllowMissing)
  if ($status -eq 'absent') {
    Fail-Condition 'AC-SU-01 的桌面条件无法判定：学习页长目录受控夹具公开接口在等待窗口内始终未武装（app 仍在启动或 runner 未进入 study-catalog 短模式）' "interface=$fixtureInterface status=absent samples=$($probe.samples)"
  }
  if ($status -eq 'failed') {
    Fail-Condition '学习页长目录受控夹具公开接口报告建立失败' "status=failed"
  }
}

function Request-CatalogFixtureSeed([string]$SessionId) {
  $requested = [string](Invoke-WebDriverScript $SessionId @"
const fixture = $fixtureInterface;
if (!fixture || typeof fixture.seed !== 'function') return 'absent';
fixture.seed();
return 'requested';
"@)
  if ($requested -ne 'requested') {
    Fail-Condition '受控夹具公开接口缺少 seed：无法建立学习页长目录' "observed='$requested'"
  }
  Wait-WebDriverCondition $SessionId 'the controlled catalog fixture publication' @"
const fixture = $fixtureInterface;
if (!fixture) return false;
return fixture.status === 'seeded' || fixture.status === 'failed';
"@
  $declared = [string](Invoke-WebDriverScript $SessionId @"
const fixture = $fixtureInterface;
return JSON.stringify({ status: fixture.status, durationSeconds: fixture.durationSeconds, videoId: fixture.videoId, currentNodeId: fixture.currentNodeId, chapterCount: fixture.chapterCount, sectionCount: fixture.sectionCount, paragraphCount: fixture.paragraphCount, error: fixture.error || null });
"@)
  $script:facts['catalogFixtureDeclaration'] = $declared
  if ($declared -notmatch '"status":"seeded"') {
    Fail-Condition '受控夹具未建立：学习页长目录未能写入隔离数据库' "declaration=$declared"
  }
}

function Assert-WavPlaybackAdvances([string]$SessionId) {
  # 真实点击生产播放按钮；currentTime/readyState/duration 用 execute/sync 读，
  # 标注为「真实媒体属性读」，不是驱动 DOM 事实。
  $playButton = Find-WebDriverElement $SessionId '[data-testid="control-bar"] button'
  Invoke-WebDriverElementClick $SessionId $playButton
  $deadline = (Get-Date).AddSeconds(30)
  $state = ''
  do {
    Start-Sleep -Milliseconds 500
    $state = [string](Invoke-WebDriverScript $SessionId @"
const video = document.querySelector('video');
if (!video) return '{"present":false}';
return JSON.stringify({ present: true, currentTime: video.currentTime, readyState: video.readyState, duration: video.duration, paused: video.paused, errorCode: video.error ? video.error.code : null });
"@)
  } while ($state -notmatch '"currentTime":(1[0-9]|[2-9][0-9])' -and (Get-Date) -lt $deadline)
  $script:facts['wavPlayback'] = $state
  if ($state -notmatch '"currentTime":(1[0-9]|[2-9][0-9])') {
    Fail-Condition '合成 WAV 未被 <video> 接受或未推进：真实播放 30s 内 currentTime 未到 10（该结论决定下一段是否改用 CI 内 ffmpeg 生成的媒体形态）' "observed=$state"
  }
  $pauseButton = Find-WebDriverElement $SessionId '[data-testid="control-bar"] button'
  Invoke-WebDriverElementClick $SessionId $pauseButton
}

function Assert-CatalogTwoRowStructure([string]$SessionId) {
  # ① 长目录两行结构 + 真实横向溢出：几何全部用驱动元素端点读真实 DOM。
  # 行项判据 = [data-catalog-scroll-row="<level>"] > span（生产 CatalogBar 的真实行项：只带
  # data-catalog-current + 文本 + onClick=onSeek(startTime)，见 src/ui/components/catalog.tsx:336-346）。
  # 旧判据 progress-indicator-*（属 SideTree，catalog.tsx:246）与 paragraph-*（属文本区）不在两行滚动区内，
  # 命中 0 属选择器错误（t49/t50 定位），这里改为真实行项并用夹具声明交叉校验条数。
  $declaration = [string]$script:facts['catalogFixtureDeclaration']
  $declared = $null
  try { $declared = ConvertFrom-Json $declaration } catch { $declared = $null }
  if ($null -eq $declared -or $null -eq $declared.chapterCount -or $null -eq $declared.sectionCount -or $null -eq $declared.paragraphCount) {
    $script:facts['catalogRowItemCalibration'] = Get-CatalogRowItemCalibration $SessionId
    Fail-Condition '两行条数无法判定：夹具声明的 chapterCount/sectionCount/paragraphCount 不完整' "declaration=$declaration"
  }
  $expectedStructureItems = [int]$declared.chapterCount + [int]$declared.sectionCount
  $expectedParagraphItems = [int]$declared.paragraphCount
  $script:facts['catalogExpectedItemCounts'] = "structure=$expectedStructureItems (chapters=$($declared.chapterCount)+sections=$($declared.sectionCount)) paragraph=$expectedParagraphItems"
  foreach ($level in @('structure', 'paragraph')) {
    Find-WebDriverElement $SessionId "[data-catalog-row=""$level""]" | Out-Null
    $owner = Find-WebDriverElement $SessionId "[data-catalog-scroll-row=""$level""]"
    $items = Get-CatalogRowItems $SessionId $level
    if ($items.Count -lt 2) {
      $script:facts['catalogRowItemCalibration'] = Get-CatalogRowItemCalibration $SessionId
      Fail-Condition "长目录 $level 行缺少可裁判的真实行项" "count=$($items.Count) selector=[data-catalog-scroll-row='$level'] > span"
    }
    $ownerRect = Get-WebDriverElementRect $SessionId $owner
    $firstRect = Get-WebDriverElementRect $SessionId $items[0]
    $lastRect = Get-WebDriverElementRect $SessionId $items[$items.Count - 1]
    $extent = ([double]$lastRect.x + [double]$lastRect.width) - [double]$firstRect.x
    $script:facts["${level}RowOwnerWidth"] = $ownerRect.width
    $script:facts["${level}RowExtent"] = $extent
    $script:facts["${level}RowChildren"] = $items.Count
    $expectedItems = if ($level -eq 'structure') { $expectedStructureItems } else { $expectedParagraphItems }
    # STD-69-13b：绝对下限守卫。等值断言只保证「与夹具声明一致」，声明本身若缩水就失去规模守卫；
    # 因此另设与声明无关的绝对下限（两行都 ≥24 项）。真正的规模守卫仍是几何代理——真实横向溢出
    # （extent > ownerWidth，托管实测为 owner 视口的 5.1×/4.9×）；行项少到一定程度该代理就不成立。
    if ($items.Count -lt 24) {
      $script:facts['catalogRowItemCalibration'] = Get-CatalogRowItemCalibration $SessionId
      Fail-Condition "长目录 $level 行规模低于绝对下限：无法构成「长目录、横向可滚动、需要边缘渐隐」" "count=$($items.Count) floor=24"
    }
    if ($items.Count -ne $expectedItems) {
      $script:facts['catalogRowItemCalibration'] = Get-CatalogRowItemCalibration $SessionId
      Fail-Condition "长目录 $level 行项数与夹具声明不一致" "count=$($items.Count) expected=$expectedItems declaration=$declaration"
    }
    if ($extent -le [double]$ownerRect.width) {
      Fail-Condition "长目录 $level 行没有真实横向溢出（横向不换行条件不成立）" "extent=$extent ownerWidth=$($ownerRect.width) items=$($items.Count)"
    }
  }
  $structureItems = Get-CatalogRowItems $SessionId 'structure'
  $paragraphItems = Get-CatalogRowItems $SessionId 'paragraph'
  $script:facts['structureItemCount'] = $structureItems.Count
  $script:facts['paragraphItemCount'] = $paragraphItems.Count
  # 行项语义 + 定标事实（来源标注）：tagName / 文本 / data-catalog-current 计数一次读齐。
  $script:facts['catalogRowItemSemantics'] = [string](Invoke-WebDriverScript $SessionId @"
const levels = ['structure', 'paragraph'];
const rows = {};
for (const level of levels) {
  const owner = document.querySelector('[data-catalog-scroll-row="' + level + '"]');
  const children = owner ? Array.from(owner.children) : [];
  rows[level] = {
    childCount: children.length,
    spanCount: children.filter((child) => child.tagName === 'SPAN').length,
    emptyTextCount: children.filter((child) => (child.textContent || '').trim() === '').length,
    currentCount: children.filter((child) => child.getAttribute('data-catalog-current') === 'true').length,
    firstText: children.length ? (children[0].textContent || '').trim().slice(0, 20) : null,
    lastText: children.length ? (children[children.length - 1].textContent || '').trim().slice(0, 20) : null,
  };
}
return JSON.stringify(rows);
"@)
  foreach ($level in @('structure', 'paragraph')) {
    $semantics = $null
    try { $semantics = (ConvertFrom-Json $script:facts['catalogRowItemSemantics']).$level } catch { $semantics = $null }
    if ($null -eq $semantics -or [int]$semantics.childCount -ne [int]$semantics.spanCount) {
      $script:facts['catalogRowItemCalibration'] = Get-CatalogRowItemCalibration $SessionId
      Fail-Condition "长目录 $level 行项不是稳定的真实行项（存在非 <span> 子节点）" "semantics=$($script:facts['catalogRowItemSemantics'])"
    }
  }
  # 补充证据（来源标注）：computed style 只作补充，不单独判决。
  $script:facts['catalogRowComputedStyle'] = [string](Invoke-WebDriverScript $SessionId @"
const rows = Array.from(document.querySelectorAll('[data-catalog-scroll-row]'));
return JSON.stringify(rows.map((row) => { const style = getComputedStyle(row); return { level: row.getAttribute('data-catalog-scroll-row'), overflowX: style.overflowX, flexWrap: style.flexWrap }; }));
"@)
}

function Invoke-WebDriverWheelScroll([string]$SessionId, [string]$ElementId, [int]$DeltaX) {
  # 真实滚轮输入（W3C /actions wheel，origin = 目标元素）；t34 探针已证明 /actions 受支持。
  Invoke-WebDriver 'Post' "/session/$SessionId/actions" @{
    actions = @(@{
      type = 'wheel'
      id = 'wheel-1'
      actions = @(@{ type = 'scroll'; origin = @{ $elementKey = $ElementId }; x = 0; y = 0; deltaX = $DeltaX; deltaY = 0; duration = 100 })
    })
  } | Out-Null
  Invoke-WebDriver 'Delete' "/session/$SessionId/actions" | Out-Null
  Start-Sleep -Milliseconds 250
}

function Get-WebDriverRowScrollLeft([string]$SessionId, [string]$Level) {
  # scrollLeft 没有 W3C 端点：用 execute/sync 读真实 DOM 属性（可观测结果，不是替身判定）。
  return (Invoke-WebDriverScript $SessionId @"
const row = document.querySelector('[data-catalog-scroll-row="$Level"]');
return row ? String(row.scrollLeft) : 'absent';
"@).ToString().Trim()
}

function Invoke-WebDriverPointerClick([string]$SessionId, [string]$ElementId) {
  # 真实指针点击（W3C /actions pointer source）：`origin` = 目标元素、偏移 (0,0) = 该元素的 **in-view centre**。
  # 与 element-click 端点（POST /element/{id}/click）不同，pointerMove 不做「点击前先滚入视野」，
  # 因此不会污染滚动基线——这正是 t56 诊断出的第④项 RED 根因（run 36314741172：baseline=2072 → after=0，
  # 目标行项 index 0 在可视框外，element-click 的预滚把它滚进视野）。
  # 前置：目标的 in-view centre 必须已在视口内（调用方先用真实滚轮把它滚入视野），否则端点报 out of bounds。
  Invoke-WebDriver 'Post' "/session/$SessionId/actions" @{
    actions = @(@{
      type = 'pointer'
      id = 'pointer-1'
      parameters = @{ pointerType = 'mouse' }
      actions = @(
        @{ type = 'pointerMove'; duration = 0; origin = @{ $elementKey = $ElementId }; x = 0; y = 0 },
        @{ type = 'pointerDown'; button = 0 },
        @{ type = 'pointerUp'; button = 0 }
      )
    })
  } | Out-Null
  Invoke-WebDriver 'Delete' "/session/$SessionId/actions" | Out-Null
  Start-Sleep -Milliseconds 250
}

function Get-CatalogRowScrollMetrics([string]$SessionId, [string]$Level) {
  # 行 owner 的滚动度量（read-only DOM 事实，不参与判决，只作痕迹与可见性解释）。
  return [string](Invoke-WebDriverScript $SessionId @"
const row = document.querySelector('[data-catalog-scroll-row="$Level"]');
if (!row) return '{"present":false}';
return JSON.stringify({ present: true, scrollLeft: row.scrollLeft, scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, maximumScrollLeft: Math.max(0, row.scrollWidth - row.clientWidth) });
"@)
}

function Get-CatalogRowItemVisibility([string]$SessionId, [string]$Level, [string]$ItemId) {
  # 目标行项相对行 owner 可见框的可见性（全部用驱动 rect 端点读真实几何，不用 JS 几何代理）。
  $owner = Find-WebDriverElement $SessionId "[data-catalog-scroll-row=""$Level""]"
  $ownerRect = Get-WebDriverElementRect $SessionId $owner
  $itemRect = Get-WebDriverElementRect $SessionId $ItemId
  $itemLeft = [double]$itemRect.x
  $itemRight = $itemLeft + [double]$itemRect.width
  $ownerLeft = [double]$ownerRect.x
  $ownerRight = $ownerLeft + [double]$ownerRect.width
  return [ordered]@{
    itemLeft = $itemLeft
    itemWidth = [double]$itemRect.width
    ownerLeft = $ownerLeft
    ownerWidth = [double]$ownerRect.width
    fullyInside = (($itemLeft -ge $ownerLeft) -and ($itemRight -le $ownerRight))
  }
}

function Move-CatalogRowItemIntoView([string]$SessionId, [string]$Level, [string]$TargetText, [int]$MaxSteps, [string]$FactPrefix) {
  # 用**真实滚轮**（/actions wheel，origin = 行 owner）把目标行项滚入 owner 可视框：不用任何 JS 滚动，
  # 也不用 element-click（其预滚语义会污染基线）。每步把行项中心与 owner 中心对齐（单步限 ±800px），
  # 收敛后目标行项完整落在可见框内，才可以对它发 in-view centre 的真实指针点击。
  # 宿主符号约定（本脚本实测，勿反）：**正 deltaX 增大 scrollLeft**——依据同脚本 Assert-FadeOwners 的实测：
  # `for (… -lt 4) { … 200 }` → scrollLeft=800；`for (… -lt 16) { … 2000 }` → max 2072；
  # 左端回滚的 `-2000` → scrollLeft 回到 0。因此步长必须是「行项中心 − owner 中心」：
  # 行项在右 ⇒ 正 ⇒ 增大 scrollLeft；行项在左 ⇒ 负 ⇒ 减小 scrollLeft。
  # 历史缺陷（t60 三方诊断，run 36321757895）：此处原写成 `ownerCenter - itemCenter`（符号反向）⇒
  # 目标在最左而行已在 max 2072 时每步都被钳制，8 步零位移（恒等式 ownerLeft − scrollLeft = itemLeft = −1872 吻合）。
  $owner = Find-WebDriverElement $SessionId "[data-catalog-scroll-row=""$Level""]"
  $steps = 0
  $stepFacts = @()
  $item = Find-CatalogRowItemByText $SessionId $Level $TargetText
  if ($null -eq $item) { return @{ itemId = $null; steps = $steps; visibility = $null } }
  $visibility = Get-CatalogRowItemVisibility $SessionId $Level $item
  while (-not $visibility.fullyInside -and $steps -lt $MaxSteps) {
    $ownerRect = Get-WebDriverElementRect $SessionId $owner
    $itemRect = Get-WebDriverElementRect $SessionId $item
    $ownerCenter = [double]$ownerRect.x + ([double]$ownerRect.width / 2)
    $itemCenter = [double]$itemRect.x + ([double]$itemRect.width / 2)
    $delta = [int][Math]::Round($itemCenter - $ownerCenter)
    if ($delta -eq 0) { break }
    if ($delta -gt 800) { $delta = 800 }
    if ($delta -lt -800) { $delta = -800 }
    $scrollLeftBefore = Get-WebDriverRowScrollLeft $SessionId $Level
    Invoke-WebDriverWheelScroll $SessionId $owner $delta
    $steps += 1
    $scrollLeftAfter = Get-WebDriverRowScrollLeft $SessionId $Level
    $stepFacts += "step=$steps delta=$delta scrollLeftBefore=$scrollLeftBefore scrollLeftAfter=$scrollLeftAfter"
    $script:facts["${FactPrefix}IntoViewSteps-$TargetText"] = ($stepFacts -join ' | ')
    # SR-t58-2 / STD-69-16：无进展即立刻以具名条件 Fail——不再安静烧完上界步数
    # （t60 的 RED 正是被「8 步空转但只报最后状态」掩盖的）。
    if ([double]$scrollLeftAfter -eq [double]$scrollLeftBefore) {
      Fail-Condition "第④项前置不成立：真实滚轮该步无进展（滚动方向可能反向，或该方向已到滚动极限）" "item=$TargetText step=$steps delta=$delta scrollLeftBefore=$scrollLeftBefore scrollLeftAfter=$scrollLeftAfter rowMetrics=$(Get-CatalogRowScrollMetrics $SessionId $Level)"
    }
    $item = Find-CatalogRowItemByText $SessionId $Level $TargetText
    if ($null -eq $item) { return @{ itemId = $null; steps = $steps; visibility = $null } }
    $visibility = Get-CatalogRowItemVisibility $SessionId $Level $item
  }
  return @{ itemId = $item; steps = $steps; visibility = $visibility }
}

function Get-StructureItemTimeWindow([string]$Text, $Declaration) {
  # 目标行项的时间窗由夹具声明（durationSeconds / chapterCount / sectionCount）推导，不使用魔数。
  if ($null -eq $Declaration) { return $null }
  $duration = [double]$Declaration.durationSeconds
  $chapters = [int]$Declaration.chapterCount
  $sections = [int]$Declaration.sectionCount
  if ($duration -le 0 -or $chapters -le 0 -or $sections -le 0) { return $null }
  $chapterSpan = $duration / $chapters
  $sectionsPerChapter = $sections / $chapters
  if ($Text -match '^E2E 章节 (\d+)$') {
    $index = [int]$Matches[1]
    return @{ start = ($index - 1) * $chapterSpan; end = $index * $chapterSpan }
  }
  if ($Text -match '^E2E 小节 (\d+)\.(\d+)$') {
    $chapter = [int]$Matches[1]
    $section = [int]$Matches[2]
    $sectionSpan = $chapterSpan / $sectionsPerChapter
    $start = ($chapter - 1) * $chapterSpan + ($section - 1) * $sectionSpan
    return @{ start = $start; end = $start + $sectionSpan }
  }
  return $null
}

function Get-CatalogRowItems([string]$SessionId, [string]$Level) {
  # 真实行项 = 两行滚动 owner 下的 <span> 子项（生产 CatalogBar.renderNode 的产物）。
  return @(Find-WebDriverElements $SessionId "[data-catalog-scroll-row=""$Level""] > span")
}

function Find-CatalogRowItemByText([string]$SessionId, [string]$Level, [string]$Text) {
  foreach ($item in Get-CatalogRowItems $SessionId $Level) {
    if ((Get-WebDriverElementText $SessionId $item).Trim() -eq $Text) { return $item }
  }
  return $null
}

function Get-CatalogCurrentItem([string]$SessionId, [string]$Level) {
  $current = @(Find-WebDriverElements $SessionId "[data-catalog-scroll-row=""$Level""] > span[data-catalog-current=""true""]")
  $script:facts["${Level}CurrentItemCount"] = $current.Count
  if ($current.Count -ne 1) { return $null }
  return $current[0]
}

function Get-CatalogRowItemCalibration([string]$SessionId) {
  # 选择器/计数不成立时的定标事实（SU1-6）：一次 run 就能定标 ①②③ 的全部选择器，而不是每轮只发现一处。
  return [string](Invoke-WebDriverScript $SessionId @"
const levels = ['structure', 'paragraph'];
const describe = (element) => ({
  tagName: element.tagName,
  testId: element.getAttribute('data-testid'),
  current: element.getAttribute('data-catalog-current'),
  text: (element.textContent || '').trim().slice(0, 20),
});
const rows = {};
for (const level of levels) {
  const owner = document.querySelector('[data-catalog-scroll-row="' + level + '"]');
  rows[level] = {
    rowPresent: Boolean(document.querySelector('[data-catalog-row="' + level + '"]')),
    ownerPresent: Boolean(owner),
    childCount: owner ? owner.children.length : 0,
    items: owner ? Array.from(owner.children).slice(0, 40).map(describe) : [],
  };
}
const fades = Array.from(document.querySelectorAll('[data-testid^="catalog-fade-"]')).map((fade) => ({
  testId: fade.getAttribute('data-testid'),
  ariaHidden: fade.getAttribute('aria-hidden'),
}));
return JSON.stringify({
  rows,
  catalogBarPresent: Boolean(document.querySelector('[data-testid="catalog-bar"]')),
  sideTreePresent: Boolean(document.querySelector('[data-testid="side-tree"]')),
  fadeElements: fades,
});
"@)
}

function Wait-CatalogCurrentItemCentered([string]$SessionId, [string]$Level, [double]$TolerancePx, [int]$DeadlineSeconds) {
  # 当前项 = 生产自己标记的 [data-catalog-current="true"]（必须唯一）；判据是它的几何中心与行 owner 中心的差 ≤ 容差。
  $owner = Find-WebDriverElement $SessionId "[data-catalog-scroll-row=""$Level""]"
  $deadline = (Get-Date).AddSeconds($DeadlineSeconds)
  $delta = $null
  $currentText = $null
  $samples = 0
  do {
    $samples += 1
    $current = Get-CatalogCurrentItem $SessionId $Level
    if ($null -ne $current) {
      $itemRect = Get-WebDriverElementRect $SessionId $current
      $ownerRect = Get-WebDriverElementRect $SessionId $owner
      $itemCenter = [double]$itemRect.x + ([double]$itemRect.width / 2)
      $ownerCenter = [double]$ownerRect.x + ([double]$ownerRect.width / 2)
      $delta = [Math]::Abs($itemCenter - $ownerCenter)
      $currentText = (Get-WebDriverElementText $SessionId $current).Trim()
    }
    if ($null -ne $delta -and [double]$delta -le $TolerancePx) { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  return @{ delta = $delta; currentText = $currentText; samples = $samples }
}

function Assert-CurrentItemCentered([string]$SessionId) {
  # ② 当前项居中跟随：真实点击中段行项「E2E 章节 5」（生产 onClick=onSeek(startTime)；第 5 章起点 = 4×1.75s），
  # 再断言生产自己的当前项标记 [data-catalog-current="true"] 被居中（跟随只在 isPlaying 为真时生效，
  # 见 src/ui/components/catalog.tsx:306-316，因此先经真实播放按钮进入播放态）。
  # 容差依据：生产的 scrollIntoView({block:'nearest', inline:'center'}) 只做子像素对齐，目录行无额外内边距；
  # 2px 属待托管实测标定值：若实测更大，必须先记录实测值与依据再定标（禁止无依据放大）。
  $tolerancePx = 2.0
  $level = 'structure'
  $targetText = 'E2E 章节 5'
  $pausedBefore = [string](Invoke-WebDriverScript $SessionId 'const video = document.querySelector("video"); return String(video ? video.paused : "absent");')
  if ($pausedBefore -eq 'True') {
    Invoke-WebDriverElementClick $SessionId (Find-WebDriverElement $SessionId '[data-testid="control-bar"] button')
    Start-Sleep -Milliseconds 500
  }
  $script:facts['currentItemFollowMediaState'] = 'pausedBefore=' + $pausedBefore + ' currentTime=' + [string](Invoke-WebDriverScript $SessionId 'const video = document.querySelector("video"); return String(video ? video.currentTime : -1);')
  $target = Find-CatalogRowItemByText $SessionId $level $targetText
  if ($null -eq $target) {
    $script:facts['catalogRowItemCalibration'] = Get-CatalogRowItemCalibration $SessionId
    Fail-Condition "第②项不成立：结构行找不到真实行项「$targetText」" "rowItems=$((Get-CatalogRowItems $SessionId $level).Count)"
  }
  $script:facts['currentItemTargetText'] = $targetText
  Invoke-WebDriverElementClick $SessionId $target
  $result = Wait-CatalogCurrentItemCentered $SessionId $level $tolerancePx 5
  $script:facts['currentItemCenterDeltaPx'] = $result.delta
  $script:facts['currentItemCenterTolerancePx'] = $tolerancePx
  $script:facts['currentItemText'] = $result.currentText
  $script:facts['currentItemCenterSamples'] = $result.samples
  $failed = ($null -eq $result.delta -or [double]$result.delta -gt $tolerancePx)
  if ($failed) { $script:facts['catalogRowItemCalibration'] = Get-CatalogRowItemCalibration $SessionId }
  # 无论成败都恢复暂停态：裁判③（真实滚轮）与裁判④（暂停后不跟随）都以暂停为前提。
  Invoke-WebDriverElementClick $SessionId (Find-WebDriverElement $SessionId '[data-testid="control-bar"] button')
  Start-Sleep -Milliseconds 300
  $script:facts['currentItemFollowPausedAfter'] = [string](Invoke-WebDriverScript $SessionId 'const video = document.querySelector("video"); return String(video ? video.paused : "absent");')
  if ($failed) {
    Fail-Condition '第②项不成立：真实点击中段行项后生产当前项未被居中跟随' "centerDeltaPx=$($result.delta) tolerance=$tolerancePx currentItem='$($result.currentText)' samples=$($result.samples)"
  }
}

function Assert-FadeOwners([string]$SessionId) {
  # ③ 边缘渐隐 owner：初态只右 → 真实滚轮至中段两侧同时 → 末端只左；
  # 每处核对 aria-hidden / pointer-events / 方向渐变（computed style 仅作标注补充证据）。
  foreach ($level in @('structure', 'paragraph')) {
    $owner = Find-WebDriverElement $SessionId "[data-catalog-scroll-row=""$level""]"
    # 前置：裁判②已把两行滚到中段（它判的就是居中跟随），因此这里先用**真实滚轮**（负 deltaX）
    # 把 owner 滚回左端，再断言左端「只右」。这只重置前置状态，不改渐隐判据（位置 → 方向），
    # 且回滚本身也是真实输入，不是用 JS 改写 scrollLeft。
    $edgeScrollLeft = Get-WebDriverRowScrollLeft $SessionId $level
    $edgeSteps = 0
    while ([double]$edgeScrollLeft -gt 0 -and $edgeSteps -lt 12) {
      Invoke-WebDriverWheelScroll $SessionId $owner -2000
      $edgeSteps += 1
      $edgeScrollLeft = Get-WebDriverRowScrollLeft $SessionId $level
    }
    $edgeScrollLeftFinal = [double](Get-WebDriverRowScrollLeft $SessionId $level)
    $script:facts["${level}FadeLeftEdge"] = "wheelSteps=$edgeSteps scrollLeft=$edgeScrollLeftFinal epsilon=0.5"
    # STD-69-13a：显式断言「已滚回左端」。生产的「左端」定义就是 `EDGE_FADE_EPSILON = 0.5`
    # （src/ui/components/catalog.tsx:76，:131/:132 用 `scrollLeft > EDGE_FADE_EPSILON` 决定左渐隐），
    # 因此该断言正是左端「只右」的边界条件，不留 ≤0.5px 的假通过窗口。
    if ($edgeScrollLeftFinal -gt 0.5) {
      Fail-Condition "第③项前置不成立：真实滚轮未把 $level 行滚回左端（scrollLeft 超过生产 EDGE_FADE_EPSILON 0.5）" "scrollLeft=$edgeScrollLeftFinal wheelSteps=$edgeSteps"
    }
    $leftSelector = "[data-testid=""catalog-fade-left-$level""]"
    $rightSelector = "[data-testid=""catalog-fade-right-$level""]"
    $initialLeft = Find-WebDriverElement $SessionId $leftSelector -AllowMissing
    $initialRight = Find-WebDriverElement $SessionId $rightSelector -AllowMissing
    $script:facts["${level}FadeInitial"] = "left=$([bool]$initialLeft) right=$([bool]$initialRight) scrollLeft=$(Get-WebDriverRowScrollLeft $SessionId $level)"
    if ($initialLeft -or -not $initialRight) {
      Fail-Condition "第③项不成立：$level 行初态不是「只右」" "$($script:facts["${level}FadeInitial"])"
    }
    for ($attempt = 0; $attempt -lt 4; $attempt++) { Invoke-WebDriverWheelScroll $SessionId $owner 200 }
    $midLeft = Find-WebDriverElement $SessionId $leftSelector -AllowMissing
    $midRight = Find-WebDriverElement $SessionId $rightSelector -AllowMissing
    $script:facts["${level}FadeMid"] = "left=$([bool]$midLeft) right=$([bool]$midRight) scrollLeft=$(Get-WebDriverRowScrollLeft $SessionId $level)"
    if (-not $midLeft -or -not $midRight) {
      Fail-Condition "第③项不成立：$level 行真实滚轮至中段后未同时出现两侧渐隐" "$($script:facts["${level}FadeMid"])"
    }
    foreach ($elementId in @($midLeft, $midRight)) {
      if ((Get-WebDriverElementAttribute $SessionId $elementId 'aria-hidden') -ne 'true') {
        Fail-Condition "第③项不成立：$level 行渐隐 owner 缺少 aria-hidden=true" ''
      }
    }
    for ($attempt = 0; $attempt -lt 16; $attempt++) { Invoke-WebDriverWheelScroll $SessionId $owner 2000 }
    $endLeft = Find-WebDriverElement $SessionId $leftSelector -AllowMissing
    $endRight = Find-WebDriverElement $SessionId $rightSelector -AllowMissing
    $script:facts["${level}FadeEnd"] = "left=$([bool]$endLeft) right=$([bool]$endRight) scrollLeft=$(Get-WebDriverRowScrollLeft $SessionId $level)"
    if (-not $endLeft -or $endRight) {
      Fail-Condition "第③项不成立：$level 行真实滚轮至末端后不是「只左」" "$($script:facts["${level}FadeEnd"])"
    }
  }
  # 标注来源的补充证据：pointer-events 与渐隐方向（computed style 无法用元素端点读取）。
  $script:facts['fadeComputedStyle'] = [string](Invoke-WebDriverScript $SessionId @"
const fades = Array.from(document.querySelectorAll('[data-testid^="catalog-fade-"]'));
return JSON.stringify(fades.map((fade) => { const style = getComputedStyle(fade); return { id: fade.getAttribute('data-testid'), pointerEvents: style.pointerEvents, backgroundImage: style.backgroundImage }; }));
"@)
  foreach ($entry in @(ConvertFrom-Json $script:facts['fadeComputedStyle'])) {
    if ($entry.pointerEvents -ne 'none') {
      Fail-Condition '第③项不成立：渐隐 owner 不是非交互（pointer-events 非 none）' "id=$($entry.id) pointerEvents=$($entry.pointerEvents)"
    }
    $expected = if ($entry.id -like '*fade-left-*') { 'to right' } else { 'to left' }
    if ($entry.backgroundImage -notmatch [regex]::Escape($expected)) {
      Fail-Condition '第③项不成立：渐隐方向渐变与 owner 方向不一致' "id=$($entry.id) backgroundImage=$($entry.backgroundImage)"
    }
  }
}

function Invoke-PausedCatalogSeek([string]$SessionId, [string]$TargetText, [string]$FactPrefix) {
  # 暂停态下的一次「公开目录 seek」：真实滚轮把目标行项滚入视野 → **重录两行基线** → /actions 真实指针
  # 点击该行项 in-view centre → 断言（①）媒体 currentTime 落入该行项时间窗（排除「其实没点到/没生效」的
  # 假通过）、（②）structure 与 paragraph **两行**的 scrollLeft 相对各自基线都不变。
  # 为什么不用 element-click：它有 UA「点击前先滚入视野」语义（t56 诊断：run 36314741172 的
  # baseline=2072 → after=0），会把基线污染成驱动行为而非产品行为。
  # 双行见证的理由：生产两个 follow effect 同门控（catalog.tsx:306-328），若真的强制跟随，两行会同时被居中。
  $declared = $null
  try { $declared = ConvertFrom-Json ([string]$script:facts['catalogFixtureDeclaration']) } catch { $declared = $null }
  $window = Get-StructureItemTimeWindow $TargetText $declared
  if ($null -eq $window) {
    Fail-Condition "第④项无法判定：行项「$TargetText」的夹具时间窗推导失败" "declaration=$($script:facts['catalogFixtureDeclaration'])"
  }
  $moved = Move-CatalogRowItemIntoView $SessionId 'structure' $TargetText 8 'pauseFollow'
  if ($null -eq $moved.itemId) {
    $script:facts['catalogRowItemCalibration'] = Get-CatalogRowItemCalibration $SessionId
    Fail-Condition "第④项不成立：结构行找不到真实行项「$TargetText」" "rowItems=$((Get-CatalogRowItems $SessionId 'structure').Count)"
  }
  $script:facts["${FactPrefix}IntoView-$TargetText"] = "wheelSteps=$($moved.steps) fullyInside=$($moved.visibility.fullyInside) itemLeft=$($moved.visibility.itemLeft) itemWidth=$($moved.visibility.itemWidth) ownerLeft=$($moved.visibility.ownerLeft) ownerWidth=$($moved.visibility.ownerWidth)"
  if (-not $moved.visibility.fullyInside) {
    Fail-Condition "第④项前置不成立：真实滚轮未能在有界步数内把行项「$TargetText」滚入 owner 可视框（无法对其 in-view centre 发真实指针点击）" "wheelSteps=$($moved.steps) visibility=$($script:facts["${FactPrefix}IntoView-$TargetText"])"
  }
  # 基线在**入视野之后**重录：这才是不受任何「点击前先滚入视野」语义污染的基线。
  $structureBaseline = Get-WebDriverRowScrollLeft $SessionId 'structure'
  $paragraphBaseline = Get-WebDriverRowScrollLeft $SessionId 'paragraph'
  $beforeTime = [double](Invoke-WebDriverScript $SessionId 'const video = document.querySelector("video"); return video ? video.currentTime : -1;')
  try {
    Invoke-WebDriverPointerClick $SessionId $moved.itemId
  } catch {
    $script:facts['pauseFollowPointerClickError'] = Protect-DiagnosticText ([string]$_.Exception.Message)
    Fail-Condition "第④项不成立：/actions 真实指针点击（in-view centre）未能送达行项「$TargetText」" "error=$($script:facts['pauseFollowPointerClickError'])"
  }
  Start-Sleep -Milliseconds 800
  $afterTime = [double](Invoke-WebDriverScript $SessionId 'const video = document.querySelector("video"); return video ? video.currentTime : -1;')
  $structureAfter = Get-WebDriverRowScrollLeft $SessionId 'structure'
  $paragraphAfter = Get-WebDriverRowScrollLeft $SessionId 'paragraph'
  $itemAfter = Find-CatalogRowItemByText $SessionId 'structure' $TargetText
  if ($null -ne $itemAfter) {
    $visibilityAfter = Get-CatalogRowItemVisibility $SessionId 'structure' $itemAfter
    $visibilityAfterText = "fullyInside=$($visibilityAfter.fullyInside) itemLeft=$($visibilityAfter.itemLeft)"
  } else {
    $visibilityAfterText = 'item-not-found-after-click'
  }
  $summary = "item=$TargetText currentTimeBefore=$beforeTime currentTimeAfter=$afterTime window=[$($window.start),$($window.end)) structureBaseline=$structureBaseline structureAfter=$structureAfter paragraphBaseline=$paragraphBaseline paragraphAfter=$paragraphAfter visibilityAfter={$visibilityAfterText}"
  $script:facts["${FactPrefix}Seek-$TargetText"] = $summary
  $script:facts['pauseFollowWitness'] = @($script:facts['pauseFollowWitness']) + @($summary)
  # ① 时间窗：证明这次点击确实触发了公开 seek（否则「两行没动」可能只是没点到）。
  if ($afterTime -lt ([double]$window.start - 0.1) -or $afterTime -ge ([double]$window.end + 0.1)) {
    Fail-Condition "第④项不成立：真实指针点击后媒体 currentTime 未落入行项「$TargetText」的时间窗（seek 未生效）" "currentTime=$afterTime window=[$($window.start),$($window.end))"
  }
  # ② 双行见证：暂停态下两行 scrollLeft 相对各自基线都不得变化。
  if ([double]$structureAfter -ne [double]$structureBaseline) {
    Fail-Condition '第④项不成立：暂停后公开目录 seek 改变了结构行的 scrollLeft' "item=$TargetText baseline=$structureBaseline after=$structureAfter"
  }
  if ([double]$paragraphAfter -ne [double]$paragraphBaseline) {
    Fail-Condition '第④项不成立：暂停后公开目录 seek 改变了段落行的 scrollLeft' "item=$TargetText baseline=$paragraphBaseline after=$paragraphAfter"
  }
  return $summary
}

function Assert-PauseStopsForcedFollow([string]$SessionId) {
  # ④ 暂停后停止强制跟随：媒体暂停后，经**公开目录 seek**（真实指针点击行项 → 生产 onClick=onSeek(startTime)）
  # 改变媒体位置，但两行滚动 owner 的 scrollLeft 都不得变化。
  # 判据来源：AC-SU-01「暂停后停止强制跟随」；生产的跟随只在 isPlaying 为真时生效（catalog.tsx:306-328），
  # 因此旧实现里「播放 2s 而 scrollLeft 必须不变」与第②项（播放态跟随并居中）互相矛盾、永不可能同时成立，
  # 这里保留暂停态 seek 不变性断言，并追加一次播放态正向对照（媒体真实推进 + 当前项仍被居中），
  # 只增强判据，不放宽任何断言。
  # t56 诊断结论（本函数本轮的改动理由）：旧实现在暂停态 seek 这一步用 element-click 端点，而它有
  # UA「点击前先滚入视野」语义（run 36314741172：baseline=2072 → after=0，目标行项 index 0 在可视框外），
  # 会把基线污染成「驱动把被点元素滚进视野」而不是「产品跟随」。故改为：真实滚轮入视野 → 重录两行基线 →
  # /actions 真实指针点击 in-view centre → 双行 + 时间窗断言。
  $pausedState = [string](Invoke-WebDriverScript $SessionId 'const video = document.querySelector("video"); return String(video ? video.paused : "absent");')
  $script:facts['pauseFollowPreState'] = "paused=$pausedState"
  if ($pausedState -ne 'True') {
    Fail-Condition '第④项前置不成立：媒体不处于暂停态（裁判②结束时必须恢复暂停）' "observed=$pausedState"
  }
  $script:facts['structureRowScrollMetrics'] = Get-CatalogRowScrollMetrics $SessionId 'structure'
  $script:facts['paragraphRowScrollMetrics'] = Get-CatalogRowScrollMetrics $SessionId 'paragraph'
  $script:facts['pauseFollowRowBaselineAtStart'] = "structure=$(Get-WebDriverRowScrollLeft $SessionId 'structure') paragraph=$(Get-WebDriverRowScrollLeft $SessionId 'paragraph')"
  $script:facts['pauseFollowWitness'] = @()
  foreach ($targetText in @('E2E 章节 1', 'E2E 章节 5')) {
    Invoke-PausedCatalogSeek $SessionId $targetText 'pauseFollow' | Out-Null
  }
  # 正向对照：播放态下媒体真实推进，且当前项仍被居中（与第②项同一机制，不新增语义）。
  Invoke-WebDriverElementClick $SessionId (Find-WebDriverElement $SessionId '[data-testid="control-bar"] button')
  $playStart = [double](Invoke-WebDriverScript $SessionId 'const video = document.querySelector("video"); return video ? video.currentTime : -1;')
  Start-Sleep -Seconds 2
  $playEnd = [double](Invoke-WebDriverScript $SessionId 'const video = document.querySelector("video"); return video ? video.currentTime : -1;')
  $script:facts['pauseFollowPlayAdvance'] = "currentTimeBefore=$playStart currentTimeAfter=$playEnd"
  $centered = Wait-CatalogCurrentItemCentered $SessionId 'structure' 2.0 3
  $script:facts['pauseFollowPlayCenteredDeltaPx'] = $centered.delta
  $script:facts['pauseFollowPlayCenteredItemText'] = $centered.currentText
  Invoke-WebDriverElementClick $SessionId (Find-WebDriverElement $SessionId '[data-testid="control-bar"] button')
  Start-Sleep -Milliseconds 500
  $pausedAgain = [string](Invoke-WebDriverScript $SessionId 'const video = document.querySelector("video"); return String(video ? video.paused : "absent");')
  $script:facts['pauseFollowPausedAgain'] = $pausedAgain
  if ($pausedAgain -ne 'True') {
    Fail-Condition '第④项前置不成立：第二次真实点击未使媒体暂停' "observed=$pausedAgain"
  }
  if (($playEnd - $playStart) -lt 1.0) {
    Fail-Condition '第④项对照不成立：播放态媒体未真实推进（无法证明暂停语义有对照）' "before=$playStart after=$playEnd"
  }
  if ($null -eq $centered.delta -or [double]$centered.delta -gt 2.0) {
    $script:facts['catalogRowItemCalibration'] = Get-CatalogRowItemCalibration $SessionId
    Fail-Condition '第④项对照不成立：播放态下当前项未被居中（与第②项同一机制失效）' "centerDeltaPx=$($centered.delta)"
  }
  # 播放-暂停往返后再验证一次暂停态 seek 不滚动（防止「恰好在滚动极限」造成的假通过）：
  # 同样走「真实滚轮入视野 → 重录两行基线 → /actions 指针点击 in-view centre → 双行 + 时间窗断言」。
  $roundTripSummary = Invoke-PausedCatalogSeek $SessionId 'E2E 章节 2' 'pauseFollowRoundTrip'
  $script:facts['pauseFollowAfterPlayRoundTrip'] = $roundTripSummary
}

function Get-StudyLayoutGeometry([string]$SessionId) {
  $geometry = [ordered]@{}
  foreach ($part in @('side-tree', 'middle', 'right-panel', 'visual-controls', 'text-shell')) {
    $geometry[$part] = Get-WebDriverElementRect $SessionId (Find-WebDriverElement $SessionId "[data-testid='study-$part']")
  }
  return $geometry
}

function Assert-LayoutNear([double]$Actual, [double]$Expected, [string]$Label) {
  if ([Math]::Abs($Actual - $Expected) -gt 2) {
    Fail-Condition "AC-SU-04 $Label" "actual=$Actual expected=$Expected tolerance=2px"
  }
}

function Invoke-LayoutDrag([string]$SessionId, [string]$Label, [int]$DeltaX, [int]$DeltaY) {
  $element = Find-WebDriverElement $SessionId "[role='separator'][aria-label='$Label']"
  Invoke-WebDriver 'Post' "/session/$SessionId/actions" @{
    actions = @(@{ type = 'pointer'; id = 'layout-drag'; parameters = @{ pointerType = 'mouse' }; actions = @(
      @{ type = 'pointerMove'; origin = @{ $elementKey = $element }; x = 0; y = 0; duration = 0 },
      @{ type = 'pointerDown'; button = 0 },
      @{ type = 'pointerMove'; origin = 'pointer'; x = $DeltaX; y = $DeltaY; duration = 300 },
      @{ type = 'pointerUp'; button = 0 }
    ) })
  } | Out-Null
  Invoke-WebDriver 'Delete' "/session/$SessionId/actions" | Out-Null
  Wait-WebDriverCondition $SessionId 'layout setting committed' "return document.querySelector('$pageSelector')?.getAttribute('aria-busy') === 'false';"
}

function Invoke-LayoutMode([string]$SessionId, [string]$Mode) {
  $index = if ($Mode -eq 'textExpand') { 3 } else { 4 }
  Invoke-WebDriverElementClick $SessionId (Find-WebDriverElement $SessionId "[data-testid='control-bar'] button:nth-child($index)")
}

function Assert-LayoutMediaWitness([string]$SessionId) {
  # Media identity/properties are real page reads; geometry is exclusively the driver /rect endpoint.
  $ok = Invoke-WebDriverScript $SessionId @'
const w = window.__rainLayoutWitness;
const v = document.querySelector('video');
const selected = document.querySelector('[data-testid="side-tree"] [data-selected="true"]');
const note = document.querySelector('[aria-label="随记内容"]');
return v === w.media && v.paused && Math.abs(v.currentTime - w.position) < 0.1
  && v.currentSrc === w.source && selected === w.selected && note === w.note && note.value === w.content;
'@
  if ($ok -ne $true) { Fail-Condition 'AC-SU-04 layout changed media/selection/note facts' 'production DOM/media witness changed' }
}

function Assert-StudyLayoutDrag([string]$SessionId) {
  Wait-WebDriverCondition $SessionId 'study proportions ready' "return document.querySelector('$pageSelector')?.getAttribute('aria-busy') === 'false';"
  $initial = Get-StudyLayoutGeometry $SessionId
  $width = $initial['side-tree'].width + $initial['middle'].width + $initial['right-panel'].width
  Assert-LayoutNear $initial['side-tree'].width ($width / 11) 'default left 1:7:3'
  Assert-LayoutNear $initial['middle'].width ($width * 7 / 11) 'default middle 1:7:3'
  Assert-LayoutNear $initial['right-panel'].width ($width * 3 / 11) 'default right 1:7:3'
  $splitHeight = $initial['visual-controls'].height + $initial['text-shell'].height
  Assert-LayoutNear $initial['visual-controls'].height ($splitHeight * 0.6) 'default video including controls 6:4'

  Invoke-WebDriverElementClick $SessionId (Find-WebDriverElement $SessionId '[data-testid="side-tree"] [data-selected]')
  Invoke-WebDriverElementClick $SessionId (Find-WebDriverElement $SessionId '[data-testid="study-right-panel"] button:nth-child(2)')
  $composer = Find-WebDriverElement $SessionId '[aria-label="新随记内容"]'
  Invoke-WebDriver 'Post' "/session/$SessionId/element/$composer/value" @{ text = 'Layout persistent note'; value = @('Layout persistent note'.ToCharArray() | ForEach-Object { [string]$_ }) } | Out-Null
  Invoke-WebDriverElementClick $SessionId (Find-WebDriverElement $SessionId '[data-testid="notes-composer"] button')
  Wait-WebDriverCondition $SessionId 'production note saved' @'
return document.querySelector('[aria-label="随记内容"]')?.value === 'Layout persistent note';
'@
  Invoke-WebDriverScript $SessionId @'
const media = document.querySelector('video');
window.__rainLayoutWitness = { media, position: media.currentTime, source: media.currentSrc,
  selected: document.querySelector('[data-testid="side-tree"] [data-selected="true"]'),
  note: document.querySelector('[aria-label="随记内容"]'), content: 'Layout persistent note' };
return true;
'@ | Out-Null

  Invoke-LayoutDrag $SessionId '调整目录树宽度' 40 0
  $afterLeft = Get-StudyLayoutGeometry $SessionId
  Assert-LayoutNear $afterLeft['side-tree'].width ($initial['side-tree'].width + 40) 'left pointer drag'
  Assert-LayoutNear $afterLeft['middle'].width ($initial['middle'].width - 40) 'left adjacent middle'
  Invoke-LayoutDrag $SessionId '调整助手面板宽度' -30 0
  $afterRight = Get-StudyLayoutGeometry $SessionId
  Assert-LayoutNear $afterRight['right-panel'].width ($initial['right-panel'].width + 30) 'right pointer drag'
  Invoke-LayoutDrag $SessionId '调整视频与文本比例' 0 40
  $follow = Get-StudyLayoutGeometry $SessionId
  Assert-LayoutNear $follow['visual-controls'].height ($initial['visual-controls'].height + 40) 'follow pointer drag'
  Assert-LayoutMediaWitness $SessionId

  Invoke-LayoutMode $SessionId 'textExpand'
  Invoke-LayoutDrag $SessionId '调整目录树宽度' 20 0
  $text = Get-StudyLayoutGeometry $SessionId
  Assert-LayoutNear $text['side-tree'].width ($follow['side-tree'].width + 20) 'text mode pointer drag'
  Assert-LayoutNear $text['visual-controls'].height 40 'text mode controls only'
  Assert-LayoutMediaWitness $SessionId
  Invoke-LayoutMode $SessionId 'mapExpand'
  $mapBefore = Get-StudyLayoutGeometry $SessionId
  Invoke-LayoutDrag $SessionId '调整导图与预览比例' 0 -40
  $map = Get-StudyLayoutGeometry $SessionId
  Assert-LayoutNear $map['visual-controls'].height ($mapBefore['visual-controls'].height - 40) 'map pointer drag'
  Assert-LayoutMediaWitness $SessionId
  Invoke-LayoutMode $SessionId 'mapExpand'
  $followFinal = Get-StudyLayoutGeometry $SessionId
  Assert-LayoutNear $followFinal['visual-controls'].height $follow['visual-controls'].height 'follow split remembered across modes'
  Assert-LayoutMediaWitness $SessionId
  $script:facts['layoutProportions'] = [ordered]@{ initial = $initial; follow = $followFinal; text = $text; map = $map; mediaSelectionNoteStable = $true }
}

function Assert-StudyLayoutRestored([string]$SessionId) {
  Wait-WebDriverCondition $SessionId 'restored study proportions ready' "return document.querySelector('$pageSelector')?.getAttribute('aria-busy') === 'false';"
  $restored = Get-StudyLayoutGeometry $SessionId
  $expected = $script:facts['layoutProportions']['follow']
  foreach ($part in @('side-tree', 'middle', 'right-panel', 'visual-controls', 'text-shell')) {
    Assert-LayoutNear $restored[$part].width $expected[$part].width "restart $part width"
    Assert-LayoutNear $restored[$part].height $expected[$part].height "restart $part height"
  }
  Invoke-WebDriverElementClick $SessionId (Find-WebDriverElement $SessionId '[data-testid="study-right-panel"] button:nth-child(2)')
  $noteValue = Invoke-WebDriverScript $SessionId @'
return document.querySelector('[aria-label="随记内容"]')?.value;
'@
  if ($noteValue -ne 'Layout persistent note') {
    Fail-Condition 'AC-SU-04 note did not survive real desktop restart' 'saved note content differs'
  }
  Invoke-LayoutMode $SessionId 'mapExpand'
  $map = Get-StudyLayoutGeometry $SessionId
  Assert-LayoutNear $map['visual-controls'].height $script:facts['layoutProportions']['map']['visual-controls'].height 'restart map split'
  Invoke-LayoutMode $SessionId 'mapExpand'
  $script:facts['layoutProportions']['restart'] = $restored
}

function Set-StudyInputText([string]$SessionId, [string]$Selector, [string]$Text) {
  $inputElement = Find-WebDriverElement $SessionId $Selector
  Invoke-WebDriver 'Post' "/session/$SessionId/element/$inputElement/clear" @{} | Out-Null
  Invoke-WebDriver 'Post' "/session/$SessionId/element/$inputElement/value" @{ text = $Text; value = @($Text.ToCharArray() | ForEach-Object { [string]$_ }) } | Out-Null
}

function Invoke-StudyTab([string]$SessionId, [int]$Index) {
  Invoke-WebDriverElementClick $SessionId (Find-WebDriverElement $SessionId "[data-testid='study-right-panel'] button:nth-child($Index)")
}

function Assert-PanelLearningWitness([string]$SessionId) {
  $stable = Invoke-WebDriverScript $SessionId @'
const w = window.__rainTabWitness, v = document.querySelector('video');
return v === w.media && v.paused && Math.abs(v.currentTime - w.position) < 0.1 && v.currentSrc === w.source
  && document.querySelector('[data-testid="side-tree"] [data-selected="true"]') === w.selected
  && document.querySelector('[aria-label="随记内容"]') === w.note && w.note.value === 'Tab persistent draft'
  && document.querySelector('[aria-label="AI 输入"]') === w.input;
'@
  if ($stable -ne $true) { Fail-Condition 'AC-SU-03 Tab changed media/selection/draft identity or content' 'real page witness differs' }
}

function Assert-StudyPanelTabs([string]$SessionId) {
  $readyFile = Join-Path $runRoot 'panel-sse-ready.json'
  $fixturePath = Join-Path $repoRoot 'scripts/study-panel-sse-fixture.mjs'
  $script:panelFixtureProcess = Start-Process -FilePath (Get-Command node).Source -ArgumentList @(('"' + $fixturePath + '"'), ('"' + $readyFile + '"')) -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddSeconds(10)
  while (-not (Test-Path -LiteralPath $readyFile) -and (Get-Date) -lt $deadline -and -not $script:panelFixtureProcess.HasExited) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path -LiteralPath $readyFile)) { Fail-Condition 'AC-SU-03 controlled HTTP fixture did not start' 'readiness file absent' }
  $httpFixture = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json
  $baseUrl = [string]$httpFixture.baseUrl
  $httpRoot = $baseUrl.Substring(0, $baseUrl.Length - 3)
  Invoke-WebDriverScript $SessionId "window.__RAIN_STUDY_CATALOG_FIXTURE__.configureAssistant('$baseUrl'); return true;" | Out-Null
  Wait-WebDriverCondition $SessionId 'real assistant capability probe and persisted role assignment' @'
return ['ready','failed'].includes(window.__RAIN_STUDY_CATALOG_FIXTURE__.assistantStatus);
'@
  $assistantStatus = Invoke-WebDriverScript $SessionId 'return window.__RAIN_STUDY_CATALOG_FIXTURE__.assistantStatus;'
  if ($assistantStatus -ne 'ready') { Fail-Condition 'AC-SU-03 controlled assistant setup failed' ([string](Invoke-WebDriverScript $SessionId 'return window.__RAIN_STUDY_CATALOG_FIXTURE__.assistantError;')) }
  Invoke-WebDriverElementClick $SessionId (Find-WebDriverElement $SessionId '[data-testid="side-tree"] [data-selected]')
  Invoke-StudyTab $SessionId 2
  Set-StudyInputText $SessionId '[aria-label="随记内容"]' 'Tab persistent draft'
  Invoke-StudyTab $SessionId 1
  Set-StudyInputText $SessionId '[aria-label="AI 输入"]' 'Unsent AI draft'
  $captured = Invoke-WebDriverScript $SessionId @'
const media = document.querySelector('video'), selected = document.querySelector('[data-testid="side-tree"] [data-selected="true"]');
window.__rainTabWitness = { media, selected, position: media?.currentTime, source: media?.currentSrc,
  note: document.querySelector('[aria-label="随记内容"]'), input: document.querySelector('[aria-label="AI 输入"]') };
return Boolean(media && selected && window.__rainTabWitness.note && window.__rainTabWitness.input);
'@
  if ($captured -ne $true) { Fail-Condition 'AC-SU-03 nonempty learning witness missing' 'media/selected/note/input required' }
  Invoke-StudyTab $SessionId 2
  Assert-PanelLearningWitness $SessionId
  $hidden = Invoke-WebDriverScript $SessionId 'return Boolean(document.querySelector("[aria-label=\"AI 输入\"]").closest("[hidden]"));'
  if ($hidden -ne $true) { Fail-Condition 'AC-SU-03 AI panel did not become hidden' 'native hidden owner absent' }
  Invoke-StudyTab $SessionId 1
  $draft = Invoke-WebDriverScript $SessionId 'return document.querySelector("[aria-label=\"AI 输入\"]").value;'
  if ($draft -ne 'Unsent AI draft') { Fail-Condition 'AC-SU-03 unsent assistant draft lost' "observed=$draft" }
  $before = Invoke-RestMethod "$httpRoot/status"
  if ($before.probeCount -ne 1 -or $before.requests.Count -ne 0) { Fail-Condition 'AC-SU-03 unsent Tabs started another side effect' 'one real probe and zero assistant requests required' }
  Set-StudyInputText $SessionId '[aria-label="AI 输入"]' ('Tabs first request' + [char]0xE007)
  Wait-WebDriverCondition $SessionId 'real first SSE token in production assistant' 'return document.querySelector("[data-testid=message-assistant]")?.textContent === "Visible";'
  Invoke-StudyTab $SessionId 2
  Invoke-RestMethod "$httpRoot/release/1/hidden" -Method Post | Out-Null
  Wait-WebDriverCondition $SessionId 'hidden assistant receives the same live stream' 'return document.querySelector("[data-testid=message-assistant]")?.textContent === "Visible hidden";'
  Assert-PanelLearningWitness $SessionId
  Invoke-WebDriverScript $SessionId 'window.__RAIN_STUDY_CATALOG_FIXTURE__.readNotes(); return true;' | Out-Null
  Wait-WebDriverCondition $SessionId 'fresh public SQLite note snapshot' 'return window.__RAIN_STUDY_CATALOG_FIXTURE__.noteContents !== null;'
  $saved = Invoke-WebDriverScript $SessionId @'
const contents = window.__RAIN_STUDY_CATALOG_FIXTURE__.noteContents;
return contents.length === 1 && contents[0] === 'Layout persistent note';
'@
  if ($saved -ne $true) { Fail-Condition 'AC-SU-03 hiding a note caused an unrequested save' 'SQLite must retain saved content while draft stays local' }
  Invoke-StudyTab $SessionId 1
  Invoke-RestMethod "$httpRoot/release/1/done" -Method Post | Out-Null
  Wait-WebDriverCondition $SessionId 'first request completed without a new request' @'
const panel = document.querySelector('[data-testid="ai-assistant"]');
return panel?.querySelector('[data-testid="message-assistant"]')?.textContent === 'Visible hidden complete' && !panel.querySelector('button');
'@
  Set-StudyInputText $SessionId '[aria-label="AI 输入"]' ('Tabs second request' + [char]0xE007)
  Wait-WebDriverCondition $SessionId 'second real stream active' 'return document.querySelectorAll("[data-testid=message-assistant]")[1]?.textContent === "Visible";'
  Invoke-WebDriverElementClick $SessionId (Find-WebDriverElement $SessionId '[data-testid="ai-assistant"] > button')
  $deadline = (Get-Date).AddSeconds(5)
  do { $status = Invoke-RestMethod "$httpRoot/status"; if ($status.requests.Count -eq 2 -and $status.requests[1].aborted) { break }; Start-Sleep -Milliseconds 100 } while ((Get-Date) -lt $deadline)
  if ($status.probeCount -ne 1 -or $status.requests.Count -ne 2 -or -not $status.requests[0].completed -or $status.requests[0].aborted -or -not $status.requests[1].aborted) {
    Fail-Condition 'AC-SU-03 request repeated, hidden stream aborted, or explicit stop failed to abort HTTP' (ConvertTo-Json -InputObject $status -Depth 4 -Compress)
  }
  Assert-PanelLearningWitness $SessionId
  Invoke-StudyTab $SessionId 2
  Assert-PanelLearningWitness $SessionId
  $script:facts['panelTabs'] = @{ requestStatus = $status; mediaSelectionDraftStable = $true; unsentDraftRestored = $true; hiddenNoteNotSaved = $true }
  Write-Output ('AC-SU-03 desktop Tab facts: ' + (ConvertTo-Json -InputObject $script:facts['panelTabs'] -Depth 6 -Compress))
}

$tauriDriver = $null
$driverProcess = $null
$sessionId = $null
$runSucceeded = $false
$phase = 'bootstrap'
$script:panelFixtureProcess = $null
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

  $phase = 'seed-fixture'
  Write-Output 'Study Catalog E2E phase: publish controlled catalog fixture'
  Request-CatalogFixtureSeed $sessionId
  Close-WebDriverSession $sessionId
  $sessionId = $null

  $phase = 'restart-and-open-study'
  $sessionId = New-WebDriverSession $appBinary
  Wait-WebDriverCondition $sessionId 'the video list page after the desktop restart' "return Boolean(document.querySelector('$listPageSelector'));"
  # STD-69-11：runner 先 `await getDb()` + `await getVideoById()` 才发布夹具状态（runner:809-815），
  # 列表卡也要等同一次查询渲染完，因此「重启后列表页存在」≠「夹具已武装 / 卡片已渲染」。
  # 读取前做**有界等待**（接口状态已知 且 卡片 ≥1），超时后按 absent / idle / failed 三态分别报出，
  # 避免把「app 还在启动（接口未武装）」误报成「隔离库没有夹具行」。不延长 $MaxSeconds、不放宽任何断言：
  # 真正的失败（idle / failed / 无卡）仍必然失败。
  $restartWaitSeconds = [Math]::Min(30, $MaxSeconds)
  $restartDeadline = (Get-Date).AddSeconds($restartWaitSeconds)
  $restartStarted = Get-Date
  $fixtureStateAfterRestart = 'absent'
  $cardButtonCountAfterRestart = 0
  $restartWaitSamples = 0
  $cardButtons = @()
  do {
    $restartWaitSamples += 1
    $fixtureStateAfterRestart = [string](Invoke-WebDriverScript $sessionId @"
const fixture = $fixtureInterface;
if (!fixture || typeof fixture !== 'object') return 'absent';
return String(fixture.status || 'unknown');
"@)
    $cardButtons = @(Find-WebDriverElements $sessionId '[data-testid^="card-"] button')
    $cardButtonCountAfterRestart = $cardButtons.Count
    if ($fixtureStateAfterRestart -in @('seeded', 'failed') -and $cardButtonCountAfterRestart -ge 1) { break }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $restartDeadline)
  $script:facts['fixtureStatusAfterRestart'] = $fixtureStateAfterRestart
  $script:facts['cardButtonCount'] = $cardButtonCountAfterRestart
  $script:facts['restartWaitSamples'] = $restartWaitSamples
  $script:facts['restartWaitElapsedMs'] = [int]((Get-Date) - $restartStarted).TotalMilliseconds
  # 超时前的最后状态（最后一条采样）也进 observed：三态诊断必须能把「未武装」与「库无夹具行」分开。
  $script:facts['restartWaitLastState'] = "status=$fixtureStateAfterRestart cardButtonCount=$cardButtonCountAfterRestart sampleIndex=$restartWaitSamples"
  $script:facts['restartWaitCriterion'] = "fixture status known && [data-testid^='card-'] button count >= 1 within $restartWaitSeconds s (500ms poll)"
  # 诊断要求②：实际读到的卡片数与卡主操作 aria-label 原文（driver 读属性，不是 JS 替身判定）。
  $cardLabels = @()
  foreach ($candidate in $cardButtons) { $cardLabels += (Get-WebDriverElementAttribute $sessionId $candidate 'aria-label') }
  $script:facts['cardPrimaryActionLabels'] = $cardLabels
  Write-Output 'Study Catalog E2E phase: open the study page through the production card action'
  $restartDetail = "fixtureStatusAfterRestart=$fixtureStateAfterRestart cardButtonCount=$cardButtonCountAfterRestart waitSamples=$restartWaitSamples declaration=$($script:facts['catalogFixtureDeclaration'])"
  switch ($fixtureStateAfterRestart) {
    'seeded' {
      if ($cardButtonCountAfterRestart -lt 1) {
        Fail-Condition '重启后夹具已 seeded 但生产列表页在等待窗口内没有渲染出可点击的卡片（列表查询/渲染未在窗口内完成）' $restartDetail
      }
    }
    'idle' { Fail-Condition '重启后夹具接口为 idle 且等待窗口内无可点击卡片：隔离库看不到夹具行（seed 未落库或库路径不一致）' $restartDetail }
    'failed' { Fail-Condition '重启后夹具接口报告 failed：夹具建立失败（见 declaration 的 error）' $restartDetail }
    default { Fail-Condition '重启后夹具接口在等待窗口内始终 absent 且无可点击卡片（app 仍在启动或 runner 未进入 study-catalog 短模式）' $restartDetail }
  }
  $cardAction = $cardButtons[0]
  $cardLabel = $cardLabels[0]
  if ($cardLabel -notmatch '打开视频') {
    Fail-Condition '列表卡主操作不是既有「打开视频」动作，无法经生产路径进入学习页' "aria-label='$cardLabel'"
  }
  Invoke-WebDriverElementClick $sessionId $cardAction
  # 诊断要求③/④：等待判据、超时阈值、最后一次读到的状态，以及前端错误面/currentPage/媒体错误码。
  $studyDeadline = (Get-Date).AddSeconds($MaxSeconds)
  $studyReached = $false
  do {
    $studyReached = (Invoke-WebDriverScript $sessionId "return Boolean(document.querySelector('$pageSelector'));") -eq $true
    if ($studyReached) { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $studyDeadline)
  if (-not $studyReached) {
    $diagnostics = [string](Invoke-WebDriverScript $sessionId @"
const listWrapper = document.querySelector('[data-testid="video-list-page"]')?.parentElement ?? null;
const alert = document.querySelector('[role="alert"]');
const video = document.querySelector('video');
return JSON.stringify({
  currentPage: listWrapper ? (listWrapper.hasAttribute('hidden') ? 'not-list' : 'list') : 'unknown',
  alertText: alert ? alert.textContent.trim() : null,
  studyInterfacePresent: Boolean(document.querySelector('[data-testid="study-interface"]')),
  videoPresent: Boolean(video),
  videoErrorCode: video && video.error ? video.error.code : null,
  cardButtonCount: document.querySelectorAll('[data-testid^="card-"] button').length,
});
"@)
    $script:facts['studyPageTimeoutState'] = $diagnostics
    $script:facts['studyPageWaitCriterion'] = "document.querySelector('$pageSelector') within $MaxSeconds s (250ms poll)"
    Fail-Condition '真实点击卡主操作后生产学习页未出现：loadVideo 失败（最可能是夹具缺 sentences）或列表页报错，需按 observed 的 alert/currentPage 定位' "state=$diagnostics"
  }

  $phase = 'wav-playback-probe'
  Write-Output 'Study Catalog E2E phase: synthetic WAV playback probe'
  Assert-WavPlaybackAdvances $sessionId

  $phase = 'judge-row-structure'
  Write-Output 'Study Catalog E2E phase: judge 1 two-row catalog structure'
  Assert-CatalogTwoRowStructure $sessionId

  $phase = 'judge-current-item-centered'
  Write-Output 'Study Catalog E2E phase: judge 2 current item centered follow'
  Assert-CurrentItemCentered $sessionId

  $phase = 'judge-fade-owners'
  Write-Output 'Study Catalog E2E phase: judge 3 edge fade owners'
  Assert-FadeOwners $sessionId

  $phase = 'judge-pause-stops-follow'
  Write-Output 'Study Catalog E2E phase: judge 4 paused position changes do not force scrolling'
  Assert-PauseStopsForcedFollow $sessionId

  $phase = 'judge-layout-drag'
  Write-Output 'Study Catalog E2E phase: AC-SU-04 real geometry, pointer drag, three modes and media facts'
  Assert-StudyLayoutDrag $sessionId
  Close-WebDriverSession $sessionId
  $sessionId = New-WebDriverSession $appBinary
  Wait-WebDriverCondition $sessionId 'the video card after layout restart' "return Boolean(document.querySelector('[data-testid^=card-] button'));"
  Invoke-WebDriverElementClick $sessionId (Find-WebDriverElement $sessionId '[data-testid^="card-"] button')
  Wait-WebDriverCondition $sessionId 'study page after layout restart' "return Boolean(document.querySelector('$pageSelector'));"
  $phase = 'judge-layout-restart'
  Assert-StudyLayoutRestored $sessionId
  Write-Output ('AC-SU-04 desktop layout facts: ' + (ConvertTo-Json -InputObject $script:facts['layoutProportions'] -Depth 8 -Compress))
  $phase = 'judge-panel-tabs'
  Assert-StudyPanelTabs $sessionId

  # SR-t52-4 + 文档 §5 对齐：成功路径同样要留下证据——
  # (a) 仅附件截图 + ATTACHMENT-NOTICE.txt（Save-WebDriverScreenshot 此前从未被调用，文档承诺的附件其实不存在）；
  # (b) success-facts.json（判据事实：② 的实测居中差值与实际容差、握手等待的判据/采样/耗时/最后状态、
  #     夹具 status 与卡片数、两行几何、WAV 观测），并同时打进运行日志。
  Save-WebDriverScreenshot $sessionId
  Save-SuccessFacts | Out-Null
  $runSucceeded = $true
  Write-Output 'Study desktop E2E passed: fixture -> restart -> media/catalog -> layout drag/restart -> panel Tabs and real SSE.'
} catch {
  $primaryError = $_
} finally {
  if ($script:panelFixtureProcess -and -not $script:panelFixtureProcess.HasExited) {
    Stop-Process -Id $script:panelFixtureProcess.Id -Force -ErrorAction SilentlyContinue
    $script:panelFixtureProcess.WaitForExit(5000) | Out-Null
  }
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
