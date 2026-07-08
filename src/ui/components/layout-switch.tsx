// src/ui/components/layout-switch.tsx
// ========================================
// M16 布局切换组件（决策19/21）
// ========================================

import React, { useEffect } from 'react'
import { useRainStore, type LayoutMode } from '@/store/rain-store'

interface LayoutSwitchProps {
  mode: LayoutMode
}

export function LayoutSwitch({ mode }: LayoutSwitchProps) {
  const layoutMode = useRainStore((s) => s.layoutMode)
  const switchLayoutMode = useRainStore((s) => s.switchLayoutMode)

  useEffect(() => {
    useRainStore.setState({ layoutMode: mode })
  }, [mode])

  const isFollow = layoutMode === 'follow'
  const isTextExpand = layoutMode === 'textExpand'
  const isMapExpand = layoutMode === 'mapExpand'

  return (
    <div data-testid="layout-root">
      {isFollow && (
        <>
          <div data-testid="video-zone" />
          <div data-testid="text-zone" />
          <div data-testid="catalog-bar" />
          <div data-testid="side-tree" />
          <div data-testid="right-panel" />
          <button onClick={() => switchLayoutMode('textExpand')}>文本展开</button>
          <button onClick={() => switchLayoutMode('mapExpand')}>导图展开</button>
        </>
      )}
      {isTextExpand && (
        <>
          <div data-testid="control-bar">
            <button onClick={() => switchLayoutMode('textExpand')}>文本收起</button>
          </div>
          <div data-testid="text-zone" />
          <div data-testid="catalog-bar" />
          <div data-testid="side-tree" />
          <div data-testid="right-panel" />
        </>
      )}
      {isMapExpand && (
        <>
          <div data-testid="control-bar" />
          <div data-testid="diagram-zone" />
          <div data-testid="text-preview" />
          <div data-testid="side-tree" />
          <div data-testid="right-panel" />
        </>
      )}
    </div>
  )
}
