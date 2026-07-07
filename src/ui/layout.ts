// src/ui/layout.ts
// ========================================
// 界面布局（三模式状态机，决策19）
// ========================================

export const LAYOUT_MODES = ['follow', 'textExpand', 'mapExpand'] as const
export type LayoutMode = typeof LAYOUT_MODES[number]

export interface ZoneVisibility {
  videoZone: boolean
  textZone: boolean
  catalogBar: boolean
  diagramZone: boolean
  textPreview: boolean
  controlBar: boolean
  sideTree: boolean
  rightPanel: boolean
}

export function getVisibility(mode: LayoutMode): ZoneVisibility {
  const base: ZoneVisibility = {
    videoZone: true,
    textZone: true,
    catalogBar: true,
    diagramZone: false,
    textPreview: false,
    controlBar: false,
    sideTree: true,
    rightPanel: true,
  }

  switch (mode) {
    case 'follow':
      return base
    case 'textExpand':
      return {
        ...base,
        videoZone: false,
        controlBar: true,
      }
    case 'mapExpand':
      return {
        ...base,
        videoZone: false,
        controlBar: true,
        catalogBar: false,
        diagramZone: true,
        textPreview: true,
      }
  }
}

export function switchMode(current: LayoutMode, target: LayoutMode): LayoutMode {
  // 展开模式再点自己 = 收回随播
  if (current === target) {
    return 'follow'
  }
  // 切换到目标模式
  return target
}
