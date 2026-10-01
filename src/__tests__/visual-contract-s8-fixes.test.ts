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

/**
 * 去掉 TS/TSX 源码里的注释，只留代码。
 * 用途：有几条"源码里不得再出现 X"的守卫，而注释**必须**能提到 X 才能解释这条守卫本身
 * （本文件就因此被自己的注释误判过一次）。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('S8 缺陷①：学习页目录横条高度 = 合同冻结的 80px', () => {
  let indexCss: string
  let catalog: string
  let study: string

  beforeAll(() => {
    indexCss = read('src/index.css')
    catalog = read('src/ui/components/catalog.tsx')
    study = read('src/pages/StudyInterface.tsx')
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

  it('高度由消费方容器给出、被测元素用 `height:100%` 撑满（无硬编码的 80）', () => {
    expect(study, '消费方容器必须给出 80px 的高度令牌').toMatch(/height:\s*'var\(--height-catalog\)'/)
    expect(study, '不得把 80 硬编码（令牌才是唯一真相源）').not.toMatch(/height:\s*'80px'/)
    // 只在**代码**里找（注释里可以提到这个令牌的名字——它正是要解释的对象）。
    const catalogCode = stripComments(catalog)
    expect(catalogCode, '源头组件里不得再出现高度令牌的取值（只允许 height:100%）').not.toMatch(/--height-catalog/)
    expect(catalogCode, '被测元素必须用 height:100% 撑满容器').toMatch(/height:\s*'100%'/)
    expect(catalogCode, '不得硬编码 80px').not.toMatch(/'80px'/)
  })

  it('两条目录行各占一半：40 + 40 精确等于 80（容差 ±0.5）', () => {
    // 80px 由容器给出，`CatalogBar` 用 `height:100%` 撑满；两行仍是原来的自然高度结构，
    // 由本机 headless Edge 以同形 DOM 实测确认：容器 80 → 被测元素 80、「壳」各 40、行间 0。
    const container = study.match(/catalogBar && \(([\s\S]{0,900}?)<CatalogBar/)
    expect(container, '必须能定位到包住 CatalogBar 的容器').not.toBeNull()
    expect(container![1], '容器高度必须是 80px 的令牌').toMatch(/height:\s*'var\(--height-catalog\)'/)
    const catalogCode = stripComments(catalog)
    expect(catalogCode, '被测元素必须撑满容器，否则它只有内容自然高度（47.59px，不是 80）').toMatch(/height:\s*'100%'/)
  })

  it('水平布局零改动：CatalogBar 仍保持原来的 shell > scroll row 结构（真回归的反例锚点）', () => {
    // 这是**真回归**留下的锚点（据实登记）：本 Slice 一开始把高度做在 `CatalogBar` 的根元素上
    // 并改成 `display:grid` + `gridTemplateRows:'1fr 1fr'`，结果把真实桌面判据
    // 「长目录两行真实横向溢出」由绿改红——paragraph 行 extent=2499.09375 对 ownerWidth=2580
    // （差 3.1%），而 master 基线 run 36665063145 为绿。
    // 现在根元素只保留 `height: '100%'`（撑满消费方给的 80px），**没有**任何 grid/`1fr` 轨道
    // 或其它会改变行内布局的写法。
    const catalogCode = stripComments(catalog)
    const rootLine = catalogCode.match(/data-testid="catalog-bar"[\s\S]{0,120}?>/)
    expect(rootLine, '必须能定位到 CatalogBar 的根元素').not.toBeNull()
    expect(rootLine![0], '根元素只允许 height:100%（不得再出现 grid 布局或 1fr 轨道）').not.toMatch(/display:\s*'grid'/)
    expect(rootLine![0], '根元素不得出现 1fr 轨道').not.toMatch(/1fr/)
    expect(catalogCode, '滚动行仍是 flex + nowrap + 横向 auto 溢出（水平布局不许动）').toMatch(/overflowX:\s*'auto'/)
    expect(catalogCode, '滚动行仍不得换行').toMatch(/flexWrap:\s*'nowrap'/)
    expect(catalogCode, '仍有两条目录行').toMatch(/level="structure"/)
    expect(catalogCode).toMatch(/level="paragraph"/)
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
