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
  insertVideo,
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

const settingsButtonStyle: React.CSSProperties = {
  flex: '0 0 auto',
  height: '28px',
  padding: '0 var(--spacing-2)',
  background: 'transparent',
  color: 'var(--color-fg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-1)',
  fontSize: 'var(--font-size-sm)',
  cursor: 'pointer',
}

const importWrapperStyle: React.CSSProperties = {
  position: 'relative',
  flex: '0 0 auto',
}

const dropdownStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: '4px',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-1)',
  padding: '4px 0',
  zIndex: 10,
  minWidth: '120px',
  boxShadow: '0 4px 16px rgba(0,0,0,.4)',
}

const dropdownItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 12px',
  background: 'transparent',
  color: 'var(--color-fg)',
  border: 'none',
  fontSize: 'var(--font-size-sm)',
  textAlign: 'left' as const,
  cursor: 'pointer',
  fontFamily: 'inherit',
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
  const [importMenuOpen, setImportMenuOpen] = useState(false)

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
    setImportMenuOpen((prev) => !prev)
  }

  const handleLocalImport = async () => {
    setImportMenuOpen(false)
    try {
      const { isTauri, tauriInvoke } = await import('@/lib/tauri-env')
      if (!isTauri()) {
        alert('请在桌面应用中使用本地文件导入')
        return
      }
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv'] }],
        multiple: false,
      })
      if (!selected) return

      const filePath = selected
      const info = await tauriInvoke<{ title: string; duration: number; thumbnail: string }>(
        'probe_video_info',
        { filePath, sourceUrl: null },
      )

      if (!db) return
      const video: Video = {
        id: `v_${Date.now()}`,
        title: info.title,
        source: 'local',
        filePath,
        thumbnail: info.thumbnail,
        duration: info.duration,
        language: '',
        status: 'pending',
        createdAt: Date.now(),
        position: 0,
        lastStudiedAt: Date.now(),
      }
      await insertVideo(db, video)
      const list = keyword.trim()
        ? await searchVideosByTitle(db, keyword.trim())
        : await listVideos(db, sortBy)
      setVideos(list)
    } catch (err) {
      console.error('[VideoListPage] 本地文件导入失败', err)
    }
  }

  const handleUrlImport = () => {
    setImportMenuOpen(false)
    console.log('[VideoListPage] online import - will be implemented in Task 6')
  }

  const handleSettingsClick = () => {
    useRainStore.getState().setPage('settings')
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
        <div style={importWrapperStyle}>
          <button onClick={handleImportClick} style={importButtonStyle}>
            导入
          </button>
          {importMenuOpen && (
            <div style={dropdownStyle}>
              <button onClick={handleLocalImport} style={dropdownItemStyle}>
                本地文件
              </button>
              <button onClick={handleUrlImport} style={dropdownItemStyle}>
                在线视频
              </button>
            </div>
          )}
        </div>
        <button onClick={handleSettingsClick} style={settingsButtonStyle}>
          设置
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
