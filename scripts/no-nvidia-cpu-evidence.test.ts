import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..')
const scriptPath = join(repoRoot, 'scripts', 'run-no-nvidia-cpu-evidence.ps1')
const script = readFileSync(scriptPath, 'utf8')

describe('M3-S2 no-NVIDIA CPU evidence runner contract', () => {
  it('requires a real installer and refuses development-tree execution as evidence', () => {
    expect(script).toMatch(/\[Parameter\(Mandatory = \$true\)\]\s*\[string\]\$InstallerPath/)
    expect(script).toContain("Start-Process -FilePath $Installer")
    expect(script).toContain("Get-ChildItem -LiteralPath $Destination -Recurse -Filter 'rain.exe'")
    expect(script).not.toContain('src-tauri\\target\\debug\\rain.exe')
    expect(script).not.toContain('npm run tauri -- build --debug --no-bundle')
  })

  it('captures the clean no-NVIDIA host facts before signing CPU evidence', () => {
    expect(script).toContain('Get-CimInstance Win32_VideoController')
    expect(script).toContain("Get-Command 'nvidia-smi.exe'")
    expect(script).toContain('System32\\nvcuda.dll')
    expect(script).toContain('No-NVIDIA evidence requires zero NVIDIA display adapters')
  })

  it('checks artifact identity, CUDA import isolation, Auto fallback, and CPU sample output', () => {
    expect(script).toContain('Get-FileHash -LiteralPath $installer -Algorithm SHA256')
    expect(script).toContain('Rain main executable imports CUDA libraries')
    expect(script).toContain("Invoke-TauriCommand $sessionId 'get_runtime_capability'")
    expect(script).toContain('visible Auto CPU fallback reason')
    expect(script).toContain('Whisper 后端：CPU')
    expect(script).toContain("Invoke-TauriCommand $sessionId 'start_asr'")
    expect(script).toContain("backend = 'cpu'")
    expect(script).toContain('CPU short sample timestamps are not monotonic')
  })

  it('writes a target-bound manifest without storing known secret patterns', () => {
    expect(script).toContain('targetCommit = (git -C $repoRoot rev-parse HEAD)')
    expect(script).toContain('installerSha256 = $installerHash')
    expect(script).toContain('Protect-DiagnosticText')
    expect(script).toContain('[REDACTED]')
    expect(script).not.toMatch(/RAIN_E2E_LLM_API_KEY|RAIN_QWEN_API_KEY|RAIN_LIVE_LLM_API_KEY/)
  })
})
