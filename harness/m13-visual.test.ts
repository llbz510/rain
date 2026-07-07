// harness/m13-visual.test.ts
// ========================================
// M13 Harness: 视觉设计令牌
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import {
  PARAGRAPH_COLORS,
  SPACING_SCALE,
  FONT_SIZES,
  BORDER_RADIUS_SCALE,
  ANIMATION_DURATIONS,
} from '@/ui/design-tokens'

describe('M13-T01: 段落四色（决策66）', () => {
  it('概念=蓝、例子=绿、类比=橙、过渡=灰', () => {
    expect(PARAGRAPH_COLORS.concept).toBeDefined()
    expect(PARAGRAPH_COLORS.example).toBeDefined()
    expect(PARAGRAPH_COLORS.analogy).toBeDefined()
    expect(PARAGRAPH_COLORS.transition).toBeDefined()
    // 精确色值由实现定义，但必须是 4 种且互不相同
    const colors = Object.values(PARAGRAPH_COLORS)
    expect(new Set(colors).size).toBe(4)
  })
})

describe('M13-T02: 间距基准阶梯（决策76）', () => {
  it('8 档：4/8/12/16/20/24/32/48', () => {
    expect(SPACING_SCALE).toEqual([4, 8, 12, 16, 20, 24, 32, 48])
  })
})

describe('M13-T03: 字号 5 档（决策74）', () => {
  it('18/16/14/13/12', () => {
    expect(FONT_SIZES).toEqual([18, 16, 14, 13, 12])
  })
})

describe('M13-T04: 圆角 5 档（决策76）', () => {
  it('0/4/8/12/9999（胶囊）', () => {
    expect(BORDER_RADIUS_SCALE).toEqual([0, 4, 8, 12, 9999])
  })
})

describe('M13-T05: 动效时长三档（决策81）', () => {
  it('120/200/320 ms', () => {
    expect(ANIMATION_DURATIONS).toEqual([120, 200, 320])
  })
})
