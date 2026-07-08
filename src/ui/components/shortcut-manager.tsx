// src/ui/components/shortcut-manager.tsx
// ========================================
// M14 快捷键集成组件（决策53）
// ========================================

import React, { useEffect } from 'react'
import { useRainStore } from '@/store/rain-store'
import { isShortcutActive } from '@/ui/shortcuts'

interface ShortcutManagerProps {
  onExcerpt?: () => void
  onDelete?: () => void
}

export function ShortcutManager({ onExcerpt, onDelete }: ShortcutManagerProps) {
  const layoutMode = useRainStore((s) => s.layoutMode)
  const switchLayoutMode = useRainStore((s) => s.switchLayoutMode)
  const isInputFocused = useRainStore((s) => s.isInputFocused)
  const selectionOrigin = useRainStore((s) => s.selectionOrigin)
  const selectedNodeId = useRainStore((s) => s.selectedNodeId)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const ctx = {
        isInputFocused,
        selectionOrigin,
        selectedNodeId,
      }

      let key = e.key
      if (e.shiftKey && key !== 'Shift') {
        key = `Shift+${key}`
      }

      if (!isShortcutActive(key, ctx)) return

      switch (key) {
        case '1':
          switchLayoutMode('follow')
          break
        case '2':
          switchLayoutMode('textExpand')
          break
        case '3':
          switchLayoutMode('mapExpand')
          break
        case '`':
          onExcerpt?.()
          break
        case 'Delete':
        case 'Backspace':
          onDelete?.()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isInputFocused, selectionOrigin, selectedNodeId, switchLayoutMode, onExcerpt, onDelete])

  return <div data-testid="shortcut-manager" />
}
