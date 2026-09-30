import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * V1a「真实桌面视觉实测通道」的公开裁判（测试先行）。
 *
 * 本文件只裁判「采集通道与校验器」这一层：
 *   ① 合成色与 WCAG 2.1 对比度的**实算**（用真实数值，不许断言常量、不许恒真）；
 *   ② 缺必填字段必须**显式失败**（不许静默出空值）；
 *   ③ **只有截图、没有实测记录的证据包必须被判为「不构成裁判」**；
 *   ④ 证据包的形状必须与 `docs/development/visual-contract.md` §3.4 的第 1–4 项一一对应。
 *
 * 它**不签发任何 Visual Evidence、不判任何 `VC-xx` 的 pass/needs_revision、
 * 不改任何 AC 状态或 Evidence tier**——那些只能由独立视觉审查员（V2）对真实桌面实测做。
 */

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const validatorScript = join(repoRoot, 'scripts', 'validate-visual-evidence.ps1')
const collectorScript = join(repoRoot, 'scripts', 'campaign-visual-evidence.ps1')
const workflowFile = join(repoRoot, '.github', 'workflows', 'visual-evidence.yml')
const powershellTimeoutMs = 60_000

// 传给 PowerShell 的路径必须用正斜杠：把反斜杠"转义"成双反斜杠（D:\\dir\\file）会让
// Windows PowerShell 找不到文件，于是 AST 里一个 IfStatement 都没有、断言以"找不到端口守卫"
// 的形式失败——那是在**测量空气**。正斜杠在 Windows 上同样可用，且不需要任何转义。
const collectorScriptPathForPowerShell = collectorScript.replace(/\\/g, '/')
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/eylmE8AAAAASUVORK5CYII=',
  'base64',
)

// §4 的 18 个编号：VC-01…VC-17 + VC-19（VC-18 是保留空号，不进裁判表）。
const contractIds = [
  'VC-01', 'VC-02', 'VC-03', 'VC-04', 'VC-05', 'VC-06', 'VC-07', 'VC-08', 'VC-09',
  'VC-10', 'VC-11', 'VC-12', 'VC-13', 'VC-14', 'VC-15', 'VC-16', 'VC-17', 'VC-19',
]

function runValidator(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', validatorScript, ...args],
      { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' },
    )
    return { status: 0, stdout, stderr: '' }
  } catch (cause) {
    const failure = cause as { status?: number; stdout?: string; stderr?: string }
    return { status: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' }
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/**
 * 数学向量通过**文件**传给校验器：Windows 的参数解析会把 JSON 里的引号吃掉，
 * 内联 JSON 在 `powershell.exe -File` 下会变成不可解析的形态（本轮实测）。
 */
function runMathVectors(vectors: unknown[]): { status: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rain-visual-math-'))
  const path = join(dir, 'vectors.json')
  writeJson(path, vectors)
  return runValidator(['-VerifyMathFile', path])
}

/**
 * 跑一段 PowerShell 脚本体并把它的 JSON 输出解析回对象。
 *
 * 脚本体先落盘成文件再执行，不走命令行传参：Windows 的参数解析会把内联脚本与 JSON 里的引号
 * 吃掉（本仓已经踩过一次，见上面 runMathVectors 的说明）。
 */
function runPowerShellJson(script: string): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'rain-visual-ps-'))
  const path = join(dir, 'probe.ps1')
  // BOM 是必需的：无 BOM 时 Windows PowerShell 5.1 会按 ANSI 解码含中文的脚本，直接语法错乱。
  writeFileSync(path, `\uFEFF${script}`, 'utf8')
  const stdout = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path],
    { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' },
  )
  return JSON.parse(stdout) as Record<string, unknown>
}

/* ------------------------------------------------------------------ *
 * 参考实现（与校验器相互独立）：用于生成合成证据包里的自洽数值。
 * 真实数值来源 = visual-contract.md §5.5 的公开复算值，见本文件末尾的对照用例。
 * ------------------------------------------------------------------ */

function srgbChannel(channel: number): number {
  const scaled = channel / 255
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b)
}

function contrastRatio(fg: [number, number, number], bg: [number, number, number]): number {
  const high = Math.max(relativeLuminance(fg), relativeLuminance(bg))
  const low = Math.min(relativeLuminance(fg), relativeLuminance(bg))
  return (high + 0.05) / (low + 0.05)
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function hexToRgb8(hex: string): [number, number, number] {
  const body = hex.replace('#', '')
  return [0, 2, 4].map((offset) => Number.parseInt(body.slice(offset, offset + 2), 16)) as [number, number, number]
}

function rgb8ToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** The form getComputedStyle actually returns in Chromium/WebView2: `rgb(r, g, b)`. */
function rgb8ToCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`
}

const DARK_FG: [number, number, number] = hexToRgb8('#e5e5e5')
const DARK_SURFACE: [number, number, number] = hexToRgb8('#242424')
const DARK_BG: [number, number, number] = hexToRgb8('#1a1a1a')
const DARK_BORDER: [number, number, number] = hexToRgb8('#8f8f8f')

/* ------------------------------------------------------------------ *
 * 合成证据包构造器（synthetic，仅用于裁判校验器的行为，不冒充真实实测）
 * ------------------------------------------------------------------ */

interface RecordOverrides {
  recordId: string
  vc: string
  criterion: string
  page: string
  selector: string
  screenshots: string[]
  measurementScope?: string
  fg?: [number, number, number]
  bg?: [number, number, number]
  fgSource?: string
  bgSource?: string
  declared?: { fg?: string; bg?: string }
  /** Which colour role the criterion measures; the validator maps the declared token onto this channel. */
  role?: string
  /** Composited border channels, one per side. */
  border?: { top?: [number, number, number]; right?: [number, number, number]; bottom?: [number, number, number]; left?: [number, number, number] }
  /** Which border sides are actually painted. Defaults to "all four" (the shape most records have). */
  borderRendered?: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean }
  /** Raw computed border colours written next to the composited channels (traceability field). */
  borderDeclaredComputed?: { top?: string; right?: string; bottom?: string; left?: string }
  /** Composited outline channel. */
  outline?: [number, number, number]
  /** Whether the outline is actually painted (defaults to false: most elements have none). */
  outlineRendered?: boolean
  /** Raw computed outline colour written next to the composited channel. */
  outlineDeclaredComputed?: string
  /** Per-side computed border width/style as they appear in computedStyle (used to cross-check `rendered`). */
  computedBorder?: {
    topWidth?: string
    topStyle?: string
    rightWidth?: string
    rightStyle?: string
    bottomWidth?: string
    bottomStyle?: string
    leftWidth?: string
    leftStyle?: string
    outlineStyle?: string
    outlineWidth?: string
  }
  fontSizePx?: number
  fontWeight?: number
  threshold?: number
  thresholdBasis?: string
  toleranceRatio?: number
  toleranceBasis?: string
}

function buildTolerance() {
  return {
    colorChannel: 1,
    contrastRatio: 0.05,
    fixedHeightPx: 0.5,
    renderedGeometryPx: 2,
    exactValues: true,
  }
}

function buildRecord(overrides: RecordOverrides) {
  const fg = overrides.fg ?? DARK_FG
  const bg = overrides.bg ?? DARK_SURFACE
  const fontSizePx = overrides.fontSizePx ?? 13
  const fontWeight = overrides.fontWeight ?? 400
  const isLargeText = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700)
  const threshold = overrides.threshold ?? (isLargeText ? 3 : 4.5)
  const ratio = contrastRatio(fg, bg)
  const fgHex = rgb8ToHex(fg)
  const bgHex = rgb8ToHex(bg)
  return {
    recordId: overrides.recordId,
    vc: overrides.vc,
    criterion: overrides.criterion,
    page: overrides.page,
    measurementScope: overrides.measurementScope ?? 'element',
    selector: overrides.selector,
    description: `${overrides.vc} ${overrides.criterion} 的合成证据（synthetic）`,
    sampledViewport: {
      width: 1280,
      height: 720,
      devicePixelRatio: 1,
      sampledAt: '2026-09-28T00:00:00.000Z',
    },
    screenshots: overrides.screenshots,
    rect: { x: 12, y: 40, width: 240, height: 32, top: 40, right: 252, bottom: 72, left: 12 },
    computedStyle: {
      color: fgHex,
      backgroundColor: bgHex,
      fontFamily: 'system-ui, "Segoe UI", sans-serif',
      fontSize: `${fontSizePx}px`,
      fontWeight: String(fontWeight),
      fontVariantNumeric: 'normal',
      lineHeight: `${Math.round(fontSizePx * 1.538)}px`,
      borderTopWidth: overrides.computedBorder?.topWidth ?? '1px',
      borderTopStyle: overrides.computedBorder?.topStyle ?? 'solid',
      borderTopColor: bgHex,
      borderRightWidth: overrides.computedBorder?.rightWidth ?? '1px',
      borderRightStyle: overrides.computedBorder?.rightStyle ?? 'solid',
      borderBottomWidth: overrides.computedBorder?.bottomWidth ?? '1px',
      borderBottomStyle: overrides.computedBorder?.bottomStyle ?? 'solid',
      borderLeftWidth: overrides.computedBorder?.leftWidth ?? '1px',
      borderLeftStyle: overrides.computedBorder?.leftStyle ?? 'solid',
      outlineStyle: overrides.computedBorder?.outlineStyle ?? 'none',
      outlineWidth: overrides.computedBorder?.outlineWidth ?? '0px',
      borderRadius: '8px',
      paddingTop: '4px',
      paddingRight: '8px',
      paddingBottom: '4px',
      paddingLeft: '8px',
      marginTop: '0px',
      marginRight: '0px',
      marginBottom: '0px',
      marginLeft: '0px',
      boxShadow: 'none',
    },
    measured: {
      // Every record declares which colour role its criterion measures, and carries a channel for every
      // colour it could be talking about. The collector always emits all of these now, so the fixture
      // mirrors the real shape -- otherwise these tests would assert against a record nothing produces.
      role: overrides.role ?? 'text',
      fg: {
        source: overrides.fgSource ?? 'getComputedStyle(color)',
        declared: overrides.declared?.fg ?? fgHex,
        rgba8: fg,
        alpha: 1,
        composited: false,
      },
      bg: {
        source: overrides.bgSource ?? 'composite(ancestor backgrounds)',
        declared: overrides.declared?.bg ?? bgHex,
        rgba8: bg,
        alpha: 1,
        composited: true,
        layers: [{ selector: 'html', declared: bgHex, alpha: 1 }],
      },
      border: {
        source: 'composite(own border color over the composited backdrop; §3.2)',
        rgba8: {
          bordertop: overrides.border?.top ?? bg,
          borderright: overrides.border?.right ?? bg,
          borderbottom: overrides.border?.bottom ?? bg,
          borderleft: overrides.border?.left ?? bg,
        },
        declaredComputed: {
          bordertop: overrides.borderDeclaredComputed?.top ?? rgb8ToCss(overrides.border?.top ?? bg),
          borderright: overrides.borderDeclaredComputed?.right ?? rgb8ToCss(overrides.border?.right ?? bg),
          borderbottom: overrides.borderDeclaredComputed?.bottom ?? rgb8ToCss(overrides.border?.bottom ?? bg),
          borderleft: overrides.borderDeclaredComputed?.left ?? rgb8ToCss(overrides.border?.left ?? bg),
        },
        rendered: {
          top: overrides.borderRendered?.top ?? true,
          right: overrides.borderRendered?.right ?? true,
          bottom: overrides.borderRendered?.bottom ?? true,
          left: overrides.borderRendered?.left ?? true,
        },
      },
      outline: {
        source: 'composite(own outline color over the composited backdrop; §3.2)',
        rgba8: overrides.outline ?? bg,
        declaredComputed: overrides.outlineDeclaredComputed ?? rgb8ToCss(overrides.outline ?? bg),
        style: (overrides.outlineRendered ?? false) ? 'dashed' : 'none',
        widthPx: (overrides.outlineRendered ?? false) ? 2 : 0,
        rendered: overrides.outlineRendered ?? false,
      },
      contrastRatio: {
        value: round6(ratio),
        formula: 'WCAG21:(L1+0.05)/(L2+0.05)',
        luminanceFg: round6(relativeLuminance(fg)),
        luminanceBg: round6(relativeLuminance(bg)),
        threshold,
        thresholdBasis: overrides.thresholdBasis ?? (isLargeText ? 'largeText>=24px or >=18.66px bold' : 'text'),
        tolerance: overrides.toleranceRatio ?? 0.05,
        toleranceBasis: overrides.toleranceBasis ?? 'visual-contract.md §3.3 contrast ratio ±0.05',
      },
    },
  }
}

interface PackageOptions {
  vcId?: string
  tested?: string[]
  untested?: string[]
  records?: unknown[]
  screenshots?: string[]
  manifestOverrides?: Record<string, unknown>
  omitManifestKey?: string
  /** Package provenance: only `real-collector` may be presented as evidence. */
  provenance?: string
  /** Extra keys merged into manifest.host.webview2 (used to exercise the declared downgrade premise). */
  webview2?: Record<string, unknown>
}

function createPackage(options: PackageOptions = {}): string {
  // 证据包目录名必须符合约定 visual-<目标sha8>-<yyyyMMdd-HHmmss>（校验器会核对目录名与 target 一致）。
  const tempRoot = mkdtempSync(join(tmpdir(), 'rain-visual-evidence-'))
  const evidenceId = 'visual-800ffcf7-20260928-120000'
  const dir = join(tempRoot, evidenceId)
  const screenshotName = 'screenshots/01-video-list.png'
  const tested = options.tested ?? ['VC-01']
  const untested = options.untested ?? contractIds.filter((id) => !tested.includes(id))
  const screenshots = options.screenshots ?? [screenshotName]

  mkdirSync(join(dir, 'screenshots'), { recursive: true })
  for (const shot of screenshots) {
    const target = join(dir, shot)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, pngBytes)
  }

  const records = options.records ?? [
    buildRecord({
      recordId: 'VC-01-list-body-bg',
      vc: options.vcId ?? 'VC-01',
      criterion: 'bodyBackgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots,
    }),
  ]

  // 有 accentSweep 记录时，manifest 必须同时声明对应的扫描（校验器会双向对账）。
  const declaredSweeps = (records as Array<Record<string, unknown>>)
    .filter((record) => record.measurementScope === 'accentSweep')
    .map((record) => ({
      id: record.recordId,
      vc: record.vc,
      page: record.page,
      selectorScope: record.selector,
      accentToken: '#4a9eff',
    }))

  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    evidenceId,
    // Provenance is mandatory: the same shape can come from a real collection or from reshaping old
    // numbers by hand, and only this field tells the two apart.
    provenance: options.provenance ?? 'real-collector',
    generatedAt: '2026-09-28T00:00:00.000Z',
    generatedBy: 'scripts/campaign-visual-evidence.ps1',
    target: {
      commitSha: '800ffcf78fad46a417eb9a3717a8030123e11393',
      shortSha: '800ffcf7',
      repo: 'llbz510/rain',
      checkoutRef: 'refs/heads/codex/visual-v1a-evidence-channel',
    },
    viewport: {
      width: 1280,
      height: 720,
      devicePixelRatio: 1,
      windowState: 'default (unmodified native window size)',
    },
    host: {
      os: { caption: 'Microsoft Windows Server 2025 Datacenter', version: '10.0.26100', build: '26100' },
      // runtimeVersionSource is mandatory: when the app tauri-driver launches exposes no debug port the
      // version comes from the preflight reading on the same host+binary, which is a DECLARED downgrade.
      // Omitting the source would hide how strong the binding is, so the validator refuses to guess one.
      webview2: { runtimeVersion: '141.0.3537.57', driverVersion: '141.0.3537.57', runtimeVersionSource: 'devtools', ...(options.webview2 ?? {}) },
      app: { productName: 'Rain', productVersion: '0.1.0', binaryPath: 'src-tauri\\target\\debug\\rain.exe' },
      driver: { tauriDriver: '2.0.6' },
    },
    tolerance: buildTolerance(),
    coverage: { tested, untested, reserved: ['VC-18'], scopeNote: 'synthetic fixture: tested ids carry exactly one measured dimension each' },
    screenshots,
    records: records.map((record) => {
      const typed = record as { recordId: string }
      return { recordId: typed.recordId, file: `records/${typed.recordId}.json` }
    }),
    ...(declaredSweeps.length > 0 ? { accentSweeps: declaredSweeps } : {}),
    verdicts: {
      issued: false,
      issuedBy: null,
      note: '本证据包只提供 §3.4 第 1–3 项（输入侧）数据；第 4 项逐条 pass/needs_revision 由独立视觉审查员判定。',
    },
  }

  if (options.omitManifestKey) delete manifest[options.omitManifestKey]
  Object.assign(manifest, options.manifestOverrides ?? {})

  mkdirSync(join(dir, 'records'), { recursive: true })
  for (const record of records) {
    const typed = record as { recordId: string }
    writeJson(join(dir, 'records', `${typed.recordId}.json`), record)
  }
  writeJson(join(dir, 'manifest.json'), manifest)
  return dir
}

/* ------------------------------------------------------------------ *
 * ① 数学：合成与对比度实算 + 与合同 §5.5 公开值的交叉校验
 * ------------------------------------------------------------------ */

describe('visual evidence validator: math cross-check (-VerifyMathFile)', () => {
  it('recomputes the published visual-contract §5.5 ratios from the raw hex tokens', { timeout: powershellTimeoutMs }, () => {
    // expected 列取自校验器 **-VerifyMathFile 的实际打印值**（6 位小数）。
    // 第 5 位以后的偏差即会因 1e-6 的严格断言而失败，因此这一列不是"宽松常量"，而是逐位锚点；
    // 每一位都必须同时与 visual-contract.md §5.5 的两位小数公开值相符（下方 reference implementation 用例）。
    const vectors = [
      { name: 'black on white (WCAG upper bound)', fg: '#000000', bg: '#ffffff', expected: 21 },
      { name: 'same colour is the lower bound', fg: '#242424', bg: '#242424', expected: 1 },
      { name: 'dark text on panel (VC-03② 12.32:1)', fg: '#e5e5e5', bg: '#242424', expected: 12.322793 },
      { name: 'muted on hover surface (4.83:1)', fg: '#9a9a9a', bg: '#2e2e2e', expected: 4.825904 },
      { name: 'border on page background (VCGAP-10 5.38:1)', fg: '#8f8f8f', bg: '#1a1a1a', expected: 5.381705 },
      { name: 'retired accent pairing fails (VCGAP-09 2.75:1)', fg: '#ffffff', bg: '#4a9eff', expected: 2.753769 },
      { name: 'light palette fg on panel (14.64:1)', fg: '#e6edf3', bg: '#161b22', expected: 14.639773 },
      { name: 'light palette concept on panel (6.07:1)', fg: '#539bf5', bg: '#161b22', expected: 6.074905 },
      { name: 'light palette dimmer on panel2 (4.83:1)', fg: '#868f99', bg: '#1c232c', expected: 4.827957 },
      { name: 'status fail on panel (5.56:1)', fg: '#ff6b61', bg: '#242424', expected: 5.564366 },
      { name: 'status pending on page background (8.94:1)', fg: '#e3b341', bg: '#1a1a1a', expected: 8.942964 },
      {
        name: 'composite rgba(255,255,255,.08) over #161b22 then contrast against panel',
        fg: 'rgba(255,255,255,0.08)',
        bg: '#161b22',
        expected: 1.251434,
      },
      { name: 'opaque composite of rgba(0,0,0,.6) over #1a1a1a', fg: 'rgba(0,0,0,0.6)', bg: '#1a1a1a', expected: 1.137542 },
      {
        name: 'selected-surface composite rgba(0,0,0,.15) over #242424 equals #1f1f1f',
        fg: 'rgba(0,0,0,0.15)',
        bg: '#242424',
        expected: 1.061848,
      },
      {
        name: 'three layers: rgba(255,255,255,.10) over selBg(#1f1f1f) over #242424',
        fg: 'rgba(255,255,255,0.10)',
        bg: 'rgba(0,0,0,0.15)',
        base: '#242424',
        expected: 1.343776,
      },
    ]
    const result = runMathVectors(vectors)

    expect(result.status, `validator stdout: ${result.stdout}${result.stderr}`).toBe(0)
    for (const vector of vectors) {
      expect(result.stdout).toContain(`OK ${vector.name}`)
      // 逐位锚点：校验器打印的 ratio 必须与 expected 在 6 位小数上相等（不是只落在 ±0.05 容差里）。
      expect(result.stdout).toContain(`ratio=${vector.expected} `)
    }
    expect(result.stdout).toContain(`OK_VECTORS ${vectors.length}`)
    // 15 条向量里既有 21:1 的上界也有 1.06:1 的不达标配对——断言常量无法通过本用例。
    expect(vectors.length).toBe(15)
  })

  it('fails loudly when a supplied expected ratio is wrong', { timeout: powershellTimeoutMs }, () => {
    const result = runMathVectors([
      { name: 'deliberately wrong expectation', fg: '#e5e5e5', bg: '#242424', expected: 4.5 },
    ])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/MISMATCH/)
    // 校验器自算的 #e5e5e5 / #242424 比值（保留 6 位）；与 §5.5 的 12.32 一致。
    expect(`${result.stdout}${result.stderr}`).toMatch(/12\.322793/)
  })

  it('fails loudly rather than defaulting when a colour token cannot be parsed', { timeout: powershellTimeoutMs }, () => {
    const result = runMathVectors([
      { name: 'unparseable token', fg: 'var(--color-fg)', bg: '#242424', expected: 12.32 },
    ])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/PARSE_FAIL|MISMATCH/)
  })
})

/* ------------------------------------------------------------------ *
 * ② 完整合规的证据包必须被接受
 * ------------------------------------------------------------------ */

describe('visual evidence validator: well-formed package', () => {
  it('accepts a package that carries all four §3.4 items', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage()
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.stderr, `validator stderr: ${result.stderr}`).toBe('')
    expect(result.status, `validator stdout: ${result.stdout}${result.stderr}`).toBe(0)
    expect(result.stdout).toMatch(/VISUAL_EVIDENCE_VALID/)
  })
})

/* ------------------------------------------------------------------ *
 * ③ 缺必填字段必须显式失败（不许静默出空值）
 * ------------------------------------------------------------------ */

describe('visual evidence validator: missing required fields fail explicitly', () => {
  const requiredManifestFields = [
    'target',
    'viewport',
    'host',
    'tolerance',
    'coverage',
    'screenshots',
    'records',
    'verdicts',
  ]

  for (const field of requiredManifestFields) {
    it(`rejects a manifest without "${field}"`, { timeout: powershellTimeoutMs }, () => {
      const dir = createPackage({ omitManifestKey: field })
      const result = runValidator(['-EvidenceRoot', dir])

      expect(result.status).not.toBe(0)
      expect(`${result.stdout}${result.stderr}`).toMatch(new RegExp(field, 'i'))
    })
  }

  it('rejects a manifest whose target block omits the viewport devicePixelRatio', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage({
      manifestOverrides: { viewport: { width: 1280, height: 720, windowState: 'default' } },
    })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/devicePixelRatio/i)
  })

  it('rejects a manifest whose host block omits the WebView2 runtime version', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage({
      manifestOverrides: {
        host: {
          os: { caption: 'Windows Server 2025', version: '10.0.26100' },
          webview2: {},
          app: { productName: 'Rain', productVersion: '0.1.0' },
        },
      },
    })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/webview2|runtime/i)
  })

  it('rejects a record with a null rect instead of coercing it to zero', { timeout: powershellTimeoutMs }, () => {
    const record = { ...buildRecord({ recordId: 'VC-01-null-rect', vc: 'VC-01', criterion: 'bodyBackgroundLuminanceBelow0.05', page: 'video-list', selector: 'body', screenshots: ['screenshots/01-video-list.png'] }), rect: null }
    const dir = createPackage({ records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/rect/i)
  })

  it('rejects a record with an empty computed-style block instead of emitting blank values', { timeout: powershellTimeoutMs }, () => {
    const record = { ...buildRecord({ recordId: 'VC-01-empty-style', vc: 'VC-01', criterion: 'bodyBackgroundLuminanceBelow0.05', page: 'video-list', selector: 'body', screenshots: ['screenshots/01-video-list.png'] }), computedStyle: {} }
    const dir = createPackage({ records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/computedStyle/i)
  })

  it('rejects a record without a sampled viewport', { timeout: powershellTimeoutMs }, () => {
    const record = buildRecord({ recordId: 'VC-01-no-viewport', vc: 'VC-01', criterion: 'bodyBackgroundLuminanceBelow0.05', page: 'video-list', selector: 'body', screenshots: ['screenshots/01-video-list.png'] }) as Record<string, unknown>
    delete record.sampledViewport
    const dir = createPackage({ records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/sampledViewport|viewport/i)
  })

  it('rejects a coverage block without the explicit untested list', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage({ manifestOverrides: { coverage: { tested: ['VC-01'] } } })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/untested/i)
  })

  it('rejects a coverage block without the explicit dimension scope note', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage({
      manifestOverrides: {
        coverage: { tested: ['VC-01'], untested: contractIds.filter((id) => id !== 'VC-01'), reserved: ['VC-18'] },
      },
    })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/scopeNote/i)
  })

  it('rejects a coverage block that leaves VC-18 (the reserved number) in a tested/untested list', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage({ untested: [...contractIds.filter((id) => id !== 'VC-01'), 'VC-18'] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/VC-18/)
  })

  it('rejects a coverage block that omits contract ids entirely', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage({ untested: ['VC-02', 'VC-03'] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/VC-\d\d/)
  })
})

/* ------------------------------------------------------------------ *
 * ④ 只有截图 → 不构成裁判（§3.4 末句）
 * ------------------------------------------------------------------ */

describe('visual evidence validator: screenshots alone adjudicate nothing', () => {
  it('rejects a package that has a screenshot but zero measurement records', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage({ records: [], tested: [], untested: contractIds })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/截图|screenshot/i)
    expect(`${result.stdout}${result.stderr}`).toMatch(/不构成|not admissible|no measurement|0 records/i)
  })

  it('rejects records that reference a screenshot which does not exist in the package', { timeout: powershellTimeoutMs }, () => {
    const record = buildRecord({
      recordId: 'VC-01-missing-shot',
      vc: 'VC-01',
      criterion: 'bodyBackgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/does-not-exist.png'],
    })
    const dir = createPackage({ records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/does-not-exist\.png/)
  })

  it('rejects a record that claims a criterion without naming any screenshot', { timeout: powershellTimeoutMs }, () => {
    const record = buildRecord({
      recordId: 'VC-01-unbound',
      vc: 'VC-01',
      criterion: 'bodyBackgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: [],
    })
    const dir = createPackage({ records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/screenshot/i)
  })

  it('rejects a package whose only screenshot is not a PNG', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage()
    writeFileSync(join(dir, 'screenshots', '01-video-list.png'), 'not a png at all', 'utf8')
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/PNG|png/i)
  })
})

/* ------------------------------------------------------------------ *
 * ⑤ 实测数字必须自洽、可复算（不许声明一个数、记录另一个数）
 * ------------------------------------------------------------------ */

describe('visual evidence validator: measured numbers must be recomputable', () => {
  it('rejects a record whose declared contrast ratio contradicts its own composited colours', { timeout: powershellTimeoutMs }, () => {
    const record = buildRecord({
      recordId: 'VC-03-lie',
      vc: 'VC-03',
      criterion: 'primaryButtonTextContrast',
      page: 'video-list',
      selector: '[data-testid="video-list-page"] header button',
      screenshots: ['screenshots/01-video-list.png'],
    }) as Record<string, any>
    record.measured.contrastRatio.value = 19.99
    const dir = createPackage({
      tested: ['VC-03'],
      records: [record],
    })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/对比度|contrast/i)
  })

  it('rejects a record whose declared RGB channels drift more than ±1 from the measured composited colour', { timeout: powershellTimeoutMs }, () => {
    const record = buildRecord({
      recordId: 'VC-02-drift',
      vc: 'VC-02',
      criterion: 'panelSurfaceToken',
      page: 'settings',
      selector: '[data-testid="settings-page"]',
      screenshots: ['screenshots/01-video-list.png'],
      declared: { bg: '#161b22' },
    }) as Record<string, any>
    record.measured.bg.rgba8 = [0x20, 0x25, 0x2c]
    const dir = createPackage({ tested: ['VC-02'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/通道|channel|\+-\d/i)
  })

  it('rejects a record whose threshold is wrong for the measured font size', { timeout: powershellTimeoutMs }, () => {
    const record = buildRecord({
      recordId: 'VC-12-threshold',
      vc: 'VC-12',
      criterion: 'bodyTextContrast',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
      fontSizePx: 13,
      threshold: 3,
    })
    const dir = createPackage({ tested: ['VC-12'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/threshold|4\.5/i)
  })

  it('accepts the 3:1 threshold for genuinely large text (≥24px)', { timeout: powershellTimeoutMs }, () => {
    const record = buildRecord({
      recordId: 'VC-12-large-text',
      vc: 'VC-12',
      criterion: 'emptyStateHeadlineContrast',
      page: 'video-list',
      selector: '[data-testid="video-list-page"] main h1',
      screenshots: ['screenshots/01-video-list.png'],
      fontSizePx: 24,
      threshold: 3,
    })
    const dir = createPackage({ tested: ['VC-12'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.stderr, `validator stderr: ${result.stderr}`).toBe('')
    expect(result.status, `validator stdout: ${result.stdout}${result.stderr}`).toBe(0)
  })

  it('rejects a record whose tolerance is not the §3.3 value', { timeout: powershellTimeoutMs }, () => {
    const record = buildRecord({
      recordId: 'VC-01-tolerance',
      vc: 'VC-01',
      criterion: 'bodyBackgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
      toleranceRatio: 0.5,
    })
    const dir = createPackage({ records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/tolerance|容差/i)
  })
})

/* ------------------------------------------------------------------ *
 * ⑤b 非「逐元素测量」的两类记录：跨元素扫描（VC-03① 的全称否定）与令牌解析值
 * ------------------------------------------------------------------ */

describe('visual evidence validator: non-element measurement scopes', () => {
  const sweepRecord = (overrides: Record<string, unknown> = {}) => ({
    recordId: 'VC-03-list-accent-sweep',
    vc: 'VC-03',
    criterion: 'noBrandAccentAnywhere',
    page: 'video-list',
    measurementScope: 'accentSweep',
    selector: '[data-testid="video-list-page"]',
    description: 'VC-03① 全页扫描',
    sampledViewport: { width: 1280, height: 720, devicePixelRatio: 1, sampledAt: '2026-09-28T00:00:00.000Z' },
    screenshots: ['screenshots/01-video-list.png'],
    accentSweep: {
      accentToken: '#4a9eff',
      tolerancePerChannel: 1,
      selectorScope: '[data-testid="video-list-page"]',
      scannedElementCount: 42,
      scannedProperties: ['backgroundColor', 'borderTopColor', 'outlineColor', 'color'],
      matches: [],
      ...(overrides.sweep as Record<string, unknown> | undefined),
    },
    ...(overrides.record as Record<string, unknown> | undefined),
  })

  it('accepts a well-formed accent sweep record (empty match list means the accent is absent)', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage({ tested: ['VC-03'], records: [sweepRecord()] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.stderr, `validator stderr: ${result.stderr}`).toBe('')
    expect(result.status, `validator stdout: ${result.stdout}${result.stderr}`).toBe(0)
  })

  it('rejects an accent sweep that never scanned any element', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage({
      tested: ['VC-03'],
      records: [sweepRecord({ sweep: { scannedElementCount: 0 } })],
    })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/scannedElementCount/i)
  })

  it('rejects an accent sweep that does not name the rendered properties it scanned', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage({
      tested: ['VC-03'],
      records: [sweepRecord({ sweep: { scannedProperties: ['backgroundColor'] } })],
    })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/scannedProperties/i)
  })

  it('rejects a sweep whose matches field is missing instead of empty', { timeout: powershellTimeoutMs }, () => {
    const record = sweepRecord()
    delete (record.accentSweep as Record<string, unknown>).matches
    const dir = createPackage({ tested: ['VC-03'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/matches/i)
  })

  const tokenRecord = (tokens: Record<string, string>) => ({
    recordId: 'VC-04-study-paragraph-type-tokens',
    vc: 'VC-04',
    criterion: 'paragraphTypeToken',
    page: 'study',
    measurementScope: 'rootTokens',
    selector: ':root',
    description: 'VC-04 令牌解析值',
    sampledViewport: { width: 1280, height: 720, devicePixelRatio: 1, sampledAt: '2026-09-28T00:00:00.000Z' },
    screenshots: ['screenshots/01-video-list.png'],
    resolvedTokens: tokens,
  })

  it('accepts a token-resolution record and rejects an empty one', { timeout: powershellTimeoutMs }, () => {
    const good = createPackage({
      tested: ['VC-04'],
      records: [tokenRecord({ '--color-concept': '#5b9bf8', '--color-example': '#3ecf8e' })],
    })
    const goodResult = runValidator(['-EvidenceRoot', good])
    expect(goodResult.stderr, `validator stderr: ${goodResult.stderr}`).toBe('')
    expect(goodResult.status, `validator stdout: ${goodResult.stdout}${goodResult.stderr}`).toBe(0)

    const emptyToken = createPackage({
      tested: ['VC-04'],
      records: [tokenRecord({ '--color-concept': '' })],
    })
    const emptyResult = runValidator(['-EvidenceRoot', emptyToken])
    expect(emptyResult.status).not.toBe(0)
    expect(`${emptyResult.stdout}${emptyResult.stderr}`).toMatch(/resolvedTokens|空值/i)
  })

  it('rejects an unknown measurement scope instead of guessing a shape', { timeout: powershellTimeoutMs }, () => {
    const record = buildRecord({
      recordId: 'VC-01-weird-scope',
      vc: 'VC-01',
      criterion: 'backgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
      measurementScope: 'whatever',
    })
    const dir = createPackage({ records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/measurementScope/i)
  })

  it('rejects a record whose declared contract token does not match the measured composited colour', { timeout: powershellTimeoutMs }, () => {
    // 采集器可以声明"这个实测值对应合同冻结的某个令牌"；校验器必须自己复算，不许只信自述。
    const record = buildRecord({
      recordId: 'VC-02-token-provenance',
      vc: 'VC-02',
      criterion: 'neutralScaleToken',
      page: 'video-list',
      selector: '[data-testid="video-list-page"]',
      screenshots: ['screenshots/01-video-list.png'],
      bg: [0x2e, 0x2e, 0x2e],
      declared: { bg: '#2e2e2e' },
    }) as Record<string, any>
    record.declaredToken = { name: '--color-surface', value: '#242424', source: 'visual-contract.md §5.5' }
    const dir = createPackage({ tested: ['VC-02'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/declaredToken|#242424/i)
  })
})

/* ------------------------------------------------------------------ *
 * ⑤b 颜色角色与通道：令牌必须落在它声明角色的通道里
 * ------------------------------------------------------------------ */

describe('visual evidence validator: colour role and channels', () => {
  it('rejects a border-role token that no border channel can explain', { timeout: powershellTimeoutMs }, () => {
    // 边框类判据测的是**边框颜色**。这条记录声明 role=border，但 border 通道里的颜色都不是
    // --color-border 的 #6e7074 —— 令牌来源无法解释实测值，必须失败。
    // （这正是托管 run 36574308748 里 VC-02-settings-topbar-border 的形状；当时记录根本没有
    //  边框通道，因此校验器只能拿 fg/bg 去比、必然对不上。）
    const record = buildRecord({
      recordId: 'VC-02-border-role-mismatch',
      vc: 'VC-02',
      criterion: 'neutralScaleBorderToken',
      page: 'video-list',
      selector: '[data-testid="video-list-page"] header input[type="text"]',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'border',
      border: { top: [0x22, 0x22, 0x22], right: [0x22, 0x22, 0x22], bottom: [0x22, 0x22, 0x22], left: [0x22, 0x22, 0x22] },
    }) as Record<string, any>
    record.declaredToken = { name: '--color-border', value: '#6e7074', source: 'visual-contract.md §5.5' }
    const dir = createPackage({ tested: ['VC-02'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'a token no channel can explain must fail').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/role=border|#6e7074/i)
  })

  it('accepts a border-role token that the border channel does explain', { timeout: powershellTimeoutMs }, () => {
    // 同一个令牌，只要边框通道里真有这个颜色就必须通过——证明上一条失败是因为对不上，不是因为
    // 校验器一律拒绝 border 角色。
    // 记录形状要与新契约自洽：四边都被画出来（computedStyle 也这么说），而 §3.4 第 3 项的对比度
    // 必须取自**被画出来的那个颜色**，所以 fg 就是边框色本身（不再取未画边的 currentColor）。
    const record = buildRecord({
      recordId: 'VC-02-border-role-match',
      vc: 'VC-02',
      criterion: 'neutralScaleBorderToken',
      page: 'video-list',
      selector: '[data-testid="video-list-page"] header input[type="text"]',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'border',
      fg: [0x6e, 0x70, 0x74],
      bg: DARK_SURFACE,
      threshold: 3,
      thresholdBasis: 'nonText',
      border: { top: [0x6e, 0x70, 0x74], right: [0x6e, 0x70, 0x74], bottom: [0x6e, 0x70, 0x74], left: [0x6e, 0x70, 0x74] },
    }) as Record<string, any>
    record.declaredToken = { name: '--color-border', value: '#6e7074', source: 'visual-contract.md §5.5' }
    const dir = createPackage({ tested: ['VC-02'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, `expected pass, got: ${result.stdout}${result.stderr}`).toBe(0)
  })

  it('rejects a record that does not declare which colour role it measured', { timeout: powershellTimeoutMs }, () => {
    // 角色是把"这个令牌该出现在哪个通道"变成可校验结构事实的那一环；缺了它就只能靠人读描述。
    const record = buildRecord({
      recordId: 'VC-01-no-role',
      vc: 'VC-01',
      criterion: 'backgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
    }) as Record<string, any>
    delete record.measured.role
    const dir = createPackage({ tested: ['VC-01'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'a record without a declared colour role must fail').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/role/i)
  })

  it('rejects a record that declares an unknown colour role', { timeout: powershellTimeoutMs }, () => {
    // 新种类的测量必须登记成新角色，不得静默塞进已知角色里蒙混过关。
    const record = buildRecord({
      recordId: 'VC-01-unknown-role',
      vc: 'VC-01',
      criterion: 'backgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'shadow',
    }) as Record<string, any>
    const dir = createPackage({ tested: ['VC-01'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'an unregistered colour role must fail').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/known|已知|shadow/i)
  })

  it('rejects a package whose manifest omits the WebView2 version source', { timeout: powershellTimeoutMs }, () => {
    // 版本可能是"驱动拉起的应用不开调试端口时取自预检"的降级读数。来源缺失就无法判断这条版本绑定
    // 有多强，因此必须显式声明；校验器不许替它猜一个。
    const record = buildRecord({
      recordId: 'VC-01-version-source',
      vc: 'VC-01',
      criterion: 'backgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
    })
    const dir = createPackage({ tested: ['VC-01'], records: [record] })
    const manifestPath = join(dir, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, any>
    delete manifest.host.webview2.runtimeVersionSource
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'a missing runtimeVersionSource must fail').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/runtimeVersionSource/i)
  })

  it('rejects a package whose manifest declares an unregistered version source', { timeout: powershellTimeoutMs }, () => {
    const record = buildRecord({
      recordId: 'VC-01-version-source-unknown',
      vc: 'VC-01',
      criterion: 'backgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
    })
    const dir = createPackage({ tested: ['VC-01'], records: [record] })
    const manifestPath = join(dir, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, any>
    manifest.host.webview2.runtimeVersionSource = 'vibes'
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'an unregistered version source must fail').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/runtimeVersionSource|vibes/i)
  })

  it('accepts role=nonColour for a criterion that judges no colour at all', { timeout: powershellTimeoutMs }, () => {
    // VC-15④ 的顶栏高度、VC-15② 的圆角、VC-15① 的间距、VC-15③ 的阴影都**不判颜色**。
    // 这类记录没有颜色角色可声明：把它标成 text 等于把结构事实写假（文本色通道与"顶栏高度 40"无关）。
    // 因此登记第五个角色 nonColour（不判颜色），它仍然必须显式写出、不许留空。
    const record = buildRecord({
      recordId: 'VC-15-list-topbar-height',
      vc: 'VC-15',
      criterion: 'keyHeightTopbar40',
      page: 'video-list',
      selector: '[data-testid="video-list-page"] header',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'nonColour',
    })
    const dir = createPackage({ tested: ['VC-15'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, `a registered non-colour role must be accepted; ${result.stdout}${result.stderr}`).toBe(0)
  })

  it('refuses a nonColour record that declares a colour token (a role with no channels cannot be checked)', { timeout: powershellTimeoutMs }, () => {
    // nonColour 的角色通道集合是空的。如果放行，就等于给"声明了令牌却没有任何通道可对账"开了一条
    // 静默通道——正是 fail-closed 要堵的那个洞。所以 nonColour + declaredToken 必须直接失败。
    const record = buildRecord({
      recordId: 'VC-15-list-topbar-height-token',
      vc: 'VC-15',
      criterion: 'keyHeightTopbar40',
      page: 'video-list',
      selector: '[data-testid="video-list-page"] header',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'nonColour',
    }) as Record<string, any>
    record.declaredToken = { name: '--color-border', value: '#8f8f8f', source: 'visual-contract.md §5.5' }
    const dir = createPackage({ tested: ['VC-15'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'a nonColour record must not carry a declared token').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/nonColour/)
  })

  it('refuses a token that only an UNPAINTED border side could explain', { timeout: powershellTimeoutMs }, () => {
    // 未画的边不是证据：`border-top: none` 的元素，其 border-top-color 仍会算出 currentColor，
    // 于是"某一个没画出来的边恰好等于某个令牌"就能让记录通过——那是假通过。
    // 只有 rendered=true 的通道才允许参与令牌对账；四边都没画时该记录必须直接失败。
    const record = buildRecord({
      recordId: 'VC-02-unpainted-border',
      vc: 'VC-02',
      criterion: 'neutralScaleBorderToken',
      page: 'video-list',
      selector: '[data-testid="video-list-page"] header',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'border',
      border: { top: DARK_BORDER, right: DARK_BORDER, bottom: DARK_BORDER, left: DARK_BORDER },
      borderRendered: { top: false, right: false, bottom: false, left: false },
    }) as Record<string, any>
    record.declaredToken = { name: '--color-border', value: '#8f8f8f', source: 'visual-contract.md §5.5' }
    const dir = createPackage({ tested: ['VC-02'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'an unpainted border must not explain a border token').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/rendered|被绘制|未渲染/i)
  })

  it('accepts a border token explained by a PAINTED side even when the other three are not painted', { timeout: powershellTimeoutMs }, () => {
    // 配对的正例，也就是设置页顶栏的真实形状：只有 border-bottom 被画出来（其余三边
    // border-*-style: none、计算值等于 currentColor）。令牌出现在**被画出**的那条边上，必须通过；
    // fg（进而对比度）也必须是那条被画边的颜色。
    const record = buildRecord({
      recordId: 'VC-02-painted-bottom-only',
      vc: 'VC-02',
      criterion: 'neutralScaleBorderToken',
      page: 'settings',
      selector: '[data-testid="settings-page"] > div',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'border',
      fg: [110, 112, 116],
      bg: [22, 27, 34],
      threshold: 3,
      thresholdBasis: 'nonText',
      // three sides are currentColor (= the text colour), only the bottom carries COLORS.border
      border: { top: [230, 237, 243], right: [230, 237, 243], bottom: [110, 112, 116], left: [230, 237, 243] },
      borderRendered: { top: false, right: false, bottom: true, left: false },
      computedBorder: {
        topWidth: '0px',
        topStyle: 'none',
        rightWidth: '0px',
        rightStyle: 'none',
        bottomWidth: '1px',
        bottomStyle: 'solid',
        leftWidth: '0px',
        leftStyle: 'none',
      },
    }) as Record<string, any>
    record.declaredToken = { name: 'COLORS.border', value: '#6e7074', source: 'visual-contract.md §5.5' }
    const dir = createPackage({ tested: ['VC-02'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, `a token on the one painted side must pass; ${result.stdout}${result.stderr}`).toBe(0)
  })

  it('refuses a graphic token that only the TEXT channel could explain', { timeout: powershellTimeoutMs }, () => {
    // 角色通道集合必须互不串味：role=graphic 的候选通道里曾包含 measured.fg（文字色），
    // 于是"给一个图形判据声明文字色令牌"也能通过。去掉 fg 之后，这条必须失败。
    const record = buildRecord({
      recordId: 'VC-03-graphic-token-is-text-colour',
      vc: 'VC-03',
      criterion: 'focusRing2pxDashedFg',
      page: 'video-list',
      selector: '[data-testid="video-list-page"] header button',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'graphic',
      fg: DARK_FG,
      // no graphic channel is painted at all: the only channel holding #e5e5e5 is the text colour
      borderRendered: { top: false, right: false, bottom: false, left: false },
      outlineRendered: false,
    }) as Record<string, any>
    record.declaredToken = { name: '--color-fg', value: '#e5e5e5', source: 'visual-contract.md §5.5' }
    const dir = createPackage({ tested: ['VC-03'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'a text colour must not explain a graphic-role token').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/graphic/)
  })

  it('refuses a channel whose declaredComputed cannot produce the recorded composited value', { timeout: powershellTimeoutMs }, () => {
    // 复算出同一条通道的合成值（不透明值直接比，半透明值按 §3.2 合成到底色上再比）。
    // 采集器在解析失败时曾用"合成底色"充当通道值——那种自造值与真测值在结构上无法区分，
    // 而这条一致性断言会把它们分开：声明的原始值与实测通道对不上就是失败。
    const record = buildRecord({
      recordId: 'VC-02-fabricated-channel',
      vc: 'VC-02',
      criterion: 'neutralScaleBorderToken',
      page: 'video-list',
      selector: '[data-testid="video-list-page"] header',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'border',
      border: { top: DARK_BORDER, right: DARK_BORDER, bottom: DARK_BORDER, left: DARK_BORDER },
      borderRendered: { top: true, right: true, bottom: true, left: true },
      // the raw computed colour is a different colour than the recorded channel
      borderDeclaredComputed: { top: 'rgb(1, 2, 3)', right: 'rgb(1, 2, 3)', bottom: 'rgb(1, 2, 3)', left: 'rgb(1, 2, 3)' },
    }) as Record<string, any>
    record.declaredToken = { name: '--color-border', value: '#8f8f8f', source: 'visual-contract.md §5.5' }
    const dir = createPackage({ tested: ['VC-02'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'a channel that its own declaredComputed cannot produce must fail').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/declaredComputed/)
  })

  it('refuses a self-declared rendered flag that contradicts the record own computedStyle', { timeout: powershellTimeoutMs }, () => {
    // `rendered` 是**自报**字段：上一版只接受记录自己写的布尔值，从不与同一条记录里必填的
    // computedStyle 交叉核对。于是只要采集器把 rendered 取自错误的属性（或某边 style 为 none /
    // width:0），"未画的边不算证据"这道门控就会整体失效，而且没有任何测试会红。
    // 现在：声明 rendered=true 的边，其 computedStyle 必须给出 style≠none 且 width>0（反之亦然）。
    const record = buildRecord({
      recordId: 'VC-02-rendered-contradicts-computed-style',
      vc: 'VC-02',
      criterion: 'neutralScaleBorderToken',
      page: 'video-list',
      selector: '[data-testid="video-list-page"] header',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'border',
      border: { top: DARK_BORDER, right: DARK_BORDER, bottom: DARK_BORDER, left: DARK_BORDER },
      borderRendered: { top: true, right: true, bottom: true, left: true },
      // …but the very same record says every one of those sides is `none` / `0px`
      computedBorder: {
        topWidth: '0px',
        topStyle: 'none',
        rightWidth: '0px',
        rightStyle: 'none',
        bottomWidth: '0px',
        bottomStyle: 'none',
        leftWidth: '0px',
        leftStyle: 'none',
      },
    }) as Record<string, any>
    record.declaredToken = { name: '--color-border', value: '#8f8f8f', source: 'visual-contract.md §5.5' }
    const dir = createPackage({ tested: ['VC-02'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'a rendered flag that the record own computedStyle contradicts must fail').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/rendered/)
  })

  it('refuses a border record whose reported contrast comes from an UNPAINTED side', { timeout: powershellTimeoutMs }, () => {
    // §3.4 第 3 项的对比度由 measured.fg/bg 算出。对边框判据，fg 必须是**被画出来的那个颜色**，
    // 否则报出的比值与它要判的颜色无关：真实反例是只有 border-bottom 的元素，fg 曾取未画的
    // top 边（= currentColor = 文字色）→ 报 14.64:1，而被画的那条边其实只有 3.49:1；
    // 边框掉到 1.21:1 时这条记录报出的数字仍然不变，审查员照抄就会得到相反结论。
    const record = buildRecord({
      recordId: 'VC-02-contrast-from-unpainted-side',
      vc: 'VC-02',
      criterion: 'neutralScaleBorderToken',
      page: 'settings',
      selector: '[data-testid="settings-page"] > div',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'border',
      // the fg (and therefore the contrast) is the text colour of an unpainted side
      fg: [230, 237, 243],
      bg: [22, 27, 34],
      border: { top: [230, 237, 243], right: [230, 237, 243], bottom: [110, 112, 116], left: [230, 237, 243] },
      borderRendered: { top: false, right: false, bottom: true, left: false },
      computedBorder: {
        topWidth: '0px',
        topStyle: 'none',
        rightWidth: '0px',
        rightStyle: 'none',
        bottomWidth: '1px',
        bottomStyle: 'solid',
        leftWidth: '0px',
        leftStyle: 'none',
      },
    }) as Record<string, any>
    record.declaredToken = { name: 'COLORS.border', value: '#6e7074', source: 'visual-contract.md §5.5' }
    const dir = createPackage({ tested: ['VC-02'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'a contrast taken from an unpainted side must fail').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/fg/)
  })

  it('accepts a border record whose fg IS the painted side colour and whose rendered flags match computedStyle', { timeout: powershellTimeoutMs }, () => {
    // fg 取的就是那条被画边的颜色（#6e7074 压面板 = 3.49:1），四边 rendered 与 computedStyle 一致。
    const record = buildRecord({
      recordId: 'VC-02-painted-fg',
      vc: 'VC-02',
      criterion: 'neutralScaleBorderToken',
      page: 'settings',
      selector: '[data-testid="settings-page"] > div',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'border',
      fg: [110, 112, 116],
      bg: [22, 27, 34],
      border: { top: [230, 237, 243], right: [230, 237, 243], bottom: [110, 112, 116], left: [230, 237, 243] },
      borderRendered: { top: false, right: false, bottom: true, left: false },
      computedBorder: {
        topWidth: '0px',
        topStyle: 'none',
        rightWidth: '0px',
        rightStyle: 'none',
        bottomWidth: '1px',
        bottomStyle: 'solid',
        leftWidth: '0px',
        leftStyle: 'none',
      },
    }) as Record<string, any>
    record.declaredToken = { name: 'COLORS.border', value: '#6e7074', source: 'visual-contract.md §5.5' }
    const dir = createPackage({ tested: ['VC-02'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, `the honest painted-side shape must pass; ${result.stdout}${result.stderr}`).toBe(0)
  })

  it('refuses a TOKEN-LESS border record whose fg comes from an unpainted side', { timeout: powershellTimeoutMs }, () => {
    // 上一轮把"fg 必须是被画出边的颜色"这条检查写在了 declaredToken 分支里，于是**没有令牌**的
    // border 记录整条绕过它。这条检查必须独立于 declaredToken 成立——记录有没有令牌，
    // 它都会报出一个对比度，那个数字都必须与它要判的颜色有关。
    const record = buildRecord({
      recordId: 'VC-02-tokenless-border-fg-is-current-colour',
      vc: 'VC-02',
      criterion: 'neutralScaleBorderToken',
      page: 'settings',
      selector: '[data-testid="settings-page"] > div',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'border',
      // fg (and the reported contrast) is the text colour; the only painted side is the bottom one
      fg: [229, 229, 229],
      bg: [22, 27, 34],
      border: { top: [229, 229, 229], right: [229, 229, 229], bottom: [143, 143, 143], left: [229, 229, 229] },
      borderRendered: { top: false, right: false, bottom: true, left: false },
      computedBorder: {
        topWidth: '0px',
        topStyle: 'none',
        rightWidth: '0px',
        rightStyle: 'none',
        bottomWidth: '1px',
        bottomStyle: 'solid',
        leftWidth: '0px',
        leftStyle: 'none',
      },
    })
    const dir = createPackage({ tested: ['VC-02'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'a token-less border record must not report a contrast from an unpainted side').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/fg/)
  })

  it('refuses a text record whose measured fg contradicts its own computedStyle.color', { timeout: powershellTimeoutMs }, () => {
    // measured.fg/bg 此前只与记录内部的 declared 自洽比较，从不与同一条记录的 computedStyle 交叉核对。
    // 于是"computedStyle.color 与底色同色（真实对比度≈1:1），却自报 fg=#e5e5e5、对比度 14.64"也能通过。
    const record = buildRecord({
      recordId: 'VC-01-fg-contradicts-computed-style',
      vc: 'VC-01',
      criterion: 'backgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'text',
      fg: [229, 229, 229],
      bg: [26, 26, 26],
    }) as Record<string, any>
    // the record's own computed style says the text colour is the same as the background
    record.computedStyle.color = 'rgb(26, 26, 26)'
    const dir = createPackage({ tested: ['VC-01'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'an fg that contradicts computedStyle.color must fail').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/computedStyle\.color|fg/)
  })

  it('refuses a self-declared outline that no computed style backs', { timeout: powershellTimeoutMs }, () => {
    // 与四边边框同一形态的旁路：`measured.outline.rendered` 也是自报字段，而 computedStyle 里
    // 此前根本没有 outlineStyle/outlineWidth 可交叉核对——声明"画了聚焦圈"就能凭空成立。
    const record = buildRecord({
      recordId: 'VC-03-focus-ring-claims-unpainted-outline',
      vc: 'VC-03',
      criterion: 'focusRing2pxDashedFg',
      page: 'video-list',
      selector: '[data-testid="video-list-page"] header button',
      screenshots: ['screenshots/01-video-list.png'],
      role: 'graphic',
      // The focus ring is drawn with --color-fg, i.e. the element's own colour, so fg == outline here and
      // the ONLY inconsistency left is the self-declared `rendered` against computedStyle.
      fg: DARK_FG,
      outline: DARK_FG,
      outlineRendered: true,
      computedBorder: { outlineStyle: 'none', outlineWidth: '0px' },
    })
    const dir = createPackage({ tested: ['VC-03'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'an outline rendered flag that computedStyle contradicts must fail').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/outline/i)
  })

  it('refuses a record that claims a composited value while its own metadata says otherwise', { timeout: powershellTimeoutMs }, () => {
    // fg/bg 的 alpha 与 composited 是**自报**元数据（"这个值是不是按 §3.2 合成出来的"）。
    // 此前它们从不与 declared 对账，于是一条记录可以自称"合成过了"，而 declared/rgba8 其实是原值。
    const record = buildRecord({
      recordId: 'VC-01-composited-claims',
      vc: 'VC-01',
      criterion: 'backgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
    }) as Record<string, any>
    // the declared foregound is opaque while the record claims alpha 0.42 / composited true
    record.measured.fg.alpha = 0.42
    record.measured.fg.composited = true
    const dir = createPackage({ tested: ['VC-01'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'self-reported alpha/composited must be reconcilable with declared').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/alpha|composited/)
  })

  it('refuses a package that declares no provenance at all', { timeout: powershellTimeoutMs }, () => {
    // 同一个形状既能由真实采集产出、也能由"把旧数据改写成新形状"的演练产出。没有包级溯源字段时，
    // 「同一个包名 + 同一个 generatedBy + 校验器判 VALID」会被后来的人当成证据。
    const record = buildRecord({
      recordId: 'VC-01-no-provenance',
      vc: 'VC-01',
      criterion: 'backgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
    })
    const dir = createPackage({ tested: ['VC-01'], records: [record], omitManifestKey: 'provenance' })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'a package without provenance must fail').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/provenance/)
  })

  it('accepts a rehearsal-shaped package but refuses to call it VISUAL_EVIDENCE_VALID', { timeout: powershellTimeoutMs }, () => {
    // 演练包的形状可以完全合法，但措辞必须与真采集区分开：形状一样、含义完全不同。
    const record = buildRecord({
      recordId: 'VC-01-rehearsal',
      vc: 'VC-01',
      criterion: 'backgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
    })
    const dir = createPackage({ tested: ['VC-01'], records: [record], provenance: 'rehearsal' })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'a rehearsal package is shape-valid').toBe(0)
    expect(result.stdout, 'a rehearsal package must not be reported as VISUAL_EVIDENCE_VALID').toMatch(/VISUAL_EVIDENCE_VALID_REHEARSAL/)
    expect(result.stdout, 'a rehearsal package must say it is not evidence').toMatch(/不是真实采集证据|不得当证据/)
  })
})

/* ------------------------------------------------------------------ *
 * ⑤c 宿主版本绑定的降级前提：有前提的降级必须把前提写进包里
 * ------------------------------------------------------------------ */

describe('visual evidence validator: host version binding premise', () => {
  const preflightSource = { runtimeVersionSource: 'preflight-devtools' }

  it('rejects a declared preflight downgrade that does not record the premise it rests on', { timeout: powershellTimeoutMs }, () => {
    // 驱动拉起的应用不开调试端口时，版本取自**预检**（同一个 rain.exe、同一台机器）——这是**降级**，
    // 只有当"机器级 Evergreen 安装存在且应用旁边没有固定版本运行时"这条前提成立时，同机读数才等价。
    // 前提不写进包，包就无法自证这条绑定的强度，只能靠读日志猜——那正是本轮要堵的洞。
    const record = buildRecord({
      recordId: 'VC-01-premise-missing',
      vc: 'VC-01',
      criterion: 'backgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
    })
    const dir = createPackage({ tested: ['VC-01'], records: [record], webview2: preflightSource })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'a preflight downgrade without its premise must fail').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/premise/i)
  })

  it('accepts a declared preflight downgrade whose premise is recorded and established', { timeout: powershellTimeoutMs }, () => {
    // 配对的正例：同一个降级，只要前提被记录且成立，就必须通过——证明上一条失败是因为缺前提，
    // 不是因为校验器一律拒绝 preflight-devtools。
    const record = buildRecord({
      recordId: 'VC-01-premise-established',
      vc: 'VC-01',
      criterion: 'backgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
    })
    const dir = createPackage({
      tested: ['VC-01'],
      records: [record],
      webview2: {
        ...preflightSource,
        premise: {
          machineLevelEvergreenPresent: true,
          fixedVersionRuntimePresent: false,
          evergreenRuntimeVersions: '153.0.4234.48',
          established: true,
          statement: 'machine-level Evergreen install present and no fixed-version runtime alongside the app',
        },
      },
    })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, `an established premise must be accepted; ${result.stdout}${result.stderr}`).toBe(0)
  })

  it('rejects a declared preflight downgrade whose premise explicitly did NOT hold', { timeout: powershellTimeoutMs }, () => {
    // 前提被记录、但记录的是"不成立"时，不能靠"字段存在"蒙混过关：降级就成了无依据的等价替代。
    const record = buildRecord({
      recordId: 'VC-01-premise-failed',
      vc: 'VC-01',
      criterion: 'backgroundLuminanceBelow0.05',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
    })
    const dir = createPackage({
      tested: ['VC-01'],
      records: [record],
      webview2: {
        ...preflightSource,
        premise: {
          machineLevelEvergreenPresent: false,
          fixedVersionRuntimePresent: false,
          evergreenRuntimeVersions: '(none found on this host)',
          established: false,
          statement: 'PREMISE NOT ESTABLISHED',
        },
      },
    })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status, 'a premise recorded as not established must fail').not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/premise|前提/i)
  })
})

/* ------------------------------------------------------------------ *
 * ⑥ 覆盖清单与记录必须一一对应
 * ------------------------------------------------------------------ */

describe('visual evidence validator: coverage honesty', () => {
  it('rejects a record for a VC that is listed as untested', { timeout: powershellTimeoutMs }, () => {
    const record = buildRecord({
      recordId: 'VC-07-not-declared',
      vc: 'VC-07',
      criterion: 'statusColourSet',
      page: 'video-list',
      selector: '[data-testid^="badge-"]',
      screenshots: ['screenshots/01-video-list.png'],
    })
    const dir = createPackage({ tested: ['VC-01'], records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/VC-07/)
  })

  it('rejects a VC that is listed as tested but has no measurement record', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage({ tested: ['VC-01', 'VC-02'] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/VC-02/)
  })

  it('rejects an unknown VC id, including the reserved VC-18', { timeout: powershellTimeoutMs }, () => {
    const record = buildRecord({
      recordId: 'VC-18-reserved',
      vc: 'VC-18',
      criterion: 'proposedDecision80',
      page: 'video-list',
      selector: 'body',
      screenshots: ['screenshots/01-video-list.png'],
    })
    const dir = createPackage({ tested: ['VC-18'], untested: contractIds, records: [record] })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/VC-18/)
  })

  it('refuses to treat a claimed verdict as issued by this package', { timeout: powershellTimeoutMs }, () => {
    const dir = createPackage({
      manifestOverrides: {
        verdicts: { issued: true, issuedBy: 'the implementer', note: 'looks fine' },
      },
    })
    const result = runValidator(['-EvidenceRoot', dir])

    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toMatch(/verdict/i)
  })
})

/* ------------------------------------------------------------------ *
 * ⑦ 通道文件的存在与形态（采集脚本 / workflow / 目录约定）
 * ------------------------------------------------------------------ */

describe('visual evidence channel: files and conventions', () => {
  it('ships a collector that writes the evidence/visual-<sha8>-<timestamp> package directory', () => {
    const collector = readFileSync(collectorScript, 'utf8')

    expect(collector).toMatch(/evidence[\\/]visual-/)
    expect(collector).toMatch(/yyyyMMdd-HHmmss|ToString\('yyyyMMdd-HHmmss'\)/)
    expect(collector).toMatch(/devicePixelRatio/)
    expect(collector).toMatch(/getBoundingClientRect/)
    expect(collector).toMatch(/getComputedStyle/)
    expect(collector).toMatch(/WCAG21/)
    // §3.4 第 1–3 项必须在同一次运行内采集：目标 SHA、截图、逐条实测记录。
    expect(collector).toMatch(/commitSha/)
    expect(collector).toMatch(/\/screenshot/)
  })

  it('ships a workflow with workflow_dispatch and pull_request triggers on windows-2025', () => {
    const workflow = readFileSync(workflowFile, 'utf8')

    expect(workflow).toMatch(/workflow_dispatch:/)
    expect(workflow).toMatch(/pull_request:/)
    expect(workflow).toMatch(/runs-on:\s*windows-2025/)
    expect(workflow).toMatch(/actions\/upload-artifact@v\d+/)
    expect(workflow).toMatch(/GITHUB_STEP_SUMMARY/)
    expect(workflow).toMatch(/validate-visual-evidence\.ps1/)
    expect(workflow).toMatch(/campaign-visual-evidence\.ps1/)
  })

  it('does not widen or rewrite the four existing desktop E2E workflows', () => {
    const existing = [
      'study-catalog-desktop-e2e.yml',
      'video-list-desktop-e2e.yml',
      'runtime-settings-desktop-e2e.yml',
      'harness.yml',
    ]
    for (const name of existing) {
      const text = readFileSync(join(repoRoot, '.github', 'workflows', name), 'utf8')
      // 既有 workflow 的 paths 过滤表与 concurrency 不得被本通道改写（只允许注释里提到本通道）。
      expect(text).not.toMatch(/campaign-visual-evidence\.ps1/)
      expect(text).not.toMatch(/validate-visual-evidence/)
      expect(text).not.toMatch(/visual-evidence\.yml/)
      expect(text).not.toMatch(/group:\s*visual-evidence/)
    }
  })

  it('does not redefine or import the ASR/database evidence validator', () => {
    const validator = readFileSync(validatorScript, 'utf8')

    // 只允许在说明文字里点出「不是它由谁裁判」；不得真的调用它、也不得复用它的领域字段。
    expect(validator).not.toMatch(/&\s*[^\r\n]*validate-evidence\.ps1/)
    expect(validator).not.toMatch(/ExpectedVideoSha256/)
    expect(validator).not.toMatch(/whisper/i)
    expect(validator).not.toMatch(/manualReviewSamples|structuringBlocks|cancellation-proof/)
  })

  it('ships PowerShell scripts that Windows PowerShell 5.1 can decode (UTF-8 BOM)', () => {
    // 这两个脚本都含中文注释与中文失败信息。Windows PowerShell 5.1 对**无 BOM** 的文件按 ANSI 解码，
    // 中文会变成乱码并可能直接让解析器失败（本轮实测过：AST 报 97 个语法错误）。
    for (const script of [validatorScript, collectorScript]) {
      const bytes = readFileSync(script)
      const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      expect(hasBom, `${script} must start with a UTF-8 BOM`).toBe(true)
    }
  })

  it('ships a PowerShell scripts whose injected probe JavaScript is syntactically valid', () => {
    // 采集器把一整段 JS 作为 here-string 注入页面。这段 JS 一旦语法错，整条通道在托管 runner 上
    // 只会以「探针超时」的形式失败，本地看不出原因。这里把它抽出来按 W3C execute/sync 的语义
    // （脚本体会被包进一个函数体）交给 node --check 做语法检查。
    const collector = readFileSync(collectorScript, 'utf8').split('\n')
    const startMarker = '$probeScript = @\''
    let start = -1
    let end = -1
    for (let index = 0; index < collector.length; index += 1) {
      if (start === -1 && collector[index].trim() === startMarker) {
        start = index + 1
        continue
      }
      if (start !== -1 && collector[index].trim() === "'@") {
        end = index - 1
        break
      }
    }
    expect(start, 'probe here-string opening not found').toBeGreaterThan(-1)
    expect(end, 'probe here-string terminator not found').toBeGreaterThan(start)

    const probe = collector.slice(start, end + 1).join('\n')
    expect(probe.length).toBeGreaterThan(2000)
    expect(probe).toContain('getBoundingClientRect')
    expect(probe).toContain('getComputedStyle')
    expect(probe).toContain('WCAG21:(L1+0.05)/(L2+0.05)')

    const dir = mkdtempSync(join(tmpdir(), 'rain-visual-probe-'))
    const probePath = join(dir, 'probe.js')
    writeFileSync(probePath, `function __webdriverExecuteSync() {\n${probe}\n}\n`, 'utf8')
    const result = (() => {
      try {
        execFileSync(process.execPath, ['--check', probePath], { encoding: 'utf8', stdio: 'pipe' })
        return 0
      } catch (cause) {
        return (cause as { status?: number }).status ?? 1
      }
    })()
    expect(result, `node --check on the extracted probe JS failed (exit ${result})`).toBe(0)
  })

  it('keeps the tested ids in the collector backed by at least one measurement record each', () => {
    // 「已测」不能只是清单里的一行：采集器声明的每个 testedId 都必须在同一文件里有对应的 spec。
    const collector = readFileSync(collectorScript, 'utf8')
    const testedMatch = collector.match(/\$testedIds\s*=\s*@\(([^)]*)\)/)
    expect(testedMatch, '$testedIds not found in the collector').not.toBeNull()
    const tested = [...(testedMatch as RegExpMatchArray)[1].matchAll(/'(VC-\d\d)'/g)].map((match) => match[1])
    expect(tested.length).toBeGreaterThan(0)

    const untestedMatch = collector.match(/\$untestedIds\s*=\s*@\(([^)]*)\)/)
    expect(untestedMatch, '$untestedIds not found in the collector').not.toBeNull()
    expect((untestedMatch as RegExpMatchArray)[1]).toContain('$testedIds')

    for (const id of tested) {
      // 每个已测编号至少要有一条 vc = '<id>' 的 spec（含 focus / spacing / token 等具体维度）。
      const specPattern = new RegExp(`vc = '${id}'`)
      expect(specPattern.test(collector), `no collector spec claims ${id} while it is listed as tested`).toBe(true)
    }

    // 合同 §4 的 18 个编号必须恰好被 tested ∪ untested 覆盖（VC-18 是保留空号，不得入表）。
    const contractIdsMatch = collector.match(/\$contractIds\s*=\s*@\(([\s\S]*?)\)\s*\n/)
    expect(contractIdsMatch, '$contractIds not found in the collector').not.toBeNull()
    const contractIdsInCollector = [...(contractIdsMatch as RegExpMatchArray)[1].matchAll(/'(VC-\d\d)'/g)].map((match) => match[1])
    expect(contractIdsInCollector).toEqual(contractIds)
  })

  it('parses every PowerShell block inside the workflow with the real PowerShell parser', () => {
    // 这是本轮被独立审查抓到的真实缺陷的守卫：workflow 里 `shell: pwsh` 的 run 块此前从未被解析过，
    // 一个行尾逗号就让整个 step 语法错误、workflow 永远跑不绿。这里把每个 pwsh 块抽出来交给
    // PowerShell 自己的 AST 解析器（不是文本 grep）。
    const workflow = readFileSync(workflowFile, 'utf8')
    const lines = workflow.split('\n')
    const blocks: string[] = []
    let index = 0
    while (index < lines.length) {
      const shellMatch = lines[index].match(/^(\s*)shell:\s*pwsh\s*$/)
      if (!shellMatch) {
        index += 1
        continue
      }
      const indent = shellMatch[1].length
      let runIndex = index + 1
      while (runIndex < lines.length && !/^\s*run:\s*\|/.test(lines[runIndex])) runIndex += 1
      expect(runIndex, `no "run: |" after the shell: pwsh at line ${index + 1}`).toBeLessThan(lines.length)
      let bodyEnd = runIndex + 1
      while (bodyEnd < lines.length) {
        const bodyLine = lines[bodyEnd]
        if (bodyLine.trim() !== '' && bodyLine.match(/^(\s*)/)?.[1].length <= indent) break
        bodyEnd += 1
      }
      const body = lines.slice(runIndex + 1, bodyEnd).join('\n')
      const deindented = body
        .split('\n')
        .map((line) => (line.startsWith(' '.repeat(indent + 2)) ? line.slice(indent + 2) : line))
        .join('\n')
      blocks.push(deindented)
      index = bodyEnd
    }

    // 断言块数与工作流里 `shell: pwsh` 的**实际出现次数**一致 —— 独立计数，不用抽取器的结果自证。
    // 没有这条时，"某块被解析成 0 行"会静默通过（抽取器仍说它抽到了块）。
    // 下界 > 0 太弱：真正的下界是工作流里真实存在的块数。
    const declaredPwshShells = (readFileSync(workflowFile, 'utf8').match(/^\s*shell:\s*pwsh\s*$/gm) ?? []).length
    expect(declaredPwshShells, 'the workflow must declare at least one shell: pwsh step').toBeGreaterThan(0)
    expect(blocks.length, `every shell: pwsh step must yield a block (workflow declares ${declaredPwshShells})`).toBe(
      declaredPwshShells,
    )
    // 每块都必须有实际内容：空块说明抽取的边界算错了，而不是"这个 step 没内容"。
    blocks.forEach((block, i) => {
      expect(block.split('\n').length, `block #${i + 1} must not be empty`).toBeGreaterThan(1)
    })

    const dir = mkdtempSync(join(tmpdir(), 'rain-visual-workflow-pwsh-'))
    // 把 N 块拼成**一次**解析调用：实测每起一次 powershell.exe 约 105ms（进程启动占绝对多数），
    // 7 块 = 7 次启动 ≈ 904ms，而一次调用解析全部 7 块 ≈ 122ms。托管负载下这个差值被放大，
    // 于是这条用例在 5s 上限处超时（master run 36544735506 实测 7510ms）。
    //
    // 为什么拼接**不降低**判据强度（这是 PR #68 曾否决过的方向，故必须论证）：
    //   ① 会漏检的构造：逐块与拼接在 PowerShell 里都是**脚本**上下文，但并非所有构造在两种方式下
    //      等价。实测至少 `using namespace ...` 在拼接后会报错（非首块的 using 在脚本里合法、
    //      拼到中间后非法），顶层 `return` / 顶层 `param(` 实测两种方式**都是 0 错**、
    //      因此拼接**并不更严**。真正会漏的是**跨块补偿式**错误（前一块未闭合、后一块把它补上）；
    //      本工作流 7 块实测不含 `using`，故当前两种方式结果一致，但这条边界如实记录在此。
    //   ② 如实说明强度变化：解析由"每块各一次"变成"拼成一次"，逐块的 expect 由 7 个降为 1 个。
    //      覆盖面没有变窄——**每一块的内容**仍然全部进入解析（块的数量与内容取自工作流文件的真实
    //      文本，本工作流实测 7 块，不是硬编码），单点缺陷实测仍全部检出；但"逐块各报一次错"
    //      这一形式上的强度确实下降了，这里不掩饰。
    //   ③ 出错时把 combined 行号**映射回块号 + 块内行号**，定位能力不降。
    //      该映射依赖 blockStartLine/blockEndLine，所以下面的行段对齐断言同时也是映射的自检；
    //      若某块被吞掉，会先在这里的对齐断言上失败（而不是等到解析报错）。
    //   ④ 行数守恒断言保证 combined 由"每块 1 行标记 + 全部块内容"构成，不丢行、不重复。
    const markers = blocks.map((_, i) => `# __RAIN_PWSH_BLOCK_${i}__`)
    const combinedLines: string[] = []
    const blockStartLine: number[] = []
    const blockEndLine: number[] = []
    blocks.forEach((block, i) => {
      blockStartLine.push(combinedLines.length + 2) // 1-based line after the marker
      combinedLines.push(markers[i])
      combinedLines.push(...block.split('\n'))
      blockEndLine.push(combinedLines.length)
    })
    const combined = combinedLines.join('\n')

    const combinedPath = join(dir, 'combined.ps1')
    // 必须以 UTF-8 **with BOM** 落盘：块里有中文，Windows PowerShell 5.1 对无 BOM 文件按 ANSI 解码，
    // 会把中文读成乱码并报出假的语法错误（本轮实测：同一块带 BOM = 0 errors、不带 BOM = 1 error）。
    writeFileSync(combinedPath, `\ufeff${combined}`, 'utf8')
    const check = [
      '$tokens = $null',
      '$errors = $null',
      `$null = [System.Management.Automation.Language.Parser]::ParseFile('${combinedPath.replace(/'/g, "''")}', [ref]$tokens, [ref]$errors)`,
      'if ($errors -and $errors.Count -gt 0) {',
      '  $errors | ForEach-Object { Write-Output ("L" + $_.Extent.StartLineNumber + ": " + $_.Message) }',
      '  exit 1',
      '}',
      'exit 0',
    ].join('\n')
    const checkPath = join(dir, 'check-combined.ps1')
    writeFileSync(checkPath, check, 'utf8')
    let status = 0
    let output = ''
    try {
      output = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', checkPath],
        { encoding: 'utf8', stdio: 'pipe' },
      )
    } catch (cause) {
      const failure = cause as { status?: number; stdout?: string }
      status = failure.status ?? 1
      output = failure.stdout ?? ''
    }
    // 把 combined 行号映射回「块号 + 块内行号」，避免定位能力下降
    const attribution = output
      .split('\n')
      .filter((line) => /^L\d+:/.test(line.trim()))
      .map((line) => {
        const lineNo = Number(line.trim().match(/^L(\d+):/)?.[1] ?? 0)
        const blockIndex = blockStartLine.findIndex((start, i) => lineNo >= start && lineNo <= blockEndLine[i])
        const within = blockIndex >= 0 ? lineNo - blockStartLine[blockIndex] + 1 : -1
        return `  combined L${lineNo} -> block #${blockIndex + 1} line ${within}: ${line.trim().replace(/^L\d+:\s*/, '')}`
      })
      .join('\n')
    expect(
      status,
      `workflow pwsh blocks have PowerShell parse errors:\n${output}\n${attribution}\n--- blocks ---\n${blocks
        .map((b, i) => `# block ${i + 1}:\n${b}`)
        .join('\n')}`,
    ).toBe(0)
    // 每块内容必须落在 combined 里**它自己的行段**上。这正是 blockStartLine/blockEndLine 的语义，
    // 而上面的错误定位依赖这两个数组，所以这条断言同时保证：定位不会指向错误的块。
    // （此前这里是 `toContain(marker)`：标记由 blocks 自己映射出来，永远为真，等于什么都没断言。）
    const combinedFile = readFileSync(combinedPath, 'utf8')
    const combinedFileLines = combinedFile.split('\n')
    blocks.forEach((block, i) => {
      const blockLines = block.split('\n')
      expect(
        combinedFileLines.slice(blockStartLine[i] - 1, blockStartLine[i] - 1 + blockLines.length),
        `block #${i + 1} must occupy its recorded line range ${blockStartLine[i]}..${blockEndLine[i]}`,
      ).toEqual(blockLines)
    })
    // 行数守恒：combined = 每块的 1 行标记 + 块内容，任何块被吞掉/丢行都会在这里失败。
    expect(combinedFileLines.length, 'combined line count must equal markers plus all block lines').toBe(
      blocks.length + blocks.reduce((total, block) => total + block.split('\n').length, 0),
    )
    // 显式时限来自托管实测：本用例在 master 的 run 36544735506 以 “Test timed out in 5000ms” 失败，
    // 当次实测 7510ms（本机同一版本 1155ms，负载系数约 6.5×）。现已合并为单次解析（本机约 177ms），
    // 断言语义未变，这里按 PR #68 的既有形状把上限标定为 20s。
  }, 20_000)

  it('backs every declared sweep in the manifest with an actual accentSweep record', { timeout: powershellTimeoutMs }, () => {
    // t2 对抗性复核用一个「manifest 声明 3 条 sweep、记录 0 条」的包证明了旧校验器会放行。
    const sweep = {
      recordId: 'VC-03-list-accent-sweep',
      vc: 'VC-03',
      criterion: 'noBrandAccentAnywhere',
      page: 'video-list',
      measurementScope: 'accentSweep',
      selector: '[data-testid="video-list-page"]',
      description: 'VC-03① sweep',
      sampledViewport: { width: 1280, height: 720, devicePixelRatio: 1, sampledAt: '2026-09-28T00:00:00.000Z' },
      screenshots: ['screenshots/01-video-list.png'],
      accentSweep: {
        accentToken: '#4a9eff',
        tolerancePerChannel: 1,
        selectorScope: '[data-testid="video-list-page"]',
        scannedElementCount: 42,
        scannedProperties: ['backgroundColor', 'borderTopColor', 'outlineColor', 'color'],
        matches: [],
      },
    }

    const declaredWithoutRecord = createPackage({
      tested: ['VC-03'],
      records: [
        buildRecord({
          recordId: 'VC-03-list-import-button',
          vc: 'VC-03',
          criterion: 'primaryButtonOutlinedText',
          page: 'video-list',
          selector: '[data-testid="video-list-page"] header button',
          screenshots: ['screenshots/01-video-list.png'],
        }),
      ],
      manifestOverrides: {
        accentSweeps: [
          { id: 'VC-03-list-accent-sweep', vc: 'VC-03', page: 'video-list', selectorScope: '[data-testid="video-list-page"]', accentToken: '#4a9eff' },
          { id: 'VC-03-settings-accent-sweep', vc: 'VC-03', page: 'settings', selectorScope: '[data-testid="settings-page"]', accentToken: '#4a9eff' },
        ],
      },
    })
    const missing = runValidator(['-EvidenceRoot', declaredWithoutRecord])
    expect(missing.status).not.toBe(0)
    expect(`${missing.stdout}${missing.stderr}`).toMatch(/VC-03-list-accent-sweep/)

    const declaredWithRecord = createPackage({
      tested: ['VC-03'],
      records: [sweep],
      manifestOverrides: {
        accentSweeps: [{ id: 'VC-03-list-accent-sweep', vc: 'VC-03', page: 'video-list', selectorScope: '[data-testid="video-list-page"]', accentToken: '#4a9eff' }],
      },
    })
    const consistent = runValidator(['-EvidenceRoot', declaredWithRecord])
    expect(consistent.stderr, `validator stderr: ${consistent.stderr}`).toBe('')
    expect(consistent.status, `validator stdout: ${consistent.stdout}${consistent.stderr}`).toBe(0)
  })

  it('parses the workflow YAML structure so a structural break cannot hide (no parser dependency)', () => {
    // t2 复核证明：只解析 PowerShell AST 时，YAML 结构性错误（重复键）会让整条通道永不运行而本地全绿。
    // 这里不引入依赖，做一个保守的结构检查：顶层键唯一、关键块存在、每个 job 有 runs-on 与 steps、
    // 每个 step 恰好一个 uses 或 run、run 块不被当成普通标量。
    const workflow = readFileSync(workflowFile, 'utf8')
    const lines = workflow.split('\n')

    const topLevelKeys: string[] = []
    for (const line of lines) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):/)
      if (match) topLevelKeys.push(match[1])
    }
    const duplicates = topLevelKeys.filter((key, index) => topLevelKeys.indexOf(key) !== index)
    expect(duplicates, `duplicate top-level YAML keys: ${duplicates.join(', ')}`).toEqual([])
    for (const required of ['name', 'on', 'permissions', 'concurrency', 'jobs']) {
      expect(topLevelKeys, `missing top-level key "${required}"`).toContain(required)
    }
      // 缩进必须全是空格（YAML 不允许 tab 缩进）。
      for (const [index, line] of lines.entries()) {
        expect(line.includes('\t'), `line ${index + 1} uses a tab for indentation`).toBe(false)
      }

      // 触发器块必须在 on: 之下（缩进两级），而不是顶层。
      expect(topLevelKeys, 'pull_request must not be a top-level key').not.toContain('pull_request')
      expect(workflow).toMatch(/^on:\s*$/m)
      expect(workflow).toMatch(/^ {2}pull_request:/m)
      expect(workflow).toMatch(/^ {2}workflow_dispatch:/m)

    // 每个 job：有 runs-on、有 steps；每个 step：恰好一个 uses 或 run。
    // job 只在 `jobs:` 块之内（否则 `on:` 下的 pull_request/workflow_dispatch 会被误当 job）。
    const jobsIndex = lines.findIndex((line) => /^jobs:\s*$/.test(line))
    expect(jobsIndex, 'no top-level jobs: block').toBeGreaterThan(-1)
    const jobIndices = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line, index }) => index > jobsIndex && /^ {2}[A-Za-z_][A-Za-z0-9_-]*:\s*$/.test(line))
    expect(jobIndices.length).toBeGreaterThan(0)
    for (const { line, index } of jobIndices) {
      const jobName = line.trim().replace(':', '')
      // 收集该 job 的正文（直到下一个同级或更浅的键）。
      let end = lines.length
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const bodyLine = lines[cursor]
        if (bodyLine.trim() !== '' && /^ {0,2}[A-Za-z_#]/.test(bodyLine)) {
          end = cursor
          break
        }
      }
      const body = lines.slice(index + 1, end)
      expect(body.some((entry) => /^\s{4}runs-on:/.test(entry)), `job "${jobName}" has no runs-on`).toBe(true)
      expect(body.some((entry) => /^\s{4}steps:\s*$/.test(entry)), `job "${jobName}" has no steps`).toBe(true)
      const stepStarts = body.filter((entry) => /^\s{6}- /.test(entry))
      expect(stepStarts.length, `job "${jobName}" has no steps`).toBeGreaterThan(0)
      for (const step of stepStarts) {
        const normalized = step.replace(/^\s{6}- /, '')
        const isUses = normalized.startsWith('uses:')
        const isName = normalized.startsWith('name:')
        expect(isUses || isName, `job "${jobName}" has a step that is neither name: nor uses: (${normalized})`).toBe(true)
      }
      const usesCount = body.filter((entry) => /^\s{8}uses:/.test(entry)).length
      const runCount = body.filter((entry) => /^\s{8}run:/.test(entry)).length
      expect(usesCount + runCount, `job "${jobName}" has ${stepStarts.length} steps but only ${usesCount + runCount} uses/run entries`).toBeGreaterThanOrEqual(stepStarts.length)
    }

    // run: | 必须真的进入块标量（后续行缩进比 run: 深）。
    for (const [index, line] of lines.entries()) {
      const runMatch = line.match(/^(\s*)run:\s*\|/)
      if (!runMatch) continue
      const next = lines[index + 1]
      expect(next, 'run: | block is empty').toBeTruthy()
      expect(
        next.startsWith(' '.repeat(runMatch[1].length + 2)),
        `run: | block at line ${index + 1} is not indented deeper than the key`,
      ).toBe(true)
    }

    // workflow_dispatch 必须真的可手动触发（inputs 允许，但至少要有该键）。
    expect(workflow).toMatch(/^ {2}workflow_dispatch:/m)
    expect(workflow).toMatch(/^ {2}pull_request:/m)
  })

  it('keeps both driver helpers at script top level, outside the main try (an in-try definition kills failure.json)', () => {
    // 真实回归（Standards 轴审查 blocker ①，本机已复现）：这两个函数曾被放进主 try 体内，
    // 而本脚本 :46 是 $ErrorActionPreference = 'Stop'。于是任何发生在定义**之前**的早期失败
    // （TargetSha 校验 / Require-Command / npm build / tauri build / 二进制检查 / 版本探测）
    // 都会让 finally 里的 Stop-VisualEvidenceDriver 变成**终止性**的 CommandNotFoundException，
    // finally 被中断 → failure.json 不写 → 真正的首个错误被掩盖。
    // 实测对比（同一段 finally，只改函数定义位置）：
    //   定义在 try 内 → 只输出 phase=build，无 DIAGNOSTICS-WRITTEN；
    //   定义在顶层   → STOP-CALLED / DIAGNOSTICS-WRITTEN / FINALLY-COMPLETED 都输出。
    // 第六次托管运行能拿到决定性现场全靠 failure.json，所以这条必须被机器守住。
    const collector = readFileSync(collectorScript, 'utf8')
    const linesAll = collector.split(/\r?\n/)

    // 主 try 体的行范围。
    // 用**字符串相等**而不是正则：正则里的大括号转义很容易写错（本项目已踩过一次），
    // 而这里要判的就是『整行恰好是这些字符』。
    // 锚点取列 0 的 `} finally {`，再往前找最近的列 0 `try {`；
    // 不能对 `try {` 直接取 findIndex——`} catch {` 的行尾也是 `try {` 形态，会被误命中。
    const finallyLine = linesAll.findIndex((line) => line === '} finally {')
    expect(finallyLine, 'the main try must have a column-0 finally').toBeGreaterThan(-1)
    let tryLine = -1
    for (let i = finallyLine - 1; i >= 0; i--) {
      if (linesAll[i] === 'try {') { tryLine = i; break }
    }
    expect(tryLine, 'the main try must start at column 0 before its finally').toBeGreaterThan(-1)
    expect(tryLine, 'the main try must close before the finally').toBeLessThan(finallyLine)

    // ① 两个驱动函数必须在 try 之外定义（与其余 20 个函数同处脚本顶层）。
    for (const name of ['Start-VisualEvidenceDriver', 'Stop-VisualEvidenceDriver']) {
      // 两种合法写法都要认：带参数表的 `function Name(...)`，以及无参数的 `function Name {`。
      const defLine = linesAll.findIndex((line) => line === 'function ' + name + ' {' || line.startsWith('function ' + name + '('))
      expect(defLine, 'function ' + name + ' must be defined at column 0').toBeGreaterThan(-1)
      expect(
        defLine < tryLine,
        name + ' is defined INSIDE the main try body; with $ErrorActionPreference = Stop the finally-block call would throw CommandNotFound and skip failure.json',
      ).toBe(true)
    }

    // ② finally 必须调用 Stop-VisualEvidenceDriver（否则驱动泄漏）。
    //    判定 finally 的**真实行范围**（到列 0 的收尾 `}` 为止），而不是取固定 N 行窗口——
    //    固定窗口是 magic number，且 finally 内容一改就会误判。
    let finallyEnd = -1
    for (let i = finallyLine + 1; i < linesAll.length; i++) {
      if (linesAll[i] === '}') { finallyEnd = i; break }
    }
    expect(finallyEnd, 'the finally body must close at column 0').toBeGreaterThan(finallyLine)
    const finallyBody = linesAll.slice(finallyLine, finallyEnd + 1).join('\n')
    expect(finallyBody, 'the finally must stop the driver').toContain('Stop-VisualEvidenceDriver')

    // ③ 驱动必须在唯一一处启动，且启动前已完成环境自证。
    const helperStart = collector.indexOf('function Start-VisualEvidenceDriver(')
    const helperEnd = collector.indexOf('function Stop-VisualEvidenceDriver {', helperStart)
    expect(helperEnd, 'the stop helper must follow the start helper').toBeGreaterThan(helperStart)
    const helperBody = collector.slice(helperStart, helperEnd)
    expect(collector.split('-FilePath $tauriDriver').length - 1, 'tauri-driver must be spawned in exactly one place').toBe(1)

    // 每个 helper 必须**只定义一次**。这是上一轮审查实测出的盲区：在 try 体内再写一个同名函数时，
    // 运行时后定义者胜、会把顶层那个遮蔽掉（原始 blocker 的新形态），而"列 0 判定"只看第一个匹配，
    // 于是守卫仍然全绿。计数断言才是能拦住它的那条。
    expect(
      collector.split('function Start-VisualEvidenceDriver(').length - 1,
      'Start-VisualEvidenceDriver must be defined exactly once; a second definition inside the try body would shadow the top-level one at runtime',
    ).toBe(1)
    expect(
      collector.split('function Stop-VisualEvidenceDriver {').length - 1,
      'Stop-VisualEvidenceDriver must be defined exactly once',
    ).toBe(1)

    // tauri-driver 要求 --port 与 --native-port **必须不同**。上一轮实测：按模式只给 --port 加 index 时，
    // 第 2 个模式拿到 --port 4461 而 --native-port 恒为 4461 —— 两个端口撞在一起，会话必然起不来。
    // 端口不等这条守卫必须用**结构断言**，不能用文本 grep：上一轮审查实测，把整块 if 删掉只留注释
    // 里的字样、或把条件取反成 -ne，两种改法都能骗过文本 grep（57 passed 全绿）。
    // 这里用真正的 PowerShell 解析器问 AST：那个 IfStatement 的条件运算符是不是 -eq、
    // 条件左值是不是 $Port、右值是不是 $NativePort，以及 body 第一条语句是不是 throw。
    const portGuard = runPowerShellJson(`
 $errors = $null
 if (-not (Test-Path -LiteralPath '${collectorScriptPathForPowerShell}')) {
   throw ('collector not found at ' + '${collectorScriptPathForPowerShell}')
 }
 $ast = [System.Management.Automation.Language.Parser]::ParseFile('${collectorScriptPathForPowerShell}', [ref]$null, [ref]$errors)
 $guards = @()
 foreach ($if in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.IfStatementAst] }, $true)) {
   $cond = $if.Clauses[0].Item1
   $body = @($if.Clauses[0].Item2.Statements)
   # 每一个值都先算成普通变量再放进哈希。PowerShell 5.1 的 ConvertTo-Json 在哈希字面量里
   # 直接写内联 if 表达式时**不引键名**，会输出 {guards:[{condition:...} 这种非法 JSON
   # （本仓实测），因此这里绝不把 if 留在字面量里面。
   $conditionText = ''
   $operatorText = ''
   $leftText = ''
   $rightText = ''
   $firstStatementText = ''
   $conditionText = [string]$cond.Extent.Text
   if ($body.Count -gt 0) { $firstStatementText = [string]$body[0].GetType().Name }
   # if ($a -eq $b) 的条件是 PipelineAst 套 CommandExpressionAst，真正的 BinaryExpressionAst
   # 在 .Expression 里。不脱这一层，operator/left/right 会全是空串——断言就会以"找不到守卫"
   # 的形式失败，而那其实是在**测量空气**（本仓实测）。
   $expr = $cond
   if ($cond -is [System.Management.Automation.Language.PipelineAst]) {
     $elements = @($cond.PipelineElements)
     if ($elements.Count -eq 1 -and $elements[0] -is [System.Management.Automation.Language.CommandExpressionAst]) {
       $expr = $elements[0].Expression
     }
   }
   if ($expr -is [System.Management.Automation.Language.BinaryExpressionAst]) {
     $operatorText = [string]$expr.Operator.ToString()
     $leftText = [string]$expr.Left.Extent.Text
     $rightText = [string]$expr.Right.Extent.Text
   }
   $guards += [ordered]@{
     condition = $conditionText
     operator = $operatorText
     left = $leftText
     right = $rightText
     firstStatement = $firstStatementText
   }
 }
 $errorCount = @($errors).Count
 $payload = [ordered]@{ parseErrors = $errorCount; guards = $guards }
 ConvertTo-Json -InputObject $payload -Depth 8 -Compress
`)
    const guards = portGuard.guards
    expect(portGuard.parseErrors, 'the collector must parse with zero errors').toBe(0)
    expect(
      (guards as unknown[]).length,
      'the probe must actually see the collector\'s conditionals; an empty guard list means it measured nothing',
    ).toBeGreaterThan(30)
    const equalPortGuard = guards.find(
      (g) => g.left === '$Port' && g.right === '$NativePort',
    )
    expect(equalPortGuard, 'a guard comparing $Port with $NativePort must exist').toBeTruthy()
    expect(
      equalPortGuard.operator,
      "the guard must use -eq; inverting it to -ne quietly disables the protection while looking similar",
    ).toBe('Ieq')
    expect(
      equalPortGuard.firstStatement,
      'the guard body must throw when the two ports are equal',
    ).toBe('ThrowStatementAst')
    expect(collector, 'the per-mode native port must be derived alongside the driver port').toContain('$modeNativeDriverPort = $NativeDriverPort + $runModeIndex')
    expect(collector, 'the per-mode call must pass both ports').toContain('-Port $modeDriverPort -NativePort $modeNativeDriverPort')
    expect(helperBody, 'the spawn must live inside the helper').toContain('-FilePath $tauriDriver')
    expect(helperBody, 'the helper must wait for the driver port before returning').toContain('Wait-WebDriver $Port')
    expect(helperBody, 'a driver that dies during startup must not be reported as ready').toContain('HasExited')
    const assertIdx = helperBody.indexOf('RAIN_E2E_RUN_MODE must equal the mode being collected')
    const spawnIdx = helperBody.indexOf('-FilePath $tauriDriver')
    expect(assertIdx, 'the helper must self-check the run-mode env').toBeGreaterThan(-1)
    expect(
      assertIdx < spawnIdx,
      'the self-check must run BEFORE the spawn; running it after Wait-WebDriver cannot prevent a bad launch',
    ).toBe(true)

    // ④ 每模式的驱动端口必须写回**脚本级** $DriverPort —— Invoke-WebDriver(:524) 读的是脚本作用域。
    //    写成 `$DriverPort = $Port` 只会建一个局部变量（实测 inside=4461 / after=4460），
    //    于是所有 WebDriver 请求仍打旧端口，而新驱动在另一个端口上监听。
    expect(
      helperBody,
      'the helper must assign $script:DriverPort; a bare assignment is local-only and Invoke-WebDriver would keep using the old port',
    ).toContain('$script:DriverPort = $Port')
    // 用**整行相等**判定，比后顾断言直白且可靠：不得存在未加 $script: 的端口赋值行。
    // （后顾断言在这里帮不上忙——`$script:DriverPort = $Port` 本身就以 `$DriverPort = $Port` 结尾。）
    const barePortAssign = helperBody
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line === '$DriverPort = $Port')
    expect(barePortAssign, 'a bare $DriverPort assignment is function-local and would leave Invoke-WebDriver on the old port').toEqual([])

    // ⑤ 重启驱动前必须先停掉上一个，否则句柄被覆盖、旧驱动成为孤儿，
    //    下一个模式的会话会落到**仍在运行的第一个驱动**上（带着上一个模式的环境）。
    expect(helperBody, 'the helper must stop the previous driver before restarting').toContain('Stop-VisualEvidenceDriver')
    expect(helperBody, 'the restart must be opt-in via a switch').toMatch(/\[switch\]\$ModeRestart/)

    // ⑥ 每个模式：环境三件套先赋值，再启动驱动，最后才开会话。
    const loopStart = collector.indexOf('foreach ($plan in $runPlan)')
    const loopEnd = collector.indexOf("Write-Output 'VISUAL_EVIDENCE_COLLECTED'", loopStart)
    expect(loopStart, 'the per-mode loop must exist').toBeGreaterThan(-1)
    expect(loopEnd, 'the collection body must end with the collected marker').toBeGreaterThan(loopStart)
    const loopBody = collector.slice(loopStart, loopEnd)

    const envIdx = loopBody.indexOf('$env:RAIN_E2E_RUN_MODE = $plan.mode')
    const dbIdx = loopBody.indexOf('$env:RAIN_E2E_DB_PATH = $databasePath')
    const callIdx = loopBody.indexOf('Start-VisualEvidenceDriver -Mode')
    const sessionIdx = loopBody.indexOf('$sessionId = New-WebDriverSession $appBinary')
    expect(envIdx, 'RAIN_E2E_RUN_MODE must be assigned inside the per-mode loop').toBeGreaterThan(-1)
    expect(dbIdx, 'RAIN_E2E_DB_PATH must be assigned inside the per-mode loop').toBeGreaterThan(-1)
    expect(callIdx, 'the per-mode loop must start the driver itself').toBeGreaterThan(-1)
    expect(sessionIdx, 'the per-mode loop must open a session').toBeGreaterThan(-1)
    expect(envIdx, 'RAIN_E2E_RUN_MODE must be set BEFORE the driver is spawned for that mode').toBeLessThan(callIdx)
    expect(dbIdx, 'RAIN_E2E_DB_PATH must be set BEFORE the driver is spawned for that mode').toBeLessThan(callIdx)
    expect(callIdx, 'the driver must be spawned BEFORE the session is created').toBeLessThan(sessionIdx)
    expect(loopBody.split('Start-VisualEvidenceDriver -Mode').length - 1, 'each run mode needs its own driver start').toBe(1)
    expect(loopBody, 'the second and later modes must restart (stop-then-start) the driver').toContain('$modeDriverPort')

    // ⑦ 驱动阶段必须沿用能打开调试端口的那份 browser args。
    //    第五次运行的"去掉 --remote-debugging-port"结论是错的：应用自己从不添加端口。
    const argsIdx = collector.indexOf('$driverPhaseWebViewArgs =')
    expect(argsIdx, 'the driver-phase browser args must be derived explicitly').toBeGreaterThan(-1)
    // 用**语句边界**而不是 magic 400 字符窗口：窗口一改换行就会谎报"没取到 env"。
    const argsStmtEnd = collector.indexOf('\n', collector.indexOf('$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS', argsIdx))
    expect(argsStmtEnd, 'the driver-phase args must be taken from the workflow env').toBeGreaterThan(argsIdx)
    expect(
      collector.slice(argsIdx, argsStmtEnd),
      'the driver-phase args must be taken from the workflow env',
    ).toContain('$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS')
    expect(collector, 'the debug port must survive in the fallback used by the passing E2E suites').toContain('--remote-debugging-port=9222')

    // ⑧ RAIN_E2E_MODE=1：只设一次，且必须在**驱动真正被 spawn 的那个点**之前。
    //    上一轮审查指出：返工时把比较对象从 spawn 点换成了循环起点，比它替换掉的旧断言更弱
    //    （循环起点在 spawn 点之前，等于放宽）。这里恢复为与 helper 体内的 spawn 点比较。
    //    这里比较的是**调用点**而不是 helper 体内的 spawn 文本位置：helper 定义在脚本顶层
    //    （在所有主流程语句之前），拿它的字面位置做比较会得出"环境变量在 spawn 之后"的错误结论。
    //    真正决定继承环境的时刻是驱动被**调用**的那一刻。
    expect(collector.split("$env:RAIN_E2E_MODE = '1'").length - 1, 'RAIN_E2E_MODE must be set exactly once').toBe(1)
    const modeEnvAbs = collector.indexOf("$env:RAIN_E2E_MODE = '1'")
    const firstDriverCallAbs = collector.indexOf('Start-VisualEvidenceDriver -Mode')
    expect(firstDriverCallAbs, 'the driver must be started from the per-mode loop').toBeGreaterThan(-1)
    expect(modeEnvAbs, 'RAIN_E2E_MODE must be set BEFORE the driver is started; the process inherits the environment at spawn time or the app never learns its mode').toBeLessThan(firstDriverCallAbs)

    // ⑨ 不带端口的旧调用形态不得回归（没有端口就无从判断请求该打哪里）。
    expect(collector, 'the driver must never be started without an explicit port').not.toMatch(/Start-VisualEvidenceDriver \$phase\s*\r?$/m)

    // ⑩ 每模式的端口必须来自显式公式，且 native 端口同步偏移。
    expect(collector, 'the per-mode driver port must be derived explicitly').toContain('$modeDriverPort = $DriverPort + $runModeIndex')

    // ⑪ 空 browser args 时必须拒绝启动（否则应用不会开端口，会话必然失败）。
    expect(helperBody, 'the helper must refuse to start with empty browser args').toContain('WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is empty')

    // ⑨ 失败现场证据：这几个值就是"驱动为什么拉不起会话"的第一现场，必须被记录。
    for (const fact of ['rainE2eRunModeEnv', 'rainE2eDbPathEnv', 'rainE2eVideoPathEnv', 'webviewArgsEnv', 'driverRunMode']) {
      expect(collector, 'failure diagnostics must record ' + fact).toContain("Add-Fact '" + fact + "'")
    }

    // ⑫ 本提交新增的四条失败现场判据都必须真的存在——它们正是这次返工宣称的价值所在，
    //    上一轮审查用注入法实测"删掉它们守卫仍然全绿"，这里逐条补上覆盖。
    //    (a) 每模式独立驱动日志（否则 Start-Process 覆盖后只剩最后一个模式的日志尾巴）
    expect(collector, 'per-mode driver log file names must be derived').toContain("'tauri-driver.' + $Mode + '.log'")
    expect(collector, 'per-mode driver log tails must be collected').toContain('$script:driverLogTails[$Mode]')
    //    (b) 停止驱动超时必须被记录（否则静默泄漏）
    expect(collector, 'a stop timeout must be recorded as a fact').toContain("Add-Fact 'driverStopTimeout'")
    //    (c) 兜底收尸必须记录，且必须按本次运行的端口而不是镜像名
    expect(collector, 'leftover reaping must be recorded').toContain("Add-Fact 'driverLeftoverReaped'")
    expect(collector, 'leftover reaping must NOT match by image name (that would kill a sibling E2E on the same host)').not.toContain("Get-Process -Name 'tauri-driver'")
    expect(collector, 'leftover reaping must match this run\'s own ports').toContain('$script:driverPorts')
    //    (d) 会话失败时的 DevTools 端口判据，且端口必须取自实际下发的参数（不能硬编码）
    expect(collector, 'the failure-time DevTools probe must be recorded').toContain("Add-Fact 'failureTimeDevToolsEndpoint'")
    //    这里的反斜杠是必需的：写成 (d+) 会匹配不到任何数字、函数**永远**返回 9222，
    //    "从实际参数解析端口"这个性质就完全没实现（上一轮审查实测到的错，本仓真的犯过）。
    expect(collector, 'the debug-port digit class must be escaped').toContain('--remote-debugging-port=(' + String.fromCharCode(92) + 'd+)')
    expect(collector, 'the debug-port fallback must be documented as a fallback').toContain('永远**返回 9222')
    //    (e) 收尸失败必须留下痕迹（上一轮审查指出它零覆盖：删掉仍全绿）
    expect(collector, 'a reaping failure must be recorded').toContain("Add-Fact 'driverLeftoverReapError'")
    expect(collector, 'the probe port must be derived from the browser args').toContain('function Get-DriverDebugPort')
    expect(collector, 'the probe must use the derived port, not a literal').toContain("'http://127.0.0.1:' + $dtPort + '/json/version'")
  })

  it('never probes the tauri-driver version with a flag it does not support', () => {
    // 首次托管运行的第二个真实失败：tauri-driver 2.0.6 没有 --version，调用它会打印
    // "Error: unused arguments left: [--version]"（`cargo install --list` 才是读版本的正当途径）。
    const collector = readFileSync(collectorScript, 'utf8')
    expect(collector).not.toMatch(/&?\s*\$tauriDriver\s+--version/)
    expect(collector).toContain('cargo install --list')
  })

  it('refuses to write a package when the WebView2 runtime version cannot be read', () => {
    // 空串不该被写进 manifest 再由校验器含糊拒绝；采集器要当场说清缺的是宿主版本。
    //
    // 版本来源本轮**从 UA 改成 DevTools /json/version**：WebView2 的 UA 里 Edg/ 段是**简化版本**
    // （run 36565255218 实测 UA = "…Edg/153.0.0.0"，而同一进程的 /json/version 给的是
    // "Edg/153.0.4234.48"）。用 UA 去比对 workflow 钉住的 msedgedriver，会把一个真实匹配
    // 误报成"宿主版本对不上"——那正是本轮托管运行的失败原因。因此断言跟着改到新来源，
    // 并要求 DevTools 读不到时**当场失败**（不许把没读到版本的包当有效证据）。
    const collector = readFileSync(collectorScript, 'utf8')
    expect(collector, 'the runtime version must come from the DevTools endpoint').toContain('Get-WebView2RuntimeVersion')
    expect(collector, 'the DevTools version must be parsed from the Browser field').toContain("'Edg/([0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+)'")
    expect(collector).toMatch(/Could not read the WebView2 runtime version from the DevTools/)
    expect(collector).toMatch(/more than one WebView2 runtime version/)
    // UA 只作为交叉参考，且必须留痕——否则以后没人能判断两处版本是否一致。
    expect(collector, 'the UA Edg token must be recorded as a cross-check, not used for binding').toContain("Add-Fact ('userAgentEdgVersion.' + $plan.mode)")
    expect(collector, 'the UA token must NOT be the binding source any more').not.toContain('$runtimeVersions += $uaMatch.Groups[1].Value')
  })

  it('keeps every contract id addressable exactly once in the coverage contract', () => {
    const manifestModule = readFileSync(collectorScript, 'utf8')
    for (const id of contractIds) {
      expect(manifestModule).toContain(id)
    }
    expect(manifestModule).toContain('VC-18')
  })

  it('declares the colour role each element spec actually judges, and never leaves it to a guess', () => {
    // 记录里的 measured.role 是**结构事实**：校验器只用它来决定 declaredToken 该在哪个通道里被找到。
    // 因此 role 写假不会让包变红，却会让读到包的人（视觉审查员 V2）得出错误的结构结论。
    // 之前 role 只有一个兜底式默认值（非 nonText 一律 text），结果 41 条真实记录里有 19 条把
    // 「顶栏高度」「圆角」「间距」「阴影」「背景亮度」这类**不判颜色**的量标成了 text。
    // 这条守卫直接读采集器的 spec 表：每条 element spec 必须显式声明 colorRole，
    // 且该角色必须与它的 criterion 所判的维度一致——不许靠默认值蒙过去。
    const collector = readFileSync(collectorScript, 'utf8')
    const elementSpecs = collector
      .split(/\r?\n/)
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => /id = '[^']+'/.test(line) && line.includes("scope = 'element'"))
      .map(({ line, number }) => ({
        number,
        id: /id = '([^']+)'/.exec(line)![1],
        criterion: /criterion = '([^']+)'/.exec(line)?.[1] ?? '',
        colorRole: /colorRole = '([^']+)'/.exec(line)?.[1] ?? null,
        declaredToken: /declaredToken = '([^']+)'/.exec(line)?.[1] ?? null,
      }))
    expect(elementSpecs.length, 'the collector must still declare its element specs').toBeGreaterThan(20)

    const knownRoles = ['text', 'background', 'border', 'graphic', 'nonColour']
    const nonColourCriteria = [/^keyHeight/, /^radiusLadder$/, /^spacingLadder$/, /^cardNoShadow$/]
    for (const spec of elementSpecs) {
      const where = `${spec.id} (campaign-visual-evidence.ps1:${spec.number}, criterion=${spec.criterion})`
      expect(spec.colorRole, `${where} must declare colorRole explicitly`).not.toBeNull()
      expect(knownRoles, `${where} declares an unregistered colorRole`).toContain(spec.colorRole)

      if (/^backgroundLuminance/.test(spec.criterion)) {
        expect(spec.colorRole, `${where} judges the background colour`).toBe('background')
      }
      if (nonColourCriteria.some((pattern) => pattern.test(spec.criterion))) {
        expect(spec.colorRole, `${where} judges no colour at all`).toBe('nonColour')
      }
      if (spec.criterion === 'focusRing2pxDashedFg') {
        expect(spec.colorRole, `${where} judges the focus ring`).toBe('graphic')
      }
      if (['neutralScaleMutedToken', 'primaryButtonOutlinedText', 'fontStackWeightSizeOnTopbarTitle'].includes(spec.criterion)) {
        expect(spec.colorRole, `${where} judges text colour`).toBe('text')
      }
      if (spec.declaredToken && /border/i.test(spec.declaredToken)) {
        expect(spec.colorRole, `${where} declares a border token`).toBe('border')
      }
      // 不判颜色的角色没有可对账的通道，因此不得携带令牌（与校验器的 fail-closed 规则同向）。
      if (spec.colorRole === 'nonColour') {
        expect(spec.declaredToken, `${where} must not carry a colour token`).toBeNull()
      }
    }
  })
})

/* ------------------------------------------------------------------ *
 * ⑧ 参考实现自检：测试自己的数学必须与合同公开值一致
 *    （防止「测试与被测同错」——这里独立复算 §5.5 的公开数字）
 * ------------------------------------------------------------------ */

describe('reference implementation self-check', () => {
  it('matches the published visual-contract §5.5 / §5.2 numbers', () => {
    expect(contrastRatio(hexToRgb8('#e5e5e5'), hexToRgb8('#242424'))).toBeCloseTo(12.32, 2)
    expect(contrastRatio(hexToRgb8('#e5e5e5'), hexToRgb8('#1a1a1a'))).toBeCloseTo(13.82, 2)
    expect(contrastRatio(hexToRgb8('#9a9a9a'), hexToRgb8('#1a1a1a'))).toBeCloseTo(6.19, 2)
    expect(contrastRatio(hexToRgb8('#9a9a9a'), hexToRgb8('#242424'))).toBeCloseTo(5.52, 2)
    expect(contrastRatio(hexToRgb8('#9a9a9a'), hexToRgb8('#2e2e2e'))).toBeCloseTo(4.83, 2)
    expect(contrastRatio(hexToRgb8('#8f8f8f'), hexToRgb8('#1a1a1a'))).toBeCloseTo(5.38, 2)
    expect(contrastRatio(hexToRgb8('#8f8f8f'), hexToRgb8('#242424'))).toBeCloseTo(4.8, 2)
    expect(contrastRatio(hexToRgb8('#ffffff'), hexToRgb8('#4a9eff'))).toBeCloseTo(2.75, 2)
    expect(contrastRatio(hexToRgb8('#ffffff'), hexToRgb8('#10b981'))).toBeCloseTo(2.54, 2)
    expect(contrastRatio(hexToRgb8('#ffffff'), hexToRgb8('#f59e0b'))).toBeCloseTo(2.15, 2)
    expect(contrastRatio(hexToRgb8('#e6edf3'), hexToRgb8('#161b22'))).toBeCloseTo(14.64, 2)
    expect(contrastRatio(hexToRgb8('#539bf5'), hexToRgb8('#161b22'))).toBeCloseTo(6.07, 2)
    expect(contrastRatio(hexToRgb8('#868f99'), hexToRgb8('#1c232c'))).toBeCloseTo(4.83, 2)
    expect(contrastRatio(hexToRgb8('#ff6b61'), hexToRgb8('#242424'))).toBeCloseTo(5.56, 2)
    expect(contrastRatio(hexToRgb8('#e3b341'), hexToRgb8('#1a1a1a'))).toBeCloseTo(8.94, 2)
    expect(relativeLuminance(hexToRgb8('#1a1a1a'))).toBeCloseTo(0.01033, 5)
    expect(relativeLuminance(hexToRgb8('#242424'))).toBeCloseTo(0.017642, 5)
    expect(relativeLuminance(hexToRgb8('#ffffff'))).toBeCloseTo(1, 6)
    expect(relativeLuminance([0, 0, 0])).toBeCloseTo(0, 6)
  })

  it('reproduces the white-text upper bound proof 1.05/(L_bg+0.05) < 4.5 for every status background', () => {
    // visual-contract.md §5.5.1：白字压任何 L > 0.183333 的背景都必然 <4.5:1（可证的不可能）。
    for (const background of ['#10b981', '#f59e0b', '#3ecf8e', '#f0a13c', '#5b9bf8']) {
      const luminance = relativeLuminance(hexToRgb8(background))
      expect(luminance).toBeGreaterThan(0.183333)
      expect(1.05 / (luminance + 0.05)).toBeLessThan(4.5)
      expect(contrastRatio([255, 255, 255], hexToRgb8(background))).toBeLessThan(4.5)
    }
  })
})
