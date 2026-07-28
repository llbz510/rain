import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AddModelForm } from '@/ui/components/settings/add-model-form'

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  progress: undefined as ((payload: unknown) => void) | undefined,
  unlisten: vi.fn(),
}))

vi.mock('@/lib/tauri-env', () => ({
  isTauri: () => true,
  tauriInvoke: tauri.invoke,
  tauriListen: tauri.listen,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function renderWhisperForm() {
  const view = render(<AddModelForm />)
  fireEvent.click(screen.getByDisplayValue('whisper-local'))
  return view
}

afterEach(() => {
  tauri.invoke.mockReset()
  tauri.listen.mockReset()
  tauri.unlisten.mockReset()
  tauri.progress = undefined
})

describe('AC-MM-03 / AC-MM-04 Whisper model download workflow', () => {
  it('shows production event progress and verifies the installed list before success', async () => {
    const download = deferred<string>()
    tauri.listen.mockImplementation(async (_eventName, callback) => {
      tauri.progress = callback
      return tauri.unlisten
    })
    tauri.invoke.mockImplementation((command: string) => {
      if (command === 'download_whisper_model') return download.promise
      if (command === 'list_whisper_models') return Promise.resolve(['C:/models/ggml-medium.bin'])
      throw new Error(`Unexpected command: ${command}`)
    })
    renderWhisperForm()
    expect(screen.getByRole('option', { name: /medium.*1\.43 GiB/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

    fireEvent.click(screen.getByTestId('whisper-download-action'))
    await waitFor(() => expect(tauri.progress).toBeTypeOf('function'))
    act(() => {
      tauri.progress?.({
        modelSize: 'medium',
        downloadedBytes: 5,
        totalBytes: 10,
        percent: 50,
      })
    })
    expect(screen.getByTestId('whisper-download-progress')).toHaveTextContent('50%')

    download.resolve('C:/models/ggml-medium.bin')
    await waitFor(() => expect(screen.getByTestId('whisper-download-status')).toHaveTextContent('已下载'))
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    expect(tauri.invoke).toHaveBeenCalledWith('list_whisper_models')
    expect(tauri.unlisten).toHaveBeenCalledOnce()
  })

  it('cancels through the dedicated command and allows a clean retry', async () => {
    const download = deferred<string>()
    tauri.listen.mockImplementation(async (_eventName, callback) => {
      tauri.progress = callback
      return tauri.unlisten
    })
    tauri.invoke.mockImplementation((command: string) => {
      if (command === 'download_whisper_model') return download.promise
      if (command === 'cancel_whisper_model_download') {
        download.reject(new Error('cancelled'))
        return Promise.resolve(true)
      }
      throw new Error(`Unexpected command: ${command}`)
    })
    renderWhisperForm()

    fireEvent.click(screen.getByTestId('whisper-download-action'))
    await waitFor(() => expect(screen.getByTestId('whisper-download-cancel')).toBeEnabled())
    fireEvent.click(screen.getByTestId('whisper-download-cancel'))

    await waitFor(() => expect(screen.getByTestId('whisper-download-status')).toHaveTextContent('已取消'))
    expect(tauri.invoke).toHaveBeenCalledWith('cancel_whisper_model_download', {
      modelSize: 'medium',
    })
    expect(screen.getByTestId('whisper-download-action')).toBeEnabled()
  })

  it('does not report success when Rust cannot list the final model and releases on unmount', async () => {
    const download = deferred<string>()
    tauri.listen.mockImplementation(async (_eventName, callback) => {
      tauri.progress = callback
      return tauri.unlisten
    })
    tauri.invoke.mockImplementation((command: string) => {
      if (command === 'download_whisper_model') return download.promise
      if (command === 'list_whisper_models') return Promise.resolve([])
      throw new Error(`Unexpected command: ${command}`)
    })
    const view = renderWhisperForm()

    fireEvent.click(screen.getByTestId('whisper-download-action'))
    download.resolve('C:/models/ggml-medium.bin')
    await waitFor(() => expect(screen.getByTestId('whisper-download-status')).toHaveTextContent('下载失败'))
    expect(screen.getByTestId('whisper-download-status')).not.toHaveTextContent('已下载')

    const secondDownload = deferred<string>()
    tauri.invoke.mockImplementation((command: string) => {
      if (command === 'download_whisper_model') return secondDownload.promise
      throw new Error(`Unexpected command: ${command}`)
    })
    fireEvent.click(screen.getByTestId('whisper-download-action'))
    await waitFor(() => expect(tauri.listen).toHaveBeenCalledTimes(2))
    view.unmount()
    expect(tauri.unlisten).toHaveBeenCalledTimes(2)
  })
})
