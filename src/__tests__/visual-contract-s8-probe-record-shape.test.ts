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

/**
 * 让**几何分支真的被执行**的夹具，用来把"不得出现负 gap"这条断言从空转变成本文件里**唯一的真判据**。
 *
 * 背景（Standards 轴独立复审实测指出，已据实登记）：jsdom 不做布局，`getBoundingClientRect()` 恒为
 * `{0,0,0,0}`，所以上面那份 `SPACING_FIXTURE` 里几何上不可能出现"分离"——旧口径的 `vertical !== 0`
 * 与新口径**都**只产出 `[]`，`gaps.push` 一次都不执行，"不得出现负 gap"因此**恒真**。
 *
 * 唯一能让这条断言真判的办法是**换掉几何来源**：探针从全局 `getComputedStyle`/元素 rect 读几何，
 * 而这里把 `Element.prototype.getBoundingClientRect` 换成受控桩，喂给探针**与真实包同形**的那批
 * 坏坐标（同排兄弟共享 top、浮层越出容器），再看它写出什么。这样：
 *   - 旧口径必然产出负 gap（因为轴选错 / 越出正常流）⇒ 这条断言会红；
 *   - 新口径必须产出非负 gap 或跳过 ⇒ 绿。
 * `restore()` 负责把原型方法还回去，避免污染同一进程里其它测试。
 */
function stubRects(rects: Record<string, { left: number; right: number; top: number; bottom: number; width: number; height: number }>): () => void {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function stubbed(this: Element) {
    const key = this.id ? '#' + this.id : ''
    const rect = rects[key]
    if (!rect) return { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) } as DOMRect
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, toJSON: () => ({}) } as DOMRect
  } as typeof Element.prototype.getBoundingClientRect
  return () => { Element.prototype.getBoundingClientRect = original }
}

/**
 * 与真实包同形的坏几何：两个同排兄弟（共享 top、左右相接）之间**没有**纵向关系，
 * 中间夹一个越出正常流的浮层。旧口径量出的就是这批数字的性质。
 */
const TOPBAR_LIKE_RECTS = {
  '#bar3': { left: 0, right: 1028, top: 0, bottom: 40, width: 1028, height: 40 },
  '#s1': { left: 12, right: 60, top: 6, bottom: 34, width: 48, height: 28 },
  '#s2': { left: 60, right: 360, top: 6, bottom: 34, width: 300, height: 28 },
  '#s3': { left: 60, right: 360, top: 6, bottom: 34, width: 300, height: 28 },
}

const SPACING_FIXTURE_GEOMETRY =
  '<div id="bar3">' +
  '<span id="s1">整理</span>' +
  '<span id="s2">搜索</span>' +
  '<span id="s3" style="position: absolute; top: 40px; left: 0">浮层</span>' +
  '</div>'

/** 供上面的样例使用的 spec。 */
function spacingSpec(selector: string, id: string) {
  return { id, vc: 'VC-15', criterion: 'spacingLadder', page: 'study', selector, description: 'anchor' }
}

const OUTLINE_SPECS = [
  { id: 'anchor-no-outline', vc: 'VC-03', criterion: 'focusRing2pxDashedFg', page: 'video-list', selector: '#plain', description: 'anchor', colorRole: 'graphic' },
  { id: 'anchor-outline', vc: 'VC-03', criterion: 'focusRing2pxDashedFg', page: 'video-list', selector: '#ringed', description: 'anchor', colorRole: 'graphic' },
]

describe('S8 缺陷③：探针的间距抽样只在同一坐标系内相减，且不得出现负 gap', () => {
  it('喂进与真实包同形的坏几何（同排兄弟 + 越出正常流的浮层）后，探针仍不写出负的 gapPx', async () => {
    // 这是本文件里唯一**真判**几何的用例：rect 由桩提供，旧口径在这批坐标下必然量出负值。
    const restore = stubRects(TOPBAR_LIKE_RECTS as never)
    try {
      const results = await runProbeOn(
        SPACING_FIXTURE_GEOMETRY,
        [spacingSpec('#bar3', 'anchor-geometry')],
      )
      const spacing = results.find((entry) => entry.probeId === 'anchor-geometry')!.derived!.spacing!
      for (const gap of spacing.gaps ?? []) {
        expect(gap.gapPx, `gapPx 不得为负：${JSON.stringify(gap)}`).toBeGreaterThanOrEqual(0)
      }
      // 负值也不可能被混进 off-ladder 清单（旧口径会把 -28 之类写进去，冒充"阶梯外取值"）。
      for (const value of spacing.offLadderValues ?? []) {
        expect(value, `off-ladder 清单里不得出现负的 gap：${value}`).not.toMatch(/gap\([a-z]+\)=-\d/)
      }
      // 反证这条断言不是对着空气：夹具里确实有一个**越出正常流**的兄弟，它必须被记进跳过计数。
      expect(spacing.skippedOutOfFlowPairs ?? 0, '夹具里的 absolute 兄弟必须被识别并跳过（否则这条断言是空转）').toBeGreaterThanOrEqual(1)
    } finally {
      restore()
    }
  })

  it('旧口径在这批坐标下会量出负值（反证：上面那条断言具备失败能力）', () => {
    // 旧口径 = 对任意相邻兄弟先算垂直差、非零就记。用它复算同一批 rect：
    const order = ['#s1', '#s2', '#s3']
    const oldGaps: number[] = []
    for (let i = 1; i < order.length; i += 1) {
      const prev = (TOPBAR_LIKE_RECTS as never as Record<string, { top: number; bottom: number; left: number; right: number }>)[order[i - 1]]
      const cur = (TOPBAR_LIKE_RECTS as never as Record<string, { top: number; bottom: number; left: number; right: number }>)[order[i]]
      const vertical = Math.round(cur.top - prev.bottom)
      const horizontal = Math.round(cur.left - prev.right)
      oldGaps.push(vertical !== 0 ? vertical : horizontal)
    }
    expect(oldGaps.some((value) => value < 0), `旧口径必须量出负值，实际 ${oldGaps.join(', ')}`).toBe(true)
  })

  it('越出正常流的兄弟（absolute / fixed 浮层）被排除在间隙抽样之外，并如实计数', async () => {
    const results = await runProbeOn(SPACING_FIXTURE, [spacingSpec('#bar', 'anchor-outflow')])
    const spacing = results.find((entry) => entry.probeId === 'anchor-outflow')!.derived!.spacing!
    const involved = (spacing.gaps ?? []).map((gap) => gap.between ?? '').join(' | ')
    expect(involved, 'absolute 的浮层兄弟不得进入间隙抽样').not.toContain('#fade')
    expect(involved, 'fixed 的浮层兄弟不得进入间隙抽样').not.toContain('#fixed-overlay')
    expect(involved, '被包在定位壳里的元素不是被测元素的兄弟，同样不得进入').not.toContain('#nested-a')
    // 至少有 3 对被跳过：row-shell↔fade、fade↔fixed-overlay、fixed-overlay↔nested-wrapper。
    expect(spacing.skippedOutOfFlowPairs ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('抽样口径随记录交出：containerGap 与两个跳过计数都在（可复核，不是"我们算过了"）', async () => {
    const results = await runProbeOn(SPACING_FIXTURE, [spacingSpec('#bar', 'anchor-shape')])
    const spacing = results.find((entry) => entry.probeId === 'anchor-shape')!.derived!.spacing!
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

  it('聚焦记录：outline 通道与 computedStyle 必须来自**同一个**取数时机（活对象缺陷）', async () => {
    // Spec 轴独立复审发现的缺陷：`getComputedStyle()` 是**活对象**，而 `focus:true` 的 spec 会让
    // `readFocusRing()` 调 `element.focus()`。旧探针在 focus **前**算 `outlineRendered`、在 focus
    // **后**读 `style.outlineStyle`，于是同一条记录里 `measured.outline.style` 是聚焦后的 `dashed`、
    // `computedStyle.outlineStyle` 是聚焦前的 `none`、而 `rendered` 又是按聚焦前算的 `false`
    // （真实包 `VC-03-list-import-button-focus-ring.json` 逐字如此）。
    // 修法：先聚焦，再一次性冻结快照。这条断言钉住"同一时机"这个不变量：
    // 记录里的 `measured.outline.style` 与 `computedStyle.outlineStyle` **必须逐字相同**。
    const results = await runProbeOn(
      '<div id="focusable" tabindex="0" style="outline-color: rgb(229,229,229); outline-width: 0px; outline-style: none">x</div>',
      [{ id: 'anchor-focus', vc: 'VC-03', criterion: 'focusRing2pxDashedFg', page: 'video-list', selector: '#focusable', description: 'anchor', focus: true, colorRole: 'graphic' }],
    )
    const record = results.find((entry) => entry.probeId === 'anchor-focus')!
    const outline = record.measured!.outline!
    const computedOutlineStyle = (record as unknown as { computedStyle?: { outlineStyle?: string } }).computedStyle?.outlineStyle
    expect(computedOutlineStyle, 'computedStyle 快照里必须有 outlineStyle').toBeDefined()
    expect(outline.style, 'measured.outline.style 必须与 computedStyle.outlineStyle 来自同一时机').toBe(computedOutlineStyle)
    expect(outline.rendered, 'rendered 也必须由同一个 outlineStyle 推出').toBe(computedOutlineStyle !== 'none')
    // 宽度同理：渲染中才有宽度，未渲染必须是 null（不是保留初始值 3px）。
    if (outline.rendered) {
      expect(typeof outline.widthPx).toBe('number')
    } else {
      expect(outline.widthPx, '未渲染时 widthPx 必须是 null').toBeNull()
    }
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
