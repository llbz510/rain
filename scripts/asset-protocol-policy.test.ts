// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AC-AR-03 production asset capability', () => {
  it('limits static grants to app-owned thumbnails and downloaded media', () => {
    const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
    expect(config.app.security.assetProtocol).toEqual({
      enable: true,
      scope: ['$APPDATA/thumbnails/*', '$APPDATA/online-videos/**'],
    })
  })

  it('keeps production local URL conversion in the shared media adapter', () => {
    const converters: string[] = []
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__' && path !== join('src', 'e2e')) visit(path)
        } else if (/\.tsx?$/.test(path) && /\bconvertFileSrc\b/.test(readFileSync(path, 'utf8'))) {
          converters.push(path.replaceAll('\\', '/'))
        }
      }
    }
    visit('src')
    expect(converters).toEqual(['src/ui/components/video.tsx'])
  })

  it('retains real asset observations in the public success snapshot and rejects bad reads', () => {
    // Load only the runner's public Judge functions via AST; never launch the app/build.
    const script = `
      $ErrorActionPreference = 'Stop'
      $tokens = $null; $errors = $null
      $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        (Join-Path $PWD 'scripts/run-study-catalog-e2e.ps1'), [ref]$tokens, [ref]$errors)
      if ($errors.Count) { throw 'Runner syntax error' }
      $names = @('Get-JudgeFactSnapshot', 'Assert-AssetReads', 'Fail-Condition')
      foreach ($name in $names) {
        $functions = @($ast.FindAll({param($node)
          $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
        }, $true))
        if ($functions.Count -ne 1) { throw "Expected unique Judge function $name" }
        Invoke-Expression $functions[0].Extent.Text
      }
      $script:missingConditions = [System.Collections.Generic.List[string]]::new()
      $before = @(@{status=403; byteLength=0}, @{status=403; byteLength=0})
      $after = @(@{status=200; byteLength=224044}, @{status=403; byteLength=0})
      $script:facts = @{assetReadsBeforeRestart=$before; assetScope=@{reads=$after; cases=@('selected', 'neighbor')}}
      $snapshot = Get-JudgeFactSnapshot
      Assert-AssetReads $after @(200,403) @(224044,0) 'valid'
      $badStatusesRejected = $false; $badBytesRejected = $false
      try { Assert-AssetReads @(@{status=200; byteLength=0}) @(403) @(0) 'exposed neighbor' }
      catch { $badStatusesRejected = $true }
      try { Assert-AssetReads @(@{status=200; byteLength=0}) @(200) @(224044) 'empty media' }
      catch { $badBytesRejected = $true }
      @{snapshot=$snapshot; badStatusesRejected=$badStatusesRejected; badBytesRejected=$badBytesRejected} |
        ConvertTo-Json -Depth 12 -Compress
    `
    const result = JSON.parse(execFileSync('pwsh', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
    ], { encoding: 'utf8', windowsHide: true, timeout: 4000 }))
    expect(result.snapshot.assetReadsBeforeRestart).toEqual([
      { status: 403, byteLength: 0 }, { status: 403, byteLength: 0 },
    ])
    expect(result.snapshot.assetScope).toEqual({
      cases: ['selected', 'neighbor'],
      reads: [{ status: 200, byteLength: 224044 }, { status: 403, byteLength: 0 }],
    })
    expect(result.badStatusesRejected).toBe(true)
    expect(result.badBytesRejected).toBe(true)
  })
})
