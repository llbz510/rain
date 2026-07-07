// harness/m20-boundaries.test.ts
// ========================================
// M20 Harness: 前后端边界约定 + 事件协议
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { TAURI_COMMANDS } from '@/architecture/commands'
import { PROGRESS_EVENT_NAME, type ProgressPayload } from '@/architecture/events'

// ===== 第一组：前后端边界约定 =====

describe('M20-T01: Rust 后端导出的 Tauri command 列表（决策92-98）', () => {
  it('包含且仅包含规定的 command', () => {
    // Rust 后端职责：ASR/yt-dlp/文件I/O/长任务调度
    // 不含 LLM 调用（那是前端的事）
    const expectedCommands = [
      'start_import',
      'cancel_import',
      'check_ytdlp',
      'probe_video_info',
      'generate_thumbnail',
      'start_asr',
      'download_whisper_model',
      'list_whisper_models',
      'convert_file_src',
    ]
    for (const cmd of expectedCommands) {
      expect(TAURI_COMMANDS).toContain(cmd)
    }
  })

  it('不包含 LLM 相关的 command（决策92：LLM 全部前端直连）', () => {
    const llmRelated = ['call_llm', 'stage2_process', 'ai_chat', 'merge_structure']
    for (const cmd of llmRelated) {
      expect(TAURI_COMMANDS).not.toContain(cmd)
    }
  })
})

describe('M20-T02: LLM 调用只在前端模块中（决策92）', () => {
  it('llm 模块导出的函数不通过 Tauri invoke', async () => {
    // 这个测试验证 llm 模块的导出函数列表
    // 实现时 llm 模块应直接用 fetch/OpenAI SDK 调用，不用 invoke
    const { LLM_FUNCTIONS } = await import('@/architecture/module-registry')
    expect(LLM_FUNCTIONS).toContain('callStage2')
    expect(LLM_FUNCTIONS).toContain('callMerge')
    expect(LLM_FUNCTIONS).toContain('streamAiChat')
    // 这些函数标记为 frontend-only
    const { FRONTEND_ONLY_MODULES } = await import('@/architecture/module-registry')
    expect(FRONTEND_ONLY_MODULES).toContain('llm')
  })
})

describe('M20-T03: 前端直连 SQL（决策93）', () => {
  it('database 模块标记为 frontend-only（不经过 Rust IPC）', async () => {
    const { FRONTEND_ONLY_MODULES } = await import('@/architecture/module-registry')
    expect(FRONTEND_ONLY_MODULES).toContain('database')
  })
})

describe('M20-T04: 进度推送走 Tauri event（决策97）', () => {
  it('进度事件名称为 "progress"', () => {
    expect(PROGRESS_EVENT_NAME).toBe('progress')
  })
})

// ===== 第二组：事件协议 =====

describe('M20-T05: progress payload 格式（决策30/97）', () => {
  it('payload 包含规定字段', () => {
    const payload: ProgressPayload = {
      videoId: 'v1',
      stage: 'asr',
      blockCurrent: 1,
      blockTotal: 3,
      percent: 33,
      retrying: false,
    }
    expect(payload.videoId).toBeDefined()
    expect(payload.stage).toBeDefined()
    expect(typeof payload.blockCurrent).toBe('number')
    expect(typeof payload.blockTotal).toBe('number')
    expect(typeof payload.percent).toBe('number')
    expect(typeof payload.retrying).toBe('boolean')
  })

  it('stage 可选值：asr, stage2, merging', () => {
    const validStages = ['asr', 'stage2', 'merging']
    for (const stage of validStages) {
      const payload: ProgressPayload = {
        videoId: 'v1', stage: stage as any,
        blockCurrent: 0, blockTotal: 0, percent: 0, retrying: false,
      }
      expect(validStages).toContain(payload.stage)
    }
  })
})

describe('M20-T06: 完成/失败/取消也走 event（决策97）', () => {
  it('导出完成/失败/取消事件名称', async () => {
    const { IMPORT_COMPLETE_EVENT, IMPORT_FAILED_EVENT, IMPORT_CANCELLED_EVENT } =
      await import('@/architecture/events')
    expect(IMPORT_COMPLETE_EVENT).toBe('import_complete')
    expect(IMPORT_FAILED_EVENT).toBe('import_failed')
    expect(IMPORT_CANCELLED_EVENT).toBe('import_cancelled')
  })
})
