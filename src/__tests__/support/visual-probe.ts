// 把**采集器真实的探针**放进 jsdom 执行的测试支撑模块。
//
// 单独成文件的原因（据实）：jsdom **没有装 `@types/jsdom`**，而 `tsconfig.json` 的 `include`
// 只有 `src` 与 `harness`（`scripts/**` 不在里面），所以两份既有测试
// （`scripts/injected-scripts-parse.test.ts`、`scripts/validate-visual-evidence.test.ts`）
// 里的 `await import('jsdom')` 从来没有被 `tsc --noEmit` 检查过。`src/__tests__/**` 会被检查，
// 所以本模块把「动态导入 + jsdom 无类型」这件事**收在一个文件里**，用一个 `unknown` → 结构化类型的
// 显式断言处理，调用方仍然拿到完整的类型；其余测试文件因此不必各自绕过类型检查。
//
// 本模块只做两件事：① 从 PowerShell 采集脚本里按标记取出探针 here-string（探针只有一份，
// 这里不复制它的代码）；② 在一个最小页面上运行它并返回它写出的记录。

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 探针写出的记录里，本仓测试关心的那部分（其余字段由各用例按需断言）。 */
export interface ProbeSpacing {
  gaps?: Array<{ between?: string; axis?: string; gapPx?: number }>
  containerGap?: { rowGap?: number | null; columnGap?: number | null }
  skippedOutOfFlowPairs?: number
  skippedUnpairedPairs?: number
  offLadderValues?: string[]
}

export interface ProbeRecord {
  probeId: string
  missing?: boolean
  derived?: { spacing?: ProbeSpacing }
  measured?: {
    outline?: {
      widthPx?: number | null
      widthPxIsReservedInitial?: boolean
      widthComputed?: string
      style?: string
      rendered?: boolean
    }
  }
}

/** jsdom 的最小结构化视图：只声明本模块真正用到的成员，避免依赖尚未安装的 `@types/jsdom`。 */
interface JsdomWindow {
  document: Document & { fonts?: unknown }
  close: () => void
}
interface JsdomLike {
  window: JsdomWindow
}

/**
 * 把采集器 PowerShell 源文件里的探针 here-string 原样取出（`$probeScript = @'` … `'@`）。
 * 命令行的起始/结束标记与 `scripts/injected-scripts-parse.test.ts` 同一套，探针本身只有一份。
 */
export function extractProbeScript(repoRoot: string = process.cwd()): string {
  const lines = readFileSync(join(repoRoot, 'scripts', 'campaign-visual-evidence.ps1'), 'utf8').split('\n')
  const startMarker = "$probeScript = @'"
  let start = -1
  let end = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (start === -1 && lines[index].trim() === startMarker) {
      start = index + 1
      continue
    }
    if (start !== -1 && lines[index].trim() === "'@") {
      end = index - 1
      break
    }
  }
  if (start === -1 || end <= start) {
    // 抛错而不是 expect：本模块是**支撑模块**，可能在收集阶段被加载，不该在那里触发断言。
    throw new Error(`探针 here-string 的标记没找到（start=${start}, end=${end}）：scripts/campaign-visual-evidence.ps1 的形状变了`)
  }
  return lines.slice(start, end + 1).join('\n')
}

/**
 * 在 jsdom 里跑真实探针并返回它写出的记录。
 *
 * `virtualConsole` 吞掉 jsdom 的 CSS 噪声：探针这里只读内联样式与计算样式，
 * jsdom 对属性选择器报的 "could not parse CSS stylesheet" 与记录无关。
 * `document.fonts` 要打桩：探针会等 `document.fonts.ready`，而 jsdom 没有 Font Loading API，
 * 不桩就会永远挂着而不是记录（探针对字体就绪本来就是 best-effort、内部已 catch）。
 */
export async function runProbeOn(html: string, specs: unknown[]): Promise<ProbeRecord[]> {
  // 本仓装了 `jsdom` 但**没有** `@types/jsdom`，而 `tsconfig.json` 的 `include` 只有 `src` 与 `harness`
  // （两份既有的 jsdom 测试都在 `scripts/**`，因此从未被 `tsc --noEmit` 检查过）。补救这件事的正路是
  // `npm i -D @types/jsdom`，但本轮的改动范围把 `package.json`/lockfile 列为零改动，且本机
  // `github.com:443` 被阻断、装不动包（lockfile 无法同步重生成），故此处按 TS 自己的建议就地抑制：
  // 类型在下一条语句上显式声明，而不是靠 suppress 把问题藏起来。
  // @ts-expect-error TS7016 —— jsdom 无类型声明（原因见上），下行用显式结构类型替代
  const jsdomModule = (await import('jsdom')) as unknown as {
    JSDOM: new (markup: string, options: Record<string, unknown>) => JsdomLike
    VirtualConsole: new () => { on: (event: string, handler: (error: unknown) => void) => void }
  }
  const { JSDOM, VirtualConsole } = jsdomModule
  const virtualConsole = new VirtualConsole()
  const pageErrors: string[] = []
  virtualConsole.on('jsdomError', (error: unknown) => pageErrors.push(String(error)))
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { virtualConsole, pretendToBeVisual: true })
  const { window } = dom
  Object.defineProperty(window.document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true })
  const globals = globalThis as unknown as Record<string, unknown>
  const saved = new Map<string, unknown>()
  for (const name of ['window', 'document', 'getComputedStyle', 'requestAnimationFrame']) {
    saved.set(name, globals[name])
    globals[name] = (window as unknown as Record<string, unknown>)[name]
  }
  // 探针从 `window` 上读配置，因此必须同时挂到 jsdom window 与全局。
  // `tolerance` / `toleranceBasis` 是采集器真实发送的配置的一部分（`Invoke-VisualProbe` 按冻结合同
  // 构造），这里也得给，否则每条记录都会抛。
  const config = {
    specs,
    accentSweeps: [],
    tolerance: { contrastRatio: 0.05, colorChannel: 1 },
    toleranceBasis: 'visual-contract.md',
  }
  ;(window as unknown as Record<string, unknown>).__RAIN_VISUAL_PROBE_CONFIG__ = config
  globals.__RAIN_VISUAL_PROBE_CONFIG__ = config
  try {
    // 载荷**立刻**返回 'armed'，真正的测量在一个脱离的异步 IIFE 里完成，所以要等结果而不是调用完就读。
    // eslint-disable-next-line no-new-func
    await new Function(extractProbeScript())()
    const armedWindow = window as unknown as { __RAIN_VISUAL_PROBE__?: { results?: ProbeRecord[] } }
    const deadline = Date.now() + 5000
    while (!armedWindow.__RAIN_VISUAL_PROBE__ && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    if (!armedWindow.__RAIN_VISUAL_PROBE__) {
      // 把"为什么"抛出来，而不是一个干等的超时：探针在一个脱离的异步 IIFE 里完成，
      // 它的 rejection 否则在这里完全不可见。
      throw new Error('探针从未装载；页面错误：' + JSON.stringify(pageErrors))
    }
    return armedWindow.__RAIN_VISUAL_PROBE__.results ?? []
  } finally {
    for (const [name, value] of saved) globals[name] = value
    window.close()
  }
}
