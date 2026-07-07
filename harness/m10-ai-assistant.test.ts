// harness/m10-ai-assistant.test.ts
// ========================================
// M10 Harness: AI 助手
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import {
  getQuickActionsForType,
  getUniversalActions,
  buildAiContext,
  type AiChatSession,
} from '@/ai/assistant'

describe('M10-T01: 按段落类型返回差异化快捷操作（决策10）', () => {
  it('不同类型返回不同操作列表', () => {
    const conceptActions = getQuickActionsForType('concept')
    const exampleActions = getQuickActionsForType('example')
    expect(conceptActions).not.toEqual(exampleActions)
  })
})

describe('M10-T02: concept 段落快捷操作（决策10）', () => {
  it('包含全部 7 种操作', () => {
    const actions = getQuickActionsForType('concept')
    const actionIds = actions.map(a => a.id)
    expect(actionIds).toContain('simplify')
    expect(actionIds).toContain('elaborate')
    expect(actionIds).toContain('generate_example')
    expect(actionIds).toContain('generate_analogy')
    expect(actionIds).toContain('analyze_io')
    expect(actionIds).toContain('concept_quiz')
    expect(actionIds).toContain('related_quiz')
    expect(actions).toHaveLength(7)
  })
})

describe('M10-T03: example 段落快捷操作（决策10）', () => {
  it('包含 3 种操作', () => {
    const actions = getQuickActionsForType('example')
    const actionIds = actions.map(a => a.id)
    expect(actionIds).toContain('extract_concept')
    expect(actionIds).toContain('another_example')
    expect(actionIds).toContain('variant_exercise')
    expect(actions).toHaveLength(3)
  })
})

describe('M10-T04: analogy 段落快捷操作（决策10）', () => {
  it('包含 3 种操作', () => {
    const actions = getQuickActionsForType('analogy')
    const actionIds = actions.map(a => a.id)
    expect(actionIds).toContain('explain_mapping')
    expect(actionIds).toContain('another_analogy')
    expect(actionIds).toContain('analogy_limitation')
    expect(actions).toHaveLength(3)
  })
})

describe('M10-T05: transition 段落无快捷操作（决策10）', () => {
  it('返回空数组', () => {
    const actions = getQuickActionsForType('transition')
    expect(actions).toEqual([])
  })
})

describe('M10-T06: 通用操作（决策10）', () => {
  it('包含解释画面和总结本节', () => {
    const actions = getUniversalActions()
    const actionIds = actions.map(a => a.id)
    expect(actionIds).toContain('explain_frame')
    expect(actionIds).toContain('summarize_section')
  })
})

describe('M10-T07: AI 上下文取原文，不含 translation（决策87）', () => {
  it('英文视频的 AI 上下文只含 sentences 原文', () => {
    const context = buildAiContext({
      sentences: [
        { id: 's1', text: 'Hello world.', startTime: 0, endTime: 5, sortOrder: 0, nodeId: 'p1' },
      ],
      translation: '你好世界。',
      language: 'en',
    })
    expect(context).toContain('Hello world.')
    expect(context).not.toContain('你好世界。')
  })
})

describe('M10-T08: 流式对话可取消（决策83/92）', () => {
  it('AiChatSession 提供 abort 方法', () => {
    // 验证类型接口存在
    const mockSession: AiChatSession = {
      abort: () => {},
      isStreaming: false,
    }
    expect(typeof mockSession.abort).toBe('function')
  })
})
