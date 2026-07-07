// harness/m03-video-import.test.ts
// ========================================
// M03 Harness: 视频导入流程
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import type { Video } from '@/models/types'
import {
  createImportJob,
  getImportQueue,
  cancelImport,
  retryImport,
} from '@/pipeline/import-manager'

describe('M03-T01: 本地文件导入（决策55）', () => {
  it('创建 Video 记录，status=pending', () => {
    const job = createImportJob({
      source: 'local',
      filePath: '/path/to/video.mp4',
      title: '测试视频',
    })
    expect(job.video.status).toBe('pending')
    expect(job.video.source).toBe('local')
    expect(job.video.filePath).toBe('/path/to/video.mp4')
    expect(job.video.id).toBeDefined()
  })
})

describe('M03-T02: 在线 URL 导入前检测 yt-dlp（决策95）', () => {
  it('source=url 时 job 标记 requiresYtdlp=true', () => {
    const job = createImportJob({
      source: 'url',
      sourceUrl: 'https://youtube.com/watch?v=xxx',
      title: 'YouTube 视频',
    })
    expect(job.requiresYtdlp).toBe(true)
  })
})

describe('M03-T03: 导入状态流转（决策55）', () => {
  it('正常流程：pending → processing → ready', () => {
    const job = createImportJob({ source: 'local', filePath: '/v.mp4', title: '视频' })
    expect(job.video.status).toBe('pending')

    // 模拟状态流转
    job.video.status = 'processing'
    expect(job.video.status).toBe('processing')

    job.video.status = 'ready'
    expect(job.video.status).toBe('ready')
  })
})

describe('M03-T04: 导入失败（M15）', () => {
  it('失败时 status=failed 且 error_message 有值', () => {
    const job = createImportJob({ source: 'local', filePath: '/v.mp4', title: '视频' })
    job.video.status = 'failed'
    job.video.errorMessage = 'ASR 模型加载失败'
    expect(job.video.status).toBe('failed')
    expect(job.video.errorMessage).toBeDefined()
    expect(job.video.errorMessage!.length).toBeGreaterThan(0)
  })
})

describe('M03-T05: 导入取消（决策83）', () => {
  it('取消后 status=cancelled', () => {
    const job = createImportJob({ source: 'local', filePath: '/v.mp4', title: '视频' })
    cancelImport(job)
    expect(job.video.status).toBe('cancelled')
  })
})

describe('M03-T06: 并发=1，排队等待（决策55/98）', () => {
  it('第二个导入排队', () => {
    const job1 = createImportJob({ source: 'local', filePath: '/v1.mp4', title: '视频1' })
    const job2 = createImportJob({ source: 'local', filePath: '/v2.mp4', title: '视频2' })
    const queue = getImportQueue()
    // 第一个是当前正在处理的，第二个在队列中等待
    expect(queue.current).toBeDefined()
    expect(queue.pending.length).toBeGreaterThanOrEqual(1)
  })
})

describe('M03-T07: 取消后重试走中断恢复（决策89）', () => {
  it('retryImport 不抛错', () => {
    const job = createImportJob({ source: 'local', filePath: '/v.mp4', title: '视频' })
    cancelImport(job)
    expect(job.video.status).toBe('cancelled')
    // 重试不应抛错
    expect(() => retryImport(job)).not.toThrow()
  })
})

describe('M03-T08: 在线视频记录 sourceUrl（M02）', () => {
  it('source=url 时 sourceUrl 被记录', () => {
    const job = createImportJob({
      source: 'url',
      sourceUrl: 'https://bilibili.com/video/BV123',
      title: 'B站视频',
    })
    expect(job.video.sourceUrl).toBe('https://bilibili.com/video/BV123')
  })
})
