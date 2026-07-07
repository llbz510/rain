// src/pipeline/import-manager.ts
// ========================================
// 视频导入管理器
// ========================================

import type { Video, VideoSource } from '@/models/types'

export interface ImportJobInput {
  source: VideoSource
  filePath?: string
  sourceUrl?: string
  title: string
}

export interface ImportJob {
  video: Video
  requiresYtdlp: boolean
}

// 队列管理（模块级单例）
const importQueue: ImportJob[] = []
let currentJob: ImportJob | null = null

let jobCounter = 0
function generateVideoId(): string {
  jobCounter++
  return `v_${Date.now()}_${jobCounter}`
}

export function createImportJob(input: ImportJobInput): ImportJob {
  const now = Date.now()
  const video: Video = {
    id: generateVideoId(),
    title: input.title,
    source: input.source,
    filePath: input.filePath,
    sourceUrl: input.sourceUrl,
    thumbnail: '',
    duration: 0,
    language: '',
    status: 'pending',
    createdAt: now,
    position: 0,
    lastStudiedAt: now,
  }

  const job: ImportJob = {
    video,
    requiresYtdlp: input.source === 'url',
  }

  // 并发=1：如果有当前任务，加入队列；否则设为当前
  if (currentJob === null) {
    currentJob = job
  } else {
    importQueue.push(job)
  }

  return job
}

export function getImportQueue(): { current: ImportJob | null; pending: ImportJob[] } {
  return {
    current: currentJob,
    pending: [...importQueue],
  }
}

export function cancelImport(job: ImportJob): void {
  job.video.status = 'cancelled'
}

export function retryImport(job: ImportJob): void {
  // 重试走中断恢复逻辑
  job.video.status = 'pending'
  // 如有需要可重新加入队列
}
