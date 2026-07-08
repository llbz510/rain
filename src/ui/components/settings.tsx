// src/ui/components/settings.tsx
// ========================================
// M19 设置页组件（决策82）
// ========================================

import React from 'react'

interface ModelEntry {
  id: string
  alias: string
  type: string
  supportsVision: boolean
}

interface ModelPoolListProps {
  models: ModelEntry[]
}

export function ModelPoolList({ models }: ModelPoolListProps) {
  return (
    <div data-testid="model-pool-list">
      {models.map((m) => (
        <div key={m.id} data-testid={`model-${m.id}`}>
          <span>{m.alias}</span>
          <span>{m.type}</span>
          {m.supportsVision && <span>vision</span>}
          <button>测试</button>
        </div>
      ))}
    </div>
  )
}

export function AddModelForm() {
  return (
    <div data-testid="add-model-form">
      <label>供应商<input aria-label="供应商 provider" /></label>
      <label>Base URL<input aria-label="Base URL" /></label>
      <label>API Key<input aria-label="API Key 密钥" /></label>
      <label>模型名<input aria-label="模型名" /></label>
      <label>别名<input aria-label="别名" /></label>
      <label><input type="checkbox" />Vision</label>
    </div>
  )
}

interface RoleSelectorProps {
  models?: ModelEntry[]
}

export function RoleSelector({ models = [] }: RoleSelectorProps) {
  const asrModels = models.filter((m) => ['asr-api', 'whisper-local', 'subtitle'].includes(m.type))
  const structuringModels = models.filter((m) => m.type === 'llm')
  const assistantModels = models.filter((m) => m.type === 'llm' && m.supportsVision)

  return (
    <div data-testid="role-selector">
      <label>
        ASR 语音识别
        <select aria-label="ASR 语音识别">
          {asrModels.map((m) => (
            <option key={m.id} value={m.id}>{m.alias}</option>
          ))}
        </select>
      </label>
      <label>
        结构化 LLM
        <select aria-label="结构化 LLM">
          {structuringModels.map((m) => (
            <option key={m.id} value={m.id}>{m.alias}</option>
          ))}
        </select>
      </label>
      <label>
        助手 assistant
        <select aria-label="助手 assistant">
          {assistantModels.map((m) => (
            <option key={m.id} value={m.id}>{m.alias}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

export function SettingsPage() {
  return (
    <div data-testid="settings-page">
      <ModelPoolList models={[]} />
      <AddModelForm />
      <RoleSelector />
    </div>
  )
}
