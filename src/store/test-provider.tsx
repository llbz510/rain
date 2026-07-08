// src/store/test-provider.tsx
// ========================================
// Test Store Provider — 设置 Zustand store 状态用于组件测试
// ========================================

import React, { createContext, useContext, useEffect } from 'react'
import { useRainStore } from './rain-store'
import type { Node, Note } from '@/models/types'

interface TestStoreContextValue {
  language: string
}

const TestStoreContext = createContext<TestStoreContextValue>({ language: 'zh' })

export function useTestStoreContext() {
  return useContext(TestStoreContext)
}

interface TestStoreProviderProps {
  children: React.ReactNode
  nodes?: Node[]
  notes?: Note[]
  selectedNodeId?: string | null
  selectionOrigin?: 'tree' | 'diagram' | null
  isInputFocused?: boolean
  playPosition?: number
  subtitleOn?: boolean
  translationOn?: boolean
  language?: string
  currentVideoId?: string | null
  layoutMode?: 'follow' | 'textExpand' | 'mapExpand'
}

export function TestStoreProvider({
  children,
  nodes,
  notes,
  selectedNodeId,
  selectionOrigin,
  isInputFocused,
  playPosition,
  subtitleOn,
  translationOn,
  language = 'zh',
  currentVideoId,
  layoutMode,
}: TestStoreProviderProps) {
  const partial: Record<string, any> = {}
  if (nodes !== undefined) partial.nodeTree = nodes
  if (notes !== undefined) partial.notes = notes
  if (selectedNodeId !== undefined) partial.selectedNodeId = selectedNodeId
  if (selectionOrigin !== undefined) partial.selectionOrigin = selectionOrigin
  if (isInputFocused !== undefined) partial.isInputFocused = isInputFocused
  if (playPosition !== undefined) partial.playPosition = playPosition
  if (subtitleOn !== undefined) partial.subtitleOn = subtitleOn
  if (translationOn !== undefined) partial.translationOn = translationOn
  if (currentVideoId !== undefined) partial.currentVideoId = currentVideoId
  if (layoutMode !== undefined) partial.layoutMode = layoutMode

  useEffect(() => {
    useRainStore.setState(partial)
  })

  return (
    <TestStoreContext.Provider value={{ language }}>
      {children}
    </TestStoreContext.Provider>
  )
}
