// src/ui/components/video-list.tsx
// ========================================
// M17 视频列表组件（决策54/57/58/59/60/62）
// ========================================

import React, { useState } from 'react'
import { getCardAction, buildCardDisplay, buildDeleteConfirmation, getEmptyStateMessage, getImportStatus } from '@/ui/video-list'
import type { Video } from '@/models/types'

interface VideoCardProps {
  video: Video
  onOpen?: (videoId: string) => void
  onOpenImport?: (videoId: string) => void
  onCancelImport?: (videoId: string) => void
  onRetryImport?: (videoId: string) => void
  importProgressPercent?: number
  nodeCount?: number
  noteCount?: number
}

export function VideoCard({ video, onOpen, onOpenImport, onCancelImport, onRetryImport, importProgressPercent, nodeCount, noteCount }: VideoCardProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const display = buildCardDisplay(video)
  const importStatus = getImportStatus(video, importProgressPercent)

  const handleClick = () => {
    const action = getCardAction(video)
    if (action === 'openVideo') onOpen?.(video.id)
    else onOpenImport?.(video.id)
  }

  return (
    <div data-testid={`card-${video.id}`} style={{ cursor: 'pointer' }}>
      <img src={video.thumbnail} alt={video.title} onClick={handleClick} />
      <span onClick={handleClick}>{video.title}</span>
      <div>{display.durationText}</div>
      <div>{display.progressPercent}%</div>
      {display.isComplete && <span>✓</span>}
      {display.statusBadge && <span data-testid={`badge-${video.id}`} data-status={display.statusBadge.type} />}
      {importStatus && (
        <div data-testid={`import-status-${video.id}`}>
          <div>{importStatus.stageLabel} · {importStatus.percent}%</div>
          {importStatus.errorMessage && <div role="alert">{importStatus.errorMessage}</div>}
          {importStatus.action === 'cancel' && <button aria-label="取消导入" onClick={() => onCancelImport?.(video.id)}>取消导入</button>}
          {importStatus.action === 'retry' && <button aria-label="重试导入" onClick={() => onRetryImport?.(video.id)}>重试导入</button>}
        </div>
      )}
      <button onClick={() => setShowConfirm(true)}>删除</button>
      {showConfirm && (
        <div data-testid="delete-confirm">
          {buildDeleteConfirmation(video, {
            nodeCount: nodeCount ?? 0,
            noteCount: noteCount ?? 0,
          }).message}
        </div>
      )}
    </div>
  )
}
interface VideoListProps {
  videos: Video[]
}

export function VideoList({ videos }: VideoListProps) {
  const [search, setSearch] = useState('')

  const filtered = search
    ? videos.filter((v) => v.title.includes(search))
    : videos

  return (
    <div data-testid="video-list">
      <select aria-label="排序">
        <option value="lastStudied">最近学习</option>
        <option value="createdAt">创建时间</option>
        <option value="title">名称</option>
      </select>
      <input
        placeholder="搜索标题"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {filtered.length === 0 && !search ? (
        <div>{getEmptyStateMessage()}</div>
      ) : (
        filtered.map((v) => <VideoCard key={v.id} video={v} />)
      )}
    </div>
  )
}
