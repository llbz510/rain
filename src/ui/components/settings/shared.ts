import type { CSSProperties } from 'react'
import { testQwenConnection, type QwenConnectionResult } from '@/llm/qwen-health'
import type { LlmSettings } from '@/llm/types'

export interface ModelEntry {
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

export const COLORS = {
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

const TAG_STYLES: Record<string, CSSProperties> = {
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

export const TAG_LABELS: Record<string, string> = {
  llm: 'LLM',
  'asr-api': 'ASR-API',
  'whisper-local': '本地 Whisper',
  subtitle: '字幕',
}

export const s = {
  tag: (type: string): CSSProperties => ({
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
  } as CSSProperties,
  dangerBtn: {
    border: '1px solid rgba(248,81,73,.3)',
    background: 'transparent',
    color: COLORS.fail,
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as CSSProperties,
  btn: {
    border: `1px solid ${COLORS.border}`,
    background: 'transparent',
    color: COLORS.fg,
    padding: '4px 12px',
    borderRadius: 8,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as CSSProperties,
  primaryBtn: {
    border: '1px solid transparent',
    background: 'rgba(255,255,255,.12)',
    color: COLORS.fg,
    padding: '4px 12px',
    borderRadius: 8,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  } as CSSProperties,
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
  } as CSSProperties,
  select: {
    background: COLORS.bg,
    border: `1px solid ${COLORS.border}`,
    color: COLORS.fg,
    padding: '4px 8px',
    borderRadius: 8,
    fontSize: 13,
    fontFamily: 'inherit',
    minWidth: 220,
  } as CSSProperties,
}
