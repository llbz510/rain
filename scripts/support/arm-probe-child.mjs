// Fixture for scripts/visual-collector-runtime-paths.test.ts.
//
// Runs the collector's real visual probe inside jsdom and reports what it finally PUBLISHED
// on `window.__RAIN_VISUAL_PROBE__`.
//
// Why this is a separate process: the "no .catch" mutant lets the probe's detached async IIFE
// reject. In-process that rejection is an UNHANDLED rejection, and vitest fails the whole run
// for it (observed: `Unhandled Rejection Error: accent sweep token unparseable: not-a-token`).
// Isolating the mutant here turns that same fact into data instead of collateral damage.
//
// Usage: node arm-probe-child.mjs <probeSourceFile> <configJsonFile> <waitMs>
// Prints exactly one JSON line: {"published":bool,"status":...,"error":...,"waitedMs":n}
//
// It is a TEST FIXTURE, not product code: nothing in the collector or the workflows calls it.

import { readFileSync } from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'

const [, , probeSourceFile, configJsonFile, waitMsRaw] = process.argv
const probeSource = readFileSync(probeSourceFile, 'utf8')
const config = JSON.parse(readFileSync(configJsonFile, 'utf8'))
const waitMs = Number(waitMsRaw ?? 3000)

const virtualConsole = new VirtualConsole()
virtualConsole.on('jsdomError', () => {})
const dom = new JSDOM('<!doctype html><html><body><div id="x">x</div></body></html>', {
  virtualConsole,
  pretendToBeVisual: true,
})
const { window } = dom
Object.defineProperty(window.document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true })

const globals = globalThis
const saved = new Map()
for (const name of ['window', 'document', 'getComputedStyle', 'requestAnimationFrame']) {
  saved.set(name, globals[name])
  globals[name] = window[name]
}
window.__RAIN_VISUAL_PROBE_CONFIG__ = config
globals.__RAIN_VISUAL_PROBE_CONFIG__ = config

const started = Date.now()

// The mutant (probe with its `.catch` removed) rejects its detached async IIFE. Without this
// handler Node kills the process before it can report what got published -- and that kill IS
// the finding, but it has to be *measured*, not crashed on. Record it and keep going.
const unhandled = []
process.on('unhandledRejection', (reason) => { unhandled.push(String(reason)) })
process.on('uncaughtException', (error) => { unhandled.push(String(error)) })

try {
  // eslint-disable-next-line no-new-func
  await new Function(probeSource)()
} catch {
  // A synchronous throw here is itself a finding; report it as "never published".
}
const deadline = Date.now() + waitMs
while (!window.__RAIN_VISUAL_PROBE__ && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 10))
}
const armed = window.__RAIN_VISUAL_PROBE__
console.log(JSON.stringify({
  published: Boolean(armed),
  status: armed?.status ?? null,
  error: armed?.error ?? null,
  waitedMs: Date.now() - started,
  unhandled: unhandled.length,
}))
process.exit(0)
