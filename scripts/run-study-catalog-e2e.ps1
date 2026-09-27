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
  # 该 fact 记录的是「生产视频列表页是否出现」，名字必须与语义一致（t34 自曝缺陷的修正）。
  $script:facts['videoListPagePresent'] = [bool](Find-WebDriverElement $SessionId $listPageSelector -AllowMissing)
  if ($status -eq 'absent') {
    Fail-Condition 'AC-SU-01 的桌面条件无法判定：学习页长目录受控夹具公开接口未建立' "interface=$fixtureInterface status=absent"
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
    $script:facts["${level}FadeLeftEdge"] = "wheelSteps=$edgeSteps scrollLeft=$(Get-WebDriverRowScrollLeft $SessionId $level)"
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

function Assert-PauseStopsForcedFollow([string]$SessionId) {
  # ④ 暂停后停止强制跟随：媒体暂停后，真实点击真实行项（生产 onClick=onSeek(startTime)）必须改变媒体位置，
  # 但**不得**改变结构行 owner 的 scrollLeft。
  # 判据来源：AC-SU-01「暂停后停止强制跟随」；生产的跟随只在 isPlaying 为真时生效（catalog.tsx:306-316），
  # 因此旧实现里「播放 2s 而 scrollLeft 必须不变」与第②项（播放态跟随并居中）互相矛盾、永不可能同时成立，
  # 这里改成暂停态的 seek 不变性断言，并追加一次播放态正向对照（媒体真实推进 + 当前项仍被居中），
  # 只增强判据，不放宽任何断言。
  $pausedState = [string](Invoke-WebDriverScript $SessionId 'const video = document.querySelector("video"); return String(video ? video.paused : "absent");')
  $script:facts['pauseFollowPreState'] = "paused=$pausedState"
  if ($pausedState -ne 'True') {
    Fail-Condition '第④项前置不成立：媒体不处于暂停态（裁判②结束时必须恢复暂停）' "observed=$pausedState"
  }
  $baseline = Get-WebDriverRowScrollLeft $SessionId 'structure'
  $script:facts['pauseFollowBaselineScrollLeft'] = $baseline
  $pausedSeeks = @(
    @{ Text = 'E2E 章节 1'; LowSeconds = 0.0; HighSeconds = 1.0 },
    @{ Text = 'E2E 章节 5'; LowSeconds = 6.5; HighSeconds = 7.5 }
  )
  foreach ($seek in $pausedSeeks) {
    $beforeTime = [double](Invoke-WebDriverScript $SessionId 'const video = document.querySelector("video"); return video ? video.currentTime : -1;')
    $item = Find-CatalogRowItemByText $SessionId 'structure' $seek.Text
    if ($null -eq $item) {
      $script:facts['catalogRowItemCalibration'] = Get-CatalogRowItemCalibration $SessionId
      Fail-Condition "第④项不成立：结构行找不到真实行项「$($seek.Text)」" "rowItems=$((Get-CatalogRowItems $SessionId 'structure').Count)"
    }
    Invoke-WebDriverElementClick $SessionId $item
    Start-Sleep -Milliseconds 800
    $afterTime = [double](Invoke-WebDriverScript $SessionId 'const video = document.querySelector("video"); return video ? video.currentTime : -1;')
    $after = Get-WebDriverRowScrollLeft $SessionId 'structure'
    $script:facts["pauseFollowSeek-$($seek.Text)"] = "currentTimeBefore=$beforeTime currentTimeAfter=$afterTime scrollLeftBefore=$baseline scrollLeftAfter=$after"
    if ($afterTime -lt [double]$seek.LowSeconds -or $afterTime -gt [double]$seek.HighSeconds) {
      Fail-Condition "第④项不成立：暂停态真实点击行项「$($seek.Text)」未使媒体 seek 到该节点（位置变化证据不成立）" "currentTime=$afterTime expected=[$($seek.LowSeconds),$($seek.HighSeconds)]"
    }
    if ([double]$after -ne [double]$baseline) {
      Fail-Condition '第④项不成立：暂停后公开目录 seek 仍强制滚动' "item=$($seek.Text) baseline=$baseline after=$after"
    }
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
  # 播放-暂停往返后再验证一次暂停态 seek 不滚动（防止「恰好在滚动极限」造成的假通过）。
  $baselineAfterRoundTrip = Get-WebDriverRowScrollLeft $SessionId 'structure'
  $itemAfterRoundTrip = Find-CatalogRowItemByText $SessionId 'structure' 'E2E 章节 2'
  if ($null -eq $itemAfterRoundTrip) {
    $script:facts['catalogRowItemCalibration'] = Get-CatalogRowItemCalibration $SessionId
    Fail-Condition '第④项不成立：结构行找不到真实行项「E2E 章节 2」' "rowItems=$((Get-CatalogRowItems $SessionId 'structure').Count)"
  }
  Invoke-WebDriverElementClick $SessionId $itemAfterRoundTrip
  Start-Sleep -Milliseconds 800
  $afterRoundTrip = Get-WebDriverRowScrollLeft $SessionId 'structure'
  $script:facts['pauseFollowAfterPlayRoundTrip'] = "baseline=$baselineAfterRoundTrip after=$afterRoundTrip"
  if ([double]$afterRoundTrip -ne [double]$baselineAfterRoundTrip) {
    Fail-Condition '第④项不成立：播放-暂停往返后，暂停态公开目录 seek 仍强制滚动' "baseline=$baselineAfterRoundTrip after=$afterRoundTrip"
  }
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

  $phase = 'seed-fixture'
  Write-Output 'Study Catalog E2E phase: publish controlled catalog fixture'
  Request-CatalogFixtureSeed $sessionId
  Close-WebDriverSession $sessionId
  $sessionId = $null

  $phase = 'restart-and-open-study'
  $sessionId = New-WebDriverSession $appBinary
  Wait-WebDriverCondition $sessionId 'the video list page after the desktop restart' "return Boolean(document.querySelector('$listPageSelector'));"
  # 重启后的夹具状态（诊断要求①）：idle 表示隔离库看不到夹具行。
  $script:facts['fixtureStatusAfterRestart'] = [string](Invoke-WebDriverScript $sessionId @"
const fixture = $fixtureInterface;
return fixture && typeof fixture === 'object' ? String(fixture.status || 'unknown') : 'absent';
"@)
  # 诊断要求②：实际读到的卡片数与卡主操作 aria-label 原文。
  $cardButtons = @(Find-WebDriverElements $sessionId '[data-testid^="card-"] button')
  $cardLabels = @()
  foreach ($candidate in $cardButtons) { $cardLabels += (Get-WebDriverElementAttribute $sessionId $candidate 'aria-label') }
  $script:facts['cardButtonCount'] = $cardButtons.Count
  $script:facts['cardPrimaryActionLabels'] = $cardLabels
  Write-Output 'Study Catalog E2E phase: open the study page through the production card action'
  if ($cardButtons.Count -lt 1) {
    Fail-Condition '重启后生产列表页没有可点击的卡片：隔离库中的夹具视频行未呈现' "cardButtonCount=0 fixtureStatusAfterRestart=$($script:facts['fixtureStatusAfterRestart'])"
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

  $runSucceeded = $true
  Write-Output 'Study Catalog desktop E2E passed: fixture -> restart -> study page -> WAV playback -> two-row structure -> centered follow -> fade owners -> paused no-forced-follow.'
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
