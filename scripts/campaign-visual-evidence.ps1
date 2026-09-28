<#
.SYNOPSIS
  V1a「真实桌面视觉实测通道」采集器：在**一次运行**内产出 visual-contract.md §3.4 要求的
  第 1–3 项（目标提交 SHA + 视口/宿主、真实桌面截图、逐条实测记录）。

.DESCRIPTION
  复用仓库既有托管真实桌面 E2E 的技术路线（tauri-driver + msedgedriver + 真实 Tauri debug 二进制 +
  隔离 SQLite），但**只新增文件**、不改动既有 E2E 脚本与 workflow。

  采集内容（§3.4）：
    1. 目标提交 SHA、视口尺寸（含 devicePixelRatio）、宿主 OS 与 WebView2/应用版本；
    2. 真实桌面窗口截图（每页一张，PNG，≤2MB/张）；
    3. 每条判据一条实测记录：VC-xx + 选择器 + getBoundingClientRect() 几何（CSS 逻辑像素）+
       getComputedStyle() 计算样式 + 实际合成颜色（rgba 按祖先链逐层合成到不透明底色）+
       WCAG 2.1 对比度比值 (L1+0.05)/(L2+0.05) + 采样视口；
    并显式写出所用容差（§3.3）与「本次已测 / 本次未测」两张清单。

  **本脚本不签发任何 Visual Evidence、不判任何 VC-xx 的 pass/needs_revision、不改任何 AC 状态或
  Evidence tier**——第 4 项（逐条结论与差值）只能由独立视觉审查员产出（§2.1/§2.3）。

.PARAMETER TargetSha
  目标提交 SHA（缺省取 $env:GITHUB_SHA，再退回本地 `git rev-parse HEAD`）。必须是 40 位小写 hex。

.PARAMETER EvidenceRoot
  证据包根目录（缺省 = 仓库根；证据包写成 <EvidenceRoot>/evidence/visual-<sha8>-<yyyyMMdd-HHmmss>/）。

.PARAMETER DriverPort / NativeDriverPort
  tauri-driver 端口（与既有 E2E 脚本的端口错开，便于并行/避免残留占用）。

.PARAMETER MaxSeconds
  单次有界等待上限（秒）。

.PARAMETER SkipBuild
  跳过 `npm run build` 与 `tauri build --debug --no-bundle`（二进制必须已存在）。
#>
param(
  [string]$TargetSha,
  [string]$EvidenceRoot,
  [int]$DriverPort = 4460,
  [int]$NativeDriverPort = 4461,
  [int]$MaxSeconds = 90,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Get-Item -LiteralPath (Split-Path -Parent $PSScriptRoot)).FullName
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$runRoot = Join-Path $temporaryRoot ("rain-visual-evidence-run-" + [Guid]::NewGuid().ToString('N'))
$runRoot = (New-Item -ItemType Directory -Path $runRoot).FullName
$driverLog = Join-Path $runRoot 'tauri-driver.log'
$driverErrorLog = Join-Path $runRoot 'tauri-driver.err.log'
$webDriverRequestSeconds = [Math]::Max(30, $MaxSeconds)
$elementKey = 'element-6066-11e4-a52e-4f735466cecf'
$probeInterface = 'window.__RAIN_VISUAL_PROBE__'

if ([string]::IsNullOrWhiteSpace($EvidenceRoot)) { $EvidenceRoot = $repoRoot }

# §3.3 的允许误差（与 scripts/validate-visual-evidence.ps1 的冻结值逐项相同）。
$tolerance = [ordered]@{
  colorChannel = 1
  contrastRatio = 0.05
  fixedHeightPx = 0.5
  renderedGeometryPx = 2
  exactValues = $true
}
$toleranceBasis = 'visual-contract.md §3.3: colour ±1/channel, contrast ratio ±0.05, token-derived geometry ±0.5px, rendered geometry ±2px, sizes/weights/radii exact'

# 18 个可裁判编号（VC-18 是保留空号，不进裁判表）。
$contractIds = @(
  'VC-01', 'VC-02', 'VC-03', 'VC-04', 'VC-05', 'VC-06', 'VC-07', 'VC-08', 'VC-09',
  'VC-10', 'VC-11', 'VC-12', 'VC-13', 'VC-14', 'VC-15', 'VC-16', 'VC-17', 'VC-19'
)

# 本次只覆盖能静态测到的判据（交互态、多视口与动效留给 V1b）。
$testedIds = @('VC-01', 'VC-02', 'VC-03', 'VC-04', 'VC-12', 'VC-15')
$untestedIds = @($contractIds | Where-Object { $testedIds -notcontains $_ })

# 冻结令牌值（visual-contract.md §5.5，计算验算值；本脚本只比对，不发明新值）。
$frozen = @{
  dark = [ordered]@{ bg = '#1a1a1a'; surface = '#242424'; surfaceHover = '#2e2e2e'; fg = '#e5e5e5'; muted = '#9a9a9a'; border = '#8f8f8f' }
  light = [ordered]@{ bg = '#0d1117'; panel = '#161b22'; panel2 = '#1c232c'; fg = '#e6edf3'; muted = '#8b949e'; dimmer = '#868f99'; border = '#6e7074'; border2 = '#7c828c' }
  typeDark = [ordered]@{ concept = '#5b9bf8'; example = '#3ecf8e'; analogy = '#f0a13c'; transition = '#9e9e9e' }
  typeLight = [ordered]@{ concept = '#539bf5'; example = '#3fb950'; analogy = '#db6d28'; transition = '#868f99' }
  fontSizes = @(18, 16, 14, 13, 12)
  fontWeights = @(400, 600, 700)
}

# ---------------------------------------------------------------- 探针脚本
# 一次性注入页面，按 spec 列表采集；答案以 JSON 字符串返回（不用 execute/async，避免宿主差异）。
$probeScript = @'
const config = window.__RAIN_VISUAL_PROBE_CONFIG__ || { specs: [] };
const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function parseToken(token) {
  const text = String(token == null ? '' : token).trim();
  if (text === '' || text === 'transparent') return { rgb: [0, 0, 0], alpha: 0 };
  if (text[0] === '#') {
    let body = text.slice(1);
    if (body.length === 3) body = body.split('').map((c) => c + c).join('');
    const channel = (offset) => parseInt(body.slice(offset, offset + 2), 16);
    if (body.length === 6) return { rgb: [channel(0), channel(2), channel(4)], alpha: 1 };
    if (body.length === 8) return { rgb: [channel(0), channel(2), channel(4)], alpha: channel(6) / 255 };
    return null;
  }
  const fn = text.match(/^rgba?\(([^)]*)\)$/i);
  if (fn) {
    const parts = fn[1].split(',').map((p) => p.trim()).filter((p) => p !== '');
    if (parts.length !== 3 && parts.length !== 4) return null;
    const rgb = parts.slice(0, 3).map((part) => {
      if (/%$/.test(part)) return Math.round(parseFloat(part) * 2.55);
      return Math.round(parseFloat(part));
    });
    if (rgb.some((value) => !Number.isFinite(value))) return null;
    let alpha = 1;
    if (parts.length === 4) alpha = /%$/.test(parts[3]) ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    if (!Number.isFinite(alpha)) return null;
    return { rgb, alpha };
  }
  return null;
}

function composite(foreground, backdrop) {
  const out = [];
  for (let index = 0; index < 3; index += 1) {
    out.push(Math.round(foreground.alpha * foreground.rgb[index] + (1 - foreground.alpha) * backdrop.rgb[index]));
  }
  return out;
}

function channelLuminance(value) {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
}

function relativeLuminance(rgb) {
  return 0.2126 * channelLuminance(rgb[0]) + 0.7152 * channelLuminance(rgb[1]) + 0.0722 * channelLuminance(rgb[2]);
}

function contrastRatio(first, second) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function selectorPath(element) {
  if (!element || !element.tagName) return null;
  const parts = [];
  let node = element;
  while (node && node.nodeType === 1 && parts.length < 6) {
    let part = node.tagName.toLowerCase();
    const testId = node.getAttribute('data-testid');
    if (testId) {
      parts.unshift(part + '[data-testid="' + testId + '"]');
      return parts.join(' > ');
    }
    const catalogRow = node.getAttribute('data-catalog-scroll-row');
    if (catalogRow) part += '[data-catalog-scroll-row="' + catalogRow + '"]';
    const parent = node.parentElement;
    if (parent) {
      const sameTag = Array.prototype.filter.call(parent.children, (child) => child.tagName === node.tagName);
      if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}

function ancestorChain(element) {
  const chain = [];
  let node = element;
  while (node && node.nodeType === 1) {
    chain.unshift(node);
    node = node.parentElement;
  }
  return chain;
}

function readFocusRing(element) {
  // VC-03④ 的聚焦圈：先看 :focus-visible 当前是否匹配（决定用程序化 focus 还是敲键盘 Tab），
  // 再无条件读取 computed outline/border 与是否真的聚焦。即使没匹配上也保留实测值，
  // 交给独立审查员判断——采集方不因"没聚焦上"而伪造空白。
  let matchedFocusVisible = false;
  try { matchedFocusVisible = element.matches(':focus-visible'); } catch (error) { matchedFocusVisible = false; }
  const before = getComputedStyle(element);
  const ringBefore = { outlineWidth: before.outlineWidth, outlineStyle: before.outlineStyle, outlineColor: before.outlineColor };
  element.focus();
  const during = getComputedStyle(element);
  const ringDuring = {
    outlineWidth: during.outlineWidth,
    outlineStyle: during.outlineStyle,
    outlineColor: during.outlineColor,
    outlineOffset: during.outlineOffset,
    borderTopWidth: during.borderTopWidth,
    borderTopStyle: during.borderTopStyle,
    borderTopColor: during.borderTopColor,
  };
  const active = element.ownerDocument ? element.ownerDocument.activeElement : null;
  return {
    matchedFocusVisibleBeforeFocus: matchedFocusVisible,
    focused: Boolean(active && active === element),
    ringBeforeFocus: ringBefore,
    ringDuringFocus: ringDuring,
    method: matchedFocusVisible
      ? 'programmatic element.focus() while :focus-visible already matched'
      : 'programmatic element.focus(); :focus-visible did not match before focus',
  };
}

function readTokens() {
  // VC-02 / VC-04 / VC-15 的**令牌解析值**：从 :root 读 CSS 自定义属性。
  // 页面上的实例合成色由其它 spec 实测（令牌声明存在 ≠ 被使用，§2.5）。
  const rootStyle = getComputedStyle(document.documentElement);
  const tokens = {};
  const names = [
    '--color-bg', '--color-surface', '--color-surface-hover', '--color-fg', '--color-muted', '--color-border',
    '--color-concept', '--color-example', '--color-analogy', '--color-transition',
    '--spacing-1', '--spacing-2', '--spacing-3', '--spacing-4', '--spacing-5', '--spacing-6', '--spacing-7', '--spacing-8',
    '--radius-0', '--radius-1', '--radius-2', '--radius-3', '--radius-pill',
    '--font-size-lg', '--font-size-md', '--font-size-sm', '--font-size-xs', '--font-size-2xs',
    '--height-topbar', '--height-controlbar',
    '--line-height-body', '--line-height-heading', '--line-height-secondary',
  ];
  for (const name of names) tokens[name] = rootStyle.getPropertyValue(name).trim();
  return tokens;
}

function sweepForAccent(selectorScope, accentToken) {
  // VC-03① 是**全称否定**（任何控件底色/边框/下划线都不得由品牌强调色渲染）。
  // 单元素颜色测不出全称否定，因此这里在同一页面内遍历 scope 的全部后代元素，
  // 逐个读 computed 的 background/border/outline/color，按 §3.3 的 ±1/通道比对固定令牌 #4a9eff。
  const target = parseToken(accentToken);
  if (!target) throw new Error('accent sweep token unparseable: ' + accentToken);
  const scope = document.querySelector(selectorScope);
  if (!scope) return null;
  const all = [scope].concat(Array.prototype.slice.call(scope.querySelectorAll('*')));
  const properties = ['backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'color'];
  const matches = [];
  for (const element of all) {
    const style = getComputedStyle(element);
    for (const property of properties) {
      // outline-color 在 outline-style: none 时仍可能报出颜色；只有真的被渲染才算。
      if (property === 'outlineColor' && style.outlineStyle === 'none') continue;
      if (property.indexOf('border') === 0 && style[property.replace('Color', 'Style')] === 'none') continue;
      const parsed = parseToken(style[property]);
      if (!parsed || parsed.alpha === 0) continue;
      let composited = parsed.rgb;
      if (parsed.alpha < 1) {
        const own = parseToken(style.backgroundColor);
        const backdrop = own && own.alpha === 1 ? own.rgb : [26, 26, 26];
        composited = composite(parsed, { rgb: backdrop, alpha: 1 });
      }
      const delta = Math.max(
        Math.abs(composited[0] - target.rgb[0]),
        Math.abs(composited[1] - target.rgb[1]),
        Math.abs(composited[2] - target.rgb[2])
      );
      if (delta <= 1) {
        matches.push({ selector: selectorPath(element), property: property, declared: style[property], composited: composited });
        if (matches.length >= 20) break;
      }
    }
    if (matches.length >= 20) break;
  }
  return {
    accentToken: accentToken,
    tolerancePerChannel: 1,
    selectorScope: selectorScope,
    scannedElementCount: all.length,
    scannedProperties: properties,
    skippedNotRendered: ['outline-color when outline-style: none', 'border-*-color when border-*-style: none'],
    matches: matches,
  };
}

function readSpacingLadder(element) {
  // VC-15①「间距只取 4/8/12/16/20/24/32/48」的实测维度：元素自身 padding/margin 与可见子元素间隙。
  // 注意（据实登记）：这是**元素级抽样**，仅覆盖被选中的元素；全页面清点属 V1b。
  const LADDER = [4, 8, 12, 16, 20, 24, 32, 48];
  const style = getComputedStyle(element);
  const numeric = (value) => {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  };
  const slots = {
    paddingTop: numeric(style.paddingTop),
    paddingRight: numeric(style.paddingRight),
    paddingBottom: numeric(style.paddingBottom),
    paddingLeft: numeric(style.paddingLeft),
    marginTop: numeric(style.marginTop),
    marginRight: numeric(style.marginRight),
    marginBottom: numeric(style.marginBottom),
    marginLeft: numeric(style.marginLeft),
  };
  const gaps = [];
  const children = Array.prototype.slice.call(element.children);
  for (let index = 1; index < children.length && gaps.length < 12; index += 1) {
    const previous = children[index - 1].getBoundingClientRect();
    const current = children[index].getBoundingClientRect();
    const vertical = Math.round(current.top - previous.bottom);
    const horizontal = Math.round(current.left - previous.right);
    const between = selectorPath(children[index - 1]) + ' -> ' + selectorPath(children[index]);
    if (vertical !== 0) gaps.push({ between: between, axis: 'vertical', gapPx: vertical });
    else if (horizontal !== 0) gaps.push({ between: between, axis: 'horizontal', gapPx: horizontal });
  }
  const offLadderValues = [];
  for (const key of Object.keys(slots)) {
    const value = slots[key];
    if (value === null || value === 0) continue;
    if (LADDER.indexOf(value) === -1) offLadderValues.push(key + '=' + value + 'px');
  }
  for (const gap of gaps) {
    if (LADDER.indexOf(gap.gapPx) === -1) offLadderValues.push('gap(' + gap.axis + ')=' + gap.gapPx + 'px');
  }
  return { ladder: LADDER, slots: slots, gaps: gaps, offLadderValues: offLadderValues };
}

function measure(spec) {
  const element = document.querySelector(spec.selector);
  if (!element) {
    return { probeId: spec.id, vc: spec.vc, criterion: spec.criterion, page: spec.page, selector: spec.selector, missing: true, note: spec.description || '' };
  }
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const chain = ancestorChain(element);
  const layers = [];
  for (let index = 0; index < chain.length; index += 1) {
    const layerStyle = getComputedStyle(chain[index]);
    const parsed = parseToken(layerStyle.backgroundColor);
    if (parsed && parsed.alpha > 0) {
      layers.push({ selector: selectorPath(chain[index]), declared: layerStyle.backgroundColor, alpha: parsed.alpha });
    }
  }
  let resolved = { rgb: [255, 255, 255], alpha: 1 };
  for (const layer of layers) {
    resolved = { rgb: composite(parseToken(layer.declared), resolved), alpha: 1 };
  }
  const foregroundToken = spec.nonText ? style.borderTopColor : style.color;
  const foreground = parseToken(foregroundToken);
  const foregroundRgb = foreground ? (foreground.alpha < 1 ? composite(foreground, resolved) : foreground.rgb.slice()) : null;
  const ratio = foregroundRgb ? contrastRatio(foregroundRgb, resolved.rgb) : null;
  const fontSize = parseFloat(style.fontSize);
  const fontWeight = parseInt(style.fontWeight, 10) || 400;
  const lineHeightPx = parseFloat(style.lineHeight);
  const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
  return {
    probeId: spec.id,
    vc: spec.vc,
    criterion: spec.criterion,
    page: spec.page,
    selector: spec.selector,
    description: spec.description || '',
    missing: false,
    rect: {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
    },
    computedStyle: {
      color: style.color,
      backgroundColor: style.backgroundColor,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontVariantNumeric: style.fontVariantNumeric,
      lineHeight: style.lineHeight,
      borderTopWidth: style.borderTopWidth,
      borderTopStyle: style.borderTopStyle,
      borderTopColor: style.borderTopColor,
      borderRadius: style.borderTopLeftRadius,
      paddingTop: style.paddingTop,
      paddingRight: style.paddingRight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      marginTop: style.marginTop,
      marginRight: style.marginRight,
      marginBottom: style.marginBottom,
      marginLeft: style.marginLeft,
      boxShadow: style.boxShadow,
    },
    derived: {
      fontSizePx: fontSize,
      fontWeightNumber: fontWeight,
      lineHeightPx: Number.isFinite(lineHeightPx) ? lineHeightPx : null,
      lineHeightRatio: Number.isFinite(lineHeightPx) && fontSize > 0 ? Number((lineHeightPx / fontSize).toFixed(4)) : null,
      aspectRatio: rect.height > 0 ? Number((rect.width / rect.height).toFixed(4)) : null,
      borderRadiusPx: parseFloat(style.borderTopLeftRadius),
      // focusRing 只在 spec 显式声明 focus=true 时读取：否则每个被测元素都被 focus 会改变焦点状态，
      // 还可能让浏览器把它滚进视野，从而污染**后续**元素的 getBoundingClientRect（既有 E2E 踩过同类坑）。
      focusRing: spec.focus ? readFocusRing(element) : null,
      tokens: readTokens(),
      spacing: readSpacingLadder(element),
    },
    measured: {
      fg: {
        source: spec.nonText ? 'getComputedStyle(border-top-color)' : 'getComputedStyle(color)',
        declared: foregroundToken,
        rgba8: foregroundRgb,
        alpha: foreground ? foreground.alpha : null,
        composited: Boolean(foreground && foreground.alpha < 1),
      },
      bg: {
        source: 'composite(ancestor backgrounds over #ffffff; transparent layers skipped)',
        declared: style.backgroundColor,
        rgba8: resolved.rgb,
        alpha: 1,
        composited: true,
        layers: layers,
      },
      contrastRatio: {
        value: ratio === null ? null : Number(ratio.toFixed(6)),
        formula: 'WCAG21:(L1+0.05)/(L2+0.05)',
        luminanceFg: foregroundRgb ? Number(relativeLuminance(foregroundRgb).toFixed(6)) : null,
        luminanceBg: Number(relativeLuminance(resolved.rgb).toFixed(6)),
        threshold: spec.nonText ? 3 : (isLargeText ? 3 : 4.5),
        thresholdBasis: spec.nonText ? 'nonText' : (isLargeText ? 'largeText' : 'text'),
        tolerance: config.tolerance.contrastRatio,
        toleranceBasis: config.toleranceBasis,
      },
    },
  };
}

(async () => {
  try {
    await document.fonts.ready;
  } catch (error) {
    // 字体就绪不可用时继续；记录里如实保留当时的计算样式。
  }
  await settle();
  const results = [];
  for (const spec of config.specs) results.push(measure(spec));
  // VC-03① 的跨元素扫描（全称否定）与其它逐元素记录同在一次运行内产出。
  const accentSweeps = (config.accentSweeps || []).map((entry) => {
    const sweep = sweepForAccent(entry.selectorScope, entry.accentToken);
    return {
      probeId: entry.id,
      vc: entry.vc,
      criterion: entry.criterion,
      page: entry.page,
      description: entry.description || '',
      missing: sweep === null,
      accentSweep: sweep,
    };
  });
  window.__RAIN_VISUAL_PROBE__ = {
    status: 'done',
    capturedAt: new Date().toISOString(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      screenWidth: window.screen ? window.screen.width : null,
      screenHeight: window.screen ? window.screen.height : null,
    },
    results: results,
    // 必须真的回传：漏掉这一行会让跨元素扫描记录静默变成 0 条，而 manifest 仍然宣称扫过
    // （本轮 t2 对抗性复核抓到的 blocker，正是这个形状）。
    accentSweeps: accentSweeps,
    accentSweepCount: accentSweeps.length,
  };
})();
return 'armed';
'@

# ---------------------------------------------------------------- 冻结的判据常量
# 这些是**合同已冻结**的取值（visual-contract.md §4/§5.4），放在脚本里只为让「本轮测到哪些维度」
# 与「哪些维度留给 V1b」可对账；采集器不自创、不改写它们。
$probeScriptMarker = 'WCAG21:(L1+0.05)/(L2+0.05)'   # 探针脚本里必须出现的锚点（测试会抽取并做语法检查）
$deferredDimensions = @(
  'VC-03：键盘 Tab 聚焦路径与聚焦态截图（本轮只做程序化 focus 后的实测 outline/border）',
  'VC-04：页面上段落类型色的实际使用点、以及是否出现第五种类型色',
  'VC-05/VC-06：默认/选中/播放三态（交互态）',
  'VC-07：三种状态色的实际使用点与冗余文字/形状',
  'VC-08/VC-09/VC-10/VC-11：目录节点、类型胶囊、卡片细节与多视口',
  'VC-12：全页面字号/字重清点（本轮只测被选中元素）',
  'VC-13/VC-14/VC-16：字幕与行高的实际渲染',
  'VC-15①：全页面间距清点（本轮只做元素级抽样）；VC-15④ 的控制栏 40 只在 textExpand/mapExpand 模式渲染',
  'VC-17：导图节点与连线',
  'VC-19：动效时长与 reduced-motion'
)

function Test-Property($Object, [string]$Name) {
  # ConvertFrom-Json 会把**空数组**也读成 $null，因此"缺字段"与"字段是空数组"必须按属性存在性判定
  # （`@($null).Count` 返回 1，会让 foreach 静默空转——t2 复核抓到的正是这个形状）。
  if ($null -eq $Object) { return $false }
  if ($Object -is [string]) { return $false }
  return ($null -ne $Object.PSObject.Properties[$Name])
}

function Require-Command([string]$Name, [string]$InstallHint) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "$Name is required for the visual evidence collector. $InstallHint" }
  return $command.Source
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
  # 按 UTF-8 字节发送并声明 charset：选择器与注入脚本里的中文否则会变成 '?'（既有 E2E 脚本踩过的坑）。
  $payload = [System.Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $Body -Depth 30))
  return Invoke-RestMethod -Method $Method -Uri $uri -ContentType 'application/json; charset=utf-8' -Body $payload -TimeoutSec $webDriverRequestSeconds
}

function New-WebDriverSession([string]$ApplicationPath) {
  $response = Invoke-WebDriver 'Post' '/session' @{
    capabilities = @{ alwaysMatch = @{ browserName = 'wry'; 'tauri:options' = @{ application = $ApplicationPath } } }
  }
  if ($response.value.sessionId) { return [string]$response.value.sessionId }
  if ($response.sessionId) { return [string]$response.sessionId }
  throw 'Could not create WebDriver session.'
}

function Close-WebDriverSession([string]$SessionId) {
  if ([string]::IsNullOrWhiteSpace($SessionId)) { return }
  try { Invoke-WebDriver 'Delete' "/session/$SessionId" | Out-Null } catch { }
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

function Find-WebDriverElement([string]$SessionId, [string]$Selector) {
  $response = Invoke-WebDriver 'Post' "/session/$SessionId/element" @{ using = 'css selector'; value = $Selector }
  if ($response.value -and $response.value.$elementKey) { return [string]$response.value.$elementKey }
  throw "WebDriver returned no element for selector: $Selector"
}

function Invoke-WebDriverElementClick([string]$SessionId, [string]$ElementId) {
  Invoke-WebDriver 'Post' "/session/$SessionId/element/$ElementId/click" @{} | Out-Null
}

function Save-WebDriverScreenshot([string]$SessionId, [string]$Destination) {
  $payload = [string](Invoke-WebDriver 'Get' "/session/$SessionId/screenshot").value
  if ([string]::IsNullOrWhiteSpace($payload)) { throw 'empty screenshot payload' }
  $bytes = [Convert]::FromBase64String($payload)
  if ($bytes.Length -lt 8 -or $bytes[0] -ne 0x89 -or $bytes[1] -ne 0x50) { throw 'screenshot payload is not a PNG' }
  [System.IO.File]::WriteAllBytes($Destination, $bytes)
  return $bytes.Length
}

# 运行探针：注入配置 + 脚本 → 有界等待完成 → 返回探针结果对象。
function Invoke-VisualProbe([string]$SessionId, $Specs, [string]$Page, $AccentSweeps = $null) {
  $config = @{
    specs = $Specs
    accentSweeps = @($AccentSweeps)
    tolerance = @{ contrastRatio = $tolerance.contrastRatio; colorChannel = $tolerance.colorChannel }
    toleranceBasis = $toleranceBasis
  }
  $configJson = ConvertTo-Json -InputObject $config -Depth 12 -Compress
  Invoke-WebDriverScript $SessionId ('window.__RAIN_VISUAL_PROBE__ = null; window.__RAIN_VISUAL_PROBE_CONFIG__ = ' + $configJson + ';') | Out-Null
  Invoke-WebDriverScript $SessionId $probeScript | Out-Null
  Wait-WebDriverCondition $SessionId "the visual probe on page '$Page'" @"
const probe = $probeInterface;
return Boolean(probe) && probe.status === 'done';
"@
  $raw = [string](Invoke-WebDriverScript $SessionId "return JSON.stringify($probeInterface);")
  return (ConvertFrom-Json -InputObject $raw)
}

# 写入逐条实测记录（每条判据一个文件）；缺失选择器即硬失败，不产出空记录。
function Write-ProbeRecords($Probe, [string]$RecordsDir, $ScreenshotRefs, [string]$Page, $SpecById) {
  $written = @()
  $missing = @()
  $singleton = ($Page -eq 'study')   # 学习页只跑一次，可安全 focus
  foreach ($result in @($Probe.results)) {
    if ([bool]$result.missing) {
      $missing += ("{0} [{1}] {2}" -f $result.vc, $result.selector, $result.note)
      continue
    }
    $spec = $SpecById[[string]$result.probeId]
    $scope = 'element'
    if ($null -ne $spec -and $null -ne $spec.scope) { $scope = [string]$spec.scope }
    if ($scope -eq 'rootTokens') {
      # 令牌解析值记录（VC-04 的四个类型色令牌、VC-15 的阶梯令牌、VC-12 的字号阶梯）：
      # 只声明"令牌值是什么"，不声明"页面用了它"（§2.5：token 存在 ≠ 被使用）。
      $record = [ordered]@{
        recordId = [string]$result.probeId
        vc = [string]$result.vc
        criterion = [string]$result.criterion
        page = $Page
        measurementScope = 'rootTokens'
        selector = ':root'
        description = [string]$result.description
        sampledViewport = [ordered]@{
          width = [double]$Probe.viewport.width
          height = [double]$Probe.viewport.height
          devicePixelRatio = [double]$Probe.viewport.devicePixelRatio
          sampledAt = [string]$Probe.capturedAt
        }
        screenshots = @($ScreenshotRefs)
        resolvedTokens = $result.derived.tokens
        probeNote = '令牌解析值（getComputedStyle(document.documentElement).getPropertyValue）。页面实例值由同一页面的 element 记录给出；令牌存在不等于被使用。'
      }
      $path = Join-Path $RecordsDir (([string]$result.probeId) + '.json')
      [System.IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $record -Depth 12), [System.Text.UTF8Encoding]::new($false))
      $written += $record
      continue
    }
    $record = [ordered]@{
      recordId = [string]$result.probeId
      vc = [string]$result.vc
      criterion = [string]$result.criterion
      page = $Page
      measurementScope = 'element'
      selector = [string]$result.selector
      description = if ($null -ne $spec) { [string]$spec.description } else { '' }
      sampledViewport = [ordered]@{
        width = [double]$Probe.viewport.width
        height = [double]$Probe.viewport.height
        devicePixelRatio = [double]$Probe.viewport.devicePixelRatio
        sampledAt = [string]$Probe.capturedAt
      }
      screenshots = @($ScreenshotRefs)
      rect = $result.rect
      computedStyle = $result.computedStyle
      derived = $result.derived
      measured = $result.measured
      probeNote = [string]$result.description
    }
    if ($null -ne $spec -and $null -ne $spec.declaredToken) {
      # 令牌来源即采集器要核对的**已冻结取值**（§5.5）；校验器会把它与实测合成色按 ±1/通道 对账。
      $record.declaredToken = [ordered]@{
        name = [string]$spec.declaredToken
        value = [string]$spec.declaredTokenValue
        source = 'visual-contract.md §5.5 (frozen token value; declared by the collector from the contract, not invented here)'
      }
    }
    if ($null -ne $spec -and $spec.focus -and $singleton) {
      $record.focusMeasurement = $result.derived.focusRing
      $record.probeNote = [string]$record.probeNote + '（focus 只在该页唯一一次采集中执行，避免改变后续元素的焦点/滚动状态）'
    }
    $path = Join-Path $RecordsDir (([string]$result.probeId) + '.json')
    [System.IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $record -Depth 12), [System.Text.UTF8Encoding]::new($false))
    $written += $record
  }
  return @{ records = $written; missing = $missing }
}

# VC-03① 的跨元素扫描记录：不含 rect/computedStyle/对比度（它不是逐元素测量），
# 由校验器按自己的形状裁判（scannedElementCount + 被渲染属性集合 + 匹配清单）。
function Write-AccentSweepRecords($Probe, [string]$RecordsDir, $ScreenshotRefs, $SweepById) {
  $written = @()
  $missing = @()
  # 探针**必须**回传 accentSweeps：缺这个键意味着跨元素扫描一条都没做（manifest 却可能仍宣称扫过）。
  # 这里用属性存在性判定而不是 `@($null).Count`（后者返回 1，会让整个循环静默空转）。
  if (-not (Test-Property $Probe 'accentSweeps')) {
    throw 'Visual probe did not return accentSweeps; refusing to emit an evidence package that would claim sweeps it never performed.'
  }
  $expected = @($Probe.accentSweeps)
  foreach ($sweep in $expected) {
    if ($null -eq $sweep) { throw 'accentSweeps contains a null entry' }
    if ([bool]$sweep.missing -or $null -eq $sweep.accentSweep) {
      $missing += ("{0} [{1}] accent sweep scope not found" -f $sweep.vc, $sweep.probeId)
      continue
    }
    $spec = $SweepById[[string]$sweep.probeId]
    $record = [ordered]@{
      recordId = [string]$sweep.probeId
      vc = [string]$sweep.vc
      criterion = [string]$sweep.criterion
      page = [string]$sweep.page
      measurementScope = 'accentSweep'
      selector = [string]$sweep.accentSweep.selectorScope
      description = if ($null -ne $spec) { [string]$spec.description } else { [string]$sweep.description }
      sampledViewport = [ordered]@{
        width = [double]$Probe.viewport.width
        height = [double]$Probe.viewport.height
        devicePixelRatio = [double]$Probe.viewport.devicePixelRatio
        sampledAt = [string]$Probe.capturedAt
      }
      screenshots = @($ScreenshotRefs)
      accentSweep = $sweep.accentSweep
    }
    $path = Join-Path $RecordsDir (([string]$sweep.probeId) + '.json')
    [System.IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $record -Depth 12), [System.Text.UTF8Encoding]::new($false))
    $written += $record
  }
  # 请求了几条扫描就必须写出几条记录：少一条即视为探测失败（不许静默减条）。
  if ($written.Count -ne $expected.Count) {
    throw ('Accent sweep records written (' + $written.Count + ') do not match the requested sweeps (' + $expected.Count + ').')
  }
  return @{ records = $written; missing = $missing }
}

# ---------------------------------------------------------------- 判据 spec 表
# 每条 spec 只引用合同 §4 已写明的判据与 §5.5 已冻结的取值；不发明新语义、新颜色或新令牌。
function Get-ListSpecs {
  return @(
    @{ id = 'VC-01-list-body-bg'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'video-list'; selector = 'body'; description = 'VC-01② 实测背景类颜色的相对亮度'; scope = 'element' },
    @{ id = 'VC-01-list-page-bg'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'video-list'; selector = '[data-testid="video-list-page"]'; description = 'VC-01② 页面根容器背景'; scope = 'element' },
    @{ id = 'VC-01-list-topbar'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'video-list'; selector = '[data-testid="video-list-page"] header'; description = 'VC-01② 顶栏背景'; scope = 'element' },
    @{ id = 'VC-02-list-bg-token'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'video-list'; selector = '[data-testid="video-list-page"]'; description = ('VC-02 深底套 --color-bg 实测值，冻结值 ' + $frozen.dark.bg); scope = 'element'; declaredToken = '--color-bg'; declaredTokenValue = $frozen.dark.bg },
    @{ id = 'VC-02-list-topbar-surface'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'video-list'; selector = '[data-testid="video-list-page"] header'; description = ('VC-02 深底套 --color-surface 实测值，冻结值 ' + $frozen.dark.surface); scope = 'element'; declaredToken = '--color-surface'; declaredTokenValue = $frozen.dark.surface },
    @{ id = 'VC-02-list-import-button'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'video-list'; selector = '[data-testid="video-list-page"] header button'; description = ('VC-02 主按钮取该套面板色（描边款；--color-surface 冻结值 ' + $frozen.dark.surface + '）'); scope = 'element'; declaredToken = '--color-surface'; declaredTokenValue = $frozen.dark.surface },
    @{ id = 'VC-02-list-border-token'; vc = 'VC-02'; criterion = 'neutralScaleBorderToken'; page = 'video-list'; selector = '[data-testid="video-list-page"] header input[type="text"]'; description = ('VC-02 深底套 1px 边框令牌实测（--color-border 冻结值 ' + $frozen.dark.border + '）'); nonText = $true; scope = 'element'; declaredToken = '--color-border'; declaredTokenValue = $frozen.dark.border },
    @{ id = 'VC-03-list-import-button'; vc = 'VC-03'; criterion = 'primaryButtonOutlinedText'; page = 'video-list'; selector = '[data-testid="video-list-page"] header button'; description = ('VC-03② 描边款文字 = --color-fg ' + $frozen.dark.fg + '（对底 12.32:1）'); scope = 'element'; declaredToken = '--color-fg'; declaredTokenValue = $frozen.dark.fg },
    @{ id = 'VC-03-list-import-button-border'; vc = 'VC-03'; criterion = 'primaryButtonOutlinedBorder'; page = 'video-list'; selector = '[data-testid="video-list-page"] header button'; description = ('VC-03② 描边款边框 1px = --color-border ' + $frozen.dark.border + '（对底 4.80:1）'); nonText = $true; scope = 'element'; declaredToken = '--color-border'; declaredTokenValue = $frozen.dark.border },
    @{ id = 'VC-03-list-import-button-focus-ring'; vc = 'VC-03'; criterion = 'focusRing2pxDashedFg'; page = 'video-list'; selector = '[data-testid="video-list-page"] header button'; description = 'VC-03④ 聚焦圈：程序化 focus 后的实测 outline/border + 是否匹配 :focus-visible（键盘 Tab 路径属 V1b）'; focus = $true; scope = 'element' },
    @{ id = 'VC-12-list-topbar-title'; vc = 'VC-12'; criterion = 'fontStackWeightSizeOnTopbarTitle'; page = 'video-list'; selector = '[data-testid="video-list-page"] header > span'; description = 'VC-12①②③ 顶栏标题的字体族/字重/字号 + 文本对比（仅该元素实测；全页面清点属 V1b）'; scope = 'element' },
    @{ id = 'VC-15-list-topbar-height'; vc = 'VC-15'; criterion = 'keyHeightTopbar40'; page = 'video-list'; selector = '[data-testid="video-list-page"] header'; description = 'VC-15④ 顶栏高度 40'; scope = 'element' },
    @{ id = 'VC-15-list-control-radius'; vc = 'VC-15'; criterion = 'radiusLadder'; page = 'video-list'; selector = '[data-testid="video-list-page"] header button'; description = 'VC-15② 圆角必须取自冻结阶梯 0/4/8/12/胶囊'; scope = 'element' },
    @{ id = 'VC-15-list-control-spacing'; vc = 'VC-15'; criterion = 'spacingLadder'; page = 'video-list'; selector = '[data-testid="video-list-page"] header button'; description = 'VC-15① 间距只取 4/8/12/16/20/24/32/48（该元素的 padding/margin 与子元素间隙实测）'; scope = 'element' },
    @{ id = 'VC-15-list-main-shadow'; vc = 'VC-15'; criterion = 'cardNoShadow'; page = 'video-list'; selector = '[data-testid="video-list-page"] main'; description = 'VC-15③ 卡片区不得有阴影（实测 box-shadow；卡片刻意不用阴影分层）'; scope = 'element' },
    @{ id = 'VC-15-list-spacing-ladder-tokens'; vc = 'VC-15'; criterion = 'spacingLadderTokens'; page = 'video-list'; selector = ':root'; description = 'VC-15① 间距阶梯令牌解析值必须是 4/8/12/16/20/24/32/48 且只有这 8 档'; scope = 'rootTokens' },
    @{ id = 'VC-15-list-radius-ladder-tokens'; vc = 'VC-15'; criterion = 'radiusLadderTokens'; page = 'video-list'; selector = ':root'; description = 'VC-15② 圆角阶梯令牌解析值必须是 0/4/8/12/胶囊 五档'; scope = 'rootTokens' },
    @{ id = 'VC-12-list-font-size-ladder-tokens'; vc = 'VC-12'; criterion = 'fontSizeLadderTokens'; page = 'video-list'; selector = ':root'; description = 'VC-12③ 字号阶梯令牌解析值必须只有 18/16/14/13/12 五档'; scope = 'rootTokens' }
  )
}

function Get-SettingsSpecs {
  return @(
    @{ id = 'VC-01-settings-bg'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'settings'; selector = '[data-testid="settings-page"]'; description = 'VC-01② 设置页根背景'; scope = 'element' },
    @{ id = 'VC-01-settings-topbar'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'settings'; selector = '[data-testid="settings-page"] > div'; description = 'VC-01② 设置页顶栏背景'; scope = 'element' },
    @{ id = 'VC-02-settings-bg-token'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'settings'; selector = '[data-testid="settings-page"]'; description = ('VC-02 浅底套 bg 实测值，冻结值 ' + $frozen.light.bg); scope = 'element'; declaredToken = 'COLORS.bg'; declaredTokenValue = $frozen.light.bg },
    @{ id = 'VC-02-settings-topbar-panel'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'settings'; selector = '[data-testid="settings-page"] > div'; description = ('VC-02 浅底套 panel 实测值，冻结值 ' + $frozen.light.panel); scope = 'element'; declaredToken = 'COLORS.panel'; declaredTokenValue = $frozen.light.panel },
    @{ id = 'VC-02-settings-add-model'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'settings'; selector = '[data-testid="add-model"]'; description = 'VC-02 浅底套主按钮面板色（描边款）'; scope = 'element'; declaredToken = 'COLORS.panel'; declaredTokenValue = $frozen.light.panel },
    @{ id = 'VC-02-settings-topbar-muted'; vc = 'VC-02'; criterion = 'neutralScaleMutedToken'; page = 'settings'; selector = '[data-testid="settings-page"] > div > span + span'; description = ('VC-02 浅底套次要文字实测（COLORS.muted 冻结值 ' + $frozen.light.muted + '）'); scope = 'element'; declaredToken = 'COLORS.muted'; declaredTokenValue = $frozen.light.muted },
    @{ id = 'VC-02-settings-topbar-border'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'settings'; selector = '[data-testid="settings-page"] > div'; description = ('VC-02/VCGAP-20 浅底套 1px 边框令牌实测（COLORS.border 冻结值 ' + $frozen.light.border + '）'); nonText = $true; scope = 'element'; declaredToken = 'COLORS.border'; declaredTokenValue = $frozen.light.border },
    @{ id = 'VC-03-settings-add-model'; vc = 'VC-03'; criterion = 'primaryButtonOutlinedText'; page = 'settings'; selector = '[data-testid="add-model"]'; description = ('VC-03② 浅底套描边款文字 = COLORS.fg ' + $frozen.light.fg + '（对底 14.64:1）'); scope = 'element'; declaredToken = 'COLORS.fg'; declaredTokenValue = $frozen.light.fg },
    @{ id = 'VC-03-settings-add-model-border'; vc = 'VC-03'; criterion = 'primaryButtonOutlinedBorder'; page = 'settings'; selector = '[data-testid="add-model"]'; description = ('VC-03② 浅底套描边款边框 1px = COLORS.border ' + $frozen.light.border + '（对底 3.49:1）'); nonText = $true; scope = 'element'; declaredToken = 'COLORS.border'; declaredTokenValue = $frozen.light.border },
    @{ id = 'VC-12-settings-topbar-title'; vc = 'VC-12'; criterion = 'fontStackWeightSizeOnTopbarTitle'; page = 'settings'; selector = '[data-testid="settings-page"] > div > span'; description = 'VC-12①②③ 顶栏标题的字体族/字重/字号 + 文本对比（仅该元素实测；全页面清点属 V1b）'; scope = 'element' },
    @{ id = 'VC-15-settings-topbar-height'; vc = 'VC-15'; criterion = 'keyHeightTopbar40'; page = 'settings'; selector = '[data-testid="settings-page"] > div'; description = 'VC-15④ 顶栏高度 40' },
    @{ id = 'VC-15-settings-add-model-radius'; vc = 'VC-15'; criterion = 'radiusLadder'; page = 'settings'; selector = '[data-testid="add-model"]'; description = 'VC-15② 圆角必须取自冻结阶梯（S7 曾把阶梯外的 6 改回 8）' },
    @{ id = 'VC-15-settings-add-model-spacing'; vc = 'VC-15'; criterion = 'spacingLadder'; page = 'settings'; selector = '[data-testid="add-model"]'; description = 'VC-15① 间距只取 4/8/12/16/20/24/32/48（该元素的 padding/margin 与子元素间隙实测）' }
  )
}

function Get-StudySpecs {
  return @(
    @{ id = 'VC-01-study-root'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'study'; selector = '[data-testid="study-interface"]'; description = 'VC-01② 学习页根容器背景（实测合成后的不透明底色）'; scope = 'element' },
    @{ id = 'VC-01-study-body'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'study'; selector = 'body'; description = 'VC-01② 学习页 body 背景（级联来源）'; scope = 'element' },
    @{ id = 'VC-01-study-video-shell'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'study'; selector = '[data-testid="video-zone-shell"]'; description = 'VC-01② 学习页视频区容器背景（实测合成后的不透明底色）'; scope = 'element' },
    @{ id = 'VC-03-study-rightpanel-tabbar'; vc = 'VC-03'; criterion = 'controlNoBrandAccent'; page = 'study'; selector = '[data-testid="study-interface"] > aside:last-of-type > div'; description = 'VC-03③ 右面板 Tab 条（aside:last-of-type = 右侧面板，不是左侧目录树）；本轮只测静态部分，激活态属 V1b'; scope = 'element' },
    @{ id = 'VC-04-study-paragraph-type-tokens'; vc = 'VC-04'; criterion = 'paragraphTypeToken'; page = 'study'; selector = ':root'; description = 'VC-04 段落类型彩字态**令牌解析值**（四个 --color-* 令牌；页面上的实际使用点与「第五种颜色」本轮不判，见 coverage scopeNote）'; scope = 'rootTokens' },
    @{ id = 'VC-15-study-catalogbar-height'; vc = 'VC-15'; criterion = 'keyHeightCatalogBar80'; page = 'study'; selector = '[data-testid="catalog-bar"]'; description = 'VC-15④ 目录横条高度 80'; scope = 'element' },
    @{ id = 'VC-15-study-root-spacing'; vc = 'VC-15'; criterion = 'spacingLadder'; page = 'study'; selector = '[data-testid="study-interface"]'; description = 'VC-15① 间距只取 4/8/12/16/20/24/32/48（该元素的 padding/margin 与子元素间隙实测）'; scope = 'element' }
  )
}

# VC-03①「不存在品牌强调色」是**全称否定**：单元素颜色测不出来，必须跨元素扫描。
# 每个入口页面各扫一次（root token 记录另附，见 manifest 的 accentSweeps）。
function Get-AccentSweeps {
  return @(
    @{ id = 'VC-03-list-accent-sweep'; vc = 'VC-03'; criterion = 'noBrandAccentAnywhere'; page = 'video-list'; selectorScope = '[data-testid="video-list-page"]'; accentToken = '#4a9eff'; description = 'VC-03① 视频列表页全页扫描：任何被渲染的底色/边框/轮廓/文字都不得等于 #4a9eff（±1/通道）' },
    @{ id = 'VC-03-settings-accent-sweep'; vc = 'VC-03'; criterion = 'noBrandAccentAnywhere'; page = 'settings'; selectorScope = '[data-testid="settings-page"]'; accentToken = '#4a9eff'; description = 'VC-03① 设置页全页扫描' },
    @{ id = 'VC-03-study-accent-sweep'; vc = 'VC-03'; criterion = 'noBrandAccentAnywhere'; page = 'study'; selectorScope = '[data-testid="study-interface"]'; accentToken = '#4a9eff'; description = 'VC-03① 学习页全页扫描' }
  )
}

# ---------------------------------------------------------------- 主流程
$tauriDriver = $null
$driverProcess = $null
$sessionId = $null
$phase = 'bootstrap'
$primaryError = $null
$packageRoot = $null

try {
  if ([string]::IsNullOrWhiteSpace($TargetSha)) {
    if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_SHA)) {
      $TargetSha = $env:GITHUB_SHA.Trim()
    } else {
      $TargetSha = (& git -C $repoRoot rev-parse HEAD).Trim()
    }
  }
  $TargetSha = $TargetSha.ToLowerInvariant()
  if ($TargetSha -notmatch '^[0-9a-f]{40}$') { throw "TargetSha must be a full 40-char lowercase hex commit sha; observed '$TargetSha'" }
  $shortSha = $TargetSha.Substring(0, 8)
  $deferredList = ($deferredDimensions -join '；')

  $evidenceId = 'visual-' + $shortSha + '-' + (Get-Date).ToString('yyyyMMdd-HHmmss')
  $packageRoot = Join-Path (Join-Path $EvidenceRoot 'evidence') $evidenceId
  $recordsDir = Join-Path $packageRoot 'records'
  $screenshotsDir = Join-Path $packageRoot 'screenshots'
  New-Item -ItemType Directory -Path $recordsDir, $screenshotsDir -Force | Out-Null
  Write-Output "visual evidence package: $packageRoot"

  $tauriDriver = Require-Command 'tauri-driver' 'Install with: cargo install tauri-driver --locked'
  $edgeDriver = Require-Command 'msedgedriver' 'Install a Microsoft Edge driver matching the local WebView2 runtime.'
  $npmCmd = Require-Command 'npm.cmd' 'Install Node.js 18 or newer.'

  $appBinary = Join-Path $repoRoot 'src-tauri\target\debug\rain.exe'
  if (-not $SkipBuild) {
    $phase = 'build'
    $env:RAIN_E2E_BUILD = '1'
    & $npmCmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    $env:LIBCLANG_PATH = if ($env:LIBCLANG_PATH) { $env:LIBCLANG_PATH } else { 'C:\Program Files\LLVM\bin' }
    $env:CMAKE_CXX_FLAGS = '/utf-8'
    $env:CMAKE_C_FLAGS = '/utf-8'
    & $npmCmd run tauri -- build --debug --no-bundle
    if ($LASTEXITCODE -ne 0) { throw 'Tauri debug build failed.' }
  }
  if (-not (Test-Path -LiteralPath $appBinary)) { throw "Rain debug binary not found: $appBinary" }

  # 宿主信息（§3.4 第 1 项）。
  $osInfo = Get-CimInstance -ClassName Win32_OperatingSystem
  $tauriConfig = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText((Join-Path $repoRoot 'src-tauri\tauri.conf.json'), [System.Text.UTF8Encoding]::new($false)))
  $tauriDriverVersion = 'unavailable'
  try { $tauriDriverVersion = ((& $tauriDriver --version | Out-String).Trim()) } catch { }

  $phase = 'driver-start'
  $driverProcess = Start-Process -FilePath $tauriDriver -ArgumentList @(
    '--port', [string]$DriverPort,
    '--native-port', [string]$NativeDriverPort,
    '--native-driver', $edgeDriver
  ) -RedirectStandardOutput $driverLog -RedirectStandardError $driverErrorLog -WindowStyle Hidden -PassThru
  Wait-WebDriver $DriverPort

  $env:RAIN_E2E_MODE = '1'
  $screenshotNames = @()
  $allRecords = @()
  $allMissing = @()
  $viewports = @()
  $runtimeVersions = @()

  # study-catalog 模式**必须**有非空的 RAIN_E2E_VIDEO_PATH：src-tauri/src/e2e_config.rs 对该 mode 调用
  # required_env("RAIN_E2E_VIDEO_PATH")，空串直接返回 Err（"RAIN_E2E_VIDEO_PATH is required for Rain
  # real E2E mode"）→ get_real_e2e_config 失败 → 夹具接口永不武装 → 本脚本会 throw。
  # 因此按既有 run-study-catalog-e2e.ps1 的做法生成一份 WebView 可加载的合成 WAV 并声明其时长。
  $studyMediaPath = Join-Path $runRoot 'rain-visual-study-media.wav'
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
"@ $studyMediaPath
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $studyMediaPath)) { throw 'Synthetic study media fixture generation failed.' }
  Write-Output ("synthetic study media: declared ${mediaDeclarationSeconds}s bytes=" + (Get-Item -LiteralPath $studyMediaPath).Length)

  # 两个短模式各起一次应用：video-list（列表页 + 设置页）与 study-catalog（学习页）。
  # 每个模式用各自的隔离数据库；两条都在**同一次采集运行**内。
  $runPlan = @(
    @{ mode = 'video-list'; steps = @('list', 'settings') },
    @{ mode = 'study-catalog'; steps = @('study') }
  )

  foreach ($plan in $runPlan) {
    $phase = 'session-' + $plan.mode
    $databasePath = Join-Path $runRoot ('rain-visual-' + $plan.mode + '.db')
    $env:RAIN_E2E_RUN_MODE = $plan.mode
    $env:RAIN_E2E_DB_PATH = $databasePath
    # 只有 study-catalog 需要真实（合成）媒体路径；video-list 模式不读该变量，置空以免误用。
    if ($plan.mode -eq 'study-catalog') {
      $env:RAIN_E2E_VIDEO_PATH = $studyMediaPath
    } else {
      $env:RAIN_E2E_VIDEO_PATH = ''
    }
    $sessionId = New-WebDriverSession $appBinary
    Wait-WebDriverCondition $sessionId 'the video list page' "return Boolean(document.querySelector('[data-testid=""video-list-page""]'));"
    # 宿主 WebView2 版本：从 UA 的 Edg/<version> 取，并与 workflow 钉住的 msedgedriver 版本核对。
    $userAgent = [string](Invoke-WebDriverScript $sessionId 'return navigator.userAgent;')
    $uaMatch = [regex]::Match($userAgent, 'Edg/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)')
    if ($uaMatch.Success) { $runtimeVersions += $uaMatch.Groups[1].Value }

    if ($plan.steps -contains 'list') {
      $phase = 'probe-list'
      $specs = Get-ListSpecs
      $specById = @{}
      foreach ($spec in $specs) { $specById[[string]$spec.id] = $spec }
      $sweeps = @(Get-AccentSweeps | Where-Object { $_.page -eq 'video-list' })
      $sweepById = @{}
      foreach ($sweep in $sweeps) { $sweepById[[string]$sweep.id] = $sweep }
      $probe = Invoke-VisualProbe $sessionId $specs 'video-list' $sweeps
      $viewports += $probe.viewport
      $name = 'screenshots/01-video-list.png'
      $bytes = Save-WebDriverScreenshot $sessionId (Join-Path $packageRoot $name)
      Write-Output "screenshot $name bytes=$bytes"
      $screenshotNames += $name
      $written = Write-ProbeRecords $probe $recordsDir @($name) 'video-list' $specById
      $allRecords += $written.records
      $allMissing += $written.missing
      $sweepWritten = Write-AccentSweepRecords $probe $recordsDir @($name) $sweepById
      $allRecords += $sweepWritten.records
      $allMissing += $sweepWritten.missing
    }

    if ($plan.steps -contains 'settings') {
      $phase = 'probe-settings'
      # 经**生产入口**进入设置页：真实点击 [data-testid="open-settings"]（不注入路由、不改状态）。
      $settingsButton = Find-WebDriverElement $sessionId '[data-testid="open-settings"]'
      Invoke-WebDriverElementClick $sessionId $settingsButton
      Wait-WebDriverCondition $sessionId 'the settings page' "return Boolean(document.querySelector('[data-testid=""settings-page""]'));"
      $specs = Get-SettingsSpecs
      $specById = @{}
      foreach ($spec in $specs) { $specById[[string]$spec.id] = $spec }
      $sweeps = @(Get-AccentSweeps | Where-Object { $_.page -eq 'settings' })
      $sweepById = @{}
      foreach ($sweep in $sweeps) { $sweepById[[string]$sweep.id] = $sweep }
      $probe = Invoke-VisualProbe $sessionId $specs 'settings' $sweeps
      $viewports += $probe.viewport
      $name = 'screenshots/03-settings.png'
      $bytes = Save-WebDriverScreenshot $sessionId (Join-Path $packageRoot $name)
      Write-Output "screenshot $name bytes=$bytes"
      $screenshotNames += $name
      $written = Write-ProbeRecords $probe $recordsDir @($name) 'settings' $specById
      $allRecords += $written.records
      $allMissing += $written.missing
      $sweepWritten = Write-AccentSweepRecords $probe $recordsDir @($name) $sweepById
      $allRecords += $sweepWritten.records
      $allMissing += $sweepWritten.missing
    }

    if ($plan.steps -contains 'study') {
      $phase = 'probe-study'
      # 学习页经**生产路径**进入：受控夹具落库（study-catalog 短模式）→ 重启 → 真实点击卡片主操作。
      $fixtureStatus = [string](Invoke-WebDriverScript $sessionId 'const f = window.__RAIN_STUDY_CATALOG_FIXTURE__; return f ? String(f.status) : "absent";')
      if ($fixtureStatus -eq 'absent') {
        $deadline = (Get-Date).AddSeconds([Math]::Min(30, $MaxSeconds))
        do {
          Start-Sleep -Milliseconds 500
          $fixtureStatus = [string](Invoke-WebDriverScript $sessionId 'const f = window.__RAIN_STUDY_CATALOG_FIXTURE__; return f ? String(f.status) : "absent";')
        } while ($fixtureStatus -eq 'absent' -and (Get-Date) -lt $deadline)
      }
      if ($fixtureStatus -eq 'idle') {
        Invoke-WebDriverScript $sessionId 'const f = window.__RAIN_STUDY_CATALOG_FIXTURE__; f.seed(); return "requested";' | Out-Null
        Wait-WebDriverCondition $sessionId 'the controlled study fixture publication' 'const f = window.__RAIN_STUDY_CATALOG_FIXTURE__; return Boolean(f) && (f.status === "seeded" || f.status === "failed");'
        $fixtureStatus = [string](Invoke-WebDriverScript $sessionId 'const f = window.__RAIN_STUDY_CATALOG_FIXTURE__; return String(f.status);')
      }
      if ($fixtureStatus -ne 'seeded') { throw "Controlled study fixture is not seeded (status=$fixtureStatus); cannot reach the study page through the production path." }
      Close-WebDriverSession $sessionId
      $sessionId = New-WebDriverSession $appBinary
      Wait-WebDriverCondition $sessionId 'the video list page after restart' "return Boolean(document.querySelector('[data-testid=""video-list-page""]'));"
      $cardDeadline = (Get-Date).AddSeconds([Math]::Min(30, $MaxSeconds))
      $cardCount = 0
      do {
        $cardCount = [int](Invoke-WebDriverScript $sessionId 'return document.querySelectorAll("' + '[data-testid^="card-"] button' + '").length;')
        if ($cardCount -ge 1) { break }
        Start-Sleep -Milliseconds 500
      } while ((Get-Date) -lt $cardDeadline)
      if ($cardCount -lt 1) { throw 'The controlled fixture did not render a clickable card after restart.' }
      $cardAction = Find-WebDriverElement $sessionId '[data-testid^="card-"] button'
      Invoke-WebDriverElementClick $sessionId $cardAction
      Wait-WebDriverCondition $sessionId 'the study interface' "return Boolean(document.querySelector('[data-testid=""study-interface""]'));"
      $specs = Get-StudySpecs
      $specById = @{}
      foreach ($spec in $specs) { $specById[[string]$spec.id] = $spec }
      $sweeps = @(Get-AccentSweeps | Where-Object { $_.page -eq 'study' })
      $sweepById = @{}
      foreach ($sweep in $sweeps) { $sweepById[[string]$sweep.id] = $sweep }
      $probe = Invoke-VisualProbe $sessionId $specs 'study' $sweeps
      $viewports += $probe.viewport
      $name = 'screenshots/02-study.png'
      $bytes = Save-WebDriverScreenshot $sessionId (Join-Path $packageRoot $name)
      Write-Output "screenshot $name bytes=$bytes"
      $screenshotNames += $name
      $written = Write-ProbeRecords $probe $recordsDir @($name) 'study' $specById
      $allRecords += $written.records
      $allMissing += $written.missing
      $sweepWritten = Write-AccentSweepRecords $probe $recordsDir @($name) $sweepById
      $allRecords += $sweepWritten.records
      $allMissing += $sweepWritten.missing
    }

    Close-WebDriverSession $sessionId
    $sessionId = $null
  }

  if ($allMissing.Count -gt 0) {
    throw ('Visual probe could not measure ' + $allMissing.Count + ' target(s); refusing to emit a package with blank records: ' + ($allMissing -join ' | '))
  }

  # 视口与 DPR：同一次运行内的采样应一致；不一致就如实报出。
  $viewportWidths = @($viewports | ForEach-Object { [double]$_.width } | Sort-Object -Unique)
  $viewportHeights = @($viewports | ForEach-Object { [double]$_.height } | Sort-Object -Unique)
  $devicePixelRatios = @($viewports | ForEach-Object { [double]$_.devicePixelRatio } | Sort-Object -Unique)
  $runtimeVersionValues = @($runtimeVersions | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
  $runtimeVersion = if ($runtimeVersionValues.Count -eq 1) { [string]$runtimeVersionValues[0] } else { ($runtimeVersionValues -join ',') }
  $expectedDriverVersion = $env:RAIN_E2E_WEBVIEW2_VERSION
  $driverVersionForManifest = $runtimeVersion
  if (-not [string]::IsNullOrWhiteSpace($expectedDriverVersion)) { $driverVersionForManifest = $expectedDriverVersion }
  if ($runtimeVersionValues.Count -eq 1 -and -not [string]::IsNullOrWhiteSpace($expectedDriverVersion) -and $expectedDriverVersion -ne $runtimeVersion) {
    throw ("WebView2 runtime reported by the app ($runtimeVersion) does not match the pinned msedgedriver ($expectedDriverVersion); the host version would not explain this measurement.")
  }
  if ($viewportWidths.Count -ne 1 -or $viewportHeights.Count -ne 1) {
    throw ("Sampled viewports are not identical within this run (widths=$($viewportWidths -join ',') heights=$($viewportHeights -join ',')); the evidence package must bind to one viewport per §3.4.")
  }

  $phase = 'manifest'
  $recordRefs = @($allRecords | ForEach-Object { [ordered]@{ recordId = [string]$_.recordId; file = ('records/' + [string]$_.recordId + '.json') } })
  $manifest = [ordered]@{
    schemaVersion = 1
    evidenceId = $evidenceId
    generatedAt = [DateTimeOffset]::Now.ToString('o')
    generatedBy = 'scripts/campaign-visual-evidence.ps1'
    target = [ordered]@{
      commitSha = $TargetSha
      shortSha = $shortSha
      repo = 'llbz510/rain'
      checkoutRef = $env:GITHUB_REF
      runId = $env:GITHUB_RUN_ID
      runAttempt = $env:GITHUB_RUN_ATTEMPT
    }
    viewport = [ordered]@{
      width = $viewportWidths[0]
      height = $viewportHeights[0]
      devicePixelRatio = $devicePixelRatios[0]
      windowState = 'default (native Tauri window from src-tauri/tauri.conf.json; size not modified)'
      observedWidths = $viewportWidths
      observedHeights = $viewportHeights
      observedDevicePixelRatios = $devicePixelRatios
    }
    host = [ordered]@{
      os = [ordered]@{ caption = [string]$osInfo.Caption; version = [string]$osInfo.Version; build = [string]$osInfo.BuildNumber }
      webview2 = [ordered]@{ runtimeVersion = $runtimeVersion; driverVersion = $driverVersionForManifest }
      app = [ordered]@{ productName = [string]$tauriConfig.productName; productVersion = [string]$tauriConfig.version; binaryPath = 'src-tauri/target/debug/rain.exe' }
      driver = [ordered]@{ tauriDriver = $tauriDriverVersion }
    }
    tolerance = $tolerance
    toleranceBasis = $toleranceBasis
    coverage = [ordered]@{
      tested = $testedIds
      untested = $untestedIds
      reserved = @('VC-18')
      note = '未测项一律视为未取得证据，不得用「其余看起来一致」推断通过（§3.4）。'
      scopeNote = '被列为已测的编号，其**本轮实测到的维度**以 records[].criterion 为准（每条记录只声明它自己测的那一维）；未被任何记录覆盖的维度视为未测。VC-15④ 只测本轮可达的顶栏 40 与目录横条 80。留给 V1b 的维度：' + $deferredList
    }
    screenshots = $screenshotNames
    records = $recordRefs
    accentSweeps = @(Get-AccentSweeps | ForEach-Object { [ordered]@{ id = $_.id; vc = $_.vc; page = $_.page; selectorScope = $_.selectorScope; accentToken = $_.accentToken } })
    verdicts = [ordered]@{
      issued = $false
      issuedBy = $null
      note = '本证据包只提供 §3.4 第 1–3 项（输入侧）；第 4 项逐条 pass/needs_revision 与差值由独立视觉审查员（V2）对目标提交判定。采集方不签发结论。'
    }
    attachments = [ordered]@{ screenshotBytes = [ordered]@{} }
  }
  foreach ($name in $screenshotNames) {
    $manifest.attachments.screenshotBytes[$name] = (Get-Item -LiteralPath (Join-Path $packageRoot $name)).Length
  }
  [System.IO.File]::WriteAllText(
    (Join-Path $packageRoot 'manifest.json'),
    (ConvertTo-Json -InputObject $manifest -Depth 12),
    [System.Text.UTF8Encoding]::new($false)
  )

  # 采集侧自检：用同一个校验器裁判自己刚写的包（缺字段/不自洽会当场失败，不产出坏包）。
  $phase = 'self-validate'
  & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'validate-visual-evidence.ps1') -EvidenceRoot $packageRoot
  if ($LASTEXITCODE -ne 0) { throw "The collector's own evidence package failed validate-visual-evidence.ps1 (exit $LASTEXITCODE)." }

  Write-Output 'VISUAL_EVIDENCE_COLLECTED'
  Write-Output ("package=" + $packageRoot)
  Write-Output ("target=" + $TargetSha)
  Write-Output ("tested=" + ($testedIds -join ','))
  Write-Output ("untested=" + ($untestedIds -join ','))
  Write-Output ("records=" + $allRecords.Count + " screenshots=" + $screenshotNames.Count)
} catch {
  $primaryError = $_
} finally {
  Close-WebDriverSession $sessionId
  if ($driverProcess -and -not $driverProcess.HasExited) {
    Stop-Process -Id $driverProcess.Id -Force -ErrorAction SilentlyContinue
    $driverProcess.WaitForExit(5000) | Out-Null
  }
  if ($primaryError) {
    Write-Warning ("visual evidence collection failed in phase '" + $phase + "': " + $primaryError.Exception.Message)
  }
  if (Test-Path -LiteralPath $runRoot) {
    $resolvedRunRoot = [System.IO.Path]::GetFullPath($runRoot)
    $safePrefix = $temporaryRoot.TrimEnd('\') + '\rain-visual-evidence-run-'
    if (-not $resolvedRunRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove unexpected visual evidence run directory: $resolvedRunRoot"
    }
    if ($primaryError) {
      # 失败时**保留**临时目录（含 tauri-driver 日志与隔离数据库），供首次托管运行排障——
      # 与既有 E2E 脚本"失败留脱敏诊断"的做法一致。本通道不读取任何 API key/用户数据，
      # 该目录只含驱动日志与隔离库；它不会被自动上传，清理由 runner 回收。
      Write-Warning ("visual evidence run directory retained for diagnosis: " + $resolvedRunRoot)
    } else {
      Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}
if ($primaryError) {
  if ($null -ne $packageRoot -and (Test-Path -LiteralPath $packageRoot)) {
    Write-Warning ("partial package left in place for diagnosis: " + $packageRoot)
  }
  throw $primaryError
}
