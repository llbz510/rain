<#
.SYNOPSIS
  视觉证据包校验器（V1a 采集通道的独立校验器）。

.DESCRIPTION
  裁判对象是 `docs/development/visual-contract.md` §3.4 定义的视觉证据包（**不是** ASR/整理/数据库/
  有续事件/证明产物那类领域证据——那一类由既有的 `scripts/validate-evidence.ps1` 裁判，本文件
  不引用、不重定义、不复用它的任何字段）。

  §3.4 要求一次视觉证据包必须包含并与目标提交 SHA 绑定：
    1. 目标提交 SHA、视口尺寸（含 `devicePixelRatio`）、宿主与版本；
    2. 截图（附件）；
    3. 每个判据的实测记录：`VC-xx` + 选择器 + 几何 + 计算样式 + 实际合成颜色 + 对比度比值 + 采样视口；
    4. 逐条 `pass` / `needs_revision` 结论与差值。
  本校验器强制第 1–3 项齐备且可复算，并**显式拒绝**第 4 项被采集方代为签发（第 4 项只能由
  独立视觉审查员产出）。同时强制「本次已测 / 本次未测」两张清单。

  本校验器**不做**的事：不签发 Visual Evidence、不判任何 `VC-xx` 的 pass/needs_revision、
  不改任何 AC 状态或 Evidence tier、不宣布任何 AC 完成。

.PARAMETER EvidenceRoot
  证据包目录（含 `manifest.json`、`records/`、`screenshots/`）。缺省时扫描仓库根下的全部
  `evidence/visual-*` 目录；一个都没有时按「无已入库证据包」如实报出并以 0 退出。

.PARAMETER VerifyMathFile
  自检模式：传入一个 UTF-8 JSON 文件的路径，文件内容为一个数组（每个元素
  `{ name, fg, bg, expected }`，可选 `base`）。用本文件**生产路径上的**合成与 WCAG 2.1 对比度函数
  逐条复算，与 `expected` 相差超过 ±0.05 即 `MISMATCH` 并以 1 退出。目的：使「合成与对比度数学」
  可以被独立复算，而不是只存在于采集脚本里。
  （用文件而不是命令行参数：Windows 参数解析会吃掉 JSON 里的引号，内联 JSON 不可用。）

.PARAMETER RepoRoot
  仓库根（缺省 = 本脚本上一级目录）。仅用于定位缺省扫描目录。

.PARAMETER Tolerance
  对比度复算容差（缺省 0.05 = §3.3）。
#>
param(
  [string]$EvidenceRoot,
  [string]$VerifyMathFile,
  [string]$RepoRoot,
  [double]$Tolerance = 0.05
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Get-Item -LiteralPath (Split-Path -Parent $PSScriptRoot)).FullName
}

# 18 个可裁判编号：VC-01…VC-17 + VC-19。VC-18 是保留空号（决策 80 仍为 Proposed）。
$script:ContractIds = @(
  'VC-01', 'VC-02', 'VC-03', 'VC-04', 'VC-05', 'VC-06', 'VC-07', 'VC-08', 'VC-09',
  'VC-10', 'VC-11', 'VC-12', 'VC-13', 'VC-14', 'VC-15', 'VC-16', 'VC-17', 'VC-19'
)
$script:ReservedIds = @('VC-18')

# §3.3 的允许误差（冻结值；证据包里声明的容差必须与之逐项相等）。
$script:FrozenTolerance = [ordered]@{
  colorChannel = 1
  contrastRatio = 0.05
  fixedHeightPx = 0.5
  renderedGeometryPx = 2
  exactValues = $true
}

# 每条实测记录必须齐备的计算样式字段（§3.4 第 3 项「计算样式」的最小可裁判集）。
$script:RequiredComputedStyleKeys = @(
  'color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'fontVariantNumeric',
  'lineHeight', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderRadius',
  # 四边的 width/style 全部必填：`measured.border.rendered` 是**自报**字段，必须能由这些
  # 真实计算样式交叉核对（否则采集器把 rendered 取自错误属性时整道门控会静默失效）。
  'borderRightWidth', 'borderRightStyle', 'borderBottomWidth', 'borderBottomStyle',
  'borderLeftWidth', 'borderLeftStyle', 'outlineStyle', 'outlineWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'boxShadow'
)

# 记录级几何字段（getBoundingClientRect 的逻辑像素）。
$script:RequiredRectKeys = @('x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left')

$script:Failures = New-Object System.Collections.Generic.List[string]
$script:CheckedPackages = 0
# 声明 provenance≠real-collector 的包（演练/合成）单独计数：形状可以一样，但**不是证据**。
$script:RehearsalPackages = 0

function Add-Failure([string]$Message) {
  $script:Failures.Add($Message)
}

function Throw-IfFailed {
  if ($script:Failures.Count -eq 0) { return }
  $lines = @('VISUAL_EVIDENCE_INVALID:', [string]$script:Failures.Count, '项校验失败') -join ' '
  $index = 0
  foreach ($failure in $script:Failures) {
    $index += 1
    $lines += ('  [' + $index + '] ' + $failure)
    Write-Warning ('visual evidence failure [' + $index + ']: ' + $failure)
  }
  throw ($lines -join ([Environment]::NewLine))
}

function Resolve-EvidencePackageFilePath(
  [string]$EvidenceDir,
  [string]$ManifestPath,
  [string]$Kind,
  [string]$Where
) {
  if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    Add-Failure ($Where + '：包内路径为空')
    return $null
  }
  if ([System.IO.Path]::IsPathRooted($ManifestPath)) {
    Add-Failure ($Where + "：绝对路径不允许出现在 evidence package manifest：'$ManifestPath'")
    return $null
  }

  $requiredPattern = if ($Kind -eq 'screenshot') { '(?i)^screenshots/[^/\\]+\.png$' } else { '(?i)^records/[^/\\]+\.json$' }
  $requiredShape = if ($Kind -eq 'screenshot') { 'screenshots/*.png' } else { 'records/*.json' }
  if ($ManifestPath -notmatch $requiredPattern) {
    Add-Failure ($Where + "：路径 '$ManifestPath' 不符合唯一允许的包内形状 $requiredShape（只允许直接子文件，不允许 ../、反斜杠或嵌套目录）")
    return $null
  }

  $root = [System.IO.Path]::GetFullPath($EvidenceDir).TrimEnd([char[]]@('\', '/'))
  $candidate = $null
  try {
    $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $ManifestPath))
  } catch {
    Add-Failure ($Where + "：路径 '$ManifestPath' 无法规范化：" + $_.Exception.Message)
    return $null
  }
  $rootPrefix = $root + [System.IO.Path]::DirectorySeparatorChar
  if (-not $candidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    Add-Failure ($Where + "：路径 '$ManifestPath' 规范化后逃逸 evidence package root '$root'")
    return $null
  }

  # 词法 containment 不足以拦 junction/symlink：逐段拒绝 reparse point，防止一个看似合法的
  # screenshots/foo.png 或 records/foo.json 实际解析到包根之外。
  $current = $root
  foreach ($segment in @($ManifestPath -split '/')) {
    $current = Join-Path $current $segment
    if (-not (Test-Path -LiteralPath $current)) { continue }
    $item = Get-Item -LiteralPath $current -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      Add-Failure ($Where + "：路径 '$ManifestPath' 穿过 symbolic-link/junction reparse-point '$current'；证据文件必须物理位于包根内")
      return $null
    }
  }
  return $candidate
}

#region 颜色与对比度数学（复算基底）

function ConvertTo-Rgb8([string]$Token) {
  # 只接受可被本校验器逐字节复算的形式：hex 与 rgb()/rgba()。
  # 任何其它形式（CSS 变量、颜色关键字、color() 等）一律 PARSE_FAIL——绝不静默取默认值。
  # 返回值统一为 hashtable @{ rgb = [double[]](r,g,b); alpha = [double] }：
  # 避免「有时返回数组、有时返回 hashtable」在 PowerShell 参数绑定下被解包（本轮实测过的坑）。
  if ([string]::IsNullOrWhiteSpace($Token)) { throw 'PARSE_FAIL: empty colour token' }
  $text = $Token.Trim()
  if ($text.StartsWith('#')) {
    $body = $text.Substring(1)
    if ($body.Length -eq 3 -and $body -match '^[0-9a-fA-F]{3}$') {
      $expanded = ''
      foreach ($character in $body.ToCharArray()) { $expanded += ([string]$character + [string]$character) }
      $body = $expanded
    }
    if ($body.Length -eq 6 -and $body -match '^[0-9a-fA-F]{6}$') {
      return @{
        rgb = [double[]]@(
          [Convert]::ToInt32($body.Substring(0, 2), 16),
          [Convert]::ToInt32($body.Substring(2, 2), 16),
          [Convert]::ToInt32($body.Substring(4, 2), 16)
        )
        alpha = 1.0
      }
    }
    if ($body.Length -eq 8 -and $body -match '^[0-9a-fA-F]{8}$') {
      return @{
        rgb = [double[]]@(
          [Convert]::ToInt32($body.Substring(0, 2), 16),
          [Convert]::ToInt32($body.Substring(2, 2), 16),
          [Convert]::ToInt32($body.Substring(4, 2), 16)
        )
        alpha = ([Convert]::ToInt32($body.Substring(6, 2), 16) / 255.0)
      }
    }
    throw ('PARSE_FAIL: unsupported hex colour token ' + $Token)
  }
  $functional = [regex]::Match($text, '(?i)^rgba?\(([^)]*)\)$')
  if ($functional.Success) {
    $parts = @($functional.Groups[1].Value -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
    if ($parts.Count -ne 3 -and $parts.Count -ne 4) {
      throw ('PARSE_FAIL: unsupported rgb()/rgba() token ' + $Token)
    }
    $channels = New-Object System.Collections.Generic.List[double]
    foreach ($part in $parts[0..2]) {
      $integer = [regex]::Match($part, '^[0-9]+$')
      $percent = [regex]::Match($part, '^([0-9]*\.?[0-9]+)%$')
      $channelValue = -1.0
      if ($integer.Success) {
        $channelValue = [double]$part
      } elseif ($percent.Success) {
        $channelValue = [double][Math]::Round([double]$percent.Groups[1].Value * 2.55)
      } else {
        throw ('PARSE_FAIL: unsupported rgb()/rgba() channel ' + $part + ' in ' + $Token)
      }
      if ($channelValue -lt 0 -or $channelValue -gt 255) { throw ('PARSE_FAIL: channel out of range in ' + $Token) }
      $channels.Add($channelValue)
    }
    $alpha = 1.0
    if ($parts.Count -eq 4) {
      $plain = [regex]::Match($parts[3], '^[0-9]*\.?[0-9]+$')
      $alphaPercent = [regex]::Match($parts[3], '^([0-9]*\.?[0-9]+)%$')
      if ($plain.Success) {
        $alpha = [double]$parts[3]
      } elseif ($alphaPercent.Success) {
        $alpha = ([double]$alphaPercent.Groups[1].Value / 100.0)
      } else {
        throw ('PARSE_FAIL: unsupported alpha ' + $parts[3] + ' in ' + $Token)
      }
      if ($alpha -lt 0 -or $alpha -gt 1) { throw ('PARSE_FAIL: alpha out of range in ' + $Token) }
    }
    return @{ rgb = [double[]]$channels.ToArray(); alpha = $alpha }
  }
  throw ('PARSE_FAIL: unsupported colour token ' + $Token)
}

function Get-Rgb8FromToken([string]$Token) {
  $parsed = ConvertTo-Rgb8 $Token
  if ([double]$parsed.alpha -lt 1.0) {
    throw ('PARSE_FAIL: ' + $Token + ' is not opaque; composite it before comparing')
  }
  return [double[]]@($parsed.rgb)
}

function Get-CompositedRgb8([string]$Foreground, [string]$Backdrop, [string]$Base) {
  # source-over 合成：结果按 sRGB 字节四舍五入后返回（§3.2「rgba 需按层合成到不透明底色上再比较」）。
  # $Base 用于「半透明层压在半透明层上」的三层情形；缺省时 $Backdrop 必须本身不透明。
  $backdropParsed = $null
  if (-not [string]::IsNullOrWhiteSpace($Base)) {
    $baseParsed = ConvertTo-Rgb8 $Base
    $backdropParsed = ConvertTo-Rgb8 $Backdrop
    $blendedBackdrop = New-Object System.Collections.Generic.List[double]
    for ($blendIndex = 0; $blendIndex -lt 3; $blendIndex++) {
      $blendedBackdrop.Add(
        ([double]$backdropParsed.alpha * [double]$backdropParsed.rgb[$blendIndex]) +
        ((1.0 - [double]$backdropParsed.alpha) * [double]$baseParsed.rgb[$blendIndex])
      )
    }
    $backdropParsed = @{ rgb = [double[]]$blendedBackdrop.ToArray(); alpha = 1.0 }
  } else {
    $backdropParsed = ConvertTo-Rgb8 $Backdrop
    if ([double]$backdropParsed.alpha -lt 1.0) {
      throw ('PARSE_FAIL: backdrop ' + $Backdrop + ' is not opaque; supply the opaque base layer instead of assuming one')
    }
  }
  $foregroundParsed = ConvertTo-Rgb8 $Foreground
  $composited = New-Object System.Collections.Generic.List[int]
  for ($mixIndex = 0; $mixIndex -lt 3; $mixIndex++) {
    $blended = ([double]$foregroundParsed.alpha * [double]$foregroundParsed.rgb[$mixIndex]) +
               ((1.0 - [double]$foregroundParsed.alpha) * [double]$backdropParsed.rgb[$mixIndex])
    $composited.Add([int][Math]::Round($blended, [MidpointRounding]::AwayFromZero))
  }
  return [int[]]$composited.ToArray()
}

function Get-ChannelLuminance([double]$Channel) {
  $scaled = $Channel / 255.0
  if ($scaled -le 0.03928) { return $scaled / 12.92 }
  return [Math]::Pow((($scaled + 0.055) / 1.055), 2.4)
}

function Get-RelativeLuminance([double[]]$Rgb) {
  # 参数类型必须显式写成 [double[]]：PowerShell 的**命令调用**不做数组展开，
  # 无类型参数会把 3 元素数组当成「多个位置参数」而只拿到第一个通道（本轮实测的坑）。
  if ($null -eq $Rgb -or $Rgb.Count -ne 3) { throw 'PARSE_FAIL: relative luminance needs exactly 3 channels' }
  $red = Get-ChannelLuminance ([double]$Rgb[0])
  $green = Get-ChannelLuminance ([double]$Rgb[1])
  $blue = Get-ChannelLuminance ([double]$Rgb[2])
  return ((0.2126 * $red) + (0.7152 * $green) + (0.0722 * $blue))
}

function Get-ContrastRatio([double[]]$First, [double[]]$Second) {
  # WCAG 2.1: (L1 + 0.05) / (L2 + 0.05)，L1 为较亮者。不取整，与采集侧同一口径。
  $luminanceFirst = Get-RelativeLuminance $First
  $luminanceSecond = Get-RelativeLuminance $Second
  $lighter = [Math]::Max($luminanceFirst, $luminanceSecond)
  $darker = [Math]::Min($luminanceFirst, $luminanceSecond)
  return (($lighter + 0.05) / ($darker + 0.05))
}

function Get-ContrastRatioFromTokens([string]$Foreground, [string]$Backdrop, [string]$Base) {
  # 判定用的「背景」是合成后的不透明底色：若给了 $Base，则 $Backdrop 先合成到 $Base 上。
  # 用 List[double] 承载而不是数组变量：PowerShell 的数组在「函数返回 → 变量 → 参数」这条链上
  # 会被反复解包（本轮实测：3 通道会退化成 "229 229 229" 这样的字符串），强类型集合不会。
  if ([string]::IsNullOrWhiteSpace($Foreground)) { throw 'PARSE_FAIL: foreground token missing' }
  if ([string]::IsNullOrWhiteSpace($Backdrop)) { throw 'PARSE_FAIL: backdrop token missing' }
  $foregroundChannels = @(Get-CompositedRgb8 $Foreground $Backdrop $Base)
  $backgroundChannels = @()
  if ([string]::IsNullOrWhiteSpace($Base)) {
    $backgroundChannels = @(Get-Rgb8FromToken $Backdrop)
  } else {
    $backgroundChannels = @(Get-CompositedRgb8 $Backdrop $Base '')
  }
  if ($foregroundChannels.Count -ne 3 -or $backgroundChannels.Count -ne 3) {
    throw ('PARSE_FAIL: composited colours did not resolve to 3 channels each (fg=' +
      $foregroundChannels.Count + ' bg=' + $backgroundChannels.Count + ')')
  }
  return Get-ContrastRatio (ConvertTo-DoubleArray $foregroundChannels) (ConvertTo-DoubleArray $backgroundChannels)
}

#endregion

#region 自检模式

function Invoke-MathVerification([string]$VectorsPath) {
  # 向量从**文件**读入而不是命令行参数：Windows 的参数解析会把 JSON 里的引号吃掉，
  # 使内联 JSON 变成 `[{name:single,...}]` 这种无法解析的形态（本轮实测）。
  if (-not (Test-Path -LiteralPath $VectorsPath -PathType Leaf)) {
    throw ('VERIFY_MATH_PARSE_FAIL: vectors file not found: ' + $VectorsPath)
  }
  $vectors = @()
  try {
    $parsed = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($VectorsPath, [System.Text.UTF8Encoding]::new($false)))
  } catch {
    throw ('VERIFY_MATH_PARSE_FAIL: vectors file is not valid JSON: ' + $_.Exception.Message)
  }
  foreach ($vector in @($parsed)) { $vectors += $vector }
  if ($vectors.Count -eq 0) { throw 'VERIFY_MATH_PARSE_FAIL: at least one vector is required' }

  $exitCode = 0
  $verified = 0
  foreach ($vector in $vectors) {
    $name = [string]$vector.name
    if ([string]::IsNullOrWhiteSpace($name)) { throw 'VERIFY_MATH_PARSE_FAIL: every vector needs a name' }
    $base = ''
    $baseProperty = $vector.PSObject.Properties['base']
    if ($null -ne $baseProperty -and $null -ne $baseProperty.Value) { $base = [string]$baseProperty.Value }
    try {
      $ratio = Get-ContrastRatioFromTokens ([string]$vector.fg) ([string]$vector.bg) $base
    } catch {
      Write-Output ('PARSE_FAIL ' + $name + ' | ' + $_.Exception.Message)
      $exitCode = 1
      continue
    }
    if ([string]::IsNullOrWhiteSpace([string]$vector.expected)) {
      Write-Output ('PARSE_FAIL ' + $name + ' | expected value missing')
      $exitCode = 1
      continue
    }
    $expected = [double]$vector.expected
    if ([Math]::Abs($ratio - $expected) -gt $Tolerance) {
      $compositedForeground = ((Get-CompositedRgb8 ([string]$vector.fg) ([string]$vector.bg) $base) -join ',')
      Write-Output ('MISMATCH ' + $name + ' | computed=' + $ratio.ToString('0.######') +
        ' expected=' + $expected + ' delta=' + ([Math]::Abs($ratio - $expected)).ToString('0.######') +
        ' tolerance=' + $Tolerance + ' compositedFg=rgb(' + $compositedForeground + ') backdrop=' + [string]$vector.bg)
      $exitCode = 1
      continue
    }
    $verified += 1
    Write-Output ('OK ' + $name + ' ratio=' + $ratio.ToString('0.######') + ' expected=' + $expected)
  }
  Write-Output ('OK_VECTORS ' + $verified)
  if ($exitCode -ne 0) {
    throw ('VISUAL_EVIDENCE_MATH_INVALID: ' + ($vectors.Count - $verified) + ' vector(s) failed recomputation (tolerance=' + $Tolerance + ')')
  }
}

#endregion

#region 证据包校验

function Get-JsonProperty($Object, [string]$Name) {
  if ($null -eq $Object) { return $null }
  if ($Object -is [string]) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Test-JsonProperty($Object, [string]$Name) {
  # ConvertFrom-Json 会把**空数组**也读成 $null，所以「字段缺失」与「字段是空数组」用
  # Get-JsonProperty 分不开。要区分二者（matches 允许空数组但不允许缺字段）必须看属性是否存在。
  if ($null -eq $Object) { return $false }
  if ($Object -is [string]) { return $false }
  return ($null -ne $Object.PSObject.Properties[$Name])
}

function Assert-RequiredProperty($Object, [string]$Name, [string]$Where) {
  $value = Get-JsonProperty $Object $Name
  if ($null -eq $value) {
    Add-Failure ($Where + " 缺少必填字段 '" + $Name + "'（§3.4）；本校验器不会为缺失字段生成默认值")
    return $null
  }
  return $value
}

function Assert-NonEmptyString($Object, [string]$Name, [string]$Where) {
  $value = Assert-RequiredProperty $Object $Name $Where
  if ($null -eq $value) { return $null }
  if ($value -isnot [string] -or [string]::IsNullOrWhiteSpace($value)) {
    Add-Failure ($Where + " 的字段 '" + $Name + "' 必须是非空字符串")
    return $null
  }
  return $value
}

function Assert-Number($Object, [string]$Name, [string]$Where) {
  $value = Assert-RequiredProperty $Object $Name $Where
  if ($null -eq $value) { return $null }
  $number = 0.0
  if (-not [double]::TryParse([string]$value, [ref]$number)) {
    Add-Failure ($Where + " 的字段 '" + $Name + "' 必须是数值")
    return $null
  }
  return $number
}

function Assert-PositiveNumber($Object, [string]$Name, [string]$Where) {
  $number = Assert-Number $Object $Name $Where
  if ($null -eq $number) { return $null }
  if ($number -le 0) {
    Add-Failure ($Where + " 的字段 '" + $Name + "' 必须为正数（实际 " + $number + "）")
    return $null
  }
  return $number
}

function Assert-IdList($List, [string]$Where) {
  $ids = New-Object System.Collections.Generic.List[string]
  foreach ($entry in @($List)) {
    $text = [string]$entry
    if ($script:ReservedIds -contains $text) {
      Add-Failure ($Where + " 含保留空号 '" + $text + "'：VC-18（决策 80 仍为 Proposed）整条不进入裁判表，既不算已测也不算未测")
      continue
    }
    if ($script:ContractIds -notcontains $text) {
      Add-Failure ($Where + " 含未知编号 '" + $text + "'：本合同只有 VC-01…VC-17 与 VC-19")
      continue
    }
    if ($ids.Contains($text)) {
      Add-Failure ($Where + " 重复列出 '" + $text + "'")
      continue
    }
    $ids.Add($text)
  }
  return $ids
}

function Assert-PngFile([string]$Path, [string]$Where) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Add-Failure ($Where + ' 指向的文件不存在：' + $Path + '（只有截图时本合同的任何一条都判不了）')
    return $null
  }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -lt 8) {
    Add-Failure ($Where + ' 的文件短于 PNG 头：' + $Path)
    return $null
  }
  $signature = @(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
  for ($index = 0; $index -lt $signature.Count; $index++) {
    if ($bytes[$index] -ne $signature[$index]) {
      Add-Failure ($Where + ' 不是 PNG 文件（magic bytes 不符）：' + $Path)
      return $null
    }
  }
  return [ordered]@{ path = $Path; bytes = $bytes.Length }
}

function ConvertTo-DoubleArray($Values) {
  $list = New-Object System.Collections.Generic.List[double]
  foreach ($entry in @($Values)) { $list.Add([double]$entry) }
  return [double[]]$list.ToArray()
}

function Assert-DecomposedColour([string]$Declared, [double[]]$Measured, [string]$Label, [string]$FieldName, [string]$Where) {
  # declared 必须是不透明值，且与实测合成色逐通道相差 ≤ §3.3 的 ±1。
  try {
    $declaredParsed = ConvertTo-Rgb8 $Declared
    if ([double]$declaredParsed.alpha -lt 1.0) {
      Add-Failure ($Where + '：' + $Label + '声明 ' + $Declared + ' 不是不透明值；实测记录必须先按 §3.2 合成')
      return
    }
    for ($channelIndex = 0; $channelIndex -lt 3; $channelIndex++) {
      if ([Math]::Abs([double]$declaredParsed.rgb[$channelIndex] - $Measured[$channelIndex]) -gt $script:FrozenTolerance.colorChannel) {
        Add-Failure ($Where + '：' + $FieldName + '=' + (($Measured | ForEach-Object { [int]$_ }) -join ',') +
          ' 与声明的实测' + $Label + ' ' + $Declared + ' 相差超过 ±' + $script:FrozenTolerance.colorChannel + '/通道')
        return
      }
    }
  } catch {
    Add-Failure ($Where + '：' + $Label + '实测值无法复算（' + $_.Exception.Message + '）')
  }
}

function Assert-ChannelReproducible([string]$DeclaredComputed, [double[]]$Measured, [double[]]$Backdrop, [string]$Label, [string]$Where) {
  # 边框/轮廓通道的**可复算性**：元素自己的原始计算值（declaredComputed）必须能产生这条通道的
  # 合成值——不透明值直接比；半透明值按 §3.2 先合成到本条记录的不透明底色（measured.bg.rgba8）上再比。
  # 为什么必须有这一条：采集器在**解析失败**时曾拿"合成底色"充当通道值。那种自造值与真测值在
  # JSON 里长得一模一样（都是 3 个通道），只有把 declaredComputed 拉进复算才能把它们分开。
  if ([string]::IsNullOrWhiteSpace($DeclaredComputed)) {
    Add-Failure ($Where + '.' + $Label + '：缺少 declaredComputed（元素自己的原始计算值）——没有它，这条通道的值无法与自造值区分')
    return
  }
  try {
    $parsed = ConvertTo-Rgb8 $DeclaredComputed
  } catch {
    Add-Failure ($Where + '.' + $Label + '：declaredComputed ''' + $DeclaredComputed + ''' 无法解析为颜色（' + $_.Exception.Message + '）')
    return
  }
  $expected = [double[]]$parsed.rgb
  if ([double]$parsed.alpha -lt 1.0) {
    if ($null -eq $Backdrop -or $Backdrop.Count -ne 3) {
      Add-Failure ($Where + '.' + $Label + '：declaredComputed 是半透明值，但本条记录没有可用的不透明底色（measured.bg.rgba8）来复算合成值')
      return
    }
    $alpha = [double]$parsed.alpha
    $expected = [double[]]@(
      [Math]::Round($alpha * [double]$parsed.rgb[0] + (1 - $alpha) * [double]$Backdrop[0]),
      [Math]::Round($alpha * [double]$parsed.rgb[1] + (1 - $alpha) * [double]$Backdrop[1]),
      [Math]::Round($alpha * [double]$parsed.rgb[2] + (1 - $alpha) * [double]$Backdrop[2])
    )
  }
  for ($channelIndex = 0; $channelIndex -lt 3; $channelIndex++) {
    if ([Math]::Abs([double]$expected[$channelIndex] - $Measured[$channelIndex]) -gt $script:FrozenTolerance.colorChannel) {
      Add-Failure ($Where + '.' + $Label + '：declaredComputed ''' + $DeclaredComputed + ''' 复算出的通道 [' +
        (($expected | ForEach-Object { [int]$_ }) -join ',') + '] 与实测 [' + (($Measured | ForEach-Object { [int]$_ }) -join ',') +
        '] 相差超过 ±' + $script:FrozenTolerance.colorChannel + '/通道——这条通道值无法由它自己声明的原始值产生')
      return
    }
  }
}

function Assert-ManifestCoverage($Manifest, $Records, [string]$Where) {
  $coverage = Assert-RequiredProperty $Manifest 'coverage' $Where
  if ($null -eq $coverage) { return }
  $testedRaw = Get-JsonProperty $coverage 'tested'
  $untestedRaw = Get-JsonProperty $coverage 'untested'
  # 缺任一张清单即视为未诚实标注（§3.4：必须显式列出「本次已测」与「本次未测」两张清单）。
  if ($null -eq $testedRaw) {
    Add-Failure ($Where + '.coverage 缺少 tested 清单（§3.4 要求显式列出本次已测）')
    return
  }
  if ($null -eq $untestedRaw) {
    Add-Failure ($Where + '.coverage 缺少 untested 清单（§3.4 要求显式列出本次未测；未测项一律视为未取得证据）')
    return
  }

  $tested = @(Assert-IdList $testedRaw ($Where + '.coverage.tested'))
  $untested = @(Assert-IdList $untestedRaw ($Where + '.coverage.untested'))

  # 部分覆盖必须"诚实标注到维度"：只列编号不够——「已测 VC-03」可以指主按钮文字，也可以指聚焦圈。
  # 因此要求显式写出本轮实测到的维度范围（scopeNote），与每条记录的 criterion 相互对账。
  Assert-NonEmptyString $coverage 'scopeNote' ($Where + '.coverage') | Out-Null
  $recordCriteria = @($Records | ForEach-Object { [string](Get-JsonProperty $_ 'criterion') })
  if (-not ($recordCriteria | Where-Object { $_.Length -gt 0 })) {
    Add-Failure ($Where + '：没有任何记录声明它测的是哪一维（criterion 全空）')
  }

  foreach ($id in $tested) {
    if ($untested -contains $id) { Add-Failure ($Where + "：'" + $id + "' 同时出现在已测与未测两张清单里") }
  }
  foreach ($id in $script:ContractIds) {
    if (($tested -notcontains $id) -and ($untested -notcontains $id)) {
      Add-Failure ($Where + "：'" + $id + "' 既不在已测也不在未测清单里；未测项必须如实登记（§3.4）")
    }
  }

  # 记录与清单必须一一对应：列了已测就必须有实测记录，有记录就必须列在已测。
  $recordIds = @($Records | ForEach-Object { [string](Get-JsonProperty $_ 'vc') })
  foreach ($id in $tested) {
    if ($recordIds -notcontains $id) {
      Add-Failure ($Where + "：'" + $id + "' 被列为已测，但证据包里没有任何该判据的实测记录")
    }
  }
  foreach ($id in $recordIds) {
    if ($tested -notcontains $id) {
      Add-Failure ($Where + "：存在 '" + $id + "' 的实测记录，但它没有出现在已测清单里")
    }
  }
}

function Assert-RecordContrast($Record, $Ratio, [string]$Where) {
  $declaredRatio = Assert-Number $Ratio 'value' ($Where + '.measured.contrastRatio')
  $threshold = Assert-Number $Ratio 'threshold' ($Where + '.measured.contrastRatio')
  $declaredTolerance = Assert-Number $Ratio 'tolerance' ($Where + '.measured.contrastRatio')
  $formula = Assert-NonEmptyString $Ratio 'formula' ($Where + '.measured.contrastRatio')
  $basis = Assert-NonEmptyString $Ratio 'toleranceBasis' ($Where + '.measured.contrastRatio')
  $thresholdBasis = Assert-NonEmptyString $Ratio 'thresholdBasis' ($Where + '.measured.contrastRatio')

  if ($null -ne $formula -and $formula -ne 'WCAG21:(L1+0.05)/(L2+0.05)') {
    Add-Failure ($Where + '：对比度公式必须是 WCAG21:(L1+0.05)/(L2+0.05)，实际 ' + $formula)
  }
  if ($null -ne $basis -and $basis -notmatch '3\.3') {
    Add-Failure ($Where + '：toleranceBasis 必须写明容差来源（§3.3），实际 ' + $basis)
  }
  if ($null -ne $declaredTolerance -and [Math]::Abs($declaredTolerance - $script:FrozenTolerance.contrastRatio) -gt 1e-9) {
    Add-Failure ($Where + '：记录声明的对比度容差 ' + $declaredTolerance + ' 不等于 §3.3 的 ' + $script:FrozenTolerance.contrastRatio)
  }

  $measured = Get-JsonProperty $Record 'measured'
  $fg = Get-JsonProperty $measured 'fg'
  $bg = Get-JsonProperty $measured 'bg'
  if ($null -eq $fg) {
    Add-Failure ($Where + '.measured 缺少 fg（实际合成后的前景色）')
    return
  }
  if ($null -eq $bg) {
    Add-Failure ($Where + '.measured 缺少 bg（逐层合成到不透明底后的背景色）')
    return
  }
  Assert-NonEmptyString $fg 'source' ($Where + '.measured.fg') | Out-Null
  Assert-NonEmptyString $bg 'source' ($Where + '.measured.bg') | Out-Null
  $fgRgba = Get-JsonProperty $fg 'rgba8'
  $bgRgba = Get-JsonProperty $bg 'rgba8'
  if ($null -eq $fgRgba) {
    Add-Failure ($Where + '.measured.fg 缺少 rgba8')
    return
  }
  if ($null -eq $bgRgba) {
    Add-Failure ($Where + '.measured.bg 缺少 rgba8')
    return
  }

  $fgChannels = ConvertTo-DoubleArray $fgRgba
  $bgChannels = ConvertTo-DoubleArray $bgRgba
  if ($fgChannels.Count -ne 3) { Add-Failure ($Where + '.measured.fg.rgba8 必须是 3 个通道'); return }
  if ($bgChannels.Count -ne 3) { Add-Failure ($Where + '.measured.bg.rgba8 必须是 3 个通道'); return }

  # 合成结果必须与记录里的实测值自洽（±1/通道）。
  # 采集侧已把每一层合成到不透明底色上，因此 declared 与 rgba8 都必须是不透明值：
  # 半透明值出现在此处即表示该记录没有按 §3.2 完成合成，如实失败而不是替它猜一个底。
  $fgDeclared = Get-JsonProperty $fg 'declared'
  if ($null -ne $fgDeclared) {
    Assert-DecomposedColour ([string]$fgDeclared) $fgChannels '前景' 'measured.fg.rgba8' $Where
  }
  $bgDeclared = Get-JsonProperty $bg 'declared'
  if ($null -ne $bgDeclared) {
    Assert-DecomposedColour ([string]$bgDeclared) $bgChannels '底色' 'measured.bg.rgba8' $Where
  }

  # alpha / composited 是记录**自报**的元数据（"这个值是不是合成出来的"），必须与 declared 自洽：
  # 否则一条记录可以自称"我合成过了"，而 declared/rgba8 其实是没合成的原值。
  #  - alpha 必须等于 declared 的 alpha（§3.3 对 alpha 没有容差档位，按 1e-6 比较）；
  #  - fg.composited 必须等于"declared 是否半透明"；bg 走逐层合成，composited 必须为 true。
  foreach ($pair in @(
    @{ name = 'measured.fg'; block = $fg; expectCompositedTrue = $false },
    @{ name = 'measured.bg'; block = $bg; expectCompositedTrue = $true }
  )) {
    $declaredText = [string](Get-JsonProperty $pair.block 'declared')
    $alphaValue = Get-JsonProperty $pair.block 'alpha'
    $compositedValue = Get-JsonProperty $pair.block 'composited'
    $alphaNumber = $null
    if ($null -ne $alphaValue) {
      $parsedAlpha = 0.0
      if (-not [double]::TryParse([string]$alphaValue, [ref]$parsedAlpha)) {
        Add-Failure ($Where + '.' + $pair.name + '.alpha 不是数字：' + [string]$alphaValue)
      } elseif ($parsedAlpha -lt 0 -or $parsedAlpha -gt 1) {
        Add-Failure ($Where + '.' + $pair.name + '.alpha 必须在 [0,1]：' + [string]$alphaValue)
      } else {
        $alphaNumber = $parsedAlpha
      }
    }
    if ($null -ne $alphaNumber -and -not [string]::IsNullOrWhiteSpace($declaredText)) {
      try {
        $declaredParsedAlpha = ConvertTo-Rgb8 $declaredText
        if ([Math]::Abs([double]$declaredParsedAlpha.alpha - $alphaNumber) -gt 1e-6) {
          Add-Failure ($Where + '.' + $pair.name + '：alpha=' + $alphaNumber + ' 与 declared ' + $declaredText +
            ' 的 alpha=' + ([double]$declaredParsedAlpha.alpha) + ' 不一致——自报的 alpha 无法由声明的实测值解释')
        }
      } catch {
        # declared 本身无法解析时，上面的 Assert-DecomposedColour 已经报过失败，不重复。
      }
    }
    if ($null -eq $compositedValue) {
      Add-Failure ($Where + '.' + $pair.name + ' 缺少 composited（该值是否为按 §3.2 合成后的结果）')
    } elseif ($compositedValue -isnot [bool]) {
      Add-Failure ($Where + '.' + $pair.name + '.composited 必须是布尔值')
    } elseif ($pair.expectCompositedTrue) {
      if (-not [bool]$compositedValue) {
        Add-Failure ($Where + '.' + $pair.name + '.composited 必须为 true：底色按 §3.2 是逐层合成到不透明底的结果')
      }
    } elseif ($null -ne $alphaNumber) {
      $expectedComposited = ($alphaNumber -lt 1.0)
      if ([bool]$compositedValue -ne $expectedComposited) {
        Add-Failure ($Where + '.' + $pair.name + '.composited=' + [string]$compositedValue + ' 与 alpha=' + $alphaNumber +
          ' 矛盾（半透明值必须先合成，不透明值不必标为已合成）')
      }
    }
  }

  # ---------------------------------------------------------------- 边框 / 轮廓通道
  # 边框类判据测的就是**边框颜色**。此前记录里没有边框通道，令牌无处对账，于是
  # 「declaredToken 解释不了实测值」被判失败（run 36574308748 的 VC-02-settings-topbar-border）。
  # 这里把每个边框通道按与 fg/bg **同一口径**校验：合成后必须不透明、且与自身 rgba8 ±1/通道 自洽。
  # 缺失即失败：通道不见了不能静默当成"没测这条"。
  #
  # 两条**结构性**要求（防假通过）：
  #  1. 每个通道必须带 `rendered`：**没画出来的边不是证据**。`border-top: none` 的元素其
  #     border-top-color 仍会算出 currentColor，若允许未画通道参与对账，"某个没画出来的边
  #     恰好等于某个令牌"就能让记录通过。
  #  2. 每个通道的 `declaredComputed`（元素自己的原始计算值）必须能**复算出**同一条通道的
  #     合成值：不透明值直接比，半透明值按 §3.2 合成到底色上再比。否则通道值就可能是自造的
  #     而与真测值无法区分（采集器曾在解析失败时拿合成底色充当通道值）。
  $borderChannels = @{}
  $borderRenderedFlags = @{}
  # 自报的 `rendered` 必须与本条记录自己的 computedStyle 交叉核对，因此这里要把快照取进来。
  $computedStyle = Get-JsonProperty $Record 'computedStyle'
  $border = Get-JsonProperty $measured 'border'
  if ($null -eq $border) {
    Add-Failure ($Where + '.measured 缺少 border（四边边框色的合成后通道）')
  } else {
    $borderRgba = Get-JsonProperty $border 'rgba8'
    $borderDeclaredBlock = Get-JsonProperty $border 'declaredComputed'
    $borderRenderedBlock = Get-JsonProperty $border 'rendered'
    if ($null -eq $borderRenderedBlock) {
      Add-Failure ($Where + '.measured.border 缺少 rendered（每边是否真的被绘制）')
    }
    if ($null -eq $borderRgba) {
      Add-Failure ($Where + '.measured.border 缺少 rgba8')
    } else {
      foreach ($side in @('bordertop', 'borderright', 'borderbottom', 'borderleft')) {
        $channelLabel = 'measured.border.rgba8.' + $side
        # rendered 必须先落地，未渲染的通道随后不进入令牌对账集合。
        if ($null -ne $borderRenderedBlock) {
          $bareSide = $side.Replace('border', '')
          $sideRendered = Get-JsonProperty $borderRenderedBlock $bareSide
          if ($sideRendered -isnot [bool]) {
            Add-Failure ($Where + '.measured.border.rendered.' + $bareSide + ' 必须是布尔值（该边是否真的被绘制）')
          } else {
            $borderRenderedFlags[$side] = [bool]$sideRendered
            # **交叉核对**：rendered 是记录的自报字段，不能自证。声明"这一边被画出来了"，
            # 同一条记录的 computedStyle 就必须给出该边 style≠none 且 width>0（反之亦然）。
            $styleKey = 'border' + $bareSide.Substring(0, 1).ToUpper() + $bareSide.Substring(1) + 'Style'
            $widthKey = 'border' + $bareSide.Substring(0, 1).ToUpper() + $bareSide.Substring(1) + 'Width'
            $sideStyle = [string](Get-JsonProperty $computedStyle $styleKey)
            $sideWidth = [string](Get-JsonProperty $computedStyle $widthKey)
            $paintedByStyle = (-not [string]::IsNullOrWhiteSpace($sideStyle)) -and ($sideStyle -ne 'none')
            $paintedByWidth = $false
            if (-not [string]::IsNullOrWhiteSpace($sideWidth) -and $sideWidth -match '^([0-9]*\.?[0-9]+)px$') {
              $paintedByWidth = ([double]$Matches[1] -gt 0)
            }
            if ([bool]$sideRendered) {
              if (-not $paintedByStyle -or -not $paintedByWidth) {
                Add-Failure ($Where + '.measured.border.rendered.' + $bareSide + ' 声明该边被绘制，但同一条记录的 computedStyle 给出 ' +
                  $styleKey + '=' + $sideStyle + ' / ' + $widthKey + '=' + $sideWidth + '——自报的 rendered 与真实计算样式矛盾（未画的边不是证据）')
              }
            } else {
              if ($paintedByStyle -and $paintedByWidth) {
                Add-Failure ($Where + '.measured.border.rendered.' + $bareSide + ' 声明该边未被绘制，但 computedStyle 给出 ' +
                  $styleKey + '=' + $sideStyle + ' / ' + $widthKey + '=' + $sideWidth + '——自报的 rendered 与真实计算样式矛盾')
              }
            }
          }
        }
        $channels = Get-JsonProperty $borderRgba $side
        if ($null -eq $channels) {
          Add-Failure ($Where + '.' + $channelLabel + ' 缺少 ' + $side)
          continue
        }
        $doubles = ConvertTo-DoubleArray $channels
        if ($doubles.Count -ne 3) {
          Add-Failure ($Where + '.' + $channelLabel + ' 必须是 3 个通道')
          continue
        }
        $borderChannels[$side] = $doubles
        # 键名必须各自对齐采集器：`declaredComputed` 与 `rgba8` 用**带前缀**的键
        # （bordertop/borderright/borderbottom/borderleft），`rendered` 用**不带前缀**的
        # top/right/bottom/left。两处混用会让这条断言永远失败（本机实测过一次）。
        $declaredSide = $null
        if ($null -ne $borderDeclaredBlock) { $declaredSide = [string](Get-JsonProperty $borderDeclaredBlock $side) }
        Assert-ChannelReproducible $declaredSide $doubles $bgChannels $channelLabel $Where
      }
    }
  }
  $outlineChannels = $null
  $outlineRenderedFlag = $false
  $outline = Get-JsonProperty $measured 'outline'
  if ($null -eq $outline) {
    Add-Failure ($Where + '.measured 缺少 outline（轮廓色的合成后通道）')
  } else {
    $outlineRgba = Get-JsonProperty $outline 'rgba8'
    if ($null -eq $outlineRgba) {
      Add-Failure ($Where + '.measured.outline 缺少 rgba8')
    } else {
      $outlineDoubles = ConvertTo-DoubleArray $outlineRgba
      if ($outlineDoubles.Count -ne 3) {
        Add-Failure ($Where + '.measured.outline.rgba8 必须是 3 个通道')
      } else {
        $outlineChannels = $outlineDoubles
        Assert-ChannelReproducible ([string](Get-JsonProperty $outline 'declaredComputed')) $outlineDoubles $bgChannels 'measured.outline.rgba8' $Where
      }
    }
    # 未渲染的轮廓必须显式声明，不能拿一个"测到的"颜色冒充画出来的聚焦圈；
    # 而且它必须真的参与判定（rendered=false 的轮廓不进令牌对账集合）。
    # 与边框同理：`rendered` **不能自证**，必须与同一条记录的 computedStyle.outlineStyle/outlineWidth 双向核对。
    $outlineRendered = Get-JsonProperty $outline 'rendered'
    if ($null -eq $outlineRendered) {
      Add-Failure ($Where + '.measured.outline 缺少 rendered（该轮廓是否真的被绘制）')
    } elseif ($outlineRendered -isnot [bool]) {
      Add-Failure ($Where + '.measured.outline.rendered 必须是布尔值（该轮廓是否真的被绘制）')
    } else {
      $outlineRenderedFlag = [bool]$outlineRendered
      $computedOutlineStyle = [string](Get-JsonProperty $computedStyle 'outlineStyle')
      $computedOutlineWidth = [string](Get-JsonProperty $computedStyle 'outlineWidth')
      $outlinePaintedByStyle = (-not [string]::IsNullOrWhiteSpace($computedOutlineStyle)) -and ($computedOutlineStyle -ne 'none')
      $outlinePaintedByWidth = $false
      if (-not [string]::IsNullOrWhiteSpace($computedOutlineWidth) -and $computedOutlineWidth -match '^([0-9]*\.?[0-9]+)px$') {
        $outlinePaintedByWidth = ([double]$Matches[1] -gt 0)
      }
      if ($outlineRenderedFlag) {
        if (-not $outlinePaintedByStyle -or -not $outlinePaintedByWidth) {
          Add-Failure ($Where + '.measured.outline.rendered 声明该轮廓被绘制，但同一条记录的 computedStyle 给出 outlineStyle=' + $computedOutlineStyle + ' / outlineWidth=' + $computedOutlineWidth + '——自报的 rendered 与真实计算样式矛盾（没画出来的轮廓不是证据）')
        }
      } else {
        if ($outlinePaintedByStyle -and $outlinePaintedByWidth) {
          Add-Failure ($Where + '.measured.outline.rendered 声明该轮廓未被绘制，但 computedStyle 给出 outlineStyle=' + $computedOutlineStyle + ' / outlineWidth=' + $computedOutlineWidth + '——自报的 rendered 与真实计算样式矛盾')
        }
      }
    }
    # S8 守卫：`widthPx` 在未渲染时**只是浏览器保留的初始值**，不得被当成实测宽度。
    #
    # 成因（本机 headless Edge 实测复现）：Chromium/WebView2 对**任何**没有轮廓的元素，
    # `getComputedStyle().outlineWidth` 都报初始值 `medium` → 逐字 `3px`，而同一元素的
    # `outlineStyle` 是 `none`；只有显式写 `outline-width: 0px` 才报 0。真实包
    # visual-c2c75601-20260930-013637 的 36 条 outline 记录全是 `none`/`3px`，唯一源规则又是
    # `:focus-visible { outline: 2px dashed var(--color-fg); outline-offset: 2px }`
    # （src/index.css），于是"实测 3px vs 规则 2px"看起来像矛盾——其实 3px 是保留值，不是画出来的宽度。
    #
    # 形状要求（与边框通道同一风格的双向核对，fail-closed）：
    #   ① `widthPxIsReservedInitial` 必填且为布尔；
    #   ② 未渲染（rendered=false）⇒ 该标志必须是 **true**，且 `widthPx` 必须是 **null**：
    #      浏览器在 `outline-style: none` 时把 outlineWidth 报成保留初始值 medium=3px，
    #      任何非 null 的 widthPx 都不是"画出来的宽度"（写 3 是保留值，写 0 会被读成"画了但很细"）；
    #   ③ 渲染中（rendered=true）⇒ 该标志必须是 **false**，且 `widthPx` 必须是**正数**并与同一条记录的
    #      `computedStyle.outlineWidth` 一致（±0.5px）——被画出来的轮廓有真实宽度，不得报保留值。
    # **反向断言（S8 自查时补的）**：只检查"渲染中必须是正数"是不够的——那样一条
    # `rendered=false / widthPxIsReservedInitial=false / widthPx=3`（`3px` 恰好与 computed 一致）
    # 的记录会被**放行**，即"把保留值当实测宽度"照样可以过门。所以 ② 与 ③ 必须都绑到 `rendered` 上。
    if (-not (Test-JsonProperty $outline 'widthPxIsReservedInitial')) {
      Add-Failure ($Where + '.measured.outline：缺少 widthPxIsReservedInitial（未渲染时 computed 报的是浏览器保留的初始值 medium=3px，' +
        '必须显式标注，否则 3px 会被读成实测宽度）')
    } else {
      $reservedInitial = Get-JsonProperty $outline 'widthPxIsReservedInitial'
      if ($reservedInitial -isnot [bool]) {
        Add-Failure ($Where + '.measured.outline.widthPxIsReservedInitial 必须是布尔值')
      } else {
        $reservedFlag = [bool]$reservedInitial
        $widthPx = Get-JsonProperty $outline 'widthPx'
        if (-not $outlineRenderedFlag) {
          if (-not $reservedFlag) {
            Add-Failure ($Where + '.measured.outline.widthPxIsReservedInitial=false，但同一条记录声明该轮廓**未被绘制**' +
              '（rendered=false）——没画出来的轮廓没有宽度可言；浏览器在 outline-style:none 时把 outlineWidth 报成保留初始值' +
              ' medium=3px，把那个数当实测宽度写进来就是记录级缺陷 d')
          }
          if ($null -ne $widthPx) {
            Add-Failure ($Where + '.measured.outline.widthPx 必须为 null（未渲染的轮廓没有宽度可言），实际 ' + ([string]$widthPx) +
              '；浏览器在 outline-style:none 时把 outlineWidth 报成保留初始值 medium=3px，把它写进 widthPx 就是记录级缺陷 d')
          }
        } else {
          if ($reservedFlag) {
            Add-Failure ($Where + '.measured.outline.widthPxIsReservedInitial 声明该宽度是保留的初始值，但同一条记录声明该轮廓**已被绘制**——' +
              '被画出来的轮廓有真实宽度，不得拿保留值当实测宽度')
          }
          $widthNumber = 0.0
          $isNumber = ($null -ne $widthPx) -and (-not ($widthPx -is [string])) -and (-not ($widthPx -is [bool])) -and
            [double]::TryParse([string]$widthPx, [ref]$widthNumber)
          if (-not $isNumber) {
            Add-Failure ($Where + '.measured.outline.widthPx 在轮廓被绘制时必须是数字（渲染中的轮廓有真实宽度），实际 ' + ([string]$widthPx))
          } elseif ($widthNumber -le 0) {
            Add-Failure ($Where + '.measured.outline.widthPx 在轮廓被绘制时必须是正数，实际 ' + $widthNumber)
          } elseif ($null -ne $computedOutlineWidth -and $computedOutlineWidth -match '^([0-9]*\.?[0-9]+)px$' -and
            ([Math]::Abs($widthNumber - [double]$Matches[1]) -gt $script:FrozenTolerance.fixedHeightPx)) {
            Add-Failure ($Where + '.measured.outline.widthPx=' + $widthNumber + ' 与同一条记录的 computedStyle.outlineWidth=' +
              $computedOutlineWidth + ' 相差超过 ±' + $script:FrozenTolerance.fixedHeightPx + 'px')
          } elseif ($outlinePaintedByStyle -and (-not $outlinePaintedByWidth)) {
            # `outline-style` 非 none、但计算宽度 ≤0：浏览器自己按不可见处理。
            # 独立复审（Standards 轴）实测出这条洞：`outlineStyle=dashed + outlineWidth=0.1px + widthPx=0.1`
            # 曾被放行——记录自称"画了 0.1px 的轮廓"，而这个宽度按浏览器口径根本不是可见轮廓。
            # 与 `rendered=false` 一侧同一原则：**宽度不足以被看见的轮廓，不得声称已绘制并交出宽度。**
            Add-Failure ($Where + '.measured.outline.rendered 声明该轮廓被绘制，但同一条记录的 computedStyle 给出 outlineWidth=' +
              $computedOutlineWidth + '——浏览器按 ≤0 的宽度判定它不可见，记录不得把它当已绘制')
          }
        }
      }
    }
  }

  # ---------------------------------------------------------------- fg 的出处（与 declaredToken 无关，独立执行）
  # §3.4 第 3 项的「对比度比值」是由 measured.fg/bg 算出来的。fg 必须**要么**就是元素的文字色
  # （computedStyle.color，role=text/background/nonColour 走这条），**要么**是某个**被画出来**的
  # 边框/轮廓通道的颜色（role=border/graphic 走这条）。否则这条记录报出的对比度与它要判的颜色无关，
  # 审查员照抄就会得到相反结论——真实反例：只有 border-bottom 的元素，fg 曾取未画的 top 边
  # （= currentColor），报 14.64:1，而被画的那条边只有 3.49:1；边框掉到 1.21:1 时数字仍不变。
  # 这条**不依赖 declaredToken 是否存在**：没有令牌的记录同样会报出对比度，同样必须成立。
  $paintedGraphicChannels = @()
  foreach ($side in @('bordertop', 'borderright', 'borderbottom', 'borderleft')) {
    if ($borderChannels.ContainsKey($side) -and $borderRenderedFlags[$side] -eq $true) {
      $paintedGraphicChannels += @{ label = ('measured.border.rgba8.' + $side); values = $borderChannels[$side] }
    }
  }
  if ($null -ne $outlineChannels -and $outlineRenderedFlag -eq $true) {
    $paintedGraphicChannels += @{ label = 'measured.outline.rgba8'; values = $outlineChannels }
  }
  $fgExplainedBy = $null
  $computedTextColour = [string](Get-JsonProperty $computedStyle 'color')
  if (-not [string]::IsNullOrWhiteSpace($computedTextColour)) {
    try {
      $parsedTextColour = ConvertTo-Rgb8 $computedTextColour
      $textRgb = [double[]]$parsedTextColour.rgb
      if ([double]$parsedTextColour.alpha -lt 1.0 -and $null -ne $bgChannels -and $bgChannels.Count -eq 3) {
        $alpha = [double]$parsedTextColour.alpha
        $textRgb = [double[]]@(
          [Math]::Round($alpha * [double]$parsedTextColour.rgb[0] + (1 - $alpha) * [double]$bgChannels[0]),
          [Math]::Round($alpha * [double]$parsedTextColour.rgb[1] + (1 - $alpha) * [double]$bgChannels[1]),
          [Math]::Round($alpha * [double]$parsedTextColour.rgb[2] + (1 - $alpha) * [double]$bgChannels[2])
        )
      }
      $isTextColour = $true
      for ($channelIndex = 0; $channelIndex -lt 3; $channelIndex++) {
        if ([Math]::Abs([double]$textRgb[$channelIndex] - [double]$fgChannels[$channelIndex]) -gt $script:FrozenTolerance.colorChannel) { $isTextColour = $false; break }
      }
      if ($isTextColour) { $fgExplainedBy = 'computedStyle.color' }
    } catch {
      Add-Failure ($Where + '.computedStyle.color 无法解析（' + $_.Exception.Message + '）——fg 的出处无法核对')
    }
  }
  if ($null -eq $fgExplainedBy) {
    foreach ($candidate in $paintedGraphicChannels) {
      $isSame = $true
      for ($channelIndex = 0; $channelIndex -lt 3; $channelIndex++) {
        if ([Math]::Abs([double]$candidate.values[$channelIndex] - [double]$fgChannels[$channelIndex]) -gt $script:FrozenTolerance.colorChannel) { $isSame = $false; break }
      }
      if ($isSame) { $fgExplainedBy = $candidate.label; break }
    }
  }
  if ($null -eq $fgExplainedBy) {
    Add-Failure ($Where + '：measured.fg.rgba8=[' + (($fgChannels | ForEach-Object { [int]$_ }) -join ',') +
      '] 既不是 computedStyle.color（' + $computedTextColour + '），也不是任何**被绘制**的边框/轮廓通道的颜色——这条记录报出的对比度与它要判的颜色无关。')
  }
  # 角色一致性（同样不依赖 declaredToken）：
  #  - role=border：若存在**被画出来的边**，fg 必须落在这些边里（这正是设置页顶栏那条记录的形状：
  #    只有 border-bottom 被画，fg 必须取它，而不是未画边的 currentColor）；
  #  - role=graphic：若存在**被画出来的轮廓**，fg 必须就是那个轮廓色。
  # 刻意**不**合并成"fg ∈ 任意被绘制通道"：那样对 graphic 记录会强制 fg 取边框色，而聚焦圈判据
  # 测的是轮廓、其元素同时又带 1px 边框 —— 真实运行里那条记录会因此被误判失败。
  $roleForFg = [string](Get-JsonProperty $measured 'role')
  if ($roleForFg -eq 'border') {
    $paintedSides = @()
    foreach ($side in @('bordertop', 'borderright', 'borderbottom', 'borderleft')) {
      if ($borderChannels.ContainsKey($side) -and $borderRenderedFlags[$side] -eq $true) {
        $paintedSides += @{ label = ('measured.border.rgba8.' + $side); values = $borderChannels[$side] }
      }
    }
    if ($paintedSides.Count -gt 0) {
      $fgOnPaintedSide = $false
      foreach ($candidate in $paintedSides) {
        $isSame = $true
        for ($channelIndex = 0; $channelIndex -lt 3; $channelIndex++) {
          if ([Math]::Abs([double]$candidate.values[$channelIndex] - [double]$fgChannels[$channelIndex]) -gt $script:FrozenTolerance.colorChannel) { $isSame = $false; break }
        }
        if ($isSame) { $fgOnPaintedSide = $true; break }
      }
      if (-not $fgOnPaintedSide) {
        Add-Failure ($Where + '：role=border 的记录存在被绘制的边框，但 measured.fg.rgba8=[' +
          (($fgChannels | ForEach-Object { [int]$_ }) -join ',') + '] 不是任何被绘制边的颜色——这条记录报出的对比度与它要判的边框色无关。')
      }
    }
  }
  if ($roleForFg -eq 'graphic' -and $null -ne $outlineChannels -and $outlineRenderedFlag -eq $true) {
    $fgIsOutline = $true
    for ($channelIndex = 0; $channelIndex -lt 3; $channelIndex++) {
      if ([Math]::Abs([double]$outlineChannels[$channelIndex] - [double]$fgChannels[$channelIndex]) -gt $script:FrozenTolerance.colorChannel) { $fgIsOutline = $false; break }
    }
    if (-not $fgIsOutline) {
      Add-Failure ($Where + '：role=graphic 的记录声明轮廓被绘制，但 measured.fg.rgba8=[' +
        (($fgChannels | ForEach-Object { [int]$_ }) -join ',') + '] 与该轮廓的合成色不一致——这条记录报出的对比度与它要判的图形色无关。')
    }
  }

  # ---------------------------------------------------------------- 颜色角色
  # 每条记录必须声明它测的是哪个颜色角色，且该角色必须能被识别。
  # 这把"这个令牌该出现在哪个通道"变成**可校验的结构事实**，而不是靠人读描述。
  # 五个角色里 `nonColour` 是给**不判颜色**的判据用的（顶栏高度、圆角、间距、阴影）：它们没有
  # 颜色角色可声明，标成 text 是把结构事实写假；但"不判颜色"同样必须显式登记，不许留空。
  $role = [string](Get-JsonProperty $measured 'role')
  $knownRoles = @('text', 'background', 'border', 'graphic', 'nonColour')
  if ([string]::IsNullOrWhiteSpace($role)) {
    Add-Failure ($Where + '.measured 缺少 role（本条判据测的颜色角色：text/background/border/graphic/nonColour）')
  } elseif ($knownRoles -notcontains $role) {
    Add-Failure ($Where + '.measured.role 不是已知角色：' + $role + '（已知：' + ($knownRoles -join '/') + '）。新种类的测量必须登记成新角色，不得静默丢弃。')
  }

  # 令牌来源（可选）：采集器可以声明"这条实测值对应合同冻结的某个令牌/取值"。
  # 那就必须由本校验器自己复算 —— 不许只信自述（§2.4 铁律 3）。
  # 注意 `name` 只是**追溯标签**（人读的令牌名），不参与判定：判定用的是 `value`，而且只在
  # 本条记录声明的颜色角色的通道里对账。名字对不对由审查员看，不由本校验器猜映射表。
  $declaredToken = Get-JsonProperty $Record 'declaredToken'
  if ($null -ne $declaredToken) {
    $tokenName = Assert-NonEmptyString $declaredToken 'name' ($Where + '.declaredToken')
    $tokenValue = Assert-NonEmptyString $declaredToken 'value' ($Where + '.declaredToken')
    Assert-NonEmptyString $declaredToken 'source' ($Where + '.declaredToken') | Out-Null
    if ($null -ne $tokenName -and $null -ne $tokenValue) {
      try {
        $declaredTokenRgb = Get-Rgb8FromToken $tokenValue
        # nonColour 的角色通道集合**是空的**（它本来就不判颜色）。若放行，就等于给
        # "声明了令牌却没有任何通道可对账"开一条静默通道——那正是 fail-closed 要堵的洞。
        if ($role -eq 'nonColour') {
          Add-Failure ($Where + '：role=nonColour（本条判据不判颜色）的记录不得声明 declaredToken ' + $tokenName + '=' + $tokenValue +
            '——该角色没有可对账的颜色通道，令牌来源无法被复核。要么改判据的颜色角色，要么去掉令牌声明。')
        } else {
        # 令牌必须落在**本条判据声明的颜色角色**对应的通道里，而且该通道必须**真的被绘制**
        # （`rendered=true`）。这条把"这个令牌该出现在哪个通道"从"靠人读描述"变成可校验的结构事实；
        # 未画的边/轮廓不算证据：`border-top: none` 的元素其 border-top-color 仍会算出 currentColor，
        # 若允许未画通道参与对账，"某个没画出来的边恰好等于某个令牌"就能让记录通过。
        $roleChannels = @()
        switch ($role) {
          'text' { $roleChannels = @(@{ label = 'measured.fg.rgba8'; values = $fgChannels }) }
          'background' { $roleChannels = @(@{ label = 'measured.bg.rgba8'; values = $bgChannels }) }
          'border' {
            foreach ($side in @('bordertop', 'borderright', 'borderbottom', 'borderleft')) {
              if ($borderChannels.ContainsKey($side) -and $borderRenderedFlags[$side] -eq $true) {
                $roleChannels += @{ label = ('measured.border.rgba8.' + $side); values = $borderChannels[$side] }
              }
            }
            if ($null -ne $outlineChannels -and $outlineRenderedFlag -eq $true) {
              $roleChannels += @{ label = 'measured.outline.rgba8'; values = $outlineChannels }
            }
          }
          'graphic' {
            # graphic = 被画出来的**图形**色（轮廓或边框）。文字色（measured.fg）属于 `text` 角色，
            # 不在这里：否则"给一个图形判据声明文字色令牌"也能通过，等于把角色集合串味。
            if ($null -ne $outlineChannels -and $outlineRenderedFlag -eq $true) {
              $roleChannels += @{ label = 'measured.outline.rgba8'; values = $outlineChannels }
            }
            foreach ($side in @('bordertop', 'borderright', 'borderbottom', 'borderleft')) {
              if ($borderChannels.ContainsKey($side) -and $borderRenderedFlags[$side] -eq $true) {
                $roleChannels += @{ label = ('measured.border.rgba8.' + $side); values = $borderChannels[$side] }
              }
            }
          }
          default { $roleChannels = @() }
        }
        if ($roleChannels.Count -eq 0 -and $knownRoles -contains $role) {
          # 角色合法、但该角色下**没有任何被绘制的通道**：不能悄悄放行（那正是假通过）。
          Add-Failure ($Where + '：declaredToken ' + $tokenName + '=' + $tokenValue + ' 声明的颜色角色是 role=' + $role +
            '，但本条记录里该角色下**没有任何被绘制的通道**（rendered=true）可以对账——未画的边/轮廓不是证据。')
        }
        if (($role -eq 'border' -or $role -eq 'graphic') -and $roleChannels.Count -gt 0 -and $null -ne $fgChannels -and $fgChannels.Count -eq 3) {
          # 见下方「角色与 fg 的匹配」——那条在 declaredToken 分支**之外**独立执行；
          # 这里不重复报，避免同一条记录产生两条内容相同的失败。
        }
        if ($roleChannels.Count -gt 0) {
          $matchedLabel = $null
          foreach ($candidate in $roleChannels) {
            $isMatch = $true
            for ($channelIndex = 0; $channelIndex -lt 3; $channelIndex++) {
              if ([Math]::Abs([double]$declaredTokenRgb[$channelIndex] - [double]$candidate.values[$channelIndex]) -gt $script:FrozenTolerance.colorChannel) {
                $isMatch = $false
                break
              }
            }
            if ($isMatch) { $matchedLabel = [string]$candidate.label; break }
          }
          if ($null -eq $matchedLabel) {
            Add-Failure ($Where + '：declaredToken ' + $tokenName + '=' + $tokenValue +
              ' 与本条判据声明的颜色角色（role=' + $role + '）下的任何实测合成通道都不在 ±' + $script:FrozenTolerance.colorChannel + '/通道 内——声明的令牌来源无法解释这条实测值。已查通道：' +
              (($roleChannels | ForEach-Object { $_.label + '=' + (($_.values | ForEach-Object { [int]$_ }) -join ',') }) -join ' | '))
          }
        }
        # 角色未知或该角色的通道缺失时上面已经报过失败；这里不重复报，也**不能**悄悄放行。
        }
      } catch {
        Add-Failure ($Where + '：declaredToken.value 无法复算（' + $_.Exception.Message + '）')
      }
    }
  }

  # 对比度必须能由本校验器自己从合成色重算出来（±0.05）。
  $recomputed = Get-ContrastRatio ([double[]]$fgChannels) ([double[]]$bgChannels)
  $luminanceFg = Get-RelativeLuminance ([double[]]$fgChannels)
  $luminanceBg = Get-RelativeLuminance ([double[]]$bgChannels)
  if ($null -ne $declaredRatio -and [Math]::Abs($recomputed - $declaredRatio) -gt $Tolerance) {
    Add-Failure ($Where + '：声明的对比度 ' + $declaredRatio + ' 与本校验器从合成色重算的 ' + $recomputed.ToString('0.######') +
      ' 相差超过 ±' + $Tolerance)
  }
  foreach ($pair in @(
    @{ name = 'luminanceFg'; declared = (Get-JsonProperty $Ratio 'luminanceFg'); recomputed = $luminanceFg },
    @{ name = 'luminanceBg'; declared = (Get-JsonProperty $Ratio 'luminanceBg'); recomputed = $luminanceBg }
  )) {
    if ($null -eq $pair.declared) {
      Add-Failure ($Where + '.measured.contrastRatio 缺少 ' + $pair.name)
      continue
    }
    if ([Math]::Abs([double]$pair.declared - [double]$pair.recomputed) -gt 1e-6) {
      Add-Failure ($Where + '：' + $pair.name + ' 声明 ' + $pair.declared + ' 与重算 ' + ([double]$pair.recomputed).ToString('0.######') + ' 不一致')
    }
  }

  # 阈值必须与实测字号/字重匹配（§3.2：普通文本 4.5:1 / 大号文本 3:1）。
  $computedStyle = Get-JsonProperty $Record 'computedStyle'
  $fontSizeText = ''
  $fontWeightText = ''
  if ($null -ne $computedStyle) {
    $fontSizeText = [string](Get-JsonProperty $computedStyle 'fontSize')
    $fontWeightText = [string](Get-JsonProperty $computedStyle 'fontWeight')
  }
  $isNonText = ($null -ne $thresholdBasis -and $thresholdBasis -match 'nonText|non-text|UI')
  $fontSizeMatch = [regex]::Match($fontSizeText, '^([0-9]*\.?[0-9]+)px$')
  if ((-not $isNonText) -and $fontSizeMatch.Success) {
    $fontSize = [double]$fontSizeMatch.Groups[1].Value
    $fontWeight = 400.0
    $weightMatch = [regex]::Match($fontWeightText, '^([0-9]+)$')
    if ($weightMatch.Success) { $fontWeight = [double]$weightMatch.Groups[1].Value }
    $isLargeText = ($fontSize -ge 24.0) -or (($fontSize -ge 18.66) -and ($fontWeight -ge 700))
    $expectedThreshold = 4.5
    if ($isLargeText) { $expectedThreshold = 3.0 }
    if ($null -ne $threshold -and [Math]::Abs($threshold - $expectedThreshold) -gt 1e-9) {
      Add-Failure ($Where + '：' + $fontSizeText + '/' + $fontWeightText + ' 的文本阈值必须是 ' + $expectedThreshold +
        ':1，记录写的是 ' + $threshold + ':1')
    }
  }
}

function Assert-SharedRecordFields($Record, $ScreenshotNames, [string]$EvidenceDir, [string]$Where) {
  # 三种 measurementScope 共有的部分：截图绑定（§3.4 第 2 项）与采样视口（第 3 项）。
  $shots = Get-JsonProperty $Record 'screenshots'
  if ($null -eq $shots -or @($shots).Count -eq 0) {
    Add-Failure ($Where + '：没有任何截图绑定。只有截图时判不了任何一条，但反过来——没有截图的实测记录同样不构成 Visual Evidence（§2.4 铁律 2）')
  } else {
    foreach ($shot in @($shots)) {
      $shotName = [string]$shot
      if ([string]::IsNullOrWhiteSpace($shotName)) {
        Add-Failure ($Where + '：screenshots 里存在空条目')
        continue
      }
      if ($ScreenshotNames -notcontains $shotName) {
        Add-Failure ($Where + "：引用的截图 '" + $shotName + "' 不在本包的截图清单里")
      }
      $shotPath = Resolve-EvidencePackageFilePath $EvidenceDir $shotName 'screenshot' ($Where + '.screenshots')
      if ($null -ne $shotPath) { Assert-PngFile $shotPath ($Where + '.screenshots') | Out-Null }
    }
  }
  $viewport = Get-JsonProperty $Record 'sampledViewport'
  if ($null -eq $viewport) {
    Add-Failure ($Where + '：缺少 sampledViewport（§3.4 第 3 项的「采样视口」）')
  } else {
    Assert-PositiveNumber $viewport 'width' ($Where + '.sampledViewport') | Out-Null
    Assert-PositiveNumber $viewport 'height' ($Where + '.sampledViewport') | Out-Null
    Assert-PositiveNumber $viewport 'devicePixelRatio' ($Where + '.sampledViewport') | Out-Null
    Assert-NonEmptyString $viewport 'sampledAt' ($Where + '.sampledViewport') | Out-Null
  }
}

function Assert-AccentSweepRecord($Record, $ScreenshotNames, [string]$EvidenceDir, [string]$Where) {
  # VC-03① 是**全称否定**（任何控件底色/边框/下划线都不得由 #4a9eff 渲染），单元素颜色测不出它。
  # 这类记录的形状保守裁判：必须给出扫描范围、扫到的元素数、被扫描的渲染属性集合与（可为空的）匹配清单。
  $sweep = Get-JsonProperty $Record 'accentSweep'
  if ($null -eq $sweep) {
    Add-Failure ($Where + '：measurementScope=accentSweep 的记录缺少 accentSweep 块')
    return
  }
  $token = Assert-NonEmptyString $sweep 'accentToken' ($Where + '.accentSweep')
  Assert-NonEmptyString $sweep 'selectorScope' ($Where + '.accentSweep') | Out-Null
  Assert-NonEmptyString $Record 'selector' $Where | Out-Null
  if ($null -ne $token -and $token -ne '#4a9eff') {
    Add-Failure ($Where + '：accentSweep.accentToken 必须是被 VC-03① 点名的品牌强调色 #4a9eff，实际 ' + $token)
  }
  $scanned = Assert-Number $sweep 'scannedElementCount' ($Where + '.accentSweep')
  if ($null -ne $scanned -and $scanned -lt 1) {
    Add-Failure ($Where + '：accentSweep.scannedElementCount 必须至少为 1（没扫任何元素的"扫描"不构成扫描）')
  }
  $properties = Get-JsonProperty $sweep 'scannedProperties'
  if ($null -eq $properties -or @($properties).Count -eq 0) {
    Add-Failure ($Where + '.accentSweep：缺少 scannedProperties（必须写明扫了哪些被渲染的颜色属性）')
  } else {
    foreach ($required in @('backgroundColor', 'borderTopColor', 'outlineColor', 'color')) {
      if (@($properties) -notcontains $required) {
        Add-Failure ($Where + '.accentSweep.scannedProperties 缺少 ' + $required)
      }
    }
  }
  if (-not (Test-JsonProperty $sweep 'matches')) {
    Add-Failure ($Where + '.accentSweep：缺少 matches（允许空数组，但不允许缺字段——空数组 = 未发现强调色）')
  }
  Assert-SharedRecordFields $Record $ScreenshotNames $EvidenceDir $Where
}

function Assert-RootTokenRecord($Record, $ScreenshotNames, [string]$EvidenceDir, [string]$Where) {
  # 「令牌解析值」记录：只声明令牌值是什么（§2.5：token 存在 ≠ 被使用），故不要求 rect/对比度，
  # 但必须真的给出解析值，且不得把"令牌存在"伪装成"页面用了它"（页面实例值由 element 记录给出）。
  $tokens = Get-JsonProperty $Record 'resolvedTokens'
  if ($null -eq $tokens) {
    Add-Failure ($Where + '：measurementScope=rootTokens 的记录缺少 resolvedTokens')
  } else {
    $names = @($tokens.PSObject.Properties | ForEach-Object { $_.Name })
    if ($names.Count -eq 0) {
      Add-Failure ($Where + '.resolvedTokens 为空——空值不得静默通过')
    }
    foreach ($name in $names) {
      if ([string]::IsNullOrWhiteSpace([string](Get-JsonProperty $tokens $name))) {
        Add-Failure ($Where + '.resolvedTokens.' + $name + ' 是空值（该令牌未解析出任何值）')
      }
    }
  }
  Assert-SharedRecordFields $Record $ScreenshotNames $EvidenceDir $Where
}

function Assert-ElementRecordSpacing($Record, [string]$Where) {
  # S8 守卫（§3.4 第 3 项）：`derived.spacing.gaps` 里**不得出现负的 gapPx**。
  #
  # 为什么这是一条硬门：gap 的语义是「同一包含块、同一坐标系里两个相邻兄弟之间的可见间距」。
  # 两个矩形只有在同一坐标系里相减才可能得到间距；一旦跨包含块相减（或对越出正常流的兄弟相减），
  # 差值会变成负的**坐标差**，而它既不是间距、也不是"间距违规"，却是最容易被下游当成实测值
  # 采信的那种数。真实包 visual-c2c75601-20260930-013637 的 **15 条**记录就是这样：-1028 / -669 /
  # -508 / -36 / -28 / -27 / -24 / -10（8 个不同值），全部来自不同定位上下文的兄弟 rect 相减
  # （例：`catalog-bar > div:nth-of-type(1) -> div:nth-of-type(2)` 量出 -508，而两者同排/垂直紧贴、
  #  真实垂直间距是 **0**；`video-list-page > header > span -> input` 量出 -28，而两者同排、横向间距是 0）。
  # 负值在正确口径下**结构上不可能出现**，所以一旦出现就说明口径又坏了 —— fail-closed。
  #
  # 只判"非负 + 是数"；**不判**off-ladder：不在阶梯上的**正**值（例如 6px、10px）是真实发现，
  # 该由审查员读 `offLadderValues` 去判，不能在这里被当成形状错误吞掉。
  # 字段缺失与空数组是两件事：缺失 = 这条记录没有交出间距抽样（失败）；空数组 = 抽样了但
  # 没有一对"分离"的兄弟（合法，`gaps` 可为空）。
  #
  # **口径字段必填（S8 自证时补，由 Spec 轴独立复审指出）**：只要求 `gaps` 非负还不够——
  # 采集器退化成"一条都不记"（`gaps: []`）就能消音。因此 `containerGap` / `skippedOutOfFlowPairs` /
  # `skippedUnpairedPairs` 三者对 element 记录**必填**：它们正是"谁被跳过、为什么跳过"的凭据，
  # 缺了它们，"没有负 gap"这句就无从复核。
  $derived = Get-JsonProperty $Record 'derived'
  if ($null -eq $derived) {
    Add-Failure ($Where + '：缺少 derived（§3.4 第 3 项的间距抽样藏在这里）')
    return
  }
  $spacing = Get-JsonProperty $derived 'spacing'
  if ($null -eq $spacing) {
    Add-Failure ($Where + '.derived：缺少 spacing（element 记录必须交出间距阶梯抽样；缺字段不等于"没有间距"）')
    return
  }
  if (-not (Test-JsonProperty $spacing 'gaps')) {
    Add-Failure ($Where + '.derived.spacing：缺少 gaps（允许空数组，但不允许缺字段——缺字段会被当成"没测"）')
    return
  }
  # 口径字段必填：没有它们，"没有负 gap"无法复核（见函数头说明）。
  if (-not (Test-JsonProperty $spacing 'containerGap')) {
    Add-Failure ($Where + '.derived.spacing：缺少 containerGap（容器自身的 gap 计算样式——间距口径的直接证据）')
  }
  foreach ($counter in @('skippedOutOfFlowPairs', 'skippedUnpairedPairs')) {
    if (-not (Test-JsonProperty $spacing $counter)) {
      Add-Failure ($Where + '.derived.spacing：缺少 ' + $counter + '（被跳过的相邻对的计数——没有它，"没有负 gap"无从复核）')
    } else {
      $counterValue = Get-JsonProperty $spacing $counter
      if ($counterValue -is [string] -or $counterValue -is [bool] -or $null -eq $counterValue) {
        Add-Failure ($Where + '.derived.spacing.' + $counter + ' 必须是非负整数，实际 ' + ([string]$counterValue))
      }
    }
  }
  $gaps = @(Get-JsonProperty $spacing 'gaps')
  foreach ($gap in $gaps) {
    if ($null -eq $gap) {
      Add-Failure ($Where + '.derived.spacing.gaps：存在空条目')
      continue
    }
    $gapValue = Get-JsonProperty $gap 'gapPx'
    if ($null -eq $gapValue -or $gapValue -is [string] -or $gapValue -is [bool]) {
      Add-Failure ($Where + '.derived.spacing.gaps：gapPx 必须是数字，实际 ' + ([string]$gapValue))
      continue
    }
    $numericGap = 0.0
    if (-not [double]::TryParse([string]$gapValue, [ref]$numericGap)) {
      Add-Failure ($Where + '.derived.spacing.gaps：gapPx 必须是数字，实际 ' + ([string]$gapValue))
      continue
    }
    if ($numericGap -lt 0) {
      Add-Failure ($Where + '.derived.spacing.gaps：出现**负** gapPx=' + $numericGap + '（' + ([string](Get-JsonProperty $gap 'between')) +
        '）。间距是两个相邻兄弟在**同一包含块、同一坐标系**里的可见间隙，不可能为负；负值说明这条记录是把不同定位' +
        '上下文的 rect 相减得来的（旧口径的缺陷），不得作为实测值采信。')
    }
  }
}

function Assert-Record($Record, $ScreenshotNames, [string]$EvidenceDir, [string]$Where) {
  Assert-NonEmptyString $Record 'recordId' $Where | Out-Null
  $vc = Assert-NonEmptyString $Record 'vc' $Where
  if ($null -ne $vc) {
    if ($script:ReservedIds -contains $vc) {
      Add-Failure ($Where + "：'" + $vc + "' 是保留空号（决策 80 仍为 Proposed），不得作为判据记录")
    } elseif ($script:ContractIds -notcontains $vc) {
      Add-Failure ($Where + "：'" + $vc + "' 不是本合同的可裁判编号")
    }
  }
  Assert-NonEmptyString $Record 'criterion' $Where | Out-Null
  Assert-NonEmptyString $Record 'page' $Where | Out-Null
  Assert-NonEmptyString $Record 'selector' $Where | Out-Null
  Assert-NonEmptyString $Record 'description' $Where | Out-Null

  # measurementScope 决定这条记录按哪种形状裁判（§3.4 第 3 项对"逐元素测量"的要求，
  # 对"跨元素扫描"与"令牌解析值"这两类无法照搬）。
  $scope = [string](Get-JsonProperty $Record 'measurementScope')
  if ($scope -eq 'accentSweep') {
    Assert-AccentSweepRecord $Record $ScreenshotNames $EvidenceDir $Where
    return
  }
  if ($scope -eq 'rootTokens') {
    Assert-RootTokenRecord $Record $ScreenshotNames $EvidenceDir $Where
    return
  }
  if ($scope -ne 'element') {
    Add-Failure ($Where + "：measurementScope 必须是 'element' / 'accentSweep' / 'rootTokens' 之一，实际 '" + $scope + "'")
    return
  }

  Assert-SharedRecordFields $Record $ScreenshotNames $EvidenceDir $Where
  Assert-ElementRecordSpacing $Record $Where

  # §3.4 第 3 项：几何（getBoundingClientRect 的逻辑像素）。
  $rect = Get-JsonProperty $Record 'rect'
  if ($null -eq $rect) {
    Add-Failure ($Where + '：缺少 rect（§3.4 第 3 项的「几何」）；本校验器不会把缺失几何当 0 处理')
  } elseif ($rect -is [string]) {
    Add-Failure ($Where + '：rect 必须是对象，实际是字符串')
  } else {
    foreach ($key in $script:RequiredRectKeys) {
      Assert-Number $rect $key ($Where + '.rect') | Out-Null
    }
  }

  # §3.4 第 3 项：计算样式。
  $computedStyle = Get-JsonProperty $Record 'computedStyle'
  if ($null -eq $computedStyle) {
    Add-Failure ($Where + '：缺少 computedStyle（§3.4 第 3 项的「计算样式」）')
  } elseif ($computedStyle -is [string]) {
    Add-Failure ($Where + '：computedStyle 必须是对象，实际是字符串')
  } else {
    foreach ($key in $script:RequiredComputedStyleKeys) {
      $styleValue = Get-JsonProperty $computedStyle $key
      if ($null -eq $styleValue -or ([string]$styleValue).Length -eq 0) {
        Add-Failure ($Where + ".computedStyle：缺少必填字段 '" + $key + "'（空值同样不接受——不得静默出空值）")
      }
    }
  }

  # §3.4 第 3 项：采样视口由 Assert-SharedRecordFields 统一校验。

  $measured = Get-JsonProperty $Record 'measured'
  if ($null -eq $measured) {
    Add-Failure ($Where + '：缺少 measured（实际合成颜色 + 对比度比值）')
    return
  }
  # S8 守卫（由 Spec 轴独立复审指出）：`measured.outline` 对 element 记录**必填**。
  # 否则删掉整块 outline 通道即可绕过 `Assert-RecordContrast` 里的两道轮廓门
  # （`computedStyle.outlineStyle/Width` 虽然必填，却不与任何 measured 通道对账）——那是 fail-open。
  # 采集器对每条 element 记录都会写出该块（outline 通道与 spacing 抽样同一批产出），故不会误伤真实记录。
  # 注意这句必须放在 `$measured` 已取到之后：`Test-JsonProperty` 对 `$null` 一律返回 false，
  # 放前面会对**每条**记录都误报"缺少 outline 通道"（本机实测：真实包被误报 34 条）。
  if (-not (Test-JsonProperty $measured 'outline')) {
    Add-Failure ($Where + '.measured：缺少 outline 通道（element 记录必填——缺了它，轮廓的两道门都无从执行）')
  }
  $ratio = Get-JsonProperty $measured 'contrastRatio'
  if ($null -eq $ratio) {
    Add-Failure ($Where + '.measured：缺少 contrastRatio（§3.4 第 3 项）')
  } else {
    Assert-RecordContrast $Record $ratio $Where
  }
}

function Assert-EvidencePackage([string]$EvidenceDir) {
  $script:CheckedPackages += 1
  $manifestPath = Join-Path $EvidenceDir 'manifest.json'
  $where = "证据包 '" + $EvidenceDir + "'"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    Add-Failure ($where + ' 缺少 manifest.json')
    return
  }

  $manifest = $null
  try {
    $manifest = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($manifestPath, [System.Text.UTF8Encoding]::new($false)))
  } catch {
    Add-Failure ($where + ' 的 manifest.json 不是合法 JSON：' + $_.Exception.Message)
    return
  }

  # 包的**溯源**必须显式声明：同一个形状既能由真实采集产出，也能由"把旧数据改写成新形状"的演练
  # 产出。后者在记录级可能被逐条标注，但包级没有任何字段能把它与真采集区分开——
  # 「同一个包名 + 同一个 generatedBy + 校验器判 VALID」极易被后来的读者当成证据。
  # 因此 provenance 是必填字段，取值必须已登记；非 real-collector 的包在结尾**不会**拿到
  # `VISUAL_EVIDENCE_VALID` 的措辞。
  $provenance = Assert-NonEmptyString $manifest 'provenance' ($where + '.manifest')
  if ($null -ne $provenance) {
    $knownProvenance = @('real-collector', 'rehearsal')
    if ($knownProvenance -notcontains $provenance) {
      Add-Failure ($where + "：manifest.provenance 取值未登记：'" + $provenance + "'（已知：" + ($knownProvenance -join '/') + "）。新来源必须登记，不得静默。")
    } elseif ($provenance -ne 'real-collector') {
      $script:RehearsalPackages += 1
    }
  }

  # §3.4 第 1 项：目标提交 SHA。
  $target = Assert-RequiredProperty $manifest 'target' ($where + '.manifest')
  if ($null -eq $target) { return }
  $commitSha = Assert-NonEmptyString $target 'commitSha' ($where + '.manifest.target')
  if ($null -ne $commitSha -and $commitSha -notmatch '^[0-9a-f]{40}$') {
    Add-Failure ($where + '：target.commitSha 必须是完整 40 位小写 hex（§3.4 要求证据包与目标提交 SHA 绑定），实际 ' + $commitSha)
  }
  $shortSha = Assert-NonEmptyString $target 'shortSha' ($where + '.manifest.target')
  if ($null -ne $shortSha -and $null -ne $commitSha -and $commitSha.Substring(0, 8) -ne $shortSha) {
    Add-Failure ($where + "：target.shortSha '" + $shortSha + "' 与 commitSha 前 8 位不符")
  }
  Assert-NonEmptyString $target 'repo' ($where + '.manifest.target') | Out-Null

  # 目录名必须与 target 一致：evidence/visual-<目标sha8>-<yyyyMMdd-HHmmss>/。
  $directoryName = Split-Path -Leaf $EvidenceDir
  if ($null -ne $shortSha -and $directoryName -notlike ('visual-' + $shortSha + '-*')) {
    Add-Failure ($where + "：目录名 '" + $directoryName + "' 与 target.shortSha '" + $shortSha + "' 不一致（约定 visual-<sha8>-<yyyyMMdd-HHmmss>）")
  }
  if ($directoryName -notmatch '^visual-[0-9a-f]{8}-[0-9]{8}-[0-9]{6}$') {
    Add-Failure ($where + "：目录名 '" + $directoryName + "' 不符合约定 visual-<目标sha8>-<yyyyMMdd-HHmmss>")
  }

  # §3.4 第 1 项：视口尺寸（含 devicePixelRatio）。
  $viewport = Assert-RequiredProperty $manifest 'viewport' ($where + '.manifest')
  if ($null -eq $viewport) { return }
  Assert-PositiveNumber $viewport 'width' ($where + '.manifest.viewport') | Out-Null
  Assert-PositiveNumber $viewport 'height' ($where + '.manifest.viewport') | Out-Null
  Assert-PositiveNumber $viewport 'devicePixelRatio' ($where + '.manifest.viewport') | Out-Null
  Assert-NonEmptyString $viewport 'windowState' ($where + '.manifest.viewport') | Out-Null

  # §3.4 第 1 项：宿主与版本。
  $hostBlock = Assert-RequiredProperty $manifest 'host' ($where + '.manifest')
  if ($null -eq $hostBlock) { return }
  $os = Get-JsonProperty $hostBlock 'os'
  if ($null -eq $os) {
    Add-Failure ($where + '.manifest.host 缺少 os')
  } else {
    Assert-NonEmptyString $os 'caption' ($where + '.manifest.host.os') | Out-Null
    Assert-NonEmptyString $os 'version' ($where + '.manifest.host.os') | Out-Null
  }
  $webview = Get-JsonProperty $hostBlock 'webview2'
  if ($null -eq $webview) {
    Add-Failure ($where + '.manifest.host 缺少 webview2（§2.2 要求真实 WebView2 宿主与版本）')
  } else {
    $runtimeVersion = Assert-NonEmptyString $webview 'runtimeVersion' ($where + '.manifest.host.webview2')
    $driverVersion = Assert-NonEmptyString $webview 'driverVersion' ($where + '.manifest.host.webview2')
    if ($null -ne $runtimeVersion -and $null -ne $driverVersion -and $runtimeVersion -ne $driverVersion) {
      Add-Failure ($where + "：WebView2 runtime '" + $runtimeVersion + "' 与 msedgedriver '" + $driverVersion + "' 不一致（宿主版本无法解释本次实测）")
    }
    # 版本**来源**必须显式声明。tauri-driver 拉起的应用可能不开调试端口，此时版本取自预检的
    # 同主机同二进制读数 —— 这是**降级**，必须标注来源，不许静默当成等价替代。
    # 缺失即失败：读不到来源就无法判断这条版本绑定的强度。
    $runtimeVersionSource = Assert-NonEmptyString $webview 'runtimeVersionSource' ($where + '.manifest.host.webview2')
    if ($null -ne $runtimeVersionSource) {
      $knownSources = @('devtools', 'preflight-devtools')
      $sources = @($runtimeVersionSource -split ',' | ForEach-Object { $_.Trim() })
      foreach ($entry in $sources) {
        if ($knownSources -notcontains $entry) {
          Add-Failure ($where + "：runtimeVersionSource 含未知来源 '" + $entry + "'（已知：" + ($knownSources -join '/') + "）。新来源必须登记，不得静默。")
        }
      }
      # 降级的前提必须随包走。'preflight-devtools' 表示版本不是从**被实测的那个会话**读到的，
      # 而是取自同主机同二进制的预检读数 —— 只有"机器级 Evergreen 安装存在、且应用旁边没有
      # 随包固定版本的运行时"这条前提成立时，两者才指同一个运行时。前提不写进包，包就无法
      # 自证这条宿主版本绑定的强度（读日志猜正是本轮要堵的洞），因此这里 fail-closed。
      if ($sources -contains 'preflight-devtools') {
        $premise = Get-JsonProperty $webview 'premise'
        if ($null -eq $premise) {
          Add-Failure ($where + '：runtimeVersionSource 含 preflight-devtools（有前提的降级），但 manifest.host.webview2 没有记录该降级的前提 premise —— 前提没被记录，这条宿主版本绑定就只能当成弱绑定，不许静默当成等价替代。')
        } else {
          Assert-NonEmptyString $premise 'statement' ($where + '.manifest.host.webview2.premise') | Out-Null
          $established = Get-JsonProperty $premise 'established'
          if ($established -isnot [bool]) {
            Add-Failure ($where + '.manifest.host.webview2.premise.established 必须是布尔值（该降级的前提是否成立），实际：' + ($(if ($null -eq $established) { '(missing)' } else { [string]$established })))
          } elseif (-not [bool]$established) {
            Add-Failure ($where + '：降级前提被记录为**不成立**（established=false）—— 此时预检读数与被测会话的运行时无法证明是同一个，该宿主版本绑定不能作为本包的有效输入。')
          }
        }
      }
    }
  }
  $app = Get-JsonProperty $hostBlock 'app'
  if ($null -eq $app) {
    Add-Failure ($where + '.manifest.host 缺少 app（宿主应用与版本）')
  } else {
    Assert-NonEmptyString $app 'productName' ($where + '.manifest.host.app') | Out-Null
    Assert-NonEmptyString $app 'productVersion' ($where + '.manifest.host.app') | Out-Null
  }

  # §3.3：容差必须显式写出，且与冻结值逐项相等。
  # 注意：此处局部变量**不能**命名为 $tolerance —— PowerShell 变量名大小写不敏感，它会遮蔽
  # 脚本参数 $Tolerance（§3.3 的 ±0.05），使所有子函数读到的是这个对象而不是数值（本轮实测）。
  $toleranceBlock = Get-JsonProperty $manifest 'tolerance'
  if ($null -eq $toleranceBlock) {
    Add-Failure ($where + '：缺少 tolerance（§3.3 的允许误差必须写进记录，不许留给读者猜）')
  } else {
    foreach ($key in $script:FrozenTolerance.Keys) {
      $declared = Get-JsonProperty $toleranceBlock $key
      if ($null -eq $declared) {
        Add-Failure ($where + ".manifest.tolerance：缺少 '" + $key + "'（§3.3 的容差必须显式写出）")
        continue
      }
      $expectedTolerance = $script:FrozenTolerance[$key]
      if ($expectedTolerance -is [bool]) {
        if ([bool]$declared -ne $expectedTolerance) {
          Add-Failure ($where + '.manifest.tolerance.' + $key + ' 必须是 ' + $expectedTolerance)
        }
      } elseif ([Math]::Abs([double]$declared - [double]$expectedTolerance) -gt 1e-9) {
        Add-Failure ($where + '.manifest.tolerance.' + $key + ' 是 ' + $declared + '，§3.3 的冻结值是 ' + $expectedTolerance)
      }
    }
  }

  # 截图清单：§3.4 第 2 项。
  $screenshots = Get-JsonProperty $manifest 'screenshots'
  $screenshotNames = @()
  $screenshotBytes = 0
  if ($null -eq $screenshots -or @($screenshots).Count -eq 0) {
    Add-Failure ($where + '：screenshots 清单为空（§3.4 第 2 项要求真实渲染截图）')
  } else {
    foreach ($entry in @($screenshots)) {
      $name = [string]$entry
      if ([string]::IsNullOrWhiteSpace($name)) {
        Add-Failure ($where + '：screenshots 里存在空条目')
        continue
      }
      if ($screenshotNames -contains $name) {
        Add-Failure ($where + "：screenshots 重复列出 '" + $name + "'")
        continue
      }
      $screenshotPath = Resolve-EvidencePackageFilePath $EvidenceDir $name 'screenshot' ($where + '.screenshots')
      if ($null -eq $screenshotPath) { continue }
      $file = Assert-PngFile $screenshotPath ($where + '.screenshots')
      if ($null -ne $file) {
        $screenshotNames += $name
        $screenshotBytes += [int]$file.bytes
        # ≤2MB/张；超出时必须压缩或按页拆分，不许静默缩小或跳过。
        if ([int]$file.bytes -gt 2MB) {
          Add-Failure ($where + "：截图 '" + $name + "' 是 " + [int]$file.bytes + ' 字节，超过 2MB 上限；请压缩到 ≤2MB 或按页拆分')
        }
      }
    }
  }
  Write-Output ('visual evidence package ' + $directoryName + ': screenshots=' + $screenshotNames.Count + ' bytes=' + $screenshotBytes)

  # 第 4 项（pass/needs_revision）不得由采集方签发。
  $verdicts = Get-JsonProperty $manifest 'verdicts'
  if ($null -eq $verdicts) {
    Add-Failure ($where + '.manifest 缺少 verdicts（必须显式写明本包未签发结论）')
  } else {
    $issued = Get-JsonProperty $verdicts 'issued'
    if ($null -eq $issued) {
      Add-Failure ($where + '.manifest.verdicts：缺少 issued（必须显式写明本包未签发结论）')
    } elseif ([bool]$issued) {
      Add-Failure ($where + '.manifest.verdicts：采集通道不得签发 pass/needs_revision（§2.1 要求裁判独立于实现者）；issued 必须为 false')
    }
  }

  # 逐条实测记录。
  $recordsRefs = Get-JsonProperty $manifest 'records'
  $records = @()
  if ($null -eq $recordsRefs -or @($recordsRefs).Count -eq 0) {
    Add-Failure ($where + '：records 为空——只有截图时本合同的任何一条都判不了（§3.4 末句）：没有实测记录的证据包不构成裁判')
  } else {
    $seenRecordIds = @()
    foreach ($reference in @($recordsRefs)) {
      $recordFile = [string](Get-JsonProperty $reference 'file')
      $recordId = [string](Get-JsonProperty $reference 'recordId')
      if ([string]::IsNullOrWhiteSpace($recordFile)) {
        Add-Failure ($where + '：records 条目缺少 file')
        continue
      }
      $recordPath = Resolve-EvidencePackageFilePath $EvidenceDir $recordFile 'record' ($where + '.records')
      if ($null -eq $recordPath) { continue }
      if (-not (Test-Path -LiteralPath $recordPath -PathType Leaf)) {
        Add-Failure ($where + '：实测记录文件不存在：' + $recordFile)
        continue
      }
      $recordWhere = $where + " 记录 '" + $recordFile + "'"
      $record = $null
      try {
        $record = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText($recordPath, [System.Text.UTF8Encoding]::new($false)))
      } catch {
        Add-Failure ($recordWhere + ' 不是合法 JSON：' + $_.Exception.Message)
        continue
      }
      if ([string]::IsNullOrWhiteSpace($recordId) -or $recordId -ne [string](Get-JsonProperty $record 'recordId')) {
        Add-Failure ($recordWhere + "：manifest 里的 recordId '" + $recordId + "' 与记录本体不符")
      }
      if ($seenRecordIds -contains $recordId) {
        Add-Failure ($where + "：recordId '" + $recordId + "' 重复")
      }
      $seenRecordIds += $recordId
      Assert-Record $record $screenshotNames $EvidenceDir $recordWhere
      $records += $record
    }
  }

  Assert-ManifestCoverage $manifest $records $where

  # manifest 里声称做过的扫描，必须在记录里有对应实体——不许只有声明、没有证据。
  # （t2 对抗性复核用一个"声明 3 条 sweep、记录 0 条"的包证明了当时的校验器会放行。）
  $declaredSweeps = Get-JsonProperty $manifest 'accentSweeps'
  $sweepRecordIds = @($records | Where-Object { [string](Get-JsonProperty $_ 'measurementScope') -eq 'accentSweep' } | ForEach-Object { [string](Get-JsonProperty $_ 'recordId') })
  if ($null -ne $declaredSweeps) {
    $declaredIds = @($declaredSweeps | ForEach-Object { [string](Get-JsonProperty $_ 'id') })
    foreach ($declaredId in $declaredIds) {
      if ([string]::IsNullOrWhiteSpace($declaredId)) {
        Add-Failure ($where + '.accentSweeps：存在没有 id 的声明条目')
        continue
      }
      if ($sweepRecordIds -notcontains $declaredId) {
        Add-Failure ($where + ".accentSweeps 声明了 '" + $declaredId + "'，但证据包里没有同 id 的 accentSweep 记录——声明了却没做，等于凭空多出一条「扫过了」")
      }
    }
    foreach ($recordId in $sweepRecordIds) {
      if ($declaredIds -notcontains $recordId) {
        Add-Failure ($where + "：存在 accentSweep 记录 '" + $recordId + "'，但 manifest.accentSweeps 没有声明它")
      }
    }
  } elseif ($sweepRecordIds.Count -gt 0) {
    Add-Failure ($where + '：有 accentSweep 记录但 manifest 缺少 accentSweeps 声明块')
  }

  Write-Output ('visual evidence package ' + $directoryName + ': target=' + $shortSha + ' records=' + $records.Count)
}

#endregion

#region 入口

if (-not [string]::IsNullOrWhiteSpace($VerifyMathFile)) {
  Invoke-MathVerification $VerifyMathFile
  Write-Output 'VISUAL_EVIDENCE_MATH_VALID'
  exit 0
}

$targets = @()
if (-not [string]::IsNullOrWhiteSpace($EvidenceRoot)) {
  if (-not (Test-Path -LiteralPath $EvidenceRoot -PathType Container)) {
    throw ('证据包目录不存在：' + $EvidenceRoot)
  }
  $targets += (Get-Item -LiteralPath $EvidenceRoot).FullName
} else {
  $searchRoot = Join-Path $RepoRoot 'evidence'
  if (Test-Path -LiteralPath $searchRoot -PathType Container) {
    $targets += @(
      Get-ChildItem -LiteralPath $searchRoot -Directory -Filter 'visual-*' |
        Sort-Object -Property Name |
        ForEach-Object { $_.FullName }
    )
  }
  if ($targets.Count -eq 0) {
    Write-Output ('no committed visual evidence package under ' + $searchRoot + ' (expected before the first hosted collection run)')
    exit 0
  }
}

foreach ($target in $targets) { Assert-EvidencePackage $target }

Throw-IfFailed

if ($script:RehearsalPackages -gt 0) {
  # 演练/合成包：形状一样、结论完全不同。措辞必须把它与真采集区分开，否则"校验器判 VALID"
  # 这句话会被转述成"这份包是真的"。
  Write-Output ('VISUAL_EVIDENCE_VALID_REHEARSAL: ' + $script:CheckedPackages + ' 个包形状通过 §3.4 第 1–3 项与容差/覆盖清单校验，' +
    '但其中 ' + $script:RehearsalPackages + ' 个声明 provenance≠real-collector（演练/合成）——它们**不是真实采集证据**，不得当证据引用。')
} else {
  Write-Output ('VISUAL_EVIDENCE_VALID: ' + $script:CheckedPackages + ' 个证据包通过 §3.4 第 1–3 项与容差/覆盖清单校验')
}
Write-Output 'note: 本校验器不签发任何 Visual Evidence，也不判任何 VC-xx 的 pass/needs_revision（§3.4 第 4 项由独立视觉审查员产出）。'
exit 0

#endregion
