// src/App.tsx
// ========================================
// Rain 根组件 —— 根据 store.currentVideoId 切换页面（Task 5 组装）
// null → 视频列表页；非 null → 学习界面。
// 全局快捷键由 ShortcutManager 挂载（决策53）。
// ========================================

import { useRainStore } from '@/store/rain-store'
import { VideoListPage } from '@/pages/VideoListPage'
import { StudyInterface } from '@/pages/StudyInterface'
import { ShortcutManager } from '@/ui/components/shortcut-manager'

export default function App() {
  const currentVideoId = useRainStore((s) => s.currentVideoId)

  return (
    <>
      {/* 全局快捷键监听（1/2/3 模式切换、` 摘注、Delete 删除） */}
      <ShortcutManager />
      {currentVideoId === null ? <VideoListPage /> : <StudyInterface />}
    </>
  )
}
