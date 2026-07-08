// src/App.tsx
// ========================================
// Rain 根组件 —— 根据 store.currentVideoId 切换页面（Task 1 骨架）
// Task 5 会替换 VideoListPage / StudyInterface 的占位实现。
// ========================================

import { useRainStore } from '@/store/rain-store'
import { VideoListPage } from '@/pages/VideoListPage'
import { StudyInterface } from '@/pages/StudyInterface'

export default function App() {
  const currentVideoId = useRainStore((s) => s.currentVideoId)

  if (currentVideoId === null) {
    return <VideoListPage />
  }
  return <StudyInterface />
}
