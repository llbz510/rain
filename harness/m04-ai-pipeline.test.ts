// harness/m04-ai-pipeline.test.ts
// ========================================
// M04 Harness: current ASR language and Stage2 contracts
// Harness migration: 2026-07-26
// ========================================

import { describe, expect, it } from 'vitest'
import type { Sentence } from '@/models/types'
import { detectLanguageFromSentences } from '@/pipeline/language-detection'
import {
  parseStage2BlockOutput,
  validateExactSentenceCoverage,
  validateStage2BlockOutput,
  type Stage2BlockOutput,
  type Stage2InputBlock,
} from '@/pipeline/stage2-contract'

const sentences: Sentence[] = [
  { id: 's1', nodeId: '', text: '第一句。', startTime: 0, endTime: 2, sortOrder: 0 },
  { id: 's2', nodeId: '', text: '第二句。', startTime: 2, endTime: 4, sortOrder: 1 },
]
const block: Stage2InputBlock = {
  blockId: 'stage2:test:block',
  videoId: 'video-1',
  sentences,
}

function validOutput(): Stage2BlockOutput {
  return {
    blockId: block.blockId,
    coveredSentenceIds: ['s1', 's2'],
    nodes: [
      {
        id: `${block.blockId}:node:chapter`,
        parentId: null,
        kind: 'chapter',
        title: '第一章',
        startSentenceId: 's1',
        endSentenceId: 's2',
      },
      {
        id: `${block.blockId}:node:section`,
        parentId: `${block.blockId}:node:chapter`,
        kind: 'section',
        title: '第一节',
        startSentenceId: 's1',
        endSentenceId: 's2',
      },
      {
        id: `${block.blockId}:node:paragraph`,
        parentId: `${block.blockId}:node:section`,
        kind: 'paragraph',
        title: '核心概念',
        type: 'concept',
        startSentenceId: 's1',
        endSentenceId: 's2',
      },
    ],
  }
}

describe('M04 / AC-LV-03: ASR 语言结果', () => {
  it('从真实 Sentence 文本检测中文和英文', () => {
    expect(detectLanguageFromSentences(sentences)).toBe('zh')
    expect(detectLanguageFromSentences([
      { ...sentences[0], text: 'Hello world.' },
      { ...sentences[1], text: 'How are you?' },
    ])).toBe('en')
  })
})

describe('M04 / AC-LV-05: Stage2 精确 schema 和句子覆盖', () => {
  it('接受当前 Stage2BlockOutput 的精确结构', () => {
    const output = validOutput()
    expect(parseStage2BlockOutput(output)).toEqual(output)
    expect(validateStage2BlockOutput(block, output)).toEqual([])
  })

  it('拒绝模型生成的正文和其他额外字段', () => {
    expect(parseStage2BlockOutput({ ...validOutput(), bodyText: '模型改写正文' })).toBeNull()
    const output = validOutput()
    output.nodes[2] = { ...output.nodes[2], text: '模型改写正文' } as never
    expect(validateStage2BlockOutput(block, output)).toContain(
      'node 2: unexpected field text',
    )
  })

  it('报告缺失、重复、外来和乱序句子', () => {
    expect(validateExactSentenceCoverage(['s1', 's2'], {
      blockId: block.blockId,
      nodes: [],
      coveredSentenceIds: ['s2', 'foreign', 's2'],
    })).toEqual(expect.arrayContaining([
      'missing sentence s1',
      'duplicate sentence s2',
      'foreign sentence foreign',
    ]))
  })

  it('拒绝无效段落类型和错误父子关系', () => {
    const output = validOutput()
    output.nodes[1].parentId = output.nodes[2].id
    output.nodes[2].type = 'invalid' as never

    const errors = validateStage2BlockOutput(block, output).join('\n')
    expect(errors).toMatch(/parent|tree/i)
    expect(errors).toMatch(/paragraph type/i)
  })

  it('拒绝兄弟节点时间范围重叠', () => {
    const output = validOutput()
    output.nodes[2].endSentenceId = 's1'
    output.nodes.push({
      id: `${block.blockId}:node:paragraph-2`,
      parentId: `${block.blockId}:node:section`,
      kind: 'paragraph',
      title: '第二段',
      type: 'example',
      startSentenceId: 's1',
      endSentenceId: 's2',
    })

    expect(validateStage2BlockOutput(block, output).join('\n')).toMatch(/sibling.*overlap/i)
  })
})
