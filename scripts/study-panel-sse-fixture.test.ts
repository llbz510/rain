// @vitest-environment node
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { expect, it } from 'vitest'

it('provides real gated SSE bytes and records completion separately from client HTTP abort', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rain-study-panel-sse-test-'))
  const readyPath = join(directory, 'ready.json')
  const child = spawn(process.execPath, [resolve('scripts/study-panel-sse-fixture.mjs'), readyPath], { windowsHide: true, stdio: 'ignore' })
  try {
    let ready: { baseUrl: string; port: number } | undefined
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      try { ready = JSON.parse(await readFile(readyPath, 'utf8')) } catch { await new Promise(done => setTimeout(done, 25)) }
    }
    if (!ready) throw new Error('Controlled SSE fixture did not become ready')
    const root = ready.baseUrl.slice(0, -3)
    const request = (question: string, signal?: AbortSignal) => fetch(ready!.baseUrl + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer controlled-fixture-key' }, signal,
      body: JSON.stringify({ model: 'rain-tabs-controlled', stream: true, messages: [{ role: 'user', content: question }] }),
    })
    const probe = await request('Run the Rain text assistant capability check.')
    expect(await probe.text()).toContain('RAIN_ASSISTANT_OK')
    const first = await request('First')
    const reader = first.body!.getReader()
    const decoder = new TextDecoder()
    expect(decoder.decode((await reader.read()).value)).toContain('Visible')
    expect(await (await fetch(root + '/status')).json()).toEqual({ probeCount: 1, requests: [{ question: 'First', completed: false, aborted: false }] })
    await fetch(root + '/release/1/hidden', { method: 'POST' })
    expect(decoder.decode((await reader.read()).value)).toContain(' hidden')
    await fetch(root + '/release/1/done', { method: 'POST' })
    let remaining = ''
    for (;;) { const next = await reader.read(); if (next.done) break; remaining += decoder.decode(next.value) }
    expect(remaining).toContain(' complete')
    expect(remaining).toContain('data: [DONE]')
    const cancellation = new AbortController()
    const second = await request('Second', cancellation.signal)
    const secondReader = second.body!.getReader()
    expect(decoder.decode((await secondReader.read()).value)).toContain('Visible')
    cancellation.abort()
    await expect(secondReader.read()).rejects.toThrow()
    let state
    for (let attempt = 0; attempt < 100; attempt++) {
      state = await (await fetch(root + '/status')).json()
      if (state.requests[1].aborted) break
      await new Promise(done => setTimeout(done, 10))
    }
    expect(state).toEqual({ probeCount: 1, requests: [
      { question: 'First', completed: true, aborted: false }, { question: 'Second', completed: false, aborted: true },
    ] })
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited }
    const absolute = resolve(directory)
    if (!absolute.startsWith(resolve(tmpdir()) + sep + 'rain-study-panel-sse-test-')) throw new Error('Unexpected fixture cleanup path')
    await rm(absolute, { recursive: true, force: true })
  }
}, 10_000)
