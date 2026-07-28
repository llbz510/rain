import { useState, type CSSProperties } from 'react'
import {
  decideModelRoleAssignment,
} from '@/settings/model-capabilities'
import {
  runtimeModelFromPoolEntry,
  type ModelRole,
} from '@/settings/model-pool'
import { useRainStore } from '@/store/rain-store'
import { COLORS, s, type ModelEntry } from './shared'

interface RoleSelectorProps {
  models?: ModelEntry[]
}

export function RoleSelector({ models = [] }: RoleSelectorProps) {
  const setRoleModel = useRainStore((state) => state.setRoleModel)
  const roleAssignment = useRainStore((state) => state.roleAssignment)
  const modelPool = useRainStore((state) => state.modelPool)
  const capabilityRecords = useRainStore((state) => state.capabilityRecords)
  const [assignmentError, setAssignmentError] = useState('')
  const [assignmentPending, setAssignmentPending] = useState(false)

  const asrModels = models.filter((model) =>
    ['asr-api', 'whisper-local', 'subtitle'].includes(model.type))
  const structuringModels = models.filter((model) => model.type === 'llm')
  const assistantModels = models.filter((model) => model.type === 'llm')

  function canAssign(modelId: string, role: ModelRole): boolean {
    const model = modelPool.find((entry) => entry.id === modelId)
    if (!model) return false
    return decideModelRoleAssignment(
      runtimeModelFromPoolEntry(model),
      role,
      capabilityRecords,
    ).allowed
  }

  function roleStatus(role: ModelRole, fallback: string): string {
    const modelId = roleAssignment[role]
    if (!modelId) return fallback
    const model = modelPool.find((entry) => entry.id === modelId)
    if (!model) return 'Unavailable · 对应模型已不存在。'
    const decision = decideModelRoleAssignment(
      runtimeModelFromPoolEntry(model),
      role,
      capabilityRecords,
    )
    return `${decision.capability.status} · ${decision.capability.message}`
  }

  async function assign(role: ModelRole, modelId: string | null) {
    setAssignmentPending(true)
    const result = await setRoleModel(role, modelId)
    setAssignmentError(result.ok ? '' : result.error)
    setAssignmentPending(false)
  }

  const roleRowStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 0',
    borderBottom: `1px solid ${COLORS.border2}`,
  }

  const roleLabelStyle: CSSProperties = {
    fontSize: 13,
    width: 110,
    flexShrink: 0,
  }

  const roleDescStyle: CSSProperties = {
    fontSize: 12,
    color: COLORS.dimmer,
    marginLeft: 'auto',
    maxWidth: 360,
    textAlign: 'right',
    lineHeight: 1.4,
  }

  const subStyle: CSSProperties = {
    fontSize: 12,
    color: COLORS.dimmer,
    fontWeight: 400,
  }

  return (
    <div data-testid="role-selector">
      <div style={roleRowStyle}>
        <div style={roleLabelStyle}>
          ASR
          <div style={subStyle}>语音转文字</div>
        </div>
        <select
          aria-label="ASR 语音识别"
          style={s.select}
          disabled={assignmentPending}
          value={roleAssignment.asr ?? ''}
          onChange={(event) => void assign('asr', event.target.value || null)}
        >
          <option value="">用视频字幕（无需模型）</option>
          {asrModels.map((model) => (
            <option key={model.id} value={model.id} disabled={!canAssign(model.id, 'asr')}>
              {model.alias}
            </option>
          ))}
        </select>
        <div style={roleDescStyle}>{roleStatus('asr', '三档：字幕 / API / 本地')}</div>
      </div>

      <div style={roleRowStyle}>
        <div style={roleLabelStyle}>
          结构化 LLM
          <div style={subStyle}>文本结构化</div>
        </div>
        <select
          aria-label="结构化 LLM"
          style={s.select}
          disabled={assignmentPending}
          value={roleAssignment.structuring ?? ''}
          onChange={(event) => void assign('structuring', event.target.value || null)}
        >
          <option value="">未选择</option>
          {structuringModels.map((model) => (
            <option
              key={model.id}
              value={model.id}
              disabled={!canAssign(model.id, 'structuring')}
            >
              {model.alias}
            </option>
          ))}
        </select>
        <div style={roleDescStyle}>{roleStatus('structuring', '纯文本，需大输出')}</div>
      </div>

      <div style={{ ...roleRowStyle, borderBottom: 'none' }}>
        <div style={roleLabelStyle}>
          助手 LLM
          <div style={subStyle}>AI 助手问答</div>
        </div>
        <select
          aria-label="助手 assistant"
          style={s.select}
          disabled={assignmentPending}
          value={roleAssignment.assistant ?? ''}
          onChange={(event) => void assign('assistant', event.target.value || null)}
        >
          <option value="">未选择</option>
          {assistantModels.map((model) => (
            <option key={model.id} value={model.id} disabled={!canAssign(model.id, 'assistant')}>
              {model.alias}
            </option>
          ))}
        </select>
        <div style={roleDescStyle}>{roleStatus('assistant', '文本问答；画面能力单独校验')}</div>
      </div>
      {assignmentError && (
        <div role="alert" style={{ color: COLORS.fail, fontSize: 12, paddingTop: 8 }}>
          {assignmentError}
        </div>
      )}
    </div>
  )
}
