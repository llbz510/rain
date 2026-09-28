import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, beforeAll } from 'vitest'

/**
 * AC-SU-05 / AC-UX-04 — 视觉合同 S7「零散清理」
 *
 * 依据 `docs/development/visual-contract.md`：
 * - `VCGAP-07`（`VC-16`）：字幕参数 = 决策 78 —— 底色 `rgba(0,0,0,.6)`、**距底 16px**、内边距 `4px 8px`、圆角取阶梯的 `4px`。
 * - `VCGAP-18`（`VC-13`/`VC-16`）：字幕字号用错令牌 —— 决策 78 定稿 **16px** = `--font-size-md`（阶梯 `--font-size-sm` 是 14px）。
 * - `VCGAP-08`（`VC-15`）：出现**阶梯外的一次性几何** —— 圆角只取 `0/4/8/12/胶囊`（`--radius-0/1/2/3/pill`）。
 * - `VCGAP-16`（`VC-15`）：决策 76「顶栏 40 / **控制栏 40** / 目录横条 80」——实现曾把「目录横条 80」错配给控制栏。
 * - 决策 78 的**行距 1.3** 此前未实现（字幕条继承 `body` 的 `1.7`），本轮落地并锁定；**字重 400 本就已生效**（旧实现未声明字重），本轮**只加守卫、未改实现**（`VC-16`⑤ 把「行高 1.3、字重 400」写成可裁判项）。
 *   **未落地且不得自行发明取值**：决策 78 同句要求「文字阴影增可读」但**未给数值**，故本轮不实现、按残留登记（见合同 §5.3 的 S7 行）。
 *
 * 数值口径：阶梯值（圆角五档、字号、控制栏高度、行高 1.3 档）**从 `src/index.css` 解析后与合同冻结值对照**，
 * 解析不到即失败——令牌被改动或删除时本裁判会红（不是「字面量对字面量」的同义反复）。
 * 标注「守卫」的断言**改动前后都成立**、永远不计入 RED：回退态下其中 2 处实际求值为绿，另 2 处因同一测试的前序断言先失败而未被求值。
 *
 * **锁定范围（据实，不做过度声称）**：`VCGAP-08` 的阶梯扫描只覆盖**被扫描的 3 个设置文件**
 * （`preflight-panel.tsx` / `settings-page.tsx` / `shared.ts`），不是整个 `src/**`；
 * 全仓其余文件的圆角由人工审计确认当前无阶梯外取值，但本裁判不为其背书。
 */

const ROOT = process.cwd()
const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8')

describe('S7 零散清理：字幕参数/字号/行高 + 阶梯外几何 + 控制栏高度', () => {
  let indexCss: string
  let video: string
  let preflight: string
  let settingsPage: string
  let study: string
  let radiusLadder: string[]
  let fontSizeMd: string
  let fontSizeSm: string
  let lineHeight13: string

  beforeAll(() => {
    indexCss = read('src/index.css')
    video = read('src/ui/components/video.tsx')
    preflight = read('src/ui/components/settings/preflight-panel.tsx')
    settingsPage = read('src/ui/components/settings/settings-page.tsx')
    study = read('src/pages/StudyInterface.tsx')
    radiusLadder = ['0', '1', '2', '3', 'pill'].map((step) => {
      const match = indexCss.match(new RegExp(`--radius-${step}:\\s*(\\d+)px`))
      if (!match) throw new Error(`index.css 缺少 --radius-${step}`)
      return match[1]
    })
    fontSizeMd = indexCss.match(/--font-size-md:\s*(\d+)px/)![1]
    fontSizeSm = indexCss.match(/--font-size-sm:\s*(\d+)px/)![1]
    lineHeight13 = indexCss.match(/--line-height-heading:\s*([\d.]+)/)![1]
  })

  describe('VCGAP-07 / VCGAP-18：字幕参数、字号与行高', () => {
    it('字幕条取决策 78 的参数（距底 16 / 底 .6 / 内边距 4px 8px / 圆角 4px）', () => {
      const overlay = video.match(/data-testid="subtitle-overlay"[^\n]*/)
      expect(overlay, '字幕条必须存在').not.toBeNull()
      const line = overlay![0]
      expect(line).toMatch(/bottom:\s*'16px'/)
      expect(line).toMatch(/background:\s*'rgba\(0,0,0,0?\.6\)'/)
      expect(line).toMatch(/padding:\s*'4px 8px'/)
      expect(line).toMatch(/borderRadius:\s*'4px'/)
    })

    it('字幕字号取 `--font-size-md`（=16px），不再是 14px 的那档', () => {
      const overlay = video.match(/data-testid="subtitle-overlay"[^\n]*/)![0]
      expect(overlay).toMatch(/fontSize:\s*'var\(--font-size-md\)'/)
      expect(Number(fontSizeMd), '阶梯里 --font-size-md 必须是 16px').toBe(16)
      expect(Number(fontSizeSm), '守卫：阶梯里 --font-size-sm 仍是 14px——正是被替换掉的那档').toBe(14)
    })

    it('字幕行高取阶梯 1.3 档（决策 78 原文「行距 1.3」；VC-16⑤「行高 1.3」）', () => {
      const overlay = video.match(/data-testid="subtitle-overlay"[^\n]*/)![0]
      expect(overlay, '字幕条必须声明行高，否则继承 body 的 1.7（决策 78 要求 1.3）').toMatch(/lineHeight:\s*'var\(--line-height-heading\)'/)
      expect(lineHeight13, '阶梯里 1.3 档必须是 1.3').toBe('1.3')
    })

    it('字重保持 400：字幕条不得声明非 400 字重（决策 78「不靠加粗」；本轮只加守卫、未改实现）', () => {
      const overlay = video.match(/data-testid="subtitle-overlay"[^\n]*/)![0]
      const declared = overlay.match(/fontWeight:\s*['"]?([A-Za-z0-9]+)/)
      expect(declared ? Number(declared[1]) : 400, '字幕条要么不声明字重（继承 400），要么必须显式 400').toBe(400)
    })

    it('反例锚点：旧的 40px 距底 / .7 底 / 4px 12px 内边距 / 14px 字号在字幕条上必须消失', () => {
      const overlay = video.match(/data-testid="subtitle-overlay"[^\n]*/)![0]
      expect(overlay, '不得再是距底 40px').not.toMatch(/bottom:\s*'40px'/)
      expect(overlay, '不得再是 .7 底').not.toMatch(/rgba\(0,0,0,0?\.7\)/)
      expect(overlay, '不得再是 4px 12px').not.toMatch(/padding:\s*'4px 12px'/)
      expect(overlay, '不得再用 14px 那档令牌').not.toMatch(/var\(--font-size-sm\)/)
    })
  })

  describe('VCGAP-08：圆角只能取阶梯值（不再有阶梯外的一次性几何）', () => {
    it('曾被登记的 `borderRadius: 6` 站点改为阶梯内的 8px（preflight-panel 两处、settings-page 一处）', () => {
      expect(preflight, 'preflight-panel 不得再有 borderRadius: 6').not.toMatch(/borderRadius:\s*6\b/)
      expect(settingsPage, 'settings-page 不得再有 borderRadius: 6').not.toMatch(/borderRadius:\s*6\b/)
      expect(preflight.match(/borderRadius:\s*8\b/g)?.length ?? 0, 'preflight-panel 应有两处取 8').toBeGreaterThanOrEqual(2)
      expect(settingsPage, '守卫：settings-page 至少有一处取 8').toMatch(/borderRadius:\s*8\b/)
    })

    it('阶梯扫描（被扫描的 3 个设置文件）：数字型 borderRadius 必须命中 index.css 的阶梯值', () => {
      const files = ['src/ui/components/settings/preflight-panel.tsx', 'src/ui/components/settings/settings-page.tsx', 'src/ui/components/settings/shared.ts']
      const ladder = new Set(radiusLadder)
      const offenders: string[] = []
      for (const file of files) {
        for (const match of read(file).matchAll(/borderRadius:\s*(\d+)\b/g)) {
          if (!ladder.has(match[1])) offenders.push(`${file}: ${match[1]}px`)
        }
      }
      expect(offenders, `阶梯外的圆角：${offenders.join(', ')}`).toEqual([])
    })

    it('反例锚点：6 不在阶梯内（防止有人把 6 当成合法档位）', () => {
      expect(radiusLadder).not.toContain('6')
      expect(radiusLadder, '守卫：阶梯形状不变').toEqual(['0', '4', '8', '12', '9999'])
    })
  })

  describe('VCGAP-16：控制栏高度 = 40px（决策 76「顶栏 40 / 控制栏 40 / 目录横条 80」）', () => {
    it('`--height-controlbar` 取 40px，与顶栏同档', () => {
      const controlbar = indexCss.match(/--height-controlbar:\s*(\d+)px/)
      const topbar = indexCss.match(/--height-topbar:\s*(\d+)px/)
      expect(controlbar, '--height-controlbar 必须存在').not.toBeNull()
      expect(Number(controlbar![1]), '控制栏必须是 40px').toBe(40)
      expect(Number(topbar![1]), '守卫：顶栏是 40px（未变）').toBe(40)
    })

    it('控制栏仍消费该令牌（高度改动自动生效，无硬编码残留）', () => {
      expect(study).toMatch(/var\(--height-controlbar\)/)
      expect(indexCss, '不得再有 80px 的控制栏取值').not.toMatch(/--height-controlbar:\s*80px/)
    })

    it('反例锚点：旧的 80px 不属于控制栏（那是目录横条的高度）', () => {
      const controlbar = indexCss.match(/--height-controlbar:\s*(\d+)px/)![1]
      expect(controlbar).not.toBe('80')
    })
  })
})
