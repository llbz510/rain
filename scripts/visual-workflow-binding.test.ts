import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanupTrackedProcesses, runTrackedProcess } from './tracked-process.mjs'

const root = join(__dirname, '..')
const workflow = readFileSync(join(root, '.github/workflows/visual-evidence.yml'), 'utf8').replace(/\r\n/g, '\n')
const timeoutMs = 60_000

function step(name: string, source = workflow): string {
  const marker = `      - name: ${name}\n`
  const start = source.indexOf(marker)
  if (start < 0) throw new Error(`Missing workflow step: ${name}`)
  const end = source.indexOf('\n      - name:', start + marker.length)
  return source.slice(start, end < 0 ? source.length : end)
}

function body(name: string, source = workflow): string {
  const block = step(name, source)
  const start = block.indexOf('        run: |\n')
  if (start < 0) throw new Error(`Missing run body: ${name}`)
  return block.slice(start + '        run: |\n'.length).split('\n').map(line => line.replace(/^ {10}/, '')).join('\n')
}

async function runStep(name: string, directory: string, env: Record<string, string>, prelude = '', source = workflow) {
  const script = join(directory, 'step.ps1')
  writeFileSync(script, '\uFEFF$ErrorActionPreference = "Stop"\n' + prelude + '\n' + body(name, source), 'utf8')
  return await runTrackedProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
    cwd: directory, timeoutMs, env: { ...process.env, ...env },
  })
}

function diagnosticPackage(directory: string, name: string, rawSource: boolean): string {
  const path = join(directory, 'evidence', name)
  mkdirSync(join(path, 'records'), { recursive: true })
  mkdirSync(join(path, 'diagnostic'), { recursive: true })
  writeFileSync(join(path, 'manifest.json'), JSON.stringify({ records: [{ file: 'records/one.json' }] }))
  writeFileSync(join(path, 'records', 'one.json'), JSON.stringify({ measurementScope: 'element' }))
  writeFileSync(join(path, 'diagnostic', 'one.style-dump.json'), JSON.stringify(rawSource
    ? { raw: { borderTopLeftRadius: '', borderRadius: '8px' }, selectedSource: 'borderRadius' }
    : { tracked: {} }))
  return path
}

afterAll(async () => { await cleanupTrackedProcesses() })

describe('visual workflow: exact current package, including failures', () => {
  const diagnosticStep = 'Validate diagnostic dump count and raw source fields'
  const validateStep = 'Validate the collected evidence package against visual-contract §3.4'

  it('does not let a valid old package hide missing raw fields in this run', { timeout: timeoutMs }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rain-workflow-package-'))
    const current = diagnosticPackage(directory, 'visual-00000000-20261008-010101', false)
    diagnosticPackage(directory, 'visual-ffffffff-20200101-010101', true)
    const result = await runStep(diagnosticStep, directory, { CURRENT_EVIDENCE_PACKAGE: current })
    expect(result.status, result.stdout + result.stderr).not.toBe(0)
    expect(result.stdout + result.stderr).toMatch(/missing raw/)
  })

  it('does not let a broken old package reject valid raw fields in this run', { timeout: timeoutMs }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rain-workflow-package-'))
    const current = diagnosticPackage(directory, 'visual-00000000-20261008-010101', true)
    diagnosticPackage(directory, 'visual-ffffffff-20200101-010101', false)
    const result = await runStep(diagnosticStep, directory, { CURRENT_EVIDENCE_PACKAGE: current })
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain('Validated 1 diagnostic style dump(s).')
  })

  it('validates the exact output path and throws when the validator exits nonzero', { timeout: timeoutMs }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rain-workflow-package-'))
    const current = diagnosticPackage(directory, 'visual-00000000-20261008-010101', true)
    diagnosticPackage(directory, 'visual-ffffffff-20200101-010101', true)
    // Replace only the external process boundary; execute the workflow's actual PowerShell body.
    const prelude = 'function powershell.exe { Write-Output ($args -join " "); $global:LASTEXITCODE = 7 }'
    const result = await runStep(validateStep, directory, { CURRENT_EVIDENCE_PACKAGE: current }, prelude)
    const actualPath = result.stdout.trim().split('-EvidenceRoot ')[1]
    expect(realpathSync.native(actualPath)).toBe(realpathSync.native(current))
    expect(result.status, result.stdout + result.stderr).not.toBe(0)
    expect(result.stdout + result.stderr).toMatch(/validator.*7/i)
  })

  it('rejects an absent current package instead of falling back to an old package', { timeout: timeoutMs }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rain-workflow-package-'))
    diagnosticPackage(directory, 'visual-ffffffff-20200101-010101', true)
    const result = await runStep(diagnosticStep, directory, { CURRENT_EVIDENCE_PACKAGE: '' })
    expect(result.status, result.stdout + result.stderr).not.toBe(0)
    expect(result.stdout + result.stderr).toMatch(/this run|current package/i)
  })

  it('uses the collector output for diagnostic validation, validation, summary and upload', () => {
    const collect = step('Collect real desktop visual evidence')
    expect(collect).toContain('id: collect')
    expect(collect).toMatch(/LASTEXITCODE -ne 0/)
    for (const name of [diagnosticStep, validateStep, 'Write job summary']) {
      expect(step(name)).toContain('CURRENT_EVIDENCE_PACKAGE: ${{ steps.collect.outputs.package_path }}')
      expect(step(name)).not.toMatch(/Sort-Object Name -Descending/)
    }
    expect(step('Upload visual evidence package')).toContain('path: ${{ steps.collect.outputs.package_path }}')
    expect(step('Upload visual evidence package')).not.toContain('path: evidence/**')
  })

  it('channel runs the collector guards as well as the validator', () => {
    const channel = workflow.slice(workflow.indexOf('\n  channel:'), workflow.indexOf('\n  collect:'))
    for (const name of ['visual-collector-runtime-paths', 'visual-collector-selfcheck', 'visual-style-contract-alignment', 'visual-workflow-binding']) {
      expect(channel).toContain(`scripts/${name}.test.ts`)
    }
  })

  it('paired regression: restoring alphabetical package selection makes the raw-fields guard blind', { timeout: timeoutMs }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rain-workflow-package-'))
    const current = diagnosticPackage(directory, 'visual-00000000-20261008-010101', false)
    diagnosticPackage(directory, 'visual-ffffffff-20200101-010101', true)
    const mutated = workflow.replace("$package = Get-Item -LiteralPath $env:CURRENT_EVIDENCE_PACKAGE", "$package = Get-ChildItem -Path evidence -Directory -Filter 'visual-*' | Sort-Object Name -Descending | Select-Object -First 1")
    expect(mutated).not.toBe(workflow)
    const result = await runStep(diagnosticStep, directory, { CURRENT_EVIDENCE_PACKAGE: current }, '', mutated)
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })
})
