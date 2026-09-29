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
  action?: 'cancel' | 'continue' | 'retry'
}

export function getImportStatus(video: Video, progressPercent?: number): ImportStatusDisplay | null {
  if (video.status === 'ready') return null
  const stage = video.stage ?? 'pending'
  const stages: Record<string, { label: string; percent: number }> = {
    download: { label: '下载在线视频', percent: 0 },
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
  if (video.status === 'pending' && video.stage == null) {
    return { stageLabel: detail.label, percent: detail.percent, action: 'continue' }
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
    statusBadge = { type: 'processing', label: '正在处理' }
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

const DAY_MS = 1000 * 60 * 60 * 24

/**
 * 距今超过一年时改用**具体日期**（本地时区，`YYYY-MM-DD`），不再报「N 天前」。
 *
 * 用户 2026-09-29 批准。起因是一次真实事故：「N 天前」没有上界，卡片渲染出「20725 天前」，
 * 而锁定 Harness 的 U52 用例当时用 `getByText(/25/)` 这类宽松匹配，两个元素同时命中，
 * 用例随日期发作变红（每逢天数含 "25" 都会复发）。
 * 取本地时区分量而非 UTC：显示给用户看的是本地日期，跨时区的机器上也不会差一天。
 */
function formatLocalDate(timestamp: number): string {
  const date = new Date(timestamp)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatLastStudied(timestamp: number): string {
  if (timestamp === 0) return '未学习'
  const now = Date.now()
  const diff = now - timestamp
  // 判据与显示用**同一个**向下取整的"已满天数"：
  // 否则 365.5 天会被判为"未超过 365"、显示却写成「366 天前」，自相矛盾。
  // 向下取整意味着"满 365 天不满 366 天"仍显示「365 天前」，满 366 天才换日期。
  const completedDays = Math.floor(diff / DAY_MS)
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor(diff / (1000 * 60))

  if (completedDays > 365) return formatLocalDate(timestamp)
  if (completedDays > 0) return `${completedDays} 天前`
  if (hours > 0) return `${hours} 小时前`
  if (minutes > 0) return `${minutes} 分钟前`
  return '刚刚'
}
