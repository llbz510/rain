import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StudyInterface } from '@/pages/StudyInterface'
import { getDb, resetDb } from '@/models/db-singleton'
import { getSetting } from '@/models/database'
import { useRainStore } from '@/store/rain-store'

function configureStudy() {
  useRainStore.setState({
    currentVideoId: 'proportions-video', currentVideoFilePath: 'https://example.test/video.mp4',
    currentVideoTitle: '比例课程', currentPage: 'study', layoutMode: 'follow',
    playPosition: 6, selectedNodeId: 'proportions-paragraph', selectionOrigin: 'tree',
    nodeTree: [{ id: 'proportions-paragraph', videoId: 'proportions-video', parentId: null,
      kind: 'paragraph', title: '比例段落', type: 'concept', startTime: 0, endTime: 20, text: null, sortOrder: 0 }],
    sentences: [{ id: 'proportions-sentence', nodeId: 'proportions-paragraph', text: '比例正文', startTime: 0, endTime: 20, sortOrder: 0 }],
    notes: [{ id: 'proportions-note', videoId: 'proportions-video', content: '比例随记', source: 'user', sentenceIds: [], createdAt: 1, sortOrder: 0 }],
  })
}

beforeEach(() => { resetDb(); useRainStore.getState().reset(); configureStudy(); vi.stubGlobal('PointerEvent', MouseEvent) })
afterEach(() => { cleanup(); useRainStore.getState().reset(); resetDb(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('AC-SU-04 production page proportions', () => {
  it('consumes separator direction keys without seeking or changing the media volume', async () => {
    render(<StudyInterface />)
    const left = await screen.findByRole('separator', { name: '调整目录树宽度' })
    await waitFor(() => expect(left).toHaveAttribute('aria-disabled', 'false'))
    const media = screen.getByTestId('video-player') as HTMLVideoElement
    media.currentTime = 6
    media.volume = 0.4
    fireEvent.keyDown(left, { key: 'ArrowRight' })
    expect(Number(left.getAttribute('aria-valuenow'))).toBeCloseTo(10.0909, 3)
    expect(media.currentTime).toBe(6)
    expect(useRainStore.getState().playPosition).toBe(6)
    fireEvent.click(screen.getByRole('button', { name: '导图展开' }))
    fireEvent.keyDown(screen.getByRole('separator', { name: '调整导图与预览比例' }), { key: 'ArrowUp' })
    expect(media.volume).toBe(0.4)
    expect(media.currentTime).toBe(6)
    await waitFor(() => expect(screen.getByTestId('study-interface')).toHaveAttribute('aria-busy', 'false'))
  })
  it('drags both column boundaries and the follow split, retains learning facts, and restores saved proportions on a fresh mount', async () => {
    const db = await getDb()
    const view = render(<StudyInterface />)
    const left = await screen.findByRole('separator', { name: '调整目录树宽度' })
    await waitFor(() => expect(left).toHaveAttribute('aria-disabled', 'false'))
    const root = screen.getByTestId('study-interface')
    const middle = screen.getByTestId('study-middle')
    // jsdom geometry is an input fixture only; Hosted WebDriver measures real pixels separately.
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1108, bottom: 800, width: 1108, height: 800, toJSON() {} })
    vi.spyOn(middle, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 40, left: 0, top: 40, right: 700, bottom: 744, width: 700, height: 704, toJSON() {} })
    vi.spyOn(screen.getByTestId('catalog-bar').parentElement!, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 40, left: 0, top: 40, right: 700, bottom: 120, width: 700, height: 80, toJSON() {} })
    const media = screen.getByTestId('video-player') as HTMLVideoElement
    media.currentTime = 6
    Object.defineProperty(media, 'paused', { configurable: true, value: false })
    fireEvent.play(media)
    expect(Number(left.getAttribute('aria-valuenow'))).toBeCloseTo(9.0909, 3)
    const right = screen.getByRole('separator', { name: '调整助手面板宽度' })
    expect(Number(right.getAttribute('aria-valuenow'))).toBeCloseTo(27.2727, 3)
    const vertical = screen.getByRole('separator', { name: '调整视频与文本比例' })
    expect(vertical).toHaveAttribute('aria-valuenow', '60')
    expect(middle.style.gridTemplateRows).toBe('var(--height-catalog) minmax(0, 0.6fr) var(--spacing-1) minmax(0, 0.4fr)')

    fireEvent.pointerDown(left, { button: 0, clientX: 100 })
    fireEvent.pointerMove(left, { clientX: 200 })
    fireEvent.pointerUp(left, { clientX: 200 })
    expect(Number(left.getAttribute('aria-valuenow'))).toBeCloseTo(18.1818, 3)
    expect(Number.parseFloat(root.style.gridTemplateColumns)).toBeCloseTo(0.181818, 5)
    fireEvent.pointerDown(right, { button: 0, clientX: 800 })
    fireEvent.pointerMove(right, { clientX: 745 })
    fireEvent.pointerUp(right, { clientX: 745 })
    expect(Number(right.getAttribute('aria-valuenow'))).toBeCloseTo(32.2727, 3)
    expect(Number.parseFloat(root.style.gridTemplateColumns.split(' ').at(-1)!)).toBeCloseTo(0.322727, 5)
    fireEvent.pointerDown(vertical, { button: 0, clientY: 400 })
    fireEvent.pointerMove(vertical, { clientY: 462 })
    fireEvent.pointerUp(vertical, { clientY: 462 })
    expect(vertical).toHaveAttribute('aria-valuenow', '70')
    expect(middle.style.gridTemplateRows).toContain('minmax(0, 0.7fr)')
    await waitFor(async () => expect(JSON.parse((await getSetting(db, 'study_layout_proportions'))!)).toMatchObject({ follow: 0.7 }))
    const savedColumns = root.style.gridTemplateColumns
    expect(savedColumns).not.toBe('1fr var(--spacing-1) 7fr var(--spacing-1) 3fr')
    fireEvent.click(screen.getByRole('button', { name: '文本展开' }))
    expect(screen.queryByRole('separator', { name: '调整视频与文本比例' })).not.toBeInTheDocument()
    expect(root.style.gridTemplateColumns).toBe(savedColumns)
    expect(middle.style.gridTemplateRows).toBe('var(--height-catalog) var(--height-controlbar) minmax(0, 1fr)')
    fireEvent.click(screen.getByRole('button', { name: '导图展开' }))
    const mapSplit = screen.getByRole('separator', { name: '调整导图与预览比例' })
    fireEvent.keyDown(mapSplit, { key: 'ArrowUp' })
    expect(mapSplit).toHaveAttribute('aria-valuenow', '59')
    await waitFor(async () => expect(JSON.parse((await getSetting(db, 'study_layout_proportions'))!)).toMatchObject({ follow: 0.7, mapExpand: 0.59 }))
    expect(screen.getByTestId('video-player')).toBe(media)
    expect(media.currentTime).toBe(6)
    expect(useRainStore.getState()).toMatchObject({ playPosition: 6, isPlaying: true, selectedNodeId: 'proportions-paragraph', notes: [{ id: 'proportions-note', content: '比例随记' }] })

    view.unmount()
    act(() => { useRainStore.getState().reset(); configureStudy() })
    render(<StudyInterface />)
    await waitFor(() => expect(screen.getByRole('separator', { name: '调整视频与文本比例' })).toHaveAttribute('aria-valuenow', '70'))
    expect(screen.getByTestId('study-interface').style.gridTemplateColumns).toBe(savedColumns)
    fireEvent.click(screen.getByRole('button', { name: '导图展开' }))
    expect(screen.getByRole('separator', { name: '调整导图与预览比例' })).toHaveAttribute('aria-valuenow', '59')
  })
})
