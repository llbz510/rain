# Rain Harness Migration — 段落四色令牌取值重钉 — 2026-09-28

> Status: Active
> Authorization: 用户明确批准方案 A（Harness Migration），授权范围严格限定为「把 `harness/m13-visual.test.ts` 中那份期望值数组重新钉到用户已批准的新值」，不得删除用例、放宽其它断言、新增 skip/todo、改动同文件其它用例、改动其它锁定文件或借机重排 Harness。
> Contract: 视觉合同 `docs/development/visual-contract.md` 的 `DEC-VC-03`（按背景分两套值、语义不变、深底亮一档）与 §5.5.1「彩字态」；本合同不定义 AC、不改变任何 AC 状态、不签发任何 Visual Evidence。
> Purpose: 让锁定 Harness 的期望值与用户已批准的段落四色取值一致，从而解除 `VCGAP-14`/`VCGAP-15` 的落地阻塞；判据强度与覆盖点**不变**。

## 1. Trigger evidence and old contract

旧合同位于 `harness/m13-visual.test.ts:22-29`（用例「加载四种段落颜色」），第 28 行的期望值数组为：

```ts
]).toEqual(['#3b82f6', '#10b981', '#f59e0b', '#6b7280'])
```

该数组把 `src/index.css` 的 `--color-concept` / `--color-example` / `--color-analogy` / `--color-transition` 四个令牌**逐值焊死**为上述旧值。

**这些旧值是实现自选、从未经用户批准**：`M13-visual-design.md` 决策 66 只冻结了「概念描述=蓝 / 例子=绿 / 类比=橙 / 过渡=灰」的**映射关系**，没有冻结任何色值；旧值属于实现侧自行选定的十六进制。用户于 2026-09-28 冻结的 `DEC-VC-01`…`04`（其中 `DEC-VC-03` = 按背景分两套值、深底用亮一档）与合同 §5.5.1 的标定表给出了**已批准**的深底取值：`#5b9bf8` / `#3ecf8e` / `#f0a13c` / `#9e9e9e`。

冲突证据（S4 实施时实测，未改动任何锁定文件）：

```
harness/m13-visual.test.ts (2 tests | 1 failed)
 × M13: 应用实际加载的视觉令牌 > 加载四种段落颜色
   → expected [ '#5b9bf8', '#3ecf8e', … ] to deeply equal [ '#3b82f6', '#10b981', … ]
   （上行为**转述**，非逐字粘贴：CI 日志里的数组按 vitest 的默认格式多行展开。）
```

即：按合同把令牌改为已批准值，会让这条锁定用例失败，进而使 `npm run harness:check` 与托管门禁变红。旧值本身也让类型色**作文字时不达标**（压 `--color-surface`：`#3b82f6` 4.22:1、`#6b7280` 3.21:1，均 <4.5:1），这正是 `VCGAP-14`/`VCGAP-15` 的登记内容。

## 2. Replacement contract and Judge mapping

**只改期望取值，不改判据强度。** 该用例的意图是「应用实际加载了四种段落颜色」——它断言的是 `src/index.css` 里四个令牌**实际解析出的值**（`getComputedStyle` 读真实 CSS 级联），覆盖点仍是「四个令牌各自存在且取到确定值」。

| 维度 | 旧合同 | 新合同 | 强度变化 |
| --- | --- | --- | --- |
| 断言形式 | 四元数组 `toEqual` 精确相等 | 同一形式、同一位置、同一用例 | 不变 |
| 覆盖点 | 四个令牌各一个值 | 四个令牌各一个值 | 不变 |
| 严格性 | 精确相等（含大小写与 `#` 前缀） | 精确相等 | 不变 |
| 失败能力 | 任一令牌被改动即失败 | 任一令牌被改动即失败 | 不变 |
| `skip`/`todo`/超时/重试 | 无 | 无 | 不变 |
| 同文件其它用例 | 阶梯（间距/字号/圆角/动效）断言 | 未改动 | 不变 |

新期望值数组（第 28 行）：

```ts
]).toEqual(['#5b9bf8', '#3ecf8e', '#f0a13c', '#9e9e9e'])
```

**对应 AC / 合同条目**：`AC-UX-02`（段落四类 = 全界面唯一颜色映射；其中「类型色作文字须达 AA」由 `AC-UX-06` 承接）；合同 `VC-04`（决策 66 的唯一映射）与 §5.5.1「彩字态」；`DEC-VC-03`（深底亮一档、按背景分两套）；登记在这四条令牌行上的缺口 `VCGAP-14`（`--color-transition` 作文字 3.21:1）与 `VCGAP-15`（`--color-concept` 作文字 4.22:1）。

**唯一真相源**：`src/index.css` 仍是四种段落颜色的唯一真相源。本迁移**不需要**另设承载处（方案 B 不执行），也没有把取值搬到任何 TS 表里。

## 3. Allowed and forbidden boundary

允许的写入仅限：

- `harness/m13-visual.test.ts` 第 28 行的期望值数组（本次唯一改动的锁定文件内容）；
- 本迁移记录；
- `src/index.css` 的四条令牌取值与说明注释；
- `src/ui/components/type-capsule.tsx`（新增，决策 71 的类型胶囊形态）、`src/ui/components/text-zone.tsx`（在既有 `data-type-badge` 占位处渲染胶囊；**该属性钩子必须保留**）、`src/ui/components/notes.tsx`（裸写 `#3b82f6` 改用令牌）；
- 视觉合同、`PROJECT_STATE.md`、以及本轮的视觉裁判与它们触达的测试。

禁止的写入包括：删除或跳过该用例、放宽同文件其它断言、新增 `skip`/`todo`、改动其它 `harness/**` 文件与 `src-tauri/tests/**`、改动 `vitest.config.ts`、借机重排 Harness、任何产品语义或 AC 状态变更。

**退役/影子项：无。** 不保留一套永不使用的旧令牌——四个令牌在同名位置被重新钉到新值，旧值只作为历史记载留在本记录与合同 §5.1/§5.2 的「改造前」基线里，**产品代码**内不得再出现这四个旧字面量（裁判里的反例锚点与 `index.css` 的历史注释除外；由 `src/__tests__/visual-contract-type-colors.test.ts` 的锚点守住 `index.css` 与 `notes.tsx` 两处）。

## 4. Verification and completion boundary

本机（S4 提交前实测）：

- `harness/m13-visual.test.ts`：重钉后 `2 passed`；在实现回退态也 `2 passed`（证明它是纯取值钉，不是行为判据）。
- 五个视觉裁判：`visual-contract-primary-actions` 12 + `visual-contract-settings-palette` 15 + `visual-contract-control-styles` 9 + `visual-contract-type-colors` 13 + `visual-contract-palette-parity` 7 = **56 passed**。
- RED 证据：把 S4 实现（令牌取值、两处使用点、Harness 期望值）回退后，`visual-contract-type-colors` **9 项失败**（令牌取值、四色压三底、与 §5.5.1 最小值的对照、淡底 rgb 一致性、胶囊文字压淡底、登记边界、段落头使用点、裸写十六进制、旧值锚点）且 `visual-contract-palette-parity` **1 项失败**（方向判据：深底 `#3b82f6` 比浅底 `#539bf5` 更暗），合计 **10 项**；若连新增的胶囊组件一并移除，该裁判文件还会因读不到源文件而整文件失败——即两条路都会红。恢复后 type-colors 13 + parity 7 + 锁定 `harness/m13-visual` 2 = **22 passed**。
- `npm run harness:control` 通过；`npx tsc --noEmit` 退出码 0；`git diff --check` 干净；全量前端套件见 S4 的 PR 描述。
- 托管门禁与桌面 E2E 的 run 号与结论：见 S4 的 PR 描述与 `PROJECT_STATE.md` 的受保护基线（本记录不复制会过期的 run 号）。

完成边界：本迁移只解除「锁定 Harness 期望值与已批准取值不一致」这一阻塞，**不**提升任何 AC 等级、不签发任何 Visual Evidence、不改变 `VCGAP-14`/`VCGAP-15` 之外的任何登记，也不授权任何真实桌面实测结论。
