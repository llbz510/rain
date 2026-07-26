// harness/m18-long-video.test.ts
// ========================================
// M18 Harness: current Stage2 block and deterministic merge behavior
// Harness migration: 2026-07-26
// ========================================

import { describe, expect, it, vi } from 'vitest'
import {
  createDatabase,
  insertSentences,
  insertVideo,
  type Database,
} from '@/models/database'
import type { Sentence, Video } from '@/models/types'
import {
  buildMergeBlockId,
  buildStage2Blocks,
  runStage2Stage,
} from '@/pipeline/stage2-runner'
import type {
  Stage2BlockOutput,
  Stage2InputBlock,
} from '@/pipeline/stage2-contract'

const video: Video = {
  id: 'video-long',
  title: 'Long lecture',
  source: 'local',
  filePath: 'D:\\courses\\long.mp4',
  thumbnail: '',
  duration: 8,
  language: 'en',
  status: 'processing',
  stage: 'stage2',
  createdAt: 1,
  position: 0,
  lastStudiedAt: 1,
}
const sentences: Sentence[] = [
  { id: 's1', nodeId: video.id, text: 'Original sentence one.', startTime: 0, endTime: 2, sortOrder: 0 },
  { id: 's2', nodeId: video.id, text: 'Original sentence two.', startTime: 2, endTime: 4, sortOrder: 1 },
  { id: 's3', nodeId: video.id, text: 'Original sentence three.', startTime: 4, endTime: 6, sortOrder: 2 },
  { id: 's4', nodeId: video.id, text: 'Original sentence four.', startTime: 6, endTime: 8, sortOrder: 3 },
]
const settings = {
  baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'test-key',
  model: 'qwen3.5-omni-flash',
}

function validOutput(block: Stage2InputBlock): Stage2BlockOutput {
  const first = block.sentences[0].id
  const last = block.sentences.at(-1)!.id
  const chapterId = `${block.blockId}:node:chapter`
  const sectionId = `${block.blockId}:node:section`
  return {
    blockId: block.blockId,
    coveredSentenceIds: block.sentences.map((sentence) => sentence.id),
    nodes: [
      {
        id: chapterId,
        parentId: null,
        kind: 'chapter',
        title: 'Chapter',
        startSentenceId: first,
        endSentenceId: last,
      },
      {
        id: sectionId,
        parentId: chapterId,
        kind: 'section',
        title: 'Section',
        startSentenceId: first,
        endSentenceId: last,
      },
      {
        id: `${block.blockId}:node:paragraph`,
        parentId: sectionId,
        kind: 'paragraph',
        title: 'Paragraph',
        type: 'concept',
        startSentenceId: first,
        endSentenceId: last,
      },
    ],
  }
}

async function stage2Db(): Promise<Database> {
  const db = await createDatabase(':memory:')
  await insertVideo(db, video)
  await insertSentences(db, sentences)
  return db
}

describe('M18 / AC-LV-05: 确定性分块', () => {
  it('短输入保持单块，超出预算时只在句子边界分块', () => {
    expect(buildStage2Blocks(video.id, sentences, 10_000)).toHaveLength(1)

    const blocks = buildStage2Blocks(video.id, sentences, 32)
    expect(blocks.length).toBeGreaterThan(1)
    expect(blocks.flatMap((block) => block.sentences.map((sentence) => sentence.id)))
      .toEqual(sentences.map((sentence) => sentence.id))
    expect(new Set(blocks.flatMap((block) => block.sentences.map((sentence) => sentence.id))).size)
      .toBe(sentences.length)
  })

  it('单句超过预算时在调用模型前失败', async () => {
    const callStage2 = vi.fn()

    await expect(runStage2Stage({
      video,
      sentences,
      settings,
      db: await stage2Db(),
      maxBlockTokens: 15,
      callStage2,
    })).rejects.toThrow(/s1.*token budget/i)
    expect(callStage2).not.toHaveBeenCalled()
  })
})

describe('M18 / AC-LV-05: 校验、重试与确定性合并', () => {
  it('模型连续返回截断或非法结果时重试三次后失败', async () => {
    const callStage2 = vi.fn().mockResolvedValue('{"blockId":')

    await expect(runStage2Stage({
      video,
      sentences,
      settings,
      db: await stage2Db(),
      maxBlockTokens: 10_000,
      callStage2,
    })).rejects.toThrow(/invalid structured output after 3 attempts/i)
    expect(callStage2).toHaveBeenCalledTimes(3)
  })

  it('多块结果在本地确定性合并', async () => {
    const blocks = buildStage2Blocks(video.id, sentences, 32)
    const callStage2 = vi.fn(async (_prompt: string, payload: string) =>
      validOutput(JSON.parse(payload) as Stage2InputBlock))
    const result = await runStage2Stage({
      video,
      sentences,
      settings,
      db: await stage2Db(),
      maxBlockTokens: 32,
      callStage2,
    })

    expect(callStage2).toHaveBeenCalledTimes(blocks.length)
    expect(result.sentences.map(({ id, text }) => ({ id, text }))).toEqual(
      sentences.map(({ id, text }) => ({ id, text })),
    )
    expect(new Set(result.sentences.map((sentence) => sentence.id)).size).toBe(sentences.length)
    const mergeBlockId = buildMergeBlockId(video.id, sentences)
    expect(result.nodes.every((node) => node.id.startsWith(`${mergeBlockId}:node:`))).toBe(true)
  })

  it('调用模型时只发送当前块的原始句子，不构造影子摘要合同', async () => {
    const payloads: Stage2InputBlock[] = []
    const callStage2 = vi.fn(async (_prompt: string, payload: string) => {
      const parsed = JSON.parse(payload) as Stage2InputBlock
      payloads.push(parsed)
      return validOutput(parsed)
    })

    await runStage2Stage({
      video,
      sentences,
      settings,
      db: await stage2Db(),
      maxBlockTokens: 32,
      callStage2,
    })

    expect(payloads.flatMap((payload) => payload.sentences.map(({ id, text }) => ({ id, text }))))
      .toEqual(sentences.map(({ id, text }) => ({ id, text })))
    expect(payloads.every((payload) =>
      Object.keys(payload).sort().join(',') === 'blockId,sentences,videoId')).toBe(true)
  })
})
