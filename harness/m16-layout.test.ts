// harness/m16-layout.test.ts
// ========================================
// M16 Harness: 界面布局（三模式状态机）
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import {
  LAYOUT_MODES,
  getVisibility,
  switchMode,
  type LayoutMode,
} from '@/ui/layout'

describe('M16-T01: 三模式枚举（决策19）', () => {
  it('恰好 3 种模式', () => {
    expect(LAYOUT_MODES).toEqual(['follow', 'textExpand', 'mapExpand'])
    expect(LAYOUT_MODES).toHaveLength(3)
  })
})

describe('M16-T02: 同一时间只开一个展开模式（决策21）', () => {
  it('从文本展开切到目录展开，文本展开自动收起', () => {
    let mode: LayoutMode = 'textExpand'
    mode = switchMode(mode, 'mapExpand')
    expect(mode).toBe('mapExpand')
  })

  it('展开模式再点自己 = 收回随播', () => {
    let mode: LayoutMode = 'textExpand'
    mode = switchMode(mode, 'textExpand')
    expect(mode).toBe('follow')
  })
})

describe('M16-T03: 随播模式可见性（决策19）', () => {
  it('视频区可见、文本区可见、横条可见、导图不可见', () => {
    const vis = getVisibility('follow')
    expect(vis.videoZone).toBe(true)
    expect(vis.textZone).toBe(true)
    expect(vis.catalogBar).toBe(true)
    expect(vis.diagramZone).toBe(false)
    expect(vis.textPreview).toBe(false)
  })
})

describe('M16-T04: 文本展开模式可见性（决策19）', () => {
  it('视频收为控制栏、文本展开、横条在、导图不可见', () => {
    const vis = getVisibility('textExpand')
    expect(vis.videoZone).toBe(false)
    expect(vis.controlBar).toBe(true)
    expect(vis.textZone).toBe(true)
    expect(vis.catalogBar).toBe(true)
    expect(vis.diagramZone).toBe(false)
  })
})

describe('M16-T05: 目录展开模式可见性（决策19）', () => {
  it('视频收为控制栏、导图可见、横条消失、文本预览可见', () => {
    const vis = getVisibility('mapExpand')
    expect(vis.videoZone).toBe(false)
    expect(vis.controlBar).toBe(true)
    expect(vis.diagramZone).toBe(true)
    expect(vis.catalogBar).toBe(false)
    expect(vis.textPreview).toBe(true)
  })
})

describe('M16-T06: 左侧目录树三模式都在（决策20）', () => {
  it('所有模式下 sideTree 都可见', () => {
    for (const mode of LAYOUT_MODES) {
      const vis = getVisibility(mode as LayoutMode)
      expect(vis.sideTree).toBe(true)
    }
  })
})

describe('M16-T07: 右侧面板三模式都在（决策22）', () => {
  it('所有模式下 rightPanel 都可见', () => {
    for (const mode of LAYOUT_MODES) {
      const vis = getVisibility(mode as LayoutMode)
      expect(vis.rightPanel).toBe(true)
    }
  })
})
