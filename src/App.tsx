// src/App.tsx
// ========================================
// Rain 根组件 —— 根据 store.currentPage 切换三个页面
// list → 视频列表页；study → 学习界面；settings → 设置页
// 全局快捷键由 ShortcutManager 挂载（决策53）。
// ========================================

import { useRainStore } from '@/store/rain-store'
import { VideoListPage } from '@/pages/VideoListPage'
import { StudyInterface } from '@/pages/StudyInterface'
import { SettingsPage } from '@/ui/components/settings'
import { ShortcutManager } from '@/ui/components/shortcut-manager'
import { E2eAutomation } from '@/e2e/entry'

export default function App() {
  const currentPage = useRainStore((s) => s.currentPage)

  return (
    <>
      <ShortcutManager />
      <E2eAutomation />
      <div hidden={currentPage !== 'list'}>
        <VideoListPage />
      </div>
      {currentPage === 'settings' && <SettingsPage />}
      {currentPage === 'study' && <StudyInterface />}
    </>
  )
}
