import { useEffect, useRef, useState } from 'react'
import { PROVIDER_PRESETS, WHISPER_SIZES } from '@/lib/provider-presets'
import { isTauri } from '@/lib/tauri-env'
import type { ModelType } from '@/settings/model-pool'
import {
  createWhisperModelDownloadSession,
  isWhisperDownloadCancelled,
  type WhisperModelDownloadProgress,
  type WhisperModelDownloadSession,
} from '@/settings/whisper-model-download'
import { useRainStore } from '@/store/rain-store'
import { COLORS, s } from './shared'

interface AddModelFormProps {
  onClose?: () => void
  onSave?: () => void
}

export function AddModelForm({ onClose, onSave }: AddModelFormProps) {
  const addModel = useRainStore((state) => state.addModel)

  const [modelType, setModelType] = useState<'llm' | 'asr-api' | 'whisper-local'>('llm')
  const [provider, setProvider] = useState('ali')
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS[0].baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [modelName, setModelName] = useState('')
  const [alias, setAlias] = useState('')
  const [supportsVision, setSupportsVision] = useState(false)
  const [whisperSize, setWhisperSize] = useState('medium')
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'done' | 'cancelled' | 'error'>('idle')
  const [downloadError, setDownloadError] = useState('')
  const [downloadProgress, setDownloadProgress] = useState<WhisperModelDownloadProgress | null>(null)
  const downloadSession = useRef<WhisperModelDownloadSession | null>(null)
  const mounted = useRef(true)

  const isApiType = modelType === 'llm' || modelType === 'asr-api'
  const isWhisper = modelType === 'whisper-local'

  useEffect(() => () => {
    mounted.current = false
    downloadSession.current?.dispose()
  }, [])

  function handleProviderChange(value: string) {
    setProvider(value)
    if (value !== 'custom') {
      const preset = PROVIDER_PRESETS.find((candidate) => candidate.value === value)
      if (preset) setBaseUrl(preset.baseUrl)
    } else {
      setBaseUrl('')
    }
  }

  async function handleDownload() {
    setDownloadStatus('downloading')
    setDownloadError('')
    setDownloadProgress(null)
    try {
      const session = await createWhisperModelDownloadSession(whisperSize, (progress) => {
        if (mounted.current) setDownloadProgress(progress)
      })
      if (!mounted.current) {
        session.dispose()
        return
      }
      downloadSession.current = session
      await session.run()
      if (mounted.current) setDownloadStatus('done')
    } catch (err) {
      if (mounted.current) {
        setDownloadStatus(isWhisperDownloadCancelled(err) ? 'cancelled' : 'error')
        setDownloadError(String(err))
      }
    } finally {
      downloadSession.current?.dispose()
      downloadSession.current = null
    }
  }

  async function handleCancelDownload() {
    try {
      await downloadSession.current?.cancel()
    } catch (err) {
      if (mounted.current) {
        setDownloadStatus('error')
        setDownloadError(String(err))
      }
    }
  }

  function handleSave() {
    const type = modelType as ModelType
    const finalModelName = isWhisper ? whisperSize : modelName
    const finalProvider = isWhisper ? 'local' : provider
    const finalBaseUrl = isApiType
      ? (provider === 'custom'
          ? baseUrl
          : PROVIDER_PRESETS.find((candidate) => candidate.value === provider)?.baseUrl)
      : undefined

    addModel({
      type,
      provider: finalProvider,
      baseUrl: finalBaseUrl,
      apiKey: isApiType ? apiKey : undefined,
      modelName: finalModelName,
      alias: alias || finalModelName,
      supportsVision: modelType === 'llm' ? supportsVision : false,
    })

    onSave?.()
    onClose?.()
  }

  return (
    <div data-testid="add-model-form">
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: COLORS.muted }}>类型</label>
          <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="radio"
                name="mtype"
                value="llm"
                checked={modelType === 'llm'}
                onChange={() => setModelType('llm')}
              />
              LLM
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="radio"
                name="mtype"
                value="asr-api"
                checked={modelType === 'asr-api'}
                onChange={() => setModelType('asr-api')}
              />
              ASR-API
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="radio"
                name="mtype"
                value="whisper-local"
                checked={modelType === 'whisper-local'}
                onChange={() => setModelType('whisper-local')}
              />
              本地 Whisper
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: COLORS.muted }}>供应商</label>
          {isApiType ? (
            <select
              aria-label="供应商 provider"
              style={s.select}
              value={provider}
              onChange={(event) => handleProviderChange(event.target.value)}
            >
              {PROVIDER_PRESETS.map((preset) => (
                <option key={preset.value} value={preset.value}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">自定义…</option>
            </select>
          ) : (
            <input
              aria-label="供应商 provider"
              style={s.input}
              value="local"
              readOnly
            />
          )}
        </div>

        {isApiType && provider === 'custom' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: COLORS.muted }}>Base URL</label>
            <input
              aria-label="Base URL"
              type="text"
              style={s.input}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
        )}

        {isApiType && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: COLORS.muted }}>API Key</label>
            <input
              aria-label="API Key 密钥"
              type="password"
              style={s.input}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
        )}

        {isApiType && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: COLORS.muted }}>模型名</label>
            <input
              aria-label="模型名"
              type="text"
              style={s.input}
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
            />
          </div>
        )}

        {isWhisper && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: COLORS.muted }}>模型大小</label>
            <select
              style={s.select}
              value={whisperSize}
              disabled={downloadStatus === 'downloading'}
              onChange={(event) => {
                setWhisperSize(event.target.value)
                setDownloadStatus('idle')
                setDownloadProgress(null)
              }}
            >
              {WHISPER_SIZES.map((whisperModel) => (
                <option key={whisperModel.value} value={whisperModel.value}>
                  {whisperModel.label}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 12, color: COLORS.dimmer, marginTop: 4 }}>
              首次使用触发下载，显示进度
            </div>
            <button
              data-testid="whisper-download-action"
              style={s.btn}
              disabled={!isTauri() || downloadStatus === 'downloading'}
              onClick={isTauri() ? handleDownload : undefined}
            >
              {downloadStatus === 'downloading'
                ? '下载中…'
                : downloadStatus === 'done'
                  ? '✓ 已下载'
                  : '下载模型'}
            </button>
            {downloadStatus === 'downloading' && (
              <button
                data-testid="whisper-download-cancel"
                style={s.btn}
                onClick={handleCancelDownload}
              >
                取消下载
              </button>
            )}
            {downloadStatus === 'downloading' && downloadProgress && (
              <div
                data-testid="whisper-download-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={downloadProgress.percent ?? undefined}
                style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}
              >
                {downloadProgress.percent == null ? '下载中' : `${downloadProgress.percent}%`}
                {' '}({downloadProgress.downloadedBytes} / {downloadProgress.totalBytes ?? '?'} bytes)
              </div>
            )}
            {downloadStatus === 'error' && (
              <div data-testid="whisper-download-status" style={{ fontSize: 12, color: COLORS.fail, marginTop: 4 }}>
                下载失败：{downloadError}
              </div>
            )}
            {downloadStatus === 'cancelled' && (
              <div data-testid="whisper-download-status" style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>
                下载已取消，可重新下载
              </div>
            )}
            {downloadStatus === 'done' && (
              <div data-testid="whisper-download-status" style={{ fontSize: 12, color: COLORS.example, marginTop: 4 }}>
                模型已下载，可保存添加到模型池
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: COLORS.muted }}>别名（在池里显示的名字）</label>
          <input
            aria-label="别名"
            type="text"
            style={s.input}
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
          />
        </div>

        {modelType === 'llm' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={supportsVision}
              onChange={(event) => setSupportsVision(event.target.checked)}
            />
            支持画面（vision）
          </label>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px',
          borderTop: `1px solid ${COLORS.border}`,
        }}
      >
        <button style={s.miniBtn}>测试</button>
        <div style={{ flex: 1 }} />
        {onClose && (
          <button style={s.btn} onClick={onClose}>
            取消
          </button>
        )}
        <button style={s.primaryBtn} onClick={handleSave}>
          保存
        </button>
      </div>
    </div>
  )
}
