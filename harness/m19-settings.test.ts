// harness/m19-settings.test.ts
// ========================================
// M19 Harness: 设置与模型管理
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import {
  addModelToPool,
  removeModelFromPool,
  listModels,
  getModelsForRole,
  type ModelPoolEntry,
} from '@/settings/model-pool'
import { getChunkThreshold, setChunkThreshold } from '@/settings/advanced'

describe('M19-T01: 模型池添加 API 类模型（决策82）', () => {
  it('添加成功并返回完整条目', () => {
    const entry = addModelToPool({
      type: 'llm',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      modelName: 'gpt-4o',
      alias: 'GPT-4o 主力',
      supportsVision: true,
    })
    expect(entry.id).toBeDefined()
    expect(entry.alias).toBe('GPT-4o 主力')
    expect(entry.type).toBe('llm')
    expect(entry.supportsVision).toBe(true)
  })
})

describe('M19-T02: 模型池删除模型', () => {
  it('删除后列表中不存在', () => {
    const entry = addModelToPool({
      type: 'llm', provider: 'openai', apiKey: 'sk-test',
      modelName: 'gpt-4', alias: '待删除', supportsVision: false,
    })
    removeModelFromPool(entry.id)
    const models = listModels()
    expect(models.find(m => m.id === entry.id)).toBeUndefined()
  })
})

describe('M19-T03: 模型池列出所有模型', () => {
  it('返回所有已添加的模型', () => {
    // 清空状态后添加两个模型
    addModelToPool({
      type: 'llm', provider: 'openai', apiKey: 'sk-1',
      modelName: 'gpt-4o', alias: '模型A', supportsVision: true,
    })
    addModelToPool({
      type: 'asr-api', provider: 'xunfei', apiKey: 'key-2',
      modelName: 'iat', alias: '讯飞ASR', supportsVision: false,
    })
    const models = listModels()
    expect(models.length).toBeGreaterThanOrEqual(2)
  })
})

describe('M19-T04: ASR 角色只列 ASR 类型模型（决策82）', () => {
  it('getModelsForRole("asr") 不返回 LLM 模型', () => {
    addModelToPool({
      type: 'llm', provider: 'openai', apiKey: 'sk-1',
      modelName: 'gpt-4o', alias: 'LLM', supportsVision: true,
    })
    addModelToPool({
      type: 'asr-api', provider: 'xunfei', apiKey: 'key-2',
      modelName: 'iat', alias: '讯飞', supportsVision: false,
    })
    addModelToPool({
      type: 'whisper-local', provider: 'local',
      modelName: 'base', alias: 'Whisper Base', supportsVision: false,
    })

    const asrModels = getModelsForRole('asr')
    for (const m of asrModels) {
      expect(['asr-api', 'whisper-local', 'subtitle']).toContain(m.type)
    }
  })
})

describe('M19-T05: 结构化 LLM 角色只列 LLM 模型（决策82）', () => {
  it('getModelsForRole("structuring") 只返回 LLM 类型', () => {
    const models = getModelsForRole('structuring')
    for (const m of models) {
      expect(m.type).toBe('llm')
    }
  })
})

describe('M19-T06 / AC-LV-12: 文本助手和 vision 是独立能力', () => {
  it('getModelsForRole("assistant") 返回所有 LLM，不把 vision 当成文本问答前提', () => {
    addModelToPool({
      type: 'llm', provider: 'openai', apiKey: 'sk-1',
      modelName: 'gpt-4o', alias: '有Vision', supportsVision: true,
    })
    addModelToPool({
      type: 'llm', provider: 'openai', apiKey: 'sk-2',
      modelName: 'gpt-3.5', alias: '无Vision', supportsVision: false,
    })

    const assistantModels = getModelsForRole('assistant')
    expect(assistantModels).toEqual(expect.arrayContaining([
      expect.objectContaining({ alias: '有Vision', type: 'llm', supportsVision: true }),
      expect.objectContaining({ alias: '无Vision', type: 'llm', supportsVision: false }),
    ]))
    expect(assistantModels.every((model) => model.type === 'llm')).toBe(true)
  })
})

describe('M19-T07: 自定义供应商需要 baseUrl（决策82）', () => {
  it('自定义供应商无 baseUrl 抛出错误', () => {
    expect(() => addModelToPool({
      type: 'llm', provider: 'custom', apiKey: 'sk-1',
      modelName: 'model', alias: '自定义', supportsVision: false,
      // 缺少 baseUrl
    })).toThrow()
  })

  it('自定义供应商有 baseUrl 成功', () => {
    const entry = addModelToPool({
      type: 'llm', provider: 'custom',
      baseUrl: 'https://my-api.com/v1',
      apiKey: 'sk-1', modelName: 'model', alias: '自定义OK',
      supportsVision: false,
    })
    expect(entry.baseUrl).toBe('https://my-api.com/v1')
  })
})

describe('M19-T08: 本地 Whisper 模型大小可切换（决策82）', () => {
  it('支持 5 种大小', () => {
    const validSizes = ['tiny', 'base', 'small', 'medium', 'large-v3']
    for (const size of validSizes) {
      const entry = addModelToPool({
        type: 'whisper-local', provider: 'local',
        modelName: size, alias: `Whisper ${size}`, supportsVision: false,
      })
      expect(entry.modelName).toBe(size)
    }
  })
})

describe('M19-T09: 分块阈值可调整（M18，默认33%）', () => {
  it('默认值为 0.33', () => {
    expect(getChunkThreshold()).toBe(0.33)
  })

  it('可以修改阈值', () => {
    setChunkThreshold(0.25)
    expect(getChunkThreshold()).toBe(0.25)
    // 恢复
    setChunkThreshold(0.33)
  })
})
