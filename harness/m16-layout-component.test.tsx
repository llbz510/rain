// harness/m16-layout-component.test.tsx
// ========================================
// M16 布局组件 Harness
// 锁定后禁止 AI 修改
// ========================================

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LayoutSwitch } from '@/ui/components/layout-switch'
import { TestStoreProvider } from './support/test-store-provider'

function renderWithStore(ui: React.ReactElement) {
  return render(<TestStoreProvider>{ui}</TestStoreProvider>)
}

describe('U09: 随播模式渲染（决策19）', () => {
  it('渲染视频区+文本区+横条+左树+右面板', () => {
    renderWithStore(<LayoutSwitch mode="follow" />)
    expect(screen.getByTestId('video-zone')).toBeInTheDocument()
    expect(screen.getByTestId('text-zone')).toBeInTheDocument()
    expect(screen.getByTestId('catalog-bar')).toBeInTheDocument()
    expect(screen.getByTestId('side-tree')).toBeInTheDocument()
    expect(screen.getByTestId('right-panel')).toBeInTheDocument()
  })
})

describe('U10: 文本展开模式渲染（决策19）', () => {
  it('视频收为控制栏+文本展开+横条在', () => {
    renderWithStore(<LayoutSwitch mode="textExpand" />)
    expect(screen.queryByTestId('video-zone')).not.toBeInTheDocument()
    expect(screen.getByTestId('control-bar')).toBeInTheDocument()
    expect(screen.getByTestId('text-zone')).toBeInTheDocument()
    expect(screen.getByTestId('catalog-bar')).toBeInTheDocument()
  })
})

describe('U11: 目录展开模式渲染（决策19）', () => {
  it('导图区+控制栏+文本预览', () => {
    renderWithStore(<LayoutSwitch mode="mapExpand" />)
    expect(screen.queryByTestId('video-zone')).not.toBeInTheDocument()
    expect(screen.getByTestId('control-bar')).toBeInTheDocument()
    expect(screen.getByTestId('diagram-zone')).toBeInTheDocument()
    expect(screen.getByTestId('text-preview')).toBeInTheDocument()
  })
})

describe('U12: 点文本展开按钮触发 switchLayoutMode（决策21）', () => {
  it('按钮点击后模式切换', async () => {
    const user = userEvent.setup()
    renderWithStore(<LayoutSwitch mode="follow" />)
    const btn = screen.getByRole('button', { name: /文本展开/ })
    await user.click(btn)
    // 按钮文字应变为收起
    expect(screen.getByRole('button', { name: /文本收起/ })).toBeInTheDocument()
  })
})
