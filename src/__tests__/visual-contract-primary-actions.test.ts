import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * AC-UX-01 / AC-UX-06 — 视觉合同 S1「主按钮族」
 *
 * 依据 `docs/development/visual-contract.md`：
 * - `DEC-VC-01` / `DEC-VC-02`：主按钮 = 描边款（底色为中性表面、1px 中性边框、无彩色实底），
 *   文字与边框必须达标（文字 ≥4.5:1、1px 边框 ≥3:1）。
 * - `VC-03`③：模式/Tab 激活态 = 底色变暗（不得用彩色下划线）。
 * - `VC-03`④：聚焦圈 = 2px 虚线、浅灰白。
 * - `VCGAP-01` / `VCGAP-09`：不得再出现 `#4a9eff` 彩色实底与白字压蓝底（2.75:1）。
 *
 * 本文件按「真实源码 + 真实 CSS 级联」裁判：CSS 走 jsdom 注入 `src/index.css` 后读计算样式，
 * 内联样式对象走真实源码文本解析。数值全部来自 WCAG 2.1 相对亮度公式（容差 ±0.05）。
 */

const ROOT = process.cwd()
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8')

const LIGHT_GRAY = '#e5e5e5'
const PANEL = '#242424'
const BORDER = '#8f8f8f'
const ACCENT = '#4a9eff'
const FLAT_BACKGROUNDS = new Set(['transparent', 'none', 'inherit', 'initial', 'unset'])

/** WCAG 2.1 相对亮度 */
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

/** `rgba(r,g,b,a)` 按层合成到不透明底色上 */
function flatten(rgba: string, background: string): string {
  const match = rgba.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/)
  if (!match) return rgba
  const alpha = match[4] === undefined ? 1 : Number(match[4])
  const base = background.replace('#', '')
  const mixed = [0, 1, 2].map((index) => {
    const top = Number(match[index + 1])
    const bottom = parseInt(base.slice(index * 2, index * 2 + 2), 16)
    return Math.round(top * alpha + bottom * (1 - alpha))
  })
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function cssVariables(source: string): Map<string, string> {
  const variables = new Map<string, string>()
  for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    variables.set(match[1], match[2].trim())
  }
  return variables
}

/** 从源码里的 `name: { ... }` 样式对象中取某属性值 */
function styleProperty(source: string, objectName: string, property: string): string {
  const start = source.indexOf(`const ${objectName}`)
  if (start === -1) throw new Error(`style object not found: ${objectName}`)
  const end = source.indexOf('\n}', start)
  const block = source.slice(start, end === -1 ? undefined : end)
  const match = block.match(new RegExp(`(?:^|\\n)\\s*${property}\\s*:\\s*'([^']*)'`))
  if (!match) throw new Error(`property not found: ${objectName}.${property}`)
  return match[1].trim()
}

function expectTextContrast(foreground: string, background: string, label: string) {
  const ratio = contrast(foreground, background)
  expect(ratio, `${label}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1 (need >= 4.5:1)`).toBeGreaterThanOrEqual(4.5)
}

function expectNonTextContrast(foreground: string, background: string, label: string) {
  const ratio = contrast(foreground, background)
  expect(ratio, `${label}: ${foreground} on ${background} = ${ratio.toFixed(2)}:1 (need >= 3:1)`).toBeGreaterThanOrEqual(3)
}

describe('S1 主按钮族：DEC-VC-01 / DEC-VC-02 / VC-03', () => {
  let indexCss: string
  let variables: Map<string, string>
  let listPage: string
  let taskDialog: string
  let studyInterface: string

  beforeAll(() => {
    indexCss = read('src/index.css')
    variables = cssVariables(indexCss)
    listPage = read('src/pages/VideoListPage.tsx')
    taskDialog = read('src/ui/components/import-task-dialog.tsx')
    studyInterface = read('src/pages/StudyInterface.tsx')
  })

  describe('色值令牌取自 §5.4.1 标定表', () => {
    it('正文/面板/边框/浅灰白令牌与标定值一致', () => {
      expect(variables.get('--color-fg')).toBe(LIGHT_GRAY)
      expect(variables.get('--color-surface')).toBe(PANEL)
      expect(variables.get('--color-border')).toBe(BORDER)
    })

    it('令牌之间实测达标：边框对面板 ≥3:1、文字对面板 ≥4.5:1', () => {
      expectNonTextContrast(BORDER, PANEL, '边框/面板')
      expectNonTextContrast(BORDER, variables.get('--color-bg')!, '边框/页底')
      expectTextContrast(LIGHT_GRAY, PANEL, '文字/面板')
      expectTextContrast(variables.get('--color-muted')!, PANEL, '次要文字/面板')
    })
  })

  describe('VCGAP-09 / VCGAP-01：主按钮改描边款，不得再有彩色实底', () => {
    it('列表页导入按钮：底色为面板色、文字为正文色、1px 中性边框', () => {
      expect(styleProperty(listPage, 'importButtonStyle', 'background')).toBe('var(--color-surface)')
      expect(styleProperty(listPage, 'importButtonStyle', 'color')).toBe('var(--color-fg)')
      expect(styleProperty(listPage, 'importButtonStyle', 'border')).toBe('1px solid var(--color-border)')
    })

    it('任务详情主按钮：底色为面板色、文字为正文色、边框为中性色', () => {
      expect(styleProperty(taskDialog, 'primaryButtonStyle', 'background')).toBe('var(--color-surface)')
      expect(styleProperty(taskDialog, 'primaryButtonStyle', 'color')).toBe('var(--color-fg)')
      expect(styleProperty(taskDialog, 'primaryButtonStyle', 'borderColor')).toBe('var(--color-border)')
    })

    it('导入按钮与任务详情主按钮都不得再出现白字或强调色实底', () => {
      const importButton = listPage.slice(listPage.indexOf('const importButtonStyle'), listPage.indexOf('const settingsButtonStyle'))
      const primaryButton = taskDialog.slice(taskDialog.indexOf('const primaryButtonStyle'), taskDialog.indexOf('export function ImportTaskDialog'))
      for (const [label, block] of [['importButtonStyle', importButton], ['primaryButtonStyle', primaryButton]] as const) {
        expect(block, `${label} 不得使用白字`).not.toMatch(/#fff\b|#ffffff|white\b/i)
        expect(block, `${label} 不得使用强调色`).not.toContain('--color-accent')
      }
    })

    it('实测：描边款文字与边框都达标，且不再存在 2.75:1 的白字压蓝底', () => {
      expectTextContrast(LIGHT_GRAY, PANEL, '描边款文字/底色')
      expectNonTextContrast(BORDER, PANEL, '描边款边框/底色')
      // 曾经的失败组合仍必须是不达标的（作为反例锚点，防止有人"修"回去）
      expect(contrast('#ffffff', ACCENT)).toBeLessThan(4.5)
    })
  })

  describe('VC-03③：Tab 激活态用底色变暗，不得用彩色下划线', () => {
    it('激活态不再出现 `2px solid var(--color-accent)` 下划线', () => {
      expect(studyInterface).not.toContain('2px solid var(--color-accent)')
    })

    it('激活态有真实底色（非 transparent），且激活底色比非激活更暗', () => {
      const activeBackground = styleProperty(studyInterface, 'tabActiveStyle', 'background')
      const inactiveBackground = styleProperty(studyInterface, 'tabInactiveStyle', 'background')
      expect(FLAT_BACKGROUNDS.has(activeBackground), `激活底色不得为 ${activeBackground}`).toBe(false)
      expect(FLAT_BACKGROUNDS.has(inactiveBackground), `非激活底色不得为 ${inactiveBackground}`).toBe(false)
      const toHex = (value: string) => (value.startsWith('#') ? value : variables.get(value.replace(/var\(|\)/g, ''))!)
      const activeLuminance = luminance(toHex(activeBackground))
      const inactiveLuminance = luminance(toHex(inactiveBackground))
      expect(
        activeLuminance,
        `激活底色 ${activeBackground} 的相对亮度 ${activeLuminance} 必须低于非激活 ${inactiveBackground} 的 ${inactiveLuminance}`,
      ).toBeLessThan(inactiveLuminance)
    })
  })

  describe('VC-03④：聚焦圈 = 2px 虚线、浅灰白，且达标', () => {
    it('index.css 声明了 focus-visible 的 2px 虚线聚焦圈', () => {
      const focusRule = indexCss.slice(indexCss.indexOf(':focus-visible'))
      expect(focusRule.length, ':focus-visible 规则必须存在').toBeGreaterThan(0)
      expect(focusRule).toMatch(/outline\s*:\s*2px\s+dashed/)
      expect(focusRule).toMatch(/var\(--color-fg\)|#e5e5e5/)
    })

    it('实测：聚焦圈颜色对页底与面板都 ≥3:1', () => {
      expectNonTextContrast(LIGHT_GRAY, variables.get('--color-bg')!, '聚焦圈/页底')
      expectNonTextContrast(LIGHT_GRAY, PANEL, '聚焦圈/面板')
    })
  })
})

describe('S1 真实 CSS 级联：2px 虚线聚焦圈在 jsdom 中生效', () => {
  let style: HTMLStyleElement

  beforeAll(() => {
    style = document.createElement('style')
    style.textContent = read('src/index.css')
    document.head.append(style)
  })

  afterAll(() => {
    style.remove()
  })

  it('body 上读到的正文/边框令牌就是标定值', () => {
    const computed = getComputedStyle(document.documentElement)
    expect(computed.getPropertyValue('--color-fg').trim()).toBe(LIGHT_GRAY)
    expect(computed.getPropertyValue('--color-border').trim()).toBe(BORDER)
  })

  it('聚焦圈规则可被解析：outline 为 2px dashed 且颜色为浅灰白', () => {
    // jsdom 的默认样式表不实现 `:focus-visible` 的层叠（读计算样式会得到空串），
    // 因此这里直接裁判生产 CSS 中的规则文本；真实可见性由视觉合同的桌面实测裁判。
    const source = read('src/index.css')
    const rule = source.match(/:focus-visible\s*\{[^}]*\}/)
    expect(rule, ':focus-visible 规则必须存在于 src/index.css').not.toBeNull()
    expect(rule![0]).toMatch(/outline\s*:\s*2px\s+dashed\s+var\(--color-fg\)/)
    expect(rule![0]).toMatch(/outline-offset\s*:\s*2px/)
  })
})
