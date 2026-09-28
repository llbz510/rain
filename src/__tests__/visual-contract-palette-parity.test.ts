import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * AC-UX-01 / AC-UX-02 — 视觉合同 S3：两套色板并存且各自达标（缺口 `VCGAP-04`）
 *
 * 依据 `docs/development/visual-contract.md`：
 * - `DEC-VC-03`：**按背景分两套值、语义不变**；这是**判据**，同一语义必须满足
 *   `L(深底套值) > L(浅底套值)`，且两套各自满足所属底色的 AA 阈值。
 * - §5.5.1 / §5.5.2 是两套的「已冻结取值」：深底套来自 `src/index.css` 的 `--color-*`，
 *   浅底套来自 `src/ui/components/settings/shared.ts` 的 `COLORS`。
 *
 * 本裁判锁定「两套并存」的三件事：① 中性色阶两套都完整且单调（背景 < 面板 < 面板2/悬停）；
 * ② 两套已冻结取值各自达标；③ 同一语义的方向判据成立（深底更亮）。
 * **深底四色（S4 起在本裁判内）**：`--color-concept/example/analogy/transition` 已由 S4 落地为 §5.5.1 的「彩字态」值；
 * 本裁判 ③ 直接读这四个令牌，并断言「同一语义深底套值恒比浅底套值更亮」。
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

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function colorToken(source: string, token: string): string {
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${token}\\s*:\\s*'([^']+)'`))
  if (!match) throw new Error(`token not found: ${token}`)
  return match[1].trim()
}

function cssToken(source: string, token: string): string {
  const match = source.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`))
  if (!match) throw new Error(`css token not found: ${token}`)
  return match[1]
}

describe('VCGAP-04：两套色板并存、各自达标、方向判据成立', () => {
  let shared: string
  let indexCss: string
  let deep: Record<string, string>
  let light: Record<string, string>

  beforeAll(() => {
    shared = read('src/ui/components/settings/shared.ts')
    indexCss = read('src/index.css')
    deep = {
      bg: cssToken(indexCss, 'color-bg'),
      surface: cssToken(indexCss, 'color-surface'),
      hover: cssToken(indexCss, 'color-surface-hover'),
      border: cssToken(indexCss, 'color-border'),
      fg: cssToken(indexCss, 'color-fg'),
      muted: cssToken(indexCss, 'color-muted'),
      concept: cssToken(indexCss, 'color-concept'),
      example: cssToken(indexCss, 'color-example'),
      analogy: cssToken(indexCss, 'color-analogy'),
      transition: cssToken(indexCss, 'color-transition'),
    }
    light = {
      bg: colorToken(shared, 'bg'),
      panel: colorToken(shared, 'panel'),
      panel2: colorToken(shared, 'panel2'),
      fg: colorToken(shared, 'fg'),
      muted: colorToken(shared, 'muted'),
      dimmer: colorToken(shared, 'dimmer'),
      border: colorToken(shared, 'border'),
      border2: colorToken(shared, 'border2'),
      concept: colorToken(shared, 'concept'),
      example: colorToken(shared, 'example'),
      analogy: colorToken(shared, 'analogy'),
      fail: colorToken(shared, 'fail'),
    }
  })

  it('① 两套中性色阶都完整，且「背景 < 面板 < 面板2/悬停」单调成立', () => {
    expect(luminance(deep.bg)).toBeLessThan(luminance(deep.surface))
    expect(luminance(deep.surface)).toBeLessThan(luminance(deep.hover))
    expect(luminance(light.bg)).toBeLessThan(luminance(light.panel))
    expect(luminance(light.panel)).toBeLessThan(luminance(light.panel2))
  })

  it('② 深底套已冻结取值达标（fg / muted 文字，border 非文本）', () => {
    for (const surface of ['bg', 'surface', 'hover'] as const) {
      expect(contrast(deep.fg, deep[surface]), `深底 fg/${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(deep.muted, deep[surface]), `深底 muted/${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(deep.border, deep[surface]), `深底 border/${surface}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('② 浅底套已冻结取值达标（fg / muted / dimmer 文字，border / border2 非文本）', () => {
    for (const surface of ['bg', 'panel', 'panel2'] as const) {
      expect(contrast(light.fg, light[surface]), `浅底 fg/${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(light.muted, light[surface]), `浅底 muted/${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(light.dimmer, light[surface]), `浅底 dimmer/${surface}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(light.border, light[surface]), `浅底 border/${surface}`).toBeGreaterThanOrEqual(3)
      expect(contrast(light.border2, light[surface]), `浅底 border2/${surface}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('③ 方向判据（可失败部分）：同一「次要文字」语义，深底套源码值必须比浅底套源码值更亮', () => {
    // 两侧都来自真实源码（index.css 的 --color-muted 与 COLORS.muted/dimmer），因此这条有失败能力。
    expect(luminance(deep.muted)).toBeGreaterThan(luminance(light.muted))
  })

  it('③ 方向判据（S4 起读真实源码、具备失败能力）：同一语义的深底套值必须比浅底套值更亮', () => {
    // 两侧都来自真实源码：深底套 = index.css 的 --color-* 令牌，浅底套 = COLORS.*。
    // S3 时深底四色还是旧值、本条只能对目标值做锚点；S4 落地后按合同 §5.4 的 S4 必做项改为读真实源码
    // （已用旧令牌验证过它确实会失败：深底 #3b82f6 比浅底 #539bf5 更暗）。
    const pairs: Array<[string, string, string]> = [
      ['次要文字灰', deep.muted, light.muted],
      ['概念蓝', deep.concept, light.concept],
      ['例子绿', deep.example, light.example],
      ['类比橙', deep.analogy, light.analogy],
      ['过渡灰', deep.transition, light.dimmer],
    ]
    for (const [name, deepValue, lightValue] of pairs) {
      expect(luminance(deepValue), `${name}：深底套 ${deepValue} 必须比浅底套 ${lightValue} 更亮`).toBeGreaterThan(luminance(lightValue))
    }
    // 浅底四色必须仍是 §5.5.2 的冻结值（同样来自源码，防止被悄悄改回旧值）。
    expect(colorToken(shared, 'concept')).toBe('#539bf5')
    expect(colorToken(shared, 'example')).toBe('#3fb950')
    expect(colorToken(shared, 'analogy')).toBe('#db6d28')
    expect(colorToken(shared, 'fail')).toBe('#f85149')
  })

  it('④ 两套不混用：设置页（浅底套）源码不得引用深底套的 CSS 令牌', () => {
    const dir = join(ROOT, 'src/ui/components/settings')
    const files = readdirSync(dir).filter((name) => /\.tsx?$/.test(name))
    expect(files.length).toBeGreaterThan(0)
    for (const name of files) {
      const code = stripComments(read(`src/ui/components/settings/${name}`))
      expect(code, `${name} 不得混用深底套令牌`).not.toMatch(/var\(--color-/)
    }
  })

  it('⑤ 浅底四色必须等于 §5.5.2 的冻结取值（防止被悄悄改回旧值）', () => {
    expect(colorToken(shared, 'concept')).toBe('#539bf5')
    expect(colorToken(shared, 'example')).toBe('#3fb950')
    expect(colorToken(shared, 'analogy')).toBe('#db6d28')
    expect(colorToken(shared, 'fail')).toBe('#f85149')
  })
})
