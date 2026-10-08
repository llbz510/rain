import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 采集器的**运行期**路径判据（2026-10-08，复审 SPEC-1 / SPEC-2 / STD-1 之后新增）。
 *
 * 为什么需要这个文件：`scripts/visual-collector-selfcheck.test.ts` 与
 * `scripts/visual-style-contract-alignment.test.ts` 里的接线判据都是**源码文本级**
 * （`indexOf` 顺序、正则、切片）。复审实测过两条旁路：
 *   ① 把 `Assert-ComputedStyleValues $result.computedStyle …` 这**一行删掉**（函数定义保留），
 *      值空记录会被**静默写盘**（`"borderRadius": ""`），而文本级判据全部仍绿；
 *   ② 删掉探针 IIFE 的 `.catch(...)` 或等待条件里的 `probe.status === 'error'` 那两行，
 *      40 项判据仍全绿——而页级 throw 源是真实存在的（探针里的 `sweepForAccent`）。
 *
 * 所以本文件只做一件事：**真跑**。
 *   A. 真跑 `Write-ProbeRecords`（PowerShell）：值空必须抛、且记录文件**不存在**；
 *      补成合法值必须写出；dump 必须在断言之前落盘（失败那一次也要有 dump）。
 *   B. 真跑**真实探针**（jsdom）：注入一个**页级**失败，断言探针对象**已发布**且
 *      `status === 'error'`、`error` 含真实原因；并给出配对反证——把 `.catch` 去掉后
 *      探针**永不发布**，证明这个夹具真的在打那条分支。
 *
 * 它不做的事（写清以免被当万能依据）：不验证真实 WebView2/Chromium 行为（本机禁跑），
 * 也不验证托管采集；C 段对等待条件仍只是源码判据（真正的运行时幂等由采集器自身保证）。
 */

const repoRoot = join(__dirname, '..')
const collectorPath = join(repoRoot, 'scripts', 'campaign-visual-evidence.ps1')
const collectorSource = readFileSync(collectorPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')

/**
 * 按大括号配平抽出一个 PowerShell 函数（含 `function` 关键字）。
 *
 * **不许用固定字符窗口**（STD-1）：`measure()` 这类函数上千字符，窗口只会给出
 * "看起来在守、其实守不住"的判据。凡断言"函数内部不许出现某形态"都必须按边界切。
 */
function extractFunction(source: string, name: string): string {
  const at = source.indexOf(`function ${name}(`)
  if (at < 0) throw new Error(`采集器里找不到 function ${name}`)
  const open = source.indexOf('{', at)
  expect(open, `${name} 没有函数体`).toBeGreaterThan(-1)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(at, i + 1)
    }
  }
  throw new Error(`${name} 未闭合`)
}

/** 抽 `$script:ComputedStyleContractKeys = @( ... )` 的键（与采集器运行期同一份契约）。 */
function extractContractKeys(source: string): string[] {
  const anchor = source.indexOf('$script:ComputedStyleContractKeys')
  expect(anchor, '采集器里找不到 $script:ComputedStyleContractKeys').toBeGreaterThan(-1)
  const open = source.indexOf('@(', anchor)
  let depth = 0
  let end = -1
  for (let i = open + 1; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  expect(end, 'ComputedStyleContractKeys 未闭合').toBeGreaterThan(open)
  return [...source.slice(open, end).matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1])
}

const contractKeys = extractContractKeys(collectorSource)

function powershellExe(): string {
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    try {
      execFileSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$null'], { stdio: 'pipe' })
      return candidate
    } catch {
      // 试下一个
    }
  }
  throw new Error('需要 pwsh.exe 或 powershell.exe')
}

/** 真跑一段 PowerShell（UTF-8 with BOM：PowerShell 5.1 读无 BOM 的 .ps1 会按 ANSI 解码）。 */
function runPowerShell(script: string, env: Record<string, string> = {}): { stdout: string; status: number } {
  const dir = mkdtempSync(join(tmpdir(), 'rain-runtime-'))
  const path = join(dir, 'run.ps1')
  writeFileSync(path, '\uFEFF' + script, 'utf8')
  const exe = powershellExe()
  try {
    const stdout = execFileSync(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path], {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: repoRoot,
      timeout: 120_000,
      env: { ...process.env, ...env },
    })
    return { stdout, status: 0 }
  } catch (cause) {
    const failure = cause as { status?: number; stdout?: string; stderr?: string }
    return { stdout: `${failure.stdout ?? ''}${failure.stderr ?? ''}`, status: failure.status ?? 1 }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

interface RecordRun {
  threw: boolean
  message: string
  recordExists: boolean
  recordJson: string
  dumpExists: boolean
  recordPath: string
  dumpPath: string
  workDir: string
}

/**
 * 真跑 `Write-ProbeRecords`：给定"一条 element 记录"的 computedStyle，返回采集器做了什么。
 *
 * 这是本文件的核心：它执行的是采集器**真实的写盘路径**，不是它的源码文本。
 */
function runWriteProbeRecords(options: {
  computedStyleEntries: string
  diagnostic: boolean
  blockDiagnosticDirectory?: boolean
}): RecordRun {
  const workDir = mkdtempSync(join(tmpdir(), 'rain-write-'))
  const recordsDir = join(workDir, 'records')
  mkdirSync(recordsDir, { recursive: true })
  const dumpDir = join(workDir, 'diagnostic')
  const recordPath = join(recordsDir, 'VC-RUNTIME-01.json')
  const dumpPath = join(dumpDir, 'VC-RUNTIME-01.style-dump.json')
  if (options.blockDiagnosticDirectory) writeFileSync(dumpDir, 'injected dump write failure', 'utf8')

  const functions = [
    extractFunction(collectorSource, 'Compare-ComputedStyleKeys'),
    extractFunction(collectorSource, 'Assert-ComputedStyleKeys'),
    extractFunction(collectorSource, 'Compare-ComputedStyleValues'),
    extractFunction(collectorSource, 'Assert-ComputedStyleValues'),
    extractFunction(collectorSource, 'Write-StyleDiagnosticDump'),
    extractFunction(collectorSource, 'Write-ProbeRecords'),
  ].join('\n')

  const script = [
    functions,
    `$script:ComputedStyleContractKeys = @(${contractKeys.map((k) => `'${k}'`).join(', ')})`,
    '$style = [pscustomobject]@{',
    options.computedStyleEntries,
    '}',
    '$probe = [pscustomobject]@{',
    '  status = "done"',
    '  results = @([pscustomobject]@{',
    '    probeId = "VC-RUNTIME-01"',
    '    vc = "VC-01"',
    '    criterion = "runtimePath"',
    '    page = "video-list"',
    '    selector = "#x"',
    '    description = "runtime path fixture"',
    '    rect = [pscustomobject]@{ x = 0; y = 0; width = 10; height = 10 }',
    '    computedStyle = $style',
    '    styleDiagnostic = [pscustomobject]@{',
    '      raw = [pscustomobject]@{ borderTopLeftRadius = ""; borderRadius = "8px" }',
    '      selectedSource = "borderRadius"',
    '    }',
    '    measured = [pscustomobject]@{ role = "text" }',
    '    derived = [pscustomobject]@{ borderRadiusPx = 8 }',
    '  })',
    '}',
    `$recordsDir = '${recordsDir.replace(/\\/g, '/')}'`,
    '$result = $null',
    'try {',
    '  $result = Write-ProbeRecords $probe $recordsDir @() "video-list" $false',
    '  Write-Output "RESULT=WROTE-OK"',
    '  Write-Output ("recordCount=" + @($result.records).Count)',
    '} catch {',
    '  Write-Output "RESULT=THREW"',
    '  Write-Output ("message=" + $_.Exception.Message)',
    '}',
  ].join('\n')

  const { stdout } = runPowerShell(script, options.diagnostic ? { RAIN_VISUAL_DIAGNOSTIC: '1' } : {})
  const recordExists = existsSync(recordPath)
  const dumpExists = existsSync(dumpPath)
  return {
    threw: stdout.includes('RESULT=THREW'),
    message: stdout,
    recordExists,
    recordJson: recordExists ? readFileSync(recordPath, 'utf8') : '',
    dumpExists,
    recordPath,
    dumpPath,
    workDir,
  }
}

/** 28 键齐备；`borderRadius` 由调用方决定。 */
function styleEntries(borderRadius: string): string {
  return contractKeys
    .map((key) => `  ${key} = ${key === 'borderRadius' ? borderRadius : "'x'"}`)
    .join('\n')
}

describe('采集器运行期：目标 SHA 必须与真实 checkout HEAD 硬绑定', () => {
  it('checkout A、输入 B → 在建包/构建前失败，且不产生 manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'rain-target-sha-mismatch-'))
    const isolatedTemp = join(root, 'temp')
    const evidenceRoot = join(root, 'output')
    mkdirSync(isolatedTemp, { recursive: true })
    mkdirSync(evidenceRoot, { recursive: true })
    const wrongTarget = 'f'.repeat(40)
    const exe = powershellExe()
    let output = ''

    try {
      execFileSync(exe, [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', collectorPath,
        '-TargetSha', wrongTarget,
        '-EvidenceRoot', evidenceRoot,
        '-MaxSeconds', '1',
        '-SkipBuild',
        '-SkipPreflightProbe',
      ], {
        encoding: 'utf8',
        stdio: 'pipe',
        cwd: repoRoot,
        timeout: 60_000,
        env: { ...process.env, TEMP: isolatedTemp, TMP: isolatedTemp },
      })
      throw new Error('错 SHA 不得成功运行采集器')
    } catch (cause) {
      const failure = cause as { stdout?: string; stderr?: string }
      output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`
    }

    const generated = existsSync(evidenceRoot)
      ? readdirSync(evidenceRoot, { recursive: true }).map(String)
      : []
    expect(output, output).toMatch(/target sha|checkout head|HEAD/i)
    expect(output, '错误必须同时打印输入 B，便于定位伪绑定').toContain(wrongTarget)
    expect(generated.some((path) => /manifest\.json$/i.test(path)), '错 SHA 失败不得留下任何有效 manifest').toBe(false)
    expect(generated.some((path) => /^evidence[\\/]/i.test(path)), '必须在创建 evidence package 之前失败').toBe(false)
    rmSync(root, { recursive: true, force: true })
  })
})

describe('采集器运行期：写盘路径的 fail-closed（真跑 Write-ProbeRecords）', () => {
  it('键齐但 borderRadius 为空串 → 抛错，且记录文件**不存在**（不是"写进去再报错"）', () => {
    const run = runWriteProbeRecords({ computedStyleEntries: styleEntries("''"), diagnostic: false })
    expect(run.message, run.message).toContain('RESULT=THREW')
    expect(run.message, '错误必须点名空值键').toContain('borderRadius')
    expect(run.message, '错误必须说清是值级失败').toContain('空值')
    expect(run.recordExists, '值级断言在写盘之前，记录文件必须不存在').toBe(false)
    rmSync(run.workDir, { recursive: true, force: true })
  })

  it('回退链耗尽（borderRadius 为 $null）同样拦下（与校验器的空值/缺键同口径）', () => {
    const run = runWriteProbeRecords({ computedStyleEntries: styleEntries('$null'), diagnostic: false })
    expect(run.message, run.message).toContain('RESULT=THREW')
    expect(run.recordExists).toBe(false)
    rmSync(run.workDir, { recursive: true, force: true })
  })

  it('正例：borderRadius 有值 → 写出记录，且写出的 borderRadius 就是那个值', () => {
    const run = runWriteProbeRecords({ computedStyleEntries: styleEntries("'8px'"), diagnostic: false })
    expect(run.message, run.message).toContain('RESULT=WROTE-OK')
    expect(run.recordExists, '合法记录必须落盘').toBe(true)
    // ConvertTo-Json 在冒号后可能补空格，故用正则而不是字面量。
    expect(run.recordJson, '写出的就是回退链读到的那个值').toMatch(/"borderRadius":\s*"8px"/)
    rmSync(run.workDir, { recursive: true, force: true })
  })

  it('键集合不齐（少一个键）→ 键级断言在写盘前拦下', () => {
    const entries = contractKeys
      .filter((key) => key !== 'boxShadow')
      .map((key) => `  ${key} = 'x'`)
      .join('\n')
    const run = runWriteProbeRecords({ computedStyleEntries: entries, diagnostic: false })
    expect(run.message, run.message).toContain('RESULT=THREW')
    expect(run.message, '错误必须点名缺的键').toContain('boxShadow')
    expect(run.recordExists).toBe(false)
    rmSync(run.workDir, { recursive: true, force: true })
  })

  it('判断顺序：诊断 dump 在断言**之前**——失败那一次也必须留下 dump（顺序错了就没有）', () => {
    const run = runWriteProbeRecords({ computedStyleEntries: styleEntries("''"), diagnostic: true })
    expect(run.message, run.message).toContain('RESULT=THREW')
    expect(run.recordExists).toBe(false)
    expect(run.dumpExists, '断言之前必须已经落盘诊断 dump（否则诊断工具在唯一需要它的场景缺席）').toBe(true)
    rmSync(run.workDir, { recursive: true, force: true })
  })

  it('注入：diagnostic=true 时 dump 写失败必须让该条任务失败，且不得继续写正式记录', () => {
    const run = runWriteProbeRecords({
      computedStyleEntries: styleEntries("'8px'"),
      diagnostic: true,
      blockDiagnosticDirectory: true,
    })
    expect(run.message, run.message).toContain('RESULT=THREW')
    expect(run.message, '错误必须点名 diagnostic dump，而不是静默 warning').toMatch(/style diagnostic dump failed/i)
    expect(run.recordExists, 'diagnostic 写失败后不得继续写正式记录').toBe(false)
    rmSync(run.workDir, { recursive: true, force: true })
  })

  it('配对反证：把值级断言调用从写盘路径里删掉后，同一条值空记录会被**静默写盘**', () => {
    // 这条证明上面那几条不是空转：同一个夹具、同一份数据，只要**摘掉那一行调用**，
    // 记录就会带着空值落地。没有这条，"写盘前拦下"只是口号。
    const mutated = collectorSource.replace(
      /^[ \t]*Assert-ComputedStyleValues \$result\.computedStyle[^\n]*\n/m,
      '',
    )
    expect(mutated, '注入本身要生效').not.toBe(collectorSource)
    const workDir = mkdtempSync(join(tmpdir(), 'rain-write-mut-'))
    const recordsDir = join(workDir, 'records')
    mkdirSync(recordsDir, { recursive: true })
    const recordPath = join(recordsDir, 'VC-RUNTIME-01.json')
    const functions = [
      extractFunction(mutated, 'Compare-ComputedStyleKeys'),
      extractFunction(mutated, 'Assert-ComputedStyleKeys'),
      extractFunction(mutated, 'Compare-ComputedStyleValues'),
      extractFunction(mutated, 'Write-StyleDiagnosticDump'),
      extractFunction(mutated, 'Write-ProbeRecords'),
    ].join('\n')
    const script = [
      functions,
      `$script:ComputedStyleContractKeys = @(${contractKeys.map((k) => `'${k}'`).join(', ')})`,
      '$style = [pscustomobject]@{',
      styleEntries("''"),
      '}',
      '$probe = [pscustomobject]@{ status = "done"; results = @([pscustomobject]@{',
      '  probeId = "VC-RUNTIME-01"; vc = "VC-01"; criterion = "mutant"; page = "video-list"',
      '  selector = "#x"; description = "mutant fixture"',
      '  rect = [pscustomobject]@{ x = 0; y = 0; width = 10; height = 10 }',
      '  computedStyle = $style',
      '  measured = [pscustomobject]@{ role = "text" }',
      '  derived = [pscustomobject]@{ borderRadiusPx = 8 }',
      '}) }',
      `$recordsDir = '${recordsDir.replace(/\\/g, '/')}'`,
      'try { $null = Write-ProbeRecords $probe $recordsDir @() "video-list" $false; Write-Output "RESULT=WROTE-OK" }',
      'catch { Write-Output ("RESULT=THREW: " + $_.Exception.Message) }',
    ].join('\n')
    const { stdout } = runPowerShell(script)
    expect(stdout, stdout).toContain('RESULT=WROTE-OK')
    expect(existsSync(recordPath), '变异后空值记录被静默写盘——这正是本判据要防的形态').toBe(true)
    // ConvertTo-Json 在冒号后可能补空格，故用正则而不是字面量。
    expect(readFileSync(recordPath, 'utf8'), '写盘内容里 borderRadius 就是空串').toMatch(/"borderRadius":\s*""/)
    rmSync(workDir, { recursive: true, force: true })
  })
})

// ---------------------------------------------------------------------------------------------
// B 段：真实探针在 jsdom 里的**页级**失败路径。
//
// 页级 throw 源是真实存在的：探针里的 `sweepForAccent` 对无法解析的 accent token 会
// `throw new Error('accent sweep token unparseable: …')`，它在 `measure()` 之外、也在
// 逐元素 catch 之外。唯一防线是 IIFE 的 `.catch(...)` —— 而复审发现它**零判据引用**：
// 删掉 `.catch` 或删掉等待条件里 `probe.status === 'error'` 那两行，40 项判据仍全绿。
// ---------------------------------------------------------------------------------------------

/** 抽出探针 here-string（与采集器注入的字节一致）。 */
function extractProbeScript(): string {
  const lines = collectorSource.split('\n')
  const startMarker = "$probeScript = @'"
  let start = -1
  let end = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (start === -1 && lines[index].trim() === startMarker) { start = index + 1; continue }
    if (start !== -1 && lines[index].trim() === "'@") { end = index - 1; break }
  }
  expect(start, '探针 here-string 起始未找到').toBeGreaterThan(-1)
  expect(end, '探针 here-string 结束未找到').toBeGreaterThan(start)
  return lines.slice(start, end + 1).join('\n')
}

interface ArmedProbe {
  published: boolean
  status?: string
  error?: string
  results?: unknown[]
  waitedMs: number
  /** 只由子进程夹具填：未处理拒绝/未捕获异常的条数（缺 `.catch` 时必然 > 0）。 */
  unhandledRejections?: number
}

/** 把探针放进 jsdom 真跑，返回它最终发布的探针对象（或"从未发布"）。 */
async function armProbeInJsdom(
  html: string,
  config: unknown,
  probeSource: string,
  computedStyleOverrides: Record<string, string> = {},
): Promise<ArmedProbe> {
  const { JSDOM, VirtualConsole } = await import('jsdom')
  const virtualConsole = new VirtualConsole()
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { virtualConsole, pretendToBeVisual: true })
  const { window } = dom
  Object.defineProperty(window.document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true })
  const globals = globalThis as unknown as Record<string, unknown>
  const saved = new Map<string, unknown>()
  for (const name of ['window', 'document', 'getComputedStyle', 'requestAnimationFrame']) {
    saved.set(name, globals[name])
    globals[name] = (window as unknown as Record<string, unknown>)[name]
  }
  if (Object.keys(computedStyleOverrides).length > 0) {
    const nativeGetComputedStyle = window.getComputedStyle.bind(window)
    globals.getComputedStyle = (element: Element) => {
      const style = nativeGetComputedStyle(element)
      for (const [key, value] of Object.entries(computedStyleOverrides)) {
        Object.defineProperty(style, key, { value, configurable: true })
      }
      return style
    }
  }
  ;(window as unknown as Record<string, unknown>).__RAIN_VISUAL_PROBE_CONFIG__ = config
  globals.__RAIN_VISUAL_PROBE_CONFIG__ = config
  const started = Date.now()
  try {
    // 探针立刻 return，测量在异步 IIFE 里继续；结果必须等，不能立刻读。
    // eslint-disable-next-line no-new-func
    await new Function(probeSource)()
    const armedWindow = window as unknown as { __RAIN_VISUAL_PROBE__?: { status?: string; error?: string; results?: unknown[] } }
    const deadline = Date.now() + 3000
    while (!armedWindow.__RAIN_VISUAL_PROBE__ && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const armed = armedWindow.__RAIN_VISUAL_PROBE__
    return {
      published: Boolean(armed),
      status: armed?.status,
      error: armed?.error,
      results: armed?.results,
      waitedMs: Date.now() - started,
    }
  } finally {
    for (const [name, value] of saved) globals[name] = value
    window.close()
  }
}

const probeScript = extractProbeScript()

describe('探针运行期：圆角 diagnostic 必须保留 raw 双值并标出命中来源', () => {
  const config = {
    specs: [{ id: 'radius-1', vc: 'VC-15', criterion: 'radiusLadder', page: 'video-list', selector: '#radius', description: 'radius diagnostic' }],
    accentSweeps: [],
    tolerance: { contrastRatio: 0.05, colorChannel: 1 },
    toleranceBasis: 'visual-contract.md',
  }

  it('longhand 有值时记录 raw 双值，selectedSource=borderTopLeftRadius', async () => {
    const armed = await armProbeInJsdom(
      '<button id="radius" style="border-radius:8px">x</button>',
      config,
      probeScript,
      { borderTopLeftRadius: '12px', borderRadius: '8px' },
    )
    const record = (armed.results?.[0] ?? {}) as Record<string, any>
    expect(record.styleDiagnostic?.raw).toEqual({ borderTopLeftRadius: '12px', borderRadius: '8px' })
    expect(record.styleDiagnostic?.selectedSource).toBe('borderTopLeftRadius')
  })

  it('longhand 为空时仍记录 raw 双值，selectedSource=borderRadius（真实 fallback 可辨）', async () => {
    const armed = await armProbeInJsdom(
      '<button id="radius" style="border-radius:8px">x</button>',
      config,
      probeScript,
      { borderTopLeftRadius: '', borderRadius: '8px' },
    )
    const record = (armed.results?.[0] ?? {}) as Record<string, any>
    expect(record.styleDiagnostic?.raw).toEqual({ borderTopLeftRadius: '', borderRadius: '8px' })
    expect(record.styleDiagnostic?.selectedSource).toBe('borderRadius')
  })
})

/**
 * 把探针放进一个**子进程**的 jsdom 里跑，返回它最终发布的对象。
 *
 * 为什么"没有 .catch"的反证必须走子进程：探针的异步 IIFE 在缺少 `.catch` 时会
 * **未处理拒绝**，而 vitest 会把未处理拒绝当整轮失败（实测报
 * `Unhandled Rejection Error: accent sweep token unparseable: not-a-token`）。
 * 隔离到子进程后，同一件事实变成可断言的数据，而不是把整轮染红。
 */
function armProbeInChild(probeSource: string, config: unknown, waitMs: number): ArmedProbe {
  const dir = mkdtempSync(join(tmpdir(), 'rain-arm-'))
  const probeFile = join(dir, 'probe.js')
  const configFile = join(dir, 'config.json')
  writeFileSync(probeFile, probeSource, 'utf8')
  writeFileSync(configFile, JSON.stringify(config), 'utf8')
  try {
    const stdout = execFileSync(
      process.execPath,
      [join(__dirname, 'support', 'arm-probe-child.mjs'), probeFile, configFile, String(waitMs)],
      { encoding: 'utf8', stdio: 'pipe', cwd: repoRoot, timeout: 60_000 },
    )
    const line = stdout.trim().split('\n').filter(Boolean).pop() ?? '{}'
    const parsed = JSON.parse(line) as {
      published: boolean
      status: string | null
      error: string | null
      results?: unknown[]
      waitedMs: number
      unhandled?: number
    }
    return {
      published: parsed.published,
      status: parsed.status ?? undefined,
      error: parsed.error ?? undefined,
      results: Array.isArray(parsed.results) ? parsed.results : [],
      waitedMs: parsed.waitedMs,
      unhandledRejections: parsed.unhandled ?? 0,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('探针运行期：页级失败也必须发布探针对象（jsdom 真跑）', () => {
  const pageFailureConfig = {
    specs: [],
    // 真实页级 throw 源：`sweepForAccent` 对无法解析的 token 直接 throw。
    accentSweeps: [{ selectorScope: 'body', accentToken: 'not-a-token', page: 'video-list', vc: 'VC-03', criterion: 'accentSweep' }],
    tolerance: { contrastRatio: 0.05, colorChannel: 1 },
    toleranceBasis: 'visual-contract.md',
  }

  it('accent sweep token 解析失败 → 探针已发布、status=error、error 含真实原因', async () => {
    const armed = await armProbeInJsdom('<div id="x">x</div>', pageFailureConfig, probeScript)
    expect(armed.published, '页级失败也必须发布探针对象（否则等待条件只能等超时）').toBe(true)
    expect(armed.status, '失败必须显式标成 error').toBe('error')
    expect(String(armed.error), '必须带上真实原因，不能只说"失败了"').toContain('accent sweep token unparseable')
    expect(armed.results, '失败时 results 必须是空数组而不是 undefined').toEqual([])
  })

  it('配对反证（子进程隔离）：摘掉 IIFE 的 .catch 后，同一页级失败下探针**永不发布**', () => {
    const mutated = probeScript.replace(/\}\)\(\)\.catch\(/, '})(); void (')
    expect(mutated, '注入本身要生效').not.toBe(probeScript)
    const armed = armProbeInChild(mutated, pageFailureConfig, 2000)
    expect(armed.published, '没有 .catch 时探针不发布——这正是这条判据要防的形态').toBe(false)
    expect(armed.waitedMs, '不发布只能一直等到超时').toBeGreaterThanOrEqual(1900)
    // 而且那次失败是**未处理**的：这正是"抛在异步 IIFE 里就消失"的机制本身。
    expect(armed.unhandledRejections, '缺 .catch 时失败变成未处理拒绝/未捕获异常').toBeGreaterThan(0)
  })

  it('等待条件必须读 status==="error" 并把真实原因抛出来（不再只有一句泛泛超时）', () => {
    // 这一条仍是源码判据：它锁"接线存在"。真正的行为由上面两条 jsdom 真跑承担。
    // 断言必须落在**等待条件那段注入脚本**里，而不是全文任意位置。
    // 用注入点自身的边界取（`@"` 起始行到 `"@` 结束行），不用固定字符窗口
    // （复审登记过同类问题：`slice(at, at+900)` 今天非空转，但函数一变长就会静默失效）。
    const lines = collectorSource.split('\n')
    const head = lines.findIndex((line) => line.includes('Wait-WebDriverCondition $SessionId "the visual probe on page'))
    expect(head, '找不到探针等待条件').toBeGreaterThan(-1)
    let end = -1
    for (let i = head; i < lines.length; i += 1) {
      if (lines[i].trim() === '"@') { end = i; break }
    }
    expect(end, '等待条件的 here-string 未闭合').toBeGreaterThan(head)
    const conditionScript = lines.slice(head, end + 1).join('\n')
    expect(conditionScript, '等待条件必须识别探针的 error 状态').toMatch(/probe\.status === 'error'/)
    expect(conditionScript, '必须抛出探针带回的原因').toMatch(/throw new Error\([^\n]*probe\.error/)
    expect(conditionScript, '完成态判定不能被删掉').toMatch(/return Boolean\(probe\) && probe\.status === 'done'/)
  })
})

// ---------------------------------------------------------------------------------------------
// C 段：**逐元素 catch** 的判据（2026-10-08 复审 STD-12）。
//
// 这是本批交付的行为之一（"单个元素测量失败不得摧毁整页探针"），而它原先**零判据引用**：
// 复审把探针主循环里那段 try/catch 整段删掉，6 个受影响文件 87 项**全绿**。
// 与 B 段同一个道理——声称交付的行为必须有能失败的判据。
// ---------------------------------------------------------------------------------------------

describe('探针运行期：单个元素失败不得摧毁整页（逐元素 catch 真跑）', () => {
  // **必须让 measure() 真的抛**才能判这段 catch：坏选择器不行——`measure()` 对 `querySelector`
  // 取不到的元素是**返回 missing 记录**（见采集器 measure 开头），根本不抛（复审初版夹具就踩了这个坑，
  // 反证显示"摘掉 catch 仍发布"，于是证明了错的命题）。
  // 这里用 `getBoundingClientRect` 打桩：命中选择器的元素一取几何就抛，这是 measure() 内部的真实异常。
  const config = (throwOnSelector: string | null) => ({
    specs: [
      { id: 'good-1', vc: 'VC-01', criterion: 'probe', page: 'video-list', selector: '#good', description: 'good element' },
      { id: 'boom-1', vc: 'VC-01', criterion: 'probe', page: 'video-list', selector: '#boom', description: 'element whose measurement throws' },
    ],
    accentSweeps: [],
    tolerance: { contrastRatio: 0.05, colorChannel: 1 },
    toleranceBasis: 'visual-contract.md',
    ...(throwOnSelector ? { throwOnSelector, throwMessage: 'injected measure failure' } : {}),
  })

  it('一个元素测量抛异常 + 一个正常元素 → 探针仍发布，抛的那个记成 missing 且带真实原因', () => {
    // 走子进程夹具（它才有 `throwOnSelector` 打桩；两个夹具的探针与配置同源）。
    const armed = armProbeInChild(probeScript, config('#boom'), 3000)
    expect(armed.published, '单个元素失败不得让整页探针不发布').toBe(true)
    expect(armed.status, '整页仍然是完成态（失败被收在记录里）').toBe('done')
    const records = (armed.results ?? []) as Array<{ probeId?: string; missing?: boolean; note?: string; computedStyle?: Record<string, unknown> }>
    expect(records.map((r) => r.probeId).sort(), '两个 spec 都要有条目').toEqual(['boom-1', 'good-1'])
    const bad = records.find((r) => r.probeId === 'boom-1')
    expect(bad?.missing, '抛异常的元素必须标成 missing 而不是消失').toBe(true)
    expect(String(bad?.note), 'missing 记录必须带上真实原因（否则等于没有诊断信息）').toContain('injected measure failure')
    const good = records.find((r) => r.probeId === 'good-1')
    expect(good?.missing, '同页的正常元素不受影响').toBeFalsy()
    expect(good?.computedStyle, '正常元素仍然写出 computedStyle').toBeDefined()
  })

  it('配对反证（子进程隔离）：摘掉逐元素 catch 后，同页**正常元素的记录全部丢失**', () => {
    // 把探针主循环里的 try/catch 整段替换成"直接 push measure(spec)"——这正是旧形态。
    const mutated = probeScript.replace(
      /for \(const spec of config\.specs\) \{\s*try \{\s*results\.push\(measure\(spec\)\);\s*\} catch \(error\) \{[\s\S]*?\n  \}/,
      'for (const spec of config.specs) { results.push(measure(spec)); }',
    )
    expect(mutated, '注入本身要生效（主循环的 try/catch 必须能被摘掉）').not.toBe(probeScript)
    expect(mutated, '注入后不应再有逐元素 catch').not.toContain('measure failed')
    const armed = armProbeInChild(mutated, config('#boom'), 2500)
    // 注意这里**不能**断言"探针不发布"：页级 `.catch` 是第二道防线，它会把整页标成 error 并发布。
    // 逐元素 catch 的真正职责是"一个坏元素不得让**整页的测量作废**"——所以判据落在 results 上。
    expect(armed.status, '第二道防线（页级 .catch）把整页标成 error').toBe('error')
    expect(armed.results ?? [], '坏元素一抛，同页正常元素的记录**全部丢失**了').toEqual([])
    // 反向对照：同一条异常在有逐元素 catch 时被收成 missing 记录，正常元素照常出记录（见上一条用例）。
  })
})
