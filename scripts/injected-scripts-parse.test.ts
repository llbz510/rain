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
  /** Every call site, with the payload it produced or the reason it could not. */
  sites: CollectedSite[]
  /** Call sites that yielded no payload, keyed by the same stable site key. */
  skippedCallSites: Record<string, string>
  /** Line the collector defines each bound constant on, so staleness can be asserted. */
  boundLines: Record<string, number>
}

interface CollectedSite {
  /** Stable identity: `<command>#<ordinal>`. Deliberately NOT a line number. */
  key: string
  command: string
  line: number
  text: string
  payload: string
  reason: string
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
    // Call sites are identified by `<command>#<ordinal>` and NOT by line number. Line numbers looked like a
    // stable key and are not: adding a few lines to the collector silently re-pointed every key (and the
    // guard then failed for a reason that had nothing to do with injected JavaScript). The ordinal only
    // moves if a call site is inserted before another one, which is a change worth reviewing anyway.
    '$siteOrdinals = @{}',
    '$sites = [ordered]@{}',
    '$calls = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)',
    'foreach ($call in $calls) {',
    '  $elements = @($call.CommandElements)',
    '  if ($elements.Count -lt 1) { continue }',
    '  $commandName = $elements[0].Extent.Text',
    '  if (-not $payloadFunctions.ContainsKey($commandName)) { continue }',
    '  $params = @($elements | Select-Object -Skip 1)',
    '  $scriptIndex = $payloadFunctions[$commandName]',
    '  $scriptCalls++',
    // A call site that cannot even carry the script argument is counted and catalogued, never skipped in
    // silence -- verification showed a bare `continue` here was invisible to every assertion.
    '  if ($params.Count -le $scriptIndex) {',
    '    $noScriptArgCalls++',
    '    $tooFew = $scriptCalls',
    '    $sites[$commandName + "#" + $tooFew] = [ordered]@{ command = $commandName; line = $call.Extent.StartLineNumber; text = ""; reason = "[too few arguments to carry a script]" }',
    '    continue',
    '  }',
    '  $ordinal = if ($siteOrdinals.ContainsKey($commandName)) { $siteOrdinals[$commandName] + 1 } else { 1 }',
    '  $siteOrdinals[$commandName] = $ordinal',
    '  $key = $commandName + "#" + $ordinal',
    '  $arg = $params[$scriptIndex]',
    '  $line = $call.Extent.StartLineNumber',
    '  $record = [ordered]@{ command = $commandName; line = $line; text = $arg.Extent.Text; payload = ""; reason = "" }',
    // Whether a site can be evaluated is decided by its ARGUMENT, not by where it lives: the collector's
    // top-level constants are bound above, so an argument that merely references them is evaluated for
    // real. Only genuinely local values ($configJson) and parameters ($Script/$script/$Desc) stay
    // unevaluated -- and those are catalogued rather than dropped.
    '  $vars = @($arg.FindAll({ param($n) $n -is [System.Management.Automation.Language.VariableExpressionAst] }, $true) | ForEach-Object { $_.VariablePath.UserPath })',
    '  $unbound = @($vars | Where-Object { $allowed -notcontains $_ })',
    '  if ($unbound.Count -eq 0) {',
    '    try { $value = Invoke-Expression $arg.Extent.Text } catch { $value = $null }',
    // A resolved value must not still contain an UNEXPANDED PowerShell variable (`$` followed by a name):
    // that would mean a variable survived into the text and the payload is not the real bytes. Treating it
    // as a payload would be a false green. A bare `$` is fine -- the real payloads contain JS template
    // literals like `${...}`.
    `    if ($value -is [string] -and $value.Length -ge 8 -and $value -notmatch '\$[\w({]') { $record["payload"] = $value }`,
    '  }',
    '  if (-not $record["payload"]) {',
    '    $owner = $funcs | Where-Object { $_.Extent.StartOffset -le $call.Extent.StartOffset -and $_.Extent.EndOffset -ge $call.Extent.EndOffset } | Select-Object -First 1',
    '    $where = if ($owner) { "[in function " + $owner.Name + "] " } else { "" }',
    '    $why = if ($unbound.Count -gt 0) { "[unbound: " + ($unbound -join ",") + "] " } else { "[did not evaluate to a string] " }',
    '    $record["reason"] = $where + $why',
    '  }',
    '  $sites[$key] = $record',
    '}',
    '$out["_scriptCalls"] = [string]$scriptCalls',
    '$out["_noScriptArgCalls"] = [string]$noScriptArgCalls',
    '$out["_boundLines"] = $boundLines',
    '$out["_sites"] = $sites',
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
  const sites: CollectedSite[] = []
  for (const [key, value] of Object.entries(raw)) {
    if (key === '_scriptCalls') continue
    if (key === '_noScriptArgCalls') continue
    if (key === '_boundLines') {
      for (const [name, line] of Object.entries(value as Record<string, string>)) boundLines[name] = Number(line)
      continue
    }
    if (key === '_sites') {
      for (const [siteKey, site] of Object.entries(value as Record<string, Record<string, string>>)) {
        sites.push({
          key: siteKey,
          command: String(site.command),
          line: Number(site.line),
          text: String(site.text ?? ''),
          payload: String(site.payload ?? ''),
          reason: String(site.reason ?? ''),
        })
      }
      continue
    }
    payloads[key] = String(value)
  }
  // Payloads are keyed by the site key, so the two views cannot drift apart.
  for (const site of sites) {
    if (site.payload) payloads[site.key] = site.payload
    else skippedCallSites[site.key] = site.reason + site.text
  }
  return {
    payloads,
    scriptCalls: Number(raw._scriptCalls),
    noScriptArgCalls: Number(raw._noScriptArgCalls),
    sites,
    skippedCallSites,
    boundLines,
  }
}

describe('injected browser scripts must parse before they are ever sent', () => {
  const { payloads, scriptCalls, noScriptArgCalls, sites, skippedCallSites, boundLines } = collectPayloads()

  /** Find the site whose argument text contains `needle`; fails loudly rather than returning undefined. */
  function siteWithArgument(needle: string): CollectedSite {
    const matches = sites.filter((s) => s.text.includes(needle))
    expect(matches.length, `expected exactly one call site whose argument contains ${needle}`).toBe(1)
    return matches[0]
  }

  /** The raw argument text of one catalogued gap, so its reason can be asserted by content. */
  function gapText(gaps: CollectedSite[], key: string): string {
    const gap = gaps.find((g) => g.key === key)
    expect(gap, `gap ${key} must exist`).toBeDefined()
    return gap!.text
  }

  it('collects the probe script, the arm statements and the inline scripts', () => {
    const names = Object.keys(payloads)
    expect(names).toContain('probeScript')
    expect(names).toContain('arm_list')
    expect(names).toContain('arm_settings')
    expect(names).toContain('arm_study')
    expect(sites.length, 'payload-bearing call sites must be collected').toBeGreaterThan(0)
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
    // Sites are keyed `<command>#<ordinal>`, never by line number: line numbers moved the moment the
    // collector gained a few lines, silently re-pointing every key (this guard failed for exactly that
    // reason while being extended).
    expect(sites.length, 'sites: ' + sites.map((s) => `${s.key}@L${s.line}`).join(', ')).toBe(16)
    expect(scriptCalls, 'every payload-bearing call site must still be counted').toBe(16)
    expect(noScriptArgCalls, 'no call site may omit its script argument').toBe(0)

    // The two counters must PARTITION the site table exactly: each site either produced a payload or is
    // catalogued with a reason. A site leaving through a bare `continue` would be invisible otherwise.
    const evaluated = sites.filter((s) => s.payload)
    const gaps = sites.filter((s) => !s.payload)
    expect(evaluated.length + gaps.length, 'payloads + gaps must equal the site total').toBe(sites.length)
    for (const gap of gaps) {
      expect(gap.reason, `gap ${gap.key} must record WHY it could not be evaluated`).not.toBe('')
    }
    expect(evaluated.length, 'evaluated sites: ' + evaluated.map((s) => s.key).join(', ')).toBe(14)

    // Both payload families are represented: the six condition scripts are the second false-green above.
    expect(sites.filter((s) => s.command === 'Invoke-WebDriverScript').length).toBe(10)
    expect(sites.filter((s) => s.command === 'Wait-WebDriverCondition').length).toBe(6)
    for (const site of sites.filter((s) => s.command === 'Wait-WebDriverCondition')) {
      expect(site.payload, `${site.key} (a condition script) must be evaluated`).not.toBe('')
    }

    // The only call site that never yields real bytes out here is the forwarded parameter; the other gap is
    // Invoke-VisualProbe's function-local config. Both are plumbing, and both must say so.
    // (Ordinals follow document order, so the helper's own definition comes first.)
    expect(
      gaps.map((g) => g.key).sort(),
      'gaps: ' + JSON.stringify(gaps.map((g) => ({ key: g.key, reason: g.reason, text: g.text.slice(0, 80) }))),
    ).toEqual(['Invoke-WebDriverScript#1', 'Invoke-WebDriverScript#2'])
    for (const gap of gaps) {
      expect(gap.reason, `gap ${gap.key} must name the unbound variable`).toMatch(/\[unbound: \w+\]/)
    }
    expect(gapText(gaps, 'Invoke-WebDriverScript#1')).toContain('$Script')
    expect(gapText(gaps, 'Invoke-WebDriverScript#2')).toContain('$configJson')

    // The defect that started all this is a real, evaluated call site -- not an exempted one.
    const fixedSite = siteWithArgument('[data-testid^="card-"] button')
    expect(fixedSite.payload, 'the fixed call site must be evaluated, not exempted').not.toBe('')
    expect(fixedSite.command).toBe('Invoke-WebDriverScript')
    // The sites the old regex dropped that ARE resolvable must now be evaluated.
    for (const needle of ['navigator.userAgent', 'JSON.stringify($probeInterface)', 'f.seed()']) {
      expect(siteWithArgument(needle).payload, `${needle} must now be evaluated`).not.toBe('')
    }

    // The bound constants must be the assignments that actually feed the call sites. If the collector
    // re-assigned one of them between its definition and first use, the guard would evaluate the wrong
    // bytes and stay green -- review flagged that this equivalence was previously unguarded.
    // (The binding helper already picks the LAST assignment before the call sites; this asserts the
    // recorded position is genuinely upstream of every evaluated site.)
    expect(Object.keys(boundLines).sort()).toEqual(['probeInterface', 'probeScript', 'tolerance', 'toleranceBasis'])
    const firstUse = Math.min(...evaluated.map((s) => s.line))
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

// ---------------------------------------------------------------------------------------------
// The probe RECORD SHAPE. Parsing is necessary but not sufficient: a payload can be perfectly
// valid JavaScript and still write a record the contract rejects. These tests run the collector's
// real probe against a real DOM, so the record is judged by what it actually produces.
// ---------------------------------------------------------------------------------------------

/** Lift the collector's probe here-string out of the PowerShell source, exactly as it is injected. */
function extractProbeScript(): string {
  const lines = readFileSync(join(repoRoot, 'scripts', 'campaign-visual-evidence.ps1'), 'utf8').split('\n')
  const startMarker = "$probeScript = @'"
  let start = -1
  let end = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (start === -1 && lines[index].trim() === startMarker) {
      start = index + 1
      continue
    }
    if (start !== -1 && lines[index].trim() === "'@") {
      end = index - 1
      break
    }
  }
  expect(start, 'probe here-string opening not found').toBeGreaterThan(-1)
  expect(end, 'probe here-string terminator not found').toBeGreaterThan(start)
  return lines.slice(start, end + 1).join('\n')
}

interface ProbeRecord {
  probeId: string
  missing?: boolean
  measured?: {
    role?: string
    bg?: { declared?: string; rgba8?: number[]; alpha?: number; composited?: boolean; layers?: unknown[] }
    fg?: { declared?: string; rgba8?: number[] }
    border?: {
      rgba8?: Record<string, number[]>
      declaredComputed?: Record<string, string>
      rendered?: Record<string, boolean>
    }
    outline?: { rgba8?: number[]; declaredComputed?: string; style?: string; widthPx?: number; rendered?: boolean }
  }
}

/**
 * Run the real probe against a minimal page and return its records.
 *
 * `virtualConsole` swallows jsdom CSS noise: the probe only reads inline styles here, and jsdom's
 * "could not parse CSS stylesheet" chatter for attribute selectors is irrelevant to the record.
 */
async function runProbeOn(html: string, specs: unknown[]): Promise<ProbeRecord[]> {
  const { JSDOM, VirtualConsole } = await import('jsdom')
  const virtualConsole = new VirtualConsole()
  const pageErrors: string[] = []
  virtualConsole.on('jsdomError', (error: unknown) => pageErrors.push(String(error)))
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { virtualConsole, pretendToBeVisual: true })
  const { window } = dom
  // The probe waits on `document.fonts.ready` before measuring. jsdom does not implement the Font
  // Loading API, so that await never settles and the probe would hang instead of recording. Stubbing
  // it is faithful: the probe already treats font readiness as best-effort (it catches and continues).
  Object.defineProperty(window.document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true })
  const globals = globalThis as unknown as Record<string, unknown>
  const saved = new Map<string, unknown>()
  for (const name of ['window', 'document', 'getComputedStyle', 'requestAnimationFrame']) {
    saved.set(name, globals[name])
    globals[name] = (window as unknown as Record<string, unknown>)[name]
  }
  // The probe reads its config off `window`, so it must be set on the jsdom window as well.
  // `tolerance`/`toleranceBasis` are part of the real config the collector sends (`Invoke-VisualProbe`
  // builds them from the frozen contract), so the harness must supply them too or every record throws.
  const config = {
    specs,
    accentSweeps: [],
    tolerance: { contrastRatio: 0.05, colorChannel: 1 },
    toleranceBasis: 'visual-contract.md',
  }
  ;(window as unknown as Record<string, unknown>).__RAIN_VISUAL_PROBE_CONFIG__ = config
  globals.__RAIN_VISUAL_PROBE_CONFIG__ = config
  try {
    const probe = extractProbeScript()
    // The payload returns 'armed' IMMEDIATELY and finishes measuring in a detached async IIFE, so the
    // result must be awaited rather than read right after the call returns.
    // eslint-disable-next-line no-new-func
    await new Function(probe)()
    const armedWindow = window as unknown as { __RAIN_VISUAL_PROBE__?: { results?: ProbeRecord[] } }
    const deadline = Date.now() + 5000
    while (!armedWindow.__RAIN_VISUAL_PROBE__ && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    if (!armedWindow.__RAIN_VISUAL_PROBE__) {
      // Surface WHY instead of a bare timeout: the probe finishes in a detached async IIFE whose
      // rejection would otherwise be invisible here.
      throw new Error('probe never armed; page errors: ' + JSON.stringify(pageErrors))
    }
    const armed = armedWindow.__RAIN_VISUAL_PROBE__
    expect(armed, 'the probe must arm window.__RAIN_VISUAL_PROBE__').toBeDefined()
    return armed!.results ?? []
  } finally {
    for (const [name, value] of saved) globals[name] = value
    window.close()
  }
}

describe('the collector probe writes records the contract accepts', () => {
  it('measured.bg.declared is the COMPOSITED opaque colour, not the element raw backgroundColor', async () => {
    // Contract §3.2: rgba values are compared only after being composited onto an opaque backdrop.
    // validate-visual-evidence.ps1 enforces this with Assert-DecomposedColour: `declared` must be
    // opaque AND within ±1/channel of the composited `rgba8`.
    //
    // The element below is exactly the shape that broke a real hosted run: the measured element's own
    // backgroundColor is fully transparent, so `declared` used to be "rgba(0, 0, 0, 0)" while `rgba8`
    // correctly held the composited ancestor colour -- and the package failed its own self-validation.
    // Both sides must therefore be the composite.
    const results = await runProbeOn(
      '<div id="page" style="background-color: rgb(26, 26, 26)"><span id="label" style="background-color: rgba(0, 0, 0, 0); color: rgb(229, 229, 229)">x</span></div>',
      [
        {
          id: 'anchor-transparent-bg',
          vc: 'VC-01',
          criterion: 'backgroundLuminanceBelow0.05',
          page: 'video-list',
          selector: '#label',
          description: 'anchor',
        },
      ],
    )
    const record = results.find((entry) => entry.probeId === 'anchor-transparent-bg')
    expect(record, 'the probe must return a record for the spec').toBeDefined()
    expect(record!.missing, 'the anchor element must be found').toBeFalsy()
    const bg = record!.measured!.bg!
    // The composite of a transparent layer over rgb(26,26,26) is rgb(26,26,26).
    expect(bg.rgba8, 'rgba8 is the composite').toEqual([26, 26, 26])
    expect(bg.declared, 'declared must be the same opaque composite, not rgba(0, 0, 0, 0)').toBe('rgb(26, 26, 26)')
    expect(bg.declared, 'declared must not be a transparent value').not.toMatch(/rgba?\([^)]*,\s*0(\.0+)?\s*\)/)
    expect(bg.alpha, 'declared/rgba8 are opaque').toBe(1)
    expect(bg.composited).toBe(true)
    // The raw computed value is kept for traceability, so nothing is lost by the change.
    expect((bg as unknown as { declaredComputed?: string }).declaredComputed).toBe('rgba(0, 0, 0, 0)')
  })

  it('records a composited channel for every border side and for the outline', async () => {
    // A border-token criterion measures the BORDER colour, but the record used to have no border
    // channel at all: the value sat in computedStyle.borderTopColor as text, so the validator could not
    // check the declared token against anything and failed the record
    // (run 36574308748, VC-02-settings-topbar-border: 'declaredToken ... cannot explain this measurement').
    // Each side and the outline now gets an opaque composited channel.
    const results = await runProbeOn(
      '<div id="page" style="background-color: rgb(26, 26, 26)">' +
        // Long-hand properties on purpose: jsdom does not expand the `border`/`outline` shorthands, and
        // getComputedStyle would then report empty strings for the very properties under test.
        '<span id="bordered" style="color: rgb(229, 229, 229); border-top-width: 1px; border-top-style: solid; border-top-color: rgb(110, 112, 116); border-left-width: 1px; border-left-style: solid; border-left-color: rgba(0, 0, 0, 0); outline-color: rgb(74, 158, 255); outline-style: dashed; outline-width: 2px">x</span>' +
        '</div>',
      [
        {
          id: 'anchor-border',
          vc: 'VC-02',
          criterion: 'neutralScaleBorderToken',
          page: 'video-list',
          selector: '#bordered',
          description: 'anchor',
          nonText: true,
          colorRole: 'border',
          declaredToken: '--color-border',
          declaredTokenValue: '#6e7074',
        },
      ],
    )
    const record = results.find((entry) => entry.probeId === 'anchor-border')
    expect(record, 'the probe must return a record for the spec').toBeDefined()
    const border = record!.measured!.border!
    expect(border, 'the record must carry a border channel').toBeDefined()
    expect(Object.keys(border.rgba8 ?? {}).sort(), 'all four sides must be recorded').toEqual([
      'borderbottom',
      'borderleft',
      'borderright',
      'bordertop',
    ])
    // The declared border colour is present and opaque.
    expect(border.rgba8!.bordertop, 'the top border is measured').toEqual([110, 112, 116])
    // A transparent side composites onto the backdrop instead of staying rgba(0,0,0,0).
    expect(border.rgba8!.borderleft, 'a transparent side composites onto the backdrop').toEqual([26, 26, 26])
    expect(border.declaredComputed!.borderleft, 'the raw computed value is still traceable').toContain('rgba')
    // Rendering state is explicit rather than implied.
    expect(border.rendered!.top).toBe(true)
    expect(border.rendered!.left).toBe(true)
    // The outline is its own channel, with its style and width.
    const outline = record!.measured!.outline!
    expect(outline.rgba8, 'the outline colour is measured').toEqual([74, 158, 255])
    expect(outline.style, 'the outline style is recorded').toBe('dashed')
    expect(outline.rendered, 'a rendered outline says so').toBe(true)
    // S8：渲染中的轮廓才交出真实宽度（`widthPx`），未渲染时它是 null 并由
    // `widthPxIsReservedInitial` 标注"浏览器报的是保留初始值"。这里的轮廓是 `dashed` + `2px`，
    // 所以两者都必须按"渲染中"写。
    expect(outline.widthPx, 'a painted outline reports its real width').toBe(2)
    expect(outline.widthPxIsReservedInitial, 'a painted outline is not a reserved initial width').toBe(false)
    // The measured ROLE is a structural fact, so the validator can map token -> channel.
    expect(record!.measured!.role, 'the record declares which colour role it measured').toBe('border')
  })

  it('marks an unrendered outline as not rendered instead of pretending it was measured', async () => {
    const results = await runProbeOn(
      '<div id="page" style="background-color: rgb(26, 26, 26)">' +
        '<span id="plain" style="color: rgb(229, 229, 229); outline-style: none; outline-color: rgb(74, 158, 255); outline-width: 0px">x</span>' +
        '</div>',
      [
        {
          id: 'anchor-no-outline',
          vc: 'VC-03',
          criterion: 'focusRing2pxDashedFg',
          page: 'video-list',
          selector: '#plain',
          description: 'anchor',
          colorRole: 'graphic',
        },
      ],
    )
    const outline = results.find((entry) => entry.probeId === 'anchor-no-outline')!.measured!.outline!
    // outline-style: none means the colour is not painted; the record must say so rather than let a
    // "measured" outline colour stand in for a focus ring that was never drawn.
    expect(outline.rendered, 'an outline that is not painted must say so').toBe(false)
    expect(outline.style, 'the unrendered style is recorded verbatim').toBe('none')
    expect(outline.rgba8, 'the channel still exists so the shape is stable').toBeDefined()
    // S8：未渲染的轮廓**没有**宽度可言——浏览器在这里报的 `0px`（或 Chromium 的保留初始值 `3px`）
    // 都不是"画出来的宽度"。记录必须写 null，并显式标注该宽度的来源性质。
    expect(outline.widthPx, 'an unpainted outline has no width to report').toBeNull()
    expect(outline.widthPxIsReservedInitial, 'the record says the computed width is not a measured width').toBe(true)
  })
})
