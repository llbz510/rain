// harness/m15-settings-recovery.test.ts
// ========================================
// M15 Harness: API Key 存取 + 中断恢复
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createDatabase,
  setSetting,
  getSetting,
  deleteSetting,
  insertVideo,
  insertSentences,
  insertNodes,
  getVideoById,
  getSentencesByNodeId,
  determineRecoveryAction,
  saveAsrAtomically,
} from '@/models/database'

let db: Awaited<ReturnType<typeof createDatabase>>

beforeEach(async () => {
  db = await createDatabase(':memory:')
})

// ===== 第三组：API Key 存取 =====

describe('M15-T14: 存入 API Key（决策84）', () => {
  it('明文存入 setting 表', async () => {
    await setSetting(db, 'api_key.openai', 'sk-test-123456')
    const value = await getSetting(db, 'api_key.openai')
    expect(value).toBe('sk-test-123456')
  })
})

describe('M15-T15: 读取 API Key', () => {
  it('返回明文', async () => {
    await setSetting(db, 'api_key.deepseek', 'ds-abcdef')
    const value = await getSetting(db, 'api_key.deepseek')
    expect(value).toBe('ds-abcdef')
  })

  it('不存在的 key 返回 null', async () => {
    const value = await getSetting(db, 'api_key.nonexistent')
    expect(value).toBeNull()
  })
})

describe('M15-T16: 更新 API Key', () => {
  it('覆盖旧值', async () => {
    await setSetting(db, 'api_key.openai', 'old-key')
    await setSetting(db, 'api_key.openai', 'new-key')
    const value = await getSetting(db, 'api_key.openai')
    expect(value).toBe('new-key')
  })
})

describe('M15-T17: 删除 API Key', () => {
  it('删除后读不到', async () => {
    await setSetting(db, 'api_key.openai', 'sk-123')
    await deleteSetting(db, 'api_key.openai')
    const value = await getSetting(db, 'api_key.openai')
    expect(value).toBeNull()
  })
})

// ===== 第四组：中断恢复 =====

async function setupVideoForRecovery(status: string, stage: string | null, hasSentences: boolean) {
  await insertVideo(db, {
    id: 'v1', title: '视频', source: 'local', thumbnail: '/t.jpg',
    duration: 600, language: 'zh', status: status as any,
    createdAt: 1000, position: 0, lastStudiedAt: 1000,
    stage: stage as any,
  })
  if (hasSentences) {
    await insertNodes(db, [
      { id: 'ch1', videoId: 'v1', parentId: null, kind: 'chapter', title: '章', type: null, startTime: 0, endTime: 600, text: null, sortOrder: 0 },
      { id: 'sec1', videoId: 'v1', parentId: 'ch1', kind: 'section', title: '节', type: null, startTime: 0, endTime: 600, text: null, sortOrder: 0 },
      { id: 'p1', videoId: 'v1', parentId: 'sec1', kind: 'paragraph', title: '段', type: 'concept', startTime: 0, endTime: 600, text: '文本', sortOrder: 0 },
    ])
    await insertSentences(db, [
      { id: 's1', nodeId: 'p1', text: '句一。', startTime: 0, endTime: 300, sortOrder: 0 },
      { id: 's2', nodeId: 'p1', text: '句二。', startTime: 300, endTime: 600, sortOrder: 1 },
    ])
  }
}

describe('M15-T18: ASR 原子持久化 — 事务（决策84）', () => {
  it('通过生产 ASR interface 一起提交全部句子和下一阶段', async () => {
    await insertVideo(db, {
      id: 'v1', title: '视频', source: 'local', thumbnail: '/t.jpg',
      duration: 100, language: '', status: 'processing', stage: 'asr',
      createdAt: 1000, position: 0, lastStudiedAt: 1000,
    })
    const sentences = [
      { id: 's1', nodeId: '', text: '句一。', startTime: 0, endTime: 50, sortOrder: 0 },
      { id: 's2', nodeId: '', text: '句二。', startTime: 50, endTime: 100, sortOrder: 1 },
    ]

    await saveAsrAtomically('v1', 'zh', sentences, db)

    expect(await getSentencesByNodeId(db, 'v1')).toHaveLength(2)
    expect(await getVideoById(db, 'v1')).toMatchObject({
      language: 'zh', status: 'processing', stage: 'stage2',
    })
  })

  it('生产 ASR interface 的迟失败回滚全部句子并保留原阶段', async () => {
    await insertVideo(db, {
      id: 'v1', title: '视频', source: 'local', thumbnail: '/t.jpg',
      duration: 100, language: '', status: 'processing', stage: 'asr',
      createdAt: 1000, position: 0, lastStudiedAt: 1000,
    })
    const duplicateSentences = [
      { id: 'duplicate', nodeId: '', text: '句一。', startTime: 0, endTime: 50, sortOrder: 0 },
      { id: 'duplicate', nodeId: '', text: '句二。', startTime: 50, endTime: 100, sortOrder: 1 },
    ]

    await expect(saveAsrAtomically('v1', 'zh', duplicateSentences, db)).rejects.toThrow()

    expect(await getSentencesByNodeId(db, 'v1')).toEqual([])
    expect(await getVideoById(db, 'v1')).toMatchObject({
      language: '', status: 'processing', stage: 'asr',
    })
  })
})

describe('M15-T19: 重开检测 — 有 ASR 结果 → skip_asr（决策84）', () => {
  it('视频有完整句子 → 返回 skip_asr', async () => {
    await setupVideoForRecovery('processing', 'stage2', true)
    const action = await determineRecoveryAction(db, 'v1')
    expect(action).toBe('skip_asr')
  })
})

describe('M15-T20: 重开检测 — 无 ASR 结果 → rerun_asr（决策84）', () => {
  it('视频无句子 → 返回 rerun_asr', async () => {
    await setupVideoForRecovery('processing', 'asr', false)
    const action = await determineRecoveryAction(db, 'v1')
    expect(action).toBe('rerun_asr')
  })
})

describe('M15-T21: 重开检测 — 有 ASR，stage=stage2 → rerun_stage2（决策84）', () => {
  it('有句子且 stage=stage2 → 返回 skip_asr（跳过ASR重跑Stage2）', async () => {
    await setupVideoForRecovery('processing', 'stage2', true)
    const action = await determineRecoveryAction(db, 'v1')
    expect(action).toBe('skip_asr')
  })
})

describe('M15-T22: 取消后重试走中断恢复（决策89）', () => {
  it('cancelled 状态视频也走 determineRecoveryAction 同一套逻辑', async () => {
    await setupVideoForRecovery('cancelled', 'asr', false)
    const action = await determineRecoveryAction(db, 'v1')
    expect(action).toBe('rerun_asr')
  })

  it('cancelled 有 ASR 结果 → 跳过 ASR', async () => {
    await setupVideoForRecovery('cancelled', 'stage2', true)
    const action = await determineRecoveryAction(db, 'v1')
    expect(action).toBe('skip_asr')
  })
})
