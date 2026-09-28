import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

/**
 * AC-VL-07 / AC-VL-01 — 视觉合同 S6「列表卡视觉」
 *
 * 依据 `docs/development/visual-contract.md`：
 * - `VCGAP-06`（`VC-10`/`VC-11`，blocker）：卡片渲染 16:9 缩略图容器 + 圆角 + 4px 进度条 + 「最近学习」小字 +
 *   右下「语言·来源」角标 + 标题 2 行截断 + 已看完信息条文字 + 非就绪卡蒙层与左上徽章。
 * - `VCGAP-19`（`VC-10`②，low）：就绪卡进度条必须取该套**中性档** `--color-muted`（= `#9a9a9a`），
 *   不得使用类型色/强调色。
 * - 冻结依据：决策 77（`M13-visual-design.md:69-75`）；`VC-10`（`visual-contract.md:159`）、`VC-11`（`:160`）。
 * - 冻结阶梯：圆角 `--radius-0/1/2/3/pill`（`src/index.css:57-61`）、字号五档（`:40-44`）。
 *
 * 数值口径：阶梯与令牌值**从 `src/index.css` 解析后与合同冻结值对照**；解析不到即失败（非空转）。
 * 标注「守卫」的断言是**改动前后都成立**的不变式（既有 E2E 钩子、网格已合规项），不计入 RED。
 *
 * **未冻结点（登记为缺口，见合同 §5.3 的 S6 行）**：缩略图容器圆角取哪一档、进度条槽底色、
 * 右下角标与蒙层的样式取值，决策 77 均未给数值——本裁判只断言「取既有阶梯/令牌里的值」，不发明取值。
 */

const ROOT = process.cwd()
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8')

describe('S6 列表卡视觉：16:9 + 信息顺序 + 进度条中性色 + 角标 + 截断', () => {
  let css: string
  let card: string
  let radiusLadder: string[]
  let tokenPx: (name: string) => number
  let mutedHex: string

  beforeAll(() => {
    css = read('src/index.css')
    card = read('src/ui/components/video-list.tsx')
    radiusLadder = ['0', '1', '2', '3', 'pill'].map((step) => {
      const m = css.match(new RegExp(`--radius-${step}:\\s*(\\d+)px`))
      if (!m) throw new Error(`index.css 缺少 --radius-${step}`)
      return m[1]
    })
    tokenPx = (name) => {
      const m = css.match(new RegExp(`--${name}:\\s*(\\d+)px`))
      if (!m) throw new Error(`index.css 缺少 --${name}`)
      return Number(m[1])
    }
    mutedHex = (css.match(/--color-muted:\s*(#[0-9a-fA-F]{6})/) ?? [])[1]
  })

  describe('VCGAP-06 / VC-11③④：缩略图 16:9 与标题 2 行截断', () => {
    it('缩略图容器声明 16:9，解析出的比例 = 1.7778（VC-11③ ±2px 口径）', () => {
      const thumbLine = card.match(/data-testid=\{`thumb-\$\{video\.id\}`\}[^\n]*/)
      expect(thumbLine, '缩略图容器必须存在，且 16:9 必须落在容器这一行（挪到 <img> 上不算）').not.toBeNull()
      const m = thumbLine![0].match(/aspectRatio:\s*'(\d+)\s*\/\s*(\d+)'/)
      expect(m, '缩略图容器必须声明 aspectRatio 16:9').not.toBeNull()
      const ratio = Number(m![1]) / Number(m![2])
      expect(Number(ratio.toFixed(4)), '16:9 = 1.7778').toBe(1.7778)
    })

    it('缩略图容器圆角取既有阶梯值（未冻结点：取 --radius-2 档并在合同登记）', () => {
      const m = card.match(/data-testid=\{`thumb-\$\{video\.id\}`\}[^\n]*/)
      expect(m, '缩略图容器必须存在（data-testid=thumb-<id>）').not.toBeNull()
      const token = (m![0].match(/borderRadius:\s*'var\(--radius-(\w+)\)'/) ?? [])[1]
      expect(token, '圆角必须用 --radius-* 令牌').toBeTruthy()
      const step = token === 'pill' ? 'pill' : token
      expect(['0', '1', '2', '3', 'pill'], '圆角令牌必须是阶梯里的合法档位（此前写成 radiusLadder 自我包含＝同义反复，已修）').toContain(step)
      expect(step, '按登记取 --radius-2（8px，与既有卡片/胶囊一致）').toBe('2')
    })

    it('标题 13px + 最多 2 行截断（VC-11④）', () => {
      const title = card.match(/data-testid=\{`title-\$\{video\.id\}`\}[^\n]*/)
      expect(title, '标题必须存在（data-testid=title-<id>）').not.toBeNull()
      expect(title![0]).toMatch(/fontSize:\s*'var\(--font-size-xs\)'/)
      expect(tokenPx('font-size-xs'), '阶梯里 --font-size-xs 必须是 13px').toBe(13)
      expect(title![0]).toMatch(/-?[Ww]ebkitLineClamp:\s*2/)
      expect(title![0]).toMatch(/-?[Ww]ebkitBoxOrient:\s*'vertical'/)
      expect(title![0], '2 行截断必须同时声明 display:-webkit-box，否则 line-clamp 不生效').toMatch(/display:\s*'-webkit-box'/)
    })
  })

  describe('VCGAP-19 / VC-10②：进度条 4px 且取中性档，不得用类型色/强调色', () => {
    it('进度条高度 4px、填充色 = --color-muted（该套中性档 #9a9a9a）', () => {
      const bar = card.match(/data-testid=\{`progress-fill-\$\{video\.id\}`\}[^\n]*/)
      expect(bar, '进度条填充必须存在（data-testid=progress-fill-<id>）').not.toBeNull()
      expect(bar![0]).toMatch(/height:\s*'4px'/)
      expect(bar![0]).toMatch(/background:\s*'var\(--color-muted\)'/)
      expect(bar![0], '满条必须绑在填充条自身的 width 上（只改 progressWidth 的定义不算）').toMatch(/width:\s*progressWidth/)
      expect(mutedHex, '--color-muted 必须是该套中性档').toBe('#9a9a9a')
    })

    it('反例锚点：进度条不得用类型色/强调色，且不再只有裸文本百分比', () => {
      const bar = card.match(/data-testid=\{`progress-fill-\$\{video\.id\}`\}[^\n]*/)![0]
      expect(bar, '不得用类型色').not.toMatch(/var\(--color-(concept|example|analogy)\)/)
      expect(bar, '不得用强调色').not.toMatch(/var\(--color-accent\)/)
      expect(card, '旧的无底色裸文本百分比不得单独作为进度呈现').not.toMatch(/<div>\{display\.progressPercent\}%<\/div>/)
    })
  })

  describe('VCGAP-06 / VC-10①③④：信息顺序、角标、已看完信息条、非就绪卡', () => {
    it('就绪卡信息顺序：缩略图 → 标题 → 进度条+时长 → 最近学习小字', () => {
      const iThumb = card.indexOf('data-testid={`thumb-${video.id}`}')
      const iTitle = card.indexOf('data-testid={`title-${video.id}`}')
      const iBar = card.indexOf('data-testid={`progress-fill-${video.id}`}')
      const iLast = card.indexOf('data-testid={`last-studied-${video.id}`}')
      for (const [name, i] of [['缩略图', iThumb], ['标题', iTitle], ['进度条', iBar], ['最近学习', iLast]] as const) {
        expect(i, `${name}必须渲染`).toBeGreaterThan(-1)
      }
      expect(iThumb < iTitle && iTitle < iBar && iBar < iLast, '顺序必须是 缩略图 → 标题 → 进度条 → 最近学习').toBe(true)
      expect(card, '时长必须与进度条同排（右侧）').toMatch(/progress-fill-\$\{video\.id\}[\s\S]{0,400}?display\.durationText/)
    })

    it('已看完 = 进度条满 + 「已看完·时间」文字（取代决策 72 的淡✓）', () => {
      expect(card).toMatch(/display\.isComplete\s*\?\s*'100%'/)
      expect(card, '信息条必须出现「已看完」文字').toMatch(/已看完/)
      expect(card, '决策 72 的淡✓必须被取代').not.toMatch(/isComplete && <span>✓<\/span>/)
    })

    it('语言·来源角标位于缩略图容器内且贴右下（VC-11⑤）', () => {
      const thumb = card.slice(card.indexOf('data-testid={`thumb-${video.id}`}'), card.indexOf('data-testid={`title-${video.id}`}'))
      expect(thumb, '角标必须在缩略图容器内').toMatch(/data-testid=\{`thumb-meta-\$\{video\.id\}`\}/)
      const meta = card.match(/data-testid=\{`thumb-meta-\$\{video\.id\}`\}[^\n]*/)![0]
      expect(meta).toMatch(/position:\s*'absolute'/)
      expect(meta).toMatch(/right:/)
      expect(meta).toMatch(/bottom:/)
      const metaBlock = card.slice(card.indexOf('data-testid={`thumb-meta-${video.id}`}')).slice(0, 300)
      expect(metaBlock, '角标内容取模型的 badges（语言·来源），不得自造').toMatch(/display\.badges/)
    })

    it('非就绪卡 = 缩略图蒙层 + 左上状态徽章（VC-10④）', () => {
      expect(card, '必须有蒙层元素').toMatch(/data-testid=\{`thumb-overlay-\$\{video\.id\}`\}/)
      const overlay = card.match(/data-testid=\{`thumb-overlay-\$\{video\.id\}`\}[^\n]*/)![0]
      expect(overlay).toMatch(/position:\s*'absolute'/)
      expect(overlay).toMatch(/inset:\s*0/)
      const thumbSlice = card.slice(card.indexOf('data-testid={`thumb-${video.id}`}'), card.indexOf('data-testid={`title-${video.id}`}'))
      const iBadge = card.indexOf('data-testid={`badge-${video.id}`}')
      const badgeWindow = card.slice(Math.max(0, iBadge - 200), iBadge + 300)
      expect(badgeWindow, '徽章必须只在非就绪卡渲染（display.statusBadge &&）').toMatch(/display\.statusBadge &&/)
      expect(badgeWindow, '徽章必须绝对定位').toMatch(/position:\s*'absolute'/)
      expect(badgeWindow, '徽章必须在左上').toMatch(/top:/)
      expect(badgeWindow).toMatch(/left:/)
      expect(thumbSlice, '徽章必须落在缩略图容器内（容器外的同样标记不算）').toMatch(/badge-\$\{video\.id\}/)
      const iOverlay = card.indexOf('data-testid={`thumb-overlay-${video.id}`}')
      expect(card.slice(Math.max(0, iOverlay - 160), iOverlay), '蒙层必须只在非就绪卡渲染').toMatch(/display\.statusBadge &&/)
    })
  })

  describe('守卫：既有 E2E 钩子与已合规项不得回退', () => {
    it('守卫：卡片/徽章钩子与 data-status 保留（Video List 桌面 E2E 依赖）', () => {
      expect(card).toMatch(/data-testid=\{`card-\$\{video\.id\}`\}/)
      expect(card).toMatch(/data-testid=\{`badge-\$\{video\.id\}`\}/)
      expect(card).toMatch(/data-status=\{display\.statusBadge\.type\}/)
    })

    it('守卫：状态徽章填充仍是 I 级状态色（S5 成果不回退）', () => {
      expect(card).toMatch(/STATUS_BADGE_FILL/)
      expect(card).toMatch(/'#a82e26'/)
      expect(card).toMatch(/'#7a5a00'/)
      expect(card).toMatch(/'#5b6470'/)
    })

    it('守卫：网格 minmax(240px,1fr) 不变（VC-11①② 已合规、不计入本缺口）', () => {
      const page = read('src/pages/VideoListPage.tsx')
      expect(page).toMatch(/repeat\(auto-fill,\s*minmax\(240px,\s*1fr\)\)/)
    })
  })
})
