import { useEffect, useState } from 'react'
import { getChunkThreshold, setChunkThreshold } from '@/settings/advanced'
import { checkAsrModelCapability } from '@/settings/asr-capability'
import { runtimeModelFromPoolEntry, type RuntimeSettings } from '@/settings/model-pool'
import { checkStructuringModelCapability } from '@/settings/structuring-capability'
import { useRainStore } from '@/store/rain-store'
import { AddModelForm } from './add-model-form'
import { ModelPoolList, type ConnectionTestResult } from './model-pool-list'
import { PreflightPanel } from './preflight-panel'
import { RoleSelector } from './role-selector'
import { COLORS, s, testSavedQwenConnection, type ModelEntry } from './shared'

const NAV_ITEMS = ['模型管理', '外观', '高级', '关于'] as const

export function SettingsPage() {
  const modelPool = useRainStore((state) => state.modelPool)
  const roleAssignment = useRainStore((state) => state.roleAssignment)
  const capabilityRecords = useRainStore((state) => state.capabilityRecords)
  const setCapabilityRecords = useRainStore((state) => state.setCapabilityRecords)
  const setPage = useRainStore((state) => state.setPage)
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
            if (!currentPool.find((model) => model.id === entry.id)) {
              try {
                addModelToPool(entry)
              } catch {
                // Skip duplicate persisted models.
              }
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
      } catch {
        // Browser mode does not hydrate the desktop database.
      }
    })()
  }, [])

  const models: ModelEntry[] = modelPool.map((model) => ({
    id: model.id,
    alias: model.alias,
    type: model.type,
    supportsVision: model.supportsVision,
    canTest: model.type === 'llm'
      && model.baseUrl === 'https://dashscope.aliyuncs.com/compatible-mode/v1'
      && model.modelName === 'qwen3.5-omni-flash',
  }))

  const runtimeSettings: RuntimeSettings = {
    models: modelPool.map((model) => ({
      id: model.id,
      alias: model.alias,
      baseUrl: model.baseUrl,
      model: model.modelName,
      apiKey: model.apiKey,
      type: model.type,
      provider: model.provider,
      supportsVision: model.supportsVision,
    })),
    roles: { ...roleAssignment },
    capabilities: capabilityRecords,
  }

  const handleTestConnection = async (modelId: string): Promise<ConnectionTestResult> => {
    const model = modelPool.find((entry) => entry.id === modelId)
    if (!model) return { ok: false, message: '未找到已保存的 Qwen 配置。' }
    return testSavedQwenConnection(model)
  }

  const handleStructuringCheck = async (modelId: string): Promise<ConnectionTestResult> => {
    const model = modelPool.find((entry) => entry.id === modelId)
    if (!model) return { ok: false, message: '未找到已保存的模型配置。' }
    const record = await checkStructuringModelCapability(runtimeModelFromPoolEntry(model))
    await setCapabilityRecords([record])
    return {
      ok: record.status === 'Compatible' || record.status === 'Verified',
      message: record.message,
    }
  }

  const handleAsrCheck = async (modelId: string): Promise<ConnectionTestResult> => {
    const model = modelPool.find((entry) => entry.id === modelId)
    if (!model) return { ok: false, message: '未找到已保存的 ASR 模型配置。' }
    const record = await checkAsrModelCapability(runtimeModelFromPoolEntry(model))
    await setCapabilityRecords([record])
    return {
      ok: record.status === 'Compatible' || record.status === 'Verified',
      message: record.message,
    }
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

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '180px 1fr', minHeight: 0 }}>
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

        <main style={{ overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {activeNav === '模型管理' && (
            <>
              <PreflightPanel
                runtimeSettings={runtimeSettings}
                onCapabilityRecords={setCapabilityRecords}
              />

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
                <ModelPoolList
                  models={models}
                  onTestConnection={handleTestConnection}
                  onCheckAsr={handleAsrCheck}
                  onCheckStructuring={handleStructuringCheck}
                />
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
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.muted, marginBottom: 6 }}>
                  外观设置
                </div>
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
                  onChange={(event) => {
                    const value = Number(event.target.value) / 100
                    setChunkThresholdState(value)
                    setChunkThreshold(value)
                  }}
                  style={{ width: '100%', accentColor: COLORS.concept }}
                />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 11,
                    color: COLORS.dimmer,
                  }}
                >
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
              <div
                style={{
                  fontSize: 12,
                  color: COLORS.dimmer,
                  marginTop: 8,
                  textAlign: 'center',
                  lineHeight: 1.6,
                }}
              >
                个人学习视频精读工具
              </div>
            </section>
          )}
        </main>
      </div>

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
          onClick={(event) => {
            if (event.target === event.currentTarget) setModalOpen(false)
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
