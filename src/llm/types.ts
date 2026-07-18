// src/llm/types.ts
// ========================================
// LLM 类型定义（决策92：前端直连 OpenAI 兼容协议，Rust 不代理）
// ========================================

export interface LlmSettings {
  baseUrl: string        // 供应商 API base URL，如 https://api.openai.com/v1
  apiKey: string         // 明文 API Key（从 setting 表读，决策84）
  model: string          // 模型名，如 gpt-4o
  temperature?: number   // 可选，默认不传
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface StreamCallbacks {
  onToken: (token: string) => void    // 每收到一个 token 回调
  onDone: (fullText: string) => void  // 流结束，返回完整文本
  onError: (error: Error) => void     // 出错回调
  signal?: AbortSignal                 // 取消信号（决策83）
}

export type Stage2Result = import('@/pipeline/stage2-contract').Stage2BlockOutput
