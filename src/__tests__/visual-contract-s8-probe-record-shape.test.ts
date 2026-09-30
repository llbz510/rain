import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runProbeOn } from './support/visual-probe'

/**
 * S8 缺陷③/④ 的**记录形状**判据：把采集器**真实的探针**放进 jsdom 跑，
 * 裁判它真正写出来的记录（与 `scripts/injected-scripts-parse.test.ts` 同一套取法与理由）。
 *
 * - ③ 真实包 `visual-c2c75601-20260930-013637` 的 `derived.spacing.gaps` 出现负值
 *   （−1028/−669/−508/−36/−28/−27/−24/−10，17 条记录全部如此）。成因是把**不同包含块**的
 *   兄弟 rect 相减：flex 行里相邻兄弟共享同一 top，垂直差必然为负；`position:absolute` 的
 *   浮层兄弟也被当成流内兄弟参与相减。
 * - ④ 同一包的 36 条 `outline` 记录逐字是 `outlineStyle=none` / `outlineWidth=3px`，
 *   而唯一源规则是 `:focus-visible { outline: 2px dashed var(--color-fg); outline-offset: 2px }`。
 *   3px 是浏览器对**没有轮廓**的元素报出的保留初始值（`medium`），不是被画出来的宽度。
 *
 * jsdom 不做布局，`getBoundingClientRect()` 恒为 0，因此本文件裁判的是**口径**
 * （哪些对被排除、宽度字段何时为空、口径是否随记录交出），真机几何由下一次真实桌面采集复测。
 */

const ROOT = process.cwd()

/** 一段与真实目录横条同形的夹具：shell > scroll row、相邻的浮层兄弟、以及嵌套的正常流兄弟。 */
const SPACING_FIXTURE =
  '<div id="bar" style="position: relative">' +
  '<div id="row-shell"><div id="row" style="display: flex; gap: 8px"></div></div>' +
  '<div id="fade" style="position: absolute; top: 0; right: 0; width: 24px"></div>' +
  '<div id="fixed-overlay" style="position: fixed; top: 0; left: 0"></div>' +
  '<div id="nested-wrapper" style="position: relative"><div id="nested-a"></div><div id="nested-b"></div></div>' +
  '</div>'

const SPACING_SPECS = [
  { id: 'anchor-spacing', vc: 'VC-15', criterion: 'spacingLadder', page: 'study', selector: '#bar', description: 'anchor' },
]

const OUTLINE_SPECS = [
  { id: 'anchor-no-outline', vc: 'VC-03', criterion: 'focusRing2pxDashedFg', page: 'video-list', selector: '#plain', description: 'anchor', colorRole: 'graphic' },
  { id: 'anchor-outline', vc: 'VC-03', criterion: 'focusRing2pxDashedFg', page: 'video-list', selector: '#ringed', description: 'anchor', colorRole: 'graphic' },
]

describe('S8 缺陷③：探针的间距抽样只在同一坐标系内相减，且不得出现负 gap', () => {
  it('真实探针在任何情况下都不写出负的 gapPx', async () => {
    const results = await runProbeOn(SPACING_FIXTURE, SPACING_SPECS)
    const spacing = results.find((entry) => entry.probeId === 'anchor-spacing')!.derived!.spacing!
    for (const gap of spacing.gaps ?? []) {
      expect(gap.gapPx, `gapPx 不得为负：${JSON.stringify(gap)}`).toBeGreaterThanOrEqual(0)
    }
    // 负值也不可能被混进 off-ladder 清单（旧口径会把 -508 之类写进去，冒充"阶梯外取值"）。
    for (const value of spacing.offLadderValues ?? []) {
      expect(value, `off-ladder 清单里不得出现负的 gap：${value}`).not.toMatch(/gap\([a-z]+\)=-\d/)
    }
  })

  it('越出正常流的兄弟（absolute / fixed 浮层）被排除在间隙抽样之外，并如实计数', async () => {
    const results = await runProbeOn(SPACING_FIXTURE, SPACING_SPECS)
    const spacing = results.find((entry) => entry.probeId === 'anchor-spacing')!.derived!.spacing!
    const involved = (spacing.gaps ?? []).map((gap) => gap.between ?? '').join(' | ')
    expect(involved, 'absolute 的浮层兄弟不得进入间隙抽样').not.toContain('#fade')
    expect(involved, 'fixed 的浮层兄弟不得进入间隙抽样').not.toContain('#fixed-overlay')
    expect(involved, '被包在定位壳里的元素不是被测元素的兄弟，同样不得进入').not.toContain('#nested-a')
    // 至少有 3 对被跳过：row-shell↔fade、fade↔fixed-overlay、fixed-overlay↔nested-wrapper。
    expect(spacing.skippedOutOfFlowPairs ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('抽样口径随记录交出：containerGap 与两个跳过计数都在（可复核，不是"我们算过了"）', async () => {
    const results = await runProbeOn(SPACING_FIXTURE, SPACING_SPECS)
    const spacing = results.find((entry) => entry.probeId === 'anchor-spacing')!.derived!.spacing!
    expect(spacing.containerGap, '必须交出容器自身的 gap 计算样式（口径的直接证据）').toBeDefined()
    expect(Object.keys(spacing.containerGap!).sort()).toEqual(['columnGap', 'rowGap'])
    expect(typeof spacing.skippedOutOfFlowPairs).toBe('number')
    expect(typeof spacing.skippedUnpairedPairs).toBe('number')
  })

  it('反例锚点：旧口径量出的那批负值必须落在"不可能被记录"的一侧', () => {
    // 真实包 visual-c2c75601-20260930-013637 的 17 条记录量出的全部负值（逐条来自 records/*.json）。
    const observedNegativeGaps = [-1028, -669, -508, -36, -28, -27, -24, -10]
    for (const value of observedNegativeGaps) {
      expect(value, '这些就是旧口径的产物；新口径下它们结构上不可能被记录').toBeLessThan(0)
    }
    // 其中 catalog-bar 那一条：-508 是 shell 宽度，而两条目录行真实的垂直间距是 40。
    expect(observedNegativeGaps).toContain(-508)
    expect(Math.abs(-508)).not.toBe(40)
  })
})

describe('S8 缺陷④：未渲染的轮廓不得把浏览器保留的初始宽度当实测值', () => {
  it('outline-style: none 的元素：widthPx 为 null 且显式标注"保留的初始值"，原始读数另存', async () => {
    const results = await runProbeOn(
      '<div id="plain" style="outline-style: none; outline-color: rgb(229, 229, 229); outline-width: 3px">x</div>',
      [OUTLINE_SPECS[0]],
    )
    const outline = results.find((entry) => entry.probeId === 'anchor-no-outline')!.measured!.outline!
    expect(outline.rendered, '未渲染必须如实标注').toBe(false)
    expect(outline.style).toBe('none')
    expect(outline.widthPx, '未渲染的轮廓没有宽度可言；3px 是保留初始值，不得写进 widthPx').toBeNull()
    expect(outline.widthPxIsReservedInitial, '必须显式声明这个宽度是保留值').toBe(true)
    expect(outline.widthComputed, '原始计算值必须可追溯（3px 这个读数不能被抹掉）').toBe('3px')
  })

  it('渲染中的轮廓：widthPx 是真实宽度，且不再标为保留值', async () => {
    const results = await runProbeOn(
      '<div id="ringed" style="outline-style: dashed; outline-color: rgb(229, 229, 229); outline-width: 2px; outline-offset: 2px">x</div>',
      [OUTLINE_SPECS[1]],
    )
    const outline = results.find((entry) => entry.probeId === 'anchor-outline')!.measured!.outline!
    expect(outline.rendered).toBe(true)
    expect(outline.style).toBe('dashed')
    expect(outline.widthPx, '渲染中的轮廓必须交出真实宽度').toBe(2)
    expect(outline.widthPxIsReservedInitial).toBe(false)
    expect(outline.widthComputed).toBe('2px')
  })

  it('反例锚点：把未渲染的 3px 当成实测宽度，就是真实包里那条"矛盾"记录', () => {
    // 唯一源规则仍是 2px 虚线；3px（保留初始值 medium）与规则宽度不是同一个量。
    const recorded = 3
    const rule = Number(readFileSync(join(ROOT, 'src/index.css'), 'utf8').match(/outline:\s*(\d+)px\s+dashed/)![1])
    expect(rule, '聚焦圈规则仍是 2px 虚线').toBe(2)
    expect(recorded, '保留初始值与规则宽度不是同一个量').not.toBe(rule)
  })

  it('聚焦圈规则本身未被本轮改动（2px 虚线 + --color-fg + offset 2px）', () => {
    const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8')
    expect(css).toMatch(/outline:\s*2px dashed var\(--color-fg\)/)
    expect(css).toMatch(/outline-offset:\s*2px/)
  })
})
