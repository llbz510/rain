import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 契约对齐判据：**采集器实际写出的 computedStyle 键集合** 必须恰好等于
 * **校验器要求的 RequiredComputedStyleKeys**。
 *
 * 为什么需要它（真实事故，2026-10-07）：master 上这两个集合曾悄悄漂移
 * ——校验器要求 'borderRadius' 等字段，而采集器那个唯一的构造点没写，
 * 于是 34 条记录在采集器自校验阶段全部判红。本机跑不了真实桌面采集，
 * 这次漂移**只有跑到托管采集才暴露**，一轮 12 分钟。
 * 这条判据把"两份源码是否对齐"从"靠托管 run 才发现"变成"本机秒级发现"。
 *
 * **它管不了什么（必须写清，否则会被当成万能依据）**：本判据比较的是**两份源码**。
 * 2026-10-07 的后续调查发现另一种更隐蔽的形态——**源码两侧都是 28 键、而运行时产出的
 * 记录只有 27 键**（"源码 vs 运行时"不一致）。那种形态本判据**看不见**，需要运行期
 * 交叉验证：对同一次采集，断言"运行时构造点写出的键集合 == 记录里实际的键集合"。
 *
 * 设计要点：**两侧都从源码解析**，不硬编码任何一份副本——否则下一次照样漂移，
 * 而判据自己会变成"两份手抄本互相确认"。
 *
 * **解析器必须"注释感知"（2026-10-08，st5 修复）**：两份源码的键字面量里**本来就有注释**
 * （校验器那份带 # 说明，采集器构造点带双斜杠说明）。朴素的"抓所有单引号 token"会把
 * **注释里的引号 token 当成键**：那会造出一条**假红**（报一个真实不存在的"多余键"），
 * 而假红的下场比漏检更糟——修它的人会去改一份本来正确的集合。
 * 所以解析前先把注释按扫描器剔掉（见 stripComments）。
 *
 * 相反方向的错误更危险且**已经写过一版**：用简单正则去注释会把**值里的双斜杠**
 * （任何 URL 都是 https 冒号双斜杠）当成注释起点，把真实存在的键删掉 → 漏检。
 * 因此去注释用**逐字符状态机**，字符串与模板字面量内部原样保留。
 */
const repoRoot = join(__dirname, '..')
const validatorPath = join(repoRoot, 'scripts', 'validate-visual-evidence.ps1')
const collectorPath = join(repoRoot, 'scripts', 'campaign-visual-evidence.ps1')

/**
 * 读源码并归一化成"无 BOM + LF"。
 *
 * 本仓库当前的事实（2026-10-08 普查全部 10 个 tracked `.ps1`，以 HEAD blob 字节为准）：
 * 行尾**全部是 LF**（CRLF 计数均为 0），而 BOM **只有 4 个文件带**（`campaign-visual-evidence`、
 * `validate-visual-evidence`、`run-study-catalog-e2e`、`run-video-list-e2e`）。所以本函数
 * 归一化的是"可能存在的 BOM 与可能存在的 CRLF"，不是"约定如此"；写注释时不要把它说成约定。
 *
 * 为什么仍要归一化：`/^...$/m` 在 CRLF 下 `$` 匹配到 `\n` 之前、`.*` 会把 `\r` 吃进捕获里，
 * 于是"删一行/加一行"的注入会静默失配（本轮实测：注入没生效 → 断言假通过）。
 * 归一化之后，解析与注入都只面对一种形态。
 *
 * 附带纪律：改动这两份带 BOM 的 `.ps1` 时**必须保留 BOM**（PowerShell 5.1 读无 BOM 的 .ps1
 * 会按 ANSI 解码，中文注释会乱码）；用会剥 BOM 的写入方式改它们，只会得到与语义无关的
 * 整文件噪声 diff。
 */
function readNormalized(path: string): string {
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
}

/**
 * 剔除 JavaScript / TypeScript 注释，同时**原样保留字符串与模板字面量**。
 *
 * 为什么不能直接用简单正则（形如"双斜杠到行尾"、或"斜杠星号到星号斜杠"）：值的字面量里
 * 会出现这两种字节（URL 都是 https 冒号双斜杠，路径里常有斜杠星号）。用简单正则会把
 * **值当成注释删掉**，反而把真实存在的键一起吃掉——那是比 st5 原缺陷（吃注释里的 token）
 * 更严重的**漏检**，因此这里用逐字符状态机：四种字面量状态与两种注释状态互相排斥。
 *
 * 注释按"行注释→空白、块注释→等长换行"的方式替换，**不改变行号**，
 * 调用方的行首锚定与位置切片仍然对得上。
 *
 * **两种语言的注释都要认**（本轮实测踩到）：采集器与校验器是 **PowerShell**（行注释是
 * 井号、块注释是尖括号井号），而构造点内部嵌的是 JavaScript（行注释是双斜杠）。
 * 只认其中一种时，另一种语言的注释会**原样留在 body 里**，于是"注释感知"对该文件根本不生效
 * ——注入证明 ⑥ 第一次就是这么红的（校验器那份里我写了井号注释，它照样被当成必填键）。
 */
export function stripComments(source: string): string {
  // 反引号用码位取，不写字面量：本文件里到处是模板字符串，模板里再出现裸反引号会直接把
  // 整个文件变成语法错误（本轮实测：在条件里写反引号字面量，esbuild 报
  // 「Expected ";" but found "') state = '"」，转换阶段就失败）。
  const BACKTICK = String.fromCharCode(96)
  type State = 'code' | 'single' | 'double' | 'template' | 'lineComment' | 'blockComment'
  const chunks: string[] = []
  let state: State = 'code'
  let index = 0
  /** 已产出文本的最后一个字符（用于"井号是否在 token 边界"这类判断）。 */
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
      // PowerShell 块注释 <# … #>（尖括号与井号都要先消费掉，不能只消费井号）
      if (char === '<' && next === '#') { state = 'blockComment'; chunks.push('  '); index += 2; continue }
      // PowerShell 行注释：井号仅在 token 边界起注释。这样 `#ffffff` 这类颜色字面量、
      // 以及字符串里的井号都不会被误判（它们在 code 态下前面是字母或引号）。
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
      // JS 块注释收尾是星号斜杠，PowerShell 块注释收尾是井号尖括号。
      if (char === '*' && next === '/') { state = 'code'; chunks.push('  '); index += 2; continue }
      if (char === '#' && next === '>') { state = 'code'; chunks.push('  '); index += 2; continue }
      chunks.push(char === '\n' ? '\n' : ' ')
      index += 1
      continue
    }
    // 字符串/模板内部：逐个原样复制，只处理转义（模板里的插值不需要特殊处理：
    // 它内部不会出现能改变外层状态的单引号/双引号/双斜杠，而真正需要的是"别把值当注释"）。
    chunks.push(char)
    if (char === '\\') { chunks.push(next ?? ''); index += 2; continue }
    if (state === 'single' && char === "'") state = 'code'
    else if (state === 'double' && char === '"') state = 'code'
    else if (state === 'template' && char === BACKTICK) state = 'code'
    index += 1
  }
  return chunks.join('')
}

/** 从校验器源码里取出 RequiredComputedStyleKeys 数组字面量的键集合 */
export function extractValidatorKeys(source: string): string[] {
  const anchor = source.indexOf('$script:RequiredComputedStyleKeys')
  if (anchor < 0) throw new Error('校验器里找不到 $script:RequiredComputedStyleKeys')
  const open = source.indexOf('@(', anchor)
  if (open < 0) throw new Error('RequiredComputedStyleKeys 不是 @(...) 形态')
  // 从 @( 起做括号配平，取出数组字面量
  let depth = 0
  let end = -1
  for (let i = open + 1; i < source.length; i += 1) {
    const c = source[i]
    if (c === '(') depth += 1
    else if (c === ')') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) throw new Error('RequiredComputedStyleKeys 数组未闭合')
  // 注释感知（st5）：该数组里本来就有 # 说明，抓 token 之前先剔掉注释。
  const body = stripComments(source.slice(open, end))
  const keys = [...body.matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1])
  if (keys.length === 0) throw new Error('RequiredComputedStyleKeys 里没解析出任何键')
  return keys
}

/**
 * 从采集器源码里取出**唯一那个 element 快照构造点**（computedStyle: { ... }）的键集合。
 * 定位方式：锚定 computedStyle 构造点，再用大括号配平取出对象体。
 * 若出现第二个构造点，本函数会抛错——那正是"契约有两个来源"的信号，必须显式处理。
 */
export function extractCollectorKeys(source: string): string[] {
  const needle = 'computedStyle: {'
  const first = source.indexOf(needle)
  if (first < 0) throw new Error('采集器里找不到 computedStyle 构造点')
  if (source.indexOf(needle, first + needle.length) >= 0) {
    throw new Error('采集器里出现多个 computedStyle 构造点——契约有两个来源，必须先合并')
  }
  const open = source.indexOf('{', first + needle.length - 1)
  let depth = 0
  let end = -1
  for (let i = open; i < source.length; i += 1) {
    const c = source[i]
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) throw new Error('computedStyle 对象未闭合')
  // 注释感知（st5）：构造点里逐键都有双斜杠说明。不去注释时，"行首标识符 + 冒号"会命中
  // 说明文本里的键值样式文本，而"抓所有单引号 token"的写法更会直接把说明里的名字当成键 → 假红。
  const body = stripComments(source.slice(open, end))
  // 只认"键: 值"形态的键（行首缩进 + 标识符 + 冒号），避免把别的文本当键
  const keys = [...body.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\s*:/gm)].map((m) => m[1])
  if (keys.length === 0) throw new Error('computedStyle 里没解析出任何键')
  return keys
}

/**
 * 把注入**限定在 computedStyle 构造点内部**。
 *
 * 必须这么做：borderRadius / boxShadow 这类键在采集器里出现**两次**
 * （一次在 style 快照对象里，一次在构造点里）。全局替换会打到前一个，
 * 于是"注入没生效"，判据变成假通过——本轮实测踩到过。
 */
function injectionSpans(source: string): { open: number; end: number } {
  const needle = 'computedStyle: {'
  const at = source.indexOf(needle)
  if (at < 0) throw new Error('找不到 computedStyle 构造点')
  const open = source.indexOf('{', at + needle.length - 1)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return { open, end: i }
    }
  }
  throw new Error('computedStyle 对象未闭合')
}

/** 只在构造点内部做替换；命中数必须 > 0，否则注入无效（不许静默跳过） */
function injectInsideBuilder(source: string, pattern: RegExp, replacement: string): string {
  const { open, end } = injectionSpans(source)
  const before = source.slice(0, open)
  const body = source.slice(open, end)
  const after = source.slice(end)
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const hits = [...body.matchAll(new RegExp(pattern.source, flags))]
  if (hits.length === 0) throw new Error(`注入未命中构造点内部：${pattern}`)
  return before + body.replace(new RegExp(pattern.source, flags), replacement) + after
}

const validatorSource = readNormalized(validatorPath)
const collectorSource = readNormalized(collectorPath)

describe('契约对齐：采集器 computedStyle 键集合 == 校验器必填键集合', () => {
  it('两侧集合必须完全相等（多一个、少一个都算漂移）', () => {
    const required = extractValidatorKeys(validatorSource)
    const produced = extractCollectorKeys(collectorSource)

    const missing = required.filter((k) => !produced.includes(k))
    const extra = produced.filter((k) => !required.includes(k))

    expect(
      { missing, extra },
      `字段契约漂移：\n  校验器要求 ${required.length} 个、采集器写出 ${produced.length} 个\n` +
        `  采集器缺少：${missing.join(', ') || '（无）'}\n` +
        `  采集器多出：${extra.join(', ') || '（无）'}`,
    ).toEqual({ missing: [], extra: [] })
  })

  it('两侧解析结果都非空且无重复（防止解析器静默退化成空集合）', () => {
    const required = extractValidatorKeys(validatorSource)
    const produced = extractCollectorKeys(collectorSource)
    expect(required.length).toBeGreaterThan(20)
    expect(produced.length).toBeGreaterThan(20)
    expect(new Set(required).size, '校验器必填集里有重复键').toBe(required.length)
    expect(new Set(produced).size, '采集器构造点里有重复键').toBe(produced.length)
  })

  /**
   * 下面四条是 st5 的"能失败"证明：故意把**注释**注入真实源码，确认解析器不被注释里的
   * 引号 token 带偏（⑤/⑥/⑦），并确认反方向（把值里的双斜杠当注释）也不会漏检（⑧）。
   * 没有这些，"注释感知"就只是一句无处裁判的声明——而该缺陷的原始表现恰恰是
   * "报一个并不存在的多余键"（假红）。
   */
  it('注入证明 ⑤（st5 · 采集器侧）：注释里的引号 token 不得被当成键', () => {
    const broken = injectInsideBuilder(
      collectorSource,
      /^([ \t]*)borderRadius[ \t]*:/m,
      "$1// 旧读法直取值：\n$1// 'borderTopLeftRadius' 与 'borderRadius' 都在这里被点名过\n$1// 契约要求 'zIndexInjected' —— 这是注释，不是键\n$1borderRadius:",
    )
    expect(broken, '注入本身要生效').not.toBe(collectorSource)
    const produced = extractCollectorKeys(broken)
    const required = extractValidatorKeys(validatorSource)
    expect(produced, '注释里的 token 不得进入键集合').not.toContain('zIndexInjected')
    expect(produced, '注释里的 token 不得进入键集合').not.toContain('borderTopLeftRadius')
    // 反向锚点：集合仍与校验器逐项相等（真键一个不少、假键一个不多）
    expect(produced.filter((k) => !required.includes(k))).toEqual([])
    expect(required.filter((k) => !produced.includes(k))).toEqual([])
  })

  it('注入证明 ⑥（st5 · 校验器侧）：注释里的引号 token 不得被当成必填键', () => {
    const broken = validatorSource.replace(
      '$script:RequiredComputedStyleKeys = @(',
      "$script:RequiredComputedStyleKeys = @(\n  # 说明里点名 'columnGap' 与 'rowGap'：它们是注释，不是必填键",
    )
    expect(broken, '注入本身要生效').not.toBe(validatorSource)
    const required = extractValidatorKeys(broken)
    expect(required, '校验器注释里的 token 不得进入必填集').not.toContain('columnGap')
    expect(required, '校验器注释里的 token 不得进入必填集').not.toContain('rowGap')
    const produced = extractCollectorKeys(collectorSource)
    expect(required.filter((k) => !produced.includes(k)), '注释不得造出"缺失键"假红').toEqual([])
  })

  it('注入证明 ⑦（配对反证）：同一份注入对**不剔注释**的解析器必须判红（证明注入有牙）', () => {
    // 与 ⑤ 配对：若这个反证不红，说明 ⑤ 的注入根本没产生可被误读的 token，
    // 那 ⑤ 就证明不了任何事。
    const naiveKeys = (source: string): string[] => {
      const needle = 'computedStyle: {'
      const at = source.indexOf(needle)
      const open = source.indexOf('{', at + needle.length - 1)
      let depth = 0
      let end = -1
      for (let i = open; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1
        else if (source[i] === '}') {
          depth -= 1
          if (depth === 0) { end = i; break }
        }
      }
      return [...source.slice(open, end).matchAll(/'([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1])
    }
    const broken = injectInsideBuilder(
      collectorSource,
      /^([ \t]*)borderRadius[ \t]*:/m,
      "$1// 契约要求 'zIndexInjected' —— 这是注释，不是键\n$1borderRadius:",
    )
    const required = extractValidatorKeys(validatorSource)
    // 朴素解析器（抓所有单引号 token）确实会把注释里的 token 当成"多余键"。
    expect(naiveKeys(broken).filter((k) => !required.includes(k))).toContain('zIndexInjected')
    // 而注释感知的解析器不会。
    expect(extractCollectorKeys(broken)).not.toContain('zIndexInjected')
  })

  it('注入证明 ⑧（st5 的反方向）：值里的双斜杠（URL）不得被当成注释删掉', () => {
    // "用正则去注释"那一版会把 https 冒号双斜杠当注释起点，于是把真实存在的键一起删掉
    // → 漏检。这条是那个方向的守卫。
    const broken = injectInsideBuilder(
      collectorSource,
      /^([ \t]*)boxShadow[ \t]*:/m,
      "$1// 说明：契约文件在 https://example.invalid/visual-contract.md\n$1boxShadow:",
    )
    const produced = extractCollectorKeys(broken)
    expect(produced, 'URL 后面的真实键必须还在').toContain('boxShadow')
    expect(produced, 'URL 不得变成键').not.toContain('example')
    const required = extractValidatorKeys(validatorSource)
    expect(required.filter((k) => !produced.includes(k)), 'URL 不得造成"缺失键"').toEqual([])
  })

  it('注入证明 ①：从采集器删一个键 → 必须判红（缺字段）', () => {
    const broken = injectInsideBuilder(collectorSource, /^[ \t]*borderRadius[ \t]*:.*$/m, '')
    expect(broken, '注入本身要生效').not.toBe(collectorSource)
    const required = extractValidatorKeys(validatorSource)
    const produced = extractCollectorKeys(broken)
    expect(required.filter((k) => !produced.includes(k))).toContain('borderRadius')
  })

  it('注入证明 ②：给采集器加一个多余键 → 必须判红（多字段）', () => {
    const broken = injectInsideBuilder(collectorSource, /^([ \t]*)boxShadow[ \t]*:/m, '$1zIndexInjected: style.zIndex,\n$1boxShadow:')
    expect(broken, '注入本身要生效').not.toBe(collectorSource)
    const required = extractValidatorKeys(validatorSource)
    const produced = extractCollectorKeys(broken)
    expect(produced.filter((k) => !required.includes(k))).toContain('zIndexInjected')
  })

  it('注入证明 ③：只改校验器必填集（采集器不动）→ 必须判红', () => {
    // 校验器源码注入时不能假设行尾或缩进：本仓库 tracked `.ps1` 实测**行尾全是 LF**
    // （工作树里看到的 CRLF 是 `core.autocrlf=true` 的检出假象），其中 4 个带 BOM。
    const broken = validatorSource.replace(/'borderRadius'/, "'borderRadius', 'columnGap'")
    expect(broken, '注入本身要生效').not.toBe(validatorSource)
    const required = extractValidatorKeys(broken)
    const produced = extractCollectorKeys(collectorSource)
    expect(required).toContain('columnGap')
    expect(required.filter((k) => !produced.includes(k))).toContain('columnGap')
  })

  it('注入证明 ④：采集器出现第二个构造点 → 解析器必须报错（而不是随便挑一个）', () => {
    const broken = `${collectorSource}\nconst decoy = { computedStyle: { color: 1 } }\n`
    expect(() => extractCollectorKeys(broken)).toThrow(/多个 computedStyle 构造点/)
  })
})

// ---------------------------------------------------------------------------------------------
// 诊断开关的**定位**判据（2026-10-08，st4 修复）。
//
// 原缺陷：一条「workflow 全文 toMatch(RAIN_VISUAL_DIAGNOSTIC: …)」可以在**文件的任意位置**
// 命中。把 env: 从采集 step 挪到 job 级、或挪到另一个 step 时，全局正则照样绿——
// 而"诊断模式默认关闭"是这个开关的安全属性，作用域错了就是它最要紧的失效形态：
// 要么诊断产物在错误的步骤里被当真证据，要么默认路径上被意外打开。
// 所以这里改成"先按缩进定位、再在定位到的块里断言"，并各配一条注入证明。
// ---------------------------------------------------------------------------------------------

/** 定位一个 job 块（按缩进）：两空格缩进的 jobId 键，到下一个同级或更高级的映射键为止。 */
function jobBlockBounds(workflow: string, jobId: string): { start: number; end: number } {
  const lines = workflow.split('\n')
  const head = lines.findIndex((line) => new RegExp(`^  ${jobId}:\\s*$`).test(line))
  if (head < 0) throw new Error(`workflow 里找不到 job ${jobId}`)
  let end = lines.length
  for (let i = head + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (indent <= 2 && /^\s{0,2}[A-Za-z_][\w.-]*:/.test(line)) { end = i; break }
  }
  return { start: head, end }
}

/**
 * 一个 job 里"直接属于该 job 的映射键"的缩进。
 *
 * 不能硬编码成 2 或 4（本轮实测踩到）：job 头是 2 空格，而 job 自己的 `env:` / `steps:`
 * 是 **4** 空格（`timeout-minutes:` 那一层）。写死 2 会让"把 env 挪到 job 级"这条注入
 * 找错插入点，于是注入证明了别的东西。这里从 job 头的下一个非空行推出来。
 */
function jobPropertyIndent(lines: string[], job: { start: number; end: number }): number {
  for (let i = job.start + 1; i < job.end; i += 1) {
    const line = lines[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    return line.length - line.trimStart().length
  }
  throw new Error('job 里找不到任何属性行，无法推出缩进')
}

/** 在一个 job 块里定位一个 step（按 step 的 name 行，到下一个 name 行为止）。 */
function stepBlockBounds(workflow: string, jobId: string, stepName: string): { start: number; end: number } {
  const job = jobBlockBounds(workflow, jobId)
  const lines = workflow.split('\n')
  const head = lines.findIndex((line, index) => index > job.start && index < job.end
    && /^\s*-\s*name:\s*/.test(line) && line.includes(stepName))
  if (head < 0) throw new Error(`job ${jobId} 里找不到 step「${stepName}」`)
  let end = job.end
  for (let i = head + 1; i < job.end; i += 1) {
    if (/^\s*-\s*name:\s*/.test(lines[i])) { end = i; break }
  }
  return { start: head, end }
}

/** 在给定行区间里定位环境变量键，返回行号（0 = 没找到）。 */
function envKeyLine(workflow: string, bounds: { start: number; end: number }, key: string): number {
  const lines = workflow.split('\n')
  for (let i = bounds.start; i < bounds.end; i += 1) {
    if (new RegExp(`^\\s*${key}:\\s*\\S`).test(lines[i])) return i + 1
  }
  return 0
}

/**
 * 取一个 `workflow_dispatch` input 自己的 YAML 块（含它的 `description`/`required`/`type`/`default`）。
 *
 * 为什么必须按缩进取（STD-13）：`slice(anchor, anchor + 700)` 这类固定窗口会在
 * "把目标 input 的 default 改成 true、再追加一个带 `default: false` 的邻近 input"时
 * **两处判据同时假绿**——因为邻近 input 的 `default: false` 落进了窗口里，
 * 而真正要守的"默认关闭"已经被破坏。窗口给出的是"看起来在守、其实守不住"的判据。
 */
function inputBlockBounds(workflow: string, inputName: string): string {
  const lines = workflow.split('\n')
  // dispatch inputs 的属性缩进是 8；input 自身的条目缩进是 6（本文件的实际形态）。
  const head = lines.findIndex((line) => new RegExp(`^\\s{2,8}${inputName}:\\s*$`).test(line))
  if (head < 0) throw new Error(`workflow 里找不到 workflow_dispatch 输入 ${inputName}`)
  const entryIndent = lines[head].length - lines[head].trimStart().length
  let end = lines.length
  for (let i = head + 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '') continue
    const indent = line.length - line.trimStart().length
    // 同级或更浅的映射键 = 该 input 的边界（属性行缩进更深，不会命中）。
    if (indent <= entryIndent && /^\s*[A-Za-z_][\w.-]*:/.test(line)) { end = i; break }
  }
  const block = lines.slice(head, end)
  // 不变量（t4 复审 B4）：块内 `default:` 行必须恰好一行。
  // 取块后我们只读"第一处 default"，若块里出现重复映射键，先看到的那一行可能不是生效值
  // （YAML last-wins），于是一个被改坏的默认值仍会绿灯。重复键本身违反 YAML 规范，
  // 但判据不该把安全属性押在"没人会写重复键"上。
  const defaults = block.filter((line) => /^\s*default:\s*\S/.test(line))
  if (defaults.length !== 1) {
    throw new Error(`输入 ${inputName} 的块里 default 必须恰好一行，实际 ${defaults.length} 行`)
  }
  return block.join('\n')
}

const DIAGNOSTIC_KEY = 'RAIN_VISUAL_DIAGNOSTIC'
const DIAGNOSTIC_STEP = 'Collect real desktop visual evidence'

/**
 * 按大括号配平抽出一个 PowerShell 函数（含 `function` 关键字）。
 *
 * 存在的理由就是 STD-9：任何"某函数内部不许出现某形态 / 某行必须在某处"的判据，
 * 都**不能**用固定字符窗口来切——窗口只会给出"看起来在守、其实守不住"的判据。
 */
function extractPowerShellFunction(source: string, name: string): string {
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
 * 判据本体：诊断开关必须**只在采集 step 自己的 env 里**定义，且默认是 `0`。
 *
 * 抽成函数是为了让"注入证明"能**直接断言它会抛**（复审 STD-2：原先的证明用
 * `expect(envKeyLine(...)).toBe(0)` 当"判红证据"，那只说明"没找到"，改实现即空转，
 * 并不说明判据真的拒绝了那种错位）。
 *
 * 它管不了什么：只管**这一处作用域**。诊断开关是否真的把 dump 落到包内 diagnostic/、
 * 是否真的不入库，分别由别的判据承担；它也不解析 YAML（按缩进定位），因为引入 YAML
 * 依赖不在本批范围内。
 */
function assertDiagnosticScope(workflow: string): void {
  const collectStep = stepBlockBounds(workflow, 'collect', DIAGNOSTIC_STEP)
  if (envKeyLine(workflow, collectStep, DIAGNOSTIC_KEY) === 0) {
    throw new Error(`诊断开关的 ${DIAGNOSTIC_KEY} 必须定义在 step「${DIAGNOSTIC_STEP}」自己的 env 里（不是 job 级、不是别的 step）`)
  }
  const job = jobBlockBounds(workflow, 'collect')
  const lines = workflow.split('\n')
  for (let i = job.start; i < job.end; i += 1) {
    if (i + 1 >= collectStep.start && i + 1 < collectStep.end) continue
    if (new RegExp(`^\\s*${DIAGNOSTIC_KEY}:`).test(lines[i])) {
      throw new Error(`诊断开关的作用域被放大：第 ${i + 1} 行在采集 step 之外也定义了 ${DIAGNOSTIC_KEY}`)
    }
  }
  if (!/RAIN_VISUAL_DIAGNOSTIC:\s*\$\{\{\s*inputs\.diagnostic\s*&&\s*'1'\s*\|\|\s*'0'\s*\}\}/.test(workflow)) {
    throw new Error(`诊断开关默认值必须为 0（只有 inputs.diagnostic 为真才是 1），实际未匹配到 ${DIAGNOSTIC_KEY}: \${{ inputs.diagnostic && '1' || '0' }}`)
  }
  // 一行不变量（复审 STD-11）：全文**恰好一处**定义。它顺手覆盖了"同 step 内重复定义"这个
  // 上面按行区间扫描覆盖不到的情形（重复键的 YAML 语义本机无解析器可验，故只用计数钉住"只有一个"）。
  const definitions = workflow.match(new RegExp(`^\\s*${DIAGNOSTIC_KEY}:`, 'gm')) ?? []
  if (definitions.length !== 1) {
    throw new Error(`${DIAGNOSTIC_KEY} 在 workflow 里必须恰好定义一处，实际 ${definitions.length} 处`)
  }
}

/** 判"诊断警告也在采集 step 内"，同样抽成可被注入证明直接调用的函数（STD-2）。 */
function assertDiagnosticWarningScope(workflow: string): void {
  const collectStep = stepBlockBounds(workflow, 'collect', DIAGNOSTIC_STEP)
  const lines = workflow.split('\n')
  for (let i = collectStep.start; i < collectStep.end; i += 1) {
    if (lines[i].includes('::warning::') && lines[i].includes('DIAGNOSTIC')) return
  }
  throw new Error(`诊断警告必须写在 step「${DIAGNOSTIC_STEP}」的 run 里`)
}

/** 按缩进整体删掉一个块（例如某个 step 里的 env: 及其全部子行）。 */
function removeIndentedBlock(lines: string[], anchorLine: number): string[] {
  const indent = lines[anchorLine].length - lines[anchorLine].trimStart().length
  let end = anchorLine + 1
  while (end < lines.length) {
    const line = lines[end]
    if (line.trim() === '') { end += 1; continue }
    if (line.length - line.trimStart().length <= indent) break
    end += 1
  }
  return [...lines.slice(0, anchorLine), ...lines.slice(end)]
}

/** 把采集 step 的 env 块整体摘掉（用于两条"错位/删除"的注入证明）。 */
function withoutDiagnosticEnv(workflow: string): string[] {
  const collectStep = stepBlockBounds(workflow, 'collect', DIAGNOSTIC_STEP)
  const lines = workflow.split('\n')
  const envLine = envKeyLine(workflow, collectStep, DIAGNOSTIC_KEY)
  if (envLine === 0) throw new Error('源 workflow 里本来就没有这个键，注入无从谈起')
  return removeIndentedBlock(lines, envLine - 1)
}

describe('诊断开关接线：默认路径一字不变，诊断产物不是证据（定位判据）', () => {
  const workflowPath = join(repoRoot, '.github', 'workflows', 'visual-evidence.yml')
  const workflow = readFileSync(workflowPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const COLLECT_STEP = 'Collect real desktop visual evidence'
  const collectStep = stepBlockBounds(workflow, 'collect', COLLECT_STEP)

  it('workflow_dispatch 新增 diagnostic 输入：boolean、默认 false（type 必填）', () => {
    // 按**缩进边界**取该 input 自己的块，不用固定字符窗口（STD-13：`slice(at, at+700)` 在
    // "把它改 true 并追加一个带 `default: false` 的邻近 input"这种复合改动下会**两处同时假绿**，
    // 而 diagnostic 默认已经变成 true——"诊断模式默认关闭"被破坏却无人报）。
    const block = inputBlockBounds(workflow, 'diagnostic')
    expect(block, '必须是布尔输入').toMatch(/type:\s*boolean/)
    expect(block, '必须默认关闭').toMatch(/default:\s*false/)
    // 没有 type: boolean 时 GitHub 把 default: false 当**字符串**，而布尔上下文里
    // 非空字符串为真——"默认关闭"会静默失效。所以 type 必须单独钉住。
    expect(block.match(/type:\s*(\S+)/)?.[1], 'type 必须是 boolean').toBe('boolean')
    // 默认值必须落在**这个** input 块里，而且是它自己的那一行。
    const defaultLine = block.split('\n').find((line) => /^\s*default:\s*\S/.test(line))
    expect(defaultLine, 'diagnostic 块里必须有自己的 default 行').toBeDefined()
    expect(defaultLine!.trim(), 'diagnostic 的默认值必须是 false').toBe('default: false')
  })

  it('注入证明 ⑭（STD-13）：diagnostic 改成 true + 追加一个带 default:false 的邻近 input → 必须判红', () => {
    // 这条正是固定窗口会假绿的复合改动：邻近 input 的 `default: false` 会落进窗口，
    // 于是"默认关闭"的判据被别处的字面量满足，而 diagnostic 自己已经默认打开。
    //
    // 注入必须**定点**：先把 diagnostic 自己的块取出来、只改它内部那一行 default，
    // 再把邻近 input 插到它后面。用全局正则去改"第一个 default: false"会打到别的 input 上
    // （本轮实测：target_sha 的 `default: ''` 先被改掉，证明随即失败在别处）。
    const lines = workflow.split('\n')
    const head = lines.findIndex((line) => /^\s{2,8}diagnostic:\s*$/.test(line))
    expect(head, '找不到 diagnostic 输入').toBeGreaterThan(-1)
    const entryIndent = lines[head].length - lines[head].trimStart().length
    let end = lines.length
    for (let i = head + 1; i < lines.length; i += 1) {
      const line = lines[i]
      if (line.trim() === '') continue
      const indent = line.length - line.trimStart().length
      if (indent <= entryIndent && /^\s*[A-Za-z_][\w.-]*:/.test(line)) { end = i; break }
    }
    const defaultAt = lines.findIndex((line, index) => index > head && index < end && /^\s*default:\s*false\s*$/.test(line))
    expect(defaultAt, 'diagnostic 块里必须有自己的 default: false').toBeGreaterThan(-1)
    const mutatedLines = [...lines]
    mutatedLines[defaultAt] = mutatedLines[defaultAt].replace('false', 'true')
    const pad = ' '.repeat(entryIndent + 2)
    mutatedLines.splice(end, 0,
      `${' '.repeat(entryIndent)}neighbour_injected:`,
      `${pad}description: '注入的邻近输入（它的 default: false 会把固定窗口骗过去）'`,
      `${pad}required: false`,
      `${pad}type: boolean`,
      `${pad}default: false`,
    )
    const mutated = mutatedLines.join('\n')
    expect(mutated, '注入本身要生效').not.toBe(workflow)
    expect(inputBlockBounds(mutated, 'diagnostic'), '注入后 diagnostic 自己的 default 已是 true')
      .toMatch(/^\s*default:\s*true\s*$/m)
    // 窗口写法确实会被骗过（这就是 STD-13 的复现）：
    const anchor = mutated.indexOf('\n      diagnostic:')
    const windowed = mutated.slice(anchor, anchor + 700)
    expect(windowed, '固定窗口会被邻近 input 的 default: false 骗过（STD-13 复现）').toMatch(/default:\s*false/)
    // 新判据必须抓到：diagnostic 自己的 default 已经不是 false。
    const block = inputBlockBounds(mutated, 'diagnostic')
    const defaultLine = block.split('\n').find((line) => /^\s*default:\s*\S/.test(line))
    expect(defaultLine?.trim(), 'diagnostic 自己的 default 必须是 false').not.toBe('default: false')
    expect(block, '邻近 input 不得落进 diagnostic 的块里').not.toContain('neighbour_injected')
  })

  it('注入证明 ⑮（STD-13 的 B4 邻域）：块内重复 default: false 掩盖被改坏的默认值 → 必须判红', () => {
    // t4 复审登记的 B4：取块函数只读"第一处 default"，块内若出现**重复映射键**，
    // 先看到的那行可能不是生效值（YAML last-wins），于是一个默认值已被改成 true 的
    // diagnostic 仍然绿灯。重复键违反 YAML 规范，但安全属性不该押在"没人会写重复键"上。
    const lines = workflow.split('\n')
    const head = lines.findIndex((line) => /^\s{2,8}diagnostic:\s*$/.test(line))
    const entryIndent = lines[head].length - lines[head].trimStart().length
    let end = lines.length
    for (let i = head + 1; i < lines.length; i += 1) {
      const line = lines[i]
      if (line.trim() === '') continue
      if (line.length - line.trimStart().length <= entryIndent && /^\s*[A-Za-z_][\w.-]*:/.test(line)) { end = i; break }
    }
    const defaultAt = lines.findIndex((line, index) => index > head && index < end && /^\s*default:\s*false\s*$/.test(line))
    expect(defaultAt, 'diagnostic 块里必须有自己的 default: false').toBeGreaterThan(-1)
    const mutatedLines = [...lines]
    mutatedLines[defaultAt] = mutatedLines[defaultAt].replace('false', 'true')
    // 在它**之前**插一行重复的 default: false（先被 find 看到）
    mutatedLines.splice(defaultAt, 0, mutatedLines[defaultAt].replace('true', 'false'))
    const mutated = mutatedLines.join('\n')
    expect(mutated, '注入本身要生效').not.toBe(workflow)
    expect(() => inputBlockBounds(mutated, 'diagnostic'), '块内重复 default 必须被判据拒绝')
      .toThrow(/default 必须恰好一行/)
  })

  it('诊断环境变量落在**采集 step 自己的 env 里**（不是 job 级、不是别的 step）', () => {
    expect(() => assertDiagnosticScope(workflow), '真实 workflow 必须通过').not.toThrow()
    const line = envKeyLine(workflow, collectStep, DIAGNOSTIC_KEY)
    expect(line, `RAIN_VISUAL_DIAGNOSTIC 必须定义在 step「${COLLECT_STEP}」块内`).toBeGreaterThan(0)
  })

  it('诊断警告也在采集 step 内（与 env 同一作用域的成对断言）', () => {
    expect(() => assertDiagnosticWarningScope(workflow), '真实 workflow 必须通过').not.toThrow()
  })

  it('注入证明 ⑨（st4 原缺陷）：把 env 挪到 job 级 → 判据本身必须抛', () => {
    const stripped = withoutDiagnosticEnv(workflow)
    expect(stripped.join('\n'), '注入本身要生效').not.toBe(workflow)
    // 插到一个"真的属于 job 的键"下面：用推出来的 job 属性缩进，别写死。
    const job = jobBlockBounds(stripped.join('\n'), 'collect')
    const jobIndent = jobPropertyIndent(stripped, job)
    const jobEnvHead = stripped.findIndex((line, index) => index > job.start && index < job.end
      && new RegExp(`^\\s{${jobIndent}}env:\\s*$`).test(line))
    expect(jobEnvHead, '找不到 collect job 的 env:').toBeGreaterThan(-1)
    stripped.splice(jobEnvHead + 1, 0, `${' '.repeat(jobIndent + 2)}RAIN_VISUAL_DIAGNOSTIC: \${{ inputs.diagnostic && '1' || '0' }}`)
    const mutated = stripped.join('\n')
    // 旧写法（全文任意位置匹配）会被这种挪位骗过——这正是 st4 的复现：
    expect(mutated, '旧写法确实会被挪位骗过（st4 原缺陷复现）')
      .toMatch(/RAIN_VISUAL_DIAGNOSTIC:\s*\$\{\{\s*inputs\.diagnostic\s*&&\s*'1'\s*\|\|\s*'0'\s*\}\}/)
    // 新判据必须**抛**（STD-2：不能只说"没找到"，要证明判据拒绝了这种错位）
    expect(() => assertDiagnosticScope(mutated), '挪到 job 级必须被判据拒绝')
      .toThrow(/必须定义在 step/)
    // 另一半：采集 step 之外确实又出现了这个键（作用域真的被放大了，不是被删掉）
    const mutatedJob = jobBlockBounds(mutated, 'collect')
    expect(envKeyLine(mutated, mutatedJob, DIAGNOSTIC_KEY), '作用域确实被放大到 job 级').toBeGreaterThan(0)
  })

  it('注入证明 ⑩（st4 邻域）：把 env 挪到**另一个 step** → 判据本身必须抛', () => {
    const moved = withoutDiagnosticEnv(workflow)
    const validateHead = moved.findIndex((line) => /^\s*-\s*name:\s*Validate the collected evidence package/.test(line))
    expect(validateHead, '找不到校验 step').toBeGreaterThan(-1)
    const insertAt = moved.findIndex((line, index) => index > validateHead && /^\s{8}shell:\s*/.test(line))
    expect(insertAt, '找不到校验 step 的 shell: 行').toBeGreaterThan(-1)
    moved.splice(insertAt, 0, '        env:', "          RAIN_VISUAL_DIAGNOSTIC: ${{ inputs.diagnostic && '1' || '0' }}")
    const mutated = moved.join('\n')
    // 全文里它仍然只出现一次——旧写法无从分辨（同一个 st4 缺陷的另一半）
    expect(mutated.match(/RAIN_VISUAL_DIAGNOSTIC:/g)?.length, '全文只出现一次，旧写法分辨不出').toBe(1)
    expect(() => assertDiagnosticScope(mutated), '挪到别的 step 必须被判据拒绝')
      .toThrow(/必须定义在 step/)
  })

  it('注入证明 ⑪（st4 另一半）：env 被删掉 → 判据本身必须抛', () => {
    const mutated = withoutDiagnosticEnv(workflow).join('\n')
    expect(mutated, '注入本身要生效').not.toBe(workflow)
    expect(mutated, '全文里不再有这个键').not.toMatch(/RAIN_VISUAL_DIAGNOSTIC:/)
    expect(() => assertDiagnosticScope(mutated), '整块删掉必须被判据拒绝')
      .toThrow(/必须定义在 step/)
  })

  it('注入证明 ⑫（st4 的另一维）：env 留在采集 step、但默认值被改成 1 → 判据必须抛', () => {
    // 作用域对、默认值错，同样会让诊断模式在默认路径上被打开——这是同一个安全属性的另一半。
    const mutated = workflow.replace(
      /RAIN_VISUAL_DIAGNOSTIC:\s*\$\{\{\s*inputs\.diagnostic\s*&&\s*'1'\s*\|\|\s*'0'\s*\}\}/,
      "RAIN_VISUAL_DIAGNOSTIC: ${{ inputs.diagnostic && '1' || '1' }}",
    )
    expect(mutated, '注入本身要生效').not.toBe(workflow)
    expect(() => assertDiagnosticScope(mutated), '默认值被改成 1 必须被判据拒绝')
      .toThrow(/默认值必须为 0/)
  })

  it('注入证明 ⑬（配对反证）：把诊断警告从采集 step 里摘掉 → 警告判据必须抛', () => {
    const mutated = workflow.replace(/^\s*Write-Output '::warning::[^\n]*\n/m, '')
    expect(mutated, '注入本身要生效').not.toBe(workflow)
    expect(() => assertDiagnosticWarningScope(mutated), '警告不在采集 step 内必须被判据拒绝')
      .toThrow(/诊断警告/)
  })

  it('默认路径行为不变：采集步骤仍然只调同一个脚本、同一个 -TargetSha', () => {
    expect(workflow).toMatch(/campaign-visual-evidence\.ps1 -TargetSha \$target/)
    // "采集入口只有一处"要看**调用**，不能数出现次数：
    // 同一个脚本名还会出现在 paths 过滤器与"Gate the collector scripts themselves"的
    // 语法解析步骤里（本轮实测：朴素的全文计数得到 3，其中 2 处不是采集入口）。
    const invocations = [...workflow.matchAll(/-File\s+scripts\/campaign-visual-evidence\.ps1/g)]
    expect(invocations.length, '采集入口（-File 调用）只应有一处').toBe(1)
  })

  it('workflow 写明诊断产物不作 3.4 证据，且「不入库」是可执行的（.gitignore）', () => {
    expect(workflow).toMatch(/诊断产物是诊断，不是证据/)
    // 口径已统一：不再说"不进 evidence/"（那句与实现自相矛盾——dump 就在包内 diagnostic/ 下），
    // 而说"不并入 records/screenshots 与 manifest、不作契约的任何一项"。
    expect(workflow).toMatch(/不并入 `records\/`、`screenshots\/` 与 manifest/)
    expect(workflow).toMatch(/不作 §3\.4 的任何一项/)
    expect(workflow, '不得再出现与实现矛盾的"不进 evidence/"').not.toMatch(/不进 `evidence\/`/)
    // 「不入库」必须是**可执行**的保障，不能只是文案。
    const ignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8')
    expect(ignore, '.gitignore 必须忽略 evidence/**/diagnostic/').toMatch(/^evidence\/\*\*\/diagnostic\/$/m)
    // 而且**真的生效**：不是"规则写在文件里"，是 `git check-ignore` 认这条规则。
    // 只用 check-ignore 的退出码（不建任何文件，故不会污染工作区）；exit 0 = 被忽略。
    //
    // **非 git 目录下这三条会抛而不是静默通过**：`git check-ignore` 在仓库外返回 128。
    // 这是有意的——本判据依赖"宿主是 git 工作树"（CI 与正常开发都在工作树里）。若哪天它
    // 在一个导出的源码副本里跑，报错信息会直接指出是 git 不可用而不是"规则没生效"。
    const checkIgnore = (path: string) => {
      const result = spawnSync('git', ['check-ignore', '--quiet', '--no-index', path], { cwd: repoRoot })
      expect(
        result.status,
        `git check-ignore 无法判定 ${path}（退出码 ${result.status}）：本判据要求宿主是 git 工作树`,
      ).not.toBe(128)
      return result.status
    }
    expect(checkIgnore('evidence/visual-xyz/diagnostic/VC-01.style-dump.json'), 'git check-ignore 必须认出诊断 dump 路径被忽略（exit 0）').toBe(0)
    // 反向：证据本体**不得**被这条规则误伤。
    expect(checkIgnore('evidence/visual-xyz/records/VC-01.json'), 'records/*.json 不得被忽略（exit 1）').toBe(1)
    expect(checkIgnore('evidence/visual-xyz/manifest.json'), 'manifest.json 不得被忽略（exit 1）').toBe(1)
    expect(checkIgnore('evidence/visual-xyz/screenshots/VC-01.png'), 'screenshots 不得被忽略（exit 1）').toBe(1)
  })

  it('dump 落在包内 diagnostic/ 子目录（不在证据根、不混进 records/screenshots）', () => {
    // 按**函数边界**取（STD-9：固定 1600 字符窗口在函数变长后会让落点判据静默失效）。
    const body = extractPowerShellFunction(collectorSource, 'Write-StyleDiagnosticDump')
    expect(body, 'dump 目录必须是包内 diagnostic 子目录').toMatch(/Split-Path -Parent \$RecordsDir/)
    expect(body).toMatch(/'diagnostic'/)
    expect(body, 'dump 不得写进 records/').not.toMatch(/Join-Path \$RecordsDir/)
    expect(body, 'dump 的 $path 必须落在 diagnostic 目录变量下').toMatch(/^\s*\$path = Join-Path \$dir .*style-dump\.json/m)
    // 默认关闭是安全属性：dump 函数自己也要有闸门（否则"不入库"就只是环境变量层面的事）
    expect(body, 'dump 默认必须关闭').toMatch(/RAIN_VISUAL_DIAGNOSTIC\s*-ne\s*'1'/)
  })

  it('校验器只按名字读取包内已知路径，不枚举目录（故 diagnostic/ 不可能改变判定）', () => {
    const validator = readNormalized(validatorPath)
    const enumOverRoot = [...validator.matchAll(/Get-ChildItem[^\n]*\$EvidenceDir/g)]
    expect(enumOverRoot, '校验器不得枚举证据根的子项').toEqual([])
    expect(validator).toMatch(/Join-Path \$EvidenceDir 'manifest\.json'/)
  })
})
