// src/pages/VideoListPage.tsx
// ========================================
// M17 视频列表页（Task 5 组装）
// 顶栏：标题 / 搜索框 / 排序 / 导入
// 主区：视频卡片网格，复用 VideoCard 组件
// 数据：createDatabase + listVideos + searchVideosByTitle
// jsdom 下 listVideos 返回空 → 显示空状态（getEmptyStateMessage）
// ========================================

import { useEffect, useState } from 'react'
import {
  createDatabase,
  listVideos,
  searchVideosByTitle,
  type Database,
} from '@/models/database'
import { VideoCard } from '@/ui/components/video-list'
import { getEmptyStateMessage } from '@/ui/video-list'
import { useRainStore } from '@/store/rain-store'
import type { Video } from '@/models/types'

type SortBy = 'lastStudied' | 'createdAt' | 'title'

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100vw',
  background: 'var(--color-bg)',
  color: 'var(--color-fg)',
  overflow: 'hidden',
}

const topbarStyle: React.CSSProperties = {
  height: 'var(--height-topbar)',
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-3)',
  padding: '0 var(--spacing-4)',
  background: 'var(--color-surface)',
  borderBottom: '1px solid var(--color-border)',
}

const titleStyle: React.CSSProperties = {
  fontWeight: 'var(--font-weight-bold)',
  fontSize: 'var(--font-size-md)',
  flex: '0 0 auto',
}

const searchStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: '120px',
  maxWidth: '420px',
  height: '28px',
  padding: '0 var(--spacing-2)',
  background: 'var(--color-bg)',
  color: 'var(--color-fg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-1)',
  fontSize: 'var(--font-size-sm)',
}

const sortStyle: React.CSSProperties = {
  flex: '0 0 auto',
  height: '28px',
  background: 'var(--color-bg)',
  color: 'var(--color-fg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-1)',
  fontSize: 'var(--font-size-sm)',
}

const importButtonStyle: React.CSSProperties = {
  flex: '0 0 auto',
  height: '28px',
  padding: '0 var(--spacing-3)',
  background: 'var(--color-accent)',
  color: '#fff',
  border: 'none',
  borderRadius: 'var(--radius-1)',
  fontSize: 'var(--font-size-sm)',
  cursor: 'pointer',
}

const mainStyle: React.CSSProperties = {
  flex: '1 1 auto',
  overflowY: 'auto',
  padding: 'var(--spacing-4)',
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 'var(--spacing-4)',
}

const emptyStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--color-muted)',
  fontSize: 'var(--font-size-lg)',
}

export function VideoListPage() {
  const [db, setDb] = useState<Database | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [sortBy, setSortBy] = useState<SortBy>('lastStudied')
  const [keyword, setKeyword] = useState('')

  // 初始化数据库（Tauri 走 SQLite，jsdom/浏览器走内存 fallback）
  useEffect(() => {
    let cancelled = false
    createDatabase(':memory:')
      .then((d) => {
        if (!cancelled) setDb(d)
      })
      .catch((err) => {
        console.error('[VideoListPage] 数据库初始化失败', err)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 加载 / 搜索 / 排序
  useEffect(() => {
    if (!db) return
    let cancelled = false
    const trimmed = keyword.trim()
    const promise = trimmed
      ? searchVideosByTitle(db, trimmed)
      : listVideos(db, sortBy)
    promise
      .then((list) => {
        if (!cancelled) setVideos(list)
      })
      .catch((err) => {
        console.error('[VideoListPage] 查询视频列表失败', err)
        if (!cancelled) setVideos([])
      })
    return () => {
      cancelled = true
    }
  }, [db, sortBy, keyword])

  // 点 ready 卡 → 进入学习界面（store 接管 currentVideoId 切页）
  const handleOpen = (videoId: string) => {
    void useRainStore.getState().loadVideo(videoId)
  }

  // 点非 ready 卡 → 打开导入框（暂为占位）
  const handleOpenImport = (videoId: string) => {
    console.log('[VideoListPage] open import dialog for', videoId)
  }

  const handleImportClick = () => {
    console.log('[VideoListPage] import clicked')
  }

  const isEmpty = videos.length === 0

  return (
    <div data-testid="video-list-page" style={rootStyle}>
      <header style={topbarStyle}>
        <span style={titleStyle}>Rain</span>
        <input
          type="text"
          placeholder="搜索标题"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={searchStyle}
        />
        <select
          aria-label="排序"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          style={sortStyle}
        >
          <option value="lastStudied">最近学习</option>
          <option value="createdAt">创建时间</option>
          <option value="title">名称</option>
        </select>
        <button onClick={handleImportClick} style={importButtonStyle}>
          导入
        </button>
      </header>

      <main style={mainStyle}>
        {isEmpty ? (
          <div style={emptyStyle}>{getEmptyStateMessage()}</div>
        ) : (
          <div style={gridStyle}>
            {videos.map((v) => (
              <VideoCard
                key={v.id}
                video={v}
                onOpen={handleOpen}
                onOpenImport={handleOpenImport}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
