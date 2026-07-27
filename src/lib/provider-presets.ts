// src/lib/provider-presets.ts
// ========================================
// 预置供应商 baseURL 映射（决策82）
// ========================================

export interface ProviderPreset {
  label: string
  value: string
  baseUrl: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { label: '阿里（预置）', value: 'ali', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { label: '腾讯（预置）', value: 'tencent', baseUrl: 'https://api.lkeap.cloud.tencent.com/v1' },
  { label: '讯飞（预置）', value: 'xunfei', baseUrl: 'https://spark-api-open.xf-yun.com/v1' },
  { label: 'OpenAI 兼容（预置）', value: 'openai', baseUrl: 'https://api.openai.com/v1' },
]

export const WHISPER_SIZES = [
  { value: 'tiny', label: 'tiny（约 74 MiB，最快最差）' },
  { value: 'base', label: 'base（约 141 MiB）' },
  { value: 'small', label: 'small（约 465 MiB）' },
  { value: 'medium', label: 'medium（约 1.43 GiB）' },
  { value: 'large-v3', label: 'large-v3（约 2.88 GiB，最慢最好）' },
]
