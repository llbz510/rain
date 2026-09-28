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
  // 浅底套调色板。边框与次级文字的取值依据 docs/development/visual-contract.md §5.5.2（DEC-VC-02 边界 4「1px 边框一律 ≥3:1」）：
  //   border  #6e7074 对 bg/panel/panel2 = 3.81 / 3.49 / 3.19（原 rgba(255,255,255,.08) 合成后仅 1.21–1.28）
  //   border2 #7c828c 对 bg/panel/panel2 = 4.89 / 4.47 / 4.09（原 rgba(255,255,255,.05) 合成后仅 1.12–1.16）
  //   dimmer  #868f99 对 bg/panel/panel2 = 5.77 / 5.27 / 4.83，且相对亮度 0.2701 仍低于 muted 的 0.2914（第三档不得比第二档更亮）
  // 聚焦圈不在此处声明独立令牌：全应用统一由 src/index.css 的 `:focus-visible { outline: 2px dashed var(--color-fg) }` 提供，
  // 在浅底套底色上该解析值对 bg/panel/panel2 仍 ≥3:1（VC-03④ 的判据是比值，不是某个专属于某一套的色值）。
  bg: '#0d1117',
  panel: '#161b22',
  panel2: '#1c232c',
  fg: '#e6edf3',
  muted: '#8b949e',
  dimmer: '#868f99',
  border: '#6e7074',
  border2: '#7c828c',
  selBg: '#0a0d12',
  selText: 'rgba(230,237,243,.72)',
  concept: '#539bf5',
  example: '#3fb950',
  analogy: '#db6d28',
  fail: '#f85149',
} as const

const TAG_STYLES: Record<string, CSSProperties> = {
  // 细边取**全色同色值**（决策 71「类型色字 + 同色淡底 + 同色细边」）：原来用 alpha .3 的叠色细边，
  // 对浅底三种底色只有 1.48–1.73:1，按 DEC-VC-02 边界 4「1px 边框一律 ≥3:1」不达标（VCGAP-22）。
  // 全色值为 concept 6.07 / analogy 5.13 / example 6.81（对 panel #161b22，见 visual-contract.md §5.5.2）。
  llm: {
    color: COLORS.concept,
    borderColor: COLORS.concept,
    background: 'rgba(83,155,245,.1)',
  },
  'asr-api': {
    color: COLORS.analogy,
    borderColor: COLORS.analogy,
    background: 'rgba(219,109,40,.1)',
  },
  'whisper-local': {
    color: COLORS.example,
    borderColor: COLORS.example,
    background: 'rgba(63,185,80,.1)',
  },
  vision: {
    color: COLORS.example,
    borderColor: COLORS.example,
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
    border: `1px solid ${COLORS.fail}`,
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
    // 主按钮=描边款（决策 65 / VC-03②，VCGAP-21）：底色 = 该套面板色、字 = fg、边框 1px = border 令牌；
    // 原写法是 `rgba(255,255,255,.12)` 实底 + `1px solid transparent`（合成 #32363d，字虽达标 10.27:1，
    // 但不是描边款）。取值见 visual-contract.md §5.5.2：字 panel 14.64:1、边框对 panel 3.49:1。
    border: `1px solid ${COLORS.border}`,
    background: COLORS.panel,
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
