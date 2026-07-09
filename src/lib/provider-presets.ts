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
  { value: 'tiny', label: 'tiny（39MB，最快最差）' },
  { value: 'base', label: 'base（74MB）' },
  { value: 'small', label: 'small（244MB）' },
  { value: 'medium', label: 'medium（769MB）' },
  { value: 'large-v3', label: 'large-v3（1.5GB，最慢最好）' },
]
