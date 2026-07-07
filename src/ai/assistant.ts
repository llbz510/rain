// src/ai/assistant.ts
// ========================================
// AI 助手（决策10）
// ========================================

import type { ParagraphType, Sentence } from '@/models/types'

export interface QuickAction {
  id: string
  label: string
}

export interface AiChatSession {
  abort(): void
  isStreaming: boolean
}

interface AiContextInput {
  sentences: Sentence[]
  translation?: string
  language: string
}

// concept 段落快捷操作（7 种，决策10）
const CONCEPT_ACTIONS: QuickAction[] = [
  { id: 'simplify', label: '变简约' },
  { id: 'elaborate', label: '变详细' },
  { id: 'generate_example', label: '生成例子' },
  { id: 'generate_analogy', label: '生成类比' },
  { id: 'analyze_io', label: '分析输入输出' },
  { id: 'concept_quiz', label: '生成概念习题' },
  { id: 'related_quiz', label: '生成关联习题' },
]

// example 段落快捷操作（3 种，决策10）
const EXAMPLE_ACTIONS: QuickAction[] = [
  { id: 'extract_concept', label: '提取概念' },
  { id: 'another_example', label: '换个例子' },
  { id: 'variant_exercise', label: '变式练习' },
]

// analogy 段落快捷操作（3 种，决策10）
const ANALOGY_ACTIONS: QuickAction[] = [
  { id: 'explain_mapping', label: '解释对应关系' },
  { id: 'another_analogy', label: '换个类比' },
  { id: 'analogy_limitation', label: '指出类比局限' },
]

// 通用操作（2 种，决策10）
const UNIVERSAL_ACTIONS: QuickAction[] = [
  { id: 'explain_frame', label: '解释画面' },
  { id: 'summarize_section', label: '总结本节' },
]

export function getQuickActionsForType(type: ParagraphType): QuickAction[] {
  switch (type) {
    case 'concept':
      return [...CONCEPT_ACTIONS]
    case 'example':
      return [...EXAMPLE_ACTIONS]
    case 'analogy':
      return [...ANALOGY_ACTIONS]
    case 'transition':
      return []
  }
}

export function getUniversalActions(): QuickAction[] {
  return [...UNIVERSAL_ACTIONS]
}

export function buildAiContext(input: AiContextInput): string {
  // AI 上下文取原文，不含 translation（决策87）
  const parts: string[] = []
  for (const sentence of input.sentences) {
    parts.push(sentence.text)
  }
  return parts.join(' ')
}
