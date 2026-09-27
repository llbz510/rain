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
  # ① 长目录两行结构 + 真实横向溢出：全部用驱动元素端点读真实几何。
  foreach ($level in @('structure', 'paragraph')) {
    Find-WebDriverElement $SessionId "[data-catalog-row=""$level""]" | Out-Null
    $owner = Find-WebDriverElement $SessionId "[data-catalog-scroll-row=""$level""]"
    $children = @(Find-WebDriverElements $SessionId "[data-catalog-scroll-row=""$level""] > *")
    if ($children.Count -lt 2) {
      Fail-Condition "长目录 $level 行缺少可裁判的子项" "count=$($children.Count)"
    }
    $ownerRect = Get-WebDriverElementRect $SessionId $owner
    $firstRect = Get-WebDriverElementRect $SessionId $children[0]
    $lastRect = Get-WebDriverElementRect $SessionId $children[$children.Count - 1]
    $extent = ([double]$lastRect.x + [double]$lastRect.width) - [double]$firstRect.x
    $script:facts["${level}RowOwnerWidth"] = $ownerRect.width
    $script:facts["${level}RowExtent"] = $extent
    $script:facts["${level}RowChildren"] = $children.Count
    if ($extent -le [double]$ownerRect.width) {
      Fail-Condition "长目录 $level 行没有真实横向溢出（横向不换行条件不成立）" "extent=$extent ownerWidth=$($ownerRect.width) children=$($children.Count)"
    }
  }
  $structureItems = @(Find-WebDriverElements $SessionId '[data-catalog-scroll-row="structure"] [data-testid^="progress-indicator-"]')
  $paragraphItems = @(Find-WebDriverElements $SessionId '[data-catalog-scroll-row="paragraph"] [data-testid^="paragraph-"]')
  $script:facts['structureItemCount'] = $structureItems.Count
  $script:facts['paragraphItemCount'] = $paragraphItems.Count
  if ($structureItems.Count -lt 24) {
    Fail-Condition '结构行（章节/小节）项目数不足' "count=$($structureItems.Count) expected>=24"
  }
  if ($paragraphItems.Count -lt 40) {
    Fail-Condition '段落行项目数不足' "count=$($paragraphItems.Count) expected>=40"
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

function Assert-CurrentItemCentered([string]$SessionId) {
  # ② 当前项居中跟随：真实点击中段目录节点（公开 seek）后，用驱动几何判据断言该节点被居中。
  $targetSelector = '[data-catalog-scroll-row="structure"] [data-testid="progress-indicator-e2e-catalog-chapter-5"]'
  $target = Find-WebDriverElement $SessionId $targetSelector
  Invoke-WebDriverElementClick $SessionId $target
  # 容差依据：生产的 scrollIntoView({block:'nearest', inline:'center'}) 只做子像素对齐，
  # 目录行无额外内边距；中段节点两侧都有滚动余量，因此中心差应接近 0。这里以 ≤2px 起判，
  # 若托管实测更大，必须记录实测值并写明依据后再定标（禁止无依据放大）。
  $tolerancePx = 2.0
  $owner = Find-WebDriverElement $SessionId '[data-catalog-scroll-row="structure"]'
  $deadline = (Get-Date).AddSeconds(5)
  $delta = $null
  do {
    Start-Sleep -Milliseconds 250
    $itemRect = Get-WebDriverElementRect $SessionId (Find-WebDriverElement $SessionId $targetSelector)
    $ownerRect = Get-WebDriverElementRect $SessionId $owner
    $itemCenter = [double]$itemRect.x + ([double]$itemRect.width / 2)
    $ownerCenter = [double]$ownerRect.x + ([double]$ownerRect.width / 2)
    $delta = [Math]::Abs($itemCenter - $ownerCenter)
  } while ($delta -gt $tolerancePx -and (Get-Date) -lt $deadline)
  $script:facts['currentItemCenterDeltaPx'] = $delta
  $script:facts['currentItemCenterTolerancePx'] = $tolerancePx
  if ($delta -gt $tolerancePx) {
    Fail-Condition '第②项不成立：真实点击中段目录节点后当前项未被居中跟随' "centerDeltaPx=$delta tolerance=$tolerancePx"
  }
}

function Assert-FadeOwners([string]$SessionId) {
  # ③ 边缘渐隐 owner：初态只右 → 真实滚轮至中段两侧同时 → 末端只左；
  # 每处核对 aria-hidden / pointer-events / 方向渐变（computed style 仅作标注补充证据）。
  foreach ($level in @('structure', 'paragraph')) {
    $owner = Find-WebDriverElement $SessionId "[data-catalog-scroll-row=""$level""]"
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
  # ④ 暂停后不再强制跟随：真实播放推进 → 真实暂停 → 真实点击另一目录节点（含起点节点 seek 到 0），
  # 两次位置变化前后滚动 owner 的 scrollLeft 相对基线不变。
  $mediaState = [string](Invoke-WebDriverScript $SessionId @"
const video = document.querySelector('video');
return video ? JSON.stringify({ currentTime: video.currentTime, paused: video.paused }) : '{"present":false}';
"@)
  $script:facts['pauseFollowPreState'] = $mediaState
  if ($mediaState -notmatch '"paused":true') {
    Fail-Condition '第④项前置不成立：媒体不处于暂停态（t42 探针应在达标后暂停）' "observed=$mediaState"
  }
  $baseline = Get-WebDriverRowScrollLeft $SessionId 'structure'
  $script:facts['pauseFollowBaselineScrollLeft'] = $baseline
  $playButton = Find-WebDriverElement $SessionId '[data-testid="control-bar"] button'
  Invoke-WebDriverElementClick $SessionId $playButton
  Start-Sleep -Seconds 2
  $afterAdvance = Get-WebDriverRowScrollLeft $SessionId 'structure'
  $script:facts['pauseFollowAfterMediaAdvance'] = $afterAdvance
  if ([double]$afterAdvance -ne [double]$baseline) {
    Fail-Condition '第④项不成立：媒体时间推进改变了滚动 owner 的 scrollLeft' "baseline=$baseline after=$afterAdvance"
  }
  Invoke-WebDriverElementClick $SessionId (Find-WebDriverElement $SessionId '[data-testid="control-bar"] button')
  Start-Sleep -Milliseconds 500
  $pausedState = [string](Invoke-WebDriverScript $SessionId "const video = document.querySelector('video'); return video ? String(video.paused) : 'absent';")
  $script:facts['pauseFollowPausedAgain'] = $pausedState
  if ($pausedState -ne 'True') {
    Fail-Condition '第④项前置不成立：第二次真实点击未使媒体暂停' "observed=$pausedState"
  }
  foreach ($nodeId in @('e2e-catalog-chapter-1', 'e2e-catalog-chapter-2')) {
    $node = Find-WebDriverElement $SessionId "[data-catalog-scroll-row=""structure""] [data-testid=""progress-indicator-$nodeId""]"
    Invoke-WebDriverElementClick $SessionId $node
    Start-Sleep -Milliseconds 800
    $after = Get-WebDriverRowScrollLeft $SessionId 'structure'
    $script:facts["pauseFollowAfterSeek-$nodeId"] = $after
    if ([double]$after -ne [double]$baseline) {
      Fail-Condition '第④项不成立：暂停后公开目录 seek 仍强制滚动' "node=$nodeId baseline=$baseline after=$after"
    }
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
  Write-Output 'Study Catalog E2E phase: open the study page through the production card action'
  $cardAction = Find-WebDriverElement $sessionId '[data-testid^="card-"] button'
  $cardLabel = Get-WebDriverElementAttribute $sessionId $cardAction 'aria-label'
  if ($cardLabel -notmatch '打开视频') {
    Fail-Condition '列表卡主操作不是既有「打开视频」动作，无法经生产路径进入学习页' "aria-label='$cardLabel'"
  }
  Invoke-WebDriverElementClick $sessionId $cardAction
  Wait-WebDriverCondition $sessionId 'the production study page' "return Boolean(document.querySelector('$pageSelector'));"

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
