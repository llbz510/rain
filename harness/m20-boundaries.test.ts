// harness/m20-boundaries.test.ts
// ========================================
// M20 Harness: 前后端边界约定 + 事件协议
// 锁定后禁止 AI 修改
// ========================================

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { PROGRESS_EVENT_NAME, type ProgressPayload } from '@/architecture/events'
import { WHISPER_MODEL_DOWNLOAD_PROGRESS_EVENT } from '@/settings/whisper-model-download'

const repoRoot = process.cwd()

function readRepoFile(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function sourceFiles(directory: string, extension: RegExp): string[] {
  const rootPath = resolve(repoRoot, directory)
  const files: string[] = []
  const visit = (path: string): void => {
    for (const entry of readdirSync(path)) {
      const child = join(path, entry)
      if (statSync(child).isDirectory()) visit(child)
      else if (extension.test(entry)) files.push(child)
    }
  }
  visit(rootPath)
  return files
}

function registeredTauriCommands(): string[] {
  const libSource = readRepoFile('src-tauri/src/lib.rs')
  const handler = libSource.match(/tauri::generate_handler!\[([\s\S]*?)\]/)?.[1]
  if (!handler) throw new Error('Could not find tauri::generate_handler! in src-tauri/src/lib.rs')
  return Array.from(handler.matchAll(/(?:commands|e2e_config)::([a-zA-Z0-9_]+)/g), (match) => match[1])
}

// ===== 第一组：前后端边界约定 =====

describe('M20-T01: Rust 后端导出的 Tauri command 列表（决策92-98）', () => {
  it('真实 invoke_handler 包含且仅包含批准的 command', () => {
    const expectedCommands = [
      'cancel_import',
      'check_ytdlp_command',
      'get_runtime_capability',
      'probe_video_info',
      'generate_thumbnail',
      'start_asr',
      'save_asr_atomically',
      'insert_note_atomically',
      'delete_video_atomically',
      'apply_settings_atomically',
      'assign_asr_sentences_atomically',
      'transition_video_import_state',
      'merge_import_atomically',
      'download_whisper_model',
      'cancel_whisper_model_download',
      'list_whisper_models',
      'get_real_e2e_config',
    ]
    const actualCommands = registeredTauriCommands()

    expect(new Set(actualCommands).size).toBe(actualCommands.length)
    expect([...actualCommands].sort()).toEqual([...expectedCommands].sort())
  })

  it('不包含 LLM 相关的 command（决策92：LLM 全部前端直连）', () => {
    const llmRelated = ['call_llm', 'stage2_process', 'ai_chat', 'merge_structure']
    for (const cmd of llmRelated) {
      expect(registeredTauriCommands()).not.toContain(cmd)
    }
  })
})

describe('M20-T02: LLM 调用只在前端模块中（决策92）', () => {
  it('真实 LLM 源码不调用 Tauri invoke', () => {
    const llmSource = sourceFiles('src/llm', /\.ts$/)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')

    expect(llmSource).not.toMatch(/\btauriInvoke\s*\(/)
    expect(llmSource).not.toMatch(/\binvoke\s*\(/)
  })
})

describe('M20-T03: 前端直连 SQL（决策93）', () => {
  it('只有数据库边界模块可以导入 Tauri SQL 插件', () => {
    const importers = sourceFiles('src', /\.tsx?$/)
      .filter((path) => readFileSync(path, 'utf8').includes('@tauri-apps/plugin-sql'))
      .map((path) => path.replaceAll('\\', '/'))

    expect(importers).toHaveLength(1)
    expect(importers[0]).toMatch(/\/src\/models\/database\.ts$/)
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

  it('stage 可选值覆盖 Rust ASR 子阶段和前端 Stage2 阶段', () => {
    const validStages: ProgressPayload['stage'][] = [
      'asr',
      'asr_extraction',
      'asr_transcription',
      'asr_finalization',
      'stage2',
      'merging',
    ]
    for (const stage of validStages) {
      const payload: ProgressPayload = {
        videoId: 'v1', stage,
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

describe('M20-T07 / AC-MM-02: Whisper 模型下载事件协议', () => {
  it('前端监听的事件名与 Rust 生产上报器一致', () => {
    const rustSource = readRepoFile('src-tauri/src/whisper_model_download.rs')
    expect(rustSource).toContain(
      `MODEL_DOWNLOAD_PROGRESS_EVENT: &str = "${WHISPER_MODEL_DOWNLOAD_PROGRESS_EVENT}"`,
    )
  })
})
