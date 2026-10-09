// src/pages/StudyInterface.tsx
// ========================================
// M16 三模式学习界面（Task 5 组装）
// 布局：可调三列；中间列包含目录、视觉区、控制栏与文本。
// 区域显隐完全由 src/ui/layout.ts 的 getVisibility(layoutMode) 决定。
//   follow     → videoZone + textZone + catalogBar + sideTree + rightPanel
//   textExpand → controlBar + textZone + catalogBar + sideTree + rightPanel
//   mapExpand  → controlBar + diagramZone + textPreview + sideTree + rightPanel
// ========================================

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRainStore } from '@/store/rain-store'
import { getVisibility } from '@/ui/layout'
import { SideTree, CatalogBar, DiagramZone } from '@/ui/components/catalog'
import { VideoZone, VideoControls } from '@/ui/components/video'
import { TextPreview, TextZone, type TextScrollTarget } from '@/ui/components/text-zone'
import { NotesPanel } from '@/ui/components/notes'
import { AiAssistant, ChatInput, QuickActions } from '@/ui/components/ai-assistant'
import { redactSecret, streamAiChat } from '@/llm/client'
import { buildAssistantContext, type AssistantSource } from '@/ai/assistant-context'
import type { Node, ParagraphType, Sentence } from '@/models/types'
import { decideModelRoleAssignment } from '@/settings/model-capabilities'
import { runtimeModelFromPoolEntry } from '@/settings/model-pool'
import { resolveNodeNavigationTarget, resolveSentenceNavigationTarget } from '@/study/navigation'
import { recordPlaybackProgress } from '@/study/session'
import { createFreeNote, createParagraphExcerpt, saveNoteContent } from '@/study/notes'
import { useStudyShortcutController } from '@/study/shortcut-controller'
import { activeStudyMediaActions } from '@/study/media-session'
import { useStudyProportions } from '@/study/layout-proportions'
import { LayoutSeparator } from '@/ui/components/layout-separator'

const rootStyle: React.CSSProperties = {
  display: 'grid',
  background: 'var(--color-bg)',
  color: 'var(--color-fg)',
  height: '100vh',
  width: '100vw',
  overflow: 'hidden',
}

const topbarStyle: React.CSSProperties = {
  gridColumn: '1 / -1',
  gridRow: '1',
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--spacing-3)',
  padding: '0 var(--spacing-3)',
  background: 'var(--color-surface)',
  borderBottom: '1px solid var(--color-border)',
}

const backButtonStyle: React.CSSProperties = {
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

const titleStyle: React.CSSProperties = {
  flex: '1 1 auto',
  fontSize: 'var(--font-size-md)',
  fontWeight: 'var(--font-weight-semibold)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const sideTreeStyle: React.CSSProperties = {
  gridColumn: '1',
  gridRow: '2',
  minWidth: 0,
  overflow: 'auto',
  background: 'var(--color-surface)',
  borderRight: '1px solid var(--color-border)',
  padding: 'var(--spacing-2)',
}

// 中间区：固定目录高度，视觉区（含控制栏）与文本使用持久比例。
const middleStyle: React.CSSProperties = {
  gridColumn: '3',
  gridRow: '2',
  display: 'grid',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  background: 'var(--color-bg)',
}

const flexFillStyle: React.CSSProperties = {
  flex: '1 1 0',
  minHeight: 0,
  overflow: 'auto',
}

const flexAutoStyle: React.CSSProperties = {
  flex: '0 0 auto',
}

const hiddenVideoStyle: React.CSSProperties = {
  display: 'none',
}

const rightPanelStyle: React.CSSProperties = {
  gridColumn: '5',
  gridRow: '2',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  background: 'var(--color-surface)',
  borderLeft: '1px solid var(--color-border)',
}

const tabBarStyle: React.CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  borderBottom: '1px solid var(--color-border)',
}

/**
 * 视觉合同 VC-03③：模式/Tab 激活态 = 底色变暗（决策65）。
 * 原实现用品牌蓝色下划线表示激活，属强调色用法，已按 DEC-VC-01/VC-03 移除。
 * 激活底色取 `--color-bg`（#1a1a1a，相对亮度 0.0103）——它比未激活的底 `--color-surface`（#242424，0.0176）更暗，
 * 满足「激活态底色变暗」的可测判据；该值取自已确认的冻结四档中性色阶（决策64），不引入新色值。
 * 下方 1px 分隔线仍用 `--color-border`（对面板 4.80:1，满足 1px 边框 ≥3:1）。
 */
export const tabActiveStyle: React.CSSProperties = {
  background: 'var(--color-bg)',
  color: 'var(--color-fg)',
  borderBottom: '1px solid var(--color-border)',
}

export const tabInactiveStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  color: 'var(--color-muted)',
  borderBottom: '1px solid var(--color-border)',
}

function tabButtonStyle(active: boolean): React.CSSProperties {
  return {
    flex: '1 1 0',
    height: '36px',
    padding: 0,
    border: 'none',
    borderLeft: 'none',
    borderRight: 'none',
    borderTop: 'none',
    fontSize: 'var(--font-size-sm)',
    fontWeight: active ? 'var(--font-weight-semibold)' : 'var(--font-weight-normal)',
    cursor: 'pointer',
    ...(active ? tabActiveStyle : tabInactiveStyle),
  }
}

const tabContentStyle: React.CSSProperties = {
  flex: '1 1 0',
  minHeight: 0,
  overflow: 'auto',
  padding: 'var(--spacing-3)',
  display: 'flex',
  flexDirection: 'column',
}

const quickActionsStyle: React.CSSProperties = {
  flex: '0 0 auto',
  marginBottom: 'var(--spacing-3)',
}

const activeAiPanelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
}

const controlBarStyle: React.CSSProperties = {
  flex: '0 0 var(--height-controlbar)',
  height: 'var(--height-controlbar)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--spacing-3)',
  padding: '0 var(--spacing-3)',
  background: 'var(--color-surface)',
  borderTop: '1px solid var(--color-border)',
  overflow: 'hidden',
}

function currentSentence(sentences: Sentence[], position: number): Sentence | undefined {
  return sentences.find((sentence) => sentence.startTime <= position && position < sentence.endTime)
    ?? [...sentences].sort((left, right) => Math.abs(left.startTime - position) - Math.abs(right.startTime - position))[0]
}

function currentParagraphType(nodes: Node[], sentences: Sentence[], playPosition: number, selectedNodeId: string | null): ParagraphType | null {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const selected = selectedNodeId ? nodesById.get(selectedNodeId) : null
  if (selected?.kind === 'paragraph') return selected.type
  const active = currentSentence([...sentences].sort((left, right) => left.sortOrder - right.sortOrder), playPosition)
  const activeNode = active ? nodesById.get(active.nodeId) : null
  return activeNode?.kind === 'paragraph' ? activeNode.type : null
}

export function StudyInterface() {
  const rootRef = useRef<HTMLDivElement>(null)
  const middleRef = useRef<HTMLElement>(null)
  const catalogRef = useRef<HTMLDivElement>(null)
  const separatorRef = useRef<HTMLDivElement>(null)
  const { proportions, ready, saving, error: layoutError, change: changeProportions, save: saveProportions } = useStudyProportions()
  const layoutMode = useRainStore((s) => s.layoutMode)
  const aiPanelState = useRainStore((s) => s.aiPanelState)
  const playPosition = useRainStore((s) => s.playPosition)
  const unloadVideo = useRainStore((s) => s.unloadVideo)
  const currentVideoId = useRainStore((s) => s.currentVideoId)
  const filePath = useRainStore((s) => s.currentVideoFilePath)
  const videoTitle = useRainStore((s) => s.currentVideoTitle)
  const selectedNodeId = useRainStore((s) => s.selectedNodeId)
  const nodeTree = useRainStore((s) => s.nodeTree)
  const sentences = useRainStore((s) => s.sentences)
  const currentSubtitle = sentences.find(
    (sentence) => sentence.startTime <= playPosition && playPosition < sentence.endTime,
  )?.text

  // AI chat state
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string; sources?: AssistantSource[] }>>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [textScrollTarget, setTextScrollTarget] = useState<TextScrollTarget | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const requestIdRef = useRef(0)
  const navigationRequestIdRef = useRef(0)
  const aiInputRef = useRef<HTMLTextAreaElement>(null)
  const notesFocusRef = useRef<HTMLTextAreaElement>(null)
  const [panelFocusTarget, setPanelFocusTarget] = useState<'ai' | 'notes' | null>(null)
  useEffect(() => () => {
    requestIdRef.current += 1
    cleanupRef.current?.()
  }, [])

  const handleStopMessage = useCallback(() => {
    requestIdRef.current += 1
    cleanupRef.current?.()
    cleanupRef.current = null
    setIsStreaming(false)
  }, [])

  const handleSendMessage = useCallback((text: string, scope: 'nearby' | 'paragraph' = 'nearby') => {
    const store = useRainStore.getState()
    const selected = store.modelPool.find((model) => model.id === store.roleAssignment.assistant)
    const assistantModel = selected ? { ...selected } : null
    const capabilities = store.capabilityRecords.map((record) => ({ ...record }))
    if (
      !assistantModel
      || assistantModel.type !== 'llm'
      || !assistantModel.baseUrl?.trim()
      || !assistantModel.modelName.trim()
      || !assistantModel.apiKey?.trim()
    ) {
      setChatMessages((previous) => [...previous, { role: 'user', content: text }, { role: 'assistant', content: '请先在设置中配置可用的文本助手模型。' }])
      return
    }
    const decision = decideModelRoleAssignment(
      runtimeModelFromPoolEntry(assistantModel),
      'assistant',
      capabilities,
    )
    if (!decision.allowed) {
      const reason = redactSecret(decision.capability.message, [assistantModel.apiKey])
      setChatMessages((previous) => [...previous, { role: 'user', content: text }, { role: 'assistant', content: `助手模型“${assistantModel.alias}”不可用：${reason}` }])
      return
    }
    cleanupRef.current?.()
    cleanupRef.current = null
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const context = buildAssistantContext({ nodes: store.nodeTree, sentences: store.sentences, playPosition: store.playPosition, question: text, history: chatMessages, scope })
    const settings = {
      baseUrl: assistantModel.baseUrl,
      apiKey: assistantModel.apiKey,
      model: assistantModel.modelName,
    }
    let active = true
    let currentContent = ''
    setChatMessages((previous) => [...previous, { role: 'user', content: text }, { role: 'assistant', content: '', sources: context.sources }])
    setIsStreaming(true)
    const cleanup = streamAiChat([{ role: 'system', content: context.systemPrompt }, ...context.history, { role: 'user', content: text }], settings, {
      onToken: (token) => {
        if (!active || requestIdRef.current !== requestId) return
        currentContent += token
        setChatMessages((previous) => {
          const updated = [...previous]
          updated[updated.length - 1] = { role: 'assistant', content: currentContent, sources: context.sources }
          return updated
        })
      },
      onDone: () => { if (active && requestIdRef.current === requestId) { setIsStreaming(false); cleanupRef.current = null } },
      onError: (error) => {
        if (!active || requestIdRef.current !== requestId) return
        setIsStreaming(false); cleanupRef.current = null
        const safeMessage = redactSecret(error.message, [settings.apiKey])
        setChatMessages((previous) => {
          const updated = [...previous]
          updated[updated.length - 1] = { role: 'assistant', content: `请求失败：${safeMessage}`, sources: context.sources }
          return updated
        })
      },
    })
    cleanupRef.current = () => { active = false; cleanup() }
  }, [chatMessages])
  // 显隐完全交给布局状态机，不在此处重新实现逻辑（决策19）
  const visibility = getVisibility(layoutMode)

  // 拖动横条/导图节点 → 跳转播放位置
  const handleSeek = (time: number) => {
    useRainStore.setState({ playPosition: time })
  }

  const handlePlaybackProgress = useCallback((position: number) => {
    if (!currentVideoId) return
    void recordPlaybackProgress(currentVideoId, position).catch((error) => {
      console.error('Unable to persist study progress', error)
    })
  }, [currentVideoId])

  const handleNodeNavigate = useCallback((nodeId: string) => {
    const target = resolveNodeNavigationTarget(nodeTree, sentences, nodeId)
    if (!target) return

    navigationRequestIdRef.current += 1
    useRainStore.setState({ playPosition: target.time })
    setTextScrollTarget({
      paragraphId: target.paragraphId,
      requestId: navigationRequestIdRef.current,
    })
  }, [nodeTree, sentences])

  const handleSentenceNavigate = useCallback((sentenceId: string) => {
    const target = resolveSentenceNavigationTarget(sentences, sentenceId)
    if (!target) return

    navigationRequestIdRef.current += 1
    useRainStore.setState({ playPosition: target.time })
    setTextScrollTarget({
      paragraphId: target.paragraphId,
      requestId: navigationRequestIdRef.current,
    })
  }, [sentences])

  const handleExcerpt = useCallback((paragraphId: string) => {
    void createParagraphExcerpt(paragraphId).catch((error) => {
      console.error('Unable to create excerpt note', error)
    })
  }, [])

  const handleCreateFreeNote = useCallback(async (content: string = '') => {
    try {
      await createFreeNote(content)
      return true
    } catch (error) {
      console.error('Unable to create free note', error)
      return false
    }
  }, [])

  const handleSaveNote = useCallback((noteId: string, content: string) => {
    void saveNoteContent(noteId, content).catch((error) => {
      console.error('Unable to save note', error)
    })
  }, [])

  const setAiPanel = (panel: 'ai' | 'notes') => {
    useRainStore.setState({ aiPanelState: panel })
  }

  useEffect(() => {
    if (!panelFocusTarget) return
    const input = panelFocusTarget === 'ai' ? aiInputRef.current : notesFocusRef.current
    input?.focus()
    setPanelFocusTarget(null)
  }, [aiPanelState, panelFocusTarget])

  const handleShortcutPanelToggle = useCallback((panel: 'ai' | 'notes') => {
    setAiPanel(panel)
    setPanelFocusTarget(panel)
  }, [])

  useStudyShortcutController({
    nodes: nodeTree,
    onExcerpt: handleExcerpt,
    onNavigateParagraph: handleNodeNavigate,
    onTogglePanel: handleShortcutPanelToggle,
    media: activeStudyMediaActions,
  })

  const quickParagraphType = currentParagraphType(nodeTree, sentences, playPosition, selectedNodeId)

  const [leftShare, middleShare, rightShare] = proportions.columns
  const split = layoutMode === 'mapExpand' ? proportions.mapExpand : proportions.follow
  const middleRows = layoutMode === 'textExpand'
    ? 'var(--height-catalog) var(--height-controlbar) minmax(0, 1fr)'
    : `${visibility.catalogBar ? 'var(--height-catalog)' : '0px'} minmax(0, ${split}fr) var(--spacing-1) minmax(0, ${1 - split}fr)`
  const columnExtent = () => (rootRef.current?.getBoundingClientRect().width ?? 0) - 2 * (separatorRef.current?.getBoundingClientRect().width || 4)

  return (
    <div
      data-testid="study-interface"
      aria-busy={!ready || saving}
      ref={rootRef}
      style={{ ...rootStyle, gridTemplateRows: 'var(--height-topbar) minmax(0, 1fr)', gridTemplateColumns: `${leftShare}fr var(--spacing-1) ${middleShare}fr var(--spacing-1) ${rightShare}fr` }}
    >
      {/* 顶栏：返回 + 标题 */}
      <header style={topbarStyle}>
        <button onClick={() => unloadVideo()} style={backButtonStyle}>
          ← 返回
        </button>
        <span style={titleStyle}>{videoTitle || '视频'}</span>
        {layoutError && <span role="alert">{layoutError}</span>}
      </header>

      {/* 左树：所有模式恒显 */}
      {visibility.sideTree && (
        <aside data-testid="study-side-tree" style={sideTreeStyle}>
          <SideTree onNavigateNode={handleNodeNavigate} playPosition={playPosition} />
        </aside>
      )}
      <div ref={separatorRef} style={{ gridColumn: '2', gridRow: '2', display: 'flex' }}>
        <LayoutSeparator label="调整目录树宽度" orientation="vertical" value={leftShare} minimum={0.05} maximum={leftShare + middleShare - 0.05} ready={ready} style={{ width: '100%' }} getExtent={columnExtent}
          onChange={(next) => changeProportions({ ...proportions, columns: [next, leftShare + middleShare - next, rightShare] })} onCommit={saveProportions} />
      </div>

      {/* 中间区：随模式变化 */}
      <section data-testid="study-middle" ref={middleRef} style={{ ...middleStyle, gridTemplateRows: middleRows }}>
        {visibility.catalogBar && (
          <div ref={catalogRef} style={{ ...flexAutoStyle, gridRow: '1', height: 'var(--height-catalog)', minWidth: 0 }}>
            <CatalogBar onSeek={handleSeek} />
          </div>
        )}
        <div data-testid="study-visual-controls" style={{ gridRow: '2', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <div
          data-testid="video-zone-shell"
          aria-hidden={!visibility.videoZone}
          style={visibility.videoZone ? flexFillStyle : hiddenVideoStyle}
        >
          <VideoZone
            filePath={filePath}
            currentSubtitle={currentSubtitle}
            resumePosition={playPosition}
            onProgress={handlePlaybackProgress}
          />
        </div>
        {visibility.diagramZone && (
          <div style={flexFillStyle}><DiagramZone onNavigateNode={handleNodeNavigate} /></div>
        )}
        <footer style={controlBarStyle}><VideoControls /></footer>
        </div>
        {layoutMode !== 'textExpand' && <LayoutSeparator
          label={layoutMode === 'follow' ? '调整视频与文本比例' : '调整导图与预览比例'} orientation="horizontal" value={split} minimum={0.1} maximum={0.9} ready={ready} style={{ gridRow: '3' }}
          getExtent={() => (middleRef.current?.getBoundingClientRect().height ?? 0) - (catalogRef.current?.getBoundingClientRect().height ?? 0) - 4}
          onChange={(next) => changeProportions({ ...proportions, [layoutMode === 'follow' ? 'follow' : 'mapExpand']: next })} onCommit={saveProportions} />}
        {visibility.textZone && (
          <div data-testid="study-text-shell" style={{ ...flexFillStyle, gridRow: layoutMode === 'textExpand' ? '3' : '4' }}>
            <TextZone
              onSeek={handleSeek}
              onExcerpt={handleExcerpt}
              scrollTarget={textScrollTarget}
            />
          </div>
        )}
        {visibility.textPreview && (
          <div data-testid="study-text-shell" style={{ ...flexFillStyle, gridRow: '4' }}>
            <TextPreview selectedNodeId={selectedNodeId} onSeek={handleSeek} />
          </div>
        )}
      </section>
      <LayoutSeparator label="调整助手面板宽度" orientation="vertical" value={rightShare} minimum={0.05} maximum={rightShare + middleShare - 0.05} ready={ready} direction={-1} style={{ gridColumn: '4', gridRow: '2' }} getExtent={columnExtent}
        onChange={(next) => changeProportions({ ...proportions, columns: [leftShare, rightShare + middleShare - next, next] })} onCommit={saveProportions} />

      {/* 右侧面板：Tab 切换 AI / 随记 */}
      {visibility.rightPanel && (
        <aside data-testid="study-right-panel" style={rightPanelStyle}>
          <div style={tabBarStyle}>
            <button
              onClick={() => setAiPanel('ai')}
              style={tabButtonStyle(aiPanelState === 'ai')}
            >
              AI
            </button>
            <button
              onClick={() => setAiPanel('notes')}
              style={tabButtonStyle(aiPanelState === 'notes')}
            >
              随记
            </button>
          </div>
          <div style={tabContentStyle}>
            <div
              hidden={aiPanelState !== 'ai'}
              style={aiPanelState === 'ai' ? activeAiPanelStyle : undefined}
            >
              {quickParagraphType && <div style={quickActionsStyle}><QuickActions paragraphType={quickParagraphType} onAction={(action) => handleSendMessage(action.label, 'paragraph')} /></div>}
              <AiAssistant messages={chatMessages} isStreaming={isStreaming} onStop={handleStopMessage} onSeekSource={handleSeek} />
              <ChatInput ref={aiInputRef} onSend={handleSendMessage} />
            </div>
            <div hidden={aiPanelState !== 'notes'}>
              <NotesPanel
                onCreateNote={handleCreateFreeNote}
                onSaveNote={handleSaveNote}
                onSeekSentence={handleSentenceNavigate}
                focusRef={notesFocusRef}
              />
            </div>
          </div>
        </aside>
      )}

    </div>
  )
}
