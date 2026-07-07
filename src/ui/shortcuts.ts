// src/ui/shortcuts.ts
// ========================================
// 快捷键（决策53）
// ========================================

export const SHORTCUT_MAP: Record<string, string> = {
  '1': 'mode:follow',
  '2': 'mode:textExpand',
  '3': 'mode:mapExpand',
  '`': 'excerpt',
  'Space': 'playPause',
  'ArrowLeft': 'seek:-5',
  'ArrowRight': 'seek:+5',
  'Shift+ArrowLeft': 'seek:-10',
  'Shift+ArrowRight': 'seek:+10',
  'n': 'nextParagraph',
  'p': 'prevParagraph',
  'Tab': 'togglePanel',
}

export interface ShortcutContext {
  isInputFocused: boolean
  selectionOrigin: 'tree' | 'diagram' | null
  selectedNodeId: string | null
}

export function isShortcutActive(key: string, ctx: ShortcutContext): boolean {
  // 输入态：全局快捷键全禁用
  if (ctx.isInputFocused) {
    return false
  }

  // Delete/Del/Backspace 仅在 selectionOrigin=tree 时激活
  if (key === 'Delete' || key === 'Del' || key === 'Backspace') {
    return ctx.selectionOrigin === 'tree'
  }

  // 其他快捷键在非输入态下激活
  return key in SHORTCUT_MAP
}
