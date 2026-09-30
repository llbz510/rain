# 证据包说明（入库时添加，**不是**采集器产出）

> 本文件由入库方在把托管采集 artifacts 落库时添加。它**不含任何实测数据**、**不签发任何结论**；
> 采集器本身不产出本文件。包内数据原样来自 workflow artifact，未做任何修改——可用
> `manifest.json` 的 `generatedBy` / `provenance` / `target.runId` 与下面的出处逐项核对。

## 必须明写的一句

**本包只含合同 §3.4 第 1–3 项数据；第 4 项（逐条 `pass`/`needs_revision`）由独立视觉审查员 V2 签发，当前未签发。**

## 出处（可与 GitHub Actions 逐项核对）

- 采集 run：[`36655537703`](https://github.com/llbz510/rain/actions/runs/36655537703)
  （workflow `Visual Evidence`，`workflow_dispatch`，ref `master`，结论 `success`）
- artifact：`visual-evidence`（id `11072406778`）；包目录名即 `visual-<目标sha8>-<yyyyMMdd-HHmmss>`
- 目标提交：`c2c756010eceba941657059ca31d4abd746799d3`（PR #86 squash 合并提交）
- 宿主：Windows Server 2025 Datacenter `10.0.26100` / WebView2 `153.0.4234.48`（来源
  `preflight-devtools`，其降级**前提**已随包记录并成立：`host.webview2.premise.established = true`）
- 视口：`1028 × 749 @ devicePixelRatio 1`（原生 Tauri 窗口默认尺寸，未改）
- 形状校验：`scripts/validate-visual-evidence.ps1 -EvidenceRoot <本目录>` →
  `VISUAL_EVIDENCE_VALID: 1 个证据包通过 §3.4 第 1–3 项与容差/覆盖清单校验`（exit 0）

## 本包**没有**说什么

- **没有任何一条 `VC-xx` 被判 `pass` 或 `needs_revision`**：`manifest.json` 的 `verdicts.issued` 为 `false`。
  「采集到数据」不等于「实测通过」，「形状校验通过」也不等于「视觉达标」。
- 本包**不构成**任何 AC 的 Evidence，**不改变**任何 AC 状态或 Evidence tier。
- 覆盖范围以 `manifest.json` 的 `coverage.tested` / `coverage.untested` 为准；未被任何记录覆盖的维度
  视为未测，不得用"其余看起来一致"推断通过（合同 §3.4）。

## 已知限制（据实登记，供 V2 判读时注意）

1. `VC-03-list-import-button-focus-ring` 一条记录里 `measured.outline.style` 记的是 `dashed`，而
   `measured.outline.rendered` 是 `false`。原因是探针在**构建同一条记录的过程中**执行了程序化
   `focus()`，而 `getComputedStyle()` 返回的是**活对象**：`rendered` 在 focus 之前求值、`style`
   在 focus 之后读取。聚焦前后的权威读数都在 `derived.focusRing` 里（`ringBeforeFocus` /
   `ringDuringFocus`）。这是**记录形状的已知瑕疵**，不是"该元素没有聚焦圈"的结论。
2. `host.webview2.runtimeVersionSource = preflight-devtools`：该版本取自**预检**的同主机读数，不是
   被实测会话自己读到的。前提已随包记录（见上），强度由 V2 判断。
3. 三条 `VC-01` 背景类记录的 `measured.border.rendered` 四边全为 `false`（这些元素没有边框），
   因此它们的边框通道不参与任何令牌对账——这是设计如此，不是缺测。
