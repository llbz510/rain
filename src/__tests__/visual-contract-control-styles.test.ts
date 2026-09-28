import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * AC-UX-01 / AC-UX-06 — 视觉合同 S3「剩余控件取值归一」
 *
 * 依据 `docs/development/visual-contract.md`：
 * - `VC-03`②：**主按钮为描边款** —— 底色 = 该套面板色（深底 `#242424` / 浅底 `#161b22`）、
 *   边框 `1px` = 该套 `border`（深底 `#8f8f8f` 对底 4.80:1；浅底 `#6e7074` 对面板 3.49:1）、
 *   文字 = 该套 `fg`（12.32:1 / 14.64:1）。缺口 `VCGAP-21`（4 处：深底 URL 导入弹窗 1 处、
 *   浅底设置页 `primaryBtn` 3 处调用点）。
 * - `DEC-VC-02` 边界 4：**`1px` 边框一律 ≥3:1**。缺口 `VCGAP-22`：类型胶囊与危险按钮的
 *   「同色细边」当前是 `alpha = .3` 的叠色（对底仅 1.48–1.73:1），改为**全色同色细边**
 *   （`COLORS.concept/analogy/example/fail`）即可达标且仍是「同色细边」（决策 71）。
 *
 * 数值口径：WCAG 2.1 相对亮度；`rgba` 先按层合成到实际底色；容差 ±0.05。
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

/** 从 `COLORS` 取某令牌的字面量 */
function colorToken(source: string, token: string): string {
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${token}\\s*:\\s*'([^']+)'`))
  if (!match) throw new Error(`token not found: ${token}`)
  return match[1].trim()
}

/** 取一段源码中的样式对象文本（先去掉注释，避免注释里引用的旧写法被算作实现） */
function block(source: string, pattern: RegExp, label: string): string {
  const match = stripComments(source).match(pattern)
  expect(match, `${label} 必须存在`).not.toBeNull()
  return match![0]
}

function expectNonText(foreground: string, background: string, label: string) {
  const ratio = contrast(composite(foreground, background), background)
  expect(ratio, `${label}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1 (need >= 3:1)`).toBeGreaterThanOrEqual(3)
}

function expectText(foreground: string, background: string, label: string) {
  const ratio = contrast(composite(foreground, background), background)
  expect(ratio, `${label}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1 (need >= 4.5:1)`).toBeGreaterThanOrEqual(4.5)
}

const LIGHT_SURFACES = ['panel', 'panel2', 'bg'] as const

describe('S3 剩余控件：主按钮一律描边款 + 同色细边一律 ≥3:1', () => {
  let videoList: string
  let shared: string
  let palette: Record<string, string>
  let deep: Record<string, string>
  let indexCss: string

  beforeAll(() => {
    videoList = read('src/pages/VideoListPage.tsx')
    shared = read('src/ui/components/settings/shared.ts')
    indexCss = read('src/index.css')
    palette = {
      bg: colorToken(shared, 'bg'),
      panel: colorToken(shared, 'panel'),
      panel2: colorToken(shared, 'panel2'),
      fg: colorToken(shared, 'fg'),
      concept: colorToken(shared, 'concept'),
      example: colorToken(shared, 'example'),
      analogy: colorToken(shared, 'analogy'),
      fail: colorToken(shared, 'fail'),
    }
    deep = {
      bg: indexCss.match(/--color-bg:\s*(#[0-9a-fA-F]{6})/)![1],
      surface: indexCss.match(/--color-surface:\s*(#[0-9a-fA-F]{6})/)![1],
      fg: indexCss.match(/--color-fg:\s*(#[0-9a-fA-F]{6})/)![1],
      border: indexCss.match(/--color-border:\s*(#[0-9a-fA-F]{6})/)![1],
    }
  })

  describe('VCGAP-21：4 处主按钮改描边款（底色 = 面板色、边框 = border 令牌、无半透明白实底）', () => {
    it('深底 URL 导入弹窗的主按钮是描边款', () => {
      const style = block(videoList, /const modalBtnPrimaryStyle[\s\S]*?\n\}/, 'modalBtnPrimaryStyle')
      expect(style).toMatch(/background:\s*'var\(--color-surface\)'/)
      expect(style).toMatch(/border:\s*'1px solid var\(--color-border\)'/)
      expect(style).toMatch(/color:\s*'var\(--color-fg\)'/)
      expect(style, '不得再是半透明白实底').not.toContain('rgba(255,255,255')
      expect(style, '不得再是透明边框').not.toMatch(/border:\s*'1px solid transparent'/)
    })

    it('浅底设置页主按钮（settings/shared.ts 的 primaryBtn）是描边款', () => {
      const style = block(shared, /primaryBtn:\s*\{[\s\S]*?\}\s*as CSSProperties/, 'primaryBtn')
      expect(style, '底色必须是面板色本身（不是 panel2、也不是叠色）').toMatch(/background:\s*COLORS\.panel,/)
      expect(style).toMatch(/border:\s*`1px solid \$\{COLORS\.border\}`/)
      expect(style).toMatch(/color:\s*COLORS\.fg,/)
      expect(style, '不得再是半透明白实底').not.toContain('rgba(255,255,255')
    })

    it('测：两套描边款主按钮的文字与边框都达标', () => {
      expectText(deep.fg, deep.surface, '深底 主按钮文字/面板')
      expectNonText(deep.border, deep.surface, '深底 主按钮边框/面板')
      expectText(palette.fg, palette.panel, '浅底 主按钮文字/面板')
      expectNonText(colorToken(shared, 'border'), palette.panel, '浅底 主按钮边框/面板')
    })

    it('反例锚点：旧的 12% 白实底写法必须彻底消失（防止改回去）', () => {
      for (const [name, source] of [['VideoListPage.tsx', videoList], ['settings/shared.ts', shared]] as const) {
        expect(stripComments(source), `${name} 不得再有 rgba(255,255,255,.12) 主按钮实底`).not.toContain('rgba(255,255,255,.12)')
      }
    })
  })

  describe('VCGAP-22：类型胶囊与危险按钮的同色细边 ≥3:1（底色不变，只把细边改全色）', () => {
    it('TAG_STYLES 的三个细边取全色同色值，不再是 alpha .3', () => {
      const tags = block(shared, /const TAG_STYLES[\s\S]*?\n\}/, 'TAG_STYLES')
      expect(tags).toMatch(/borderColor:\s*COLORS\.concept/)
      expect(tags).toMatch(/borderColor:\s*COLORS\.analogy/)
      expect(tags).toMatch(/borderColor:\s*COLORS\.example/)
      expect(tags, '不得再有 alpha .3 的叠色细边').not.toMatch(/borderColor:\s*'rgba\(/)
      // 逐个标签核对映射：四个 borderColor 必须**恰好**是这四个令牌（顺序与 TAG_STYLES 一致），
      // 任何一格被改成别的值（含硬编码色）都会在这里失败。
      const declared = [...tags.matchAll(/borderColor:\s*([^,\n]+),/g)].map((m) => m[1].trim())
      expect(declared, 'TAG_STYLES 必须恰好声明 4 个 borderColor').toHaveLength(4)
      expect(declared).toEqual(['COLORS.concept', 'COLORS.analogy', 'COLORS.example', 'COLORS.example'])
    })

    it('危险按钮的细边取 COLORS.fail 全色', () => {
      const danger = block(shared, /dangerBtn:\s*\{[\s\S]*?\}\s*as CSSProperties/, 'dangerBtn')
      expect(danger).toMatch(/border:\s*`1px solid \$\{COLORS\.fail\}`/)
      expect(danger, '不得再有 alpha .3 的叠色细边').not.toContain('rgba(248,81,73,.3)')
    })

    it('测：四个细边色对浅底三种底色全部 ≥3:1', () => {
      for (const semantic of ['concept', 'example', 'analogy', 'fail'] as const) {
        for (const surface of LIGHT_SURFACES) {
          expectNonText(palette[semantic], palette[surface], `${semantic}/${surface}`)
        }
      }
    })

    it('淡底仍是 alpha 0.10（可测边界 0.05–0.12），本 Slice 不改', () => {
      const tags = block(shared, /const TAG_STYLES[\s\S]*?\n\}/, 'TAG_STYLES')
      const alphas = [...tags.matchAll(/background:\s*'rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)'/g)].map((m) => Number(m[1]))
      expect(alphas.length, 'TAG_STYLES 的四个标签都要有同色淡底').toBe(4)
      for (const alpha of alphas) {
        expect(alpha, `淡底 alpha ${alpha} 必须在 0.05–0.12 内`).toBeGreaterThanOrEqual(0.05)
        expect(alpha).toBeLessThanOrEqual(0.12)
      }
    })

    it('反例锚点：旧的 alpha .3 细边必须仍是不达标的（防止改回去）', () => {
      for (const surface of LIGHT_SURFACES) {
        expect(contrast(composite('rgba(83,155,245,.3)', palette[surface]), palette[surface])).toBeLessThan(3)
        expect(contrast(composite('rgba(248,81,73,.3)', palette[surface]), palette[surface])).toBeLessThan(3)
      }
    })
  })
})
