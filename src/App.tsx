// src/App.tsx
// ========================================
// Rain 根组件 —— 根据 store.currentPage 切换三个页面
// list → 视频列表页；study → 学习界面；settings → 设置页
// Study 页的快捷键由 StudyInterface 唯一挂载，避免在非 Study 页面拥有全局按键。
// ========================================

import { useRainStore } from '@/store/rain-store'
import { VideoListPage } from '@/pages/VideoListPage'
import { StudyInterface } from '@/pages/StudyInterface'
import { SettingsPage } from '@/ui/components/settings'
import { E2eAutomation } from '@/e2e/entry'

export default function App() {
  const currentPage = useRainStore((s) => s.currentPage)

  return (
    <>
      <E2eAutomation />
      <div hidden={currentPage !== 'list'}>
        <VideoListPage />
      </div>
      {currentPage === 'settings' && <SettingsPage />}
      {currentPage === 'study' && <StudyInterface />}
    </>
  )
}
