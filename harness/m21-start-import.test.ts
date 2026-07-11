// harness/m21-start-import.test.ts
// ========================================
// M21 Harness: start_import 命令行为 + generate_thumbnail 签名
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { TAURI_COMMANDS } from '@/architecture/commands'
import {
  createImportJob,
  getImportQueue,
  cancelImport,
} from '@/pipeline/import-manager'

describe('M21-T01: start_import 在命令列表中', () => {
  it('TAURI_COMMANDS 包含 start_import', () => {
    expect(TAURI_COMMANDS).toContain('start_import')
  })
})

describe('M21-T02: 创建本地导入任务后 status=pending', () => {
  it('本地文件导入 job 的 video.status 为 pending', () => {
    const job = createImportJob({
      source: 'local',
      filePath: '/test/video.mp4',
      title: '测试视频',
    })
    expect(job.video.status).toBe('pending')
  })
})

describe('M21-T03: 本地导入 requiresYtdlp=false', () => {
  it('source=local 时不需要 yt-dlp', () => {
    const job = createImportJob({
      source: 'local',
      filePath: '/test/video.mp4',
      title: '本地视频',
    })
    expect(job.requiresYtdlp).toBe(false)
  })
})

describe('M21-T04: URL 导入 requiresYtdlp=true', () => {
  it('source=url 时需要 yt-dlp', () => {
    const job = createImportJob({
      source: 'url',
      sourceUrl: 'https://example.com/video',
      title: '在线视频',
    })
    expect(job.requiresYtdlp).toBe(true)
  })
})

describe('M21-T05: generate_thumbnail 在命令列表中', () => {
  it('TAURI_COMMANDS 包含 generate_thumbnail', () => {
    expect(TAURI_COMMANDS).toContain('generate_thumbnail')
  })
})

describe('M21-T06: convert_file_src 在命令列表中', () => {
  it('TAURI_COMMANDS 包含 convert_file_src', () => {
    expect(TAURI_COMMANDS).toContain('convert_file_src')
  })
})

describe('M21-T07: 并发=1，第二个任务排队', () => {
  it('第二个导入任务进入等待队列', () => {
    createImportJob({ source: 'local', filePath: '/v1.mp4', title: '视频1' })
    createImportJob({ source: 'local', filePath: '/v2.mp4', title: '视频2' })
    const queue = getImportQueue()
    expect(queue.current).toBeDefined()
    expect(queue.pending.length).toBeGreaterThanOrEqual(1)
  })
})

describe('M21-T08: 取消设置 status=cancelled', () => {
  it('cancelImport 把 video.status 改为 cancelled', () => {
    const job = createImportJob({ source: 'local', filePath: '/v.mp4', title: '视频' })
    cancelImport(job)
    expect(job.video.status).toBe('cancelled')
  })
})
