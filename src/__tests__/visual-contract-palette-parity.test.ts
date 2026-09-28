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
 * **不在本裁判内的项**：深底套的四色令牌（`--color-concept/example/analogy/transition`）当前仍是
 * 旧值、由 `VCGAP-03`/`VCGAP-14`/`VCGAP-15` 登记并在 **S4** 修复——本裁判不为它们签发通过。
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

  it('③ 方向判据的「类型色」部分：当前只登记 S4 目标值锚点，**不计入本 Slice 的关闭依据**', () => {
    // 深底四色（--color-concept/example/analogy/transition）当前仍是旧值、由 VCGAP-03/14/15 登记并在 S4 落地，
    // 所以这一组比对的两个值**都不来自当前源码**、无法失败——它是给 S4 的目标锚点，不是锁定。
    // S4 必须把本条改成「读真实源码」再真判（合同 §5.4 的 S4 必做项）。
    const s4Targets: Array<[string, string, string]> = [
      ['概念蓝', '#5b9bf8', '#539bf5'],
      ['例子绿', '#3ecf8e', '#3fb950'],
      ['类比橙', '#f0a13c', '#db6d28'],
      ['失败红', '#ff6b61', '#f85149'],
    ]
    for (const [name, deepTarget, lightValue] of s4Targets) {
      expect(luminance(deepTarget), `${name}：S4 目标值必须比浅底套更亮`).toBeGreaterThan(luminance(lightValue))
    }
    // 浅底四色必须仍是 §5.5.2 的冻结值（这部分来自源码，有失败能力，见下一条）。
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
