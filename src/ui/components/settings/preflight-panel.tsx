import { useState } from 'react'
import type { RuntimeSettings } from '@/settings/model-pool'
import {
  runPreflightCheck,
  type PreflightReport,
  type PreflightStatus,
  type RunPreflightCheckInput,
} from '@/settings/preflight'
import {
  assessModelCapability,
  type ModelCapabilityRecord,
  type ModelCapabilityStatus,
} from '@/settings/model-capabilities'
import { COLORS, s } from './shared'

type PreflightRunner = (input: RunPreflightCheckInput) => Promise<PreflightReport>

interface PreflightPanelProps {
  runtimeSettings: RuntimeSettings
  runCheck?: PreflightRunner
  onCapabilityRecords?: (records: ModelCapabilityRecord[]) => void | Promise<void>
}

const STATUS_LABELS: Record<PreflightStatus, string> = {
  ok: '通过',
  warning: '提醒',
  error: '需要处理',
  skipped: '跳过',
}

const STATUS_COLORS: Record<PreflightStatus, string> = {
  ok: COLORS.example,
  warning: COLORS.analogy,
  error: COLORS.fail,
  skipped: COLORS.dimmer,
}

const CAPABILITY_COLORS: Record<ModelCapabilityStatus, string> = {
  Compatible: COLORS.example,
  Verified: COLORS.concept,
  Unavailable: COLORS.fail,
}

const ROLE_LABELS = {
  asr: 'ASR',
  structuring: '结构化',
  assistant: '助手',
} as const

export function PreflightPanel({
  runtimeSettings,
  runCheck = runPreflightCheck,
  onCapabilityRecords,
}: PreflightPanelProps) {
  const [report, setReport] = useState<PreflightReport | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const visibleCapabilities = report?.capabilities ?? (runtimeSettings.capabilities ?? []).map((record) => {
    const model = runtimeSettings.models.find((candidate) => candidate.id === record.modelId)
    if (!model) {
      return {
        ...record,
        status: 'Unavailable' as const,
        message: '对应模型已不存在。',
      }
    }
    return assessModelCapability(model, record.role, runtimeSettings.capabilities ?? [])
  })

  async function handleRun() {
    setRunning(true)
    setError('')
    try {
      const nextReport = await runCheck({ runtimeSettings })
      await onCapabilityRecords?.(nextReport.capabilities)
      setReport(nextReport)
    } catch (err) {
      setReport(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>运行前自检</div>
        <span style={{ color: COLORS.dimmer, fontSize: 12 }}>
          检查桌面环境、Whisper、结构化模型、数据库和在线视频工具；会发送一次很小的 Stage2 契约请求
        </span>
        <div style={{ flex: 1 }} />
        <button style={s.primaryBtn} disabled={running} onClick={() => void handleRun()}>
          {running ? '自检中…' : '运行自检'}
        </button>
      </div>

      {error && <div role="alert" style={{ color: COLORS.fail, fontSize: 12 }}>{error}</div>}
      {report && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            role="status"
            style={{
              color: report.ready ? COLORS.example : COLORS.fail,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {report.ready ? '可以处理本地视频' : '暂时不能可靠处理本地视频'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {report.checks.map((check) => (
              <div
                key={check.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 72px 1fr',
                  gap: 8,
                  alignItems: 'start',
                  fontSize: 12,
                  color: COLORS.muted,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: COLORS.panel2,
                }}
              >
                <div style={{ color: COLORS.fg }}>{check.label}</div>
                <div style={{ color: STATUS_COLORS[check.status] }}>{STATUS_LABELS[check.status]}</div>
                <div>{check.message}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {visibleCapabilities.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: report ? 0 : 8 }}>
          {visibleCapabilities.map((capability) => (
            <div
              key={`${capability.modelId}:${capability.role}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 90px 1fr',
                gap: 8,
                fontSize: 12,
                padding: '6px 8px',
                borderRadius: 6,
                background: COLORS.panel2,
              }}
            >
              <div>{ROLE_LABELS[capability.role]} · {capability.modelAlias}</div>
              <div style={{ color: CAPABILITY_COLORS[capability.status] }}>{capability.status}</div>
              <div style={{ color: COLORS.muted }}>{capability.message}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
