param(
  [int]$DriverPort = 4456,
  [int]$NativeDriverPort = 4457,
  [int]$MaxSeconds = 90,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Get-Item -LiteralPath (Split-Path -Parent $PSScriptRoot)).FullName
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$diagnosticsRoot = Join-Path $temporaryRoot 'rain-video-list-e2e-latest-failure'
$attachmentRoot = Join-Path $temporaryRoot 'rain-video-list-e2e-attachment'
$runRoot = Join-Path $temporaryRoot ("rain-video-list-e2e-" + [Guid]::NewGuid().ToString('N'))
$runRoot = (New-Item -ItemType Directory -Path $runRoot).FullName
$databasePath = Join-Path $runRoot 'rain-video-list.db'
$driverLog = Join-Path $runRoot 'tauri-driver.log'
$driverErrorLog = Join-Path $runRoot 'tauri-driver.err.log'
$screenshotPath = Join-Path $attachmentRoot 'video-list-desktop-dom.png'
$attachmentNoticePath = Join-Path $attachmentRoot 'ATTACHMENT-NOTICE.txt'
$webDriverRequestSeconds = [Math]::Max(30, $MaxSeconds)
$elementKey = 'element-6066-11e4-a52e-4f735466cecf'
$fixtureInterface = 'window.__RAIN_VIDEO_LIST_FIXTURE__'

# 脚本自持的独立期望合同（受控 fixture，不含用户数据、真实路径或密钥）。
$pendingVideoId = 'rain-e2e-video-list-pending'
$failedVideoId = 'rain-e2e-video-list-failed'
$pendingTitle = 'E2E 待处理样本'
$failedTitle = 'E2E 失败样本'
$noMatchKeyword = 'no-such-title-e2e'
$pageSelector = '[data-testid="video-list-page"]'
$cardSelector = '[data-testid^="card-"]'
$headerButtonSelector = '[data-testid="video-list-page"] header button'
$searchSelector = '[data-testid="video-list-page"] input[aria-label="搜索视频标题"]'
$sortSelector = 'select[aria-label="排序"]'
$sortOptionSelector = 'select[aria-label="排序"] option'
$emptyCtaSelector = '[data-testid="video-list-page"] main button'
$noResultText = '没有找到匹配的视频'
$emptyCtaText = '导入你的第一个视频'
$pendingActionLabel = "查看导入任务：$pendingTitle"
$failedActionLabel = "查看导入任务：$failedTitle"

$script:missingConditions = New-Object System.Collections.Generic.List[string]
$script:facts = [ordered]@{}

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
  if (-not $command) { throw "$Name is required for Video List desktop E2E. $InstallHint" }
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
  $allowedLeaves = @('rain-video-list-e2e-latest-failure', 'rain-video-list-e2e-attachment')
  if ($allowedLeaves -notcontains $Leaf) {
    throw "Refusing to modify unexpected Video List E2E directory leaf: $Leaf"
  }
  $resolved = [System.IO.Path]::GetFullPath((Join-Path $temporaryRoot $Leaf))
  if (-not $resolved.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify Video List E2E directory outside the temporary root: $resolved"
  }
  return $resolved
}

function Reset-AttachmentDirectory() {
  $resolved = Get-GuardedTemporaryPath 'rain-video-list-e2e-attachment'
  if (Test-Path -LiteralPath $resolved) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
  New-Item -ItemType Directory -Path $resolved | Out-Null
  return $resolved
}

function Fail-Condition([string]$Condition, [string]$Detail) {
  if (-not [string]::IsNullOrWhiteSpace($Condition)) {
    $script:missingConditions.Add($Condition)
  }
  if ([string]::IsNullOrWhiteSpace($Detail)) { throw $Condition }
  throw "$Condition | $Detail"
}

function Save-FailureDiagnostics([string]$Phase, $ErrorRecord) {
  $resolvedDiagnostics = Get-GuardedTemporaryPath 'rain-video-list-e2e-latest-failure'
  if (Test-Path -LiteralPath $resolvedDiagnostics) {
    Remove-Item -LiteralPath $resolvedDiagnostics -Recurse -Force
  }
  New-Item -ItemType Directory -Path $resolvedDiagnostics | Out-Null

  $summary = [ordered]@{
    version = 1
    status = 'failed'
    phase = $Phase
    error = Protect-DiagnosticText ([string]$ErrorRecord.Exception.Message)
    missingConditions = @($script:missingConditions | ForEach-Object { Protect-DiagnosticText $_ })
    observed = $script:facts
    createdAt = [DateTimeOffset]::Now.ToString('o')
    command = 'npm run e2e:video-list'
  }
  $summaryJson = ConvertTo-Json -InputObject $summary -Depth 6
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
  Write-Warning "Video List E2E diagnostics retained at: $resolvedDiagnostics"
}

function Remove-FailureDiagnostics() {
  $resolvedDiagnostics = Get-GuardedTemporaryPath 'rain-video-list-e2e-latest-failure'
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

function Close-WebDriverSession([string]$SessionId) {
  if ([string]::IsNullOrWhiteSpace($SessionId)) { return }
  Invoke-WebDriver 'Delete' "/session/$SessionId" | Out-Null
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

function Find-WebDriverElement([string]$SessionId, [string]$Selector, [switch]$AllowMissing) {
  try {
    $response = Invoke-WebDriver 'Post' "/session/$SessionId/element" @{
      using = 'css selector'
      value = $Selector
    }
  } catch {
    if ($AllowMissing) { return $null }
    throw "WebDriver could not query element '$Selector': $($_.Exception.Message)"
  }
  if ($response.value -and $response.value.$elementKey) { return [string]$response.value.$elementKey }
  if ($AllowMissing) { return $null }
  throw "WebDriver returned no element for selector: $Selector"
}

function Find-WebDriverElements([string]$SessionId, [string]$Selector) {
  $response = Invoke-WebDriver 'Post' "/session/$SessionId/elements" @{
    using = 'css selector'
    value = $Selector
  }
  if ($null -eq $response.value) { return @() }
  return @($response.value | ForEach-Object { [string]$_.$elementKey })
}

function Get-WebDriverElementText([string]$SessionId, [string]$ElementId) {
  $response = Invoke-WebDriver 'Get' "/session/$SessionId/element/$ElementId/text"
  return [string]$response.value
}

function Get-WebDriverElementAttribute([string]$SessionId, [string]$ElementId, [string]$Name) {
  $response = Invoke-WebDriver 'Get' "/session/$SessionId/element/$ElementId/attribute/$Name"
  return [string]$response.value
}

function Test-WebDriverElementEnabled([string]$SessionId, [string]$ElementId) {
  $response = Invoke-WebDriver 'Get' "/session/$SessionId/element/$ElementId/enabled"
  return [bool]$response.value
}

function Invoke-WebDriverElementClick([string]$SessionId, [string]$ElementId) {
  Invoke-WebDriver 'Post' "/session/$SessionId/element/$ElementId/click" @{} | Out-Null
}

function Send-WebDriverElementKeys([string]$SessionId, [string]$ElementId, [string]$Text) {
  $keys = @()
  foreach ($character in $Text.ToCharArray()) { $keys += [string]$character }
  Invoke-WebDriver 'Post' "/session/$SessionId/element/$ElementId/value" @{
    text = $Text
    value = $keys
  } | Out-Null
}

function Get-WebDriverElementTexts([string]$SessionId, [string]$Selector) {
  $texts = @()
  foreach ($elementId in (Find-WebDriverElements $SessionId $Selector)) {
    $texts += ((Get-WebDriverElementText $SessionId $elementId).Trim())
  }
  return $texts
}

function Open-VideoListPage([string]$SessionId, [string]$Description) {
  Wait-WebDriverCondition $SessionId $Description "return Boolean(document.querySelector('$pageSelector'));"
  try {
    Wait-WebDriverCondition $SessionId 'the video list import entry to initialize' @"
const header = document.querySelector('[data-testid="video-list-page"] header');
if (!header) return false;
const buttons = header.querySelectorAll('button');
if (buttons.length !== 2) return false;
return !buttons[0].disabled && !buttons[1].disabled;
"@
  } catch {
    $observed = [string](Invoke-WebDriverScript $SessionId @"
const header = document.querySelector('[data-testid="video-list-page"] header');
if (!header) return 'header=absent';
const buttons = Array.from(header.querySelectorAll('button'));
return 'count=' + buttons.length + ' disabled=' + buttons.map((b) => b.disabled).join(',') + ' texts=' + buttons.map((b) => b.textContent.trim()).join('|');
"@)
    $script:facts['importEntryReadiness'] = $observed
    Fail-Condition '视频列表页顶栏导入入口未在隔离空库上就绪：真实生产页面不出现「导入」「设置」两个可用按钮' "observed=$observed"
  }
}

function Assert-TopBarComposition([string]$SessionId) {
  Find-WebDriverElement $SessionId $pageSelector | Out-Null

  $header = Find-WebDriverElement $SessionId '[data-testid="video-list-page"] header'
  $script:facts['topBarText'] = ((Get-WebDriverElementText $SessionId $header).Trim())

  $title = Find-WebDriverElement $SessionId '[data-testid="video-list-page"] header > span'
  $titleText = (Get-WebDriverElementText $SessionId $title).Trim()
  $script:facts['topBarTitle'] = $titleText

  $search = Find-WebDriverElement $SessionId $searchSelector
  $placeholder = Get-WebDriverElementAttribute $SessionId $search 'placeholder'
  $searchType = Get-WebDriverElementAttribute $SessionId $search 'type'
  $script:facts['searchPlaceholder'] = $placeholder
  $script:facts['searchType'] = $searchType

  Find-WebDriverElement $SessionId $sortSelector | Out-Null
  $sortLabels = Get-WebDriverElementTexts $SessionId $sortOptionSelector
  $sortValues = @()
  foreach ($option in (Find-WebDriverElements $SessionId $sortOptionSelector)) {
    $sortValues += (Get-WebDriverElementAttribute $SessionId $option 'value')
  }
  $script:facts['sortOptions'] = $sortLabels
  $script:facts['sortOptionValues'] = $sortValues

  $headerButtons = Find-WebDriverElements $SessionId $headerButtonSelector
  $headerTexts = @()
  $headerEnabled = @()
  foreach ($button in $headerButtons) {
    $headerTexts += ((Get-WebDriverElementText $SessionId $button).Trim())
    $headerEnabled += [string](Test-WebDriverElementEnabled $SessionId $button)
  }
  $script:facts['headerButtons'] = $headerTexts
  $script:facts['headerButtonsEnabled'] = $headerEnabled

  if ($titleText -ne 'Rain') {
    Fail-Condition '视频列表页顶栏组合不成立：缺少标题 Rain' "observed='$titleText' topBarText='$($script:facts['topBarText'])'"
  }
  if ($placeholder -ne '搜索标题' -or $searchType -ne 'text') {
    Fail-Condition '视频列表页顶栏组合不成立：搜索框不是既有「搜索标题」文本输入' "placeholder='$placeholder' type='$searchType'"
  }
  if ($sortValues.Count -ne 3 -or ($sortValues -join '|') -ne 'lastStudied|createdAt|title') {
    Fail-Condition '视频列表页顶栏组合不成立：排序控件不是既有 3 个选项值（lastStudied/createdAt/title）' "observed='$($sortValues -join '|')' labels='$($sortLabels -join '|')'"
  }
  if ($sortLabels.Count -ne 3 -or ($sortLabels -join '|') -ne '最近学习|导入时间|名称') {
    Fail-Condition '视频列表页顶栏组合不成立：排序选项文案不是既有「最近学习/导入时间/名称」' "observed='$($sortLabels -join '|')' values='$($sortValues -join '|')'"
  }
  if ($headerTexts.Count -ne 2 -or ($headerTexts -join '|') -ne '导入|设置') {
    Fail-Condition '视频列表页顶栏组合不成立：期望「导入」「设置」两个既有按钮' "observed='$($headerTexts -join '|')'"
  }
  if ($headerEnabled -contains 'False') {
    Fail-Condition '视频列表页顶栏组合不成立：顶栏按钮在隔离空库上应可用' "observedButtons='$($headerTexts -join '|')' enabled='$($headerEnabled -join ',')'"
  }
  $settings = Find-WebDriverElement $SessionId '[data-testid="open-settings"]'
  if ((Get-WebDriverElementText $SessionId $settings).Trim() -ne '设置') {
    Fail-Condition '视频列表页顶栏组合不成立：设置入口文本异常' "observed='$((Get-WebDriverElementText $SessionId $settings).Trim())'"
  }
}

function Assert-WebDriverElementEndpoints([string]$SessionId) {
  $probe = Find-WebDriverElement $SessionId 'html' -AllowMissing
  $script:facts['elementEndpoint'] = if ($probe) { 'supported' } else { 'unsupported' }
  if (-not $probe) {
    Fail-Condition '真实 WebDriver 元素端点不可用：无法以驱动读到的桌面 DOM 与真实点击裁判' '(POST /session/{id}/element returned no element for <html>)'
  }
}

function Assert-EmptyLibraryCta([string]$SessionId) {
  $cards = Find-WebDriverElements $SessionId $cardSelector
  $script:facts['cardCountBeforeSeeding'] = @($cards).Count
  if (@($cards).Count -ne 0) {
    Fail-Condition '空库前置条件不成立：隔离数据库在首次启动时不得包含任何视频行' "cardCount=$(@($cards).Count)"
  }

  $callToAction = Find-WebDriverElement $SessionId $emptyCtaSelector
  $ctaText = (Get-WebDriverElementText $SessionId $callToAction).Trim()
  $ctaType = Get-WebDriverElementAttribute $SessionId $callToAction 'type'
  $script:facts['emptyCtaText'] = $ctaText
  if ($ctaText -ne $emptyCtaText) {
    Fail-Condition '空库具名原生 CTA 不成立：空库主区缺少具名「导入你的第一个视频」按钮' "observed='$ctaText'"
  }
  if ($ctaType -ne 'button') {
    Fail-Condition '空库具名原生 CTA 不成立：CTA 不是原生 <button type=button>' "observedType='$ctaType'"
  }
  if (-not (Test-WebDriverElementEnabled $SessionId $callToAction)) {
    Fail-Condition '空库具名原生 CTA 不成立：CTA 在隔离空库上必须可用' ''
  }

  $menuTexts = Get-WebDriverElementTexts $SessionId $headerButtonSelector
  if (@($menuTexts).Count -ne 2) {
    Fail-Condition '点击前不得存在既有导入菜单项' "observed='$($menuTexts -join '|')'"
  }

  Invoke-WebDriverElementClick $SessionId $callToAction
  Wait-WebDriverCondition $SessionId 'the existing import menu opened by the empty-library call to action' "return document.querySelectorAll('$headerButtonSelector').length === 4;"
  $openedTexts = Get-WebDriverElementTexts $SessionId $headerButtonSelector
  $script:facts['menuAfterCtaClick'] = $openedTexts
  if (-not ($openedTexts -contains '本地文件') -or -not ($openedTexts -contains '在线视频')) {
    Fail-Condition '空库 CTA 点击后未出现既有「本地文件」「在线视频」菜单' "observed='$($openedTexts -join '|')'"
  }

  $closeMenu = @(Find-WebDriverElements $SessionId $headerButtonSelector)[0]
  Invoke-WebDriverElementClick $SessionId $closeMenu
  Wait-WebDriverCondition $SessionId 'the import menu to close again' "return document.querySelectorAll('$headerButtonSelector').length === 2;"
}

function Assert-FilteredEmptyState([string]$SessionId) {
  $search = Find-WebDriverElement $SessionId $searchSelector
  Send-WebDriverElementKeys $SessionId $search $noMatchKeyword
  Wait-WebDriverCondition $SessionId 'the filtered-empty status on the video list page' @"
const status = document.querySelector('[data-testid="video-list-page"] main [role="status"]');
return Boolean(status) && status.textContent.trim() === '$noResultText';
"@
  $status = Find-WebDriverElement $SessionId '[data-testid="video-list-page"] main [role="status"]'
  $statusText = (Get-WebDriverElementText $SessionId $status).Trim()
  $script:facts['filteredEmptyText'] = $statusText
  if ($statusText -ne $noResultText) {
    Fail-Condition '过滤空状态不成立：缺少具名「没有找到匹配的视频」状态' "observed='$statusText'"
  }
  $cards = @(Find-WebDriverElements $SessionId $cardSelector)
  $mainButtons = @(Find-WebDriverElements $SessionId $emptyCtaSelector)
  $script:facts['cardCountWhenFilteredEmpty'] = $cards.Count
  if ($cards.Count -ne 0 -or $mainButtons.Count -ne 0) {
    Fail-Condition '过滤空状态不成立：过滤后仍残留卡片或空库 CTA' "cardCount=$($cards.Count) mainButtons=$($mainButtons.Count)"
  }
}

function Get-VideoListFixtureStatus([string]$SessionId) {
  return [string](Invoke-WebDriverScript $SessionId @"
const fixture = $fixtureInterface;
if (!fixture || typeof fixture !== 'object') return 'absent';
return String(fixture.status || 'unknown');
"@)
}

function Assert-VideoListFixtureInterface([string]$SessionId) {
  $status = Get-VideoListFixtureStatus $SessionId
  $cardCount = @(Find-WebDriverElements $SessionId $cardSelector).Count
  $script:facts['fixtureInterfaceStatus'] = $status
  $script:facts['fixtureInterfaceCardCount'] = $cardCount

  if ($status -eq 'absent') {
    Fail-Condition 'AC-VL-04 的「非 ready 卡进入任务详情」「失败卡状态」「在真实卡片集合上的过滤空」三个条件无法判定：真实桌面 DOM 上不存在任何视频行，且受控夹具公开接口未建立' "interface=$fixtureInterface status=absent cardCount=$cardCount"
  }
  if ($status -eq 'failed') {
    $error = [string](Invoke-WebDriverScript $SessionId "return String(($fixtureInterface && $fixtureInterface.error) || 'unknown');")
    Fail-Condition '受控夹具公开接口报告建立失败：非 ready 与失败两份 fixture 未落库' "status=failed error=$error"
  }
  if ($status -ne 'idle') {
    Fail-Condition '隔离数据库不是空库：首次启动的夹具前置状态不成立' "status=$status cardCount=$cardCount"
  }
  if ($cardCount -ne 0) {
    Fail-Condition '空库前置条件不成立：隔离数据库已包含视频行' "status=$status cardCount=$cardCount"
  }
}

function Add-VideoListFixture([string]$SessionId) {
  $requested = [string](Invoke-WebDriverScript $SessionId @"
const fixture = $fixtureInterface;
if (!fixture || typeof fixture.seed !== 'function') return 'absent';
fixture.seed();
return 'requested';
"@)
  if ($requested -ne 'requested') {
    Fail-Condition '受控夹具公开接口缺少 seed：无法建立非 ready 与失败两份 fixture' "observed='$requested'"
  }
  Wait-WebDriverCondition $SessionId 'the controlled video list fixture publication' @"
const fixture = $fixtureInterface;
if (!fixture) return false;
return fixture.status === 'seeded' || fixture.status === 'failed';
"@
  $status = Get-VideoListFixtureStatus $SessionId
  if ($status -ne 'seeded') {
    $error = [string](Invoke-WebDriverScript $SessionId "return String(($fixtureInterface && $fixtureInterface.error) || 'unknown');")
    Fail-Condition '受控夹具未建立：非 ready 卡与失败卡未能写入隔离数据库' "status=$status error=$error"
  }
}

function Assert-PopulatedList([string]$SessionId) {
  $status = Get-VideoListFixtureStatus $SessionId
  $script:facts['fixtureStatusAfterRestart'] = $status
  if ($status -ne 'seeded') {
    Fail-Condition '受控夹具未跨桌面进程重启持久化：隔离数据库中缺少两份 fixture' "status=$status"
  }
  $cards = @(Find-WebDriverElements $SessionId $cardSelector)
  $script:facts['cardCountAfterRestart'] = $cards.Count
  if ($cards.Count -ne 2) {
    Fail-Condition '真实桌面 DOM 上的视频行数量与受控夹具不一致' "observed=$($cards.Count) expected=2"
  }
  foreach ($videoId in @($pendingVideoId, $failedVideoId)) {
    Find-WebDriverElement $SessionId "[data-testid=""card-$videoId""]" | Out-Null
  }
}

function Assert-NonReadyCardOpensTaskDetail(
  [string]$SessionId,
  [string]$VideoId,
  [string]$Title,
  [string]$ActionLabel,
  [string]$ExpectedActionTestId
) {
  $cardSelectorForVideo = "[data-testid=""card-$VideoId""]"
  Find-WebDriverElement $SessionId $cardSelectorForVideo | Out-Null
  $primary = Find-WebDriverElement $SessionId "$cardSelectorForVideo button"
  $label = Get-WebDriverElementAttribute $SessionId $primary 'aria-label'
  if ($label -ne $ActionLabel) {
    Fail-Condition '非 ready 卡片的公开动作语义不成立' "videoId=$VideoId observed='$label' expected='$ActionLabel'"
  }

  Invoke-WebDriverElementClick $SessionId $primary
  Wait-WebDriverCondition $SessionId "the task detail dialog for $VideoId" @"
return Boolean(document.querySelector('[role="dialog"][aria-labelledby="import-task-title-$VideoId"]'));
"@
  $dialogSelector = "[role=""dialog""][aria-labelledby=""import-task-title-$VideoId""]"
  $dialog = Find-WebDriverElement $SessionId $dialogSelector
  $heading = (Get-WebDriverElementText $SessionId (Find-WebDriverElement $SessionId "$dialogSelector h2")).Trim()
  if ($heading -ne "${Title}导入任务") {
    Fail-Condition '非 ready 卡进入的任务详情标题与既有生产文案不一致' "videoId=$VideoId observed='$heading'"
  }
  $progress = Find-WebDriverElement $SessionId "$dialogSelector progress"
  $progressMax = Get-WebDriverElementAttribute $SessionId $progress 'max'
  if ($progressMax -ne '100') {
    Fail-Condition '任务详情缺少既有导入进度条语义' "videoId=$VideoId max='$progressMax'"
  }
  $action = Find-WebDriverElement $SessionId "[data-testid=""$ExpectedActionTestId-$VideoId""]"
  if (-not (Test-WebDriverElementEnabled $SessionId $action)) {
    Fail-Condition '任务详情的既有显式动作必须可用' "videoId=$VideoId testId=$ExpectedActionTestId"
  }

  $close = Find-WebDriverElement $SessionId "[data-testid=""close-import-$VideoId""]"
  Invoke-WebDriverElementClick $SessionId $close
  Wait-WebDriverCondition $SessionId "the task detail dialog for $VideoId to close" @"
return !document.querySelector('[role="dialog"][aria-labelledby="import-task-title-$VideoId"]');
"@
  Find-WebDriverElement $SessionId $cardSelectorForVideo | Out-Null
}

function Assert-FailedCardState([string]$SessionId) {
  $badge = Find-WebDriverElement $SessionId "[data-testid=""badge-$failedVideoId""]"
  $badgeStatus = Get-WebDriverElementAttribute $SessionId $badge 'data-status'
  $badgeText = (Get-WebDriverElementText $SessionId $badge).Trim()
  $script:facts['failedBadge'] = "$badgeStatus/$badgeText"
  if ($badgeStatus -ne 'failed' -or $badgeText -ne '失败') {
    Fail-Condition '失败状态在真实桌面 DOM 上不可见' "data-status='$badgeStatus' text='$badgeText'"
  }
  $importStatusSelector = "[data-testid=""import-status-$failedVideoId""]"
  $importStatus = Find-WebDriverElement $SessionId $importStatusSelector -AllowMissing
  if (-not $importStatus) {
    Fail-Condition '失败卡缺少既有导入状态与可见错误面' "videoId=$failedVideoId selector=$importStatusSelector"
  }
}

function Save-ScreenshotAttachment([string]$SessionId) {
  try {
    $response = Invoke-WebDriver 'Get' "/session/$SessionId/screenshot"
    $payload = [string]$response.value
    if ([string]::IsNullOrWhiteSpace($payload)) { throw 'empty screenshot payload' }
    [System.IO.File]::WriteAllBytes($screenshotPath, [Convert]::FromBase64String($payload))
    $notice = @(
      '仅附件，不构成 Visual Evidence。',
      'AC-VL-04 的裁判是真实 WebDriver 读到的桌面 DOM 与真实点击；本目录只允许 1 张来自隔离 fixture 的截图。',
      "command: npm run e2e:video-list",
      "fixtureTitles: $pendingTitle / $failedTitle",
      "headSha: $($env:GITHUB_SHA)",
      "runId: $($env:GITHUB_RUN_ID)",
      "webView2Runtime: $($env:RAIN_E2E_WEBVIEW2_VERSION)",
      'screenshot: video-list-desktop-dom.png',
      'noKeysOrUserData: true'
    ) -join [Environment]::NewLine
    [System.IO.File]::WriteAllText(
      $attachmentNoticePath,
      $notice + [Environment]::NewLine,
      [System.Text.UTF8Encoding]::new($false)
    )
    Write-Output "Video List E2E phase: screenshot attachment written to $screenshotPath"
  } catch {
    Write-Warning "Video List E2E screenshot attachment unavailable: $($_.Exception.Message)"
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
  if (-not (Test-Path -LiteralPath $appBinary)) {
    throw "Rain debug binary not found: $appBinary"
  }

  $env:RAIN_E2E_MODE = '1'
  $env:RAIN_E2E_RUN_MODE = 'video-list'
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
  Open-VideoListPage $sessionId 'the video list page'
  Assert-WebDriverElementEndpoints $sessionId

  # 先裁判「受控夹具依赖条件」的前置事实（空库 + 夹具公开面），再裁判页面组合；
  # 这样夹具缺失时报告的是缺哪三个条件，而不是被后续组合断言掩盖。
  $phase = 'fixture-availability'
  Write-Output 'Video List E2E phase: controlled fixture availability'
  Assert-VideoListFixtureInterface $sessionId

  $phase = 'top-bar'
  Write-Output 'Video List E2E phase: video list top bar composition'
  Assert-TopBarComposition $sessionId

  $phase = 'empty-library-cta'
  Write-Output 'Video List E2E phase: empty library named call to action'
  Assert-EmptyLibraryCta $sessionId

  $phase = 'empty-library-filtered-state'
  Write-Output 'Video List E2E phase: filtered empty state on the empty library'
  Assert-FilteredEmptyState $sessionId


  $phase = 'seed-fixture'
  Write-Output 'Video List E2E phase: publish controlled fixture'
  Add-VideoListFixture $sessionId
  Close-WebDriverSession $sessionId
  $sessionId = $null

  $phase = 'restart'
  $sessionId = New-WebDriverSession $appBinary
  Open-VideoListPage $sessionId 'the video list page after the desktop restart'

  $phase = 'fixture-cards'
  Write-Output 'Video List E2E phase: controlled fixture rows after restart'
  Assert-PopulatedList $sessionId

  $phase = 'pending-task-detail'
  Write-Output 'Video List E2E phase: non ready card opens the task detail'
  Assert-NonReadyCardOpensTaskDetail $sessionId $pendingVideoId $pendingTitle $pendingActionLabel 'continue-import'

  $phase = 'failed-task-detail'
  Write-Output 'Video List E2E phase: failed card opens the task detail'
  Assert-NonReadyCardOpensTaskDetail $sessionId $failedVideoId $failedTitle $failedActionLabel 'retry-import'

  $phase = 'failed-card-state'
  Write-Output 'Video List E2E phase: failed card state'
  Assert-FailedCardState $sessionId

  $phase = 'screenshot-attachment'
  Save-ScreenshotAttachment $sessionId

  $phase = 'filtered-empty-with-cards'
  Write-Output 'Video List E2E phase: filtered empty state over the real cards'
  Assert-FilteredEmptyState $sessionId

  $runSucceeded = $true
  Write-Output 'Video List desktop E2E passed: top bar -> empty library call to action -> controlled fixture -> task detail -> failed state -> filtered empty state.'
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
      Write-Warning "Video List E2E diagnostic capture also failed: $($_.Exception.Message)"
    }
  }
  if (Test-Path -LiteralPath $runRoot) {
    $resolvedRunRoot = [System.IO.Path]::GetFullPath($runRoot)
    $safePrefix = $temporaryRoot.TrimEnd('\') + '\rain-video-list-e2e-'
    if (-not $resolvedRunRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove unexpected Video List E2E directory: $resolvedRunRoot"
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
      Write-Warning "Video List E2E cleanup also failed: $cleanupError"
    }
  }
  if (-not $primaryError) { Remove-FailureDiagnostics }
}
if ($primaryError) { throw $primaryError }
