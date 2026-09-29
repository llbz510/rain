# Rain Harness Migration — M17 U52 删除确认断言精确化 — 2026-09-29

> Status: Active
> Authorization: 用户 2026-09-29 明确批准两项：① 把 `harness/m17-video-list-component.test.tsx` 的 U52 用例里 `/25/` 与 `/8/` 两处**裸数字/子串匹配**改成**精确断言**；② `src/ui/video-list.ts` 的「最近学习」显示超过一年改显具体日期。授权范围严格限定为这两处写法加其判据与文档，不得删除用例、放宽其它断言、新增 `skip`/`todo`、改动同文件其它用例或任何其它锁定文件。
> Contract: 本记录不定义 AC、不改变任何 AC 状态、不签发任何 Visual Evidence。
> Purpose: 解除一处**按日期发作**的门禁失效（详见 §1），并把「锁定测试用子串匹配 + 产品新增可见文本 = 定时炸弹」登记为纪律（见 §3）。

## 1. Trigger evidence and old contract

旧合同位于 `harness/m17-video-list-component.test.tsx` 的 U52 用例（`describe('U52: …')` → `it('点击删除弹出确认')`），原第 91–92 行：

```ts
// 确认弹窗应该显示段数和笔记数
expect(screen.getByText(/25/)).toBeInTheDocument()
expect(screen.getByText(/8/)).toBeInTheDocument()
```

这两条是**子串匹配**：`getByText(/25/)` 命中"文本含 25 的任意元素"，`getByText(/8/)` 同理。testing-library 的文本匹配只看元素的**直接文本子节点**，因此卡片上的「最近学习」小字（`data-testid="last-studied-<id>"`，由 `src/ui/video-list.ts` 的 `formatLastStudied` 产生）与删除确认弹窗（`data-testid="delete-confirm"`，由 `buildDeleteConfirmation` 产生）**两处都会被 `/25/` 命中**。

**该用例真实渲染下有两处会命中 `/25/`**（据 Captain 抓取的完整 DOM dump，非本机探针的差异版渲染）：

1. 卡片：`20725 天前` —— `formatLastStudied(video.lastStudiedAt)`，夹具 `readyVideo.lastStudiedAt = 2000`（1970-01-01），故天数为"自 1970 年起的已满天数"；
2. 删除确认弹窗：`删除视频「测试视频」将永久删除 25 个段落和 8 条笔记，不可恢复。` —— 整句是该元素的直接文本。

**冲突证据（本机实测，未改动任何锁定文件）**：

```
❯ harness/m17-video-list-component.test.tsx (8 tests | 1 failed) 303ms
  × U52: 删除按钮弹强确认（决策60） > 点击删除弹出确认 50ms
    → Found multiple elements with the text: /25/
  ❯ harness/m17-video-list-component.test.tsx:91:19
  Test Files  1 failed (1)
       Tests  1 failed | 7 passed (8)
```

**日期相关性事实**：「天数」没有上界，当天数含 `"25"` 时两颗子弹才会撞上：

| 日期 | 自 1970-01-01 起的已满天数 | 卡片文本 | 含 `"25"` | 门禁 |
| --- | --- | --- | --- | --- |
| 2026-09-28 | 20724 | `20724 天前` | 否 | 绿 |
| 2026-09-29 | 20725 | `20725 天前` | **是** | **红** |

即：同一份未改动的代码，前一天全绿、次日全红；且此后**每逢天数含 `"25"`**（约每百天）复发一次。这也解释了为什么 `src/ui/components/video-list.tsx` 的「最近学习」渲染与锁定用例在同一提交里各自都"当天绿"。

**交付态说明（避免误读因果关系）**：本迁移**同时**做了两件事——A 把断言精确化，B 给「最近学习」的显示加上上界。在**交付态**下，卡片渲染的是 `1970-01-01`（实测 `queryAllByText(/25/)` 命中数为 1，只剩删除确认弹窗），因此旧的两条宽松断言在本交付态**也不会**再误命中卡片。换言之：消除该症状的不是 A 单独一项，而是 A 与 B 合起来——只做 A，产品侧仍留着"天数无上界"这个下一次相撞的来源；只做 B，断言侧仍留着"任意元素含数字即命中"的宽松面。

## 2. Replacement contract and Judge mapping

新断言（`harness/m17-video-list-component.test.tsx` U52 用例）：

```ts
// 确认弹窗显示段数与笔记数。
// 这里**必须**整句精确断言，不能用 getByText(/25/) 这类"文本含 25 即命中"的宽松匹配：
// 卡片上的「最近学习」会渲染 `${天数} 天前`，当天的天数一旦含 "25"（例如 2026-09-29 的
// "20725 天前"）就会同时命中两个元素，用例按日期发作变红（2026-09-29 的真实事故）。
// 精确断言严格更强：它同时钉住段数、笔记数与整句文案，而不是"存在一个含数字的元素"。
expect(await screen.findByTestId('delete-confirm')).toHaveTextContent(
  '删除视频「测试视频」将永久删除 25 个段落和 8 条笔记，不可恢复。',
)
```

写法与既有精确断言同源：`src/__tests__/video-list-deletion.test.tsx:407` 已在用
`expect(await screen.findByTestId('delete-confirm')).toHaveTextContent('1 个段落和 0 条笔记')`。

**判据强度对比表**：

| 覆盖点 | 旧（`getByText(/25/)`+`/8/`） | 新（整句 `toHaveTextContent`） |
| --- | --- | --- |
| 段落数 = 25 | 仅要求"某元素文本含 25" | 钉住整句中的 `25 个段落` |
| 笔记数 = 8 | 仅要求"某元素文本含 8" | 钉住整句中的 `8 条笔记` |
| 断言确实指删除确认弹窗 | **否**（任意元素含数字即可命中） | 是（`findByTestId('delete-confirm')`） |
| 整句文案（不可恢复等） | 否 | 是 |
| 数字位置/单位正确 | 否（`25` 出现在别的文案里也算过） | 是 |
| 按日期发作 | **是**（天数含 25 即全红） | 否（不再依赖其它元素的文本） |

结论：**只强不弱**——原意（确认弹窗显示段数与笔记数）完整保留，且新增了「必须落在该弹窗上」与「整句」两层约束；同时去掉了与产品文案无关的日期耦合。

**如实补充两点边界**（避免把结论说过头）：

- 精确化恢复的主要是**定位**（必须命中删除确认弹窗）与**整句锁定**（文案、单位、数字位置），而**不是**「只有它能拦住改动」：B 项落地后，旧的两条宽松断言**今天同样通过**（卡片已不再渲染 `N 天前`，副本还原旧断言实测 `8 passed`）。也就是说 A/B 是同一事故的两侧：A 去掉断言侧的误伤面，B 去掉产品侧的无上界增长。
- 本记录的 §4(1) 三个注入只保留了其中一个的原始输出；其余两条只给计数，属**部分证据**而非完整原文。

## 3. Allowed and forbidden boundary

允许的写入仅限：

- `harness/m17-video-list-component.test.tsx` 的 U52 用例第 91–92 行（本记录唯一的锁定文件改动）；
- `src/ui/video-list.ts` 的 `formatLastStudied`（超过 365 天改显本地日期）及其导出；
- `src/__tests__/video-list-last-studied-date.test.ts`（新增裁判，不属于锁定文件）；
- 本迁移记录；
- `docs/development/visual-contract.md` §7（**纪律的唯一落点**）。

禁止的写入包括：删除或跳过 U52 用例、放宽同文件其它断言、新增 `skip`/`todo`、改动其它
`harness/**` 文件与 `src-tauri/tests/**`、改动 `vitest.config.ts`、借机重排 Harness、
任何产品语义或 AC 状态变更。

**退役/影子项：无。** 不保留一套"只在新断言里用、产品已不再产生"的旧写法——旧的两条子串断言被
**替换**（不是并存），`formatLastStudied` 的「N 天前」分支对 365 天以内仍然保留且被新裁判钉住。

**纪律登记（本次事故立的规矩）**：锁定测试里的**子串/裸数字匹配**与产品新增的**用户可见文本**是一对
定时炸弹——新增任何用户可见文本前，必须检索锁定测试中的宽松匹配（子串正则、单个数字），确认不会误伤。

**落点口径（避免歧义）**：纪律全文只落在 `docs/development/visual-contract.md` §7；`docs/PROJECT_STATE.md`
只记**用户决定本身与指向本记录的指针**，不重复纪律正文。两处都不改变任何 AC 或 Evidence 状态。

## 4. Verification and completion boundary

本机实测（提交前）：

- **A 精确化**：改前 `harness/m17-video-list-component.test.tsx` = `1 failed | 7 passed`；改后 = `8 passed`。
  注入证明仍具失败能力（改动 `buildDeleteConfirmation` 的文案后逐条 RED，还原即 GREEN）：
  - 段数换成 `nodeCount - 1`：`1 failed | 7 passed`，原始输出
    `Expected … 25 个段落和 8 条笔记，不可恢复。` / `Received … 24 个段落和 8 条笔记，不可恢复。取消`
  - 去掉笔记数（整句变短）：`1 failed`
  - 改文案（`不可恢复` → `无法恢复`）：`1 failed`
- **B 显示规则**（三段状态，均为本机实测；早先本记录把前两段混写成一句，已按实测更正）：
  1. 函数**尚未导出**、实现仍是旧的：`TypeError: (0 , formatLastStudied) is not a function`（该文件 8 条全失败）；
  2. 已导出、但 `> 365` 规则**尚未实现**：`4 failed | 4 passed` —— **这一态**才会渲染出 `20725 天前`；
  3. 规则实现后：`8 passed`。
  反例锚点：删掉 `completedDays > 365` 分支后该文件 RED，失败信息含
  `expected '20725 天前' not to contain '天前'` 与 `expected '20725 天前' to be '1970-01-01'`。
- 全量前端套件：`Test Files 113 passed | 1 skipped (114)`、`Tests 917 passed | 1 skipped (918)`，退出码 0。
- `npx tsc --noEmit` 退出码 0；`git diff --check` 干净。
- `npm run harness:control` 通过。

完成边界：本迁移只解除「锁定期望值随日期发作」这一门禁失效，并让「最近学习」的显示有上界，
**不**提升任何 AC 等级、不签发任何 Visual Evidence、不改变任何 `VCGAP-*` 登记，
也不授权任何真实桌面实测结论。
