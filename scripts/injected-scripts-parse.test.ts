// Local guard: every JavaScript payload the collector sends to the browser must PARSE.
//
// Why: a hosted collection run burned ~9 minutes and failed with
//   {"value":{"error":"javascript error","message":"javascript error: Invalid or unexpected token"}}
// -- a syntax error in an injected script. That class of bug must be caught here in milliseconds.
//
// ROOT CAUSE FOUND BY THIS GUARD (kept as the reverse anchor below): the card-count script was built as
//   'return document.querySelectorAll("' + '[data-testid^="card-"] button' + '").length;'
// which assembles to
//   return document.querySelectorAll("[data-testid^="card-"] button").length;
// The JS string literal is terminated early by the inner quotes, so the browser answers
// "Invalid or unexpected token". It only ever ran on the study path, which is why video-list and
// settings succeeded on the hosted run and study failed.
//
// Semantics: WebDriver's `execute/sync` treats the script as a FUNCTION BODY (a top-level `return` is
// legal), so the faithful local check is `new Function(code)`.
//
// `node --check` was the other candidate and is NOT equivalent: it parses the file as a SCRIPT, where a
// top-level `return` is only legal by accident of CommonJS, and it cannot be pointed at a bare string
// without a temp file. It happened to exit 0 for these payloads as `.js`, but that is a different
// question from the one being asked -- "does this parse as a function body" -- so it is not used.
//
// The payloads are assembled BY POWERSHELL, not simulated here: PowerShell's quoting rules are the
// thing under test, so re-implementing them in JS would test the wrong thing.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const collectorScript = join(repoRoot, 'scripts', 'campaign-visual-evidence.ps1')

/** Parse a script the way WebDriver will: as a function body. */
function parsesAsFunctionBody(code: string): { ok: true } | { ok: false; error: string } {
  try {
    // eslint-disable-next-line no-new-func
    new Function(code)
    return { ok: true }
  } catch (cause) {
    return { ok: false, error: (cause as Error).message }
  }
}

interface CollectedPayloads {
  /** Payloads whose bytes PowerShell actually produced: probe, arms, and every resolvable call site. */
  payloads: Record<string, string>
  /** Every payload-bearing call site, resolvable or not. */
  scriptCalls: number
  /** Real call sites that pass no script argument at all; must be zero, else something went missing. */
  noScriptArgCalls: number
  /** Call sites whose script argument could not be resolved here, keyed by `L<line>` with the raw text. */
  skippedCallSites: Record<string, string>
  /** Line the collector defines each bound constant on, so staleness can be asserted. */
  boundLines: Record<string, number>
}

/**
 * Ask PowerShell for every payload it would inject: the probe script, one arm statement per page, and
 * every inline `Invoke-WebDriverScript` argument -- plus an inventory of the call sites it could NOT
 * evaluate, so a coverage gap is reported instead of passing silently.
 *
 * The arm payloads are the one part rebuilt in the emitted script rather than lifted verbatim: the
 * collector assembles them inside `Invoke-VisualProbe` from the same specs and `ConvertTo-Json`, and the
 * config bytes here come from the collector's own `Get-*Specs`/`Get-AccentSweeps`. The inline arguments,
 * which is where the real defect lived, are always the collector's own bytes.
 */
function collectPayloads(): CollectedPayloads {
  const dir = mkdtempSync(join(tmpdir(), 'rain-inject-'))
  const scriptPath = join(dir, 'dump.ps1')
  const outPath = join(dir, 'payloads.json')
  const src = collectorScript.replace(/\\/g, '/')
  const outForPs = outPath.replace(/\\/g, '/')

  const script = [
    '$ErrorActionPreference = "Stop"',
    `$src = '${src}'`,
    '$tokens = $null; $errors = $null',
    '$ast = [System.Management.Automation.Language.Parser]::ParseFile($src, [ref]$tokens, [ref]$errors)',
    'if ($errors.Count -gt 0) { throw "collector parse errors: $($errors.Count)" }',
    '$funcs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)',
    "foreach ($name in @('Get-ListSpecs','Get-SettingsSpecs','Get-StudySpecs','Get-AccentSweeps')) {",
    '  $fn = $funcs | Where-Object { $_.Name -eq $name } | Select-Object -First 1',
    '  Invoke-Expression $fn.Extent.Text',
    '}',
    '$probe = ($tokens | Where-Object { $_.Kind -eq "HereStringLiteral" -and ([string]$_.Value).Length -gt 1000 } | Select-Object -First 1).Value',
    'if (-not $probe) { throw "probe script here-string not found" }',
    // Bind the collector\'s own top-level string constants that its injected arguments interpolate.
    // Without these, an expression like "return JSON.stringify($probeInterface);" is only PARTLY known:
    // the parser sees a token, not the text, so a syntax error next to the interpolation stays invisible.
    // Review found exactly that hole.
    //
    // The assignment must be SELF-CONTAINED. `Invoke-Expression` runs in THIS script\'s scope, so a
    // right-hand side that names something else would resolve to whatever exists here instead of the
    // collector\'s value -- verification proved that rewriting the collector to
    // `$probeInterface = $ErrorActionPreference` made this guard emit `JSON.stringify(Stop)` and stay
    // fully green. So a binding whose right-hand side is itself a variable reference is refused loudly.
    'function Get-AssignedValue([string]$VariableName) {',
    '  $assign = $ast.FindAll({ param($x) $x -is [System.Management.Automation.Language.AssignmentStatementAst] -and $x.Left.Extent.Text -eq $VariableName }, $true) | Sort-Object { $_.Extent.StartLineNumber } | Select-Object -Last 1',
    '  if (-not $assign) { return $null }',
    '  $right = $assign.Right',
    '  if ($right -is [System.Management.Automation.Language.CommandExpressionAst]) { $right = $right.Expression }',
    // A `[type]` cast wraps the literal it casts; unwrap so a cast hashtable/string still counts as literal.
    '  while ($right -is [System.Management.Automation.Language.ConvertExpressionAst]) { $right = $right.Child }',
    // Self-contained shapes only: a string literal (single- or double-quoted, incl. here-strings) or a
    // hashtable literal. A variable reference here would be resolved against this script.
    '  if ($right -isnot [System.Management.Automation.Language.StringConstantExpressionAst] -and $right -isnot [System.Management.Automation.Language.ExpandableStringExpressionAst] -and $right -isnot [System.Management.Automation.Language.HashtableAst]) {',
    '    throw ("binding for " + $VariableName + " is not self-contained (right-hand side is a " + $right.GetType().Name + "); this guard would resolve it against its own scope and could emit the wrong bytes")',
    '  }',
    '  if ($right -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) {',
    '    $refs = @($right.FindAll({ param($x) $x -is [System.Management.Automation.Language.VariableExpressionAst] }, $true))',
    '    if ($refs.Count -gt 0) { throw ("binding for " + $VariableName + " interpolates " + ($refs | ForEach-Object { $_.Extent.Text }) -join "," + "; refusing to resolve it against this script") }',
    '  }',
    '  try { return (Invoke-Expression $right.Extent.Text) } catch { return $null }',
    '}',
    // The name must be a LITERAL variable name in the emitted PowerShell. In a double-quoted PowerShell
    // string it would interpolate to the variable's VALUE and the lookup would search for the wrong name
    // (a real bug this guard hit while being strengthened).
    'function Require-Bound([string]$VariableName, $Value) {',
    '  if ($Value) { return $Value }',
    // Refuse loudly. The two reasons a binding fails are a moved/renamed assignment and a right-hand side
    // that is not self-contained (Get-AssignedValue rejects a variable reference, because evaluating it here
    // would resolve against THIS script and could emit the wrong bytes while staying green). Naming both
    // keeps the message actionable without re-deriving which one it was.
    '  throw ("could not bind " + $VariableName + ": the collector\'s assignment for it is either missing, not self-contained (e.g. it references another variable), or no longer a plain literal. All three are refused on purpose.")',
    '}',
    `$probeScript = Require-Bound '$probeScript' (Get-AssignedValue '$probeScript')`,
    `$probeInterface = Require-Bound '$probeInterface' (Get-AssignedValue '$probeInterface')`,
    // Bind from the collector, never hardcode. Review caught this guard passing a hand-written
    // $toleranceBasis that differed from the collector\'s real value, so the arm payloads were built from
    // the wrong bytes and a syntax error in the real value stayed invisible.
    `$tolerance = Require-Bound '$tolerance' (Get-AssignedValue '$tolerance')`,
    `$toleranceBasis = Require-Bound '$toleranceBasis' (Get-AssignedValue '$toleranceBasis')`,
    // Record WHERE each bound name was read from, so the test can prove the binding is the assignment that
    // actually feeds the call sites (and that no re-assignment in between makes it stale).
    '$boundLines = [ordered]@{}',
    'foreach ($pair in @(@("probeScript", $probeScript), @("probeInterface", $probeInterface), @("tolerance", $tolerance), @("toleranceBasis", $toleranceBasis))) {',
    // ('$' + ...) is single-quoted on purpose: a double-quoted "$" would make PowerShell read `$pair` as a
    // variable and interpolate it, silently building the wrong lookup key (this guard hit that bug twice).
    `  $a = $ast.FindAll({ param($x) $x -is [System.Management.Automation.Language.AssignmentStatementAst] -and $x.Left.Extent.Text -eq ('$' + $pair[0]) }, $true) | Sort-Object { $_.Extent.StartLineNumber } | Select-Object -Last 1`,
    '  $boundLines[$pair[0]] = [string]$a.Extent.StartLineNumber',
    '}',
    '$all = @(Get-AccentSweeps)',
    '$pages = @(',
    '  @{ n = "list"; s = @(Get-ListSpecs); w = @($all | Where-Object { $_.page -eq "video-list" }) },',
    '  @{ n = "settings"; s = @(Get-SettingsSpecs); w = @($all | Where-Object { $_.page -eq "settings" }) },',
    '  @{ n = "study"; s = @(Get-StudySpecs); w = @($all | Where-Object { $_.page -eq "study" }) }',
    ')',
    '$out = [ordered]@{ probeScript = [string]$probe }',
    'foreach ($p in $pages) {',
    '  $cfg = @{ specs = $p.s; accentSweeps = @($p.w); tolerance = $tolerance; toleranceBasis = $toleranceBasis }',
    '  $json = ConvertTo-Json -InputObject $cfg -Depth 12 -Compress',
    '  $out["arm_" + $p.n] = "window.__RAIN_VISUAL_PROBE__ = null; window.__RAIN_VISUAL_PROBE_CONFIG__ = " + $json + ";"',
    '}',
    // Inline arguments, enumerated from the AST rather than by regex over source lines.
    //
    // A line regex was tried first and was WRONG in two ways, both caught by review and reproduced:
    //   (a) it required `)` at end-of-line, so `Invoke-WebDriverScript $s '...' | Out-Null` was skipped;
    //   (b) it refused arguments not starting with a single quote, so a double-quoted argument was skipped.
    // Either gap lets a real syntax error through silently -- the exact false-green this guard exists to
    // prevent. The AST has no such trouble: every call's arguments are already parsed, so the script is
    // just an argument index and quoting style is irrelevant.
    //
    // There are TWO functions that push a script into the browser, and the second one is easy to miss:
    //   Invoke-WebDriverScript($SessionId, $Script)            -> script is argument index 1
    //   Wait-WebDriverCondition($SessionId, $Desc, $Script)    -> script is argument index 2
    // Review caught this guard covering only the first family, which left six condition scripts
    // (L612/L1240/L1273/L1307/L1313/L1327) -- real injected JavaScript -- completely unchecked.
    //
    // `$scriptCalls` / `$skipped` are the inventory: a site that does not yield a payload is always
    // recorded, so nothing can be dropped quietly.
    '$funcs = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)',
    '$scriptCalls = 0',
    // Counted separately: a call site that passes NO script argument (so there is nothing to check) and a
    // call that is a function definition. Both are legitimate, but the count must be visible -- otherwise a
    // call site whose argument went missing would be skipped by `continue` without any assertion noticing.
    '$noScriptArgCalls = 0',
    '$skipped = [ordered]@{}',
    // Exactly the names this script binds from the collector, and nothing else. A generous list is itself
    // a hazard: review proved that names like `cfg`/`json`/`p`/`out` resolve to values leaked from THIS
    // script's own dump loop, so a call site referencing one of them would be evaluated against the wrong
    // bytes and still pass every assertion. Add a name here only together with an explicit binding above.
    '$allowed = @("probeInterface", "probeScript", "tolerance", "toleranceBasis")',
    '$payloadFunctions = @{ "Invoke-WebDriverScript" = 1; "Wait-WebDriverCondition" = 2 }',
    '$calls = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)',
    'foreach ($call in $calls) {',
    '  $elements = @($call.CommandElements)',
    '  if ($elements.Count -lt 1) { continue }',
    '  $commandName = $elements[0].Extent.Text',
    '  if (-not $payloadFunctions.ContainsKey($commandName)) { continue }',
    '  $params = @($elements | Select-Object -Skip 1)',
    '  $scriptIndex = $payloadFunctions[$commandName]',
    // Every matching CommandAst is counted here, including one that would pass too few arguments. The
    // counters below must partition this number exactly: verification showed that a call site skipping out
    // through a bare `continue` was invisible to every assertion.
    '  $scriptCalls++',
    '  if ($params.Count -le $scriptIndex) { $noScriptArgCalls++; continue }',
    '  $arg = $params[$scriptIndex]',
    '  $line = $call.Extent.StartLineNumber',
    '  $hadValue = $false',
    // Whether a site can be evaluated is decided by its ARGUMENT, not by where it lives: the collector's
    // top-level constants are bound above, so an argument that merely references them is evaluated for
    // real. Only genuinely local values ($configJson) and parameters ($Script/$script/$Desc) stay
    // unevaluated -- and those are catalogued below rather than dropped.
    '  $vars = @($arg.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] }, $true) | ForEach-Object { $_.VariablePath.UserPath })',
    '  $unbound = @($vars | Where-Object { $allowed -notcontains $_ })',
    '  if ($unbound.Count -eq 0) {',
    '    try { $value = Invoke-Expression $arg.Extent.Text } catch { $value = $null }',
    // A resolved value must not still contain an UNEXPANDED PowerShell variable (`$` followed by a name):
    // that would mean a variable survived into the text and the payload is not the real bytes. Treating it
    // as a payload would be a false green. A bare `$` is fine -- the real payloads contain JS template
    // literals like `${...}`.
    `    if ($value -is [string] -and $value.Length -ge 8 -and $value -notmatch '\$[\w({]') { $out["inline_L" + $line] = $value; $hadValue = $true }`,
    '  }',
    // Anything that did NOT yield a payload is recorded, never silently dropped.
    '  if (-not $hadValue) {',
    '    $owner = $funcs | Where-Object { $_.Extent.StartOffset -le $call.Extent.StartOffset -and $_.Extent.EndOffset -ge $call.Extent.EndOffset } | Select-Object -First 1',
    '    $where = if ($owner) { "[in function " + $owner.Name + "] " } else { "" }',
    '    $why = if ($unbound.Count -gt 0) { "[unbound: " + ($unbound -join ",") + "] " } else { "[did not evaluate to a string] " }',
    '    $skipped["L" + $line] = $where + $why + $arg.Extent.Text',
    '  }',
    '}',
    '$out["_scriptCalls"] = [string]$scriptCalls',
    '$out["_noScriptArgCalls"] = [string]$noScriptArgCalls',
    '$out["_boundLines"] = $boundLines',
    '$out["_skipped"] = $skipped',
    'ConvertTo-Json -InputObject $out -Depth 4 -Compress | Set-Content -LiteralPath \'' + outForPs + '\' -Encoding UTF8',
  ].join('\n')

  writeFileSync(scriptPath, '\uFEFF' + script, 'utf8')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 120_000,
  })
  const raw = JSON.parse(readFileSync(outPath, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>
  const payloads: Record<string, string> = {}
  const skippedCallSites: Record<string, string> = {}
  const boundLines: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (key === '_scriptCalls') continue
    if (key === '_noScriptArgCalls') continue
    if (key === '_skipped') {
      for (const [line, text] of Object.entries(value as Record<string, string>)) skippedCallSites[line] = text
      continue
    }
    if (key === '_boundLines') {
      for (const [name, line] of Object.entries(value as Record<string, string>)) boundLines[name] = Number(line)
      continue
    }
    payloads[key] = String(value)
  }
  return {
    payloads,
    scriptCalls: Number(raw._scriptCalls),
    noScriptArgCalls: Number(raw._noScriptArgCalls),
    skippedCallSites,
    boundLines,
  }
}

describe('injected browser scripts must parse before they are ever sent', () => {
  const { payloads, scriptCalls, noScriptArgCalls, skippedCallSites, boundLines } = collectPayloads()

  it('collects the probe script, the arm statements and the inline scripts', () => {
    const names = Object.keys(payloads)
    expect(names).toContain('probeScript')
    expect(names).toContain('arm_list')
    expect(names).toContain('arm_settings')
    expect(names).toContain('arm_study')
    const inline = names.filter((n) => n.startsWith('inline_'))
    expect(inline.length, 'inline scripts must be collected: ' + inline.join(', ')).toBeGreaterThan(0)
  })

  it('accounts for every call site, including the ones it cannot evaluate', () => {
    // The inventory assertion, and the fix for TWO real false-greens found by review.
    //
    // First false-green: the collector found inline call sites with a line regex requiring `)` at
    // end-of-line and a leading single quote, so it silently skipped four sites; review planted a genuine
    // syntax error at one of them and this file still went green.
    //
    // Second false-green: covering only `Invoke-WebDriverScript` left the six condition scripts passed to
    // `Wait-WebDriverCondition` -- real injected JavaScript -- entirely unchecked. Review planted syntax
    // errors in two of them and this file still went green.
    //
    // Now every payload-bearing call site of BOTH functions is enumerated from the AST, and a site that
    // cannot be evaluated is recorded with its reason. The two below are the only ones left, and both are
    // function-internal plumbing rather than payload choices: every actual caller passes a payload and is
    // covered by its own entry.
    const inline = Object.keys(payloads).filter((n) => n.startsWith('inline_'))
    expect(inline.length, 'inline payloads: ' + inline.join(', ')).toBe(14)
    // The six condition scripts must be among them -- that is the second false-green above.
    for (const line of ['L612', 'L1240', 'L1273', 'L1307', 'L1313', 'L1327']) {
      expect(payloads['inline_' + line], `condition script ${line} must be collected`).toBeTypeOf('string')
    }

    // 16 payload-bearing call sites: 10 of Invoke-WebDriverScript (script = argument 1) and 6 of
    // Wait-WebDriverCondition (script = argument 2). Neither function definition is counted: their script
    // parameters are positionally absent, which is exactly why `$payloadFunctions` maps name -> index.
    expect(scriptCalls, 'every payload-bearing call site must still be counted').toBe(16)
    // The counters must PARTITION the total exactly: every call site either produced a payload or was
    // catalogued. Without this a call site could leave through a bare `continue` and stay invisible to
    // every assertion (verification flagged exactly that hole).
    expect(noScriptArgCalls, 'no call site may omit its script argument').toBe(0)
    expect(
      Object.keys(payloads).filter((n) => n.startsWith('inline_')).length + Object.keys(skippedCallSites).length,
      'payloads + catalogued gaps must equal the call-site total',
    ).toBe(scriptCalls)

    const expected: Record<string, string> = {
      L576: 'the helper forwards its own $Script parameter; its callers pass payloads and are covered',
      L610: 'concatenates $configJson, computed locally by Invoke-VisualProbe',
    }
    expect(Object.keys(skippedCallSites).sort()).toEqual(Object.keys(expected).sort())
    for (const [line, text] of Object.entries(skippedCallSites)) {
      // The record must say WHY it could not be evaluated, so a new gap cannot look like these.
      expect(text, `the record for ${line} must name the unbound variable`).toMatch(/\[unbound: \w+\]/)
      if (line === 'L576') expect(text).toContain('$Script')
      if (line === 'L610') expect(text, expected.L610).toContain('$configJson')
    }
    // The defect that started all this is a real, evaluated call site -- not an exempted one.
    expect(payloads.inline_L1320, 'the fixed call site must be evaluated, not exempted').toBeTypeOf('string')
    expect(Object.keys(skippedCallSites), 'the fixed call site must not be exempted').not.toContain('L1320')
    // The sites the old regex dropped that ARE resolvable must now be evaluated.
    for (const line of ['L611', 'L616', 'L1306']) {
      expect(payloads['inline_' + line], `${line} must now be evaluated, not skipped`).toBeTypeOf('string')
      expect(Object.keys(skippedCallSites)).not.toContain(line)
    }

    // The bound constants must be the assignments that actually feed the call sites. If the collector
    // re-assigned one of them between its definition and first use, the guard would evaluate the wrong
    // bytes and stay green -- review flagged that this equivalence was previously unguarded.
    // (The binding helper already picks the LAST assignment before the call sites; this asserts the
    // recorded position is genuinely upstream of every evaluated site.)
    expect(Object.keys(boundLines).sort()).toEqual(['probeInterface', 'probeScript', 'tolerance', 'toleranceBasis'])
    const evaluatedLines = Object.keys(payloads)
      .filter((n) => n.startsWith('inline_'))
      .map((n) => Number(n.replace('inline_L', '')))
    const firstUse = Math.min(...evaluatedLines)
    for (const [name, line] of Object.entries(boundLines)) {
      expect(line, `${name} is defined at L${line}, which must precede every evaluated site (first L${firstUse})`).toBeLessThan(firstUse)
    }
  })

  it('every injected payload parses as a function body', () => {
    const failures: string[] = []
    for (const [name, code] of Object.entries(payloads)) {
      const result = parsesAsFunctionBody(code)
      if (!result.ok) failures.push(name + ' -> ' + result.error + '\n    ' + code.slice(0, 160))
    }
    expect(failures, 'syntactically invalid injected JavaScript:\n' + failures.join('\n')).toEqual([])
  })

  it('reverse anchor: the payload that actually broke the hosted run must be rejected', () => {
    // Verbatim shape of the defect this guard exists for. If this ever parses, the guard is blind.
    const broken = 'return document.querySelectorAll("[data-testid^="card-"] button").length;'
    const result = parsesAsFunctionBody(broken)
    expect(result.ok, 'the known-bad payload must NOT parse').toBe(false)
    expect(result.ok ? '' : result.error).toMatch(/missing \)|Unexpected|Invalid/i)
  })

  it('reverse anchor: an unescaped quote or a stray newline must be rejected', () => {
    expect(parsesAsFunctionBody("return 'unterminated;").ok).toBe(false)
    expect(parsesAsFunctionBody('return "a\nb";').ok).toBe(false)
  })
})
