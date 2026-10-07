import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 采集器自检：**写记录之前**断言「记录实际写出的 computedStyle 键集合 == 契约键集合」，
 * 不等则当场失败并逐个点名缺/多。
 *
 * 为什么必须有它（真实事故，2026-10-07，两次同提交复现）：托管采集的 34 条记录少了
 * `computedStyle.borderRadius`，而**源码里两侧都是 28 键、逐项相同**——那份"契约判据
 * （两份源码对比）"全绿，却挡不住"运行期产出的记录少键"。当时只有托管采集的自校验
 * 阶段（一轮 ~12 分钟）才暴露，而且只说"缺少字段"，不告诉你一共缺几个、是哪些。
 *
 * 本文件裁判的是**采集器里那段自检逻辑本身**：
 *   ① 契约键集合与校验器的必填集一致（两侧都从源码解析）；
 *   ② `Compare-ComputedStyleKeys` 能点名缺/多（纯函数，直接裁判）；
 *   ③ `Assert-ComputedStyleKeys` 不齐就抛，且消息里含具体键名（fail-closed）。
 *
 * 逻辑是 PowerShell，因此这里用 **pwsh/powershell 真的执行**它（不从源码正则猜行为）：
 * 把采集器里那段函数抽出来喂给 PowerShell，再传入构造好的键集合看结果。
 */
const repoRoot = join(__dirname, '..')
const collectorPath = join(repoRoot, 'scripts', 'campaign-visual-evidence.ps1')
const validatorPath = join(repoRoot, 'scripts', 'validate-visual-evidence.ps1')

function normalize(path: string): string {
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
}

/**
 * 剔掉 PowerShell / JavaScript 注释，同时原样保留字符串字面量（2026-10-08，st5）。
 *
 * 为什么键提取必须先过这一道：两份源码的键数组里**本来就有注释**（采集器的
 * `$script:ComputedStyleContractKeys` 带逐键说明，校验器那份带 # 说明）。朴素的
 * "抓所有单引号 token"会把**注释里的引号 token 当成键**——那会报一个真实不存在的
 * "多余键"或"缺失键"，是**假红**；修假红的人会去改一份本来正确的集合。
 *
 * 为什么不能用一个简单正则去注释：值的字面量里会出现双斜杠（URL）与斜杠星号，
 * 简单正则会**把值当注释删掉**，反而把真实存在的键吃掉 → 漏检（更危险的方向）。
 * 所以这里用逐字符状态机，并在两种语言的注释语法上都成立：
 * PowerShell 的井号行注释 / 尖括号井号块注释，以及 JS 的双斜杠、斜杠星号。
 *
 * 这个副本与 `visual-style-contract-alignment.test.ts` 里那份**语义相同**：
 * 仓库惯例是测试文件之间不互相 import，所以两处各留一份；两处都有各自的注入证明。
 */
function stripComments(source: string): string {
  const BACKTICK = String.fromCharCode(96)
  type State = 'code' | 'single' | 'double' | 'template' | 'lineComment' | 'blockComment'
  const chunks: string[] = []
  let state: State = 'code'
  let index = 0
  const prev = (): string => {
    for (let i = chunks.length - 1; i >= 0; i -= 1) {
      if (chunks[i].length > 0) return chunks[i][chunks[i].length - 1]
    }
    return '\n'
  }
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (state === 'code') {
      if (char === '/' && next === '/') { state = 'lineComment'; index += 2; continue }
      if (char === '/' && next === '*') { state = 'blockComment'; chunks.push('  '); index += 2; continue }
      if (char === '<' && next === '#') { state = 'blockComment'; chunks.push('  '); index += 2; continue }
      // 井号只在 token 边界起注释：颜色字面量与字符串里的井号不受影响。
      if (char === '#' && /[\s(),=|]/.test(prev())) { state = 'lineComment'; index += 1; continue }
      if (char === "'") state = 'single'
      else if (char === '"') state = 'double'
      else if (char === BACKTICK) state = 'template'
      chunks.push(char)
      index += 1
      continue
    }
    if (state === 'lineComment') {
      if (char === '\n') { state = 'code'; chunks.push(char) }
      else chunks.push(' ')
      index += 1
      continue
    }
    if (state === 'blockComment') {
      if (char === '*' && next === '/') { state = 'code'; chunks.push('  '); index += 2; continue }
      if (char === '#' && next === '>') { state = 'code'; chunks.push('  '); index += 2; continue }
      chunks.push(char === '\n' ? '\n' : ' ')
      index += 1
      continue
    }
    chunks.push(char)
    if (char === '\\') { chunks.push(next ?? ''); index += 2; continue }
    if (state === 'single' && char === "'") state = 'code'
    else if (state === 'double' && char === '"') state = 'code'
    else if (state === 'template' && char === BACKTICK) state = 'code'
    index += 1
  }
  return chunks.join('')
}

/** 抽出 `$script:ComputedStyleContractKeys = @( ... )` 的键 */
function extractContractKeys(source: string): string[] {
  const anchor = source.indexOf('$script:ComputedStyleContractKeys')
  if (anchor < 0) throw new Error('采集器里找不到 $script:ComputedStyleContractKeys')
  const open = source.indexOf('@(', anchor)
  let depth = 0
  let end = -1
  for (let i = open + 1; i < source.length; i += 1) {
    const c = source[i]
    if (c === '(') depth += 1
    else if (c === ')') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  const body = stripComments(source.slice(open, end))
  return [...body.matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1])
}

/** 抽出校验器的必填集 */
function extractValidatorKeys(source: string): string[] {
  const anchor = source.indexOf('$script:RequiredComputedStyleKeys')
  if (anchor < 0) throw new Error('校验器里找不到 RequiredComputedStyleKeys')
  const open = source.indexOf('@(', anchor)
  let depth = 0
  let end = -1
  for (let i = open + 1; i < source.length; i += 1) {
    const c = source[i]
    if (c === '(') depth += 1
    else if (c === ')') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  const body = stripComments(source.slice(open, end))
  return [...body.matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1])
}

/** 把采集器里的纯函数与断言函数抽出来，交给 PowerShell 真跑 */
function extractFunction(source: string, name: string): string {
  const at = source.indexOf(`function ${name}(`)
  if (at < 0) throw new Error(`采集器里找不到 function ${name}`)
  const open = source.indexOf('{', at)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(at, i + 1)
    }
  }
  throw new Error(`${name} 未闭合`)
}

/**
 * 按大括号配平取出**整个函数体**（含 `function` 关键字与花括号）。
 *
 * 为什么不许用固定字符窗口（2026-10-08 复审 STD-1）：`measure()` 有上千字符，而
 * `slice(at, at + 700)` 这类窗口只要真实缺陷落在窗口之外就是"看起来在守、其实守不住"。
 * 复审实测：把同一处 `throw new Error` 放到距读取点 8000+ 字符处，旧窗口判据全绿。
 * 凡是要断言"某函数内部不许出现某形态"，都必须按边界切。
 */
function extractFunctionSource(source: string, name: string): string {
  return extractFunction(source, name)
}

function powershellExe(): string {
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    try {
      execFileSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$null'], { stdio: 'pipe' })
      return candidate
    } catch {
      // 继续找下一个
    }
  }
  throw new Error('需要 pwsh.exe 或 powershell.exe')
}

/** 真跑一段 PowerShell，返回 { stdout, status } */
function runPowerShell(script: string): { stdout: string; status: number } {
  const exe = powershellExe()
  try {
    const stdout = execFileSync(exe, ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: repoRoot,
    })
    return { stdout, status: 0 }
  } catch (cause) {
    const failure = cause as { status?: number; stdout?: string; stderr?: string }
    return { stdout: `${failure.stdout ?? ''}${failure.stderr ?? ''}`, status: failure.status ?? 1 }
  }
}

const collectorSource = normalize(collectorPath)
const validatorSource = normalize(validatorPath)
const contractKeys = extractContractKeys(collectorSource)
const compareFn = extractFunction(collectorSource, 'Compare-ComputedStyleKeys')
const assertFn = extractFunction(collectorSource, 'Assert-ComputedStyleKeys')

describe('采集器自检：契约键集合 == 校验器必填集（两侧都从源码解析）', () => {
  it('集合逐项相等（多一个、少一个都算漂移）', () => {
    const required = extractValidatorKeys(validatorSource)
    expect(
      { missing: required.filter((k) => !contractKeys.includes(k)), extra: contractKeys.filter((k) => !required.includes(k)) },
      `采集器契约与校验器必填集不一致\n  采集器 ${contractKeys.length} 个：${contractKeys.join(', ')}\n  校验器 ${required.length} 个：${required.join(', ')}`,
    ).toEqual({ missing: [], extra: [] })
  })

  it('集合非空且无重复', () => {
    expect(contractKeys.length).toBe(28)
    expect(new Set(contractKeys).size).toBe(contractKeys.length)
  })

  /**
   * st5 的"能失败"证明（2026-10-08）：键数组里**本来就有注释**，注释里也会出现带引号的
   * 名字。不去注释的提取器会把它们当成键 → 假红。下面先证明"注入的注释确实含引号 token"
   * （配对反证，若这条不红说明注入没造出可被误读的东西），再证明注释感知的提取器不受影响。
   */
  it('注入证明 ⑫（st5 · 采集器契约键数组）：注释里的引号 token 不得被当成键', () => {
    const naiveKeys = (source: string): string[] => {
      const anchor = source.indexOf('$script:ComputedStyleContractKeys')
      const open = source.indexOf('@(', anchor)
      let depth = 0
      let end = -1
      for (let i = open + 1; i < source.length; i += 1) {
        const c = source[i]
        if (c === '(') depth += 1
        else if (c === ')') {
          depth -= 1
          if (depth === 0) { end = i; break }
        }
      }
      return [...source.slice(open, end).matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1])
    }
    const broken = collectorSource.replace(
      '$script:ComputedStyleContractKeys = @(',
      "$script:ComputedStyleContractKeys = @(\n  # 说明里点名 'zIndexInjected'：它是注释，不是键",
    )
    expect(broken, '注入本身要生效').not.toBe(collectorSource)
    // 配对反证：不剔注释的提取器确实会把注释里的 token 当成键。
    expect(naiveKeys(broken)).toContain('zIndexInjected')
    // 注释感知的提取器不会，且集合仍恰好是 28 个、无重复。
    const keys = extractContractKeys(broken)
    expect(keys, '注释里的 token 不得进入契约键集合').not.toContain('zIndexInjected')
    expect(keys.length, '注释不得改变键的数量').toBe(28)
    expect(new Set(keys).size).toBe(keys.length)
    // 且仍与校验器必填集逐项相等（真键一个不少、假键一个不多）。
    const required = extractValidatorKeys(validatorSource)
    expect({ missing: required.filter((k) => !keys.includes(k)), extra: keys.filter((k) => !required.includes(k)) })
      .toEqual({ missing: [], extra: [] })
  })

  it('注入证明 ⑬（st5 · 校验器必填集）：注释里的引号 token 不得被当成必填键', () => {
    const broken = validatorSource.replace(
      '$script:RequiredComputedStyleKeys = @(',
      "$script:RequiredComputedStyleKeys = @(\n  # 说明里点名 'columnGap' 与 'rowGap'：它们是注释，不是必填键",
    )
    expect(broken, '注入本身要生效').not.toBe(validatorSource)
    const required = extractValidatorKeys(broken)
    expect(required, '校验器注释里的 token 不得进入必填集').not.toContain('columnGap')
    expect(required, '校验器注释里的 token 不得进入必填集').not.toContain('rowGap')
    expect({ missing: required.filter((k) => !contractKeys.includes(k)), extra: contractKeys.filter((k) => !required.includes(k)) })
      .toEqual({ missing: [], extra: [] })
  })
})

describe('采集器自检：Compare/Assert 的行为（PowerShell 真跑，不是正则猜）', () => {
  const contract = contractKeys.map((k) => `'${k}'`).join(', ')

  it('键集合齐备 → Compare 报 ok=true，Assert 不抛', () => {
    const script = `
${compareFn}
${assertFn}
$keys = @(${contract})
$result = Compare-ComputedStyleKeys $keys @(${contract})
Write-Output ("ok=" + $result.ok)
Assert-ComputedStyleKeys $keys @(${contract}) 'probe'
Write-Output 'assert-passed'
`
    const { stdout, status } = runPowerShell(script)
    expect(status, stdout).toBe(0)
    expect(stdout).toContain('ok=True')
    expect(stdout).toContain('assert-passed')
  })

  it('注入证明 ①：少一个键（borderRadius）→ Assert 抛错并**点名**该键', () => {
    const script = `
${compareFn}
${assertFn}
$keys = @(${contract} | Where-Object { $_ -ne 'borderRadius' })
$result = Compare-ComputedStyleKeys $keys @(${contract})
Write-Output ("missing=" + ($result.missing -join ','))
Write-Output ("ok=" + $result.ok)
Assert-ComputedStyleKeys $keys @(${contract}) 'element 记录 VC-XX'
Write-Output 'should-not-reach'
`
    const { stdout, status } = runPowerShell(script)
    expect(status, '必须 fail-closed').not.toBe(0)
    expect(stdout).toContain('missing=borderRadius')
    expect(stdout).toContain('ok=False')
    expect(stdout).toContain('缺少 1 个：borderRadius')
    expect(stdout).not.toContain('should-not-reach')
  })

  it('注入证明 ②：多一个键 → Assert 抛错并点名该键', () => {
    const script = `
${compareFn}
${assertFn}
$keys = @(${contract}) + @('zIndexInjected')
$result = Compare-ComputedStyleKeys $keys @(${contract})
Write-Output ("extra=" + ($result.extra -join ','))
Assert-ComputedStyleKeys $keys @(${contract}) 'element 记录 VC-XX'
Write-Output 'should-not-reach'
`
    const { stdout, status } = runPowerShell(script)
    expect(status, '必须 fail-closed').not.toBe(0)
    expect(stdout).toContain('extra=zIndexInjected')
    expect(stdout).toContain('多出 1 个：zIndexInjected')
    expect(stdout).not.toContain('should-not-reach')
  })

  it('注入证明 ④（值层面）：**名字齐备但某值为空** → 必须判红并点名该键', () => {
    // 只查"键齐不齐"是不够的：校验器对空值与缺键一视同仁（Length -eq 0），
    // 所以"28 个名字齐备、borderRadius 是空串"仍会在 12 分钟后的自校验阶段才红。
    // 这里把同一判据提前到采集当场，并证明它有牙。
    const compareValuesFn = extractFunction(collectorSource, 'Compare-ComputedStyleValues')
    const assertValuesFn = extractFunction(collectorSource, 'Assert-ComputedStyleValues')
    const props = contractKeys.map((k) => `  ${k} = ${k === 'borderRadius' ? "''" : "'x'"}`).join('\n')
    const script = `
${compareValuesFn}
${assertValuesFn}
$style = [pscustomobject]@{
${props}
}
$keys = @(${contract})
$result = Compare-ComputedStyleValues $style $keys
Write-Output ("empty=" + ($result.empty -join ','))
Write-Output ("ok=" + $result.ok)
Assert-ComputedStyleValues $style $keys 'element 记录 VC-XX'
Write-Output 'should-not-reach'
`
    const { stdout, status } = runPowerShell(script)
    expect(status, '值层面必须 fail-closed').not.toBe(0)
    expect(stdout).toContain('empty=borderRadius')
    expect(stdout).toContain('ok=False')
    expect(stdout).toContain('borderRadius')
    expect(stdout).not.toContain('should-not-reach')
  })

  it('注入证明 ⑤（值层面反证）：全部键都有非空值 → Compare 报 ok=true，Assert 不抛', () => {
    const compareValuesFn = extractFunction(collectorSource, 'Compare-ComputedStyleValues')
    const assertValuesFn = extractFunction(collectorSource, 'Assert-ComputedStyleValues')
    const props = contractKeys.map((k) => `  ${k} = 'x'`).join('\n')
    const script = `
${compareValuesFn}
${assertValuesFn}
$style = [pscustomobject]@{
${props}
}
$keys = @(${contract})
$result = Compare-ComputedStyleValues $style $keys
Write-Output ("ok=" + $result.ok)
Assert-ComputedStyleValues $style $keys 'element 记录 VC-XX'
Write-Output 'assert-passed'
`
    const { stdout, status } = runPowerShell(script)
    expect(status, stdout).toBe(0)
    expect(stdout).toContain('ok=True')
    expect(stdout).toContain('assert-passed')
  })

  it('注入证明 ③：同时缺两个、多一个 → 消息里三样都点名', () => {
    const script = `
${compareFn}
${assertFn}
$keys = @(${contract} | Where-Object { $_ -ne 'borderRadius' -and $_ -ne 'boxShadow' }) + @('injectedExtra')
try {
  Assert-ComputedStyleKeys $keys @(${contract}) 'element 记录 VC-XX'
  Write-Output 'should-not-reach'
} catch {
  Write-Output ('caught: ' + $_.Exception.Message)
}
`
    const { stdout, status } = runPowerShell(script)
    expect(status, stdout).toBe(0)
    expect(stdout).toContain('borderRadius')
    expect(stdout).toContain('boxShadow')
    expect(stdout).toContain('injectedExtra')
    expect(stdout).not.toContain('should-not-reach')
  })
})

describe('诊断开关接线：默认路径一字不变，诊断产物不是证据', () => {
  const workflowPath = join(repoRoot, '.github', 'workflows', 'visual-evidence.yml')
  const workflow = readFileSync(workflowPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')

  it('workflow_dispatch 新增 diagnostic 输入：boolean、默认 false', () => {
    const at = workflow.indexOf('\n      diagnostic:')
    expect(at, '找不到 diagnostic 输入').toBeGreaterThan(-1)
    const block = workflow.slice(at, at + 700)
    expect(block, '必须是布尔输入').toMatch(/type:\s*boolean/)
    expect(block, '必须默认关闭').toMatch(/default:\s*false/)
  })

  it('只有为 true 时才把 RAIN_VISUAL_DIAGNOSTIC 置 1（默认 0）', () => {
    expect(workflow).toMatch(/RAIN_VISUAL_DIAGNOSTIC:\s*\$\{\{\s*inputs\.diagnostic\s*&&\s*'1'\s*\|\|\s*'0'\s*\}\}/)
  })

  it('默认路径行为不变：采集步骤仍然只调同一个脚本、同一个 -TargetSha', () => {
    expect(workflow).toMatch(/campaign-visual-evidence\.ps1 -TargetSha \$target/)
    // "采集入口只有一处"要看**调用**，不能数出现次数：
    // 同一个脚本名还会出现在 `paths` 过滤器与"Gate the collector scripts themselves"的
    // 语法解析步骤里（本轮实测：朴素的全文计数得到 3，其中 2 处不是采集入口）。
    const invocations = [...workflow.matchAll(/-File\s+scripts\/campaign-visual-evidence\.ps1/g)]
    expect(invocations.length, '采集入口（-File 调用）只应有一处').toBe(1)
  })

  it('workflow 写明诊断产物不作 §3.4 证据，且「不入库」是可执行的（.gitignore）', () => {
    expect(workflow).toMatch(/诊断产物是诊断，不是证据/)
    // 口径已统一：不再说"不进 evidence/"（那句与实现自相矛盾——dump 就在包内 diagnostic/ 下），
    // 而说"不并入 records/screenshots 与 manifest、不作 §3.4 的任何一项"。
    expect(workflow).toMatch(/不并入 `records\/`、`screenshots\/` 与 manifest/)
    expect(workflow).toMatch(/不作 §3\.4 的任何一项/)
    expect(workflow, '不得再出现与实现矛盾的"不进 evidence/"').not.toMatch(/不进 `evidence\/`/)
    // 「不入库」必须是**可执行**的保障，不能只是文案。
    const ignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8')
    expect(ignore, '.gitignore 必须忽略 evidence/**/diagnostic/').toMatch(/^evidence\/\*\*\/diagnostic\/$/m)
  })

  it('dump 落在包内 diagnostic/ 子目录（不在证据根、不混进 records/screenshots）', () => {
    // 按**函数边界**取整段（STD-9：原先 `slice(dumpAt, dumpAt + 1600)` 只剩 124 字符余量，
    // 把 dump 函数撑长、并把 `$path` 改成 `Join-Path $RecordsDir …` 之后，窗口外那一行就看不见了，
    // 而"dump 写进 records/"正是这条判据要防的形态）。
    const body = extractFunctionSource(collectorSource, 'Write-StyleDiagnosticDump')
    expect(body, 'dump 目录必须是包内 diagnostic 子目录').toMatch(/Split-Path -Parent \$RecordsDir/)
    expect(body).toMatch(/'diagnostic'/)
    expect(body, 'dump 不得写进 records/').not.toMatch(/Join-Path \$RecordsDir/)
    // 落点判据要真的锁住"写哪里"：`$path` 那一行必须落在诊断目录变量下、且带 dump 文件名后缀。
    expect(body, 'dump 的 $path 必须落在 diagnostic 目录变量下').toMatch(/^\s*\$path = Join-Path \$dir .*style-dump\.json/m)
  })

  it('校验器只按名字读取包内已知路径，不枚举目录（故 diagnostic/ 不可能改变判定）', () => {
    const validator = normalize(validatorPath)
    const enumOverRoot = [...validator.matchAll(/Get-ChildItem[^\n]*\$EvidenceDir/g)]
    expect(enumOverRoot, '校验器不得枚举证据根的子项').toEqual([])
    expect(validator).toMatch(/Join-Path \$EvidenceDir 'manifest\.json'/)
  })
})

describe('采集器自检：接线（写记录之前必须调用）与同源读法', () => {
  it('element 记录写盘之前调用了 Assert-ComputedStyleKeys', () => {
    const defAt = collectorSource.indexOf('function Assert-ComputedStyleKeys')
    const callAt = collectorSource.lastIndexOf('Assert-ComputedStyleKeys')
    expect(defAt, '找不到自检函数定义').toBeGreaterThan(-1)
    expect(callAt, '采集器里必须调用自检').toBeGreaterThan(defAt)

    // 取**调用点所属的那条记录分支**：循环体内最后一个 `$record = [ordered]@{`。
    // （element 循环里有多条分支：rootTokens 记录、缺选择器的 continue 分支、element 分支；
    //   用第一个会落到别的分支上——本轮实测连续踩了两次。）
    const loopAt = collectorSource.indexOf('foreach ($result in @($Probe.results))')
    expect(loopAt, '找不到 element 记录循环').toBeGreaterThan(-1)
    const branchRecordAt = collectorSource.lastIndexOf('$record = [ordered]@{', callAt)
    expect(branchRecordAt, '找不到自检所属的记录构造点').toBeGreaterThan(loopAt)

    // 该分支的写盘调用：构造点之后、下一个分支之前
    const nextBranchAt = collectorSource.indexOf('$record = [ordered]@{', branchRecordAt + 1)
    const limit = nextBranchAt > branchRecordAt ? nextBranchAt : collectorSource.length
    const writeAt = collectorSource.indexOf('WriteAllText($path', branchRecordAt)
    expect(writeAt, '找不到该分支的写盘调用').toBeGreaterThan(branchRecordAt)
    expect(writeAt, '写盘必须属于同一分支').toBeLessThan(limit)

    expect(callAt, '自检必须出现在记录构造之后').toBeGreaterThan(branchRecordAt)
    expect(callAt, '自检必须在写盘之前').toBeLessThan(writeAt)
  })

  it('borderRadius 走**回退链**且同源：parseFloat 只读一次，两处共用', () => {
    // 回退链是 2026-10-08 的修复核心：长格式 `border-top-left-radius` 在**某些引擎里就是空串**
    // （jsdom 25.0.1 实测长格式 `""`、简写 `borderRadius` 有值 `"8px"`）。因此必须长格式优先、
    // 取不到退回简写；旧的"直读长格式"既取不到值，也已经在托管上表现为丢键。
    expect(collectorSource).toMatch(/const borderRadiusRaw = live\.borderTopLeftRadius \|\| live\.borderRadius \|\| ''/)
    const reads = [...collectorSource.matchAll(/parseFloat\(\s*borderRadiusRaw\s*\)/g)]
    expect(reads.length, 'borderRadiusRaw 只应被 parseFloat 读一次（同源）').toBe(1)
    expect(collectorSource, '不得再 parseFloat 直读长格式（那条读法被证明会取到空）')
      .not.toMatch(/parseFloat\(\s*(live|style)\.borderTopLeftRadius\s*\)/)

    // computedStyle 构造点内部必须用同源文本，不得直读计算样式。
    // 注意：`style` 中间对象里那一行 `borderRadius: live.borderTopLeftRadius` 是合法的
    // ——它是中间快照，不是契约输出；所以这里必须**限定在构造点区间内**判断。
    const needle = 'computedStyle: {'
    const at = collectorSource.indexOf(needle)
    const open = collectorSource.indexOf('{', at + needle.length - 1)
    let depth = 0
    let end = -1
    for (let i = open; i < collectorSource.length; i += 1) {
      if (collectorSource[i] === '{') depth += 1
      else if (collectorSource[i] === '}') {
        depth -= 1
        if (depth === 0) { end = i; break }
      }
    }
    const builder = collectorSource.slice(open, end)
    expect(builder, '构造点内不得直读 live/style 的 borderRadius').not.toMatch(/^\s*borderRadius:\s*(live|style)\./m)
    expect(builder, '构造点必须用同源文本').toMatch(/^\s*borderRadius:\s*borderRadiusText/m)
    // derived 侧必须是**同一个变量**，否则两处口径又会分叉
    expect(collectorSource, 'derived.borderRadiusPx 必须复用同一变量').toMatch(/^\s*borderRadiusPx:\s*borderRadiusPx,?$/m)
  })

  it('失败分层：浏览器层不抛（否则整页探针死），记录层 fail-closed 兜底', () => {
    // 上一版正是在浏览器层 throw —— 探针对象永不发布，所有等探针的判据只能等超时、门禁变红。
    // 这条断言防止那个形态回潮。
    //
    // **必须按函数边界切，不能用固定字符窗口**（2026-10-08 复审 STD-1）：原先写的是
    // `slice(measureAt, measureAt + 700)`，而 `measure()` 函数体远长于 700 字符——
    // 实测把同一处 `throw new Error` 放到 `borderRadiusPx` 那一行之后（距读取点 8000+ 字符），
    // 旧窗口判据**照样全绿**。窗口是"看起来在守、其实守不住"的典型形态，故改为按大括号
    // 配平取出**整个 `measure()` 函数体**再断言。
    const measureBody = extractFunctionSource(collectorSource, 'measure')
    expect(measureBody.length, 'measure() 函数体不能是空壳').toBeGreaterThan(1000)
    expect(measureBody, '浏览器层不得因取不到圆角而抛异常（会摧毁整页探针）')
      .not.toMatch(/throw new Error/)
    // 记录层必须补上"值"层面的 fail-closed（与校验器同口径：空值与缺键同等对待）。
    expect(collectorSource).toMatch(/function Compare-ComputedStyleValues/)
    expect(collectorSource).toMatch(/function Assert-ComputedStyleValues/)
    // 接线断言只证明"调用点存在"，**它单独不能证明断言有牙**——本轮复审实测：把这一行删掉后
    // 这些文本判据全部仍绿。真跑写盘路径的判据在 `scripts/visual-collector-runtime-paths.test.ts`
    // （那边真调 `Write-ProbeRecords`，断言抛错且记录文件不存在）。
    expect(collectorSource).toMatch(/Assert-ComputedStyleValues \$result\.computedStyle/)
    // 空值判据的**权威定义**在采集器里必须仍是"空串与 null 同等看待"（源码锚点）。
    // 这一条**不是行为判据**：复审实测把 `if ($comparison.ok) { return }` 改成永不失败后，
    // 这类字面量断言全部仍绿。真实行为由 scripts/visual-collector-runtime-paths.test.ts
    // 真跑写盘路径来裁判，这里只防止"同口径的判据被整段删掉"。
    expect(collectorSource, '空值判定必须与校验器同口径（源码锚点，非行为判据）').toMatch(/Length -eq 0/)
    // dump 必须在断言**之前**（否则出事那一次恰恰没有 dump）。整行匹配：只匹配前缀的话，
    // 把第二实参从 $RecordsDir 改成别的目录仍然绿（复审 STD-5）。
    const dumpCallAt = collectorSource.search(/^[ \t]*Write-StyleDiagnosticDump \$result\.computedStyle \$RecordsDir [^\n]*$/m)
    const assertCallAt = collectorSource.search(/^[ \t]*Assert-ComputedStyleKeys @\(\$result\.computedStyle[^\n]*$/m)
    expect(dumpCallAt, '找不到 dump 调用（须整行含 $RecordsDir）').toBeGreaterThan(-1)
    expect(assertCallAt, '找不到键集合断言调用').toBeGreaterThan(-1)
    expect(dumpCallAt, 'dump 必须先于断言落盘').toBeLessThan(assertCallAt)
  })

  it('诊断 dump 默认关闭，且只在显式开关下写、不影响采集', () => {
    // 变量名可能带 $env: 前缀，正则不要假设前缀形态
    expect(collectorSource).toMatch(/RAIN_VISUAL_DIAGNOSTIC/)
    // 同样按**函数边界**取，不用"下一个 function 或 +2000"那种猜测（STD-1 的同一类问题）。
    const body = extractFunctionSource(collectorSource, 'Write-StyleDiagnosticDump')
    expect(body.length, 'dump 函数体长度应在合理区间（边界切错会立刻暴露）').toBeGreaterThan(800)
    expect(body.length).toBeLessThan(4000)
    expect(body, '默认必须是关闭的').toMatch(/RAIN_VISUAL_DIAGNOSTIC\s*-ne\s*'1'/)
    expect(body, '诊断失败不得影响采集').toMatch(/Write-Warning/)
  })

  /**
   * STD-1 的"能失败"证明。原判据是 `slice(读取点, 读取点 + 700)`：窗口外的 `throw` 抓不到。
   * 下面两条用**注入**证明新判据（按函数边界切整段 `measure()`）确实抓得住——
   * 一条把 throw 埋到函数体后部（远在旧窗口之外），一条证明判据不是恒真（真 throw 会被抓到）。
   */
  it('注入证明 ⑭（STD-1）：把 throw 埋进 measure() 后部（旧 700 字符窗口之外）→ 必须判红', () => {
    const injected = collectorSource.replace(
      /^([ \t]*)borderRadiusPx: borderRadiusPx,$/m,
      "$1throw new Error('injected deep browser-layer failure');\n$1borderRadiusPx: borderRadiusPx,",
    )
    expect(injected, '注入本身要生效').not.toBe(collectorSource)
    const body = extractFunctionSource(injected, 'measure')
    const at = body.indexOf("throw new Error('injected deep browser-layer failure')")
    expect(at, '注入的 throw 必须在 measure() 边界内').toBeGreaterThan(-1)
    expect(at, '必须落在旧的 700 字符窗口之外，否则这条证明不了窗口缺陷').toBeGreaterThan(700)
    expect(body, '按函数边界切的判据必须抓到它').toMatch(/throw new Error/)
  })

  it('注入证明 ⑮（判据不是恒真）：函数边界切片内含真实 throw → 同一判据会红', () => {
    // 取一个**确实**含有 `throw new Error` 的采集器函数（页级扫描的 fail-closed 抛错），
    // 对它施加同一判据，必须判红。若这条不红，说明 `not.toMatch(/throw new Error/)` 是恒真式。
    const sweep = extractFunctionSource(collectorSource, 'sweepForAccent')
    expect(sweep, 'sweepForAccent 里必须有真实的 throw').toMatch(/throw new Error/)
    // 而 measure() 里没有——这正是"浏览器层不抛"的含义。
    const measureBody = extractFunctionSource(collectorSource, 'measure')
    expect(measureBody.length, 'measure() 边界切错会立刻暴露').toBeGreaterThan(3000)
    expect(measureBody, '浏览器层不得抛').not.toMatch(/throw new Error/)
  })
})
