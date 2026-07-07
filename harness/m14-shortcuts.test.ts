// harness/m14-shortcuts.test.ts
// ========================================
// M14 Harness: 快捷键
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import {
  SHORTCUT_MAP,
  isShortcutActive,
  type ShortcutContext,
} from '@/ui/shortcuts'

describe('M14-T01: 1/2/3 切换三模式（决策53）', () => {
  it('1=follow, 2=textExpand, 3=mapExpand', () => {
    expect(SHORTCUT_MAP['1']).toBe('mode:follow')
    expect(SHORTCUT_MAP['2']).toBe('mode:textExpand')
    expect(SHORTCUT_MAP['3']).toBe('mode:mapExpand')
  })
})

describe('M14-T02: ` 键摘注当前播放段（决策53）', () => {
  it('` 映射到 excerpt 操作', () => {
    expect(SHORTCUT_MAP['`']).toBe('excerpt')
  })
})

describe('M14-T03: Space 播停（决策53）', () => {
  it('Space 映射到 playPause', () => {
    expect(SHORTCUT_MAP['Space']).toBe('playPause')
  })
})

describe('M14-T04: 方向键时间控制（决策53）', () => {
  it('←/→ ±5s，Shift+←/→ ±10s', () => {
    expect(SHORTCUT_MAP['ArrowLeft']).toBe('seek:-5')
    expect(SHORTCUT_MAP['ArrowRight']).toBe('seek:+5')
    expect(SHORTCUT_MAP['Shift+ArrowLeft']).toBe('seek:-10')
    expect(SHORTCUT_MAP['Shift+ArrowRight']).toBe('seek:+10')
  })
})

describe('M14-T05: N/P 跳段（决策53）', () => {
  it('N=下一段，P=上一段', () => {
    expect(SHORTCUT_MAP['n']).toBe('nextParagraph')
    expect(SHORTCUT_MAP['p']).toBe('prevParagraph')
  })
})

describe('M14-T06: Del 仅 tree 选中生效（决策53）', () => {
  it('selectionOrigin=tree 时 Del 激活', () => {
    const ctx: ShortcutContext = {
      isInputFocused: false,
      selectionOrigin: 'tree',
      selectedNodeId: 'n1',
    }
    expect(isShortcutActive('Delete', ctx)).toBe(true)
  })

  it('selectionOrigin=diagram 时 Del 不激活', () => {
    const ctx: ShortcutContext = {
      isInputFocused: false,
      selectionOrigin: 'diagram',
      selectedNodeId: 'n1',
    }
    expect(isShortcutActive('Delete', ctx)).toBe(false)
  })
})

describe('M14-T07: 输入态全局快捷键禁用（决策53）', () => {
  it('isInputFocused=true 时所有全局快捷键不激活', () => {
    const ctx: ShortcutContext = {
      isInputFocused: true,
      selectionOrigin: 'tree',
      selectedNodeId: 'n1',
    }
    expect(isShortcutActive('1', ctx)).toBe(false)
    expect(isShortcutActive('Space', ctx)).toBe(false)
    expect(isShortcutActive('n', ctx)).toBe(false)
    expect(isShortcutActive('Delete', ctx)).toBe(false)
  })
})

describe('M14-T08: Tab 切面板（决策53）', () => {
  it('Tab 映射到 togglePanel', () => {
    expect(SHORTCUT_MAP['Tab']).toBe('togglePanel')
  })
})
