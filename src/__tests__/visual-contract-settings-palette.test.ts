import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * AC-UX-01 / AC-UX-06 — 视觉合同 S2「边框族」（浅底套）
 *
 * 依据 `docs/development/visual-contract.md`：
 * - `DEC-VC-02` 边界 4：**1px 边框一律 ≥3:1**，且**两套调色板的所有边框令牌都算在内**
 *   （深底 `--color-border` 已在 S1 关闭；本 Slice 负责浅底 `COLORS.border` / `COLORS.border2`）。
 * - §5.5.2 标定：浅底 `border → #6e7074`、`border2 → #7c828c`。
 * - `VCGAP-17`：`dimmer #6e7681` 作文字不达标（对 panel 3.77 / panel2 3.45 / bg 4.12）→
 *   归并为 `muted`，或取落在「方向 + 达标」窗口 `L ∈ [0.2484, 0.3419)` 内的第三档 `#868f99`。
 * - `VC-03`④：聚焦圈 = 2px 虚线、浅灰白。全应用由 `src/index.css` 的全局 `:focus-visible`
 *   统一提供（浅底套不另设局部令牌），本套判的是该规则**实际解析出的颜色**在浅底底色上的比值。
 *
 * 浅底 `border` / `border2` 是 `rgba()` 叠加色，必须先按层合成到各底色上再比较（§3.2 测量协议）。
 * 数值全部来自 WCAG 2.1 相对亮度公式（容差 ±0.05）。
 */

const ROOT = process.cwd()
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8')

/** 去掉注释后再做「不得自行声明 outline / focus」之类的源码守卫，避免注释里的示例被误判 */
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

/** `rgba(r,g,b,a)` 或 `#rrggbb` 按层合成到不透明底色上 */
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

/** 从 `shared.ts` 的 `COLORS` 对象取某令牌的字面量 */
function colorToken(source: string, token: string): string {
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${token}\\s*:\\s*'([^']+)'`))
  if (!match) throw new Error(`token not found: ${token}`)
  return match[1].trim()
}

function expectNonTextContrast(foreground: string, background: string, label: string) {
  const ratio = contrast(foreground, background)
  expect(ratio, `${label}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1 (need >= 3:1)`).toBeGreaterThanOrEqual(3)
}

function expectTextContrast(foreground: string, background: string, label: string) {
  const ratio = contrast(foreground, background)
  expect(ratio, `${label}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1 (need >= 4.5:1)`).toBeGreaterThanOrEqual(4.5)
}

describe('S2 边框族：浅底套 1px 边框与次级文字', () => {
  let shared: string
  let palette: Record<string, string>
  let indexCss: string

  beforeAll(() => {
    shared = read('src/ui/components/settings/shared.ts')
    indexCss = read('src/index.css')
    palette = {
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

  describe('VCGAP-20：两个 1px 边框令牌必须 ≥3:1（合成后）', () => {
    it('border 取不透明 `#6e7074`', () => {
      expect(palette.border).toBe('#6e7074')
    })

    it('border2 取不透明 `#7c828c`', () => {
      expect(palette.border2).toBe('#7c828c')
    })

    it('测：两个边框令牌对 bg / panel / panel2 全部 ≥3:1', () => {
      for (const surface of ['bg', 'panel', 'panel2'] as const) {
        const background = palette[surface]
        expectNonTextContrast(composite(palette.border, background), background, `border/${surface}`)
        expectNonTextContrast(composite(palette.border2, background), background, `border2/${surface}`)
      }
    })

    it('反例锚点：旧的半透明边框仍必须是不达标的（防止改回去）', () => {
      const oldBorder = composite('rgba(255,255,255,.08)', palette.panel)
      const oldBorder2 = composite('rgba(255,255,255,.05)', palette.panel2)
      expect(contrast(oldBorder, palette.panel), '旧 border 应 <3:1').toBeLessThan(3)
      expect(contrast(oldBorder2, palette.panel2), '旧 border2 应 <3:1').toBeLessThan(3)
    })
  })

  describe('VCGAP-17：次级文字的取值必须达标且方向仍比 muted 更暗', () => {
    it('dimmer 改为 `#868f99`', () => {
      expect(palette.dimmer).toBe('#868f99')
    })

    it('测：dimmer 对 bg / panel / panel2 全部 ≥4.5:1', () => {
      for (const surface of ['bg', 'panel', 'panel2'] as const) {
        expectTextContrast(palette.dimmer, palette[surface], `dimmer/${surface}`)
      }
    })

    it('dimmer 的相对亮度必须低于 muted（第三档不能比第二档更亮）', () => {
      expect(luminance(palette.dimmer)).toBeLessThan(luminance(palette.muted))
    })

    it('反例锚点：旧的 dimmer `#6e7681` 仍必须是不达标的（防止改回去）', () => {
      const oldDimmer = '#6e7681'
      expect(contrast(oldDimmer, palette.panel), '旧 dimmer 对 panel 应 <4.5:1').toBeLessThan(4.5)
      expect(contrast(oldDimmer, palette.panel2), '旧 dimmer 对 panel2 应 <4.5:1').toBeLessThan(4.5)
    })

    it('muted 与 fg 保持不变（本 Slice 不改它们）', () => {
      expect(palette.muted).toBe('#8b949e')
      expect(palette.fg).toBe('#e6edf3')
    })
  })

  describe('VC-03④：聚焦圈（全应用统一规则）在浅底套上仍必须 ≥3:1', () => {
    it('index.css 的全局聚焦圈规则仍是 2px 虚线 + 2px offset（S1 落地，S2 不得回退）', () => {
      const rule = indexCss.match(/:focus-visible\s*\{[^}]*\}/)
      expect(rule, ':focus-visible 规则必须存在').not.toBeNull()
      expect(rule![0]).toMatch(/outline\s*:\s*2px\s+dashed\s+var\(--color-fg\)/)
      expect(rule![0]).toMatch(/outline-offset\s*:\s*2px/)
    })

    it('测：该规则实际解析出的颜色对浅底套 bg / panel / panel2 全部 ≥3:1', () => {
      const token = indexCss.match(/--color-fg\s*:\s*(#[0-9a-fA-F]{3,8})/)
      expect(token, 'index.css 必须定义 --color-fg').not.toBeNull()
      const ring = token![1]
      for (const surface of ['bg', 'panel', 'panel2'] as const) {
        expectNonTextContrast(ring, palette[surface], `focus/${surface}`)
      }
    })

    it('反例锚点：若把聚焦圈改回旧的深灰 `#3a3a3a`（原 --color-border），必须是不达标的', () => {
      expect(contrast('#3a3a3a', palette.panel), '旧深灰作聚焦圈应 <3:1').toBeLessThan(3)
    })

    it('浅底套不另设局部 focus 令牌或内联 outline：聚焦圈只有全局规则一个来源', () => {
      const dir = join(ROOT, 'src/ui/components/settings')
      const files = readdirSync(dir).filter((name) => /\.tsx?$/.test(name))
      expect(files.length).toBeGreaterThan(0)
      for (const name of files) {
        const code = stripComments(read(`src/ui/components/settings/${name}`))
        expect(code, `${name} 不应自行声明 outline`).not.toMatch(/outline\s*:/)
      }
      expect(stripComments(shared)).not.toMatch(/(?:^|\n)\s*focus\s*:/)
    })
  })
})

describe('S2 浅底套令牌未被硬编码旧值绕过', () => {
  it('设置页全部源码文件都不再出现旧的两个半透明边框字面量', () => {
    const dir = join(ROOT, 'src/ui/components/settings')
    const files = readdirSync(dir).filter((name) => /\.tsx?$/.test(name))
    expect(files.length).toBeGreaterThan(0)
    for (const name of files) {
      const code = stripComments(read(`src/ui/components/settings/${name}`))
      expect(code, `${name} 不应再硬编码旧边框值`).not.toContain('rgba(255,255,255,.08)')
      expect(code, `${name} 不应再硬编码旧边框值`).not.toContain('rgba(255,255,255,.05)')
    }
  })

  it('设置页仍通过 `COLORS.*` 引用令牌（未散落硬编码新值）', () => {
    for (const name of ['settings-page.tsx', 'preflight-panel.tsx', 'add-model-form.tsx', 'model-pool-list.tsx', 'role-selector.tsx']) {
      const code = stripComments(read(`src/ui/components/settings/${name}`))
      expect(code, `${name} 应引用 COLORS 令牌`).toMatch(/COLORS\.(border|border2|dimmer)/)
      expect(code, `${name} 不应硬编码新边框字面量`).not.toMatch(/#(6e7074|7c828c)/)
    }
  })
})
