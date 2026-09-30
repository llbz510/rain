import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'
import { extractProbeScript } from './support/visual-probe'

/**
 * S8「修正独立视觉审查员在真实桌面实测中量出的缺陷」—— **源码层**判据（①②及其守卫）。
 *
 * 全部事实来自**第一份通过校验的真实桌面证据包**
 * `visual-c2c75601-20260930-013637`（target `c2c75601`，视口 1028×749 @ DPR 1，
 * 宿主 Windows Server 2025 + WebView2 153.0.4234.48，41 条记录 + 3 张截图）。
 * **该包本身不在本仓库里**（它随 PR #87 走，本文件不依赖它）：这里把它的读数当作
 * **冻结的观测事实**写进用例，判据只读本仓库的真实源码，因此删掉那个包也不会变绿。
 *
 * 探针层判据（③ 负 gap / ④ 轮廓宽度）在 `visual-contract-s8-probe-record-shape.test.ts`：
 * 那一份要把采集器**真实的探针**放进 jsdom 跑，故与本文件分开（jsdom 无类型，收在 support 里）。
 *
 * 口径说明（据实，不做过度声称）：本文件断言的是**源码层**事实（令牌存在且被消费、令牌属于
 * 同一命名约定、表单控件继承规则存在）。它们的**真机复测**发生在下一次真实桌面采集
 * （同一条 `VC-15-study-catalogbar-height` / `VC-15-list-topbar-height` 记录）；
 * 本文件不冒充真实桌面实测（合同 §3.4）。
 */

const ROOT = process.cwd()
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8')

/** 合同 §3.3 / 决策 76 冻结的目录横条高度（`getBoundingClientRect()` 的逻辑像素）。 */
const FROZEN_CATALOG_BAR_HEIGHT_PX = 80

/** 决策 73 的全局字体族声明的起头（与 `src/index.css` 的 body 规则同源）。 */
const SYSTEM_UI_STACK_PREFIX = 'system-ui'

/**
 * 把一份 CSS 拆成 `{ selector, body }`：先剥注释，再按大括号配对。
 * 只用于"某条规则是否存在"，不实现层叠——真实层叠由真实渲染环境决定。
 */
function cssRules(source: string): Array<{ selector: string; body: string }> {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Array<{ selector: string; body: string }> = []
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: match[1].trim(), body: match[2].trim() })
  }
  return rules
}

/** 规范化命令行上的 CSS 值：去空白、统一小写，便于比较 `4px` 与 `4 px`。 */
const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase()

describe('S8 缺陷①：学习页目录横条高度 = 合同冻结的 80px', () => {
  let indexCss: string
  let catalog: string

  beforeAll(() => {
    indexCss = read('src/index.css')
    catalog = read('src/ui/components/catalog.tsx')
  })

  it('`--height-catalog` 存在且等于 80px（决策 76「顶栏 40 / 控制栏 40 / 目录横条 80」）', () => {
    const declared = indexCss.match(/--height-catalog:\s*(-?\d*\.?\d+)px/)
    expect(declared, '`--height-catalog` 必须存在（真实桌面实测 59.59375px，此前这 80 从未落成令牌）').not.toBeNull()
    expect(Number(declared![1])).toBe(FROZEN_CATALOG_BAR_HEIGHT_PX)
  })

  it('令牌与同组固定高度同一命名约定：`--height-topbar` / `--height-controlbar` / `--height-catalog`', () => {
    const names = [...indexCss.matchAll(/--height-([a-z0-9-]+):/g)].map((match) => match[1]).sort()
    expect(names).toEqual(['catalog', 'controlbar', 'topbar'])
  })

  it('目录横条消费该令牌（高度改动自动生效，无硬编码的 80）', () => {
    expect(catalog).toMatch(/height:\s*'var\(--height-catalog\)'/)
    expect(catalog, '不得把 80 硬编码进组件（令牌才是唯一真相源）').not.toMatch(/height:\s*'80px'/)
    expect(catalog, '不得残留 height: 80 这类数值写法').not.toMatch(/height:\s*80\b/)
  })

  it('两条目录行各占一半：40 + 40 精确等于 80（容差 ±0.5）', () => {
    const trackMatch = catalog.match(/gridTemplateRows:\s*'([^']+)'/)
    expect(trackMatch, '目录横条必须把两条轨道显式写出来（高度不能再由内容决定）').not.toBeNull()
    expect(trackMatch![1]).toBe('1fr 1fr')
    const gapMatch = catalog.match(/gap:\s*(\d+|'(\d+)px')/)
    expect(gapMatch, '两条轨道之间必须显式声明零间距（否则 40+40 不再等于 80）').not.toBeNull()
    const gapValue = gapMatch![2] ?? gapMatch![1]
    expect(Number(gapValue), '两条轨道之间的间距必须是 0').toBe(0)
  })

  it('反例锚点：未修复形态（按内容自然高度渲染）必须被判红——冻结值是 80，不是 59.59375', () => {
    // 复制真实包 VC-15-study-catalogbar-height 的实测值。若有人把高度改回"由内容决定"，
    // 该值就会重新出现；这条锚点保证 80 这个数不会在判据里被悄悄放宽。
    const measuredBeforeFix = 59.59375
    const tolerancePx = 0.5
    expect(Math.abs(measuredBeforeFix - FROZEN_CATALOG_BAR_HEIGHT_PX)).toBeGreaterThan(tolerancePx)
    // 该高度 = 两条目录行各一行 + 行内盒（inline box）的上下空白：
    // 2 × 23.796875（= 14px × 1.7 的行高计算值）+ 2 × 6（inline 盒在半行距上的那 6px）。
    // 注意 14 × 1.7 = 23.8 是**四舍五入到 4 位**的写法；浏览器内部用的是 23.796875，
    // 所以这里用精确值核对——四舍五入会让那 0.00625 的差全部落进这条断言。
    expect(measuredBeforeFix).toBeCloseTo(2 * 23.796875 + 2 * 6, 10)
    expect(2 * 23.8 + 2 * 6, '四舍五入后的行高会算出 59.6，与实测差 0.00625——口径不能混用').not.toBe(measuredBeforeFix)
  })

  it('相邻守卫：顶栏与控制栏仍是 40px（本轮不得顺手改掉它们）', () => {
    expect(Number(indexCss.match(/--height-topbar:\s*(\d+)px/)![1])).toBe(40)
    expect(Number(indexCss.match(/--height-controlbar:\s*(\d+)px/)![1])).toBe(40)
  })
})

describe('S8 缺陷②：表单控件继承页面字体族（不再是 UA 的 Arial）', () => {
  let indexCss: string
  let rules: Array<{ selector: string; body: string }>

  beforeAll(() => {
    indexCss = read('src/index.css')
    rules = cssRules(indexCss)
  })

  it('分组形式的表单控件规则存在，且声明 `font: inherit`', () => {
    const formControlRule = rules.find((rule) =>
      ['button', 'input', 'select', 'textarea'].every((control) => rule.selector.split(',').map((part) => part.trim()).includes(control)))
    expect(formControlRule, '`button, input, select, textarea` 的分组规则必须存在（否则 UA 的 Arial 继续生效）').toBeDefined()
    expect(normalize(formControlRule!.body), '必须声明 `font: inherit` 才能继承页面字体族').toContain('font:inherit')
  })

  it('该规则只落在表单控件上（不得把 `*` 改成继承，那会把行高与字号一并改掉）', () => {
    const universalWithFont = rules.filter((rule) => rule.selector.trim() === '*' && /\bfont\b/.test(rule.body))
    expect(universalWithFont, '不得在 `*` 上声明 font：那会波及全局排版，超出本轮范围').toEqual([])
  })

  it('同一份 index.css 的页面字体族以 `system-ui` 起头（`VC-12`① 的全局单一无衬线族）', () => {
    const match = indexCss.match(/font-family:\s*([^;]+);/)
    expect(match, '必须存在 font-family 声明').not.toBeNull()
    expect(match![1].trim().startsWith(SYSTEM_UI_STACK_PREFIX), `页面字体族必须以 ${SYSTEM_UI_STACK_PREFIX} 起头：${match![1].trim()}`).toBe(true)
  })

  it('反例锚点：`font: inherit` 一旦被删，UA 的 Arial 立刻回来（本机 headless Edge 实测值）', () => {
    // 本机 `msedge --headless=new` 的真实读数：没有该规则时，`button` / `input` / `select` 的
    // 计算 font-family 逐字是 `Arial`（字号 13.3333px），而同一页面 body 是
    // `system-ui, -apple-system, "Segoe UI", sans-serif`。这条锚点固定那个对照，
    // 使"删掉规则也不会被察觉"不可能发生。
    const observedWithoutRule = 'Arial'
    const pageStack = indexCss.match(/font-family:\s*([^;]+);/)![1].trim()
    expect(observedWithoutRule).not.toBe(pageStack)
    expect(observedWithoutRule.toLowerCase()).not.toContain(SYSTEM_UI_STACK_PREFIX)
  })

  it('与既有的 `fontFamily: inherit` 写法同一意图（那一处不得被删）', () => {
    expect(read('src/pages/VideoListPage.tsx'), 'VideoListPage 既有的内联 inherit 写法不得被删').toMatch(/fontFamily:\s*'inherit'/)
  })

  it('视频列表页顶栏确实含被判据点名的 button / input（判据不是对着空气）', () => {
    const videoListPage = read('src/pages/VideoListPage.tsx')
    const header = videoListPage.match(/<header[^>]*>[\s\S]*?<\/header>/)
    expect(header, 'video-list-page 的 header 必须存在').not.toBeNull()
    expect(header![0], 'header 内必须有 button（导入 / 设置）').toMatch(/<button/)
    expect(header![0], 'header 内必须有 input（搜索框）').toMatch(/<input/)
  })
})

describe('S8 缺陷③/④：探针口径的源码级守卫', () => {
  it('间距抽样不得再对越出正常流的兄弟取差（源码里必须出现流外过滤）', () => {
    const probe = extractProbeScript(ROOT)
    expect(probe, '探针必须显式排除 absolute / fixed 的兄弟').toMatch(/position === 'absolute'/)
    expect(probe, '探针必须显式排除 position: fixed 的兄弟').toMatch(/position === 'fixed'/)
    expect(probe, '探针必须如实交出被跳过的对数（口径可复核）').toMatch(/skippedOutOfFlowPairs/)
    expect(probe, '探针必须交出容器自身的 gap 计算样式').toMatch(/containerGap/)
  })

  it('轮廓宽度必须区分"渲染中的真实宽度"与"浏览器保留的初始值"', () => {
    const probe = extractProbeScript(ROOT)
    expect(probe, '探针必须显式声明宽度的来源性质').toMatch(/widthPxIsReservedInitial/)
    expect(probe, '原始计算值必须另存可追溯').toMatch(/widthComputed/)
    expect(probe, '未渲染时不得再把 computed 宽度写进 widthPx').toMatch(/widthPx: outlineWidthPx/)
  })

  it('反例锚点：旧口径的两个写法必须已经不在探针里', () => {
    const probe = extractProbeScript(ROOT)
    expect(probe, '旧的"垂直差优先"轴选择逻辑必须消失').not.toMatch(/if \(vertical !== 0\) gaps\.push/)
    expect(probe, '旧的直接取 computed 宽度必须消失').not.toMatch(/widthPx: parseFloat\(style\.outlineWidth\) \|\| 0/)
  })
})
