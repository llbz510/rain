import { describe, expect, it } from 'vitest'
import { buildCardDisplay, formatLastStudied } from '../ui/video-list'
import type { Video } from '../models/types'

/**
 * 用户决策（2026-09-29 批准）：「最近学习」超过一年不再显示「N 天前」，改显示具体日期。
 *
 * 事故背景：卡片渲染的 `${天数} 天前` 在 2026-09-29 是「20725 天前」，
 * 而锁定 Harness 的 U52 用例当时用 `getByText(/25/)` 这类"文本含 25 即命中"的宽松匹配，
 * 于是两个元素同时命中，用例按日期发作变红。本条与 U52 的精确化是同一事故的两侧修复：
 * 断言侧改成整句精确匹配，产品侧让"天数"不再无上界地膨胀。
 *
 * 断言口径：日期取**本地时区**分量（与 `Date` 的本地 getter 一致），格式 `YYYY-MM-DD`。
 * 这里用同一套本地 getter 反算期望值，而不是把某个具体日期字符串焊死——焊死会让用例
 * 随运行机器的时区而红，那是把定时炸弹换成时区炸弹。
 */

const DAY_MS = 1000 * 60 * 60 * 24

function videoWithLastStudied(lastStudiedAt: number): Video {
  return {
    id: 'v1',
    title: '测试视频',
    source: 'local',
    filePath: '/v.mp4',
    thumbnail: '/t.jpg',
    duration: 600,
    language: 'zh',
    status: 'ready',
    createdAt: 1000,
    position: 300,
    lastStudiedAt,
  } as Video
}

function localDateString(timestamp: number): string {
  const d = new Date(timestamp)
  const yyyy = String(d.getFullYear()).padStart(4, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

describe('「最近学习」显示规则（用户 2026-09-29 批准）', () => {
  it('0 仍是「未学习」', () => {
    expect(formatLastStudied(0)).toBe('未学习')
  })

  it('刚刚（不足 1 分钟）仍是「刚刚」', () => {
    const now = Date.now()
    expect(formatLastStudied(now - 5_000)).toBe('刚刚')
  })

  it('分钟档与小时档行为不变', () => {
    // 只取一次 now 再传进去：断言内二次取 now 会让 1ms 的时间差就能翻档
    // （本仓实测 now-5min+1ms -> 「4 分钟前」）。
    const now = Date.now()
    expect(formatLastStudied(now - 5 * 60 * 1000)).toBe('5 分钟前')
    expect(formatLastStudied(now - 5 * 60 * 60 * 1000)).toBe('5 小时前')
  })

  it('天数档行为不变（365 天以内仍显示 N 天前）', () => {
    // 取「半天偏移」，让用例落在明确的一侧：判据与显示都用**已满天数**（向下取整），
    // 所以 100.5 天 -> 「100 天前」、365.5 天 -> 「365 天前」（仍未满 366 天，故不换日期）。
    const now = Date.now()
    expect(formatLastStudied(now - 100 * DAY_MS - DAY_MS / 2)).toBe('100 天前')
    expect(formatLastStudied(now - 365 * DAY_MS - DAY_MS / 2)).toBe('365 天前')
  })

  it('超过 365 天不再显示「N 天前」，改显示本地日期 YYYY-MM-DD', () => {
    const old = Date.now() - 400 * DAY_MS
    const text = formatLastStudied(old)
    expect(text, '超过一年不得再出现「天前」').not.toContain('天前')
    expect(text).toBe(localDateString(old))
    expect(text, '格式必须是 YYYY-MM-DD').toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('夹具那种 1970 年的时间戳（2000ms）显示为具体日期，而不是两万天前', () => {
    const text = formatLastStudied(2000)
    expect(text).not.toContain('天前')
    // 用同一套本地 getter 反算，不焊死 '1970-01-01'：UTC 偏移为负的机器上 2000ms 是 1969-12-31，
    // 焊死会把「日期炸弹」换成「时区炸弹」。
    expect(text).toBe(localDateString(2000))
  })

  it('反例锚点：把规则改回「N 天前」这条必须失败', () => {
    // 这条锚点的作用是"回退必红"：只要有人把超过一年的分支去掉，
    // formatLastStudied(2000) 就会重新变成「20725 天前」这种无上界天数，本断言随即失败。
    const text = formatLastStudied(2000)
    expect(text, '超过一年必须显示日期；若这里重新出现「天前」，说明规则被回退').not.toMatch(/^\d+ 天前$/)
  })

  it('卡片显示层同样遵守该规则（走公开的 buildCardDisplay）', () => {
    const display = buildCardDisplay(videoWithLastStudied(2000))
    expect(display.lastStudiedText).toBe(localDateString(2000))

    const now = Date.now()
    const recent = buildCardDisplay(videoWithLastStudied(now - 3 * DAY_MS - DAY_MS / 2))
    expect(recent.lastStudiedText).toBe('3 天前')
  })
})
