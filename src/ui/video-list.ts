// src/ui/video-list.ts
// ========================================
// 视频列表与管理
// ========================================

import type { Video } from '@/models/types'

export interface StatusBadge {
  type: 'processing' | 'failed' | 'pending'
  label: string
}

export interface CardDisplay {
  thumbnail: string
  title: string
  progressPercent: number
  durationText: string
  lastStudiedText: string
  badges: string[]
  isComplete: boolean
  statusBadge?: StatusBadge
}

export interface ImportStatusDisplay {
  stageLabel: string
  percent: number
  errorMessage?: string
  action?: 'cancel' | 'retry'
}

export function getImportStatus(video: Video, progressPercent?: number): ImportStatusDisplay | null {
  if (video.status === 'ready') return null
  const stage = video.stage ?? 'pending'
  const stages: Record<string, { label: string; percent: number }> = {
    pending: { label: '等待开始', percent: 0 },
    asr: { label: 'Whisper 转写', percent: 10 },
    stage2: { label: '整理章节', percent: 67 },
    merging: { label: '保存学习结构', percent: 90 },
  }
  const detail = { ...stages[stage], percent: progressPercent ?? stages[stage].percent }
  if (video.status === 'processing') return { stageLabel: detail.label, percent: detail.percent, action: 'cancel' }
  if (video.status === 'failed' || video.status === 'cancelled') {
    return { stageLabel: detail.label, percent: detail.percent, errorMessage: video.errorMessage, action: 'retry' }
  }
  return { stageLabel: detail.label, percent: detail.percent }
}
export function getCardAction(video: Video): string {
  if (video.status === 'ready') {
    return 'openVideo'
  }
  return 'openImportDialog'
}

export function buildCardDisplay(video: Video): CardDisplay {
  const progressPercent = video.duration > 0
    ? Math.round((video.position / video.duration) * 100)
    : 0

  // 是否看完（position 接近 duration，允许 5 秒误差）
  const isComplete = video.status === 'ready' && video.duration > 0 &&
    Math.abs(video.position - video.duration) <= 5

  const durationText = formatDuration(video.duration)
  const lastStudiedText = formatLastStudied(video.lastStudiedAt)

  const badges: string[] = []
  if (video.language) {
    badges.push(video.language)
  }
  if (video.source === 'url') {
    badges.push('url')
  } else {
    badges.push('local')
  }

  let statusBadge: StatusBadge | undefined
  if (video.status === 'processing') {
    statusBadge = { type: 'processing', label: '处理中' }
  } else if (video.status === 'failed') {
    statusBadge = { type: 'failed', label: '失败' }
  } else if (video.status === 'pending') {
    statusBadge = { type: 'pending', label: '排队中' }
  }

  return {
    thumbnail: video.thumbnail,
    title: video.title,
    progressPercent,
    durationText,
    lastStudiedText,
    badges,
    isComplete,
    statusBadge,
  }
}

export function buildDeleteConfirmation(
  video: Video,
  info: { nodeCount: number; noteCount: number }
): { message: string; requiresConfirm: boolean } {
  const message = `删除视频「${video.title}」将永久删除 ${info.nodeCount} 个段落和 ${info.noteCount} 条笔记，不可恢复。`
  return {
    message,
    requiresConfirm: true,
  }
}

export function getEmptyStateMessage(): string {
  return '导入你的第一个视频'
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

function formatLastStudied(timestamp: number): string {
  if (timestamp === 0) return '未学习'
  const now = Date.now()
  const diff = now - timestamp
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor(diff / (1000 * 60))

  if (days > 0) return `${days} 天前`
  if (hours > 0) return `${hours} 小时前`
  if (minutes > 0) return `${minutes} 分钟前`
  return '刚刚'
}
