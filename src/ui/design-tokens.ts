// src/ui/design-tokens.ts
// ========================================
// 视觉设计令牌（决策63-81）
// ========================================

// 段落四色（决策66）：概念=蓝、例子=绿、类比=橙、过渡=灰
export const PARAGRAPH_COLORS: Record<string, string> = {
  concept: '#3b82f6',    // 蓝
  example: '#10b981',    // 绿
  analogy: '#f59e0b',    // 橙
  transition: '#6b7280', // 灰
}

// 间距基准阶梯（决策76）：8 档
export const SPACING_SCALE = [4, 8, 12, 16, 20, 24, 32, 48] as const

// 字号 5 档（决策74）：18/16/14/13/12
export const FONT_SIZES = [18, 16, 14, 13, 12] as const

// 圆角 5 档（决策76）：0/4/8/12/胶囊
export const BORDER_RADIUS_SCALE = [0, 4, 8, 12, 9999] as const

// 动效时长三档（决策81）：120/200/320 ms
export const ANIMATION_DURATIONS = [120, 200, 320] as const
