// src/ui/components/settings.tsx
// ========================================
// M19 设置页组件（决策82）
// 完整实现：模型池列表 / 添加模型表单 / 角色选择 / 设置页
// ========================================

import React, { useState, useEffect } from 'react'
import { useRainStore } from '@/store/rain-store'
import { PROVIDER_PRESETS, WHISPER_SIZES } from '@/lib/provider-presets'
import { isTauri } from '@/lib/tauri-env'
import type { ModelType } from '@/settings/model-pool'
import { getChunkThreshold, setChunkThreshold } from '@/settings/advanced'
import { testQwenConnection, type QwenConnectionResult } from '@/llm/qwen-health'
import type { LlmSettings } from '@/llm/types'

// ── 共享类型 ──────────────────────────────────────

interface ModelEntry {
  id: string
  alias: string
  type: string
  supportsVision: boolean
  canTest?: boolean
}

export interface SavedQwenConnection {
  baseUrl?: string
  modelName: string
  apiKey?: string
}

export type QwenConnectionChecker = (settings: LlmSettings) => Promise<QwenConnectionResult>

export function testSavedQwenConnection(
  model: SavedQwenConnection,
  checker: QwenConnectionChecker = testQwenConnection,
): Promise<QwenConnectionResult> {
  return checker({
    baseUrl: model.baseUrl ?? '',
    model: model.modelName,
    apiKey: model.apiKey ?? '',
  })
}

// ── 样式常量 ──────────────────────────────────────

const COLORS = {
  bg: '#0d1117',
  panel: '#161b22',
  panel2: '#1c232c',
  fg: '#e6edf3',
  muted: '#8b949e',
  dimmer: '#6e7681',
  border: 'rgba(255,255,255,.08)',
  border2: 'rgba(255,255,255,.05)',
  selBg: '#0a0d12',
  selText: 'rgba(230,237,243,.72)',
  concept: '#539bf5',
  example: '#3fb950',
  analogy: '#db6d28',
  fail: '#f85149',
} as const

const TAG_STYLES: Record<string, React.CSSProperties> = {
  llm: {
    color: COLORS.concept,
    borderColor: 'rgba(83,155,245,.3)',
    background: 'rgba(83,155,245,.1)',
  },
  'asr-api': {
    color: COLORS.analogy,
    borderColor: 'rgba(219,109,40,.3)',
    background: 'rgba(219,109,40,.1)',
  },
  'whisper-local': {
    color: COLORS.example,
    borderColor: 'rgba(63,185,80,.3)',
    background: 'rgba(63,185,80,.1)',
  },
  vision: {
    color: COLORS.example,
    borderColor: 'rgba(63,185,80,.3)',
    background: 'rgba(63,185,80,.1)',
  },
}

const TAG_LABELS: Record<string, string> = {
  llm: 'LLM',
  'asr-api': 'ASR-API',
  'whisper-local': '本地 Whisper',
  subtitle: '字幕',
}

// ── 样式工厂 ──────────────────────────────────────

const s = {
  tag: (type: string): React.CSSProperties => ({
    fontSize: 12,
    padding: '1px 8px',
    borderRadius: 4,
    border: '1px solid',
    whiteSpace: 'nowrap',
    ...(TAG_STYLES[type] ?? { color: COLORS.muted, borderColor: COLORS.border }),
  }),
  miniBtn: {
    border: `1px solid ${COLORS.border}`,
    background: 'transparent',
    color: COLORS.muted,
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  dangerBtn: {
    border: '1px solid rgba(248,81,73,.3)',
    background: 'transparent',
    color: COLORS.fail,
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  btn: {
    border: `1px solid ${COLORS.border}`,
    background: 'transparent',
    color: COLORS.fg,
    padding: '4px 12px',
    borderRadius: 8,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  primaryBtn: {
    border: '1px solid transparent',
    background: 'rgba(255,255,255,.12)',
    color: COLORS.fg,
    padding: '4px 12px',
    borderRadius: 8,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as React.CSSProperties,
  input: {
    background: COLORS.bg,
    border: `1px solid ${COLORS.border}`,
    color: COLORS.fg,
    padding: '4px 8px',
    borderRadius: 8,
    fontSize: 13,
    fontFamily: 'inherit',
    minWidth: 220,
    width: '100%',
  } as React.CSSProperties,
  select: {
    background: COLORS.bg,
    border: `1px solid ${COLORS.border}`,
    color: COLORS.fg,
    padding: '4px 8px',
    borderRadius: 8,
    fontSize: 13,
    fontFamily: 'inherit',
    minWidth: 220,
  } as React.CSSProperties,
}

// ══════════════════════════════════════════════════
// ModelPoolList
// ══════════════════════════════════════════════════

export interface ConnectionTestResult {
  ok: boolean
  latencyMs?: number
  message: string
}

interface ModelPoolListProps {
  models: ModelEntry[]
  onTestConnection?: (modelId: string) => Promise<ConnectionTestResult>
}

export function ModelPoolList({ models, onTestConnection }: ModelPoolListProps) {
  const removeModel = useRainStore((s) => s.removeModel)
  const [connectionStatus, setConnectionStatus] = useState<{ modelId: string; message: string } | null>(null)
  const [testingModelId, setTestingModelId] = useState<string | null>(null)

  const handleTestConnection = async (model: ModelEntry) => {
    if (!onTestConnection || testingModelId) return
    setTestingModelId(model.id)
    setConnectionStatus(null)
    try {
      const result = await onTestConnection(model.id)
      setConnectionStatus({ modelId: model.id, message: result.message })
    } catch {
      setConnectionStatus({ modelId: model.id, message: '连接测试失败，请检查 Qwen 配置。' })
    } finally {
      setTestingModelId(null)
    }
  }

  return (
    <div data-testid="model-pool-list">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 150px 1fr 150px',
          gap: 8,
          padding: '0 8px 4px',
          fontSize: 12,
          color: COLORS.dimmer,
          borderBottom: `1px solid ${COLORS.border2}`,
        }}
      >
        <div>别名</div>
        <div>类型</div>
        <div>供应商 · 模型名</div>
        <div style={{ textAlign: 'right' }}>操作</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {models.map((m) => (
          <div
            key={m.id}
            data-testid={`model-${m.id}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 150px 1fr 150px',
              gap: 8,
              alignItems: 'center',
              padding: 8,
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 600 }}>{m.alias}</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <span style={s.tag(m.type)}>{TAG_LABELS[m.type] ?? m.type}</span>
              {m.supportsVision && <span style={s.tag('vision')}>vision</span>}
            </div>
            <div style={{ color: COLORS.muted, fontSize: 12 }}>{m.type}</div>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              {onTestConnection && m.canTest && (
                <button aria-label={`测试 ${m.alias}`} disabled={testingModelId !== null} onClick={() => void handleTestConnection(m)} style={s.miniBtn}>
                  {testingModelId === m.id ? '测试中…' : `测试 ${m.alias}`}
                </button>
              )}
              {!m.canTest && <button aria-label="测试（仅 Qwen）" disabled style={s.miniBtn}>测试（仅 Qwen）</button>}              <button style={s.dangerBtn} onClick={() => removeModel(m.id)}>删除</button>
            </div>
            {connectionStatus?.modelId === m.id && (
              <div role="status" style={{ gridColumn: '1 / -1', color: connectionStatus.message.includes('成功') ? COLORS.example : COLORS.fail }}>
                {connectionStatus.message}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
// AddModelForm
// ══════════════════════════════════════════════════

export function AddModelForm({ onClose, onSave }: { onClose?: () => void; onSave?: () => void }) {
  const addModel = useRainStore((s) => s.addModel)

  const [modelType, setModelType] = useState<'llm' | 'asr-api' | 'whisper-local'>('llm')
  const [provider, setProvider] = useState('ali')
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS[0].baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [modelName, setModelName] = useState('')
  const [alias, setAlias] = useState('')
  const [supportsVision, setSupportsVision] = useState(false)
  const [whisperSize, setWhisperSize] = useState('medium')
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle')
  const [downloadError, setDownloadError] = useState('')

  const isApiType = modelType === 'llm' || modelType === 'asr-api'
  const isWhisper = modelType === 'whisper-local'

  function handleProviderChange(value: string) {
    setProvider(value)
    if (value !== 'custom') {
      const preset = PROVIDER_PRESETS.find((p) => p.value === value)
      if (preset) setBaseUrl(preset.baseUrl)
    } else {
      setBaseUrl('')
    }
  }

  async function handleDownload() {
    setDownloadStatus('downloading')
    setDownloadError('')
    try {
      const { tauriInvoke } = await import('@/lib/tauri-env')
      await tauriInvoke<string>('download_whisper_model', {
        modelSize: whisperSize,
      })
      setDownloadStatus('done')
    } catch (err) {
      setDownloadStatus('error')
      setDownloadError(String(err))
    }
  }

  function handleSave() {    const type = modelType as ModelType
    const finalModelName = isWhisper ? whisperSize : modelName
    const finalProvider = isWhisper ? 'local' : provider
    const finalBaseUrl = isApiType ? (provider === 'custom' ? baseUrl : PROVIDER_PRESETS.find((p) => p.value === provider)?.baseUrl) : undefined

    addModel({
      type,
      provider: finalProvider,
      baseUrl: finalBaseUrl,
      apiKey: isApiType ? apiKey : undefined,
      modelName: finalModelName,
      alias: alias || finalModelName,
      supportsVision: modelType === 'llm' ? supportsVision : false,
    })

    onSave?.()
    onClose?.()
  }

  return (
    <div data-testid="add-model-form">
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* 类型选择 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: COLORS.muted }}>类型</label>
          <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" name="mtype" value="llm" checked={modelType === 'llm'} onChange={() => setModelType('llm')} />
              LLM
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" name="mtype" value="asr-api" checked={modelType === 'asr-api'} onChange={() => setModelType('asr-api')} />
              ASR-API
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input type="radio" name="mtype" value="whisper-local" checked={modelType === 'whisper-local'} onChange={() => setModelType('whisper-local')} />
              本地 Whisper
            </label>
          </div>
        </div>

        {/* 供应商 — 始终显示 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: COLORS.muted }}>供应商</label>
          {isApiType ? (
            <select
              aria-label="供应商 provider"
              style={s.select}
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
            >
              {PROVIDER_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
              <option value="custom">自定义…</option>
            </select>
          ) : (
            <input
              aria-label="供应商 provider"
              style={s.input}
              value="local"
              readOnly
            />
          )}
        </div>

        {/* Base URL — 仅自定义供应商时显示 */}
        {isApiType && provider === 'custom' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: COLORS.muted }}>Base URL</label>
            <input
              aria-label="Base URL"
              type="text"
              style={s.input}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
        )}

        {/* API Key — 仅 API 类型 */}
        {isApiType && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: COLORS.muted }}>API Key</label>
            <input
              aria-label="API Key 密钥"
              type="password"
              style={s.input}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>
        )}

        {/* 模型名 — 仅 API 类型 */}
        {isApiType && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: COLORS.muted }}>模型名</label>
            <input
              aria-label="模型名"
              type="text"
              style={s.input}
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
          </div>
        )}

        {/* Whisper 模型大小 — 仅本地 Whisper */}
        {isWhisper && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: COLORS.muted }}>模型大小</label>
            <select
              style={s.select}
              value={whisperSize}
              onChange={(e) => setWhisperSize(e.target.value)}
            >
              {WHISPER_SIZES.map((ws) => (
                <option key={ws.value} value={ws.value}>
                  {ws.label}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 12, color: COLORS.dimmer, marginTop: 4 }}>
              首次使用触发下载，显示进度
            </div>
            <button
              style={s.btn}
              disabled={!isTauri() || downloadStatus === 'downloading'}
              onClick={isTauri() ? handleDownload : undefined}
            >
              {downloadStatus === 'downloading' ? '下载中…' : downloadStatus === 'done' ? '✓ 已下载' : '下载模型'}
            </button>
            {downloadStatus === 'error' && (
              <div style={{ fontSize: 12, color: COLORS.fail, marginTop: 4 }}>
                下载失败：{downloadError}
              </div>
            )}
            {downloadStatus === 'done' && (
              <div style={{ fontSize: 12, color: COLORS.example, marginTop: 4 }}>
                模型已下载，可保存添加到模型池
              </div>
            )}
          </div>
        )}

        {/* 别名 — 始终显示 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: COLORS.muted }}>别名（在池里显示的名字）</label>
          <input
            aria-label="别名"
            type="text"
            style={s.input}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
          />
        </div>

        {/* Vision 勾选 — 仅 LLM */}
        {modelType === 'llm' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={supportsVision}
              onChange={(e) => setSupportsVision(e.target.checked)}
            />
            支持画面（vision）—— 助手 LLM 角色只列勾选此项的
          </label>
        )}
      </div>

      {/* 底部按钮 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          borderTop: `1px solid ${COLORS.border}`,
        }}
      >
        <button style={s.miniBtn}>测试</button>
        <div style={{ flex: 1 }} />
        {onClose && (
          <button style={s.btn} onClick={onClose}>
            取消
          </button>
        )}
        <button style={s.primaryBtn} onClick={handleSave}>
          保存
        </button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// RoleSelector
// ══════════════════════════════════════════════════

interface RoleSelectorProps {
  models?: ModelEntry[]
}

export function RoleSelector({ models = [] }: RoleSelectorProps) {
  const setRoleModel = useRainStore((s) => s.setRoleModel)
  const roleAssignment = useRainStore((s) => s.roleAssignment)

  const asrModels = models.filter((m) => ['asr-api', 'whisper-local', 'subtitle'].includes(m.type))
  const structuringModels = models.filter((m) => m.type === 'llm')
  const assistantModels = models.filter((m) => m.type === 'llm' && m.supportsVision)

  const roleRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 0',
    borderBottom: `1px solid ${COLORS.border2}`,
  }

  const roleLabelStyle: React.CSSProperties = {
    fontSize: 13,
    width: 110,
    flexShrink: 0,
  }

  const roleDescStyle: React.CSSProperties = {
    fontSize: 12,
    color: COLORS.dimmer,
    marginLeft: 'auto',
  }

  const subStyle: React.CSSProperties = {
    fontSize: 12,
    color: COLORS.dimmer,
    fontWeight: 400,
  }

  return (
    <div data-testid="role-selector">
      {/* ASR 语音转文字 */}
      <div style={roleRowStyle}>
        <div style={roleLabelStyle}>
          ASR
          <div style={subStyle}>语音转文字</div>
        </div>
        <select
          aria-label="ASR 语音识别"
          style={s.select}
          value={roleAssignment.asr ?? ''}
          onChange={(e) => setRoleModel('asr', e.target.value || null)}
        >
          <option value="">用视频字幕（无需模型）</option>
          {asrModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.alias}
            </option>
          ))}
        </select>
        <div style={roleDescStyle}>三档：字幕 / API / 本地</div>
      </div>

      {/* 结构化 LLM */}
      <div style={roleRowStyle}>
        <div style={roleLabelStyle}>
          结构化 LLM
          <div style={subStyle}>文本结构化</div>
        </div>
        <select
          aria-label="结构化 LLM"
          style={s.select}
          value={roleAssignment.structuring ?? ''}
          onChange={(e) => setRoleModel('structuring', e.target.value || null)}
        >
          <option value="">未选择</option>
          {structuringModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.alias}
            </option>
          ))}
        </select>
        <div style={roleDescStyle}>纯文本，需大输出</div>
      </div>

      {/* 助手 assistant */}
      <div style={{ ...roleRowStyle, borderBottom: 'none' }}>
        <div style={roleLabelStyle}>
          助手 LLM
          <div style={subStyle}>AI 助手问答</div>
        </div>
        <select
          aria-label="助手 assistant"
          style={s.select}
          value={roleAssignment.assistant ?? ''}
          onChange={(e) => setRoleModel('assistant', e.target.value || null)}
        >
          <option value="">未选择</option>
          {assistantModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.alias}
            </option>
          ))}
        </select>
        <div style={roleDescStyle}>必须 vision（只列勾了 vision 的）</div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// SettingsPage
// ══════════════════════════════════════════════════

const NAV_ITEMS = ['模型管理', '外观', '高级', '关于'] as const

export function SettingsPage() {
  const modelPool = useRainStore((s) => s.modelPool)
  const setPage = useRainStore((s) => s.setPage)
  const [modalOpen, setModalOpen] = useState(false)
  const [activeNav, setActiveNav] = useState<string>('模型管理')
  const [chunkThreshold, setChunkThresholdState] = useState<number>(getChunkThreshold)

  useEffect(() => {
    void (async () => {
      try {
        const { isTauri } = await import('@/lib/tauri-env')
        if (!isTauri()) return
        const { createDatabase, getSetting } = await import('@/models/database')
        const { addModelToPool, listModels } = await import('@/settings/model-pool')
        const db = await createDatabase('rain.db')

        const poolJson = await getSetting(db, 'model_pool')
        if (poolJson) {
          const entries = JSON.parse(poolJson)
          const currentPool = listModels()
          for (const entry of entries) {
            if (!currentPool.find((m: any) => m.id === entry.id)) {
              try { addModelToPool(entry) } catch { /* skip duplicates */ }
            }
          }
          useRainStore.setState({ modelPool: listModels() })
        }

        const asr = await getSetting(db, 'role_asr')
        const structuring = await getSetting(db, 'role_structuring')
        const assistant = await getSetting(db, 'role_assistant')
        useRainStore.setState({
          roleAssignment: {
            asr: asr || null,
            structuring: structuring || null,
            assistant: assistant || null,
          },
        })
      } catch { /* browser — ignore */ }
    })()
  }, [])

  const models: ModelEntry[] = modelPool.map((m) => ({
    id: m.id,
    alias: m.alias,
    type: m.type,
    supportsVision: m.supportsVision,
    canTest: m.type === 'llm' && m.baseUrl === 'https://dashscope.aliyuncs.com/compatible-mode/v1' && m.modelName === 'qwen3.5-omni-flash',
  }))

  const handleTestConnection = async (modelId: string): Promise<ConnectionTestResult> => {
    const model = modelPool.find((entry) => entry.id === modelId)
    if (!model) return { ok: false, message: '未找到已保存的 Qwen 配置。' }
    return testSavedQwenConnection(model)
  }

  return (
    <div
      data-testid="settings-page"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: COLORS.bg,
        color: COLORS.fg,
      }}
    >
      {/* ── Topbar ── */}
      <div
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 12px',
          borderBottom: `1px solid ${COLORS.border}`,
          background: COLORS.panel,
          flexShrink: 0,
        }}
      >
        <button style={s.btn} onClick={() => setPage('list')}>
          ← 返回
        </button>
        <span style={{ fontSize: 16, fontWeight: 600 }}>Rain</span>
        <span style={{ color: COLORS.muted, fontSize: 12 }}>/ 设置 · 模型管理</span>
        <div style={{ flex: 1 }} />
      </div>

      {/* ── Body: sidebar + main ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '180px 1fr', minHeight: 0 }}>
        {/* Sidebar */}
        <div
          style={{
            borderRight: `1px solid ${COLORS.border}`,
            background: COLORS.panel,
            padding: '12px 8px',
            overflow: 'auto',
          }}
        >
          {NAV_ITEMS.map((item) => (
            <div
              key={item}
              onClick={() => setActiveNav(item)}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                fontSize: 13,
                color: item === activeNav ? COLORS.selText : COLORS.muted,
                background: item === activeNav ? COLORS.selBg : 'transparent',
                cursor: 'pointer',
                marginBottom: 2,
              }}
            >
              {item}
            </div>
          ))}
        </div>

        {/* Main content */}
        <main style={{ overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {activeNav === '模型管理' && (
            <>
              {/* 角色选择卡片 */}
              <section
                style={{
                  background: COLORS.panel,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  padding: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>角色选择</div>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: COLORS.dimmer }}>
                    每个角色从下方"模型池"里选一个当前使用
                  </span>
                </div>
                <RoleSelector models={models} />
              </section>

              {/* 模型池卡片 */}
              <section
                style={{
                  background: COLORS.panel,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  padding: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>模型池</div>
                  <div style={{ flex: 1 }} />
                  <button style={s.primaryBtn} onClick={() => setModalOpen(true)}>
                    ＋ 添加模型
                  </button>
                </div>
                <ModelPoolList models={models} onTestConnection={handleTestConnection} />
              </section>
            </>
          )}

          {activeNav === '外观' && (
            <section
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 200,
              }}
            >
              <div style={{ textAlign: 'center', color: COLORS.dimmer }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🎨</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.muted, marginBottom: 6 }}>外观设置</div>
                <div style={{ fontSize: 12 }}>敬请期待</div>
              </div>
            </section>
          )}

          {activeNav === '高级' && (
            <section
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>高级设置</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ fontSize: 13, flex: 1 }}>
                    分块阈值
                    <span style={{ fontSize: 12, color: COLORS.dimmer, marginLeft: 6 }}>
                      （长视频上下文占比触发分块，默认 33%）
                    </span>
                  </label>
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 40, textAlign: 'right' }}>
                    {Math.round(chunkThreshold * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={80}
                  step={1}
                  value={Math.round(chunkThreshold * 100)}
                  onChange={(e) => {
                    const val = Number(e.target.value) / 100
                    setChunkThresholdState(val)
                    setChunkThreshold(val)
                  }}
                  style={{ width: '100%', accentColor: COLORS.concept }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: COLORS.dimmer }}>
                  <span>10%（频繁分块）</span>
                  <span>80%（少分块）</span>
                </div>
              </div>
            </section>
          )}

          {activeNav === '关于' && (
            <section
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: 32,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                minHeight: 200,
              }}
            >
              <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 2 }}>Rain</div>
              <div style={{ fontSize: 13, color: COLORS.muted }}>版本 0.1.0</div>
              <div style={{ fontSize: 12, color: COLORS.dimmer, marginTop: 8, textAlign: 'center', lineHeight: 1.6 }}>
                个人学习视频精读工具
              </div>
            </section>
          )}
        </main>
      </div>

      {/* ── Modal overlay ── */}
      {modalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 80,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false)
          }}
        >
          <div
            style={{
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              width: 520,
              maxWidth: '92vw',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: '0 4px 16px rgba(0,0,0,.4)',
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                padding: '12px 16px',
                borderBottom: `1px solid ${COLORS.border}`,
              }}
            >
              添加模型
            </div>
            <AddModelForm
              onClose={() => setModalOpen(false)}
              onSave={() => setModalOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}