import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * AC-UX-02 / AC-UX-01 — 视觉合同 S4「类型色落地」
 *
 * 依据 `docs/development/visual-contract.md`：
 * - `VC-04`（决策 66）：段落四类 = 全界面唯一颜色映射（概念=蓝 / 例子=绿 / 类比=橙 / 过渡=灰）；
 * - `VC-09`（决策 71）：类型胶囊 = 类型色字 + 同色淡底 `alpha = 0.10` + 同色细边 `1px`；
 * - §5.5.1 的「彩字态」目标值：`#5b9bf8` / `#3ecf8e` / `#f0a13c` / `#9e9e9e`（压面板 5.54 / 7.78 / 7.29 / 5.79）；
 * - `DEC-VC-02` 边界 4：`1px` 边框一律 ≥3:1（细边取**全色**同色值，与 S3 已落地的浅底套一致）。
 *
 * 关闭的缺口：`VCGAP-03`（四色令牌只定义、`src/` 内零使用）、`VCGAP-05`（类型胶囊未实现）、
 * `VCGAP-14`/`VCGAP-15`（类型色作文字不达标）。数值口径：WCAG 2.1，`rgba` 先按层合成，容差 ±0.05。
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

function composite(value: string, background: string): string {
  if (value.startsWith('#')) return value
  const match = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/)
  if (!match) throw new Error(`unsupported color: ${value}`)
  const alpha = match[4] === undefined ? 1 : Number(match[4])
  const base = background.replace('#', '')
  const mixed = [0, 1, 2].map((index) => {
    const top = Number(match[index + 1])
    const bottom = parseInt(base.slice(index * 2, index * 2 + 2), 16)
    return Math.round(top * alpha + bottom * (1 - alpha))
  })
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

const TYPES = ['concept', 'example', 'analogy', 'transition'] as const
const TARGETS: Record<(typeof TYPES)[number], string> = {
  concept: '#5b9bf8',
  example: '#3ecf8e',
  analogy: '#f0a13c',
  transition: '#9e9e9e',
}
/** §5.5.1「彩字态」压面板的最小值 */
const MIN_ON_SURFACE: Record<(typeof TYPES)[number], number> = { concept: 5.54, example: 7.78, analogy: 7.29, transition: 5.79 }

describe('S4 类型色落地：四色令牌生效 + 类型胶囊形态', () => {
  let indexCss: string
  let capsule: string
  let deep: Record<string, string>
  /** 从 src/index.css **解析出来**的四色取值（真值源）；TARGETS 只作期望对照 */
  let tokens: Record<(typeof TYPES)[number], string>

  beforeAll(() => {
    indexCss = read('src/index.css')
    capsule = read('src/ui/components/type-capsule.tsx')
    deep = {
      bg: indexCss.match(/--color-bg:\s*(#[0-9a-fA-F]{6})/)![1],
      surface: indexCss.match(/--color-surface:\s*(#[0-9a-fA-F]{6})/)![1],
      hover: indexCss.match(/--color-surface-hover:\s*(#[0-9a-fA-F]{6})/)![1],
    }
    const parse = (type: string) => {
      const match = indexCss.match(new RegExp(`--color-${type}:\\s*(#[0-9a-fA-F]{6})`))
      if (!match) throw new Error(`index.css 缺少 --color-${type}`)
      return match[1].toLowerCase()
    }
    tokens = { concept: parse('concept'), example: parse('example'), analogy: parse('analogy'), transition: parse('transition') }
  })

  describe('VCGAP-14 / VCGAP-15：四色令牌取 §5.5.1 冻结值并全底色达标', () => {
    it('四个令牌等于 §5.5.1「彩字态」目标值', () => {
      for (const type of TYPES) {
        const value = indexCss.match(new RegExp(`--color-${type}:\\s*(#[0-9a-fA-F]{6})`))
        expect(value, `--color-${type} 必须存在`).not.toBeNull()
        expect(value![1].toLowerCase()).toBe(TARGETS[type])
      }
    })

    it('测：四色压 bg / surface / hover 全部 ≥4.5:1（作文字）', () => {
      for (const type of TYPES) {
        for (const surface of ['surface', 'bg', 'hover'] as const) {
          const ratio = contrast(tokens[type], deep[surface])
          expect(ratio, `${type} 压 ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
        }
      }
    })

    it('与 §5.5.1 记录的最小值一致（±0.05）', () => {
      for (const type of TYPES) {
        const ratio = contrast(tokens[type], deep.surface)
        expect(Math.abs(ratio - MIN_ON_SURFACE[type]), `${type} 压面板 ${ratio.toFixed(2)}`).toBeLessThanOrEqual(0.05)
      }
    })

    it('反例锚点：旧值必须仍是不达标的（防止改回去）', () => {
      expect(contrast('#3b82f6', deep.surface), '旧概念蓝压面板应 <4.5').toBeLessThan(4.5)
      expect(contrast('#6b7280', deep.surface), '旧过渡灰压面板应 <4.5').toBeLessThan(4.5)
      expect(contrast('#6b7280', deep.bg), '旧过渡灰压页底应 <4.5').toBeLessThan(4.5)
      expect(contrast('#ffffff', '#10b981'), '白字压旧例子绿应 <4.5').toBeLessThan(4.5)
      expect(contrast('#ffffff', '#f59e0b'), '白字压旧类比橙应 <4.5').toBeLessThan(4.5)
    })
  })

  describe('VCGAP-05：类型胶囊 = 类型色字 + 同色淡底 + 全色同色细边（决策 71）', () => {
    it('四种类型的字色与细边都指向同一个 `--color-*` 令牌', () => {
      for (const type of TYPES) {
        const entry = capsule.match(new RegExp(`${type}:\\s*\\{([^}]*)\\}`))
        expect(entry, `type-capsule.tsx 必须声明 ${type}`).not.toBeNull()
        const body = entry![1]
        expect(body, `${type} 字色应为令牌`).toContain(`color: 'var(--color-${type})'`)
        expect(body, `${type} 细边应为同一令牌（全色，不是叠色）`).toContain(`borderColor: 'var(--color-${type})'`)
        expect(body, `${type} 不得用 rgba 叠色作细边`).not.toMatch(/borderColor:\s*'rgba\(/)
      }
    })

    it('淡底必须与令牌同色、alpha 落在 0.05–0.12', () => {
      for (const type of TYPES) {
        const entry = capsule.match(new RegExp(`${type}:\\s*\\{([^}]*)\\}`))![1]
        const tint = entry.match(/background:\s*'rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)'/)
        expect(tint, `${type} 必须声明同色淡底`).not.toBeNull()
        const token = tokens[type]
        const expectedRgb = [1, 3, 5].map((i) => parseInt(token.slice(i, i + 2), 16))
        const actualRgb = [Number(tint![1]), Number(tint![2]), Number(tint![3])]
        expect(actualRgb, `${type} 淡底的 rgb 必须与令牌一致（防两处漂移）`).toEqual(expectedRgb)
        const alpha = Number(tint![4])
        expect(alpha, `${type} 淡底 alpha ${alpha} 必须在 0.05–0.12`).toBeGreaterThanOrEqual(0.05)
        expect(alpha).toBeLessThanOrEqual(0.12)
      }
    })

    it('测：胶囊文字压自身淡底 ≥4.5:1（页底与面板），细边压三底 ≥3:1', () => {
      for (const type of TYPES) {
        const entry = capsule.match(new RegExp(`${type}:\\s*\\{([^}]*)\\}`))![1]
        const tint = entry.match(/background:\s*'(rgba\([^']+\))'/)![1]
        for (const surface of ['surface', 'bg'] as const) {
          const base = deep[surface]
          const textRatio = contrast(tokens[type], composite(tint, base))
          expect(textRatio, `${type} 文字压自身淡底@${surface} = ${textRatio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
        }
        for (const surface of ['surface', 'bg', 'hover'] as const) {
          const borderRatio = contrast(tokens[type], deep[surface])
          expect(borderRatio, `${type} 细边@${surface} = ${borderRatio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
        }
      }
    })

    it('登记边界（不在本 Slice 修）：胶囊若放在悬停面上，概念蓝/过渡灰的文字会跌破 4.5', () => {
      const expectations: Array<[string, number]> = [['concept', 4.15], ['transition', 4.31]]
      for (const [type, expected] of expectations) {
        const entry = capsule.match(new RegExp(`${type}:\\s*\\{([^}]*)\\}`))![1]
        const tint = entry.match(/background:\s*'(rgba\([^']+\))'/)![1]
        const ratio = contrast(tokens[type as (typeof TYPES)[number]], composite(tint, deep.hover))
        expect(ratio, `${type} 压悬停面 + 自身淡底 = ${ratio.toFixed(2)}:1（登记值 ${expected}）`).toBeCloseTo(expected, 1)
        expect(ratio, `${type} 在悬停面上确实 <4.5——这正是登记的理由`).toBeLessThan(4.5)
      }
    })

    it('胶囊有可测的锚点属性（供真实桌面复核定位）', () => {
      expect(capsule).toContain('data-testid="type-capsule"')
      expect(capsule).toContain('data-paragraph-type={type}')
    })

    it('胶囊圆角取中档 8px（`VC-09`/`VC-15`/决策 76：类型胶囊=8（中））', () => {
      const style = capsule.match(/const capsuleStyle[\s\S]*?\n\}/)
      expect(style, 'capsuleStyle 必须存在').not.toBeNull()
      expect(style![0], '不得取 --radius-1（4px）').not.toMatch(/borderRadius:\s*'var\(--radius-1\)'/)
      expect(style![0]).toMatch(/borderRadius:\s*'var\(--radius-2\)'/)
      const radius2 = indexCss.match(/--radius-2:\s*(\d+)px/)
      expect(radius2, '--radius-2 必须存在').not.toBeNull()
      expect(Number(radius2![1]), '--radius-2 必须是 8px').toBe(8)
      const radius1 = indexCss.match(/--radius-1:\s*(\d+)px/)
      expect(radius1, '--radius-1 必须存在').not.toBeNull()
      expect(Number(radius1![1]), '--radius-1 是 4px——正是本条要区分的那一档').toBe(4)
    })
  })

  describe('VCGAP-03：四色令牌必须真的被用上（不是只定义）', () => {
    it('`type-capsule.tsx` 被段落头（text-zone.tsx）使用，且保留 `data-type-badge` 钩子', () => {
      const textZone = read('src/ui/components/text-zone.tsx')
      expect(textZone).toContain("from '@/ui/components/type-capsule'")
      expect(textZone).toContain('<TypeCapsule type={paragraph.type} />')
      expect(textZone, '锁定 Harness 依赖的 data-type-badge 钩子必须保留').toContain('data-type-badge={paragraph.type}')
    })

    it('引用型控件不再裸写十六进制，改用令牌', () => {
      const notes = stripComments(read('src/ui/components/notes.tsx'))
      expect(notes).toContain('var(--color-concept)')
      expect(notes, '不得再裸写 #3b82f6').not.toContain('#3b82f6')
    })

    it('反例锚点：深底四色令牌不得再是旧值（只在令牌声明处判定，注释里可以引用历史值）', () => {
      const code = stripComments(indexCss)
      for (const legacy of ['#3b82f6', '#10b981', '#f59e0b', '#6b7280']) {
        expect(code, `index.css 的令牌声明里不得再出现旧色 ${legacy}`).not.toContain(legacy)
      }
    })
  })
})
