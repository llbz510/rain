import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * AC-UX-02 / AC-UX-06 — 视觉合同 S5「状态色」
 *
 * 依据 `docs/development/visual-contract.md`：
 * - 决策 69/70 + §5.5.1「状态色（深底套）」：失败=红 / 处理中=黄 / 排队=灰；
 *   **白字只能压「填充态」**：失败 `#a82e26`（白字 **6.81**）、处理中 `#7a5a00`（**6.38**）、排队 `#5b6470`（**6.00**）；
 *   彩字态（`#ff6b61` / `#e3b341` / `#a1a1a1`）只能作**文字/边框**，不得作白字承载。
 * - 缺口 `VCGAP-12`/`VCGAP-13`：把白字压在**类型色**上（旧 `#10b981` 2.54:1 / `#f59e0b` 2.15:1）必然不达标——
 *   这是**可证的不可能**（白字对比度上界 `1.05/(L_bg+0.05)`，这三个背景的 L 都 > 0.183333），正确解是**换配对**。
 * - 缺口 `VCGAP-23`：三处提示（`errorStyle` 与两处提示框）改用本套「处理中」色
 *   （用户 2026-09-28 答复选项 A：作文字 `#e3b341`、承载文字 `#7a5a00`，**不新增「警告」语义**）。
 *
 * 数值口径：WCAG 2.1，`rgba` 先按层合成，容差 ±0.05。
 */

const ROOT = process.cwd()
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8')

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

function luminance(hex: string): number {
  const value = hex.trim().replace('#', '')
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
  const [r, g, b] = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** §5.5.1 冻结的填充态（白字承载）与彩字态（文字/边框） */
const FILL = { failed: '#a82e26', processing: '#7a5a00', pending: '#5b6470' } as const
const TEXT_TONE = { failed: '#ff6b61', processing: '#e3b341', pending: '#a1a1a1' } as const
/** 必须仍是不达标的反例背景（VCGAP-12/13 的旧配对 + S4 后的类型色彩字态） */
/** 反例背景在 beforeAll 里从**真实源码**解析（S4 的四个类型色令牌 + 两个历史旧值），不写死常量。 */

describe('S5 状态色：白字只压填充态 + 三处提示改用本套「处理中」色', () => {
  let videoList: string
  let videoListPage: string
  let indexCss: string
  let deep: Record<string, string>
  let fills: Record<string, string>
  let processingTone: string
  let counterExamples: string[]

  beforeAll(() => {
    videoList = read('src/ui/components/video-list.tsx')
    videoListPage = read('src/pages/VideoListPage.tsx')
    indexCss = read('src/index.css')
    deep = {
      bg: indexCss.match(/--color-bg:\s*(#[0-9a-fA-F]{6})/)![1],
      surface: indexCss.match(/--color-surface:\s*(#[0-9a-fA-F]{6})/)![1],
      hover: indexCss.match(/--color-surface-hover:\s*(#[0-9a-fA-F]{6})/)![1],
    }
    // 填充值从**真实组件源码**解析（不是复制常量）：组件改了而期望没改会在这里失败。
    const fillBlock = videoList.match(/STATUS_BADGE_FILL[^{]*\{([^}]*)\}/)
    if (!fillBlock) throw new Error('video-list.tsx 缺少 STATUS_BADGE_FILL')
    fills = Object.fromEntries(
      [...fillBlock[1].matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)].map((m) => [m[1], m[2].toLowerCase()]),
    )
    // 彩字态（处理中）从**真实页面源码**解析
    const toneMatch = videoListPage.match(/#(e3b341)/i)
    if (!toneMatch) throw new Error('VideoListPage.tsx 未使用处理中彩字态')
    processingTone = `#${toneMatch[1].toLowerCase()}`
    // 反例背景：S4 落地的四个类型色令牌（读 index.css）+ 两个历史旧值
    const token = (name: string) => {
      const match = indexCss.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))
      if (!match) throw new Error(`index.css 缺少 --color-${name}`)
      return match[1].toLowerCase()
    }
    counterExamples = [token('concept'), token('example'), token('analogy'), token('transition'), '#10b981', '#f59e0b']
  })

  describe('VCGAP-12 / VCGAP-13：白字承载必须是填充态（换配对，不是硬凑）', () => {
    it('状态徽章按状态取三个冻结填充值，且字色为白', () => {
      const code = stripComments(videoList)
      for (const [type, fill] of Object.entries(FILL)) {
        expect(fills[type], `${type} 的填充值（从源码解析）必须是 ${fill}`).toBe(fill)
      }
      expect(code, '徽章字色必须是白色').toMatch(/color:\s*'#ffffff'/)
      expect(code, '徽章必须以填充色作底').toMatch(/background:\s*STATUS_BADGE_FILL\[/)
      expect(code, '不得把类型色/彩字态当白字承载').not.toMatch(/background:\s*['"]var\(--color-(example|analogy|concept|transition)\)['"]/)
    })

    it('测：白字压三个填充值全部 ≥4.5:1', () => {
      for (const [type, fill] of Object.entries(fills)) {
        const ratio = contrast('#ffffff', fill)
        expect(ratio, `白字压 ${type} 填充 ${fill} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it('测：彩字态作文字压三种底色 ≥4.5:1、作 1px 边框 ≥3:1（与填充态分工明确）', () => {
      // 只测**真实落地的**那一个彩字态（处理中，从 VideoListPage 解析）；failed/pending 的彩字态当前无落地实现，
      // 不作「源码绑定」断言（登记在 §5.5.1，避免写成不会失败的恒真断言）。
      for (const surface of ['surface', 'bg'] as const) {
        const text = contrast(processingTone, deep[surface])
        expect(text, `处理中彩字压 ${surface} = ${text.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      }
      const onHover = contrast(processingTone, deep.hover)
      expect(onHover, `处理中彩字压悬停面 = ${onHover.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    })

    it('反例锚点：白字压绿/橙（含 S4 后的类型色）必须仍是不达标的（防止改回去）', () => {
      for (const background of counterExamples) {
        const ratio = contrast('#ffffff', background)
        expect(ratio, `白字压 ${background} 应 <4.5:1（实测 ${ratio.toFixed(2)}）`).toBeLessThan(4.5)
      }
    })

    it('可证的不可能（不是取舍）：这几个背景的 L 都 > 0.183333，白字上界必然 <4.5:1', () => {
      const bound = 1.05 / 4.5 - 0.05
      for (const background of counterExamples) {
        expect(luminance(background), `${background} 的 L 必须 > ${bound}`).toBeGreaterThan(bound)
        expect(1.05 / (luminance(background) + 0.05), `${background} 上白字对比度上界`).toBeLessThan(4.5)
      }
    })
  })

  describe('VCGAP-23：三处提示改用本套「处理中」色（用户选项 A）', () => {
    it('三处一律用 `#e3b341`（作文字/边框），且不再出现 `#f85149` 与 `#d29922`', () => {
      const code = stripComments(videoListPage)
      expect(code, '不得再用浅底套失败红').not.toContain('#f85149')
      expect(code, '不得再用不在任何一套的 #d29922').not.toContain('#d29922')
      const hits = [...code.matchAll(/#e3b341/g)].length
      expect(hits, '三处（errorStyle 文字 + 错误提示边框/文字 + 警告提示边框/文字）都要用 #e3b341').toBeGreaterThanOrEqual(5)
    })

    it('测：`#e3b341` 作文字压三种底色 ≥4.5:1、作 1px 边框 ≥3:1', () => {
      for (const surface of ['surface', 'bg', 'hover'] as const) {
        const ratio = contrast(TEXT_TONE.processing, deep[surface])
        expect(ratio, `#e3b341 压 ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
        expect(ratio).toBeGreaterThanOrEqual(3)
      }
    })

    it('反例锚点：被替换掉的两个旧值必须仍是不属于本套语义的（说明为何不能用）', () => {
      // `#f85149` 是浅底套的失败红（深底套应为 #ff6b61）；`#d29922` 不在任何一套已冻结取值内。
      expect(videoListPage).toContain('#e3b341')
      expect(contrast('#d29922', '#242424')).toBeGreaterThan(4.5) // 它本身达标，只是语义不属于本套
    })
  })
})
