import { useState } from 'react'
import { useRainStore } from '@/store/rain-store'
import { COLORS, s, TAG_LABELS, type ModelEntry } from './shared'

export interface ConnectionTestResult {
  ok: boolean
  latencyMs?: number
  message: string
}

interface ModelPoolListProps {
  models: ModelEntry[]
  onTestConnection?: (modelId: string) => Promise<ConnectionTestResult>
  onCheckStructuring?: (modelId: string) => Promise<ConnectionTestResult>
}

export function ModelPoolList({ models, onTestConnection, onCheckStructuring }: ModelPoolListProps) {
  const removeModel = useRainStore((state) => state.removeModel)
  const [connectionStatus, setConnectionStatus] = useState<{
    modelId: string
    ok: boolean
    message: string
  } | null>(null)
  const [testingModelId, setTestingModelId] = useState<string | null>(null)

  const handleTestConnection = async (model: ModelEntry) => {
    if (!onTestConnection || testingModelId) return
    setTestingModelId(model.id)
    setConnectionStatus(null)
    try {
      const result = await onTestConnection(model.id)
      setConnectionStatus({ modelId: model.id, ok: result.ok, message: result.message })
    } catch {
      setConnectionStatus({ modelId: model.id, ok: false, message: '连接测试失败，请检查模型配置。' })
    } finally {
      setTestingModelId(null)
    }
  }

  const handleStructuringCheck = async (model: ModelEntry) => {
    if (!onCheckStructuring || testingModelId) return
    setTestingModelId(model.id)
    setConnectionStatus(null)
    try {
      const result = await onCheckStructuring(model.id)
      setConnectionStatus({ modelId: model.id, ok: result.ok, message: result.message })
    } catch {
      setConnectionStatus({ modelId: model.id, ok: false, message: '结构化能力检查失败，请检查模型配置。' })
    } finally {
      setTestingModelId(null)
    }
  }

  return (
    <div data-testid="model-pool-list">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 150px 1fr 260px',
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
        {models.map((model) => (
          <div
            key={model.id}
            data-testid={`model-${model.id}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 150px 1fr 260px',
              gap: 8,
              alignItems: 'center',
              padding: 8,
              borderRadius: 8,
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 600 }}>{model.alias}</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <span style={s.tag(model.type)}>{TAG_LABELS[model.type] ?? model.type}</span>
              {model.supportsVision && <span style={s.tag('vision')}>vision</span>}
            </div>
            <div style={{ color: COLORS.muted, fontSize: 12 }}>{model.type}</div>
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
              {onTestConnection && model.canTest && (
                <button
                  aria-label={`测试 ${model.alias}`}
                  disabled={testingModelId !== null}
                  onClick={() => void handleTestConnection(model)}
                  style={s.miniBtn}
                >
                  {testingModelId === model.id ? '测试中…' : `测试 ${model.alias}`}
                </button>
              )}
              {!model.canTest && !onCheckStructuring && (
                <button aria-label="测试（仅 Qwen）" disabled style={s.miniBtn}>测试（仅 Qwen）</button>
              )}
              {onCheckStructuring && model.type === 'llm' && (
                <button
                  aria-label={`检查结构化 ${model.alias}`}
                  disabled={testingModelId !== null}
                  onClick={() => void handleStructuringCheck(model)}
                  style={s.miniBtn}
                >
                  {testingModelId === model.id ? '检查中…' : '检查结构化'}
                </button>
              )}
              <button style={s.dangerBtn} onClick={() => removeModel(model.id)}>删除</button>
            </div>
            {connectionStatus?.modelId === model.id && (
              <div
                role="status"
                style={{
                  gridColumn: '1 / -1',
                  color: connectionStatus.ok ? COLORS.example : COLORS.fail,
                }}
              >
                {connectionStatus.message}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
