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
  [switch]$SkipBuild,
  [switch]$SkipPreflightProbe
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Get-Item -LiteralPath (Split-Path -Parent $PSScriptRoot)).FullName
$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$runRoot = Join-Path $temporaryRoot ("rain-visual-evidence-run-" + [Guid]::NewGuid().ToString('N'))
$runRoot = (New-Item -ItemType Directory -Path $runRoot).FullName
# 驱动日志**按模式分文件**。Start-Process 的重定向会覆盖目标文件，三个模式共用同一个名字时
# 只有最后一个模式的日志尾巴能进 failure.json —— 而这套采集器的全部意义就是留下可诊断的失败现场。
# 这两个变量是"缺省值"，会被 Start-VisualEvidenceDriver 按模式覆盖成
# tauri-driver.<mode>[.err].log（文件落在 $runRoot，不在证据包内；失败时按模式取 tail 写进 failure.json）。
$driverLog = Join-Path $runRoot 'tauri-driver.log'
$driverErrorLog = Join-Path $runRoot 'tauri-driver.err.log'
$driverLogDirectory = $runRoot
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
  // nonText 判据（边框色）的「前景」必须是**真的被画出来的那一边**的颜色：
  // 取 border-top-color 会踩到一个真实的坑——只有 border-bottom 的元素，其 top 边 style:none、
  // 计算值等于 currentColor（文字色），于是记录里报出的对比度（14.64:1）与它要判的边框色
  // （#6e7074 压面板 = 3.49:1）**毫无关系**，审查员若采信这个数就会得到相反结论。
  // 顺序：第一条被画出的边 → 被画出的轮廓 → 都没有时退回 border-top-color（此时记录本就该失败）。
  const sideNames = ['Top', 'Right', 'Bottom', 'Left'];
  let foregroundToken = style.color;
  let foregroundSource = 'getComputedStyle(color)';
  if (spec.nonText) {
    let picked = null;
    for (const side of sideNames) {
      if (style['border' + side + 'Style'] !== 'none' && (parseFloat(style['border' + side + 'Width']) || 0) > 0) {
        picked = { token: style['border' + side + 'Color'], source: 'getComputedStyle(border-' + side.toLowerCase() + '-color) [first painted border side]' };
        break;
      }
    }
    if (!picked && style.outlineStyle !== 'none' && (parseFloat(style.outlineWidth) || 0) > 0) {
      picked = { token: style.outlineColor, source: 'getComputedStyle(outline-color) [painted outline]' };
    }
    if (!picked) {
      picked = { token: style.borderTopColor, source: 'getComputedStyle(border-top-color) [no painted border or outline]' };
    }
    foregroundToken = picked.token;
    foregroundSource = picked.source;
  }
  const foreground = parseToken(foregroundToken);
  const foregroundRgb = foreground ? (foreground.alpha < 1 ? composite(foreground, resolved) : foreground.rgb.slice()) : null;
  const ratio = foregroundRgb ? contrastRatio(foregroundRgb, resolved.rgb) : null;
  // §3.2 的"按层合成到不透明底"口径对**每个颜色通道**都适用，不只是 fg/bg。
  // 边框/轮廓色此前**完全没有通道**：声明 --color-border 之类令牌的记录，实测值只散落在
  // computedStyle 文本里，校验器没有可校验的通道，于是被判"令牌解释不了实测值"
  // （run 36574308748 的 VC-02-settings-topbar-border）。这里把四边 + outline 显式记录成通道。
  const borderMeasured = {};
  const borderDeclaredComputed = {};
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    const key = 'border' + side + 'Color';
    const shortKey = 'border' + side.toLowerCase();
    // 与 fg 同一口径：取元素自身声明值，半透明时合成到不透明底上，再作为可校验通道。
    const parsed = parseToken(style[key]);
    // 解析失败**不许**拿合成底色冒充实测值：那会写出一条与真测值在结构上无法区分的自造通道。
    // 写 null（校验器会判"必须是 3 个通道"并当场失败），原始字符串仍留在 declaredComputed 供诊断。
    borderMeasured[shortKey] = parsed
      ? (parsed.alpha < 1 ? composite(parsed, resolved) : parsed.rgb.slice())
      : null;
    borderDeclaredComputed[shortKey] = style[key];
  }
  const outlineParsed = parseToken(style.outlineColor);
  const outlineMeasured = outlineParsed
    ? (outlineParsed.alpha < 1 ? composite(outlineParsed, resolved) : outlineParsed.rgb.slice())
    : null;
  // outline-style: none 时 outline-color 不参与渲染：仍记录，但显式标出"未渲染"，不假装测过。
  const outlineRendered = style.outlineStyle !== 'none';
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
      // 四边的 width/style 都要写进快照：`measured.border.rendered.<side>` 不能自证——
      // 校验器用它**交叉核对**（rendered=true 的边必须 width>0 且 style≠none），
      // 否则采集器一旦把 rendered 取自错误属性，整道门控会静默失效。
      borderRightWidth: style.borderRightWidth,
      borderRightStyle: style.borderRightStyle,
      borderBottomWidth: style.borderBottomWidth,
      borderBottomStyle: style.borderBottomStyle,
      borderLeftWidth: style.borderLeftWidth,
      borderLeftStyle: style.borderLeftStyle,
      // 轮廓的 style/width 同样必填：measured.outline.rendered 也是自报字段，必须能交叉核对
      // （与四边边框同一形态的旁路：声明"画了聚焦圈"却没有任何计算样式可对账）。
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
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
      // 本条判据测的**是哪个颜色角色**：把"这个令牌该出现在哪个通道"变成可校验的结构事实，
      // 而不是靠人读描述。校验器据此只在该角色的通道里找 declaredToken；角色与令牌通道不符即失败。
      // text=文字色 / background=底色 / border=边框色 / graphic=图形色（非文字非边框的着色）。
      role: spec.colorRole || (spec.nonText ? 'border' : 'text'),
      fg: {
        // 来源如实写出（nonText 记录取的是**第一条被画出的边/轮廓**，不再是固定的 border-top-color）。
        source: foregroundSource,
        declared: foregroundToken,
        rgba8: foregroundRgb,
        alpha: foreground ? foreground.alpha : null,
        composited: Boolean(foreground && foreground.alpha < 1),
      },
      bg: {
        source: 'composite(ancestor backgrounds over #ffffff; transparent layers skipped)',
        // §3.2：实测记录必须**先按层合成到不透明底色**再比较。校验器（Assert-DecomposedColour）
        // 要求 declared 与 rgba8 **都是**不透明值、且逐通道相差 ≤ ±1。
        // 早先 declared 放的是元素自己的 style.backgroundColor：元素背景透明时它就是 rgba(0, 0, 0, 0)，
        // 于是合成做对了、declared 没跟上 —— 8 条记录在托管 self-validate 被判失败
        // （run 36574308748：'底色声明 rgba(0, 0, 0, 0) 不是不透明值'）。
        // 现在 declared 就是合成结果本身；元素自己的原始计算值另存 declaredComputed 以备追溯。
        declared: 'rgb(' + resolved.rgb[0] + ', ' + resolved.rgb[1] + ', ' + resolved.rgb[2] + ')',
        declaredComputed: style.backgroundColor,
        rgba8: resolved.rgb,
        alpha: 1,
        composited: true,
        layers: layers,
      },
      // 边框/轮廓：四边 + outline 各自一个**合成后**的通道，与 bg/fg 同一口径。
      // 声明边框令牌的判据（VC-02 的 *-border-*、VC-03 的 *-border）靠这些通道才可校验。
      border: {
        source: 'composite(own border color over the composited backdrop; §3.2)',
        rgba8: borderMeasured,
        declaredComputed: borderDeclaredComputed,
        rendered: {
          top: style.borderTopStyle !== 'none',
          right: style.borderRightStyle !== 'none',
          bottom: style.borderBottomStyle !== 'none',
          left: style.borderLeftStyle !== 'none',
        },
      },
      outline: {
        source: 'composite(own outline color over the composited backdrop; §3.2)',
        rgba8: outlineMeasured,
        declaredComputed: style.outlineColor,
        style: style.outlineStyle,
        widthPx: parseFloat(style.outlineWidth) || 0,
        // outline-style 为 none 时该通道未参与渲染：如实标注，不用它冒充"测过"。
        rendered: outlineRendered,
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

function Add-Fact([string]$Name, $Value) {
  # 关键阶段的实测事实（成功/失败都写进证据包或诊断），避免只能靠残缺日志猜。
  $script:facts[$Name] = $Value
}

function Get-WebView2RuntimePremise([string]$AppBinary) {
  # 「有前提的降级」的前提本体。**顶层函数**：finally 也会调用它，而放进主 try 会让
  # $ErrorActionPreference = 'Stop' 下的调用变成终止性 CommandNotFoundException，
  # 从而吞掉 failure.json —— 与两个驱动函数是同一个坑。
  #
  # 前提：WebView2 Evergreen 运行时是**机器级**属性，同一主机上所有用 Evergreen 的应用共用一份
  # 运行时。因此"预检那次读数"与"采集会话的读数"在同一台机器上指的是同一个运行时版本。
  # 推翻它的唯一情形是应用旁边带了**随包固定版本**的运行时（那时版本钉在某一份副本上，
  # 与机器级安装无关）。两条同时成立，前提才成立；否则如实写"未成立"，不许当成等价替代。
  # workflow 装 msedgedriver 时读的就是这里扫的同一个目录（见 visual-evidence.yml）。
  $evergreenRoots = @()
  if (${env:ProgramFiles(x86)}) { $evergreenRoots += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application') }
  if ($env:ProgramFiles) { $evergreenRoots += (Join-Path $env:ProgramFiles 'Microsoft\EdgeWebView\Application') }
  $evergreenVersions = @()
  foreach ($root in $evergreenRoots) {
    if (Test-Path -LiteralPath $root) {
      $evergreenVersions += @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
        ForEach-Object { $_.Name })
    }
  }
  $evergreenVersions = @($evergreenVersions | Sort-Object -Unique)
  $candidates = @($env:RAIN_E2E_FIXED_RUNTIME_DIR)
  if (-not [string]::IsNullOrWhiteSpace($AppBinary)) { $candidates += (Split-Path -Parent $AppBinary) }
  $fixedRuntimeNearby = @()
  foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
    $probe = Join-Path $candidate 'Microsoft.WebView2.FixedVersionRuntime'
    if (Test-Path -LiteralPath $probe) { $fixedRuntimeNearby += $probe }
  }
  $machineLevelPresent = $evergreenVersions.Count -gt 0
  $fixedPresent = $fixedRuntimeNearby.Count -gt 0
  $established = ($machineLevelPresent -and -not $fixedPresent)
  $statement = 'PREMISE NOT ESTABLISHED: cannot show that this host shares one Evergreen runtime; treat the runtime version binding as a declared downgrade only'
  if ($established) {
    $statement = 'machine-level Evergreen install present and no fixed-version runtime alongside the app: a same-host reading is the same runtime'
  }
  return [ordered]@{
    machineLevelEvergreenPresent = $machineLevelPresent
    fixedVersionRuntimePresent = $fixedPresent
    evergreenRuntimeVersions = $(if ($machineLevelPresent) { $evergreenVersions -join ',' } else { '(none found on this host)' })
    established = $established
    statement = $statement
  }
}

function Get-DiagnosticTail([string]$Path, [int]$Lines = 60) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) { return '(no log file)' }
  try {
    return ((Get-Content -LiteralPath $Path -Tail $Lines -ErrorAction Stop) -join [Environment]::NewLine)
  } catch {
    return ('(could not read ' + $Path + ': ' + $_.Exception.Message + ')')
  }
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
  $body = @{
    capabilities = @{ alwaysMatch = @{ browserName = 'wry'; 'tauri:options' = @{ application = $ApplicationPath } } }
  }
  try {
    $response = Invoke-WebDriver 'Post' '/session' $body
  } catch {
    # 把驱动的**完整响应体**留下来：msedgedriver 的真实原因在响应 JSON 里，而 PowerShell 默认只报
    # "The remote server returned an error: (500) Internal Server Error"。前两次托管运行正是因为
    # 丢了这段，只能靠猜。
    $detail = $_.Exception.Message
    try {
      if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $detail = $reader.ReadToEnd()
        $reader.Close()
      }
    } catch { }
    throw ('WebDriver session creation failed for ' + $ApplicationPath + ' | response: ' + $detail)
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
    @{ id = 'VC-01-list-body-bg'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'video-list'; selector = 'body'; description = 'VC-01② 实测背景类颜色的相对亮度'; scope = 'element'; colorRole = 'background' },
    @{ id = 'VC-01-list-page-bg'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'video-list'; selector = '[data-testid="video-list-page"]'; description = 'VC-01② 页面根容器背景'; scope = 'element'; colorRole = 'background' },
    @{ id = 'VC-01-list-topbar'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'video-list'; selector = '[data-testid="video-list-page"] header'; description = 'VC-01② 顶栏背景'; scope = 'element'; colorRole = 'background' },
    @{ id = 'VC-02-list-bg-token'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'video-list'; selector = '[data-testid="video-list-page"]'; description = ('VC-02 深底套 --color-bg 实测值，冻结值 ' + $frozen.dark.bg); scope = 'element'; declaredToken = '--color-bg'; declaredTokenValue = $frozen.dark.bg; colorRole = 'background' },
    @{ id = 'VC-02-list-topbar-surface'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'video-list'; selector = '[data-testid="video-list-page"] header'; description = ('VC-02 深底套 --color-surface 实测值，冻结值 ' + $frozen.dark.surface); scope = 'element'; declaredToken = '--color-surface'; declaredTokenValue = $frozen.dark.surface; colorRole = 'background' },
    @{ id = 'VC-02-list-import-button'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'video-list'; selector = '[data-testid="video-list-page"] header button'; description = ('VC-02 主按钮取该套面板色（描边款；--color-surface 冻结值 ' + $frozen.dark.surface + '）'); scope = 'element'; declaredToken = '--color-surface'; declaredTokenValue = $frozen.dark.surface; colorRole = 'background' },
    @{ id = 'VC-02-list-border-token'; vc = 'VC-02'; criterion = 'neutralScaleBorderToken'; page = 'video-list'; selector = '[data-testid="video-list-page"] header input[type="text"]'; description = ('VC-02 深底套 1px 边框令牌实测（--color-border 冻结值 ' + $frozen.dark.border + '）'); nonText = $true; scope = 'element'; declaredToken = '--color-border'; declaredTokenValue = $frozen.dark.border; colorRole = 'border' },
    @{ id = 'VC-03-list-import-button'; vc = 'VC-03'; criterion = 'primaryButtonOutlinedText'; page = 'video-list'; selector = '[data-testid="video-list-page"] header button'; description = ('VC-03② 描边款文字 = --color-fg ' + $frozen.dark.fg + '（对底 12.32:1）'); scope = 'element'; declaredToken = '--color-fg'; declaredTokenValue = $frozen.dark.fg; colorRole = 'text' },
    @{ id = 'VC-03-list-import-button-border'; vc = 'VC-03'; criterion = 'primaryButtonOutlinedBorder'; page = 'video-list'; selector = '[data-testid="video-list-page"] header button'; description = ('VC-03② 描边款边框 1px = --color-border ' + $frozen.dark.border + '（对底 4.80:1）'); nonText = $true; scope = 'element'; declaredToken = '--color-border'; declaredTokenValue = $frozen.dark.border; colorRole = 'border' },
    @{ id = 'VC-03-list-import-button-focus-ring'; vc = 'VC-03'; criterion = 'focusRing2pxDashedFg'; page = 'video-list'; selector = '[data-testid="video-list-page"] header button'; description = 'VC-03④ 聚焦圈：程序化 focus 后的实测 outline/border + 是否匹配 :focus-visible（键盘 Tab 路径属 V1b）'; focus = $true; scope = 'element'; colorRole = 'graphic' },
    @{ id = 'VC-12-list-topbar-title'; vc = 'VC-12'; criterion = 'fontStackWeightSizeOnTopbarTitle'; page = 'video-list'; selector = '[data-testid="video-list-page"] header > span'; description = 'VC-12①②③ 顶栏标题的字体族/字重/字号 + 文本对比（仅该元素实测；全页面清点属 V1b）'; scope = 'element'; colorRole = 'text' },
    @{ id = 'VC-15-list-topbar-height'; vc = 'VC-15'; criterion = 'keyHeightTopbar40'; page = 'video-list'; selector = '[data-testid="video-list-page"] header'; description = 'VC-15④ 顶栏高度 40'; scope = 'element'; colorRole = 'nonColour' },
    @{ id = 'VC-15-list-control-radius'; vc = 'VC-15'; criterion = 'radiusLadder'; page = 'video-list'; selector = '[data-testid="video-list-page"] header button'; description = 'VC-15② 圆角必须取自冻结阶梯 0/4/8/12/胶囊'; scope = 'element'; colorRole = 'nonColour' },
    @{ id = 'VC-15-list-control-spacing'; vc = 'VC-15'; criterion = 'spacingLadder'; page = 'video-list'; selector = '[data-testid="video-list-page"] header button'; description = 'VC-15① 间距只取 4/8/12/16/20/24/32/48（该元素的 padding/margin 与子元素间隙实测）'; scope = 'element'; colorRole = 'nonColour' },
    @{ id = 'VC-15-list-main-shadow'; vc = 'VC-15'; criterion = 'cardNoShadow'; page = 'video-list'; selector = '[data-testid="video-list-page"] main'; description = 'VC-15③ 卡片区不得有阴影（实测 box-shadow；卡片刻意不用阴影分层）'; scope = 'element'; colorRole = 'nonColour' },
    @{ id = 'VC-15-list-spacing-ladder-tokens'; vc = 'VC-15'; criterion = 'spacingLadderTokens'; page = 'video-list'; selector = ':root'; description = 'VC-15① 间距阶梯令牌解析值必须是 4/8/12/16/20/24/32/48 且只有这 8 档'; scope = 'rootTokens' },
    @{ id = 'VC-15-list-radius-ladder-tokens'; vc = 'VC-15'; criterion = 'radiusLadderTokens'; page = 'video-list'; selector = ':root'; description = 'VC-15② 圆角阶梯令牌解析值必须是 0/4/8/12/胶囊 五档'; scope = 'rootTokens' },
    @{ id = 'VC-12-list-font-size-ladder-tokens'; vc = 'VC-12'; criterion = 'fontSizeLadderTokens'; page = 'video-list'; selector = ':root'; description = 'VC-12③ 字号阶梯令牌解析值必须只有 18/16/14/13/12 五档'; scope = 'rootTokens' }
  )
}

function Get-SettingsSpecs {
  return @(
    @{ id = 'VC-01-settings-bg'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'settings'; selector = '[data-testid="settings-page"]'; description = 'VC-01② 设置页根背景'; scope = 'element'; colorRole = 'background' },
    @{ id = 'VC-01-settings-topbar'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'settings'; selector = '[data-testid="settings-page"] > div'; description = 'VC-01② 设置页顶栏背景'; scope = 'element'; colorRole = 'background' },
    @{ id = 'VC-02-settings-bg-token'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'settings'; selector = '[data-testid="settings-page"]'; description = ('VC-02 浅底套 bg 实测值，冻结值 ' + $frozen.light.bg); scope = 'element'; declaredToken = 'COLORS.bg'; declaredTokenValue = $frozen.light.bg; colorRole = 'background' },
    @{ id = 'VC-02-settings-topbar-panel'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'settings'; selector = '[data-testid="settings-page"] > div'; description = ('VC-02 浅底套 panel 实测值，冻结值 ' + $frozen.light.panel); scope = 'element'; declaredToken = 'COLORS.panel'; declaredTokenValue = $frozen.light.panel; colorRole = 'background' },
    @{ id = 'VC-02-settings-add-model'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'settings'; selector = '[data-testid="add-model"]'; description = 'VC-02 浅底套主按钮面板色（描边款）'; scope = 'element'; declaredToken = 'COLORS.panel'; declaredTokenValue = $frozen.light.panel; colorRole = 'background' },
    @{ id = 'VC-02-settings-topbar-muted'; vc = 'VC-02'; criterion = 'neutralScaleMutedToken'; page = 'settings'; selector = '[data-testid="settings-page"] > div > span + span'; description = ('VC-02 浅底套次要文字实测（COLORS.muted 冻结值 ' + $frozen.light.muted + '）'); scope = 'element'; declaredToken = 'COLORS.muted'; declaredTokenValue = $frozen.light.muted; colorRole = 'text' },
    @{ id = 'VC-02-settings-topbar-border'; vc = 'VC-02'; criterion = 'neutralScaleToken'; page = 'settings'; selector = '[data-testid="settings-page"] > div'; description = ('VC-02/VCGAP-20 浅底套 1px 边框令牌实测（COLORS.border 冻结值 ' + $frozen.light.border + '）'); nonText = $true; scope = 'element'; declaredToken = 'COLORS.border'; declaredTokenValue = $frozen.light.border; colorRole = 'border' },
    @{ id = 'VC-03-settings-add-model'; vc = 'VC-03'; criterion = 'primaryButtonOutlinedText'; page = 'settings'; selector = '[data-testid="add-model"]'; description = ('VC-03② 浅底套描边款文字 = COLORS.fg ' + $frozen.light.fg + '（对底 14.64:1）'); scope = 'element'; declaredToken = 'COLORS.fg'; declaredTokenValue = $frozen.light.fg; colorRole = 'text' },
    @{ id = 'VC-03-settings-add-model-border'; vc = 'VC-03'; criterion = 'primaryButtonOutlinedBorder'; page = 'settings'; selector = '[data-testid="add-model"]'; description = ('VC-03② 浅底套描边款边框 1px = COLORS.border ' + $frozen.light.border + '（对底 3.49:1）'); nonText = $true; scope = 'element'; declaredToken = 'COLORS.border'; declaredTokenValue = $frozen.light.border; colorRole = 'border' },
    @{ id = 'VC-12-settings-topbar-title'; vc = 'VC-12'; criterion = 'fontStackWeightSizeOnTopbarTitle'; page = 'settings'; selector = '[data-testid="settings-page"] > div > span'; description = 'VC-12①②③ 顶栏标题的字体族/字重/字号 + 文本对比（仅该元素实测；全页面清点属 V1b）'; scope = 'element'; colorRole = 'text' },
    @{ id = 'VC-15-settings-topbar-height'; vc = 'VC-15'; criterion = 'keyHeightTopbar40'; page = 'settings'; selector = '[data-testid="settings-page"] > div'; description = 'VC-15④ 顶栏高度 40'; scope = 'element'; colorRole = 'nonColour' },
    @{ id = 'VC-15-settings-add-model-radius'; vc = 'VC-15'; criterion = 'radiusLadder'; page = 'settings'; selector = '[data-testid="add-model"]'; description = 'VC-15② 圆角必须取自冻结阶梯（S7 曾把阶梯外的 6 改回 8）'; scope = 'element'; colorRole = 'nonColour' },
    @{ id = 'VC-15-settings-add-model-spacing'; vc = 'VC-15'; criterion = 'spacingLadder'; page = 'settings'; selector = '[data-testid="add-model"]'; description = 'VC-15① 间距只取 4/8/12/16/20/24/32/48（该元素的 padding/margin 与子元素间隙实测）'; scope = 'element'; colorRole = 'nonColour' }
  )
}

function Get-StudySpecs {
  return @(
    @{ id = 'VC-01-study-root'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'study'; selector = '[data-testid="study-interface"]'; description = 'VC-01② 学习页根容器背景（实测合成后的不透明底色）'; scope = 'element'; colorRole = 'background' },
    @{ id = 'VC-01-study-body'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'study'; selector = 'body'; description = 'VC-01② 学习页 body 背景（级联来源）'; scope = 'element'; colorRole = 'background' },
    @{ id = 'VC-01-study-video-shell'; vc = 'VC-01'; criterion = 'backgroundLuminanceBelow0.05'; page = 'study'; selector = '[data-testid="video-zone-shell"]'; description = 'VC-01② 学习页视频区容器背景（实测合成后的不透明底色）'; scope = 'element'; colorRole = 'background' },
    @{ id = 'VC-03-study-rightpanel-tabbar'; vc = 'VC-03'; criterion = 'controlNoBrandAccent'; page = 'study'; selector = '[data-testid="study-interface"] > aside:last-of-type > div'; description = 'VC-03③ 右面板 Tab 条（aside:last-of-type = 右侧面板，不是左侧目录树）；本轮只测静态部分，激活态属 V1b'; scope = 'element'; colorRole = 'graphic' },
    @{ id = 'VC-04-study-paragraph-type-tokens'; vc = 'VC-04'; criterion = 'paragraphTypeToken'; page = 'study'; selector = ':root'; description = 'VC-04 段落类型彩字态**令牌解析值**（四个 --color-* 令牌；页面上的实际使用点与「第五种颜色」本轮不判，见 coverage scopeNote）'; scope = 'rootTokens' },
    @{ id = 'VC-15-study-catalogbar-height'; vc = 'VC-15'; criterion = 'keyHeightCatalogBar80'; page = 'study'; selector = '[data-testid="catalog-bar"]'; description = 'VC-15④ 目录横条高度 80'; scope = 'element'; colorRole = 'nonColour' },
    @{ id = 'VC-15-study-root-spacing'; vc = 'VC-15'; criterion = 'spacingLadder'; page = 'study'; selector = '[data-testid="study-interface"]'; description = 'VC-15① 间距只取 4/8/12/16/20/24/32/48（该元素的 padding/margin 与子元素间隙实测）'; scope = 'element'; colorRole = 'nonColour' }
  )
}

# VC-03①「不存在品牌强调色」是**全称否定**：单元素颜色测不出来，必须跨元素扫描。
# 每个入口页面各扫一次（root token 记录另附，见 manifest 的 accentSweeps）。
# ---- 驱动生命周期（与上面 20 个函数同处**脚本顶层**，绝不能放进主 try 体内）
# 这是一次真实回归的修复：把这两个函数定义在 try 体内时，$ErrorActionPreference = 'Stop'
# 会让"定义之前"的任何早期失败（TargetSha 校验 / Require-Command / npm build / tauri build /
# 二进制检查 / 版本探测）把 finally 里的 Stop-VisualEvidenceDriver 变成终止性的
# CommandNotFoundException —— finally 被中断，failure.json 不写，真正的首个错误被掩盖。
# 第六次运行之所以能拿到决定性现场，全靠 failure.json；所以这条必须守住。
function Start-VisualEvidenceDriver([string]$Mode, [int]$Port, [int]$NativePort, [switch]$ModeRestart) {
  # $Mode 是 run mode 本身（video-list / study-catalog），不再是拼出来的 phase 串：
  # 早先版本用 $Phase.Replace('driver-start-','') 反推模式，那让"自证"变得近乎恒真。
  # 注意：**不**在这里设 $phase —— 函数内的是局部变量，finally 读的是脚本级的那个，
  # 早先那行赋值是死代码，只会让人误以为失败阶段被它记录了。
  # 每模式一个端口：Invoke-WebDriver 读的是**脚本级** $DriverPort，所以必须用 $script: 显式回写
  # （直接写 $DriverPort = $Port 只会建一个局部变量：实测 inside=4461 / after=4460，
  #  而 Invoke-WebDriver 全程仍打 4460）。
  $script:DriverPort = $Port
  # 重启前必须先停掉上一个驱动。否则句柄被覆盖、旧驱动成为孤儿，下一个模式的会话会落到
  # **仍在运行的第一个驱动**上（带着上一个模式的环境）——正是本 slice 要修的故障的静默形态。
  # 注意：仅对**第 2 个及以后**的模式生效（$ModeRestart 由调用方按 index>0 传入），第一个模式没有"上一个"。
  if ($ModeRestart) {
    Stop-VisualEvidenceDriver
    Start-Sleep -Milliseconds 250
  }
  # 自证式前置条件：必须在 Start-Process **之前**。早先版本放在 Wait-WebDriver 之后，
  # 那时应用已经被拉起来了，检查再严也拦不住一次错误启动。
  if ([string]$env:RAIN_E2E_MODE -ne '1') {
    throw ('RAIN_E2E_MODE must be 1 before the driver starts; the app would not open a debug port. actual=' + [string]$env:RAIN_E2E_MODE)
  }
  if ([string]$env:RAIN_E2E_RUN_MODE -ne $Mode) {
    throw ('RAIN_E2E_RUN_MODE must equal the mode being collected before the driver starts: expected=' + $Mode + ' actual=' + [string]$env:RAIN_E2E_RUN_MODE)
  }
  if ([string]::IsNullOrWhiteSpace([string]$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS)) {
    throw 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is empty; the app would not open a debug port and the session could not be created.'
  }
  if ([string]::IsNullOrWhiteSpace([string]$env:RAIN_E2E_DB_PATH)) {
    throw ('RAIN_E2E_DB_PATH must be set before the driver starts. mode=' + $Mode)
  }
  # 每模式一份驱动日志，避免 Start-Process 覆盖导致只有最后一个模式有日志可看。
  $driverLog = Join-Path $driverLogDirectory ('tauri-driver.' + $Mode + '.log')
  $driverErrorLog = Join-Path $driverLogDirectory ('tauri-driver.' + $Mode + '.err.log')
  $script:driverLog = $driverLog
  $script:driverErrorLog = $driverErrorLog
  # tauri-driver 要求 --port 与 --native-port **必须不同**（本仓五个既有 E2E 全部成对错开：
  # 4444/4445、4454/4455、4456/4457、4458/4459、4474/4475，可作旁证）。
  # 早先版本按模式只用 +index 调 --port，于是第 2 个模式拿到 --port 4461 而 --native-port 恒为 4461
  # —— 两个端口撞成同一个值。
  # 【实测旁证】第 7 次托管运行正是在这一步失败：phase=driver-start-study-catalog、
  #   error="tauri-driver did not become ready on time."，而 mode 1（video-list，4460）成功建成会话并
  #   写出 33 条记录。也就是"两个端口相同 ⇒ 驱动起不来"已有一次真实观测。
  # 【仍未验证】tauri-driver 对 port == native-port 的**具体**反应（报错文本）本仓无实测，不作断言。
  # 这里在启动前硬断言，避免这个错误再次以"静默"的形式回来。
  if ($Port -eq $NativePort) {
    throw ('tauri-driver requires --port and --native-port to differ, but both are ' + [string]$Port + ' (mode=' + $Mode + ')')
  }
  $driverProcess = Start-Process -FilePath $tauriDriver -ArgumentList @(
    '--port', [string]$Port,
    '--native-port', [string]$NativePort,
    '--native-driver', $edgeDriver
  ) -RedirectStandardOutput $driverLog -RedirectStandardError $driverErrorLog -WindowStyle Hidden -PassThru
  $script:driverProcess = $driverProcess
  # 记下本次启动用的 --port，供兜底收尸按端口精确匹配（绝不按镜像名误杀并发 E2E）。
  if ($script:driverPorts -notcontains $Port) { $script:driverPorts += $Port }
  # 调试端口来自实际下发的 browser args，而不是某个硬编码常量：解析出来并记成事实，
  # 让"失败时探测哪个端口"与"实际下发的参数"同源（改端口时不会静默失效）。
  $driverDebugPort = Get-DriverDebugPort ([string]$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS)
  $script:driverDebugPort = $driverDebugPort
  Add-Fact 'driverDebugPort' $driverDebugPort
  Wait-WebDriver $Port
  if ($driverProcess.HasExited) {
    throw ('tauri-driver exited during startup with code ' + $driverProcess.ExitCode + '; see the driver log tail in this package')
  }
  # 这几个环境变量就是"驱动为什么拉不起会话"的第一现场：应用只有同时看到
  # RAIN_E2E_MODE=1 / RAIN_E2E_RUN_MODE 属于三个桌面模式 / browser args 非空，才会把参数交给
  # WebView2（src-tauri/src/e2e_config.rs:127-143）。第六次运行失败时 rainE2eRunModeEnv 读出空串。
  Add-Fact 'driverPhase' $phase
  Add-Fact 'driverRunMode' $Mode
  Add-Fact 'driverPort' $Port
  $script:driverLogFileByMode[$Mode] = $driverLog
  $script:driverLogTails[$Mode] = (Get-DiagnosticTail $driverLog)
  $script:driverErrorLogTails[$Mode] = (Get-DiagnosticTail $driverErrorLog)
  # 两种**已实际观测到**的会话失败形态必须能区分，否则下一次失败又要靠猜：
  #   (a) 第 1 次运行（run 36428443410）："session not created: DevToolsActivePort file doesn't exist"
  #       —— 当时驱动阶段的参数**带** --remote-debugging-port=9222。
  #   (b) 第 6 次运行（run 36513639206）：响应体为空、60s 无响应
  #       —— 当时驱动阶段的参数**不带**端口（本次修复已恢复为带端口）。
  # 这里把"应用侧到底有没有真的把调试端口开起来"变成一条独立可读的事实：会话失败时探测
  # 127.0.0.1:9222 的 /json/version。读到 → 端口是开的，故障在驱动/会话层；读不到 → 端口没开。
  # 注意：这只在会话失败路径上探测，正常路径不引入额外假设。
  Add-Fact 'driverProcessId' $driverProcess.Id
  Add-Fact 'driverAliveAfterReady' (-not $driverProcess.HasExited)
  Add-Fact 'webviewArgsEnv' ([string]$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS)
  Add-Fact 'rainE2eModeEnv' ([string]$env:RAIN_E2E_MODE)
  Add-Fact 'rainE2eRunModeEnv' ([string]$env:RAIN_E2E_RUN_MODE)
  Add-Fact 'rainE2eDbPathEnv' ([string]$env:RAIN_E2E_DB_PATH)
  Add-Fact 'rainE2eVideoPathEnv' ([string]$env:RAIN_E2E_VIDEO_PATH)
}
# 从 driver 阶段的 browser args 里取 --remote-debugging-port；取不到就退回 9222。
# 注意下面那个反斜杠是必需的（(\d+) 而不是 (d+)）：少一个反斜杠会让它匹配不到任何数字、
# 于是**永远**返回 9222，"从实际下发参数解析端口"这个性质就完全没实现。本仓实测踩过这个错。
function Get-DriverDebugPort([string]$BrowserArgs) {
  if (-not [string]::IsNullOrWhiteSpace($BrowserArgs)) {
    $match = [regex]::Match($BrowserArgs, '--remote-debugging-port=(\d+)')
    if ($match.Success) { return $match.Groups[1].Value }
  }
  return '9222'
}
# 应用运行的 WebView2 版本**只能**从 DevTools 的 /json/version 取，不能从 UA 取：
# WebView2 的 UA 里 Edg/ 段是**简化版本**（实测宿主上 UA = "…Edg/153.0.0.0"），
# 而 /json/version 的 Browser 段是**完整版本**（同一次运行实测 "Edg/153.0.4234.48"），
# 后者才与钉住的 msedgedriver 同源、可直接比对。用 UA 比对会把一个真实差异误报成
# "宿主版本对不上"（本轮 run 36565255218 就是这么红的）。
# 返回 $null（而不是空串或猜一个值）时由调用方决定怎么办：拿不到就必须显式失败，
# 绝不能把一个没读到版本的包当成有效证据。
function Get-WebView2RuntimeVersion([int]$Port) {
  $url = 'http://127.0.0.1:' + $Port + '/json/version'
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-RestMethod -Uri $url -TimeoutSec 3 -ErrorAction Stop
      $browser = [string]$response.Browser
      $match = [regex]::Match($browser, 'Edg/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)')
      if ($match.Success) { return $match.Groups[1].Value }
      if (-not [string]::IsNullOrWhiteSpace($browser)) {
        # 端点通了但 Browser 段不是预期的 Edg/<x.y.z.w>：如实报出原文，不要静默继续。
        Add-Fact 'devToolsBrowserUnexpected' $browser
        return $null
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  return $null
}
function Stop-VisualEvidenceDriver {
  if ($script:driverProcess -and -not $script:driverProcess.HasExited) {
    Stop-Process -Id $script:driverProcess.Id -Force -ErrorAction SilentlyContinue
    # WaitForExit 的返回值不能丢：超时意味着进程仍在，句柄一旦置空就再也收不回来（静默泄漏）。
    $exited = $script:driverProcess.WaitForExit(5000)
    if (-not $exited) { Add-Fact 'driverStopTimeout' 'tauri-driver did not exit within 5s after Stop-Process' }
  }
  $script:driverProcess = $null
  # 兜底：若驱动在句柄被记录**之前**就异常退出（例如 Start-Process 之后立刻失败），上面的分支
  # 覆盖不到它，那个进程会一直活着并占着端口。
  #
  # 收尸**只针对本次运行自己分配的那些端口**（按 Win32_Process 的命令行匹配 --port）。
  # 早先这里按**进程映像名**一概清理（而不是按端口匹配）：那会杀掉**同机并发**的兄弟 E2E 的驱动
  # （video-list / study-catalog / runtime-settings 都启动 tauri-driver），而本脚本开头恰恰声明
  # 端口与既有 E2E 错开就是为了便于并行——语义自相矛盾。按端口匹配才不越界。
  # 注意：msedgedriver 由 tauri-driver 管理，本兜底不单独处理它。
  try {
    $ownedPorts = @($script:driverPorts)
    if ($ownedPorts.Count -eq 0) {
      Add-Fact 'driverLeftoverReaped' 'skipped: this run allocated no driver port'
    } else {
      $leftover = @(Get-CimInstance Win32_Process -Filter "Name = 'tauri-driver.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $commandLine = [string]$_.CommandLine
        $hit = $false
        foreach ($ownedPort in $ownedPorts) {
                    # 词边界是必需的：兄弟进程命令行里的 '--native-port 4460' **包含**子串 '--port 4460'，
          # 没有边界就会把别人的驱动误判成自己的并杀掉。
          if ($commandLine -match ('(?<![\w-])--port\s+' + [string]$ownedPort + '(?=\s|$)')) { $hit = $true; break }
        }
        $hit
      })
      if ($leftover.Count -gt 0) {
        Add-Fact 'driverLeftoverReaped' ($leftover.Count.ToString() + ' tauri-driver process(es) on this run''s ports were still alive and got reaped')
        $leftover | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
      } else {
        Add-Fact 'driverLeftoverReaped' 'none'
      }
    }
  } catch {
    Add-Fact 'driverLeftoverReapError' $_.Exception.Message
  }
}

function Get-AccentSweeps {
  return @(
    @{ id = 'VC-03-list-accent-sweep'; vc = 'VC-03'; criterion = 'noBrandAccentAnywhere'; page = 'video-list'; selectorScope = '[data-testid="video-list-page"]'; accentToken = '#4a9eff'; description = 'VC-03① 视频列表页全页扫描：任何被渲染的底色/边框/轮廓/文字都不得等于 #4a9eff（±1/通道）' },
    @{ id = 'VC-03-settings-accent-sweep'; vc = 'VC-03'; criterion = 'noBrandAccentAnywhere'; page = 'settings'; selectorScope = '[data-testid="settings-page"]'; accentToken = '#4a9eff'; description = 'VC-03① 设置页全页扫描' },
    @{ id = 'VC-03-study-accent-sweep'; vc = 'VC-03'; criterion = 'noBrandAccentAnywhere'; page = 'study'; selectorScope = '[data-testid="study-interface"]'; accentToken = '#4a9eff'; description = 'VC-03① 学习页全页扫描' }
  )
}

# ---------------------------------------------------------------- 主流程
$tauriDriver = $null
$script:driverProcess = $null
$script:driverLog = $null
$script:driverErrorLog = $null
# 本次运行自己分配的驱动端口（每模式一个），以及从 browser args 解析出的调试端口。
$script:driverPorts = @()
$script:driverDebugPort = '9222'
# 每模式驱动日志的 tail，failure.json 会按模式全部带上（早先只留最后一个模式）。
$script:driverLogTails = [ordered]@{}
$script:driverErrorLogTails = [ordered]@{}
$script:driverLogFileByMode = [ordered]@{}
$sessionId = $null
$phase = 'bootstrap'
$primaryError = $null
$packageRoot = $null
$appBinary = $null
$evidenceId = $null
$script:facts = [ordered]@{}

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

  # RAIN_E2E_MODE 必须在**启动 tauri-driver 之前**设置：tauri-driver 会把它自己的环境传给被拉起的
  # rain.exe，而应用只有同时看到 RAIN_E2E_MODE=1 + RAIN_E2E_RUN_MODE∈{三个桌面模式} +
  # WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 才会给真实窗口加上远程调试参数
  # （src-tauri/src/e2e_config.rs:127-143 read_runtime_settings_webview_args_from_env）。
  # 首次托管运行（run 36428443410）就是因为在 Start-Process 之后才设这个变量。
  # 【注意不要过度解读】该次运行报的是 "session not created: DevToolsActivePort file doesn't exist"，
  # 但**不能**据此断言"变量顺序 ⇒ 端口打不开"：同一次运行驱动阶段的参数**是带 9222 的**，
  # 而第 5 次运行在 RUN_MODE 同样为空的情况下，预检照样读到了 9222（详见下面 driver-start 处的更正）。
  # 顺序是必修项（应用靠它决定模式与 DB 路径），但它**不是**端口开关。
  # 既有 run-study-catalog-e2e.ps1 是在 try 开头就设好这个变量，这里对齐它。
  $env:RAIN_E2E_MODE = '1'
  $env:RAIN_E2E_BUILD = '1'
  if ($env:RAIN_E2E_MODE -ne '1') { throw 'RAIN_E2E_MODE was not set to 1 before launching the app.' }

  $appBinary = Join-Path $repoRoot 'src-tauri\target\debug\rain.exe'
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
  if (-not (Test-Path -LiteralPath $appBinary)) { throw "Rain debug binary not found: $appBinary" }
  # 二进制事实只记一次（早先放在按模式启动的 helper 里，每个模式重复 Get-Item 并覆盖同名事实）。
  Add-Fact 'appBinary' $appBinary
  Add-Fact 'appBinaryBytes' (Get-Item -LiteralPath $appBinary).Length

  # 宿主信息（§3.4 第 1 项）。
  $osInfo = Get-CimInstance -ClassName Win32_OperatingSystem
  $tauriConfig = ConvertFrom-Json -InputObject ([System.IO.File]::ReadAllText((Join-Path $repoRoot 'src-tauri\tauri.conf.json'), [System.Text.UTF8Encoding]::new($false)))
  # tauri-driver 2.0.6 只接受 --port/--native-port/--native-host/--native-driver，**没有 --version**
  # （首次托管运行实测：报 "Error: unused arguments left: [--version]"）。所以版本从 cargo 的安装清单读。
  $tauriDriverVersion = 'unavailable'
  try {
    $installList = (& cargo install --list | Out-String)
    $match = [regex]::Match($installList, '(?m)^tauri-driver v([0-9][^\s:]*):')
    if ($match.Success) { $tauriDriverVersion = 'tauri-driver ' + $match.Groups[1].Value }
  } catch { }
  if ($tauriDriverVersion -eq 'unavailable') { Write-Warning 'could not determine the tauri-driver version from cargo install --list' }

  $phase = 'driver-start'
  # ---- 为什么驱动要"每模式各自启动"，以及本文件此前两处结论的更正
  #
  # 【仍然成立・必修】驱动进程只在**启动那一刻**快照继承环境，再原样传给被拉起的 rain.exe。
  # 而 RAIN_E2E_RUN_MODE / RAIN_E2E_DB_PATH / RAIN_E2E_VIDEO_PATH 原先写在**每模式循环内部**，
  # 即在 Start-Process **之后**才赋值，于是应用看到的 RUN_MODE 是空串
  # （第六次运行 run 36513639206 的 failure.json 实测：observed.rainE2eRunModeEnv = ""）。
  # 应用侧 src-tauri/src/e2e_config.rs:131-138 要求**同时**满足三个条件才把 browser args 交给 WebView2：
  #   RAIN_E2E_MODE == "1"
  #   && RAIN_E2E_RUN_MODE ∈ {"runtime-settings","video-list","study-catalog"}
  #   && WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 非空
  # RUN_MODE 为空时该函数直接返回 None，lib.rs:35 便不改写 window.additional_browser_args。
  #
  # 【未验证】该分支**之后**应用会怎样（进哪个模式、DB 路径取什么、界面是否可渲染）本脚本没有实测
  # 证据，因此**不得**据此断言"这本身就足以让采集失败"——那只是推断，不是结论。
  # 已确证的只有两件：① 应用确实收不到 RUN_MODE（第六次运行 failure.json 实测为空串）；
  # ② 应用需要它来决定模式与 DB 路径（源码 e2e_config.rs 可读）。
  # 修法：遍历模式时先把环境赋好，再按模式启动驱动。
  #
  # 【已撤回】此前这里写着"RUN_MODE 为空 ⇒ WebView2 不开调试端口 ⇒ DevToolsActivePort 不存在"。
  # 那是**过度解读**，现予撤回。依据如下：
  #   (a) 出错的那一次（第六次 run 36513639206）的错误**不是** DevToolsActivePort，而是响应体为空、
  #       60s 无响应（该 run 的 job log 实测：DevToolsActivePort 与 session not created 各出现 0 次）。
  #       用第 1 次运行的 DevToolsActivePort 去解释第 6 次的失败，属于张冠李戴，已删除该引用。
  #   (b) 机理上不成立：WebView2 **自己**读 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS，不经过应用的
  #       lib.rs:35；lib.rs:35 只是在 RUN_MODE 合法时**改写** additional_browser_args，
  #       缺 RUN_MODE 时保持 tauri.conf 缺省，并不阻断 WebView2 读该环境变量
  #       （WebView2 独立读取该变量属其既有行为）。
  # 【上一个版本在这里引用了第五次运行的预检作为反证，那是**混淆进程**的假证据，已更正】
  #   第五次运行的预检**自己显式设了** RAIN_E2E_RUN_MODE='video-list'（见下面预检段的 $probeEnv），
  #   它是该次运行里唯一 RUN_MODE 非空的进程，因此**不能**用它证明"RUN_MODE 为空时端口照样开"。
  # 结论不变：RUN_MODE 顺序是必修项（模式与 DB 路径），但**不是**端口开关。
  #
  # 【已推翻】第五次运行据此把驱动阶段参数改成"不带固定端口"的版本，那个结论是错的：
  # 去掉 --remote-debugging-port 后，应用拿到的是 "--enable-features=... --disable-gpu ..."，
  # 其中没有任何东西会打开调试端口（应用自己从不添加端口），会话同样拉不起来。
  # 端口选择权不在驱动手里：应用侧怎么配，WebView2 就怎么开，msedgedriver 按该端口接入。
  # 驱动阶段因此沿用 workflow 级的值（与三个已通过的桌面 E2E 同源，见 video-list-desktop-e2e.yml:38 /
  # study-catalog:43 / runtime:23），只在缺失时退回同一份带端口缺省值。
  #
  # 【仍未解释・不得声称已解决】第一次运行 run 36428443410 用的**正是**这份带端口配置，而它失败了
  # （"session not created: DevToolsActivePort file doesn't exist"，见 job log 原文）。
  # "同样的配置这次为何能过"目前无法解释，因此本文件**不声称**恢复端口必然能通过。
  # 可做的只有把失败形态变成可判定的：会话失败时探测 127.0.0.1:9222/json/version，
  # 结果写进 failure.json 的 failureTimeDevToolsEndpoint（见下面 finally）。
  $driverPhaseWebViewArgs = [string]$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  if ([string]::IsNullOrWhiteSpace($driverPhaseWebViewArgs)) {
    $driverPhaseWebViewArgs = '--remote-debugging-port=9222 --enable-features=msEdgeDevToolsWdpRemoteDebugging --disable-gpu --no-sandbox --disable-dev-shm-usage'
    Write-Warning 'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS was empty; falling back to the value used by the passing desktop E2E suites.'
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $driverPhaseWebViewArgs
  }
  Add-Fact 'driverPhaseWebViewArgs' $driverPhaseWebViewArgs
  Write-Output ('driver phase WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=' + $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS)
  # 驱动**不在这里**启动：每个 run mode 需要各自的 RAIN_E2E_RUN_MODE / DB_PATH / VIDEO_PATH，
  # 而驱动只在启动那一刻继承环境。见下面遍历 $runPlan 处的 Start-VisualEvidenceDriver。

  # 预检：用**与 WebDriver 启动应用时相同的环境**直接拉起一次 rain.exe，确认它自己会照 e2e_config.rs
  # 的规则给 WebView2 传远程调试参数（也就是会生成 DevToolsActivePort）。
  # 这一步把"应用没进 E2E 模式"与"驱动/会话层的问题"分开——前两次托管运行正是因为没做这一步，
  # 只能在 60s 超时后看到一句 DevToolsActivePort，无从判断是哪一侧的错。
  if (-not $SkipPreflightProbe) {
    $phase = 'preflight-app-debug-port'
    $probeProcess = $null
    $savedEnv = @{}
    try {
      # 关键：**不设置 WEBVIEW2_USER_DATA_FOLDER** —— 那会让这次启动与 WebDriver 的启动方式不可比
      # （WebView2 会在全新目录里工作，DevToolsActivePort 落在别处）。这里改为在 PATH 前面放一个
      # "影子 msedgedriver"：WebView2 只要真的收到 --remote-debugging-port，就会尝试启动名为
      # msedgedriver 的浏览器驱动；那份包装脚本会把收到的参数记下来，从而证明"应用有没有真的把
      # 调试参数传给 WebView2"，同时不启动真实驱动。
      $shadowDir = Join-Path $runRoot 'preflight-shadow'
      New-Item -ItemType Directory -Path $shadowDir -Force | Out-Null
      $capturePath = Join-Path $runRoot 'preflight-webview2-args.txt'
      $shadowCmd = Join-Path $shadowDir 'msedgedriver.cmd'
      $shadowBody = '@echo off' + [Environment]::NewLine + 'echo %* > "' + $capturePath + '"' + [Environment]::NewLine
      [System.IO.File]::WriteAllText($shadowCmd, $shadowBody, [System.Text.ASCIIEncoding]::new())
      $probeEnv = @{
        RAIN_E2E_MODE = '1'
        RAIN_E2E_RUN_MODE = 'video-list'
        RAIN_E2E_DB_PATH = (Join-Path $runRoot 'preflight.db')
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = [string]$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
        PATH = $shadowDir + [System.IO.Path]::PathSeparator + $env:PATH
      }
      foreach ($key in $probeEnv.Keys) {
        $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $probeEnv[$key], 'Process')
      }
      $probeProcess = Start-Process -FilePath $appBinary -PassThru -WindowStyle Hidden
      $deadline = (Get-Date).AddSeconds(45)
      while (-not (Test-Path -LiteralPath $capturePath) -and (Get-Date) -lt $deadline -and -not $probeProcess.HasExited) {
        Start-Sleep -Milliseconds 250
      }
      if (-not $probeProcess.HasExited) {
        Add-Fact 'preflightProbeResult' 'app still running after 45s'
      } else {
        Add-Fact 'preflightProbeResult' ('app exited early with code ' + $probeProcess.ExitCode)
      }
      if (Test-Path -LiteralPath $capturePath) {
        Add-Fact 'preflightWebView2ArgsSeenByDriver' ((Get-Content -LiteralPath $capturePath -Raw).Trim())
      } else {
        Add-Fact 'preflightWebView2ArgsSeenByDriver' '(no msedgedriver launch observed within 45s — 该项依赖"影子驱动"能否被找到，不足为凭)'
      }
      Add-Fact 'preflightWebView2ArgsExpected' $probeEnv['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']
      # 最直接的判据（不依赖任何"影子驱动"假设）：应用若真的按 e2e_config.rs 的规则把
      # --remote-debugging-port=9222 交给了 WebView2，那么这个端口的 /json/version 应当可读。
      # 读到 → 应用侧接线是通的，故障在驱动/会话层；读不到 → 应用没把参数交到 WebView2。
      $devToolsUrl = 'http://127.0.0.1:9222/json/version'
      $devToolsBody = ''
      $devToolsDeadline = (Get-Date).AddSeconds(30)
      while ((Get-Date) -lt $devToolsDeadline) {
        try {
          $devToolsBody = [string](Invoke-RestMethod -Uri $devToolsUrl -TimeoutSec 3 -ErrorAction Stop | ConvertTo-Json -Compress)
          break
        } catch {
          Start-Sleep -Milliseconds 500
        }
      }
      if ([string]::IsNullOrWhiteSpace($devToolsBody)) {
        Add-Fact 'preflightDevToolsEndpoint' ('no response from ' + $devToolsUrl + ' within 30s')
      } else {
        Add-Fact 'preflightDevToolsEndpoint' $devToolsBody
        # 这个预检是**直接**拉起应用（不经 tauri-driver），因此能读到调试端口。实测发现
        # tauri-driver 拉起的应用**不开**这个端口（同一 env、同一二进制：run 36570207817 里
        # 预检读到 Edg/153.0.4234.48，而真正采集时 video-list 会话期间 9222 无响应）。
        # 于是把它作为"同主机同二进制"的兜底测量保存下来，并在 manifest 里如实标注来源；
        # 绝不用 UA 那个简化版本（它永远对不上钉住的驱动，见 run 36565255218 的教训）。
        $preflightMatch = [regex]::Match($devToolsBody, 'Edg/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)')
        if ($preflightMatch.Success) {
          $script:preflightRuntimeVersion = $preflightMatch.Groups[1].Value
          Add-Fact 'preflightWebView2RuntimeVersion' $preflightMatch.Groups[1].Value
        }
      }
    } catch {
      Add-Fact 'preflightProbeResult' ('probe threw: ' + $_.Exception.Message)
    } finally {
      if ($probeProcess -and -not $probeProcess.HasExited) {
        Stop-Process -Id $probeProcess.Id -Force -ErrorAction SilentlyContinue
        $probeProcess.WaitForExit(5000) | Out-Null
      }
      foreach ($key in $savedEnv.Keys) {
        [Environment]::SetEnvironmentVariable($key, $savedEnv[$key], 'Process')
      }
      # 预检把 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 换成了带端口的那份，上面按 $savedEnv 快照恢复即可。
      # （早先这里还有一句显式重设，与 $savedEnv 恢复重复：$probeEnv 取的就是同一个值。）
    }
    Write-Output ('preflight: result=' + $script:facts['preflightProbeResult'])
    Write-Output ('preflight: webview2 args seen by driver=' + $script:facts['preflightWebView2ArgsSeenByDriver'])
  }

  # 注意：RAIN_E2E_MODE 已在上面设好；而 RAIN_E2E_RUN_MODE / RAIN_E2E_DB_PATH / RAIN_E2E_VIDEO_PATH
  # 是**每模式不同**的，必须在遍历里、每次启动驱动**之前**赋值（见下面 foreach），不能在这里设死。
  $screenshotNames = @()
  $allRecords = @()
  $allMissing = @()
  $viewports = @()
  $runtimeVersions = @()
  # 每个模式的读数取自哪里（devtools / preflight-devtools）。写进 manifest，让"版本从哪来"可复核。
  $runtimeVersionSources = @()

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
    $phase = 'driver-start-' + $plan.mode
    $databasePath = Join-Path $runRoot ('rain-visual-' + $plan.mode + '.db')
    # 顺序至关重要：这三行必须在 Start-VisualEvidenceDriver **之前**。驱动只在启动那一刻继承环境，
    # 再原样传给被拉起的 rain.exe；写在 Start-Process 之后，应用看到的就是空 RUN_MODE（第六次运行实测）。
    # 只有 study-catalog 需要真实（合成）媒体路径；video-list 模式不读该变量，置空以免误用。
    if ($plan.mode -eq 'study-catalog') {
      $env:RAIN_E2E_VIDEO_PATH = $studyMediaPath
    } else {
      $env:RAIN_E2E_VIDEO_PATH = ''
    }
    # 每模式一对**互不相同**的端口：--port 与 --native-port 必须不同（tauri-driver 的硬要求），
    # 且不同模式之间也各自独立，避免停掉上一个驱动后复用同端口撞上 TIME_WAIT。
    $runModeIndex = [array]::IndexOf($runPlan, $plan)
    $modeDriverPort = $DriverPort + $runModeIndex
    $modeNativeDriverPort = $NativeDriverPort + $runModeIndex
    $env:RAIN_E2E_RUN_MODE = $plan.mode
    $env:RAIN_E2E_DB_PATH = $databasePath
    Start-VisualEvidenceDriver -Mode $plan.mode -Port $modeDriverPort -NativePort $modeNativeDriverPort -ModeRestart:($runModeIndex -gt 0)
    $phase = 'session-' + $plan.mode
    $sessionId = New-WebDriverSession $appBinary
    Wait-WebDriverCondition $sessionId 'the video list page' "return Boolean(document.querySelector('[data-testid=""video-list-page""]'));"
    # 宿主 WebView2 版本：**以 DevTools 的 /json/version 为准**，并与 workflow 钉住的
    # msedgedriver 版本核对。UA 只作为交叉参考（它的 Edg/ 段是简化版本，不能用来比对），
    # 记进 facts 便于事后核对两处是否一致。
    $userAgent = [string](Invoke-WebDriverScript $sessionId 'return navigator.userAgent;')
    $uaMatch = [regex]::Match($userAgent, 'Edg/([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)')
    if ($uaMatch.Success) { Add-Fact ('userAgentEdgVersion.' + $plan.mode) $uaMatch.Groups[1].Value }
    $runtimeVersionThisMode = Get-WebView2RuntimeVersion ([int]$script:driverDebugPort)
    $runtimeVersionSource = 'devtools'
    if ([string]::IsNullOrWhiteSpace($runtimeVersionThisMode) -and -not [string]::IsNullOrWhiteSpace([string]$script:preflightRuntimeVersion)) {
      # tauri-driver 拉起的应用不开调试端口时走这里：用预检那次**同主机同二进制**的 DevTools 读数。
      # 这不是猜：预检就是同一个 rain.exe、同一份 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 下的
      # 真实测量，只是那个进程不是驱动拉起来的。来源会如实写进 manifest 的 host 段。
      $runtimeVersionThisMode = [string]$script:preflightRuntimeVersion
      $runtimeVersionSource = 'preflight-devtools'
      Add-Fact ('runtimeVersionSource.' + $plan.mode) 'preflight-devtools (the app launched by tauri-driver did not expose the debug port)'
    }
    if ([string]::IsNullOrWhiteSpace($runtimeVersionThisMode)) {
      throw ('Could not read the WebView2 runtime version from the DevTools endpoint at http://127.0.0.1:' + $script:driverDebugPort + '/json/version (expected a Browser field of the form Edg/<x.y.z.w>) and the preflight measurement is unavailable too; the evidence package must bind to a real host version (§3.4 item 1). UA Edg token: ' + $(if ($uaMatch.Success) { $uaMatch.Groups[1].Value } else { '(none)' }))
    }
    if ($runtimeVersionSources -notcontains $runtimeVersionSource) { $runtimeVersionSources += $runtimeVersionSource }
    $runtimeVersions += $runtimeVersionThisMode

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
        # 注入脚本里凡是"JS 字符串里再嵌 CSS 属性选择器的双引号"都必须转义：直接用双引号包
        # `[data-testid^="card-"]` 会让 JS 字符串提前闭合（托管运行实测：probe-study 阶段报
        # `Invalid or unexpected token`）。这里用 JS 单引号包选择器，避免嵌套同种引号。
        $cardCount = [int](Invoke-WebDriverScript $sessionId 'return document.querySelectorAll(''[data-testid^="card-"] button'').length;')
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
  $expectedDriverVersion = $env:RAIN_E2E_WEBVIEW2_VERSION
  # 宿主版本必须**真的有值**：读不到 DevTools 的 Browser 段时不许把空串写进 manifest
  # 再让校验器在最后一步用一句含糊的话拒绝（t2 复核指出的现实风险）。这里当场说清缺什么。
  if ($runtimeVersionValues.Count -eq 0) {
    throw 'Could not read the WebView2 runtime version from the DevTools /json/version endpoint (expected a Browser field of the form Edg/<x.y.z.w>); the evidence package must bind to a real host version (§3.4 item 1).'
  }
  if ($runtimeVersionValues.Count -ne 1) {
    throw ('The app reported more than one WebView2 runtime version in this run (' + ($runtimeVersionValues -join ', ') + '); refusing to bind the package to an ambiguous host version.')
  }
  $runtimeVersion = [string]$runtimeVersionValues[0]
  $driverVersionForManifest = $runtimeVersion
  if (-not [string]::IsNullOrWhiteSpace($expectedDriverVersion)) {
    $driverVersionForManifest = $expectedDriverVersion
    if ($expectedDriverVersion -ne $runtimeVersion) {
      throw ("WebView2 runtime reported by DevTools /json/version ($runtimeVersion) does not match the pinned msedgedriver ($expectedDriverVersion); the host version would not explain this measurement.")
    }
  }
  if ($viewportWidths.Count -ne 1 -or $viewportHeights.Count -ne 1 -or $devicePixelRatios.Count -ne 1) {
    throw ("Sampled viewports are not identical within this run (widths=$($viewportWidths -join ',') heights=$($viewportHeights -join ',') dpr=$($devicePixelRatios -join ',')); the evidence package must bind to one viewport per §3.4.")
  }

  $phase = 'manifest'
  $recordRefs = @($allRecords | ForEach-Object { [ordered]@{ recordId = [string]$_.recordId; file = ('records/' + [string]$_.recordId + '.json') } })
  $manifest = [ordered]@{
    schemaVersion = 1
    evidenceId = $evidenceId
    # 包的**溯源**：这个包是真实采集产出的。把旧数据改写成新形状的"演练包"必须写 rehearsal，
    # 校验器据此在结尾改用不同措辞（形状一样，含义完全不同）。
    provenance = 'real-collector'
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
      webview2 = [ordered]@{ runtimeVersion = $runtimeVersion; driverVersion = $driverVersionForManifest; runtimeVersionSource = ($runtimeVersionSources -join ',') }
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
  # 版本来源含 preflight-devtools（**有前提的降级**）时，把前提本体一并写进**成功包**：
  # 只在 failure.json 里留痕是不够的——正好在"包有效"这种最需要自证绑定强度的时候，包会缺掉前提。
  # 校验器对此 fail-closed（缺 premise 或 established=false 都判失败）。
  if ($runtimeVersionSources -contains 'preflight-devtools') {
    $manifest.host.webview2.premise = Get-WebView2RuntimePremise $appBinary
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
    # 版本**来源**的降级前提：WebView2 Evergreen 运行时是**机器级**属性 —— 同一主机上所有使用
    # Evergreen 的应用共用同一份运行时。所以"预检那次读数"与"采集会话的读数"在同一台机器上指的是
    # 同一个运行时版本；这不是等价替代，而是有前提的降级，前提本身必须被验证并留痕。
    # 这里记录机器级 Evergreen 安装（workflow 装驱动时用的就是这个目录，见 visual-evidence.yml 的
    # 'Install matching WebView2 driver'），并确认**没有**随包固定版本的运行时：
    # 只有"机器级安装存在 + 应用目录里没有固定版本运行时"两条同时成立，该前提才成立。
    try {
      $premiseForFacts = Get-WebView2RuntimePremise $appBinary
      Add-Fact 'evergreenRuntimeVersions' $premiseForFacts.evergreenRuntimeVersions
      Add-Fact 'machineLevelEvergreenPresent' ([string]$premiseForFacts.machineLevelEvergreenPresent)
      Add-Fact 'fixedVersionRuntimePresent' ([string]$premiseForFacts.fixedVersionRuntimePresent)
      Add-Fact 'webview2VersionPremise' $premiseForFacts.statement
    } catch {
      Add-Fact 'webview2VersionPremise' ('could not inspect the WebView2 install: ' + $_.Exception.Message)
    }
  # 会话失败时补一条独立判据：应用有没有真的把调试端口开起来。这是把"响应体为空"与
  # "DevToolsActivePort 不存在"两种形态区分开的唯一现成手段（两者在失败日志里长得不一样，
  # 但只有这一条能说明端口到底开没开）。
  if ($primaryError) {
    try {
      # 端口取自实际下发的 browser args（见 Start-VisualEvidenceDriver 里的 Get-DriverDebugPort），
      # 不硬编码：否则改端口后这条判据会静默变成恒假。
      $dtPort = [string]$script:driverDebugPort
      $dtUrl = 'http://127.0.0.1:' + $dtPort + '/json/version'
      $dtProbe = [string](Invoke-RestMethod -Uri $dtUrl -TimeoutSec 3 -ErrorAction Stop | ConvertTo-Json -Compress)
      Add-Fact 'failureTimeDevToolsEndpoint' $dtProbe
    } catch {
      Add-Fact 'failureTimeDevToolsEndpoint' ('no DevTools endpoint on 127.0.0.1:' + [string]$script:driverDebugPort + ' at failure time')
    }
  }
  Close-WebDriverSession $sessionId
  Stop-VisualEvidenceDriver
  if ($primaryError) {
    Write-Warning ("visual evidence collection failed in phase '" + $phase + "': " + $primaryError.Exception.Message)
    # 失败诊断必须写进**证据包目录**：只有那里会被 workflow 上传，远端才能看到失败现场。
    # 前两次托管运行都因为没有这一步，只能靠 job 日志里残缺的行来猜（本函数是那次教训的产物）。
    try {
      if ($null -ne $packageRoot -and (Test-Path -LiteralPath $packageRoot)) {
        # 每个模式一个日志文件（见 Start-VisualEvidenceDriver），所以可以逐模式取回 tail。
        # 文件不存在时 Get-DiagnosticTail 会返回 '<no log file>'，不假装有内容。
        $perModeLogTails = [ordered]@{}
        $perModeErrorLogTails = [ordered]@{}
        foreach ($modeName in @($script:driverLogFileByMode.Keys)) {
          $perModeLogTails[$modeName] = (Get-DiagnosticTail ([string]$script:driverLogFileByMode[$modeName]))
          $perModeErrorLogTails[$modeName] = (Get-DiagnosticTail ([string]$script:driverLogFileByMode[$modeName]).Replace('.log', '.err.log'))
        }
        $diagnostics = [ordered]@{
          status = 'failed'
          phase = $phase
          error = [string]$primaryError.Exception.Message
          errorPosition = [string]$primaryError.InvocationInfo.PositionMessage
          targetSha = $TargetSha
          evidenceId = $evidenceId
          createdAt = [DateTimeOffset]::Now.ToString('o')
          packageRoot = $packageRoot
          runRoot = $runRoot
          appBinary = $appBinary
          commands = [ordered]@{ collector = 'scripts/campaign-visual-evidence.ps1' }
          environmentFacts = [ordered]@{
            RAIN_E2E_MODE = [string]$env:RAIN_E2E_MODE
            RAIN_E2E_RUN_MODE = [string]$env:RAIN_E2E_RUN_MODE
            RAIN_E2E_DB_PATH = [string]$env:RAIN_E2E_DB_PATH
            RAIN_E2E_VIDEO_PATH = [string]$env:RAIN_E2E_VIDEO_PATH
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = [string]$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
            RAIN_E2E_WEBVIEW2_VERSION = [string]$env:RAIN_E2E_WEBVIEW2_VERSION
            GITHUB_SHA = [string]$env:GITHUB_SHA
          }
          observed = $script:facts
          appBinaryExists = (Test-Path -LiteralPath $appBinary)
          # 逐模式读回各自的日志尾。早先这里只读脚本级标量 $driverLog —— 那是**最后一个**模式的
          # 日志，而按模式收集的三个集合被写进脚本级变量后全仓库没有任何读者，等于"每模式日志"
          # 这个修复没有落地（第三个模式之前就失败时看到的仍是最后一个模式）。现在真的写进 JSON。
          driverLogTail = (Get-DiagnosticTail $driverLog)
          driverErrorLogTail = (Get-DiagnosticTail $driverErrorLog)
          driverLogTails = $perModeLogTails
          driverErrorLogTails = $perModeErrorLogTails
          driverLogFiles = $script:driverLogFileByMode
        }
        [System.IO.File]::WriteAllText(
          (Join-Path $packageRoot 'failure.json'),
          (ConvertTo-Json -InputObject $diagnostics -Depth 12),
          [System.Text.UTF8Encoding]::new($false)
        )
        Write-Warning ('failure diagnostics written to ' + (Join-Path $packageRoot 'failure.json'))
      }
    } catch {
      Write-Warning ("could not write failure diagnostics: " + $_.Exception.Message)
    }
  }
  if (Test-Path -LiteralPath $runRoot) {
    $resolvedRunRoot = [System.IO.Path]::GetFullPath($runRoot)
    $safePrefix = $temporaryRoot.TrimEnd('\') + '\rain-visual-evidence-run-'
    if (-not $resolvedRunRoot.StartsWith($safePrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove unexpected visual evidence run directory: $resolvedRunRoot"
    }
    if (-not $primaryError) {
      Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}
if ($primaryError) {
  throw $primaryError
}
