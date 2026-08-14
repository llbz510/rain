# Rain Project State

> This file is the living project-state document for Rain. Every AI/developer session that changes the project must update it before handing off. Read this file before trusting old PRDs, plans, screenshots, or progress claims.

Control status: `Active`
Primary checkout: current Git worktree; the canonical local checkout for this active migration is `D:\xiangmu\rain 未完成`. Active control documents and runnable scripts must not depend on a legacy checkout location.
Volatile checkout facts are intentionally not stored here. Run `git status --short`, `git branch --show-current` and `git log -1 --oneline` for the current worktree state.
Remote status: public GitHub remote `origin` is configured at `https://github.com/llbz510/rain.git`; local `master` tracks `origin/master`. The independent Windows CI Judge is proven on pull request and `master` push runs. GitHub branch protection requires the `Clean Windows Harness` check, including for administrators, and rejects force-pushes and branch deletion.

## Current verified status

Rain is a Tauri + React + TypeScript desktop study app with a Rust backend. The real local-video pipeline has been repaired enough to run a real lecture video through local Whisper ASR, Qwen/DashScope structuring, persistence, cancellation/retry proof, and final UI screenshot evidence.

The no-key Runtime Settings desktop behavior Judge and its independent Hosted Windows replay are proven on current `master`. `AC-HE-05` is Strong for merge commit `a329059b8172dab82c7326deb0af322045a0c396`: workflow_dispatch run `30756311932` performed a clean build with the pinned WebView2/driver pair and completed schema initialization, model add, pending-import restart recovery with explicit continuation, first restart persistence, deletion and second restart absence without a Key. The workflow remains manual and outside the default merge gate; future target commits need their own explicit replay when this desktop boundary changes.

Historical product-intent coverage is now mechanically controlled by `AC-HE-06`.
`docs/development/product-decision-coverage.md` contains exactly `DEC-PRD-001` through `DEC-PRD-099`, each with a current PRD/M source and one disposition: 72 map to Confirmed ACs, 23 Post-release rows remain Proposed, and 4 are Out-of-scope. These counts are not a project-completion percentage. The 31 M1-S2 promotions freeze Launch product semantics, while `harness-coverage.md` conservatively keeps the new ACs at their actual Partial/Gap strength.

M1-S2, M2-S1, M2-S2 and M3-S1 are complete. PR #30 merged the NSIS generator fix as `master@3cf38f223ab084bc8f37766720806cfa90362ae3`; an exact-master candidate was built locally, but it predates the current support-contract migration and is not current RC Evidence. On 2026-08-03 the user confirmed that Core Release only supports Windows x64 hosts with a supported NVIDIA GPU and compatible driver. The current atomic Harness Migration makes `AC-RL-07` Superseded, retires the no-NVIDIA runner, preserves CPU-safe/Auto fallback behavior, and makes M3-S3 supported-NVIDIA Evidence the next runtime Slice. Signing, licensing and real-video Evidence remain absent.

`AC-LV-19` is Strong on merged `master` commit `bcec16f`: every non-ready card opens a persisted import-task detail without starting work, production Stage2 block/retry progress can overlay the SQLite fact, and only explicit detail actions retry or cancel. Closing the detail leaves the current task running; App page switches retain the same frontend Pipeline Owner; a restart-stale `processing` record can explicitly cancel through the desktop adapter and close its persisted state. The production-page/jsdom, public Controller, real memory database and production Stage2/Pipeline Judges passed locally and in the clean Windows merge gate. That AC still does not claim automatic `pending` restart recovery; the separately confirmed explicit recovery boundary is now `AC-LV-20` below.

`AC-LV-20` is Confirmed and Strong on merged `master` commit `c7436c4`: a restart-stale `pending / stage=null` record stays idle until the user opens its task detail and explicitly chooses “继续导入”. The current app-lifetime `VideoImportController` starts only the same Video ID, keeps duplicate clicks single-flight, updates that SQLite row and continues after the dialog closes. The production-page/public-Controller/real-memory-database Judge and the no-key Windows/Tauri three-process restart Judge both passed. Automatic startup scanning, cross-process leases/queues and the two architecture debts in risk 22 remain outside this AC.

`AC-LV-21` is Confirmed and Strong on merged `master` commit `83670e7` (PR #23; product commit `d8f2292`). Runtime Settings defaults to `Auto`; the CPU-safe main process selects an isolated CUDA worker when its versioned probe succeeds and otherwise exposes the reason before using CPU. Forced CUDA fails closed, forced CPU never probes the worker, cancellation/model errors do not silently rerun another backend, and import details expose the actual backend/fallback. Local RTX 5060 Ti + large-v3 short-sample smoke, CPU-main DLL isolation and PR #23's clean Windows Harness passed. This is Strong behavior with a local NVIDIA smoke, not `Strong + Evidence`: current `AC-RL-02/08/18` control the single GPU-enhanced installer and supported-host disclosure; target-installer NVIDIA Evidence, lifecycle/signing, CUDA redistribution approval and target-package disclosure remain Partial/Gap. `AC-RL-07` no-NVIDIA Release Evidence is Superseded, not passed.

The verified real input video is:

`D:\xiazaiwenjian\bilidown\【华中科技大学】电子技术基础 张林（全138讲）电子信息工程专业必修课\1.2.1 信号及其放大.mp4`

Latest tracked schema v2 Evidence package (historical target Evidence; see the M2-S2 freshness audit):

`evidence/rain-real-e2e-20260726-195652/`

Important evidence facts:

- Whisper backend: `cuda`
- Whisper model: `ggml-large-v3.bin`
- Structuring/text-assistant model: `qwen3-omni-flash`
- OpenAI-compatible base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- ASR sentence count: 1953
- Structuring block count: 12
- Database status/stage: `ready` / `ready`
- Database node count: 34
- ASR timing: 1408 seconds
- Structuring timing: 1050 seconds
- Pipeline timing: 2459 seconds
- Role status: the same configuration fingerprint passed ASR, structuring and text-assistant `Compatible` checks and was then recorded as `Verified`
- Runtime gates: missing ASR/structuring capability was rejected by `VideoImportController`; missing assistant capability was rejected before chat
- UI proof: WebDriver captured the production study page with the matching video, visible player and 21 rendered paragraphs
- Scope: this historically proves the named configuration and text assistant on the repository-associated 408b6db-era path only; it does not verify the current target, other compatible models or vision

The previous schema v1 evidence at `evidence/rain-real-e2e-20260720-024848/` remains valid historical evidence for its recorded configuration, but it is not the latest tracked schema v2 package.

Fresh verification performed before repair commit `a9c5c26` (recorded from the repair session transcript; full test logs were not committed as separate artifacts):

```powershell
npm.cmd test
npm.cmd run build
cargo.exe test --manifest-path src-tauri\Cargo.toml --no-default-features
cargo.exe test --manifest-path src-tauri\Cargo.toml --no-default-features --features cuda-whisper runtime::tests::capability_reports_compiled_backend_without_claiming_runtime_fallback
powershell.exe -ExecutionPolicy Bypass -File scripts\validate-evidence.ps1 -EvidenceManifest evidence\rain-real-e2e-20260720-024848\manifest.json -ExpectedWhisperBackend cuda
```

Results at that time:

- Vitest: 49 files passed, 418 tests passed, 1 live Qwen test skipped.
- Frontend build: passed; Vite emitted only dynamic/static import chunking warnings.
- Rust tests: passed; locked harness warnings remain in `src-tauri/tests/commands_harness.rs`.
- CUDA feature test: passed.
- Evidence validator: passed with `ok: true`, backend `cuda`.

## Source-of-truth files for new sessions

Read in this order:

1. `AGENTS.md` — environment/build rules and harness restrictions.
2. `docs/development/control-map.md` — authority by question, document status, and conflict handling.
3. `docs/PROJECT_STATE.md` — current truth, recent changes, known defects, and file responsibilities.
4. `docs/development/acceptance-standard.md` — active acceptance criteria.
5. `docs/development/product-decision-coverage.md` — current disposition of historical PRD decisions 001–099; not a completion score.
6. `docs/development/harness-coverage.md` — AC-to-test/evidence coverage and gaps.
7. `docs/development/module-map.md` — module responsibilities, interfaces, and migration rules.
8. `docs/development/agent-first-development-plan.md` — Active one-Slice cross-session execution order and mandatory independent-review gate; it does not define product behavior.
9. `docs/development/rain-project-delivery-plan.md` — Active milestone roadmap from scope freeze through RC, formal release and post-release verification; Proposed product slices still require user confirmation.
10. `docs/development/release-scope-contract.md` — Active, user-confirmed M1-S1 Core Release scope; it fixes Launch/Post-release destinations and the single GPU-enhanced universal installer boundary.
11. `docs/development/release-acceptance-contract.md` — Active M1-S2 confirmation/traceability record amended by the 2026-08-03 GPU-required migration; current semantics are 49 of its original 50 ACs Confirmed and `AC-RL-07` Superseded, while completion strength remains in `harness-coverage.md`.
12. `docs/development/release-artifact-contract.md` — Active M3-S1 artifact contract; defines the single NSIS artifact, CPU-safe main program, isolated CUDA payload, manifest, forbidden contents and future Release Evidence Judges.
13. `docs/development/control-plane-harness.md` — mechanical control-document rules and one-command Harness entry.
14. `docs/development/runtime-settings-desktop-e2e.md` — no-live-key desktop restart contract for Runtime Settings.
15. `docs/development/canonical-evidence-freshness-2026-08-02.md` — Active M2-S2 audit; classifies canonical schema v2 claims as immutable historical facts, current validator coverage or exact-RC rerun requirements.
16. `package.json` — runnable frontend/test/E2E commands.
17. `scripts/run-real-e2e.ps1` — real E2E automation and runtime environment assumptions.
18. `scripts/validate-evidence.ps1` — what counts as acceptable real evidence.

Do not infer real progress from PRD wording, old screenshots, or old evidence directories. Validate with commands or committed evidence.

## Directory and file responsibilities

| Path | Purpose | Notes |
| --- | --- | --- |
| `src/` | React/TypeScript application code. | Includes pipeline, models, settings, UI, and E2E runner entry guarded by environment config. |
| `src/pipeline/` | Frontend pipeline orchestration for ASR and Stage2 structuring. | `stage2-runner.ts` owns Qwen block calls and deterministic merge. |
| `src/llm/` | OpenAI-compatible LLM HTTP client. | Currently used for DashScope-compatible Qwen calls. |
| `src/models/` | Frontend database and domain models. | Uses Tauri SQL plugin; this is why `sql:allow-execute` exists. |
| `src/settings/` | Runtime model settings and readiness checks. | `preflight.ts` is the user-facing readiness check for local-video workflow prerequisites. |
| `src/ui/components/settings/` | Settings UI components split by responsibility. | `settings-page.tsx` composes the page; capability decisions remain in `src/settings/`; `src/ui/components/settings.tsx` is the stable public barrel. |
| `src/e2e/` | Real app automation helper for evidence generation. | Guarded by runtime environment; not normal user workflow code. |
| `src/__tests__/` | Product/unit/regression tests owned by implementation. | Can be modified when implementing features. |
| `harness/` | Locked frontend harness tests and test-only support. | `harness/support/` may be imported by tests only; production `src/` must never depend on it. Do not modify locked Harness unless user explicitly approves migration. |
| `src-tauri/` | Rust backend, Tauri config, capabilities, and Rust tests. | `src-tauri/target/` is local build output and ignored by `src-tauri/.gitignore`. |
| `src-tauri/tests/` | Locked Rust harness tests. | Do not modify unless user explicitly approves harness changes. |
| `scripts/` | Project automation scripts. | `run-real-e2e.ps1` runs real workflow; `validate-evidence.ps1` validates evidence. |
| `evidence/` | Curated proof artifacts only. | Failed/partial E2E runs are ignored by `.gitignore`; force-add only intentionally curated evidence. |
| `docs/` | Long-lived project docs, plans, specs, and this state document. | `docs/PROJECT_STATE.md` must be updated after every session that changes the project. |
| `docs/research/` | Primary-source research notes that separate cited source facts from Rain-specific inferences. | Research notes default to Proposed and cannot override Active AC, control documents or current repository evidence. |
| `docs/superpowers/` | Superpowers specs/plans used by prior agent work. | Historical plans/construction docs, not automatically current truth; plan checkboxes and old test counts are not progress evidence. |
| `prototype/` | Mockups and early prototypes. | Do not treat as runtime source. |
| `test-fixtures/` | Small test and capability-probe media fixtures. | `sample.mp4` supports media tests; `asr-capability.mp4` is bundled into Rain and contains a short English speech sample for the real Whisper capability check. |
| root `M*.md`, `PRD.md`, `HANDOFF.md` | Original requirements and historical handoff docs. | Useful context but may be stale; prefer this file for current state. |

## File-management rules

Important evidence rule: `.gitignore` ignores `evidence/rain-real-e2e-*/` for new local runs, but already tracked curated evidence remains tracked. If a new run becomes the canonical proof, explicitly force-add only the curated JSON/log/screenshot artifacts. SQLite sidecars (`rain-e2e.db`, `.db-wal`, `.db-shm`) and temporary folders are not part of the curated committed evidence set unless the user explicitly asks.

- Keep source, tests, scripts, and curated docs tracked.
- Keep generated build outputs, caches, failed evidence runs, SQLite sidecars, temporary agent notes, and local logs untracked/ignored.
- If a future real E2E run is the new canonical proof, force-add only the minimal artifact set needed by `scripts/validate-evidence.ps1`; do not commit large `.db`, `.db-wal`, or `.db-shm` files unless the user explicitly asks.
- Do not delete large local caches without explicit user approval. They take disk space but also speed up Rust/CUDA rebuilds.
- When adding a new major workflow, document where its files live and how to validate it in this file.

## Known defects and risks

1. The repository is public, so every tracked file and retained Git object must be treated as world-readable. Branch protection requires the independent Harness before `master` changes, but it does not replace credential, sensitive-evidence or large-file review before a commit is published.
2. The main workspace has a lot of local build/cache data: `.worktrees/` was about 86.62GB during the 2026-07-22 check; `src-tauri/target` in the main workspace was about 15.33GB.
3. Historical failed evidence runs exist locally. `.gitignore` now hides new/old untracked run directories from normal status, but no destructive cleanup has been performed.
4. `sql:allow-execute` is currently enabled because the frontend database layer executes SQL through the Tauri SQL plugin. This is acceptable for a local-only trusted WebView, but it is broader than ideal if remote/untrusted content is ever loaded.
5. E2E automation is now build-isolated under `AC-HE-02`. `RAIN_E2E_BUILD=1` intentionally creates a non-distributable automation build; `npm run harness:check` constructs and judges that side first, then restores and judges the ordinary artifact. Only the default `npm run build`, which rejects E2E markers in `dist`, qualifies as the normal production frontend artifact.
6. ASR output is readable Chinese and no longer mojibake, but recognition accuracy is not perfect. For example, lecture terms can still be misrecognized by Whisper.
7. The final Stage2 merge is deterministic local merging rather than a final global Qwen merge. This avoids DashScope token/rate failures and keeps every sentence covered, but it may produce less globally polished chapter naming than a successful global model merge.
8. Many root-level historical docs (`M*.md`, `PRD.md`, `HANDOFF.md`) make the root directory crowded and can mislead new agents if read as current truth without this state file.
9. The real E2E script is intentionally bound to this local machine setup: fixed local video hash/path assumptions and D-drive CUDA/Ninja tooling paths. Its LLM endpoint/model are now configurable through generic OpenAI-compatible environment variables, but it remains a local verification script rather than portable CI.
10. The main checkout at `D:\gongju\shengcan\rain` has been fast-forwarded to include the `codex/rain-real-local-video` repair branch through `7a9eeb1`. The separate worktree still exists and can be removed later only with explicit user approval.
11. PowerShell console output can display Chinese text as mojibake in some command pipelines. Check UTF-8 files with a direct UTF-8 reader before concluding that project artifacts are corrupt.
12. `git status` may show `M src-tauri/Cargo.toml` even when `git diff --exit-code -- src-tauri/Cargo.toml` returns 0. The observed cause is line-ending normalization: the committed blob contains CRLF line endings while the working-tree file has LF line endings under `core.autocrlf=true`. Treat this as a line-ending/index hygiene issue, not a Rust dependency change, unless `git diff` shows real content.
13. DEC-001's generic records, stale-result invalidation, role-assignment gate, real short-sample Whisper probe, provider-neutral structuring and text-assistant probes, preflight integration, local-video runtime gate, learning-page assistant gate, and schema v2 Evidence Harness are implemented. `AC-LV-12` has current Strong capability/runtime gates plus Historical Evidence for the exact `ggml-large-v3.bin` CUDA + DashScope `qwen3-omni-flash` structuring/text-assistant configuration; the current isolated worker and exact RC remain an Evidence Gap. Other model fingerprints remain merely `Compatible` or `Unavailable` until they receive their own complete evidence.
14. Advanced tree editing is not in the current Active acceptance scope. Its old Harness-only implementation and no-op controls were removed; restoring it requires a new AC plus real UI, persistence, and behavior tests.
15. Live LLM smoke tests intentionally skip when no process environment Key is present. The current smoke test reads generic `RAIN_LIVE_LLM_*` variables and otherwise uses the current `qwen3-omni-flash` default; historical schema v1 evidence continues to validate its recorded `qwen3.5-omni-flash` fingerprint and must not be rewritten as current evidence.
16. `src/ui/components/layout-switch.tsx` is a placeholder composition used only by the locked M16 component Harness; it is not the production learning page. It can remain a local layout-contract judge, but must not sign off `AC-ST-08`. Retiring or replacing it requires an explicit Harness Migration because the locked test imports it.
17. Whole-repository `cargo fmt --check` is not currently a usable clean gate: it reports pre-existing formatting differences in `src-tauri/src/whisper.rs`, `src-tauri/src/ytdlp.rs` and locked files under `src-tauri/tests/`. Do not format or modify the locked Rust Harness without an approved Harness Migration. New Rust changes must still pass file-scoped `rustfmt --check` until this debt is separately authorized and resolved.
18. `AC-HE-05` is Strong on merge commit `a329059b8172dab82c7326deb0af322045a0c396` via workflow_dispatch run `30756311932`. The public command ran without `-SkipBuild`, used no Rain secrets and proved real schema, add/restart/delete/restart plus explicit pending-import recovery. Its manual Hosted result is target-commit evidence, not a permanent guarantee for later desktop-environment changes; do not add automatic PR/push triggers or substitute local/default-Harness GREEN when a new replay is required.
19. `AC-HE-06` prevents the 99 historical product decisions from silently disappearing.
    The map intentionally leaves 23 Post-release decision rows Proposed. Major clusters include cloud ASR/language/translation, Vision, advanced tree editing and advanced diagram gestures. Do not infer that every Proposed behavior is absent, or promote it from an implementation file or old PRD alone.
20. Local-thumbnail creation, persistence and card rendering are Confirmed and Strong. `AC-VL-05/06` now own app-thumbnail deletion and orphan GC semantics, but both remain implementation/real-file coverage gaps; the existing database-deletion boundary still Strongly covers atomic database cascade and preservation of the user's source video.
21. `AC-LV-20` closes the user dead end for a persisted `pending/null` record through an explicit continue action and real no-key desktop restart Judge. Rain still deliberately has no automatic startup reconciler, cross-process lease or persistent import queue; those policies remain outside the confirmed boundary and must not be inferred from the explicit recovery path.
22. `AC-LV-19` currently preserves the frontend import Owner across page switches by keeping the complete `VideoListPage` mounted but hidden, and the Pipeline progress callback still accepts the loosely coupled `stage`, `percent` and optional `details` parameters. Both paths are functionally judged and are not P0/P1 defects, but a future architecture boundary should lift the Controller to an explicit App-scope Owner and replace the progress tuple with a discriminated contract before navigation or pipeline variants expand.
## What changed in the 2026-07-26 project-control baseline session

Added the first active control layer for agent-assisted development:

- `docs/development/control-map.md` assigns authority by question and defines document statuses and conflict handling.
- `docs/development/acceptance-standard.md` defines the initial AC catalog for the real local-video workflow.
- `docs/development/harness-coverage.md` maps each AC to strong, partial, weak, or real-evidence checks.
- `docs/development/module-map.md` records module responsibilities, dependency direction, hotspots, and the first controlled refactor target.
- `AGENTS.md` now requires new sessions to enter through this control layer.

The initial control-document slice did not change product code or locked Harness. Its scope intentionally covers the highest-risk local-video pipeline; remaining PRD modules still need incremental AC mapping.

Follow-up decision recorded in this session:

- The user selected DEC-001 option C: support multiple model configurations through a uniform per-role capability contract.
- A configuration that passes its role check is `Compatible`; only a full real E2E profile is `Verified`; failed checks are `Unavailable`.
- The current fixed Qwen/Whisper preflight remains an implementation gap against this confirmed rule.

First controlled refactor completed in the same session:

- Added `src/pipeline/video-import-controller.ts` with the small interface `importLocal/start/cancel/acceptProgress`.
- Moved local media probing, pending-record creation, runtime-settings snapshotting, Pipeline startup/retry, cancellation, progress normalization, and failure-state repair out of `VideoListPage.tsx`.
- Disabled the import button until the database/controller is ready, fixing the prior silent return when a user clicked import during startup.
- Added `src/__tests__/video-list-local-import.test.tsx`, which verifies the path from the local-import UI through the desktop adapter to a persisted `pending` video and visible card, without `yt-dlp`.
- Updated the existing recovery test mock to use Vitest's hoisted seam after Pipeline became a static controller dependency.
- Did not modify locked Harness or Rust product code.

Verification:

```powershell
npm.cmd test -- src/__tests__/video-list-local-import.test.tsx src/__tests__/video-list-page-recovery.test.tsx src/__tests__/video-list-import.test.tsx
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result:

- Targeted video-list tests: 3 files / 7 tests passed.
- Full frontend suite: 52 files / 427 tests passed; 1 live Qwen test skipped by its existing environment guard.
- TypeScript and production build passed.
- Vite retained the existing dynamic/static import chunking warnings.
- A new paid/long-running real E2E was not run for this refactor; the existing canonical evidence remains the latest real workflow proof.

## What changed in the 2026-07-18 to 2026-07-22 repair session

Committed in `a9c5c26 Make Rain real local video pipeline usable`:

- Added/used CUDA Whisper build path with `cuda-whisper` feature and runtime capability reporting.
- Updated real E2E automation to prefer CUDA, use D-drive local CUDA/Ninja tooling, run the real local video, and write evidence.
- Fixed Whisper ASR behavior: default Chinese language, explicit language propagation, no detect-only failure, suspicious token text ignored for Chinese segments, mojibake rejected.
- Fixed Stage2/Qwen handling: robust JSON extraction from fenced/explained responses, Qwen near-schema normalization/repair, exact sentence coverage, deterministic local final merge, retryable HTTP errors with backoff.
- Added real evidence validation script and tests, including checks for real video hash, exact Qwen runtime, CUDA log proof, transcript quality, database readiness, cancellation/restart proof, screenshot PNGs, and secret-like tokens.
- Added real app E2E runner under `src/e2e/` and environment-backed Rust E2E config command.
- Committed the curated successful evidence directory `evidence/rain-real-e2e-20260720-024848/`.

Current branch state after the repair and file-hygiene commits:

- Commits `a9c5c26` and `3abc242` exist locally on `codex/rain-real-local-video`.
- Push is blocked by missing remote.
- Local untracked caches/failed evidence directories may exist but should now be ignored after the file-management cleanup.


## What changed in the 2026-07-22 documentation freshness review

A read-only subagent review and local cross-check found the state document was mostly accurate but stale about the latest commit. This section records the correction intent:

- `3abc242` is the file hygiene commit after the real pipeline repair commit.
- `a9c5c26` remains the latest verified real local-video pipeline repair commit.
- Future sessions should use `git log -1 --oneline` for current HEAD because a document cannot reliably embed the hash of the same commit that changes it.
- Test/build pass counts in this document are historical verification results from the repair session; the repository does not currently commit full stdout logs for those commands.

## What changed in the 2026-07-22 file-management cleanup

File-management cleanup changes:

- Updated `.gitignore` so local agent scratch space, audit leftovers, logs, failed E2E runs, diagnostic evidence, and SQLite runtime sidecars no longer confuse `git status`.
- Added this `docs/PROJECT_STATE.md` file as the required source of truth for future sessions.
- Updated `AGENTS.md` to require new sessions to read and maintain this file.
- Did not delete, move, or rewrite large local caches or historical failed evidence directories.
- Did not configure a git remote or push; push remains blocked by missing `origin`.

Verification for this docs-only cleanup:

```powershell
git diff --check
git status --short --ignored
```

Observed result: `git diff --check` reported no whitespace errors; noisy failed evidence and local scratch directories are now shown as ignored (`!!`) instead of untracked (`??`).


## What changed in the 2026-07-23 merge session

The repair branch was merged back into the main checkout:

- Source branch/worktree: `codex/rain-real-local-video` at `D:\gongju\shengcan\rain\.worktrees\codex\rain-real-local-video`.
- Target checkout: `master` at `D:\gongju\shengcan\rain`.
- Merge command used: `git merge --ff-only codex/rain-real-local-video`.
- Result: fast-forward from `b86c011` to `7a9eeb1`, then this document was updated on `master` to record the merge.
- No remote is configured, so the merged `master` state is still local-only until a remote is added.

Reason for merge: the old `master` pipeline still passed `modelPath: null`, swallowed ASR/LLM failures, and generated demo/default data. The merged branch contains the fail-closed ASR/Stage2 pipeline and real local-video evidence.

Post-merge verification in `D:\gongju\shengcan\rain`:

```powershell
Select-String -Path src\pipeline\pipeline-orchestrator.ts -Pattern 'modelPath: null|generateDemoSentences|buildDefaultStructure|LLM not available|Whisper not available'
powershell.exe -ExecutionPolicy Bypass -File scripts\validate-evidence.ps1 -EvidenceManifest evidence\rain-real-e2e-20260720-024848\manifest.json -ExpectedWhisperBackend cuda
npm.cmd test -- src/__tests__/pipeline-asr.test.ts
```

Observed result: the old fallback patterns were absent; evidence validator returned `ok: true` with backend `cuda`; `pipeline-asr.test.ts` passed 37 tests.

## What changed in the 2026-07-23 historical-plan marking session

Marked all files under `docs/superpowers/plans/` as historical plans/construction docs so future sessions do not mistake old implementation checklists for current project status:

- `docs/superpowers/plans/2025-07-14-mvp-bug-fixes.md`
- `docs/superpowers/plans/remaining-landing-plan.md`
- `docs/superpowers/plans/2026-07-09-model-management-and-import.md`
- `docs/superpowers/plans/2026-07-11-harness-coverage-gaps.md`
- `docs/superpowers/plans/2026-07-11-phase2-implementation.md`
- `docs/superpowers/plans/2026-07-18-rain-real-local-video-repair.md`

No source code was changed. These docs remain useful as history, but current status must be verified from this file, current code, validation scripts, and committed evidence.

## What changed in the 2026-07-23 preflight-readiness session

Added a user-facing "运行前自检" panel to Settings so a non-code user can check whether Rain is ready to process a real local video before starting a long run.

Implementation notes:

- Added `src/settings/preflight.ts` as the single frontend module for readiness checks.
- Added `PreflightPanel` to `src/ui/components/settings.tsx` and mounted it in the "模型管理" settings page.
- Added the read-only Tauri command `get_runtime_capability` so the frontend can report whether the compiled Whisper backend is `cuda` or `cpu`.
- Added tests in `src/__tests__/preflight.test.ts` and `src/__tests__/settings-preflight.test.tsx`.
- Product decisions confirmed by the user:
  - missing `yt-dlp` is a warning, not a blocker, because local-video import can still work;
  - clicking "运行自检" may send one small real Qwen/DashScope health request when a Qwen key is configured.
  - missing or misconfigured AI assistant model is a warning, not a blocker, because local-video import/ASR/structuring can still finish.

Checks covered by the panel:

- Tauri desktop runtime and compiled Whisper backend;
- selected ASR/structuring roles;
- selected assistant role is checked separately as non-blocking learning-feature readiness;
- installed local Whisper model file;
- exact DashScope Qwen runtime (`qwen3.5-omni-flash` at `https://dashscope.aliyuncs.com/compatible-mode/v1`);
- SQLite settings write/delete;
- `yt-dlp` availability for optional online-video import.

Verification:

```powershell
npm.cmd test -- src/__tests__/preflight.test.ts src/__tests__/settings-preflight.test.tsx
npx.cmd tsc --noEmit
cargo.exe check --manifest-path src-tauri\Cargo.toml
npm.cmd test
npm.cmd run build
cargo.exe test --manifest-path src-tauri\Cargo.toml --no-default-features
cargo.exe test --manifest-path src-tauri\Cargo.toml --no-default-features --features cuda-whisper runtime::tests::capability_reports_compiled_backend_without_claiming_runtime_fallback
```

Observed result: targeted preflight tests passed; `npm test` passed 51 files / 423 tests with 1 live Qwen test skipped; frontend build passed with the existing Vite dynamic/static import chunking warnings; Rust tests passed with the existing locked-harness unused warnings. The CUDA runtime test passes when run with the same local CUDA/Ninja/MSVC environment setup used by `scripts/run-real-e2e.ps1`.

## What changed in the 2026-07-24 real E2E validation session

Ran the current local-video workflow again against the user-specified lecture video using CUDA Whisper and DashScope-compatible Qwen.

Local evidence directory:

`evidence/rain-real-e2e-20260724-212453/`

Observed evidence facts:

- Video SHA256 matched the expected real lecture input: `3870B5BD62E574685AC99A8E44295F5E44AC44B76343666742C1C4CA48365F8A`.
- Whisper backend was `cuda`; runtime log contains `use gpu = 1`, `NVIDIA GeForce RTX 5060 Ti`, and `using CUDA0 backend`.
- Qwen runtime was `qwen3.5-omni-flash` at `https://dashscope.aliyuncs.com/compatible-mode/v1`.
- Database finished with status/stage `ready` / `ready`.
- ASR produced 1953 real transcript sentences.
- Stage2 produced 12 Qwen blocks and 176 persisted structure nodes.
- Cancellation proof passed, then retry/restart proof passed through final `import_complete`.
- Screenshot artifact was generated at `screenshots/study-ready.png` with PNG dimensions 1280x800.
- `scripts\validate-evidence.ps1 -ExpectedWhisperBackend cuda` returned `ok: true`.

Important caveat from this run:

- `transcript.json`, `qwen-blocks.json`, `database-summary.json`, `cancellation-proof.json`, `restart-proof.json`, and `app-events.json` are strict JSON-readable.
- `manifest.json` from this run was also checked with Python strict JSON parsing and contains the readable Chinese video path and manual review samples. A prior PowerShell-to-Python pipeline parse failure was a shell/pipe false positive, not file corruption.
- The generated evidence directory was local runtime output and was not committed in this session.

## What changed in the 2026-07-24 evidence-validator hardening session

After the successful real E2E run, tightened the evidence validator around mojibake handling:

- Added regression coverage that accepts strict JSON evidence with a normal Chinese Windows-style video path segment.
- Added regression coverage that rejects a mojibake video path even when the referenced file exists and has the expected hash.
- Updated `scripts\validate-evidence.ps1` so `manifest.video.path` is checked with the same mojibake guard already used for transcript/manual review text.

Verification:

```powershell
npm.cmd test -- scripts/validate-evidence.test.ts
powershell.exe -ExecutionPolicy Bypass -File scripts\validate-evidence.ps1 -EvidenceManifest evidence\rain-real-e2e-20260720-024848\manifest.json -ExpectedWhisperBackend cuda
powershell.exe -ExecutionPolicy Bypass -File scripts\validate-evidence.ps1 -EvidenceManifest evidence\rain-real-e2e-20260724-212453\manifest.json -ExpectedWhisperBackend cuda
```

Observed result: the targeted Vitest file passed 11 tests; both real evidence manifests passed with `ok: true`, backend `cuda`, Qwen model `qwen3.5-omni-flash`, 1953 sentences, and 12 Qwen blocks.

## What changed in the 2026-07-24 assistant quick-actions session

Implemented the first AI-assistant usability slice after the real local-video pipeline was proven usable:

- Mounted current paragraph type quick actions in the StudyInterface right-side AI panel.
- Clicking a quick action now sends that action label as the user message through the same real Qwen assistant path as typed chat.
- Added a `paragraph` assistant-context scope so quick actions send the full current paragraph transcript instead of only the nearby sentence window. This reduces answer bias for actions such as "生成例子" or "变详细".
- Kept free-form chat on the existing nearby/current-context behavior plus deterministic cross-chapter retrieval for comparison/navigation questions.
- Deliberately did not implement the universal "解释画面" vision action in this slice; it requires a separate decision/implementation for capturing and sending the current video frame.

Verification performed during this session:

```powershell
npm.cmd test -- src/__tests__/study-playback.test.tsx src/__tests__/assistant-context.test.ts
npx.cmd tsc --noEmit
npm.cmd test -- harness/m10-ai-assistant.test.ts harness/m10-ai-component.test.tsx src/__tests__/study-playback.test.tsx src/__tests__/assistant-context.test.ts
npm.cmd test
npm.cmd run build
```

Observed result: targeted study/assistant tests passed 17 tests; TypeScript check passed; related M10 harness + implementation tests passed 33 tests; full frontend test suite passed 51 files / 426 tests with 1 live Qwen test skipped; frontend build passed with the existing Vite dynamic/static import chunking warnings.

## What changed in the 2026-07-26 approved Harness Migration

The user explicitly approved modifying the previously locked Harness after an audit showed that several green tests were validating shadow constants, direct object assignments, function existence, or tautologies rather than current product behavior.

Migration results:

- M03/M21 now call the real `VideoImportController`, memory database, Pipeline boundary and desktop command adapter for AC-LV-02/03/06/07/10.
- M04/M18 now call the current `stage2-contract.ts` and `stage2-runner.ts` for exact sentence coverage, schema validation, deterministic blocking, retries and local deterministic merge.
- M20 now parses the real Rust `generate_handler!` command registry and scans real LLM/SQL source boundaries.
- Component, Store, Notes and progress Harness tests now assert callbacks, persisted state, event forwarding, media properties and cleanup side effects.
- Rust Harness tests now exercise scheduler serialization, per-video cancellation, payload serialization, invalid inputs, actionable errors and the tracked media fixture.
- Text assistant model selection no longer incorrectly requires Vision capability, and the unimplemented universal "解释画面" action is no longer advertised as completed.
- Removed the Harness-only shadow modules listed in `docs/development/harness-migration-2026-07-26.md`.
- Harness policy is now default-locked but maintainable through an explicitly approved, documented Harness Migration.
- Added `@types/node` for the source-scanning architecture Harness. `npm update postcss` moved the transitive PostCSS dependency to 8.5.23 and cleared the discovered security advisory.

Second audit pass in the same approved migration:

- Fixed `TextZone` reading video language from a test-only Context. `loadVideo` now stores the database language in `currentVideoLanguage`, and tests inject state only through `harness/support/test-store-provider.tsx`.
- Removed M02 tree editing, factory, validator and text helpers that had no production caller. The M02 Harness now keeps only persisted enum contracts; Stage2 and database behavior remain covered by their real modules.
- Removed visible paragraph editing controls whose handlers were empty. Advanced editing remains Proposed rather than falsely advertised.
- Made `src/index.css` the sole visual-token fact source; M13 loads that real file and checks its CSS variables through CSSOM.
- Removed unused subtitle/API/legacy Whisper normalization paths, the empty Rust `start_import` command, custom `convert_file_src`, and the unused Stage2 `callMerge` interface.
- Renamed the remaining language helper to `src/pipeline/language-detection.ts` and M21 Harness to `m21-import-controller.test.ts` so names match actual responsibility.

Verification:

```powershell
npm.cmd test
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
npm.cmd run build
npm.cmd audit --json
git diff --check
```

Observed result:

- Vitest: 47 files passed, 328 tests passed, 1 live Qwen test skipped.
- Rust: 71 tests passed, 1 real Whisper-model test ignored; the lower count reflects retired shadow-only tests.
- Frontend build passed with the existing Vite dynamic/static import chunking warnings.
- npm audit reported 0 vulnerabilities.
- `git diff --check` passed; only normal Windows LF/CRLF notices were printed.

No new real-video E2E was run in this migration. The local-video production pipeline was not changed; current curated evidence remains the latest real-run proof.

## What changed in the 2026-07-26 model capability contract session

Selected the first controlled implementation slice for `AC-LV-12` and DEC-001:

- Added `CONTEXT.md` as the active domain-language source for model configuration, role, capability check and the three exact status terms.
- Added `src/settings/model-capabilities.ts` to own capability records, evidence requirements, record validation, merging and stale-result assessment.
- A normal successful check records `Compatible`; only a successful check with an evidence ID may record `Verified`; failures record `Unavailable`.
- Capability fingerprints change when the role, endpoint, model name, API Key or other material model configuration changes. Persisted stale results are displayed as `Unavailable`.
- Capability records are stored separately under `model_capabilities`, contain no API Key plaintext, survive settings reload, and are loaded into Zustand.
- Preflight results are persisted through the store and prior checks for unrelated model-role pairs are preserved.
- The settings preflight panel displays persisted capability status before another check is run.
- File-existence and simple connection preflight checks deliberately do not create `Compatible`; ASR transcription, Stage2 contract and assistant cancellation need their own real role checks.

This does not complete `AC-LV-12`. The preflight implementation still has a fixed DashScope/Qwen check, and role selection/runtime entry points do not yet uniformly reject `Unavailable` assignments. The coverage matrix therefore remains `Partial`.

Files changed in this `master` session:

- Control plane: `AGENTS.md`, `CONTEXT.md`, `docs/development/control-map.md`, `docs/development/harness-coverage.md`, `docs/development/module-map.md`, this file.
- Implementation: `src/settings/model-capabilities.ts`, `src/settings/model-pool.ts`, `src/settings/preflight.ts`, `src/store/rain-store.ts`, `src/ui/components/settings.tsx`.
- Verification: `src/__tests__/model-capabilities.test.ts`, `src/__tests__/model-pool.test.ts`, `src/__tests__/preflight.test.ts`, `src/__tests__/settings-preflight.test.tsx`.

Verification:

```powershell
npm.cmd test -- --run src/__tests__/model-capabilities.test.ts src/__tests__/model-pool.test.ts src/__tests__/preflight.test.ts src/__tests__/settings-preflight.test.tsx
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
```

Observed result: targeted capability tests passed 4 files / 22 tests; TypeScript passed; full frontend suite passed 48 files / 336 tests with 1 live Qwen test skipped; production build passed with the existing Vite dynamic/static import chunking warnings. Rust and real-video E2E were not rerun because this slice changed only frontend settings and control documents.

## What changed in the 2026-07-26 role assignment gate session

The prior model capability slice was committed on `master` as `a38ded7 feat: track model role capabilities`. The next `AC-LV-12` slice contains:

- Added `decideModelRoleAssignment` as the single domain decision for whether a current model configuration may receive a role.
- Only current `Compatible` or `Verified` records allow a new assignment; missing, failed or stale records return `Unavailable`.
- Zustand now enforces this decision before changing `roleAssignment`, so callers cannot bypass the rule by skipping the UI.
- Role selectors disable unavailable options and display the current assignment status and reason.
- Existing saved/default assignments are deliberately preserved during migration. Automatically clearing them now would break Rain before executable full role checks exist.
- Pipeline startup is not gated yet for the same reason. It becomes eligible for enforcement only after the corresponding real role checks can produce `Compatible`.

Files in this slice:

- `src/settings/model-capabilities.ts`
- `src/settings/model-pool.ts`
- `src/store/rain-store.ts`
- `src/ui/components/settings.tsx`
- `src/__tests__/model-capabilities.test.ts`
- `src/__tests__/settings-role-assignment.test.tsx`
- `docs/development/harness-coverage.md`
- `docs/development/module-map.md`
- `docs/PROJECT_STATE.md`

Verification:

```powershell
npm.cmd test -- --run src/__tests__/model-capabilities.test.ts src/__tests__/settings-role-assignment.test.tsx harness/m19-settings-component.test.tsx harness/m19-settings.test.ts harness/store-zustand.test.tsx
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: 5 related files / 37 tests passed with no React test warnings; TypeScript passed; the full frontend suite passed 49 files / 341 tests with 1 live Qwen test skipped; production build passed with the existing Vite dynamic/static import chunking warnings; `git diff --check` passed with only normal Windows LF/CRLF notices. Rust and real-video E2E were not rerun because this slice changes only frontend model settings and control documents.

## What changed in the 2026-07-26 structuring capability probe session

Continued the `AC-LV-12` work after the role assignment gate:

- Added `src/settings/structuring-capability.ts`, which sends two deterministic probe sentences through the real OpenAI-compatible Stage2 caller.
- The probe reuses the production `STAGE2_BLOCK_SYSTEM_PROMPT`, `buildStage2Blocks`, `normalizeStage2BlockOutputCandidate` and `validateStage2BlockOutput` instead of maintaining a test-only schema.
- A model receives `Compatible` for the structuring role only when the returned tree satisfies the Stage2 schema and covers both immutable sentence IDs exactly.
- Errors become `Unavailable` records and are redacted before persistence; API Key plaintext is not placed in capability records.
- Every saved LLM now has a model-pool “检查结构化” action. A passing check is persisted through Zustand and immediately unlocks that model in the structuring role selector.
- The probe is provider-neutral at the contract layer and accepts any saved OpenAI-compatible endpoint/model configuration. The separate legacy Qwen connection button remains for now.

New or additionally changed files:

- `src/settings/structuring-capability.ts`
- `src/pipeline/stage2-runner.ts`
- `src/ui/components/settings.tsx`
- `src/__tests__/structuring-capability.test.ts`
- `src/__tests__/settings-connection.test.tsx`
- `src/__tests__/settings-structuring-workflow.test.tsx`
- `docs/development/harness-coverage.md`
- `docs/development/module-map.md`
- `docs/PROJECT_STATE.md`

Verification so far:

```powershell
npm.cmd test -- --run src/__tests__/structuring-capability.test.ts src/__tests__/settings-connection.test.tsx src/__tests__/settings-role-assignment.test.tsx src/__tests__/settings-structuring-workflow.test.tsx src/__tests__/stage2-runner.test.ts harness/m19-settings-component.test.tsx
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: 6 related files / 43 tests passed; TypeScript passed; the full frontend suite passed 51 files / 346 tests with 1 live Qwen test skipped; production build passed with the existing Vite dynamic/static import chunking warnings; `git diff --check` passed with only normal Windows LF/CRLF notices. Tests inject the model caller and prove the production contract path, failure handling and settings workflow. No live external model was called in this session, so no concrete model configuration was promoted based on new real evidence. Rust and real-video E2E were not rerun because this slice changes frontend settings and shares an existing Stage2 prompt constant without changing Rust or the full import orchestration.

## What changed in the 2026-07-26 settings UI decomposition session

After committing the capability slice as `dadb416 feat: gate structuring models by capability`, the settings hotspot was split without changing product behavior:

- Kept `src/ui/components/settings.tsx` as the stable public barrel used by `App.tsx`, M19 and implementation-owned tests.
- Moved page composition, preflight, model-pool actions, add-model form, role selection and shared presentation resources into separate files under `src/ui/components/settings/`.
- Kept capability decisions and the structuring probe in `src/settings/`; the extracted UI components continue to call those existing owners.
- Did not modify locked frontend or Rust Harness files.
- Did not change any AC status. `AC-LV-12` remains Partial and resumes only after this code-health slice.

Verification:

```powershell
npm.cmd test -- --run harness/m19-settings-component.test.tsx src/__tests__/settings-connection.test.tsx src/__tests__/settings-preflight.test.tsx src/__tests__/settings-role-assignment.test.tsx src/__tests__/settings-structuring-workflow.test.tsx
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: targeted settings tests passed 5 files / 16 tests; TypeScript passed; the full frontend suite passed 51 files / 346 tests with 1 live Qwen test skipped; production build passed with the existing Vite dynamic/static import chunking warnings. Rust and real-video E2E were not rerun because this was a frontend-only behavior-preserving refactor.

## What changed in the 2026-07-26 provider-neutral structuring preflight session

Continued `AC-LV-12` after the settings UI decomposition commit:

- Replaced the fixed DashScope/Qwen health request inside `runPreflightCheck` with the existing production-contract `checkStructuringModelCapability` probe.
- The selected structuring model may now use any saved OpenAI-compatible endpoint/model combination; the preflight signs `Compatible` only after the production Stage2 schema and exact sentence coverage pass.
- Removed the conflicting fixed-Qwen guard from the production `runStage2Stage` entry. Production now accepts the same OpenAI-compatible configuration shape as the capability probe and rejects blank endpoint, API Key or model name before a request.
- A failed probe makes the preflight not ready and returns the probe's redacted reason.
- A successful ordinary probe preserves an existing current `Verified` record instead of downgrading its E2E evidence.
- Assistant configuration is still a non-blocking warning/health item and cannot inherit structuring capability. A separate assistant role probe remains required.
- Locked Harness and Rust files were not modified.

Files changed:

- `src/settings/preflight.ts`
- `src/pipeline/stage2-runner.ts`
- `src/ui/components/settings/preflight-panel.tsx`
- `src/__tests__/preflight.test.ts`
- `src/__tests__/stage2-runner.test.ts`
- `src/__tests__/pipeline-asr.test.ts` (updated the supplier-neutral Stage2 failure wording only)
- `docs/development/harness-coverage.md`
- `docs/development/module-map.md`
- `docs/PROJECT_STATE.md`

Verification:

```powershell
npm.cmd test -- --run src/__tests__/preflight.test.ts src/__tests__/structuring-capability.test.ts src/__tests__/settings-preflight.test.tsx src/__tests__/settings-structuring-workflow.test.tsx
npm.cmd test -- --run src/__tests__/stage2-runner.test.ts src/__tests__/preflight.test.ts src/__tests__/structuring-capability.test.ts harness/m04-ai-pipeline.test.ts harness/m18-long-video.test.ts
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: targeted capability/preflight tests passed 4 files / 11 tests; the production-path alignment set passed 5 files / 49 tests, including locked M04/M18 without modifying them. TypeScript passed; the final frontend suite passed 51 files / 351 tests with 1 live Qwen test skipped; production build passed with the existing Vite dynamic/static import chunking warnings. No live external model, Rust test or real-video E2E was run in this slice.

## What changed in the 2026-07-26 ASR capability probe session

Continued `AC-LV-12` with the required local-video ASR role:

- Extracted `transcribeWithWhisper` from `runAsrStage`; production imports and capability checks now share model resolution, `start_asr`, cancellation and transcript validation.
- Added `checkAsrModelCapability(model)`. It resolves a bundled short English speech video, invokes the selected local Whisper model and signs `Compatible` only after receiving non-empty sentences with valid IDs, text and timestamps.
- Added `test-fixtures/asr-capability.mp4` as an intentionally tracked 48 KB probe resource and mapped it to `asr-capability/sample.mp4` in the Tauri bundle.
- Added “检查 ASR” to saved local Whisper rows. A successful check is persisted through the existing store interface and unlocks that model in the ASR role selector.
- Running preflight now executes the same ASR probe after the model-file check. Probe failure blocks local-video readiness; a normal success preserves existing current `Verified` evidence.
- Unsupported `asr-api` configurations remain `Unavailable`; this slice does not pretend the production local-video Pipeline supports them.
- Locked Harness and Rust source/tests were not modified.

Files added or changed:

- `src/settings/asr-capability.ts`
- `src/pipeline/asr-runner.ts`
- `src/settings/preflight.ts`
- `src/ui/components/settings/model-pool-list.tsx`
- `src/ui/components/settings/settings-page.tsx`
- `src/ui/components/settings/preflight-panel.tsx`
- `src/__tests__/asr-capability.test.ts`
- `src/__tests__/settings-asr-workflow.test.tsx`
- `src/__tests__/preflight.test.ts`
- `test-fixtures/asr-capability.mp4`
- `src-tauri/tauri.conf.json`

Verification so far:

```powershell
npm.cmd test -- --run src/__tests__/asr-capability.test.ts src/__tests__/preflight.test.ts src/__tests__/settings-asr-workflow.test.tsx src/__tests__/settings-role-assignment.test.tsx src/__tests__/pipeline-asr.test.ts harness/m19-settings-component.test.tsx
npx.cmd tsc --noEmit
npx.cmd tauri build --debug --no-bundle
npx.cmd tauri build --debug --bundles nsis
git diff --check
```

Observed result: 6 related files / 57 tests passed; TypeScript passed; Tauri debug compilation and debug NSIS packaging passed, producing `Rain_0.1.0_x64-setup.exe` with the configured probe resource; the full frontend suite passed 53 files / 357 tests with 1 live Qwen test skipped; production build passed with the existing Vite dynamic/static import chunking warnings. A live Whisper probe against the locally installed 3 GB model and a full real-video E2E were not run in this slice, so the new probe path is `Compatible`-eligible but not promoted to `Verified` by this session.

## What changed in the 2026-07-26 runtime capability gate session

Continued `AC-LV-12` after the ASR capability probe:

- `VideoImportController` now reuses `decideModelRoleAssignment` immediately before Pipeline startup for the selected ASR and structuring models.
- Missing, failed or stale capability records block the run before progress or `runPipeline`; the pending video becomes `failed` with a role/model-specific reason.
- `VideoListPage` passes cloned model, role and capability records as one startup snapshot. Later Store changes do not alter the active run's model configuration.
- A page-level test proves that omitting required capability evidence from the Store blocks the real UI entry instead of silently using the legacy path.
- The `capabilities` field remains optional only to preserve the locked pre-capability M03/M21 Harness contract. The production page always supplies it, including an empty array; this exception is documented and covered rather than hidden behind a runtime switch.
- Locked Harness and Rust source/tests were not modified.

Files added or changed:

- `src/pipeline/video-import-controller.ts`
- `src/pages/VideoListPage.tsx`
- `src/__tests__/video-import-capability-gate.test.ts`
- `src/__tests__/video-list-local-import.test.tsx`
- `src/__tests__/video-list-page-recovery.test.tsx`
- `docs/development/acceptance-standard.md`
- `docs/development/harness-coverage.md`
- `docs/development/module-map.md`
- `docs/PROJECT_STATE.md`

Verification:

```powershell
npm.cmd test -- --run src/__tests__/video-import-capability-gate.test.ts src/__tests__/video-list-local-import.test.tsx src/__tests__/video-list-page-recovery.test.tsx harness/m03-video-import.test.ts harness/m21-import-controller.test.ts
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: the focused runtime-entry set passed 5 files / 19 tests, including unchanged locked M03/M21; TypeScript passed; the full frontend suite passed 54 files / 362 tests with 1 live Qwen test skipped; production build passed with the existing Vite dynamic/static import chunking warnings. Rust and real-video E2E were not rerun because this slice changes only the frontend startup gate and its control documents.

## What changed in the 2026-07-26 text assistant capability session

Continued `AC-LV-12` after commit `94154bc feat: gate local imports by model capability`:

- Added `checkAssistantModelCapability`, which uses the production `streamAiChat` adapter and signs `Compatible` only after an exact streamed contract response. Timeout, malformed output and stream errors become redacted `Unavailable` records.
- The assistant capability message explicitly excludes vision. The unimplemented current-frame feature remains outside accepted scope.
- Settings now provides a separate “检查助手” action; preflight executes the same probe but treats assistant failure as a warning so local-video processing remains available.
- `StudyInterface` no longer hardcodes DashScope/Qwen. It uses the selected OpenAI-compatible model snapshot and rejects missing, failed or stale assistant capability before starting a stream.
- Existing stop, late-token suppression, paragraph context and citation behavior remain on the same production chat path.
- Locked Harness and Rust source/tests were not modified.

Files added or changed:

- `CONTEXT.md`
- `src/settings/assistant-capability.ts`
- `src/settings/preflight.ts`
- `src/pages/StudyInterface.tsx`
- `src/ui/components/settings/model-pool-list.tsx`
- `src/ui/components/settings/settings-page.tsx`
- `src/ui/components/settings/preflight-panel.tsx`
- `src/__tests__/assistant-capability.test.ts`
- `src/__tests__/settings-assistant-workflow.test.tsx`
- `src/__tests__/preflight.test.ts`
- `src/__tests__/study-playback.test.tsx`
- `docs/development/acceptance-standard.md`
- `docs/development/harness-coverage.md`
- `docs/development/module-map.md`
- `docs/PROJECT_STATE.md`

Verification:

```powershell
npx.cmd tsc --noEmit
npm.cmd test -- --run src/__tests__/assistant-capability.test.ts src/__tests__/settings-assistant-workflow.test.tsx src/__tests__/study-playback.test.tsx src/__tests__/preflight.test.ts harness/m10-ai-assistant.test.ts harness/m10-ai-component.test.tsx harness/m19-settings-component.test.tsx
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: TypeScript passed; the focused assistant set passed 7 files / 43 tests, including unchanged locked M10/M19; the full frontend suite passed 56 files / 369 tests with 1 live Qwen test skipped; production build passed with the existing Vite dynamic/static import chunking warnings. No live external model, Rust test or real-video E2E was run for this frontend-only slice.

## Current controllability audit on 2026-07-26

The project is more controllable than at the start of the Harness review, but it is not uniformly clean:

- The local-video path `AC-LV-01` through `AC-LV-11` has named owners, mostly Strong behavioral judges, and real evidence where unit tests are insufficient.
- Shadow registries, tautological tests, test-only production helpers and obsolete commands were removed in the approved Harness Migration.
- `AC-LV-12` now has `Strong + Evidence` for one exact configuration fingerprint; multi-model support is not generalized beyond independently checked and evidenced configurations.
- URL import, universal vision explanation and advanced tree editing remain explicit Gap/Proposed work instead of being represented by placeholder success paths.
- The role gate, three production-path probes and both local-video/assistant runtime gates now form a coherent capability path. The first schema v2 full E2E closes that loop for `ggml-large-v3.bin` CUDA + DashScope `qwen3-omni-flash` structuring/text assistant; another model must repeat the same loop.

The immediate `settings.tsx` hotspot has been resolved by behavior-preserving extraction. The public file is now a 10-line barrel; page composition, preflight, model-pool actions, add-model form, role selection and shared presentation resources have separate owners under `src/ui/components/settings/`. New settings behavior should enter the matching component, while capability decisions and probes remain in `src/settings/`.

`src/models/database.ts` remains approximately 1034 lines and `src-tauri/src/commands.rs` approximately 796 lines. Their size alone is not permission to rewrite them: both require interface-level tests and responsibility-based extraction, one controlled slice at a time.

## What changed in the 2026-07-26 Evidence Harness migration

The `AC-LV-12` implementation path is now connected to a provider-neutral evidence contract:

- Added evidence schema v2. It requires an `evidenceId`, generic `llmModel`/`llmBaseUrl`, three real role checks, matching `Verified` records, and explicit runtime-gate artifacts.
- The real E2E Runner now executes ASR, structuring, and text-assistant capability probes; proves missing capabilities are rejected; and runs cancellation/retry through `VideoImportController` instead of calling `runPipeline` directly.
- New v2 structuring fields no longer use Qwen-specific names. Historical schema v1 manifests retain their original names and exact DashScope/Qwen validation.
- Rust E2E configuration accepts a generic HTTP(S) OpenAI-compatible endpoint/model and carries the evidence ID. Legacy Qwen environment names remain read-only aliases during migration.
- No locked files under `harness/` or `src-tauri/tests/` were modified.

Verification:

```powershell
npm.cmd test -- --run scripts/validate-evidence.test.ts
npx.cmd tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml e2e_config --lib
npm.cmd test
npm.cmd run build
cargo test --manifest-path src-tauri/Cargo.toml
powershell.exe -ExecutionPolicy Bypass -File scripts/validate-evidence.ps1 -EvidenceManifest evidence/rain-real-e2e-20260720-024848/manifest.json -ExpectedWhisperBackend cuda
```

Observed result: evidence contract tests passed 15/15; TypeScript and production build passed; the full frontend suite passed 56 files / 373 tests with 1 live-key test skipped; Rust passed 50 library tests plus all executable Harness groups, with the existing real Whisper transcription test ignored; the canonical historical CUDA evidence still passes as schema v1. A new paid, multi-hour real E2E was deliberately not started without explicit confirmation, so `AC-LV-12` remains Partial and no new configuration is yet `Verified`.

## What changed in the 2026-07-26 schema v2 real E2E session

The user explicitly authorized a real run with DashScope `qwen3-omni-flash`. The API Key was supplied only through the child-process environment for the full run, removed afterward, and was not written to source, documentation, manifest, events, logs or curated artifacts.

The full production path completed against the real lecture video and isolated SQLite database:

- ASR: local `ggml-large-v3.bin`, CUDA runtime confirmed by both `use gpu = 1` and `using CUDA0 backend`;
- structuring: DashScope `qwen3-omni-flash`, 12 model output blocks with exact coverage of 1953 persisted sentences;
- text assistant: exact streamed capability token passed; vision was not tested or granted;
- gates: missing ASR/structuring evidence was rejected through `VideoImportController`, and missing assistant evidence was rejected through `decideModelRoleAssignment`;
- recovery: cancellation and retry completed through the production import controller;
- persistence: the matching video reached `ready`, with 1953 sentences and 34 nodes;
- timing: ASR 1408 seconds, structuring 1050 seconds, total pipeline 2459 seconds.

The first screenshot attempt exposed a Harness false positive: the validator accepted a valid PNG even though the app was still showing stale list/cancel state. That evidence was not accepted. The fix:

- routes the production database singleton to the isolated E2E database;
- requires the Runner to call the production Store `loadVideo`;
- waits for the real `StudyInterface`, video player and persisted paragraph content;
- records WebDriver DOM state in `ui-state.json`;
- makes schema v2 validation fail unless the DOM video ID matches the database and `study_ui_ready` follows import and assistant completion;
- supports a no-paid-LLM `ui-proof` replay that reuses the completed database and reruns only the short real ASR/CUDA probe.

The final screenshot and DOM proof show the production study page, visible player and 21 rendered paragraphs. During UI replay, the original `app-events.json` was accidentally emptied. The ordered event names were recoverable from the already-written `restart-proof.json`; they were restored without invented timestamps and are marked `recoveredFrom`. Replay events retain their real timestamps. The manifest discloses both evidence phases and the recovery source.

Canonical evidence:

`evidence/rain-real-e2e-20260726-195652/manifest.json`

Independent validation:

```powershell
powershell.exe -ExecutionPolicy Bypass -File scripts/validate-evidence.ps1 -EvidenceManifest evidence/rain-real-e2e-20260726-195652/manifest.json -ExpectedWhisperBackend cuda
```

Observed result: `ok: true`, schema v2, CUDA, `qwen3-omni-flash`, 1953 sentences and 12 structuring blocks. This promotes only the exact recorded configuration to `Verified`; other OpenAI-compatible models and vision remain outside this evidence.

Final verification for this session:

```powershell
npm.cmd test
npm.cmd run build
cargo test --manifest-path src-tauri/Cargo.toml
powershell.exe -ExecutionPolicy Bypass -File scripts/validate-evidence.ps1 -EvidenceManifest evidence/rain-real-e2e-20260720-024848/manifest.json -ExpectedWhisperBackend cuda
powershell.exe -ExecutionPolicy Bypass -File scripts/validate-evidence.ps1 -EvidenceManifest evidence/rain-real-e2e-20260726-195652/manifest.json -ExpectedWhisperBackend cuda
git diff --check
```

Observed result: frontend passed 57 files / 377 tests with 1 live-key test skipped; production build passed with existing Vite chunking warnings; Rust passed 51 library tests and every executable Harness group, with the existing real Whisper transcription test ignored; both historical schema v1 and current schema v2 CUDA evidence passed. The evidence validator's secret scan reported no secret-like value.

## What changed in the 2026-07-26 learning-page control baseline

Started the second controlled workflow after the local-video pipeline:

- Added `AC-ST-01` through `AC-ST-08` for atomic study loading, real seek, playback focus, directory navigation, progress persistence, notes, text assistant behavior and layout stability.
- Audited the existing M05-M10 Harness by behavior rather than test-file presence. Most catalog/text/note checks are useful local judges but remain Partial for cross-Store, media and SQLite workflows.
- Kept advanced tree editing and vision outside the accepted scope.
- Identified the first concrete false green: `loadVideo` caught every database/content failure and still changed `currentPage` to `study`, so a damaged `ready` record produced an empty learning page.
- Changed `loadVideo` to return `LoadVideoResult`, reject missing/non-ready videos and ready records without paragraphs or sentences, and update the study cache only after all reads pass.
- Updated `VideoListPage` to remain on the list and show the returned error. The real E2E Runner now also fails immediately when production loading is rejected.
- Added `src/__tests__/study-load.test.tsx`, which uses the real in-memory database and production video-list/Store path to cover missing, non-ready and incomplete-ready records.

`AC-ST-01` is now `Strong + Evidence`. The next controlled slice is `AC-ST-02`: prove that a sentence or trusted citation action traverses `StudyInterface`, Store and the actual media element while preserving playback state.

Verification:

```powershell
npm.cmd test -- --run src/__tests__/study-load.test.tsx harness/store-zustand-phase2.test.tsx
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
powershell.exe -ExecutionPolicy Bypass -File scripts/validate-evidence.ps1 -EvidenceManifest evidence/rain-real-e2e-20260726-195652/manifest.json -ExpectedWhisperBackend cuda
git diff --check
```

Observed result: focused loading tests passed 2 files / 6 tests; TypeScript passed; the full frontend suite passed 58 files / 380 tests with 1 live-key test skipped; production build passed with the existing Vite chunking warnings; canonical schema v2 CUDA evidence still passed; `git diff --check` reported no whitespace errors.

## What changed in the 2026-07-26 AC-ST-02 navigation proof

Continued the learning-page controls in acceptance order:

- Added `src/__tests__/study-navigation.test.tsx` at the production `StudyInterface` seam.
- Proved that double-clicking a transcript sentence updates both Store `playPosition` and the rendered `<video>.currentTime`.
- Proved that a model-produced citation only becomes a seek control after matching a current assistant source ID and exact timestamps, then traverses the same Store/media path.
- Covered both playing and paused states and asserted that seek does not call `play()` or `pause()`.
- Kept the existing production implementation unchanged because the full behavior already passed. The missing item was a cross-module judge, not a product defect.
- Did not create a speculative navigation module. The current one-time seek interface remains small; `AC-ST-04` will decide whether node resolution and multi-region positioning create enough complexity to justify extraction.

`AC-ST-02` is now `Strong`. The next controlled slice is `AC-ST-03`: drive video `timeupdate` through the shared `playPosition` and prove that sentence highlight and directory current state remain synchronized.

Verification:

```powershell
npm.cmd test -- --run src/__tests__/study-navigation.test.tsx src/__tests__/study-playback.test.tsx harness/m06-video-component.test.tsx harness/m07-text-component.test.tsx
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: focused navigation tests passed 4 files / 24 tests; TypeScript passed; the full frontend suite passed 59 files / 382 tests with 1 live-key test skipped; production build passed with the existing Vite chunking warnings.

## What changed in the 2026-07-26 AC-ST-03 playback synchronization slice

Continued the learning-page controls in acceptance order:

- Extended `study-navigation.test.tsx` from a real video `timeupdate` through Store `playPosition`, sentence highlight and directory progress state.
- Tested the exact 10-second boundary between adjacent sentences/paragraphs. Both text and directory use the same half-open `[start, end)` rule, so the previous item becomes complete and the next becomes current without overlap.
- The red test showed that time/highlight/catalog synchronization already worked, but follow-mode text never scrolled because the text zone could not observe playback state.
- Added `isPlaying` as the single Store playback state. `VideoZone` writes it on play, pause, ended and unmount; `VideoControls` reads it instead of maintaining a separate window-event state.
- `ParagraphItem` scrolls only the currently highlighted sentence into view while playback is active. Seeking or time changes while paused update highlighting without taking over the user's scroll position.
- Locked M05-M07 and Store Harness files were not modified.

`AC-ST-03` is now `Strong`. The next controlled slice is `AC-ST-04`: separate single-click selection from full directory double-click navigation, resolve container nodes to their earliest leaf sentence, and position the corresponding text without changing playback state.

Verification:

```powershell
npm.cmd test -- --run src/__tests__/study-navigation.test.tsx src/__tests__/study-playback.test.tsx harness/m05-catalog-component.test.tsx harness/m06-video-component.test.tsx harness/m07-text-component.test.tsx harness/store-zustand.test.tsx harness/store-zustand-phase2.test.tsx
npx.cmd tsc --noEmit
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: focused playback synchronization tests passed 7 files / 48 tests, including unchanged locked M05-M07 and Store Harness; TypeScript passed; the full frontend suite passed 59 files / 383 tests with 1 live-key test skipped; production build passed with the existing Vite chunking warnings.

## What changed in the 2026-07-26 AC-ST-04 directory navigation slice

Continued the learning-page controls in acceptance order:

- Added production `StudyInterface` tests proving that a tree or diagram single click only selects, while double click selects and navigates without changing playback state.
- Added `src/study/navigation.ts` as the owner of container-node resolution. Its single interface resolves any chapter, section or paragraph to the earliest sentence in that subtree instead of trusting a container's stale `startTime`.
- Routed both `SideTree` and `DiagramZone` through the same production navigation path. Their old `onSeek(node.startTime)` behavior remains only as a compatibility adapter for locked component Harness callers.
- Added an explicit text positioning request so paused directory navigation scrolls the resolved paragraph into view; playback-follow scrolling remains governed by `isPlaying`.
- Replaced the map-expand text placeholder with the selected node's real earliest paragraph and sentences.
- Locked files under `harness/` and `src-tauri/tests/` were not modified.

`AC-ST-04` is now `Strong`. The next controlled slice is `AC-ST-05`: persist the furthest playback position, prevent rewinds from reducing it, restore it on reopen and update the most-recent study time.

Focused verification:

```powershell
npm.cmd test -- --run src/__tests__/study-navigation.test.tsx harness/m05-catalog-component.test.tsx harness/m07-text-component.test.tsx harness/m16-layout-component.test.tsx
npx.cmd tsc --noEmit
```

Observed result: focused navigation and locked compatibility coverage passed 4 files / 24 tests; TypeScript passed. Full-suite and production-build results are recorded in the final verification for this slice before commit.

Final verification:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: the full frontend suite passed 59 files / 385 tests with 1 live-key test skipped; the production build passed with the existing Vite dynamic/static import chunking warnings. No Rust test or real-video E2E was run because this slice changed only frontend navigation behavior and its documentation.

## What changed in the 2026-07-26 AC-ST-05 study progress slice

Continued the learning-page controls in acceptance order:

- Added `src/__tests__/study-progress.test.tsx` at the production `StudyInterface` seam with a real in-memory database.
- Proved that media `timeupdate` persists the furthest reached position while Store `playPosition` remains free to represent a rewind.
- Added `recordPlaybackProgress(videoId, position)` under `src/study/session.ts`; video UI reports media time, the page supplies the current Video ID, and the Study Session module owns persistence.
- Updated successful `loadVideo` sessions to refresh `lastStudiedAt` only after the video, paragraphs and sentences pass completeness checks.
- Proved that unloading and reopening restores the persisted position into both Store and the actual media element.
- Kept locked files under `harness/` and `src-tauri/tests/` unchanged.
- Recorded the stale live-Qwen model-name mismatch as an explicit Harness risk; it does not affect this local progress slice.

`AC-ST-05` is now `Strong`. The next controlled slice is `AC-ST-06`: persist excerpt notes, free notes and edits, reload them from the database, and route note citations through Study Navigation.

Focused verification:

```powershell
npm.cmd test -- --run src/__tests__/study-progress.test.tsx src/__tests__/study-load.test.tsx harness/m06-video-component.test.tsx harness/m15-queries.test.ts harness/store-zustand-phase2.test.tsx
npx.cmd tsc --noEmit
```

Observed result: focused production and locked compatibility coverage passed 5 files / 21 tests; TypeScript passed. Full-suite and production-build results are recorded below before commit.

Final verification:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: the full frontend suite passed 60 files / 387 tests with 1 live-key test skipped; the production build passed with the existing Vite dynamic/static import chunking warnings. No Rust test or real-video E2E was run because this slice reused the existing TypeScript database interface and changed no Rust or evidence contract.

## What changed in the 2026-07-27 AC-ST-06 persisted notes slice

Continued the learning-page controls in acceptance order:

- Added `src/__tests__/study-notes.test.tsx` at the production `StudyInterface` seam with real database round trips and session reloads.
- Added `src/study/notes.ts` as the Notes Workflow owner. Whole-paragraph excerpts collect every sentence ID in order, derive their content from those sentences, persist first and update Store only after success.
- Added persisted free-note creation and explicit content saving. The database now exposes `updateNoteContent`; React textarea state is only a draft until the workflow saves it.
- Connected paragraph excerpt controls to the production text zone and added production note creation/save controls without changing the locked M07/M08 Harness interfaces.
- Extended Study Navigation with exact sentence-ID resolution. Reopened note citations update Store and the actual media time while preserving playback state and positioning the related paragraph.
- Locked files under `harness/` and `src-tauri/tests/` were not modified.

`AC-ST-06` is now `Strong`. All confirmed learning-page criteria `AC-ST-01` through `AC-ST-08` now have Strong coverage, with Evidence additionally required only where external runtime behavior cannot be proven locally. The next control step is a learning-page audit rather than silently inventing `AC-ST-09`.

Focused verification:

```powershell
npm.cmd test -- --run src/__tests__/study-notes.test.tsx src/__tests__/study-navigation.test.tsx harness/m07-text-component.test.tsx harness/m08-notes-component.test.tsx harness/m08-notes.test.ts harness/m15-queries.test.ts
npx.cmd tsc --noEmit
```

Observed result: focused production and locked compatibility coverage passed 6 files / 29 tests; TypeScript passed. Full-suite and production-build results are recorded below before commit.

Final verification:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: the full frontend suite passed 61 files / 390 tests with 1 live-key test skipped; the production build passed with the existing Vite dynamic/static import chunking warnings. No Rust test or real-video E2E was run because this slice changed the TypeScript Notes Workflow, database interface and learning UI without changing Rust or external-runtime evidence contracts.

## What changed in the 2026-07-27 learning-page control audit

Audited `AC-ST-01` through `AC-ST-08` as one connected production workflow instead of trusting the Strong labels in the coverage table:

- `AC-ST-01` through `AC-ST-07` have production-path judges crossing the Store, media, database or assistant seams required by their behavior.
- `AC-ST-08` had a false-green risk: M16 checked a placeholder `LayoutSwitch`, while the production `StudyInterface` conditionally unmounted `VideoZone` in text/map layouts.
- A red production test proved that layout switching removed the real media element and reset `isPlaying`, leaving `VideoControls` without an active media target.
- `StudyInterface` now keeps one `VideoZone` mounted for the learning-page lifetime and controls only its visibility. The same media instance, current video, play position, selection, notes, assistant conversation and playing state survive all three layouts.
- Added `study-layout.test.tsx` as the production judge for `AC-ST-08`; M16 remains useful only for local mode/visibility rules.
- Recorded `StudyInterface.tsx` as a controlled hotspot. It is about 449 lines and coordinates several modules; future assistant-session behavior should first design a small interface and extract the streaming lifecycle rather than rewriting the page without a behavioral target.
- Locked files under `harness/` and `src-tauri/tests/` were not modified.

Focused verification:

```powershell
npm.cmd test -- --run src/__tests__/study-load.test.tsx src/__tests__/study-navigation.test.tsx src/__tests__/study-playback.test.tsx src/__tests__/study-progress.test.tsx src/__tests__/study-notes.test.tsx src/__tests__/study-layout.test.tsx src/__tests__/assistant-context.test.ts harness/m05-catalog-component.test.tsx harness/m06-video-component.test.tsx harness/m07-text-component.test.tsx harness/m08-notes-component.test.tsx harness/m10-ai-component.test.tsx harness/m15-queries.test.ts harness/m16-layout.test.ts harness/m16-layout-component.test.tsx
npx.cmd tsc --noEmit
```

Observed result: 15 learning-page files / 84 tests passed and TypeScript passed.

Final verification:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: the full frontend suite passed 62 files / 391 tests with 1 live-key test skipped; the production build passed with the existing Vite dynamic/static import chunking warnings. Rust and the multi-hour real-video E2E were not rerun because this slice changes only React media lifetime, its production test and control documents.

## What changed in the 2026-07-27 database-control audit

Audited the approximately 1034-line database hotspot before attempting any large refactor:

- Added `docs/development/database-control.md` as the Active map for the stable public seam, responsibility groups, AC ownership, judges and extraction order.
- Confirmed that 24 production import locations use business operations from `@/models/database`; none directly call `Database.exec/query`.
- Recorded that the locked M15 Harness uses only schema metadata plus public CRUD, while M20 deliberately pins the only Tauri SQL plugin import to `database.ts`.
- Identified six different reasons for change inside the old file: schema/adapter selection, content CRUD, settings, import state, checkpoints and atomic import writes.
- Chose schema parity as the first controlled extraction because the old implementation separately maintained memory column lists and SQLite `CREATE TABLE` SQL.
- Added `src/models/database-schema.ts` as the single table/column/constraint fact source. Both memory initialization and Tauri SQL initialization now derive from it; the public `@/models/database` interface is unchanged.
- Reduced `database.ts` from about 1034 to 966 lines without moving unrelated CRUD or transaction behavior.
- Documented that memory behavior tests cannot independently prove the current generated SQL executes inside Tauri. Real SQLite schema initialization therefore remains Partial until a Tauri run or new evidence exercises this exact code.
- Locked files under `harness/` and `src-tauri/tests/` were not modified.

Focused verification:

```powershell
npm.cmd test -- --run harness/m15-schema-crud.test.ts harness/m15-queries.test.ts harness/m15-settings-recovery.test.ts harness/m08-notes.test.ts src/__tests__/database-recovery.test.ts src/__tests__/study-load.test.tsx src/__tests__/study-notes.test.tsx src/__tests__/study-progress.test.tsx src/__tests__/pipeline-asr.test.ts src/__tests__/stage2-runner.test.ts harness/m20-boundaries.test.ts
npx.cmd tsc --noEmit
```

Observed result: 11 database-related files / 119 tests passed and TypeScript passed.

Final verification:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: the full frontend suite passed 62 files / 391 tests with 1 live-key test skipped; the production build passed with the existing Vite dynamic/static import chunking warnings. Rust and the real-video E2E were not rerun because this slice changes TypeScript schema definition and adapter initialization only.

## What changed in the 2026-07-27 database-adapter and checkpoint slice

Continued the database-control sequence after commit `47a82cc refactor: control database schema`:

- Added `src/models/database-adapter.ts` as the internal discriminated adapter seam.
- Reduced the public `Database` interface to metadata operations that both adapters actually implement. `SqlDatabaseAdapter` owns `exec/query`; `MemoryDatabaseAdapter` owns `readTable/replaceTable`.
- Removed the no-op `exec/query` methods from the memory adapter, closing the non-substitutable interface risk recorded by the previous audit.
- Added `src/models/database-checkpoints.ts` and moved Stage2 checkpoint encoding, legacy/v2 decoding, upsert and lookup behind the new seam.
- Kept `getImportCheckpoint` and `saveImportCheckpoint` re-exported from `@/models/database`, so Stage2, E2E and tests did not change their public imports.
- Added `src/__tests__/database-boundary.test.ts`. It proves the memory adapter does not advertise raw SQL and scans production source to prevent direct imports of database internal modules.
- Retained a private compatibility bridge for legacy CRUD still inside `database.ts`; deleting it before those responsibilities move would create a broad rewrite.
- `database.ts` is now about 898 lines. State transitions, recovery decisions and atomic ASR/final merge remain there and are the next controlled part of the same responsibility group.
- Locked files under `harness/` and `src-tauri/tests/` were not modified.

Focused verification:

```powershell
npm.cmd test -- --run src/__tests__/database-boundary.test.ts src/__tests__/stage2-runner.test.ts src/__tests__/pipeline-asr.test.ts src/__tests__/pipeline-recovery.test.ts src/__tests__/database-recovery.test.ts harness/m03-video-import.test.ts harness/m15-settings-recovery.test.ts harness/m15-schema-crud.test.ts harness/m20-boundaries.test.ts
npx.cmd tsc --noEmit
cargo.exe test --manifest-path src-tauri/Cargo.toml --lib persistence
```

Observed result: the focused frontend set passed 9 files / 111 tests and TypeScript passed; Rust persistence passed 7 tests covering stale state, rollback, graph validation and exact sentence assignment.

Final verification:

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

Observed result: the full frontend suite passed 63 files / 393 tests with 1 live-key test skipped; the production build passed with the existing Vite dynamic/static import chunking warnings. The real-video E2E was not rerun because this refactor keeps public calls and Rust commands unchanged.

## What changed in the 2026-07-27 live-model configuration correction

Corrected the stale live-key path against `AC-LV-12` and DEC-001:

- Added `src/settings/default-runtime.ts` as the single source for the current default OpenAI-compatible endpoint and model.
- Changed the default text model from stale `qwen3.5-omni-flash` to the schema v2 evidenced `qwen3-omni-flash` and stopped claiming unverified vision support.
- Made the settings connection check use the selected LLM endpoint/model instead of accepting only one hard-coded DashScope fingerprint.
- Made the live smoke test read `RAIN_LIVE_LLM_API_KEY`, `RAIN_LIVE_LLM_BASE_URL` and `RAIN_LIVE_LLM_MODEL`, while retaining the old Qwen variable names and `test:live:qwen` command only as compatibility aliases.
- Updated the real E2E runner's default model to the current default. Its environment variables remain authoritative for explicit runs.
- Kept the schema v1 evidence validator pinned to its historical `qwen3.5-omni-flash` fingerprint. Historical evidence is immutable proof of what ran, not a runtime default.
- No API Key was written to source, tests, docs or Git. The live smoke remains skipped unless a Key is explicitly supplied through the current process environment.
- Locked files under `harness/` and `src-tauri/tests/` were not modified.

Focused verification:

```powershell
npm.cmd test -- --run src/__tests__/qwen-health.test.ts src/__tests__/model-pool.test.ts src/__tests__/settings-connection.test.tsx src/__tests__/settings-preflight.test.tsx src/__tests__/live-qwen.test.ts
npx.cmd tsc --noEmit
```

Observed result: 4 focused files / 21 tests passed, the single live-key test was skipped because no Key was present, and TypeScript passed. The full frontend suite passed 63 files / 394 tests with the same live-key test skipped; the production build passed with the existing Vite dynamic/static import chunking warnings; the canonical schema v2 CUDA evidence passed with `qwen3-omni-flash`; `git diff --check` reported no whitespace errors.

## What changed in the 2026-07-27 database import-state slice

Continued the database-control sequence after `2658e7e fix: align live model configuration`:

- Added `src/models/database-import-state.ts` as the owner of guarded video import-state transitions and ASR recovery decisions.
- Kept `transitionVideoImportState`, `determineRecoveryAction` and their types re-exported from `@/models/database`; Pipeline, pages and Harness callers did not learn an internal path.
- Implemented both SQLite and memory behavior through the discriminated adapter seam. The moved memory behavior no longer uses the legacy `_getTable/_setTable` compatibility bridge.
- Added `database-import-state.test.ts` to prove the SQLite adapter sends the exact Rust transition command and maps persisted sentence counts to `skip_asr` or `rerun_asr`.
- Extended the internal-module boundary test so production callers outside `src/models/` cannot import the new module directly.
- Reduced `database.ts` from about 898 to 848 lines. Atomic ASR save, sentence assignment and final import merge remain the next, higher-risk persistence slice.
- This is a behavior-preserving refactor under `AC-LV-03`, `AC-LV-06`, `AC-LV-07` and `AC-LV-08`; it does not change their acceptance status.
- Locked files under `harness/` and `src-tauri/tests/` were not modified.

Focused verification:

```powershell
npm.cmd test -- --run src/__tests__/database-import-state.test.ts src/__tests__/database-boundary.test.ts src/__tests__/pipeline-asr.test.ts src/__tests__/pipeline-recovery.test.ts src/__tests__/database-recovery.test.ts src/__tests__/video-list-page-recovery.test.tsx harness/m03-video-import.test.ts harness/m15-settings-recovery.test.ts harness/m20-boundaries.test.ts
npx.cmd tsc --noEmit
cargo.exe test --manifest-path src-tauri/Cargo.toml --lib persistence
```

Observed result: the focused frontend set passed 9 files / 75 tests, TypeScript passed, and Rust persistence passed 7 tests. The full frontend suite passed 64 files / 397 tests with 1 live-key test skipped; the production build passed with the existing Vite dynamic/static import chunking warnings; `git diff --check` reported no whitespace errors.

## What changed in the 2026-07-27 atomic import-persistence slice

Completed the database-control import-persistence stage after `106497d refactor: extract import state persistence`:

- Added `src/models/database-import-atomic.ts` as the owner of ASR atomic save, ASR sentence assignment, final import merge and direct atomic sentence insertion.
- Added `src/models/database-content-rows.ts` as the single Node/Sentence row codec and sentence-ID conflict rule used by both ordinary CRUD and atomic writes.
- Kept all four business operations re-exported from `@/models/database`; Pipeline, E2E and Harness callers did not learn either internal module path.
- Added `database-import-atomic.test.ts` to lock SQLite video existence checks, normalized ASR ownership, exact Rust command payloads and direct `BEGIN/COMMIT/ROLLBACK` order.
- Kept memory rollback, stale-state, graph-parent, exact-assignment and terminal `ready` behavior under the existing Pipeline/Stage2 tests and Rust persistence tests.
- Extended the internal-module boundary test so production callers outside `src/models/` cannot import the row codec or atomic module directly.
- Reduced `database.ts` from about 848 to 593 lines. Its remaining main responsibilities are adapter construction, content/note CRUD, settings and cascade deletion.
- This behavior-preserving refactor is governed by `AC-LV-04`, `AC-LV-05` and `AC-LV-09`; it does not expand their acceptance status or replace real Evidence.
- Locked files under `harness/` and `src-tauri/tests/` were not modified.

Focused verification:

```powershell
npm.cmd test -- --run src/__tests__/database-import-atomic.test.ts src/__tests__/database-boundary.test.ts src/__tests__/database-recovery.test.ts src/__tests__/pipeline-asr.test.ts src/__tests__/pipeline-recovery.test.ts src/__tests__/stage2-runner.test.ts harness/m03-video-import.test.ts harness/m04-ai-pipeline.test.ts harness/m15-settings-recovery.test.ts harness/m18-long-video.test.ts harness/m20-boundaries.test.ts
npx.cmd tsc --noEmit
cargo.exe test --manifest-path src-tauri/Cargo.toml --lib persistence
```

Observed result: the focused frontend set passed 11 files / 115 tests, TypeScript passed, and Rust persistence passed 7 tests. The full frontend suite passed 65 files / 403 tests with 1 live-key test skipped; the production build passed with the existing Vite dynamic/static import chunking warnings. The initial whitespace check found and then removed one trailing blank line from `database.ts`; the final check passed.

## What changed in the 2026-07-27 note-persistence slice

Started the learning-content persistence stage with the isolated `AC-ST-06` responsibility:

- Added `src/models/database-notes.ts` as the owner of Note row mapping, insertion, per-video reads and content updates.
- Kept `insertNote`, `getNotesByVideoId` and `updateNoteContent` re-exported from `@/models/database`; the Notes workflow and Store loading path did not learn an internal module.
- Added `database-notes.test.ts`. Its initial red run exposed that SQLite inserted the Note and sentence references without a transaction and that the memory adapter allowed duplicate references despite the schema primary key.
- Inspected the installed `tauri-plugin-sql` 2.4.0 Rust source before accepting a mock-only transaction fix. Each `execute` targets a SQLx pool, so separate frontend `BEGIN`, insert and `COMMIT` calls do not prove one-connection atomicity; that attempted false green was discarded.
- SQLite adapter tests now lock the current statement payloads and error propagation without claiming rollback. Real Note/reference atomicity is recorded as a Harness Migration gap requiring a Rust command.
- The memory adapter now mirrors the Note primary key and `(note_id, sentence_id)` uniqueness constraints and restores both tables after a failure.
- Extended the internal-module boundary test so production callers outside `src/models/` cannot import `database-notes` directly.
- Reduced `database.ts` from about 593 to 505 lines. Video/content CRUD, progress, cascade deletion and settings remain there.
- Locked files under `harness/` and `src-tauri/tests/` were not modified.

Focused verification:

```powershell
npm.cmd test -- --run src/__tests__/database-notes.test.ts src/__tests__/study-notes.test.tsx src/__tests__/study-load.test.tsx harness/m08-notes.test.ts harness/m08-notes-component.test.tsx harness/m15-schema-crud.test.ts harness/store-zustand-phase2.test.tsx src/__tests__/database-boundary.test.ts
npx.cmd tsc --noEmit
```

Observed result: the focused set passed 8 files / 36 tests and TypeScript passed. The full frontend suite passed 66 files / 408 tests with 1 live-key test skipped; the production build passed with the existing Vite dynamic/static import chunking warnings; `git diff --check` reported no whitespace errors. No Rust files or locked Harness were changed; the missing Rust Note transaction remains explicit rather than being represented by a frontend mock.

## What changed in the 2026-07-27 atomic Note Harness Migration

Closed the remaining `AC-ST-06` SQLite failure-atomicity gap with the user-approved migration recorded in `docs/development/harness-migration-2026-07-27-note-persistence.md`:

- Added `src-tauri/src/note_persistence.rs` as the owner of the Note/reference SQLite transaction. It opens one transaction on the command's connection, writes the Note and every sentence reference, commits only after all writes succeed, and explicitly rolls back on failure.
- Added `insert_note_atomically` to the real Tauri command registry. `commands.rs` only resolves the application database, opens the connection, delegates persistence and adds error context.
- Changed only the SQLite branch of public `insertNote`: it now sends the complete Note in one command call. The stable `@/models/database` interface, memory adapter behavior, reads and edits remain unchanged.
- Migrated locked M20 to include the new command in the exact real registry, and added a locked Rust protocol test for camelCase Note payload fields.
- Replaced the old frontend statement-order tests with a single-command payload/error contract. Rust tests directly prove both success and rollback against SQLite; a duplicate second reference leaves both `note` and `note_sentence` empty.
- Removed the old known risk that frontend SQL-plugin calls could leave half a Note. `AC-ST-06` and the Note persistence seam are now Strong.
- Repaired the live-key smoke timeout without changing its opt-in contract. A forced real `qwen3-omni-flash` run first exposed Vitest's 5-second default timeout; the test now has a 30-second external-call allowance and passed in about 1.36 seconds. The key was injected only into the test process and was not written to the repository.

The migration first produced the expected 3 red assertions against the old implementation, then passed 4 focused frontend files / 19 tests and 3 focused Rust behavior/protocol tests. Full verification passed 66 frontend files / 408 tests with the opt-in live test skipped by default; the separately forced live test passed 1/1. Rust passed 53 library tests and 23 executable Harness tests, with the existing real Whisper model test ignored. The production build, `git diff --check` and a tracked-file scan for the supplied key passed. The existing Vite dynamic/static import chunking warnings remain unchanged.

## What changed in the 2026-07-27 study-content persistence slice

Continued the controlled database decomposition without changing product behavior or the stable `@/models/database` interface:

- Added `src/models/database-content.ts` as the owner of Node/Sentence ordinary writes and queries by Node or Video.
- Kept `insertNodes`, `getNodesByVideoId`, `insertSentences`, `getSentencesByNodeId` and `getSentencesByVideoId` re-exported from `database.ts`; Store, Pipeline, E2E and Harness callers did not learn the internal module.
- Added `database-content.test.ts` at the public interface. It characterizes complete SQLite Node/Sentence parameters, domain-row reconstruction and the distinct Node, sentence-by-Node and sentence-by-Video query scopes.
- Reused the existing real two-adapter seam inside the extracted module. Node/Sentence persistence no longer depends on `MemoryDatabase` compatibility methods, while both ordinary and atomic paths continue sharing `database-content-rows.ts`.
- Extended `database-boundary.test.ts` so production callers outside `src/models/` cannot import `database-content` directly.
- Reduced `database.ts` from 503 to 424 lines. Its remaining implementation responsibilities are adapter construction, Video lifecycle/progress, settings and cascade deletion.
- This slice is governed by `AC-ST-01` and existing `AC-LV-04/05/09` contracts. It does not modify locked Harness or claim new product behavior.

Focused verification passed 6 files / 87 tests across the new SQLite characterization, internal import rule, M15 CRUD, production study loading, Pipeline ASR and Stage2 behavior; TypeScript also passed. The full frontend suite passed 67 files / 410 tests with the opt-in live test skipped by default. The production build passed with the existing Vite dynamic/static import chunking warnings, and `git diff --check` passed. Rust and the multi-hour real-video E2E were not rerun because this slice changes only TypeScript module ownership while preserving the public database interface and all runtime behavior.

## What changed in the 2026-07-27 Video persistence slice

Separated ordinary Video persistence from cross-table deletion without changing the stable `@/models/database` interface:

- Added `src/models/database-videos.ts` as the owner of Video row mapping, insert/get, approved list orderings, title search, status, monotonic position and `lastStudiedAt`.
- Kept all seven operations re-exported from `database.ts`; pages, Store, Pipeline, E2E and Harness callers did not learn the internal module.
- Added `database-videos.test.ts` at the public interface. It locks the complete SQLite row, three approved sort clauses, parameterized title search and the distinct status/progress/last-studied writes.
- `AC-ST-05` now has a direct SQLite judge for `UPDATE ... WHERE position < $1`, while M15 and production `StudyInterface` tests continue proving memory and user-workflow behavior.
- Extended `database-boundary.test.ts` so production callers outside `src/models/` cannot import `database-videos` directly.
- Reduced `database.ts` from 424 to 265 lines. It now owns adapter construction, settings and the still-uncontrolled cascade deletion.
- Deliberately left `deleteVideoWithCascade` outside the completed module. Its missing AC, memory placeholder-sentence gap and SQLite transaction gap are recorded as risk 18 and Partial coverage.
- Locked Harness files were not modified.

Focused verification passed 7 files / 32 tests across the new SQLite characterization, internal import rule, M15 queries/CRUD, production study progress/loading and local import; TypeScript also passed. The full frontend suite passed 68 files / 413 tests with the opt-in live test skipped by default. The production build and `git diff --check` passed with the existing Vite dynamic/static import chunking warnings. Rust and the multi-hour real-video E2E were not rerun because this slice changes only TypeScript module ownership and adds no Rust command or runtime behavior.

## What changed in the 2026-07-27 atomic Video deletion Harness Migration

Closed the previously recorded cross-table deletion risk through the user-approved `AC-LV-13` migration:

- Added `AC-LV-13`: deleting a Video must atomically remove its Node, ordinary Sentence, direct ASR placeholder Sentence, Note, Note-Sentence reference and import checkpoint; failure preserves all rows, other Videos remain intact, and a missing Video is idempotent.
- Added `src/models/database-video-deletion.ts`. The stable `deleteVideoWithCascade` export remains at `@/models/database`; SQLite now sends one `delete_video_atomically` command instead of six independent SQL-plugin calls.
- Added `src-tauri/src/video_deletion.rs`, which performs the six-table cleanup on one SQLx connection and transaction.
- Fixed the in-memory mirror so direct `node_id = videoId` ASR placeholder sentences are removed and all replacement tables are computed before mutation.
- Added the public interface test and three real SQLite tests: successful isolated deletion, a trigger-forced failure on the final Video delete proving full rollback, and missing-Video idempotency.
- Strengthened locked M15 with placeholder/checkpoint assertions and locked M20 with the approved real command. Authorization and old-to-new judge mapping are recorded in `docs/development/harness-migration-2026-07-27-video-deletion.md`.
- Updated the coverage, database control and module maps. The deletion seam is now `Strong（公共接口 + Rust 事务）`; prior known risk 18 is resolved.
- Reduced `database.ts` from 265 to 213 lines. It now owns adapter construction, settings and stable re-exports, while deletion behavior has an independent owner and judge set.

The pre-implementation red run produced four expected failures: missing command registration, swallowed SQLite command failure, and ASR placeholder leakage in both the public interface test and M15. After implementation, the focused frontend set passed 4 files / 25 tests and focused Rust deletion tests passed 3 tests.

Full verification passed:

- Vitest: 69 files / 415 tests passed; 1 live-key test skipped by its explicit environment guard.
- Rust: 79 tests passed; 1 real Whisper model test remained explicitly ignored.
- TypeScript and Vite production build passed with the existing dynamic/static import chunking warnings.
- The multi-hour real-video E2E was not rerun because this change is directly judged at the public command boundary and against real in-memory SQLite transaction behavior; it does not alter ASR, LLM or study rendering.

## What changed in the 2026-07-27 Settings persistence slice

Completed the final business-persistence extraction from `database.ts` without changing the stable public interface:

- Added `src/__tests__/database-settings.test.ts` before moving implementation. The characterization locks parameterized SQLite upsert/read/delete calls, preserves empty strings versus missing keys, and proves adapter failures reach callers.
- Confirmed the pre-move implementation passed the new characterization together with M15 Settings CRUD, model-pool and capability-record tests; this established a green behavioral baseline rather than inventing semantics during refactoring.
- Added `src/models/database-settings.ts` as the owner of `setSetting`, `getSetting` and `deleteSetting` for both SQLite and memory adapters. Callers still import all three from `@/models/database`.
- Removed the last concrete `MemoryDatabase` business compatibility methods (`_getTable/_setTable`) and the Settings-specific type guard from `database.ts`.
- Extended `database-boundary.test.ts` so production callers cannot bypass the stable entry and import `database-settings` directly.
- Updated the database control, coverage and module maps. Low-level Settings persistence is Strong through public-interface dual-adapter judges; model JSON/Key separation, legacy migration, capability fingerprints and preflight remain the responsibility of their higher-level behavior tests.
- Recorded Runtime Settings snapshot saving as a separate Partial seam: its multi-key success path is covered, but all-or-nothing failure behavior has no Active AC or transaction judge yet.
- No locked Harness file changed and no Harness Migration was required. Existing M15-T14 through T17 remained an unchanged memory-adapter judge.
- Reduced `database.ts` from 213 to 163 lines. It now contains stable re-exports plus adapter construction and no business-table CRUD.

Verification:

- Focused Settings/database tests: 7 files / 39 tests passed.
- Full Vitest: 70 files / 417 tests passed; 1 live-key test skipped by its explicit environment guard.
- TypeScript and Vite production build passed with the existing dynamic/static import chunking warnings.
- Rust and the multi-hour real-video E2E were not rerun because this slice changes only TypeScript module ownership, keeps SQL behavior characterized, and does not modify Rust, ASR, LLM or rendered workflows.

## What changed in the 2026-07-27 atomic Runtime Settings Harness Migration

Closed the mixed-snapshot risk through the user-approved `AC-LV-14` migration:

- Added `AC-LV-14`: model list, separately stored API Keys, three role assignments, capability records and removed-model Key cleanup must commit as one Runtime Settings snapshot; legacy-format migration follows the same rule; failures preserve the complete previous snapshot and unrelated settings.
- Added ordered `SettingMutation` and `applySettingMutationsAtomically` to `database-settings.ts`. SQLite sends one `apply_settings_atomically` command; memory computes and replaces the complete setting table result once.
- Added `src-tauri/src/settings_persistence.rs`, which applies all set/delete mutations on one SQLx connection and transaction.
- Migrated both `saveRuntimeSettings` and `executeRuntimeSettingsMigration` from repeated independent CRUD to one mutation batch. Single-key CRUD remains available for genuinely independent operations such as the preflight write/delete probe.
- Strengthened `database-settings.test.ts` with public command payload/error propagation and memory batch isolation. Updated `model-pool.test.ts` to prove legacy migration submits one complete batch.
- Added Rust success/isolation and trigger-forced final-delete failure tests; the latter proves earlier model/role writes roll back.
- Added `apply_settings_atomically` to locked M20 under the approved migration. M15 single-key CRUD remained unchanged.
- Recorded authorization and judge replacement in `docs/development/harness-migration-2026-07-27-runtime-settings.md`; updated AGENTS, coverage, database control and module maps. Runtime Settings snapshot saving is now Strong rather than Partial.

The pre-implementation red run produced three expected failures: missing batch interface on SQLite and memory paths, plus missing real command registration. After implementation, the focused Settings set passed 7 files / 47 tests and focused Rust persistence passed 2 tests.

Full verification passed:

- Vitest: 70 files / 419 tests passed; 1 live-key test skipped by its explicit environment guard.
- Rust: 81 tests passed; 1 real Whisper model test remained explicitly ignored.
- TypeScript and Vite production build passed with the existing dynamic/static import chunking warnings.
- The multi-hour real-video E2E was not rerun because the changed behavior is directly judged at the business mutation batch, public command protocol and real in-memory SQLite transaction layers; ASR, LLM requests and rendered study workflows are unchanged.

## What changed in the 2026-07-27 Rust commands audit and ASR Transcript slice

Audited `src-tauri/src/commands.rs` by reason to change rather than by line count. Most of its 15 Tauri commands are already thin adapters; the two real mixed responsibilities were ASR Transcript conversion/validation and ASR Execution lifecycle management.

- Added `src-tauri/src/asr_transcript.rs` as the single owner of `WhisperResult -> Result<Vec<AsrSentence>, String>` through `build_asr_transcript`.
- Moved sentence splitting, no-word-timestamp fallback, suspicious token handling, empty/mojibake rejection, timestamp validation, the 500-character Stage2 input budget and globally unique IDs together with their responsibility.
- Kept the `start_asr` command name, payload, return shape and frontend interface unchanged. `commands.rs` now delegates transcript construction after Whisper completes.
- Moved the 10 direct transcript behavior tests into the new module. The 3 ASR execution tests for cancellation, tier validation and language normalization remain with `commands.rs`.
- Reduced `commands.rs` from about 835 to 459 lines. The new transcript module is about 438 lines including its 10 tests; line count is not the acceptance criterion.
- No locked file under `harness/` or `src-tauri/tests/` changed, so this behavior-preserving responsibility extraction required no Harness Migration.
- This slice is governed by `AC-LV-03` and the existing Stage2 input constraints. Its direct judge is the Rust `asr_transcript` test module; `pipeline-asr.test.ts` proves a rejected result cannot advance to Stage2, while real Evidence remains the judge for the complete Whisper runtime.

The next controlled Rust slice is ASR Execution: temporary WAV creation, progress events, cancellation, scheduler lifecycle and model invocation still live in `commands.rs`. They should move behind one execution interface while keeping the Tauri protocol and their existing scheduler/event/command judges stable. The other thin commands should not be rewritten merely to make the file shorter.

Focused verification passed 10 `asr_transcript` tests and 3 remaining `commands::tests`. Full verification passed 70 frontend files / 419 tests with 1 live-key test skipped by its explicit environment guard; Rust passed 81 tests with 1 real Whisper model test explicitly ignored. The production Vite build passed with the existing dynamic/static import chunking warnings. `rustfmt --check` for the new module and `git diff --check` also passed. The multi-hour real-video E2E was not rerun because the Tauri protocol, Whisper invocation and observable transcript rules are unchanged and all moved rules are directly judged through the same production entry.

## What changed in the 2026-07-27 ASR Execution slice

Completed the second responsibility extraction from `src-tauri/src/commands.rs` without changing the `start_asr` Tauri protocol:

- Added `src-tauri/src/asr_execution.rs` with one public `execute_asr` interface and an `AsrExecutionRequest` carrying the existing command inputs.
- Moved tier/language/request validation, scheduler lease ownership, temporary WAV lifecycle, blocking conversion/inference, progress reporting, Transcript invocation and final success/failure/cancelled/stale classification together.
- Kept `start_asr` as a thin adapter that only packages Tauri arguments and supplies the managed scheduler. Command name, payload, return shape and `generate_handler!` registration are unchanged.
- Added private backend and reporter seams. Production adapters call the existing Whisper and Tauri event modules; test adapters drive the same orchestration without loading a model or desktop runtime.
- Preserved the 3 existing validation/cancellation tests and added 3 direct lifecycle tests for ordered `10/35/90/100` progress, backend failure plus scheduler state, and conversion-time cancellation plus cancelled reporting.
- An attempted Tauri `mock_app` reporter test failed before test execution on this Windows environment with `STATUS_ENTRYPOINT_NOT_FOUND`; that approach was removed rather than skipped. The private reporter adapter provides a fast portable judge without changing the public interface.
- Reduced `commands.rs` from about 459 to 314 lines. The new execution module is about 457 lines including 6 tests; the improvement is responsibility and judge locality, not line-count reduction.
- No locked file under `harness/` or `src-tauri/tests/` changed, so no Harness Migration was required. Existing scheduler, command and Whisper Harness remain independent system judges.
- This slice is governed by `AC-LV-03`, `AC-LV-07` and `AC-LV-10`. The canonical real-video evidence remains the full runtime judge; the multi-hour E2E is not required to prove a behavior-preserving module move when the execution lifecycle now has direct fast judges.

Focused verification passed 6 `asr_execution` tests, 13 scheduler tests, 5 locked command Harness tests and 5 locked Whisper Harness tests. Full verification passed 70 frontend files / 419 tests with 1 live-key test skipped by its explicit environment guard; Rust passed 84 tests with 1 real Whisper model test explicitly ignored. The production Vite build passed with the existing dynamic/static import chunking warnings. `rustfmt --check`, `git diff --check` and the locked-directory diff check passed. The multi-hour real-video E2E was not rerun because the Tauri protocol, production Whisper adapter and observable lifecycle are unchanged, while the moved orchestration now has direct success/failure/cancellation judges.

The next controlled Rust risk is model download/listing, not the remaining thin commands. Before implementation, define and confirm acceptance criteria for streaming memory use, progress, cancellation, partial-file cleanup, integrity and replacement behavior; then assign each criterion to a direct Rust judge and any necessary UI/Evidence judge.

## What changed in the 2026-07-27 Whisper model-download AC proposal

Stopped before modifying the known model-download hotspot and converted the uncertainty into three explicit Proposed acceptance criteria:

- `AC-MM-01` proposes a versioned trusted manifest, streamed temporary-file writes, byte-count/SHA-256 verification, atomic final replacement, old-valid-file preservation and idempotent reuse.
- `AC-MM-02` proposes bounded-memory chunk consumption, monotonic byte/percent progress, per-model cancellation, one writer per model and clean retry.
- `AC-MM-03` proposes a settings workflow driven by production events: real progress, cancel, distinct failed/cancelled states, retry, listener cleanup and success only after the installed-model list sees the final file.
- Each AC now names its proposed owner and direct judge. Rust tests would use a local HTTP fixture and temporary directory rather than real multi-GB downloads; UI tests would drive the real form through the production Tauri adapter/event seam.
- The current locked M20 only proves command registration. Adding `cancel_whisper_model_download` would change its exact command set, so implementation requires a separately approved Harness Migration after the ACs become Confirmed.
- Historical model-management specs mention progress, but they are not current acceptance truth. The proposal records that intent without silently promoting it to Active behavior.
- No product code or locked Harness changed in this proposal slice.

The next decision is product authorization, not implementation: confirm, amend or reject `AC-MM-01` through `AC-MM-03`. Only after confirmation should the work proceed test-first, beginning with the Rust download module judges.

## What changed in the 2026-07-27 Whisper model-download slice

The user confirmed `AC-MM-01` through `AC-MM-03` and explicitly approved the M20 Harness Migration for a dedicated cancellation command. The model-download hotspot is now behind one owned Rust module and one frontend workflow:

- Added `src-tauri/src/whisper_model_download.rs`. It pins all five supported files to upstream revision `5359861c739e955e79d9a303bcbc70fb988958b1` with exact byte counts and SHA-256 values, streams bounded response chunks into a unique same-directory `.part`, hashes incrementally, syncs and atomically replaces only after verification.
- Kept production logic and its direct judges adjacent but separate: `whisper_model_download.rs` is about 466 lines, while the 11 local HTTP/filesystem/protocol judges live in `whisper_model_download_tests.rs` instead of doubling the production file's reading cost.
- Existing valid files are reused without network access. Integrity/network/progress failures and cancellation remove the partial file; replacement failure preserves the prior destination. `list_models` only returns known final filenames and does not claim ASR capability.
- Added a per-model download lease and cancellation token. One model size has one writer; cancellation wakes a stalled `Response::chunk()` through `Notify` plus `tokio::select!`, cleans up, and permits a clean retry.
- `commands.rs` now only parses the model size, resolves the application model directory and delegates download/cancel/list. Tauri manages the download manager; locked M20 now includes the approved `cancel_whisper_model_download` command.
- Added `src/settings/whisper-model-download.ts` as the production session owner for event filtering, download/cancel invokes, installed-list verification and listener disposal. `AddModelForm` displays actual bytes/percent, exposes cancel, distinguishes failed/cancelled, permits retry and only reports success after Rust lists the final file.
- Corrected the model-size labels to the pinned ggml file sizes (MiB/GiB); the old labels understated every download by roughly half. M20 now locks the frontend/Rust model-progress event name, and Rust locks its camelCase payload.
- Recorded the authorization and old-to-new judge mapping in `docs/development/harness-migration-2026-07-27-whisper-model-download.md`. The three ACs are Confirmed and their coverage is Strong.

TDD evidence: the manifest test first failed to compile without `manifest_for`; M20 failed only for the missing approved command; all three UI tests failed on the old form; the model-size assertion exposed the stale medium label; and the correctly synchronized stalled-read test timed out before cancellation gained a wake-up path. A final diff review found that atomic replacement failure retained the verified `.part`; its red test failed for the missing commit helper before cleanup was added. Focused verification then passed 11 Rust download tests, 4 frontend/Harness files with 18 tests, and TypeScript compilation.

Full verification passed 71 frontend test files / 423 tests with 1 live-key test skipped by its explicit environment guard. Rust passed 95 tests with 1 real Whisper model test explicitly ignored. TypeScript and the Vite production build passed with the existing dynamic/static import chunking warnings. A real GB-scale model download and the multi-hour real-video E2E were not run: this slice is directly judged with the pinned production manifest, local streaming HTTP fixtures, the real filesystem, the production Tauri command/event boundary and the real settings form; model capability remains owned by its separate probe/Evidence judges.

Strict Clippy remains globally blocked by two pre-existing warnings in `whisper.rs` (`should_implement_trait` and `manual_is_multiple_of`). Rerunning with only those two lints allowed and all other warnings denied passed, so the new download module introduces no additional Clippy warning.

## What changed in the 2026-07-28 Runtime Settings Store commit slice

Continued the model-download-to-role-selection audit and closed the UI/Store publication gap under the already Confirmed `AC-LV-14`:

- Verified that production ASR capability checks resolve a saved Whisper size such as `medium` through `list_whisper_models` to the real installed `ggml-medium.bin` path before calling `start_asr`. The download, installed-file and capability facts are separate and connected through production interfaces.
- Removed `SettingsPage`'s direct database hydration. Runtime Settings now have one startup loader through the Store's `createRuntimeSettingsInitializer`; `settings-boundary.test.ts` prevents settings UI from importing database interfaces again.
- Added pure candidate construction through `createModelPoolEntry` and `runtimeSettingsFromEntries`. Adding or removing a model no longer mutates the module-global pool before persistence.
- Changed Store model add/remove and role assignment into awaited result-returning actions. They save the complete candidate snapshot first and publish Zustand/global-pool state only after success; failure preserves the old memory facts and returns an actionable error.
- Updated the add form, model list and role selector to wait for the Store result, disable the in-flight control and visibly report persistence failure. Failed add does not close the form, failed removal leaves the row visible, and failed role assignment leaves the previous selection.
- Added `runtime-settings-store.test.ts` for commit ordering and failure preservation, `runtime-settings-ui.test.tsx` for visible failure behavior, and `settings-boundary.test.ts` for module ownership. Updated the existing role gate judge to await the now-transactional public action.
- Recorded the ownership and judge alignment in `docs/development/harness-alignment-2026-07-28-runtime-settings-store.md`; no locked `harness/` file changed.

At the end of this slice, the historical facts still did not state whether explicitly deleting a model must clear its roles or whether a local Whisper entry may be saved before download reaches `done`. Both questions were subsequently confirmed by the user and are resolved in the next section through `AC-LV-15` and `AC-MM-04`; they are no longer open decisions.

Verification on branch `master` before commit: full frontend passed 74 files / 431 tests with 1 live-key test skipped by its existing environment guard; Rust passed 95 tests with 1 real Whisper model test explicitly ignored; TypeScript and Vite production build passed with the existing dynamic/static import chunking warnings; `git diff --check` passed apart from expected Windows line-ending notices. The multi-hour real E2E was not rerun because this slice changes Runtime Settings publication and is directly judged from UI through Store, mutation batch and existing Rust transaction tests; model inference behavior and production command protocols are unchanged.

## What changed in the 2026-07-28 model-pool integrity slice

The user confirmed the two product boundaries left open by the preceding Store commit slice. They are now explicit, owned and directly judged:

- Added Confirmed `AC-MM-04`: a local Whisper model may enter the pool only after the production `list_whisper_models` interface can discover the final file for its selected size. Entering the pool remains configuration, not ASR capability evidence.
- Extracted `requireInstalledWhisperModel` in `whisper-model-download.ts`. The download session uses it before reporting success, and the Store calls the same interface again before constructing a Whisper model entry, so a future UI or direct Store caller cannot bypass installation verification.
- The Whisper form keeps Save disabled until the selected download session reaches verified `done`. Changing the selected size still resets that status; the Store recheck protects against file removal or stale UI state between download and save.
- Added Confirmed `AC-LV-15`: deleting a model atomically removes its pool entry, capability records, all ASR/structuring/assistant role references and separately stored API Key while preserving unrelated roles and models.
- The Store deletion action now creates the role-cleaned candidate snapshot before persistence, then publishes model pool, roles and capabilities together only after success. Existing failure judges continue to prove that no in-memory deletion appears when the snapshot save fails.
- Recorded the decisions as `DEC-002` and `DEC-003`, mapped owners/judges in acceptance, coverage, module and database control documents, and added `harness-alignment-2026-07-28-model-pool-integrity.md`. No locked Harness changed.

TDD evidence: the new Store judge first showed that an uninstalled Whisper returned `{ ok: true }` and persisted; the deletion judge showed both assigned roles survived in the saved snapshot; the real form judge showed Save enabled before installation. After the shared installed-list gate and role-cleaned snapshot were implemented, all three turned green.

Verification on branch `master` before commit: full frontend passed 74 files / 433 tests with 1 live-key test skipped by its existing environment guard; Rust passed 95 tests with 1 real Whisper model test explicitly ignored; TypeScript and Vite production build passed with the existing dynamic/static import chunking warnings; `git diff --check` passed apart from expected Windows line-ending notices. The multi-hour real E2E and GB-scale download were not rerun because the new behavior is directly judged through the production Store/list adapter seam, real settings form, existing Rust command/download tests and Runtime Settings transaction tests; inference behavior is unchanged.

## What changed in the 2026-07-28 Control Plane Harness slice

Implemented the first Harness that checks Rain's Harness control documents themselves under user-confirmed `AC-HE-01`:

- Added `scripts/control-plane-validator.mjs` as a directly executable Node interface. It parses the acceptance and coverage structures, walks real repository files while excluding generated/cache directories, and reports deterministic AC-specific errors.
- Added six independent fixture judges in `control-plane-validator.test.ts`: valid control data, missing coverage, missing Owner/Judge, missing judge file, stale current-state demotion and conflicting acceptance statuses. The tests do not derive expected values from Rain's current documents.
- Added `npm run harness:control` for the fast control-plane check and `npm run harness:check` as the single full entry for control validation, frontend tests, production build and Rust tests.
- The first real validator run failed on stale current facts in this file: risk 17 still called `AC-MM-01`/`AC-MM-03` Proposed after their implementation. That obsolete risk was removed, proving the validator found an existing defect rather than merely passing by construction.
- Removed volatile static checkout date/base claims from the top of `PROJECT_STATE.md`; current HEAD, branch and dirty state must be queried from Git. Updated the active control maps, documented the validator boundary and made the commands discoverable from `AGENTS.md`.
- The validator checks control consistency only. It cannot sign off product behavior, real SQLite/Tauri execution, paid model calls or Evidence; those remain owned by each product AC.

TDD evidence: the test suite first failed because the production module did not exist; then five rules passed while the empty-Owner fixture exposed a multiline parser bug; finally the conflicting-status fixture failed until duplicate AC definitions were grouped and rejected. The real repository then failed on its stale Proposed claims before the current facts were repaired.

Verification on branch `master` before commit: `npm run harness:check` passed end to end. Control Plane validation passed; frontend passed 75 files / 439 tests with 1 live-key test skipped by its explicit environment guard; TypeScript and Vite production build passed with the existing dynamic/static import chunking warnings; Rust passed 95 tests with 1 real Whisper model test explicitly ignored. The real E2E was not rerun because this slice changes repository tooling and documentation rather than runtime behavior.

## What changed in the 2026-07-28 Runtime Settings ordering slice

Confirmed and implemented `AC-LV-16` so Runtime Settings initialization and writes now have a deterministic owner and order:

- Store mutation actions reject before the first successful settings load and do not call persistence in that state.
- Model, role and capability writes share one Store submission queue. Each queued action constructs its candidate snapshot only when it receives execution, so a later action includes the prior successful commit instead of overwriting it from an older snapshot.
- Every successful settings commit advances a Store-local revision. Initialize/retry captures that revision and a load generation before awaiting persistence; a result that becomes stale cannot replace Zustand or the module model-pool copy.
- The SQLite contract did not change: it still atomically commits one complete Runtime Settings snapshot. Ordering multiple frontend actions remains the Store's responsibility.
- Added `DEC-004`, acceptance ownership, coverage and module/database boundary notes. Locked `harness/` files were not modified.

TDD evidence: the three new Store tests first failed independently: a pre-load add returned success and persisted, two concurrent adds invoked persistence twice before either completed, and a delayed reload erased a successful add. After the queue/readiness/revision gates were implemented, all three passed; the existing delayed-save test was updated to wait until its queued persistence call actually began.

Verification on branch `master` before commit: `npm run harness:check` passed end to end. Control Plane validation passed; frontend passed 75 files / 442 tests with 1 live-key test skipped by its explicit environment guard; TypeScript and Vite production build passed with the existing dynamic/static import chunking warnings; Rust passed 95 tests with 1 real Whisper model test explicitly ignored. The multi-hour real E2E was not rerun because this slice changes settings action ordering without changing model inference, Tauri commands or SQLite payloads.

## What changed in the 2026-07-28 Runtime Settings desktop E2E slice

Started from a clean `master` checkout at `7518ca8 fix: order runtime settings mutations` and selected the no-live-key desktop restart check as the highest-value remaining Runtime Settings Harness gap:

- Existing Store tests, public database tests and Rust transaction tests independently covered `AC-LV-14` through `AC-LV-16`, but no current Judge traversed real Tauri startup, the SQL plugin, schema initialization, Store hydration, production Settings UI and process restart after the ordering slice.
- Added `npm run e2e:runtime-settings` and `scripts/run-runtime-settings-e2e.ps1`. The script builds the current desktop app, routes the production database singleton to a unique system-temp SQLite, drives the real Settings UI through WebDriver, adds an API-Key-free test LLM, restarts and proves it persists, deletes it, restarts again and proves it is gone.
- Added a third `runtime-settings` mode to the existing E2E config command. It requires only an isolated database path. The full video `RealE2eRunner` explicitly ignores this mode, while `db-singleton.ts` continues using the same production config interface for isolation; no new Tauri command or locked M20 migration was needed.
- Settings exposes only a `loading/ready/error` DOM hydration state plus stable ASCII action seams. These attributes contain no model data or secret and make the live application deterministic and legible to WebDriver instead of relying on sleeps or PowerShell-decoded Chinese labels.
- The script clears known LLM Key environment variables in its child-process environment, verifies the form Key is empty, never clicks connection/capability checks, and removes the isolated temporary directory. It does not grant `Compatible`/`Verified`, exercise paid models, download Whisper or replace the multi-hour video Evidence.
- Recorded the Owner/Judge/scope contract in `docs/development/runtime-settings-desktop-e2e.md` and mapped the new Judge to existing `AC-LV-14`, `AC-LV-15` and `AC-LV-16`. No new product behavior or AC was introduced, and no locked file under `harness/` or `src-tauri/tests/` changed.

TDD evidence:

- Rust first rejected `runtime-settings` with `RAIN_E2E_RUN_MODE must be full or ui-proof`; the focused config test turned green after the minimal isolated mode was added.
- The component test first showed that `RealE2eRunner` incorrectly armed for the short mode; it turned green after ownership was left to WebDriver.
- The settings observability test first found no hydration state; it turned green after the public page exposed the three-state boundary.
- The first real runs exposed Harness defects rather than hidden product changes: cleanup masked the original error, a Chinese selector was corrupted by Windows PowerShell 5 UTF-8 decoding, and an overly broad model selector caused a false deletion timeout. The Harness now preserves primary errors, retries exact temp cleanup, uses ASCII test IDs and matches only `model-entry-*` rows.

Focused verification passed the two new frontend tests and all six Rust E2E config tests. The final real desktop run passed all three launches: isolated initialization, add, first restart persistence, delete and second restart absence. Final `npm run harness:check` also passed end to end: Control Plane validation passed; frontend passed 77 files / 444 tests with 1 live-key test skipped by its explicit environment guard; TypeScript and the Vite production build passed; Rust passed 96 tests with 1 real Whisper model test explicitly ignored. File-scoped `rustfmt --check` passed for `e2e_config.rs`; the separate whole-repository formatting debt is recorded as risk 17. Tauri/Vite retained only the existing bundle-identifier and dynamic/static import warnings.

## What changed in the 2026-07-28 real SQLite schema Judge slice

After the Runtime Settings desktop E2E commit, the control plane had one remaining explicit architecture Partial that did not require a new product decision: M15 proved schema metadata only through the memory adapter, while no Judge inspected the tables and columns created by the real Tauri SQL plugin. This slice closes that required-shape gap without changing the schema or locked Harness:

- The existing pre-agreed seam remains the public `Database.listTables/getTableColumns` interface used by M15. `createDatabase`/`TauriSqlDatabase` remain the schema Owner; no new Tauri command or database side channel was added.
- In `runtime-settings` mode only, `RealE2eRunner` now asks the production `getDb()` singleton for actual table metadata and publishes the unjudged result to WebDriver. It does not import expected schema constants, start the video workflow, expose row data or render an automation overlay.
- `scripts/run-runtime-settings-e2e.ps1` is the Judge Owner for the independent literal contract. Before mutating Runtime Settings, it checks that the isolated real SQLite contains all seven required tables and their required columns, then continues the existing add/restart/delete/restart flow.
- This strengthens the database schema architecture row and the real initialization portion of `AC-LV-14`; it adds no product behavior or new AC. The boundary excludes schema upgrade compatibility, policies for additive columns, other business CRUD semantics, fault injection, model calls and Evidence.
- No file under locked `harness/` or `src-tauri/tests/` changed.

TDD evidence: `real-e2e-runner-mode.test.tsx` first failed because the runtime-settings schema result remained `undefined`; after the minimal public-interface reporter was added, the focused test passed. The real desktop command then passed the seven-table metadata check plus initialization, add, first restart persistence, delete and second restart absence against a unique temporary SQLite without any API Key or model call.

Final verification on `master` before commit: `npm run e2e:runtime-settings` passed the real Tauri/SQL plugin/schema/UI/restart flow; `npm run harness:check` passed end to end. Control Plane validation passed; frontend passed 77 files / 444 tests with 1 live-key test skipped by its explicit environment guard; TypeScript and Vite production build passed; Rust passed 96 tests with 1 real Whisper model test explicitly ignored. Tauri/Vite retained only the existing bundle-identifier and dynamic/static import warnings.

## What changed in the 2026-07-28 E2E build-isolation slice

The user confirmed `DEC-005` and `AC-HE-02` to close the former risk that `App.tsx` statically imported the complete real E2E Runner into every normal production bundle:

- `App` now knows only the small `E2eAutomation` interface. The default `entry.tsx` adapter returns no automation; `enabled-entry.tsx` is the only adapter that imports `real-e2e-runner.tsx`.
- `vite.config.ts` selects the enabled adapter only when an E2E script explicitly sets `RAIN_E2E_BUILD=1`. Both real E2E scripts own that flag; such output is classified as automation-only and must not be distributed as the normal product artifact.
- `verify-e2e-build-isolation.mjs` scans every JavaScript file in the real `dist`. A normal build rejects the E2E result, schema and status markers; an E2E build requires all three, so deleting or misrouting the Runner cannot make the isolation check pass falsely.
- `npm run build` now includes the appropriate artifact Judge, and therefore `harness:check` automatically enforces the normal-production half of `AC-HE-02`.
- No product behavior, Tauri command, database contract, locked `harness/` file or locked Rust Harness changed.

TDD evidence: against the pre-change production `dist`, the new Judge failed with all three forbidden markers present. After the dual-adapter build seam was added, the normal bundle passed with all markers absent and the explicit E2E bundle passed with all markers present. The normal main JavaScript bundle decreased from 284.11 kB to 275.85 kB in the observed build. The no-key Runtime Settings desktop E2E then passed its real Tauri/schema/add/restart/delete/restart flow through the enabled adapter.

The paid multi-hour `full` E2E was not rerun. Its `ui-proof` alternative is also not a read-only smoke test: it updates canonical Evidence artifacts. Because this slice changes only the shared build adapter that the successful Runtime Settings desktop run traversed, neither expensive inference nor Evidence mutation was authorized as an additional Judge.

Final verification on `master` before commit: `npm run e2e:runtime-settings` passed the enabled E2E build Judge and the complete no-key Tauri/schema/UI/restart flow. `npm run harness:check` passed end to end: Control Plane validation passed; frontend passed 77 files / 444 tests with 1 live-key test skipped by its explicit environment guard; the default TypeScript/Vite production build passed and verified 5 JavaScript output files contained no E2E markers; Rust passed 96 tests with 1 real Whisper model test explicitly ignored. Existing Vite dynamic/static import warnings remain, but the normal-build warnings no longer name `real-e2e-runner.tsx` as a static importer.

## What changed in the 2026-07-28 Runtime Settings E2E diagnostics slice

The user confirmed `DEC-006` and `AC-HE-03` after the short desktop Judge was found to delete its driver logs and isolated run directory on every failure:

- The script captures any known LLM Key values before clearing them at process startup. Diagnostic text replaces those exact values plus `sk-*` credentials and Bearer tokens; the desktop flow still performs no model call.
- Each critical startup/mutation/restart segment has a stable phase name. After a failure, the script stops WebDriver, writes `summary.json` and available redacted driver stdout/stderr to `%TEMP%\rain-runtime-settings-e2e-latest-failure`, then removes the isolated SQLite and per-run directory as before.
- Only one latest-failure directory is retained. A new failure replaces it and a successful full desktop run removes it, preventing unbounded accumulation or a stale failure being mistaken for current state.
- Diagnostic capture failure emits a warning and preserves the primary E2E error. Destructive cleanup is restricted by an exact resolved system-temp path check.
- No product behavior, Tauri command, database contract, locked `harness/` file or locked Rust Harness changed.

TDD evidence: the pre-change real Tauri run with `-SkipBuild -MaxSeconds 0` failed at `video list page` and the expected diagnostic path did not exist. After implementation, the same forced failure returned the original timeout, reported `initial-startup`, retained three diagnostic files and excluded an injected `sk-rain-diagnostic-probe-secret` from their combined contents. A following normal no-key desktop run passed schema/add/restart/delete/restart and confirmed `latest-failure` was removed.

Final verification on `master` before commit: PowerShell parsed the changed runner successfully; the real forced-failure and normal-success desktop runs passed their complementary diagnostic assertions; `npm run harness:check` passed end to end. Control Plane validation passed; frontend passed 77 files / 444 tests with 1 live-key test skipped by its explicit environment guard; the normal TypeScript/Vite build and production E2E-isolation Judge passed; Rust passed 96 tests with 1 real Whisper model test explicitly ignored. Existing Vite dynamic/static import warnings remain.

## What changed in the 2026-07-28 E2E build-isolation Judge self-test slice

`AC-HE-02` 的构建隔离 Judge 原来只读取 `dist` 下的 `.js` 文件。若调试或其他构建产生 `.js.map`，完整自动化源码或窗口标记可能只存在于 source map，而普通产物裁判仍会假绿。本边界不改变产品行为或既有 AC，只加强既有 Judge：

- `verify-e2e-build-isolation.test.ts` 通过可执行 CLI 这一公开 seam 创建独立临时 `dist`：JavaScript 本身干净，但相邻 source map 含 `__RAIN_E2E_RESULT__`。
- 旧 Judge 对该污染产物返回退出码 0，聚焦测试按预期 RED；`verify-e2e-build-isolation.mjs` 纳入 `.js.map` 后返回退出码 1 并报告污染标记，测试转绿。
- 扫描器仍要求至少存在一个真实 `.js`，因此只有孤立 source map 的空产物不能冒充有效构建。
- Owner 仍是 E2E 双 adapter、Vite 构建选择和构建脚本；Judge 是带独立污染 fixture 的 `verify-e2e-build-isolation.test.ts`、真实产物扫描器、`npm run build` 与短桌面 Tauri E2E。
- 边界内是 JavaScript/source-map 自动化标记泄漏；边界外是 CSS map、任意敏感信息扫描、收费模型调用、完整视频 Evidence，以及锁定产品 Harness 的迁移。
- 未修改产品代码、Tauri 命令、数据库合同、`harness/` 或 `src-tauri/tests/`。

聚焦验证 `npm test -- --run scripts/verify-e2e-build-isolation.test.ts` 通过 1 个测试，`npm run build` 通过真实 TypeScript/Vite 生产构建并验证 5 个 JavaScript/source-map 文件无自动化标记。最终 `npm run harness:check` 全绿：Control Plane validation 通过；前端通过 78 个文件 / 445 个测试，1 个 live-key 测试按环境门禁跳过；TypeScript/Vite 普通生产构建和加强后的产物 Judge 通过；Rust 通过 96 个测试，1 个真实 Whisper 模型测试明确 ignored。保留的只有既有 Vite dynamic/static import warnings。本边界不需要收费模型调用、完整视频 Evidence 或再次运行短桌面流程，因为变更只涉及独立测试过的产物文本扫描器，真实构建已是直接 Judge。

## What changed in the 2026-07-28 dual-build full-gate slice

`AC-HE-02` 已能分别裁判普通和显式 E2E 产物，但默认 `harness:check` 原来只运行普通构建。若真实 adapter 被误接为空，日常完整门禁仍会通过，直到短桌面 E2E 才能发现。该边界把既有反向 Judge 前移到每次完整交付门禁，不改变产品行为或 AC：

- 预先约定的公开 seam 是 `npm run build:e2e`。TDD RED 直接证明该命令不存在；不是通过读取 `package.json` 自证编排。
- `scripts/build-e2e-frontend.mjs` 使用当前 Node 进程直接运行仓库内固定的 TypeScript、Vite 和产物裁判入口，显式注入 `RAIN_E2E_BUILD=1`；不依赖 Windows `set`、新增包、Tauri、SQLite、Key 或模型。
- `harness:check` 现在先运行 E2E 前端构建，要求三项自动化标记全部存在，再运行普通构建，要求三项全部不存在。因此成功结束时 `dist` 仍是普通可发布前端产物。
- Owner 是双 adapter、Vite 构建选择和 `build-e2e-frontend.mjs`；Judge 是 `npm run build:e2e`、`npm run build`、互补产物扫描器及更高层短桌面 E2E。
- 边界内是日常总门禁对构建选择两侧的真实检查；边界外是启动 Tauri、Runtime Settings/SQLite 行为、live-key、收费模型、完整视频 Evidence 和锁定 Harness Migration。
- 未修改 `harness/`、`src-tauri/tests/` 或产品代码。

聚焦 GREEN 依次通过 `npm run build:e2e` 和 `npm run build`：E2E 主 bundle 为 284.11 kB 并包含全部标记，随后普通主 bundle 为 275.85 kB 并排除全部标记。最终 `npm run harness:check` 全绿并实际按新顺序运行：Control Plane validation 通过；前端通过 78 个文件 / 445 个测试，1 个 live-key 测试按环境门禁跳过；E2E 与普通 TypeScript/Vite 构建及各自互补 Judge 均通过，结束后的 `dist` 为普通产物；Rust 通过 96 个测试，1 个真实 Whisper 模型测试明确 ignored。只有既有 Vite dynamic/static import warnings 保留。本边界不需要启动桌面、调用收费模型或改写 Evidence。

## What changed in the 2026-07-28 private remote bootstrap

The user authorized creation and first publication of the repository after the local Harness Engineering audit:

- Authenticated GitHub account: `llbz510`.
- Created private repository `https://github.com/llbz510/rain` with default branch `master`.
- Added `origin` as `https://github.com/llbz510/rain.git`, pushed the complete current history and configured local `master` to track `origin/master`.
- Before publication, confirmed the worktree was clean, `harness:control` passed, no tracked file was at least 50 MB, and every current/history secret-pattern match came from an explicit fake test credential, prototype placeholder or redaction probe rather than a live credential.
- This establishes durable off-machine history but does not yet establish an independent evaluator: CI and branch protection remain the next infrastructure boundary.

No product source, locked `harness/`, locked Rust Harness, Evidence contract or acceptance behavior changed in this bootstrap. The state-document update is committed separately after the full local gate and pushed to the new remote.

## What changed in the 2026-07-28 independent Windows CI slice

After the private remote bootstrap, the user confirmed `AC-HE-04` to move the default repository Judge outside the implementation worktree:

- The public Judge seam is the GitHub Actions workflow `Harness` and its observed check context `Clean Windows Harness`. Before implementation, `gh workflow view Harness` returned that no workflow existed, providing the RED fact.
- `.github/workflows/harness.yml` runs on pull requests, `master` pushes and manual dispatch in a clean `windows-2025` hosted runner. It checks out without persistent credentials, installs Node 22, LLVM 22 and FFmpeg 8, verifies the native toolchain, runs `npm ci`, then delegates the complete decision to the existing `npm run harness:check`.
- The workflow has only `contents: read`; it receives no Rain secrets and does not start Tauri, use a live model, download Whisper or mutate Evidence.
- Owner is the workflow environment and the existing package-level Harness composition. Judge is the real GitHub Actions execution, not YAML existence or a local parser.
- Boundary scope is reproducibility of the default no-key gate in a clean Windows checkout. Branch protection follows only after the real check name and green behavior are observed; live-key, desktop Runtime Settings E2E, full video Evidence and release packaging remain outside.
- No product code, locked `harness/` file or locked Rust Harness changed.

The first real pull-request run, [30325680481](https://github.com/llbz510/rain/actions/runs/30325680481), supplied the required remote RED: checkout, Node 22, LLVM 22, native-toolchain verification and `npm ci` passed, then the Harness found that Windows PowerShell 5.1 on the hosted English image parsed the UTF-8-without-BOM mojibake literals in `validate-evidence.ps1` through the ANSI code page and failed before its assertions. The validator now expresses the same code points as ASCII `\uNNNN` regex escapes; its 18 focused tests remain green and the script is ASCII-safe. The second run, [30326004483](https://github.com/llbz510/rain/actions/runs/30326004483), passed parsing and exposed a second clean-host dependency: its `powershell.exe` environment did not provide `Get-FileHash`. SHA-256 calculation now uses the validator-owned .NET cryptography API with identical comparisons instead of relying on a host cmdlet. The third run, [30326307313](https://github.com/llbz510/rain/actions/runs/30326307313), passed all 445 frontend tests, both builds, a clean 9-minute Rust/whisper compilation and the first 78 Rust tests, then proved the final undeclared dependency: the real media fixture tests could not find `ffmpeg` or `ffprobe`. The workflow now pins and verifies FFmpeg 8.1.2 alongside LLVM, and `AGENTS.md` names the dependency.

The fourth run, [30327093540](https://github.com/llbz510/rain/actions/runs/30327093540), is the remote GREEN and promotes `AC-HE-04` to Strong: the observed `Clean Windows Harness` check completed in 15m34s on a fresh hosted runner; control-plane validation, 445 frontend tests (one explicit live-key skip), the E2E and production builds, and 96 Rust tests passed, with the one real-model Whisper case remaining explicitly ignored by its existing contract. No live key, desktop E2E, Whisper download or Evidence mutation was used.

## What changed in the 2026-07-28 public repository protection slice

The user explicitly chose public visibility after GitHub rejected branch protection for the private repository under the current account plan:

- Before changing visibility, the tracked tree had no file at or above 50 MiB. A credential-pattern scan found only the documented fake diagnostic probe string, not a real credential; local `master` and `origin/master` both resolved to `64c7d83` and the worktree was clean.
- GitHub reports `llbz510/rain` as `PUBLIC` with `master` as its default branch.
- The `master` protection API reports `Clean Windows Harness` as a required GitHub Actions check with strict up-to-date enforcement. Administrators are included; force-push and branch deletion are disabled; conversation resolution is required. No approving review count or linear-history policy was added, so a single-owner repository is not locked behind an unavailable reviewer or a changed merge strategy.
- These settings close the unchecked-merge risk recorded after `AC-HE-04`. They do not make secrets safe to commit and do not extend the default no-key Harness into desktop, live-key or full Evidence execution.
- This slice changes GitHub repository settings and the current-fact record only. It does not change product code, locked `harness/`, locked Rust Harness or an acceptance contract.

## What changed in the 2026-07-28 hosted Runtime Settings desktop bootstrap slice

The user confirmed `AC-HE-05` after an independent review found that the existing no-key desktop command was a high-value product Judge but depended on one developer machine's WebDriver/tool cache:

- RED was established through the public seam: `gh workflow view 'Runtime Settings Desktop E2E' --repo llbz510/rain` reported that no such workflow existed.
- `.github/workflows/runtime-settings-desktop-e2e.yml` defines a workflow_dispatch-only `windows-2025` environment with read-only repository permission, non-persistent checkout credentials, fixed Node 22.23.1, Rust 1.96.1, LLVM 22.1.7 and `tauri-driver` 2.0.6. It mechanically requires CMake 4+ and downloads Microsoft's `msedgedriver` matching the runner's exact Edge WebView2 Runtime version.
- The environment delegates all behavior to the existing `npm run e2e:runtime-settings` command without `-SkipBuild`; it does not copy schema/DOM/restart assertions, receive Rain secrets, call a model, download Whisper, import video or generate Evidence.
- A failed run may upload only the runner's fixed `rain-runtime-settings-e2e-latest-failure` directory for 7 days. The existing script redacts that directory and removes isolated SQLite before upload; the workflow does not upload a broader temp path.
- Owner is the hosted workflow environment plus the existing public package command. Judge is a real workflow_dispatch run on the target commit. The existing script remains Owner/Judge for product behavior under `AC-LV-14/15/16`.
- GitHub requires a workflow_dispatch file to exist on the default branch before dispatch. Therefore this bootstrap change deliberately records `AC-HE-05` as Gap; the first protected PR/default-Harness merge enables, but does not itself sign, the remote Judge. A later real run must supply RED/GREEN and update this state before the AC becomes Strong.
- No product code, locked `harness/` file, locked Rust Harness or existing Runtime Settings Judge changed.

Bootstrap verification before commit: `npm run e2e:runtime-settings` passed the real local Tauri/schema/add/restart/delete/restart flow without a Key, then `npm run harness:check` passed the control plane, all frontend tests, complementary E2E/ordinary builds and all Rust tests. The final build output is the ordinary production artifact. These local results validate the existing behavior Judge and repository gate, but intentionally do not promote `AC-HE-05` before its first real hosted run.

After the bootstrap merged as `d8fe1b1`, the first dispatch request supplied the next RED before a runner was allocated: GitHub returned HTTP 422 because the `runner` context is unavailable in job-level `env`. The environment contract was kept intact and the two uses of `${{ runner.temp }}` were moved to the actual desktop command step, where GitHub supports that context; the failure-artifact step continues to reference the same exact directory and no broader path.

The runner-context fix passed `git diff --check` and the full local `npm run harness:check`. AC-HE-05 remains Gap until this minimal fix passes the protected PR and a real workflow_dispatch allocates a Hosted Windows runner and completes the desktop command.

Real workflow_dispatch run `30333333637` then allocated the first Hosted Windows runner and supplied an environment RED before JavaScript installation: Rust 1.96.1 and LLVM 22.1.7 installed successfully, but the image already held `cmake.install` 4.4.0 and Chocolatey refused the requested downgrade to 4.1.2. Rain's actual contract is CMake 4+, so the workflow now places the image's standard CMake directory on PATH and mechanically rejects versions below 4.0 instead of manufacturing a patch-version downgrade. The failed run never reached the product desktop Judge and did not change AC-LV-14/15/16 status.

The CMake contract fix passed `git diff --check` and the full local `npm run harness:check`. It must still pass the protected PR and a new real workflow_dispatch before AC-HE-05 can move out of Gap.

Workflow_dispatch run `30334252773` and its independent attempt 2 both passed tool installation, CMake 4.4.0 verification, `npm ci`, both frontend builds and the complete clean Rust/Tauri build, then failed consistently while creating the first WebDriver session. The retained diagnostics reported phase `initial-startup`; the driver log contained only incomplete proxy connections and no secret or SQLite. The environment check had compared `msedgedriver` with the ordinary Edge browser, but Tauri's official `tauri-driver` maps the session to `browserName=webview2`, so the actual native dependency is the Edge WebView2 Runtime. The workflow now discovers that runtime's exact four-part version and downloads the matching driver from Microsoft's driver host before session creation. The repeated RED was not bypassed by increasing timeouts, and the product assertions remain unchanged.

The WebView2 driver-owner fix passed `git diff --check` and the full local `npm run harness:check`. It must still pass the protected PR and a new real workflow_dispatch before AC-HE-05 can become Strong.

Workflow_dispatch run `30336230198` then proved WebView2 Runtime 150.0.4078.65 and the downloaded `msedgedriver` 150.0.4078.65 matched exactly, but the first session still timed out at the same 30-second request boundary. A separate public GitHub Hosted Windows Tauri E2E run `30319727173` completed successfully on 2026-07-28 with Edge/WebView2 150 by setting `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` to an explicit remote-debugging port/feature plus headless-runner GPU and sandbox flags. Rain's Hosted job now owns the same bounded child-process environment. The script timeout and all product assertions remain unchanged so the next real run, not a longer wait, judges this environment fix.

The WebView2 150 hosted-argument fix passed `git diff --check` and the full local `npm run harness:check`. It must still pass the protected PR and a new real workflow_dispatch before AC-HE-05 can become Strong.

Workflow_dispatch run `30337531064` still ended at `initial-startup`: the Tauri build succeeded, then PowerShell aborted the WebDriver session request almost exactly 30 seconds later. Across runs `30334252773`, its attempt 2, `30336230198` and `30337531064`, the fixed client timeout consistently prevented the native driver from either completing a cold session or returning a useful native error. `scripts/run-runtime-settings-e2e.ps1` now bounds WebDriver HTTP calls by `max(30, MaxSeconds)` (90 seconds by default) while leaving every schema/UI/restart assertion and the `MaxSeconds=0` negative-Judge semantics intact. This is an AC-HE-03 diagnostic/portability correction, not a product timeout relaxation.

Local complementary verification passed: `-SkipBuild -MaxSeconds 0` returned nonzero with an `initial-startup` summary and both driver logs, and the injected fake `sk-rain-hosted-timeout-probe` did not appear in any diagnostic file. A following normal `npm run e2e:runtime-settings` passed schema/add/restart/delete/restart and removed the stale failure directory. Final `npm run harness:check` passed the control plane, all frontend tests, both complementary builds and all Rust tests. The remote Hosted run remains the required AC-HE-05 Judge.

Workflow_dispatch run `30339238218` on merge commit `6838ce1` then completed the fixed desktop toolchain, exact WebView2 Runtime/driver 150.0.4078.65 verification, `npm ci`, both frontend builds and a clean Tauri build. With the longer client request boundary, `msedgedriver` returned the actual native RED: `session not created: DevToolsActivePort file doesn't exist`. The 585-byte failure artifact contained only `summary.json` and two empty driver logs; it contained no SQLite, Key or broad temporary directory. Comparison with a same-day successful public Hosted Windows Tauri run showed that wry requires the browser arguments on the Tauri window configuration rather than merely in the inherited process environment.

TDD for that boundary first added a Rust contract test that failed to compile because `read_runtime_settings_webview_args_from_env` did not exist. `src-tauri/src/e2e_config.rs` now returns the explicit WebView2 arguments only for `RAIN_E2E_MODE=1` plus `RAIN_E2E_RUN_MODE=runtime-settings`, and `src-tauri/src/lib.rs` injects that value into each configured window before Tauri starts. Ordinary app startup and non-Runtime-Settings E2E modes remain untouched. Both focused Rust tests passed, and a full local rebuild with the Hosted argument set passed real schema/add/restart/delete/restart without a Key and removed the prior diagnostic. AC-HE-05 remains Gap until this change passes the protected PR Harness and a new target-commit workflow_dispatch.

Final local verification for the context-injection boundary passed file-scoped `rustfmt --check` with `skip_children` (the recorded unrelated whole-crate formatting debt remains), `git diff --check`, `npm run harness:control` and the complete `npm run harness:check`: all frontend tests, E2E/production isolation builds and 98 Rust tests passed, with the contracted live-key skip and real Whisper ignore unchanged. No locked `harness/` or `src-tauri/tests/` file changed.

Protected PR #9 then passed `Clean Windows Harness` run `30340365264` and merged as `9251962`. The target-commit workflow_dispatch Judge `30341065896` used Rust 1.96.1, LLVM 22.1.7, CMake 4.4.0 and an exact Edge WebView2 Runtime/`msedgedriver` 150.0.4078.65 pair. Its single public command completed the real SQLite schema probe, isolated initial state, model add, first restart persistence, model deletion and second restart absence, ending with `Runtime Settings desktop E2E passed: initialize -> add -> restart -> delete -> restart.` The failure-upload step was skipped and the run has zero artifacts. No Rain secret, model connection, paid call, Whisper download, video import or Evidence generation was used. This real GREEN promotes `AC-HE-05` from Gap to Strong for `9251962`; it does not change the manual/non-required scope of the workflow.

The evidence-promotion boundary changes only `PROJECT_STATE.md`, `harness-coverage.md` and the Runtime Settings desktop runbook. Its final `npm run harness:check` passed before independent commit; locked Harness files and production implementation are unchanged in this boundary.

## What changed in the 2026-07-29 deterministic stalled-read Judge slice

The independent Windows Harness exposed an `AC-MM-02` Judge flake on merge commit `f96a3db`: run `30342375378` attempt 1 failed only `cancellation_interrupts_a_stalled_network_read` at its 50 ms timeout, while the same-SHA rerun passed. Sixty serial local replays and 24 concurrent replays did not reproduce a lost cancellation; under concurrent load the test duration nevertheless reached 40 ms, leaving almost no budget for Hosted Windows scheduling and temporary-file cleanup.

- The acceptance contract remains unchanged: a per-model cancellation must wake a permanently stalled response read, remove the partial file and return `Cancelled`. `AC-MM-02` does not define a 50 ms latency target.
- Owner remains `src-tauri/src/whisper_model_download.rs`; Judge remains the adjacent `src-tauri/src/whisper_model_download_tests.rs`. The server fixture still never sends the remaining bytes, so the download task can complete only through cancellation.
- The Judge now uses a five-second deadlock guard instead of treating the complete cancellation, async cleanup and task-teardown path as a 50 ms performance assertion. This does not weaken the behavioral assertion or change production code.
- A mutation check temporarily suppressed the production `Notify` wakeup and made the revised Judge fail at the deadlock guard; restoring the wakeup returned the focused test and all 11 model-download tests to GREEN. The mutation was not retained.
- Boundary scope is deterministic adjudication of the existing stalled-network cancellation behavior. Model-download behavior, acceptance text, coverage strength, locked `harness/`, locked `src-tauri/tests/`, live-key workflows and desktop E2E remain unchanged.

Protected PR #11 then passed `Clean Windows Harness` run `30417407871` on its first attempt and merged as `86a0dad`. The merge commit's independent `master` push run `30417816157` also passed on its first attempt, including the same clean Hosted Windows repository Harness where the prior 50 ms Judge had flaked. This closes the observed adjudication instability for `86a0dad`; it does not create a cancellation-latency guarantee or replace future first-attempt CI observation.

## Current 2026-07-29 online URL import boundary

The user confirmed `AC-LV-17` for a controlled online-URL-to-local-media handoff. This worktree started from clean `master` at `28893fe`; no claim from the older PRD or historical plan was used as implementation truth.

- Owner is `VideoImportController.importUrl` for the traceable record, persistent state, retry and existing Pipeline handoff; `database-videos.ts` for guarded metadata/final-path attachment; Rust `ytdlp` for the subprocess, scheduler lease, progress, cancellation, temporary output and final directory commit; `VideoListPage` remains an input/error adapter.
- The frontend Judge has fifteen tests through the public Controller and real memory database. TDD REDs proved the missing URL interface, failure/cancellation persistence, same-record retry, page entry, progress type, pre-probe traceability, concurrent-ID uniqueness, independent query-secret redaction, scheduler-cancellation classification, initial-record publication failure, download-to-Pipeline Owner handoff cancellation, attached-file handoff failure, both retry Owner paths and cleanup-failure classification before implementation turned them GREEN.
- The Rust adjacent Judge has eight tests through the production deep seam, real local PowerShell child processes and isolated temporary directories. TDD REDs proved missing async interfaces, false success from `.part`, non-cancellable futures, direct-process-only cancellation, swallowed cleanup failure, a missing production scheduler seam and completed-file retry before they turned GREEN. No test accesses a real video site, API Key or model.
- The final production surface is one deep Tauri command, `import_online_video(videoId, sourceUrl)`, covering metadata probe plus download under one `ImportScheduler` lease. It reports the existing `download` progress stage, uses the existing `cancel_import`, returns only a committed local file, and does not call ASR or a paid model.
- Focused verification passed the M20 plus URL Controller set at 24/24, the strict state/Pipeline regression set at 64/64 and all eight Rust `ytdlp` tests, together with TypeScript compilation, file-scoped Rust formatting, control-plane validation and `git diff --check`.
- The complete `npm run harness:check` supplied the required governance RED at locked M20-T01. Its first run passed 452 frontend tests with one explicit live-key skip and failed only because the then-two new commands were not in the exact approved command set. After deepening them into one command, directed M20 replay passes its other eight rules and rejects only `import_online_video`.
- The user then explicitly approved `docs/development/harness-migration-2026-07-29-online-url-import.md`. The locked M20 allowlist changed by exactly one command name and no assertion was removed or generalized. Directed M20 plus URL tests passed 24/24 after the migration.
- Successive independent review AI passes withheld Strong while they found a Controller handoff cancellation gap, direct-process-only termination, swallowed cleanup errors, a missing production scheduler Judge, scheduler-cancellation misclassification, incomplete query-secret redaction, initial/retry publication Owner gaps, cleanup failure misclassification and a `pending → download terminal` state-machine conflict. Every finding received a failing Judge before its production fix. The final persistence design attaches the guarded local path while the record remains `processing/download`, keeps the same AbortController through page publication, then separately publishes `pending` and hands that controller to Pipeline; it therefore closes failures from the active download state without weakening the older strict transition Judge.
- The third independent re-review found no remaining P0/P1 blocking Strong and independently reproduced URL + M20 at 24/24, the strict AC-LV-06/M03 set at 43/43, Rust `ytdlp` at 8/8 and the complete Harness result below. It recorded one non-blocking resilience risk: the SQLite publish CAS and its verification read are separate operations, so an extreme post-commit read failure could leave a recoverable `pending` record without automatically starting Pipeline. A future fault-injection Judge may harden that case; it is not claimed as covered here.
- Final `npm run harness:check` passed the control plane, 79 frontend files / 460 tests with one explicit live-key skip, both complementary builds, and 106 Rust tests with one real-model Whisper case ignored by its existing contract. The final `dist` is the ordinary production artifact.

The only locked-file change is the explicitly approved `import_online_video` entry in `harness/m20-boundaries.test.ts`; no `src-tauri/tests/` file changed. `AC-LV-17` is Strong for the controlled no-network handoff. Real-site compatibility, authenticated sources, playlists, subtitle-first behavior, multi-hour/GB downloads and complete external Evidence remain outside this boundary and must not inherit that status.

Protected [PR #13](https://github.com/llbz510/rain/pull/13) passed its first-attempt `Clean Windows Harness` [run 30422804280](https://github.com/llbz510/rain/actions/runs/30422804280) and merged as `7b73072`. The merge commit's independent `master` push [run 30423233996](https://github.com/llbz510/rain/actions/runs/30423233996) also passed on its first attempt. Both clean Hosted Windows runs installed the declared toolchain and executed the repository Harness without live keys, desktop E2E, real sites, model calls or Evidence mutation. This promotes only the controlled AC-LV-17 boundary recorded above; it does not close the listed external-site or long-duration gaps.

## What changed in the 2026-07-29 product-decision coverage slice

The user approved a control-only boundary to stop Rain's 99 historical product decisions from drifting outside the active acceptance system. This slice does not add product behavior and does not treat the PRD's historical “confirmed” labels as implementation evidence.

- Added Confirmed `AC-HE-06`. Owner is `docs/development/product-decision-coverage.md` plus the mechanical rules in `scripts/control-plane-validator.mjs`; Judge is the adjacent validator fixture suite and the real `npm run harness:control` repository command.
- Added exactly 99 current mappings. Each row cites only root `PRD.md`/`M*.md`, summarizes the current intent, and chooses `Confirmed AC`, `Proposed`, or `Out-of-scope`. Conservative classification leaves a mixed decision Proposed whenever a required slice lacks a Confirmed AC.
- Extended the validator to reject missing, duplicate or out-of-range decision IDs; invalid dispositions; Confirmed mappings to missing or non-Confirmed ACs; empty Proposed/Out-of-scope boundaries; empty intent; and historical or missing product sources.
- Updated the control map, acceptance standard, coverage matrix and Control Plane Harness guide. The old statement that all 99 decisions were unmapped was removed.
- No product source, locked `harness/`, locked `src-tauri/tests/`, Evidence, external workflow, live-key setting or desktop E2E behavior changed.

TDD established RED before implementation: the focused validator suite retained its six prior GREEN cases and failed three new groups because the production validator ignored decision coverage. After implementation, the focused suite passed 9/9 and the real repository control command passed.

Final verification on the complete boundary:

```powershell
npm.cmd run harness:check
```

Result: control plane passed; Vitest passed 79 files / 463 tests with one explicit live-key skip; both E2E and ordinary builds passed their complementary isolation checks; Rust passed 106 tests with one real-model Whisper test ignored by its existing contract. The final `dist` is the ordinary production frontend artifact.

Protected [PR #15](https://github.com/llbz510/rain/pull/15) passed its first-attempt `Clean Windows Harness` [run 30425086468](https://github.com/llbz510/rain/actions/runs/30425086468) and merged as `9ee238c`. The merge commit's independent `master` push [run 30425562385](https://github.com/llbz510/rain/actions/runs/30425562385) also passed on its first attempt. Both runs used clean Hosted Windows checkouts and the repository's single `npm run harness:check` entry; neither used live keys, desktop E2E, real sites, model calls or Evidence mutation. This remote result signs the AC-HE-06 control-plane implementation and 99-row mapping completeness.
It does not sign implementation of the 54 Proposed decision rows.

`DEC-PRD-093` has since been refined and confirmed by `AC-AR-01`; the next architecture-control candidates are `DEC-PRD-092` and `DEC-PRD-099`. They must still be reviewed separately because their old M20 prose is broader than the currently judged slices.

## What changed in the 2026-07-29 database architecture boundary

The user confirmed `AC-AR-01` as the first architecture-control boundary and then explicitly approved the required Harness Migration after TDD exposed a locked shadow contract:

- The current contract is hybrid and narrow: production callers use only `@/models/database`; only `database.ts` loads `@tauri-apps/plugin-sql`; ordinary single-record SQL remains inside frontend database modules; multi-record or multi-table atomic invariants use one dedicated Tauri command and one Rust SQLx transaction. This does not authorize a general Rust DAL.
- `scripts/database-architecture-policy.mjs` and its adjacent test own a reusable negative policy. Independent fixtures prove plugin-import, internal-module and frontend transaction-control violations are rejected; the same policy scans the real production `src/` tree.
- The real-tree RED found `atomicInsertSentences`, an exported function with no production caller whose SQLite path issued frontend `BEGIN/COMMIT/ROLLBACK`. The locked M15 test called only its memory path, while adjacent tests asserted fake SQL ordering.
- Approved migration `docs/development/harness-migration-2026-07-29-database-architecture.md` replaces M15-T18 with the production `saveAsrAtomically` interface. It now proves successful sentence/Video-stage commit and duplicate-ID late-failure rollback. The shadow export, implementation and fake frontend transaction assertions are retired; no Tauri command or M20 allowlist changed.
- `DEC-PRD-093` now maps to `AC-AR-01`, moving current decision counts to 42 Confirmed AC mappings, 53 Proposed and 4 Out-of-scope. `DEC-PRD-092` and `DEC-PRD-099` remain Proposed and outside this boundary.

Focused verification passed before the full gate: policy 6/6; M15 plus frontend import/recovery 19/19; M20/database boundary/policy 17/17; Rust `asr_persistence` 2/2.

Final `npm run harness:check` passed: control plane passed; Vitest passed 80 files / 468 tests with one explicit live-key file/test skipped; both E2E and ordinary builds passed their complementary isolation checks; Rust passed 83 library tests plus every executable Harness group, with the existing real-model Whisper test ignored. The final `dist` is the ordinary production frontend artifact. This local result verifies `AC-AR-01` and the approved M15 migration on the current worktree; it does not sign `DEC-PRD-092`, `DEC-PRD-099`, hosted Clean Windows or a desktop E2E run.

## What changed in the 2026-07-30 production Video deletion boundary

An independent productization audit found that `AC-LV-13` had a real atomic database Owner and strong transaction Judges, but the production Video list only rendered deletion confirmation text and could not complete the user action. The previous coverage row therefore overstated product completeness. The user confirmed this existing-AC closure as the next single boundary; no new product behavior or Harness Migration was authorized.

- `VideoListPage` now loads the target Video's real paragraph and Note counts only when deletion is requested, calls `VideoImportController.cancelAndWait` before the stable public `deleteVideoWithCascade` interface, and publishes the committed removal directly to the production list.
- `VideoImportController` now tracks a set containing every active start/download/Pipeline Promise behind each Video. A repeated `start()` can no longer overwrite the real long-running task. `cancelAndWait` installs a per-Video stopping gate before reusing the existing frontend AbortSignal and desktop `cancel_import` request, blocks start/retry during settlement, waits across overlapping start calls and a download-to-Pipeline ownership handoff, and only then allows deletion. A desktop cancellation error returns immediately without deleting, while a late Stage2 checkpoint write occurs before the atomic cleanup rather than after it. Both URL handoff paths recheck cancellation immediately after media publication and before transferring the AbortController to Pipeline, so a failed deletion cannot leave the retained record behind an abandoned active owner.
- `VideoCard` now owns single-flight preparation, confirmation, cancellation, pending state and visible retryable errors. A count-read failure does not show a false zero-count confirmation; a delete failure keeps both the card and confirmation available for retry; a component without a deletion Owner does not render a silent confirmation action.
- The database and Rust Owners remain unchanged: cross-table cleanup and rollback still belong only to `database-video-deletion.ts` and Rust `video_deletion`. The source media path is not passed to any file-deletion API, so `DEC-PRD-060` preservation remains intact.
- Added `src/__tests__/video-list-deletion.test.tsx`. Through the production page and real memory database it proves real counts, confirmation/cancellation, card removal, public reads showing Video/Node/Sentence/Note/checkpoint removal, active-task settlement, committed-result publication, single-flight preparation, absence of a silent ownerless action, release of a cancelled URL handoff owner when deletion fails, and both preparation and deletion failure behavior.
- TDD established five initial product REDs before the first GREEN: missing confirmation action, missing cancel action, false `0/0` counts, swallowed delete rejection, and swallowed count-read rejection. Independent read-only review then rejected submission with four additional REDs: a late Pipeline orphan, post-commit refresh misreported as deletion failure, an ownerless silent confirmation, and duplicate count requests. A second independent pass rejected the first task-tracking fix because a repeated `start()` overwrote the real long task; strengthening the same late-write Judge reproduced an orphan checkpoint before the tracker changed from one Promise to a per-Video set. A later review found two more REDs: slow desktop cancellation allowed a new Pipeline to start, and cancellation-command rejection was hidden behind a never-ending task. The stopping gate and fail-fast cancellation order turned both GREEN. Final independent review then found that cancellation racing the URL publication handoff could mark Pipeline as the new owner without starting it; when deletion also failed, the retained Video could not be retried. The new handoff-owner RED failed before the post-publication cancellation recheck and is now GREEN. The production deletion Judge has 11 tests.
- Locked `harness/`, locked `src-tauri/tests/`, Rust implementation, Evidence, product-decision dispositions and external integrations were not modified.

Focused verification passed the deletion/import vertical slice at 8 files / 46 tests and the adjacent URL-import Controller at 15/15. Final `npm run harness:check` passed: control plane validation; 81 frontend files / 479 tests with one explicit live-key file/test skipped; complementary E2E and ordinary production builds; and 106 Rust tests with the existing real-model Whisper case ignored. The final `dist` is the ordinary production artifact. The final independent read-only review reported no P0/P1/P2 blocking finding and confirmed the URL handoff Owner is released after cancellation. The available user-path Judge is a production-page jsdom path plus public database and Rust transaction tests, not a desktop deletion E2E; no desktop deletion Evidence was signed.

## What changed in the 2026-07-30 app-owned thumbnail boundary

An independent productization audit compared the remaining product gaps against `DEC-PRD-092`, `DEC-PRD-093` and `DEC-PRD-099` and found a higher-risk production defect: local imports wrote a sibling `*_thumb.jpg` into the user's source directory, the Rust command trusted a frontend-selected output path, and the production card passed a raw Windows path directly to `<img>`. The user confirmed new `AC-LV-18`, the exact M21 Harness Migration and the conservative return of `DEC-PRD-060` to Proposed because app-owned thumbnail deletion/GC remains unowned. This boundary was developed on `codex/app-owned-thumbnails` from merged master `c336f58`.

- Rust `thumbnail_storage` now exclusively owns app-data `thumbnails/<videoId>.jpg`, strict Video ID validation, unique same-directory partial files, ffmpeg extraction and atomic replacement. A successful real-media Judge proves a non-empty final file without changing the source directory; invalid IDs have no filesystem effect; generation failure preserves an existing final and removes ordinary partial output; an OS-level cleanup rejection is returned with the generation error instead of being hidden.
- The Tauri `generate_thumbnail` command no longer accepts an output path. It resolves the real app-data root and adapts only `filePath/videoId/timestamp` into the deep module. The approved locked M21 change is limited to that parameter replacement and persistence of the returned app-owned path; no other locked `harness/` file and no `src-tauri/tests/` file changed.
- `VideoImportController.importLocal` allocates the ID before thumbnail side effects. A module-level process allocation table plus database lookup prevents two Controller instances sharing a database from selecting the same in-flight timestamp ID; conflicts move to the existing UUID generator. The returned thumbnail path is persisted on the same Video.
- Production `VideoCard` now reuses the player's `localMediaUrl`: local absolute paths use the Tauri asset bridge, HTTP(S) stays unchanged, and an empty value renders a stable neutral placeholder. `VideoListPage` exposes thumbnail failure as a non-fatal `role=status` message with the underlying diagnostic while the pending record and Pipeline continue.
- TDD REDs proved the raw card path, empty image, source-sibling output contract, missing Rust Owner, path traversal, failure damage to an existing final, same-millisecond ID reuse, hidden cleanup failure and hidden production warning. The first full Harness attempt also caught an ambiguous control-plane sentence; the second caught the locked M03 timestamp-ID compatibility contract. Three independent read-only reviews then rejected the boundary for a single-Controller ID collision, swallowed cleanup errors, an overbroad M21 edit, a non-visible warning, an apparent AC relaxation and finally a cross-Controller ID race. Each finding received a targeted RED or a control-document correction before the full gate was rerun.
- Product-decision coverage is now 41 Confirmed mappings, 54 Proposed and 4 Out-of-scope. `DEC-PRD-060` remains Proposed: database cascade and source preservation stay Strong, but deletion and orphan GC for the newly app-owned thumbnail are outside this boundary.

Final `npm run harness:check` passed: control plane validation; 83 frontend files / 484 tests with one explicit live-key file/test skipped; complementary E2E and ordinary production builds; and 110 Rust tests with the existing real-model Whisper case ignored. The final `dist` is the ordinary production artifact. File-scoped Rust formatting and `git diff --check` also passed. The final independent read-only review reported no P0/P1/P2 blocking finding after re-running the five-file production/import slice, Rust thumbnail Judges, formatting and control-plane checks. This boundary does not sign online-thumbnail localization, app-thumbnail deletion/GC, pixel-exact card visuals, a real desktop thumbnail E2E or new external Evidence.

## What changed in the 2026-07-30 import-task details boundary

The user confirmed new `AC-LV-19` after an independent productization audit selected the non-ready Video entry over the broader `DEC-PRD-092` and `DEC-PRD-099` architecture proposals. This boundary was developed on `codex/import-task-dialog` from merged master `eaf4490`; no Harness Migration was requested or performed.

- `VideoCard` no longer embeds retry/cancel controls or turns a card click into `Controller.start`. Every `pending/processing/failed/cancelled` card delegates only the selected Video ID to `VideoListPage`.
- New production `ImportTaskDialog` renders the SQLite state, stage and error plus the current session's detailed stage, percent, block position and retrying signal. It provides explicit retry/cancel actions, a real modal surface and progress element; closing it only clears the selected UI target.
- `VideoImportController.acceptProgress` now preserves the full public `ProgressPayload` while retaining the normalized card stage. Production Stage2 now emits real block position, monotonic completion percentage and retrying state from its block/attempt Owner through the existing Pipeline callback into the same `ImportProgress`; a current explicit-retry preflight failure replaces the stale persisted error instead of leaving the old failure visible.
- `App` keeps `VideoListPage` mounted while settings or study is visible, so its Controller and frontend AbortController remain the single lifecycle Owner. A settings-page round-trip Judge proves explicit cancel aborts the original Stage2 signal. After a full process restart, explicit cancel for a persisted `processing` record still calls the desktop `cancel_import` adapter and closes that exact SQLite state; automatic `pending` recovery remains outside this AC.
- The deletion/URL handoff Judge found a real Owner gap: cancellation after downloaded media was published could leave `pending/null` with no Pipeline Owner, and the stale live progress made that record still look active. `closeTrackedDownload` now uses an exact persisted-state transition to close only its own unclaimed `processing/download` or just-published `pending/null` record, clears the live overlay, and leaves later Owner states untouched.
- `src/__tests__/video-import-task-dialog.test.tsx` uses the production page/App, public Controller seam and real memory database. Its eleven tests cover all four non-ready open/close states without side effects, persisted failure detail, active and restart-stale explicit cancel, settings-page Owner continuity, full live progress, ASR substages, background continuation after close, terminal refresh and current preflight failure. `stage2-runner.test.ts` drives two real blocks and an invalid first response; `pipeline-asr.test.ts` proves that production result crosses the public Pipeline callback. Adjacent recovery, URL and deletion Judges were updated to use the new explicit detail action and to retain their prior product guarantees.
- TDD REDs proved auto-start on failed-card click, card-local retry, missing active cancel, discarded block/retry data, collapsed ASR substages, missing completion state, stale preflight error, URL publish/cancel leaving ownerless `pending`, a stale live overlay masking the terminal record, an ineffective restart-stale processing cancel, loss of the real Pipeline Owner across a settings-page round trip, and the complete absence of production Stage2 block/retry progress. The first complete Harness run also found an old unlocked AC-LV-17 assertion that required the newly preserved progress fields to be discarded; that Judge was upgraded to assert the complete payload.
- Product-decision counts remain 41 Confirmed mappings, 54 Proposed and 4 Out-of-scope. `DEC-PRD-062` stays Proposed because AC-LV-19 confirms only its non-ready task entry; list sorting, search, top bar and empty-state behavior still lack a complete Active AC. `DEC-PRD-092` and `DEC-PRD-099` also remain Proposed.
- Locked `harness/`, locked `src-tauri/tests/`, Rust product code, Evidence, live-key behavior and external workflows were not modified.

Final `npm run harness:check` passed: control-plane validation; 84 frontend files / 496 tests with one explicit live-key file/test skipped; complementary E2E and ordinary production builds; and 110 Rust tests with the existing real-model Whisper case ignored. The final `dist` is the ordinary production artifact. TypeScript compilation and `git diff --check` also passed. Final independent Spec review found no functional P0/P1/P2 and confirmed both earlier P1s closed; Standards review recorded the two non-blocking P2 architecture debts in risk 22. This boundary does not sign automatic `pending` restart recovery, a real desktop restart run, exact visual design or new external Evidence. The recorded stale-`pending` risk remains the leading import-task product gap.

## 2026-07-30 authoritative handoff after the import-task merge

This section is the durable handoff for the next AI session. It records verified repository and remote facts, but the next session must still rerun the read-only takeover commands instead of trusting this prose.

- PR [#20](https://github.com/llbz510/rain/pull/20) merged the single AC-LV-19 implementation commit `8160789` into `master` as merge commit `bcec16f`.
- The pull-request `Clean Windows Harness` passed on target commit `8160789` in [run 30516214689](https://github.com/llbz510/rain/actions/runs/30516214689). The independent `master` push replay passed on merge commit `bcec16f` in [run 30516726030](https://github.com/llbz510/rain/actions/runs/30516726030).
- Immediately after the merge, local `master` matched `origin/master`, the worktree was clean, and `npm run harness:control` passed. No product code, locked Harness, Evidence or product-decision disposition changed after PR #20.
- Current product-decision coverage remains exactly 41 Confirmed mappings, 54 Proposed and 4 Out-of-scope. `DEC-PRD-060`, `DEC-PRD-062`, `DEC-PRD-092` and `DEC-PRD-099` remain Proposed.

At the time of this handoff, the highest-benefit next boundary was a recommendation rather than an authorization. The user subsequently confirmed `AC-LV-20`; the implementation and verification section below supersedes this paragraph as the current fact. The recorded proposal was:

- Proposed intent: a persisted `pending / stage=null` Video left by a previous process must remain idle after restart; opening or closing its task detail must remain side-effect free; the detail should expose an explicit “continue import” action; only that action may ask the current app-lifetime `VideoImportController` to start the same Video ID; duplicate clicks must remain single-flight; progress and terminal results must update the same SQLite row; closing the detail must not cancel the newly started background task.
- Why explicit rather than automatic: automatic startup could consume GPU or invoke a paid model without a fresh user action. It would also introduce startup scheduling policy beyond AC-LV-19. Explicit continuation closes the current user dead end while reusing the existing production Controller.
- Proposed Owner: the production `VideoImportController` instance retained for the app lifetime by the current App/VideoListPage composition. `VideoListPage` and `ImportTaskDialog` should only render the persisted fact and forward the explicit intent. Lifting the Controller into a cleaner App-scope module remains separate risk 22 and is outside this proposed boundary.
- Proposed RED: seed a real memory-database `pending/null` Video as if the old process died, mount a fresh production page/controller, and open its detail. The page must remain side-effect free but expose “continue import”; current `bcec16f` fails because `getImportStatus` gives `pending` no action and the dialog renders no button.
- Proposed Judges: first, a production page + public Controller + real memory database Judge proving same-record start, single-flight and refresh. To call cross-process restart recovery Strong, also require a no-key Windows/Tauri restart Judge on the target commit: persist `pending/null`, restart the real app, prove no automatic start, click the explicit action, and prove the same SQLite row leaves `pending` with a visible result. It may deterministically fail closed at runtime preflight; live keys, model calls and public network access must not enter the default Harness.
- Explicitly outside: automatic startup scanning, cross-process task leases/queues, restart-stale `processing` semantics already covered by AC-LV-19, thumbnail deletion/GC, the two risk-22 architecture refactors, DEC-PRD-092 and DEC-PRD-099.

The independent comparison ranked app-owned thumbnail deletion/GC second: it is a real disk-lifecycle gap, but its database/filesystem ordering, cleanup-failure UX, path trust and orphan keep-set need a separate product decision and deeper Rust Judge. Risk 22 is non-blocking architecture debt with no current user-behavior RED. `DEC-PRD-092` and `DEC-PRD-099` have partial M20 controls but no immediate product defect comparable to the stuck `pending` task; neither should be promoted without its own user-approved AC and independent negative policy Judge.

The next session must begin with the repository takeover order in `AGENTS.md`, then verify at least:

```powershell
git status --short
git branch --show-current
git log -5 --oneline
npm run harness:control
```

Expected only as a handoff clue: branch `master`, HEAD contains product merge `bcec16f` plus this later documentation handoff merge, the worktree is clean and the control plane passes. If any command disagrees, follow `docs/development/control-map.md` and the repository result. The next session satisfied the instruction to ask first: the user confirmed the proposed AC-LV-20 contract before the RED, code or control documents changed.

## What changed in the 2026-07-30 explicit pending-import recovery slice

The user confirmed `AC-LV-20` exactly as proposed in the authoritative handoff. Work proceeded on `codex/ac-lv-20-pending-recovery` from clean `master` at `50b7864`; no locked Harness Migration was requested or performed.

- `getImportStatus` now gives only the exact persisted `pending / stage=null` state a `continue` action. `ImportTaskDialog` renders “继续导入” and stable ASCII action seams; `VideoListPage` forwards that explicit intent to the existing app-lifetime `VideoImportController`. List loading, card opening and dialog closing still do not call start.
- Controller ownership did not expand. Its existing per-Video active Controller/task sets provide same-ID single-flight and preserve the background task after dialog close; Pipeline and the database continue updating the original Video. No startup scanner, new queue, cross-process lease, App-scope refactor or progress-contract refactor was added.
- `video-import-task-dialog.test.tsx` seeds a real memory-database `pending/null` record before mounting a fresh production page. Its RED failed only because the dialog had no “继续导入” button. The GREEN proves open/close inactivity, explicit same-record start, duplicate-click single-flight, visible live progress, background continuation, terminal refresh and one remaining Video ID.
- The E2E-only adapter now seeds and reports the same deterministic fixture through public database interfaces in `runtime-settings` mode. `real-e2e-runner-mode.test.tsx` first failed because no fixture/report existed, then proved the automation uses the public insert/read/list seams and reports one `pending/null` row.
- `run-runtime-settings-e2e.ps1` extends its existing isolated SQLite and three real Tauri process launches. The first process persists the pending record; the first restart checks it remains idle twice, opens and closes details without change, double-clicks the explicit action and observes the same row fail closed at missing ASR/structuring roles without a Key or model call; the second restart proves the same visible failed row persists and the database still contains exactly one Video.
- The first desktop attempt exposed a Judge-only null/empty-string mismatch in PowerShell stage comparison. The second proved restart idleness but exposed that WebDriver clicked the inert card container rather than the production title seam. The third reached the dialog and exposed Windows PowerShell 5.1 Chinese-selector decoding. The final Judge uses the exact production title target and stable ASCII `data-testid` action seams; no timeout, product assertion or AC behavior was relaxed.
- Product-decision coverage remains 41 Confirmed mappings, 54 Proposed and 4 Out-of-scope. `DEC-PRD-062` remains Proposed because AC-LV-20 controls only explicit restart recovery; sorting, search, top bar and empty-state behavior still lack one complete Active AC. `DEC-PRD-092` and `DEC-PRD-099` remain Proposed.
- Locked `harness/`, locked `src-tauri/tests/`, Rust product code, Evidence, live-key behavior and external workflows were not modified.

Verification on the complete feature worktree:

- `npm test -- --run src/__tests__/real-e2e-runner-mode.test.tsx src/__tests__/video-import-task-dialog.test.tsx src/__tests__/video-list-page-recovery.test.tsx harness/m17-video-list-component.test.tsx` passed 4 files / 25 tests.
- `npx tsc --noEmit`, PowerShell script parsing, `npm run harness:control` and `git diff --check` passed.
- `npm run e2e:runtime-settings` rebuilt the current E2E frontend and Tauri debug application, then passed real schema, Runtime Settings add/restart/delete/restart and the new pending-import restart recovery path without a Key, model call, public network or retained stale diagnostic.
- Final `npm run harness:check` passed: control-plane validation; 84 frontend files / 497 tests with one explicit live-key test skipped; complementary E2E and ordinary production builds; and 110 Rust tests with the existing real-model Whisper case ignored. The final `dist` is the ordinary production artifact.

## 2026-08-02 authoritative handoff — AC-LV-21 Whisper GPU Auto implementation

This is the authoritative handoff for the GPU-default product slice. Repository commands remain more authoritative than this prose; every new session must rerun the takeover order in `AGENTS.md`.

- User-confirmed contract: local Whisper defaults to `Auto`; a compatible NVIDIA CUDA backend is preferred, a visible CPU fallback is mandatory, and the user can choose `Auto` / `NVIDIA GPU` / `CPU`. Forced GPU never silently falls back. The Rain app must still launch without CUDA.
- Governance: `DEC-007` and Confirmed `AC-LV-21` own the behavior. The design is `docs/superpowers/specs/2026-07-31-whisper-gpu-auto-fallback-design.md`. This intentionally supersedes the old M20 decision94 implementation choice that CPU/GPU stay entirely inside one binding process. No locked `harness/` or `src-tauri/tests/` file, existing AC, Evidence directory, or historical PRD disposition changed.
- Merged state: source commit `d8f2292` from `codex/whisper-gpu-auto-fallback` was merged by PR #23 as `master@83670e7`. PR #23's `Clean Windows Harness` passed in 9m2s before merge. Volatile HEAD/worktree facts are not trusted here; run Git commands.
- Runtime architecture: `src-tauri/src/whisper_backend.rs` is the deep selector. CPU remains in the non-CUDA main process; CUDA runs only in `src-tauri/src/bin/rain-whisper-cuda.rs`. Protocol v1 uses bounded stdin/stdout/stderr, probes device/memory, validates the version, kills the worker on cancellation, and classifies fallback-safe errors separately from model/cancellation failures. The release app ignores the worker environment override; only debug/E2E may use it.
- Product path: Runtime Settings persists `whisper_backend_preference` atomically and invalidates ASR capability evidence when it changes. Import and ASR capability checks snapshot the preference. Settings exposes all three choices; preflight displays actual backend/device or failure reason; import progress displays active GPU/CPU and Auto fallback reason.
- Packaging: `npm run build:whisper-gpu-worker` stages worker + `cublas64_12.dll` + `cublasLt64_12.dll` + `cudart64_12.dll` and a SHA-256 manifest under ignored `src-tauri/target/whisper-gpu-bundle/whisper-backends`. `npm run bundle:gpu` uses `src-tauri/tauri.gpu.conf.json`. Driver-owned `nvcuda.dll` is never bundled. Ordinary/Harness builds remain CUDA-free.
- Local hardware proof: protocol probe reported `NVIDIA GeForce RTX 5060 Ti`, free memory about 15.8 GB of 17.1 GB. The isolated worker transcribed `test-fixtures/asr-capability.mp4` with the installed 3,095,033,483-byte `ggml-large-v3.bin`; output was a non-empty English segment and stderr recorded `using CUDA0 backend`. The worker finished the short smoke in about 5.4 seconds.
- Binary isolation proof: `llvm-objdump -p src-tauri/target/debug/rain.exe` showed no CUDA imports. The worker imports `cublas64_12.dll`, `cudart64_12.dll` and driver `nvcuda.dll`; staged `cublas64_12.dll` supplies the separate `cublasLt64_12.dll` dependency. The staged release payload is about 804 MB, dominated by the roughly 668.7 MB cuBLAS Lt DLL.
- Final verification passed: local `npm run harness:check` completed control-plane validation, 85 frontend files / 506 tests with one explicit live-key test skipped, complementary E2E and ordinary production builds, and Rust tests (98 library tests plus existing integration suites; one real-model Harness case remains intentionally ignored). `npx tsc --noEmit`, release-main compilation, CUDA worker release rebuild/probe/large-v3 short transcription, CPU main build/import inspection, Tauri GPU overlay debug/no-bundle build and `git diff --check` also passed. PR #23 then passed the repository's clean Windows Harness before merge. The final local `dist` is the ordinary CPU-safe production artifact; the staged GPU payload remains ignored build output.
- Remaining release gates: no clean Windows machine without NVIDIA/CUDA has yet installed this target and completed app start + CPU short sample; no formal MSI/NSIS install/upgrade/uninstall replay; no code-signing proof; NVIDIA CUDA runtime redistribution terms have not received a release-owner review. The later M1-S1 confirmation now approves a single GPU-enhanced universal installer and its required disclosure/fallback boundary, but its Confirmed Release AC, implementation and Evidence remain missing. Therefore coverage is Strong behavior + local NVIDIA smoke, with dual-environment Release Evidence still Gap.

A future AI must not revert to `cargo --features cuda-whisper` for the Rain main executable or claim that the old full-pipeline CUDA Evidence proves runtime fallback. It must not mark `AC-LV-21` `Strong + Evidence` until the clean no-NVIDIA and formal target-install evidence above exists.

The next session must start from repository takeover, not from an assumed next feature. It should expect a clean `master` whose history contains product merge `83670e7` plus later docs-only planning commits, then rerun `npm run harness:control`. The highest-value unresolved AC-LV-21 gate remains a clean Windows machine without NVIDIA/CUDA completing install, app start and a CPU short sample; formal MSI/NSIS lifecycle, signing and CUDA redistribution review remain separate release-owner decisions. Later sections supersede this handoff's old distribution-decision gap: the user has chosen one GPU-enhanced universal installer, but M1-S2 must still confirm its Release AC before external or product-changing work starts.


## 2026-08-02 agent-first status review and development plan

The user requested a repository-state review and a cross-session development plan aligned with agent-first Harness Engineering. This is a control/documentation slice only; it does not authorize or implement new product behavior.

- Repository takeover and current verification were repeated rather than inferred from prior prose. Local `master` and `origin/master` both resolve to `7e278a68a300018be42c7488d9be4473d9d0ff2e`; the worktree was clean before this documentation slice; `npm run harness:control` and the complete local `npm run harness:check` passed. The current HEAD's independent `Clean Windows Harness` push run `30739528593` also passed.
- The review confirms 40 Confirmed ACs and the mechanically controlled historical disposition of 41 Confirmed AC mappings, 54 Proposed decisions and 4 Out-of-scope decisions. These remain governance counts, not a completion score. No AC status, product-decision disposition, coverage level or locked Judge changed.
- External primary-source findings are recorded in `docs/research/2026-08-02-agent-first-harness-principles.md`. The note separates source facts F1–F8 from Rain-specific inferences R1–R9 and cites OpenAI Harness Engineering, Anthropic's long-running application Harness article and the pinned `mewamew/huaizi-de-cows` repository practice. Its governance status is Proposed research, so it cannot override Rain's Active control plane.
- `docs/development/agent-first-development-plan.md` is now the Active cross-session execution plan. It makes one AC/one independently judged gap the default Slice, requires a Slice Contract before code, preserves the existing locked Harness Migration rule, and makes a fresh-context, read-only independent AI review a hard gate after every implemented Slice. The reviewer must examine Spec/AC first and Standards second; actionable current-slice P0/P1/P2 findings require repair, re-verification and re-review.
- The prioritized queue starts with evidence truth rather than broad feature expansion. P0 is a target-commit Hosted Runtime Settings replay because the last successful manual run is still `9251962`/`30341065896`, while `AC-LV-20` later expanded the same desktop script and current HEAD has no Hosted replay. P1 is the already-recorded `AC-LV-21` clean no-NVIDIA/CUDA install + CPU short-sample Evidence Gap. P2 proposes a user decision for app-owned thumbnail deletion/GC; P3 separates the two risk-22 architecture debts; P4 proposes completing list sort/search/empty-state behavior; P5 requires the user to choose one larger product line rather than spreading work across all 54 Proposed rows.
- No workflow was dispatched, no live key/model/external-site call was made, no Evidence was generated or rewritten, and no cache or ignored runtime artifact was deleted. P0 still requires explicit authorization before creating external workflow state; Proposed P2–P5 behavior still requires user confirmation before RED or implementation.
- The status review also observed minor non-blocking documentation drift not currently checked by `harness:control`: `acceptance-standard.md`, `harness-coverage.md` and `module-map.md` headers still show July update dates, and some module-map hotspot line counts are older than the current tree. The plan records doc-gardening as a low-cost Harness improvement, but this slice does not rewrite those facts or treat line count as an architecture defect.

Verification for this documentation slice before independent review: the pre-edit complete `npm run harness:check` passed control-plane validation, all frontend tests, complementary E2E/ordinary builds and Rust tests; the final `dist` is the ordinary production artifact. After documentation changes, `npm run harness:control` and `git diff --check` must pass. The mandatory independent read-only review result and any resulting corrections are recorded before handoff.

The first independent read-only review used a fresh context and baseline `7e278a68a300018be42c7488d9be4473d9d0ff2e`, then checked Spec and Standards separately. Its initial verdict was `FAIL`. It found no P0 and no product-semantic overreach, but found one substantive P1: P0 and the recommended next action called `7e278a6` the continuing “current HEAD”, so a later session could replay an obsolete commit or try to dispatch an unusable SHA instead of proving the execution-time target. It also found the expected delivery P1 that this state file had not yet persisted the review result, and earlier identified non-blocking discoverability debt because the new Active plan was absent from the control map/new-session list. The plan now requires resolving the full execution-time target SHA, verifying a dispatchable ref points to it, and checking the run `headSha`; the control map and new-session source list now include the Active plan, and `docs/research/` has an explicit Proposed-only responsibility. These corrections must pass control-plane/whitespace checks and the same independent reviewer must re-review the final diff before this slice can claim PASS.

The same independent reviewer then re-ran `npm run harness:control` and `git diff --check 7e278a68a300018be42c7488d9be4473d9d0ff2e` against the corrected files and returned final verdict `PASS`: all reported items were closed, no P0/P1/P2 remained, and no product-semantic overreach or locked Harness change was found. This docs-only review did not dispatch P0, create the missing `AC-LV-21` Release Evidence, run live models or rerun the full Harness after documentation edits; those boundaries remain explicit. The complete Harness GREEN recorded above occurred before the documentation edits, while the post-edit control-plane and whitespace checks passed.


## 2026-08-02 complete project delivery roadmap

After the reviewed agent-first control slice was committed as `495b5e5` on `codex/agent-first-development-plan`, the user clarified that the required artifact is a complete plan through actual product landing, not only a next-priority queue. `docs/development/rain-project-delivery-plan.md` now provides that program-level roadmap while the existing agent-first plan remains the per-session execution protocol.

- “Landing” is defined as confirmed release scope, Strong launch ACs, current real Evidence, formal CPU/GPU installation proof, schema/data/file lifecycle, signed and hashed artifacts, license review, Release Candidate gates, public download verification, rollback and first production observation. Code completion alone is explicitly insufficient.
- The roadmap separates a recommended Core Release from high-risk post-release candidates, but does not make the product decision. M1 requires the user to mark each candidate cluster Launch, Post-release or Out-of-scope and confirm Release ACs before implementation.
- M0–M11 cover control baseline, scope freeze, evidence replay, release engineering, data/file and architecture boundaries, list UX, study UX, model/language/translation, assistant/Vision/tree editing, visual/accessibility/performance, RC and formal release/post-release handling.
- All 54 currently Proposed historical decisions are routed exactly once across seven work clusters: advanced tree editing 13, assistant/Vision 3, catalog/layout/subtitle/shortcuts 12, ASR/language/translation 4, list/derived files 6, visual system 13 and architecture boundaries 3. The routing is a completeness check, not an AC promotion.
- The critical path puts M1 scope/Release AC before current target-commit desktop replay and `AC-LV-21` dual-environment release evidence, with feature expansion later. Translation, Vision and advanced tree editing cannot start until Release Scope is confirmed; the recommended first six work packages are M1 scope, Release AC, M2 Hosted replay, Evidence freshness, release artifact contract and clean no-NVIDIA CPU Evidence. Each work package must still be decomposed into one-AC/one-gap Slices before execution.
- No product source, AC, coverage level, locked `harness/`, locked `src-tauri/tests/`, workflow, Evidence or runtime code changed in this roadmap slice. No external workflow, model, video run or installer action was started.

The complete roadmap must pass `npm run harness:control`, `git diff --check` and an independent fresh-context read-only Spec/Standards review before its second commit. The independent review result, findings and closure are appended here before handoff.

The first independent read-only roadmap review used baseline `495b5e56dab61b3eb4694471347406592868579d` and returned `FAIL` with three P1 findings and one P2. First, the Active per-session plan said Hosted replay was the next unique action while the complete roadmap correctly put M1 scope/Release AC first. Second, a launch choice for real-site URL import had no executable Owner/Judge/Evidence work package. Third, `M#-S#` labels could be mistaken for executable one-AC Slices even when they combined installation lifecycle, signing, SBOM, licensing and artifact hygiene. Fourth, the sample RC Evidence command used a PowerShell-invalid angle-bracket placeholder. The correction makes the complete roadmap the only ordering authority, sets M1-S1 as the next unique action, defines all `M#-S#` entries as work packages that must be decomposed through the Slice Contract, explicitly splits the M3-S5 governance candidates, adds conditional M5-S6 real-site Evidence and replaces the RC command with an executable variable form. The 54-decision routing itself passed the reviewer’s mechanical completeness check; no product decision was promoted.

The same independent reviewer then examined the corrected working tree read-only and returned final verdict `PASS`: P0/P1/P2 were all empty; all four initial findings were closed; the Proposed source and route table both contained 54 unique IDs with no missing, extra or duplicate entry; and no AC, coverage level, locked Harness or product decision changed. The reviewer independently ran `npm run harness:control` and `git diff --check`; both passed, with only normal line-ending warnings. It did not rerun the complete Harness, Hosted desktop, dual-environment installation, signing/licensing, real-video or external-site Evidence, and the roadmap continues to treat those as future gates rather than completed facts. This final PASS is the required independent review for the roadmap documentation slice.


## 2026-08-02 M1-S1 Core Release scope proposal

The user authorized execution of the complete delivery roadmap. Work began with the required takeover on branch `codex/m1-release-scope-contract` from committed roadmap baseline `c2204c0`; the worktree was clean and `npm run harness:control` passed before this slice.

- Slice: M1-S1 Release Scope Contract. This is a product-scope proposal, not an implementation or AC-confirmation slice.
- Observable result: `docs/development/release-scope-contract.md` gives every current Proposed decision one recommended release destination and exposes the exact choices that require user confirmation.
- In scope: all current Confirmed ACs as the Launch baseline; 54 current Proposed rows classified individually; the existing four Out-of-scope rows recorded unchanged; explicit first-release non-promises; and the M1-S2 Release AC queue.
- Out of scope: confirming new ACs, changing `product-decision-coverage.md`, product code, locked Harness, external workflow state, model/video calls, installers and Evidence.
- Owner: the Proposed release scope document. After user confirmation, M1-S2 and the active product-decision/acceptance control plane must own the resulting semantics.
- Judge: compare the 54 Proposed source rows mechanically with the Launch/Post-release table rows; require one row per ID and counts 31 Launch / 23 Post-release / 0 new Out-of-scope; run `harness:control` and whitespace checks; then obtain independent read-only Spec/Standards review and explicit user confirmation.
- Recommended Core Release: existing Confirmed behavior plus video-list/derived-file completion, learning-page base interaction, a minimum visual/accessibility system and the three architecture boundaries. Cloud ASR, translation, Vision, advanced tree editing, advanced diagram gestures and real-site compatibility are recommended Post-release. The controlled `AC-LV-17` URL-to-local-media interface remains in the Launch baseline, but Release Notes must not promise any real site.
- The scope proposal does not promote any Proposed row, lower any AC, alter coverage or authorize M1-S2. User confirmation remains the blocking product gate.

The independent review result, any findings and their closure are appended here before the proposal commit. The next unique action after that commit remains user confirmation of the M1-S1 table; M1-S2 cannot begin from silence or inference.

The first independent read-only M1-S1 review used baseline `c2204c0daf7213e3fa2f3af4229e3b1e89b89d0f` and returned `FAIL` with five P1 findings and one P2. The 54-row mapping itself passed at 31 Launch / 23 Post-release with no missing, extra or duplicate ID; the existing four Out-of-scope rows, mixed-decision boundaries, Confirmed AC baseline and controlled-URL/no-real-site distinction were also correct. The blocking findings were: three Launch architecture decisions were not explicit in the M1-S2 queue; the approximately 804 MB GPU payload delivery UX was hidden inside a generic artifact relation; risk 22's two required architecture debts had no Launch/Post-release destination; the control-map reading order put the Proposed contract before the Active AC/coverage/module sources required by `AGENTS.md`; and this state record did not yet persist the verdict. The P2 was the stale control-map update date. Corrections make the three architecture contracts, GPU distribution decision and both risk 22 items explicit independent M1-S2 inputs; recommend CPU/GPU dual installers while preserving user alternatives; classify both risk 22 items as Launch behavior-preserving work; restore the required source order; add the Proposed contract to the source list; and update the control-map date. These changes require the same reviewer to re-run Spec/Standards review before commit.

The second independent review returned `FAIL` with one remaining P1 and no P0/P2. It confirmed that the first review's GPU, risk 22, source-order, update-date and state-persistence findings were closed, and that the 54-row mapping and all protected boundaries remained correct. The remaining defect was an `or` in the M1-S2 queue that allowed `DEC-PRD-092/096/099` to use an independent governance contract instead of a Confirmed AC, contradicting the release-scope and roadmap exit rules. The queue now requires a Confirmed AC for each of the three decisions; governance records and negative policies may be Judges but cannot replace product confirmation. A final read-only confirmation is required before commit.

The third and final independent read-only confirmation returned `PASS` with P0/P1/P2 all empty. It confirmed that `DEC-PRD-092/096/099` now each require a Confirmed AC, while governance records and negative policies are only Judges; the scope mapping remains exactly 54 unique Proposed rows split into 31 Launch and 23 Post-release; and no AC, coverage level, product disposition, source, Evidence or locked Harness changed. The reviewer rechecked `npm run harness:control` and both tracked/new-file whitespace checks; all passed with only normal line-ending warnings. Full Harness, Hosted workflow, models, video, installers and Evidence were not run because M1-S1 changes only Proposed control documentation. This PASS completes the independent-review gate for the proposal commit, not the product-confirmation gate. The next unique action is explicit user confirmation or amendment of the scope table.


## 2026-08-02 M1-S1 user confirmation and installer amendment

The user explicitly accepted the complete M1-S1 scope and then confirmed an amendment to publish only one installer. `docs/development/release-scope-contract.md` is therefore Active rather than Proposed: 31 current Proposed decisions are routed to Launch, 23 to Post-release, no new decision is Out-of-scope, and the existing four Out-of-scope dispositions remain unchanged. This is a release-scope classification only. All 31 Launch rows remain Proposed until M1-S2 or later atomic Slices give them Confirmed ACs; no acceptance criterion, product-decision disposition, coverage level, source, Evidence or locked Harness changed.

“Only the GPU version” has one precise supported meaning: Rain publicly distributes a single **GPU-enhanced universal installer** containing the CPU-safe main executable, CPU adapter and isolated CUDA worker/runtime. There is no second public CPU installer. On compatible NVIDIA systems `Auto` prefers CUDA; without a compatible NVIDIA GPU/driver/runtime the same installed application must launch, visibly explain the fallback and use CPU. Forced CPU and forced GPU retain the existing `AC-LV-21` semantics. Removing the CPU path, loading CUDA in the Rain main executable, or making CUDA a default ordinary/Harness build feature remains forbidden. The existing ordinary CPU-safe build remains an internal CI/release-evidence artifact rather than a public product download. The installer/release page must disclose the approximately 804 MB payload, hardware requirements, fallback, failures and retry behavior.

This amendment is compatible with the current architecture: `npm run bundle:gpu` overlays the isolated worker and redistributable CUDA runtime onto the CPU-safe base application, while `AC-LV-21` already requires no-NVIDIA launch and CPU fallback. It supersedes only the M1-S1 proposal's earlier recommendation to publish separate CPU and GPU installers. It does not prove the package, complete the no-NVIDIA/NVIDIA installation Evidence, approve CUDA redistribution, or authorize product implementation.

Files synchronized in this confirmation slice are `release-scope-contract.md`, `control-map.md`, `rain-project-delivery-plan.md`, `agent-first-development-plan.md` and this state file. The next unique action is M1-S2: draft the per-row Release AC matrix and obtain explicit user confirmation. Until M1-S2 passes independent review and user confirmation, do not trigger Hosted workflow state, start product implementation, run release installation, or claim M1 complete.

The confirmation slice must pass `npm run harness:control`, `git diff --check` and a fresh independent read-only Spec/Standards review. The reviewer must verify that all Active documents agree on the single universal installer, retain CPU-safe fallback, leave the 54-row 31/23 mapping and all current dispositions untouched, and name M1-S2 as the unique next action. Findings, closure and final verdict are appended here before commit.

The first independent read-only confirmation review used baseline `25c9c49` and initially returned `FAIL`: P0 was empty, and one repeated P1 class—confirmed-scope drift—remained across five roadmap/state areas. M7 still reopened whether cloud ASR belonged in the first release; M8 and the aggregate 54-decision table still described confirmed Post-release routes as defaults that could be silently promoted; the M1-S1 Owner contradicted the Active scope contract; the top current-status paragraph still called the approximately 804 MB distribution UX an undecided product choice; and M6 still conditionally described translation while mixing Post-release fold/scrub gestures into the Core path. No product code, AC, coverage, disposition or Harness defect was reported.

Corrections close that P1 class without changing the confirmed 31/23 routing. The roadmap now separates local Whisper Launch gaps from Post-release cloud ASR/language/translation, records M8 Proposed expansions as Post-release while retaining the existing Confirmed text assistant baseline, gives every aggregate cluster its exact confirmed route, makes the Active scope contract the M1-S1 Owner, and splits M6 Launch subtitle/diagram behavior from Post-release translation/fold/scrub behavior. The current-status paragraph now says the single universal installer boundary is chosen while its Release AC, implementation, lifecycle/signing and Evidence remain missing.

The independent Spec and Standards axes then both completed against the corrected stable diff and returned `PASS`, with P0/P1/P2 all empty. Spec independently confirmed exactly 54 unique routes split 31 Launch / 23 Post-release, the existing four Out-of-scope rows unchanged, the CPU-safe main/adapter plus isolated CUDA worker/runtime package boundary, Auto visible fallback and Forced CPU/GPU semantics, no AC/implementation/Evidence promotion, and M1-S2 as the only next action. Standards confirmed that only the five allowed control documents changed and no acceptance standard, coverage matrix, product disposition, product source, locked Harness, workflow or Evidence changed. Both axes independently reported `npm run harness:control` and `git diff --check 25c9c49` passing. The parent review coordinator exhausted its service quota after both axis reports were already complete; the two preserved read-only axis results constitute the required independent Spec + Standards verdict and no review conclusion was inferred from the coordinator error.

Full `harness:check`, Hosted workflow, models, video, installers and Evidence were not run because this slice only persists the user's scope confirmation and synchronizes control documentation. This PASS completes M1-S1, not M1: M1-S2 Release AC confirmation remains the next unique action.


## 2026-08-02 M1-S2 Proposed Release AC matrix

After the user asked to continue the complete delivery roadmap, work moved to branch `codex/m1-release-ac-contract` from committed M1-S1 baseline `c2eb4c4`. The takeover worktree was clean and `npm run harness:control` passed before edits.

- Slice: M1-S2 Release AC proposal. This is a user-confirmation contract, not formal AC migration or implementation.
- Observable result: `docs/development/release-acceptance-contract.md` gives every Launch decision and release gate a Proposed AC, Owner, Judge/Evidence tier and explicit out-of-scope boundary.
- Proposed registry: 20 `AC-RL-*` release/lifecycle ACs, 7 `AC-VL-*` video-list ACs, 7 `AC-SU-*` study ACs, 6 `AC-UX-*` visual/accessibility ACs, 5 `AC-PF-*` performance/reliability ACs and 5 `AC-AR-*` architecture ACs: 50 unique candidate ACs in total, each with an explicit required Evidence tier.
- Product details requiring confirmation: first public version `0.1.0`; Windows x64 only; one GitHub Releases NSIS `.exe`; the already-confirmed CPU-safe main plus isolated CUDA worker/runtime composition; default uninstall preserves app data/models and never deletes source video; initial upgrade coverage starts from a frozen `c2eb4c4` data/settings fixture without pretending an old formal installer exists; P0/P1 and scope/data/security/Evidence-impacting P2 findings block RC.
- Traceability: all 31 M1-S1 Launch decisions appear once in the decision matrix; `DEC-PRD-060` intentionally maps to separate known-thumbnail deletion and orphan-GC ACs; `DEC-PRD-092/096/099` each map to a distinct architecture AC; risk 22a and 22b remain separate.
- Protected boundaries: all 23 Post-release decisions and four current Out-of-scope decisions remain outside the matrix. The proposal does not change `acceptance-standard.md`, `product-decision-coverage.md`, `harness-coverage.md`, product source, locked Harness, workflow or Evidence.
- Next unique action after the independently reviewed proposal commit is explicit user confirmation or amendment of `release-acceptance-contract.md`. Even a whole-document confirmation only authorizes a later formal AC-control migration Slice; it does not authorize product implementation or M2.

The M1-S2 proposal must pass `npm run harness:control`, `git diff --check`, mechanical AC/decision/release-queue completeness checks and an independent read-only Spec/Standards review before commit. Findings, closure and final verdict are appended here before handoff. Full Harness, Hosted workflow, installers, signing, models, GPU/video runs and Evidence are not required for this docs-only proposal and must be reported as not run.

The first independent two-axis review used baseline `c2eb4c4` and returned `FAIL`. Spec reported three P1 findings: all candidates lacked an explicit Required Evidence tier; the single-package route omitted the required download-page/installer disclosure of fallback, Forced modes and failure/retry; and `AC-AR-06` did not freeze the legal `download/asr/stage2/merging/terminal` contract. It also reported blocking P2 atomicity/detail findings: defect blocking and rollback were combined, while the shortcut AC did not enumerate the approved key map. Standards independently reported P1 atomicity for the combined release-policy/rollback AC and the four unrelated performance budgets, the same P1 disclosure coverage defect, and the expected delivery P2 that this state record did not yet persist review findings. Both axes confirmed that the 45-ID/31-decision mechanical mapping, protected files and next-action boundary were otherwise correct.

Corrections split rollback into `AC-RL-19` and the four response budgets into `AC-PF-01..04`, leaving soak reliability as `AC-PF-05`; the registry is now 49 atomic candidates. Section 4.5 gives every candidate an explicit Required Evidence tier and graduation artifact. `AC-RL-18` now controls download-page and installer disclosure as well as truthful Release Notes, and the completeness row routes the package boundary through both `AC-RL-02` and `AC-RL-18`. `AC-AR-06` now freezes five discriminants, stage-specific fields, legal ranges, monotonicity, terminal behavior, local-download skipping and checkpoint retry. `AC-SU-07` now lists every Core key and explicitly disables `Del/Backspace` because advanced tree deletion is Post-release. The initial upgrade proposal now uses a frozen `c2eb4c4` data/settings fixture without claiming a nonexistent old formal installer.

Post-correction local checks passed: `npm run harness:control`; `git diff --check c2eb4c4`; and the mechanical matrix audit reported 49 unique candidates split 19 RL / 7 VL / 7 SU / 6 UX / 5 PF / 5 AR, 49 unique Evidence-tier rows with no missing/extra ID, 31 unique Launch decisions with no missing/extra ID, no unknown/unreferenced candidate and 13 release-queue rows. The corrected stable diff must return to the same independent Spec and Standards reviewers before final verdict or commit.

The second independent review still returned `FAIL`, but found no P0. Spec reported one slice-blocking P2: `AC-SU-07` named all keys but did not freeze the exact `1/2/3` layout mapping or the seek/selection/preview and target-input focus side effects for `N/P` and `Tab`. Standards reported two P1 classes: release/performance runners and the independent download verifier were incorrectly listed as production Owners, and `AC-PF-01..03/05` did not define the exact gating statistic or a finite, deterministic resource-growth Judge. Standards also requested an atomicity decision because `AC-RL-18` combined download/installer disclosure with Release Notes. Both reviewers confirmed that their first-round findings were otherwise closed and that protected files, the 31 Launch routes, Evidence-tier coverage and next-action boundary remained intact.

The second correction separates producers from Judges: release/performance/reliability runners and the download verifier now appear only in Judge/Evidence cells. `AC-PF-01..03` each gate on p95 across 10 valid measurements, `AC-PF-04` retains its explicit 100-event p95, and `AC-PF-05` freezes a five-minute warm baseline plus a 25-minute loop with zero per-cycle listener/worker/process-count growth, working-set slope at most 1 MiB/min, final working set at most baseline +50 MiB and no exit residue. `AC-SU-07` now freezes each `1/2/3` layout and the `N/P` seek/selection/preview plus `Tab` target-input-focus side effects. Download/installer disclosure remains `AC-RL-18`; truthful Release Notes is now the separate `AC-RL-20`. This raises the registry to 50 atomic candidates: 20 RL / 7 VL / 7 SU / 6 UX / 5 PF / 5 AR, with a separate Evidence-tier row for every candidate. These changes are still Proposed and require the same independent reviewers to return a clean verdict before commit.

Post-second-correction checks passed: `npm run harness:control`; `git diff --check c2eb4c4`; and the mechanical audit reported 50 unique candidates split 20 RL / 7 VL / 7 SU / 6 UX / 5 PF / 5 AR, 50 unique Evidence-tier rows with no missing/extra ID, 31 unique Launch decisions with no duplicates and all 13 release-queue rows. `AC-AR-01` is the only AC reference outside this Proposed registry and is an existing Confirmed architecture AC, not a missing candidate. The stable five-file diff now returns to the same independent Spec and Standards reviewers.

The third independent review returned `PASS` on both axes with P0/P1/P2 all empty. Spec confirmed the exact shortcut mapping and side effects, atomic `AC-RL-18`/`AC-RL-20` split, Owner/Judge separation, deterministic `AC-PF-01..05` gates, 50/50 candidate and Evidence-tier integrity, 31/31 Launch traceability, 13/13 release-queue coverage, separate 092/096/099 and risk 22a/22b routes, and no Post-release/Out-of-scope leakage. Standards independently confirmed every second-round finding closed, no new baseline smell, the same matrix counts, complete review-history recording, and only the five allowed control documents staged. Both reviewers reran `npm run harness:control` and `git diff --cached --check c2eb4c4` successfully and confirmed zero commits after the baseline during review. Full Harness, Hosted desktop, installer, signing, GPU/model/video and formal Release Evidence remain intentionally not run for this docs-only Proposed contract. The only next action after commit is explicit user confirmation or AC-ID revision; confirmation authorizes a later formal AC migration Slice only, not product implementation or M2.


## 2026-08-02 M1-S2 user confirmation and formal AC control migration

The user explicitly replied “确认” after the independently reviewed M1-S2 proposal commit `26a4b2c`. That confirmation accepts all six first-release details, 50 ACs, 31 Launch mappings, separate risk 22a/22b contracts and the rule that the next Slice only migrates the formal control plane. Work therefore moved to `codex/m1-release-ac-migration`; takeover was clean and `npm run harness:control` passed before edits.

- Slice: docs-only Harness Migration for `AC-RL-01..20`, `AC-VL-01..07`, `AC-SU-01..07`, `AC-UX-01..06`, `AC-PF-01..05` and `AC-AR-02..06`.
- Observable result: `acceptance-standard.md` contains all 50 as unique Confirmed contracts with Owner/Judge/Evidence tier/out-of-scope; `harness-coverage.md` contains one conservative Partial/Gap row per AC; 31 Launch decisions now reference Confirmed ACs.
- Decision result: the 99-row map is now 72 Confirmed AC / 23 Post-release Proposed / 4 Out-of-scope. The 23 Post-release IDs and all four existing Out-of-scope rows are unchanged.
- Truth boundary: Confirmed freezes product semantics only. This Slice does not implement a product Gap, upgrade an Evidence tier, run an installer, dispatch a workflow, approve CUDA licensing/signing or generate Evidence.
- Harness Migration: `harness-migration-2026-08-02-release-ac-control.md` records the old Proposed boundary, replacement control sources, exact no-test-change scope and no-shadow retirement. No file under `harness/`, `src-tauri/tests/`, product source, workflow or Evidence is modified.
- Module ownership: `module-map.md` now routes each AC group to the intended deep module/governance seam, including separate thumbnail lifecycle, App-scope import Owner and discriminated progress contracts; this mapping does not require those modules to exist before their implementation Slice.
- Roadmap result: M1 can exit only after this migration passes mechanical checks and independent Spec/Standards review. M2-S1 Hosted Runtime Settings replay then becomes the unique next action.

Required pre-commit checks are `npm run harness:control`, `git diff --check`, mechanical 50-AC/50-coverage/31-Launch/99-disposition audits and independent read-only Spec plus Standards review against baseline `26a4b2c`. Findings, closure and final verdict must be appended here before commit. Full Harness, Hosted desktop, installer, GPU/model/video, signing/legal and Release Evidence are intentionally not run for this docs-only migration and must remain visible as future gates.

The first control-plane run correctly failed because the new `AC-RL-02` coverage row named a nonexistent `build-whisper-gpu-worker.ps1`; the real repository entry is `scripts/build-whisper-cuda-worker.ps1`. Correcting the Judge reference closed the defect without changing the AC. Post-correction checks pass: `npm run harness:control`; `git diff --check 26a4b2c`; 90/90 unique acceptance IDs all Confirmed; exact semantic equality for all 50 migrated contract/Owner/Judge/tier/out-of-scope blocks; 50/50 new coverage rows split conservatively into 30 Partial and 20 Gap; 99/99 unique decision rows at 72 Confirmed / 23 Proposed / 4 Out-of-scope; exactly the 31 Active Launch rows changed from the baseline and all are Confirmed; no Post-release row changed; all proposal target ACs appear in the corresponding decision control; all edited Markdown tables have consistent column counts; and the 11-file write set contains no product source, locked Harness, workflow or Evidence path.

The first independent Standards review returned `FAIL` with two P1 classes and no other baseline smell. `DEC-PRD-012/013/053` were labelled fully Confirmed even though the canonical contracts had not explicitly reconciled the old decision wording: `AC-SU-02` omitted the approximately 200 ms horizontal slide, `AC-SU-01` omitted the catalog edge fade, and `AC-SU-07` disabled `Del/Backspace` while the old M14 decision still included a delete shortcut. The review also correctly required this state record to persist the verdict and closure before the roadmap could leave `In review`.

The correction makes the accepted product intent explicit rather than silently claiming coverage. `AC-SU-01` now owns the edge-fade behavior in its contract, Judge and Evidence artifact; `AC-SU-02` owns the approximately 200 ms horizontal slide and its DOM/duration/reduced-motion Judge. For `DEC-PRD-053`, the user-confirmed, more-specific M1-S2 contract is recorded as a Core product revision that supersedes the old M14 delete shortcut: Core disables `Del/Backspace`, while node deletion/editing remains Post-release. The release contract, canonical acceptance blocks, coverage notes, decision disposition, scope table and migration record all use the same boundary. These corrections require fresh Spec and Standards review of the unified staged diff before the migration can be marked complete or committed.

The corrected unified staged diff then passed both independent review axes with P0/P1/P2 all empty. Spec confirmed 50 unique canonical ACs and 50 unique coverage rows at 30 Partial / 20 Gap, exactly 31 Launch promotions, unchanged 23 Post-release and four Out-of-scope rows, explicit reconciliation of `DEC-PRD-012/013/053`, separate risk 22a/22b and 092/096/099 contracts, and no product/locked-Harness/workflow/Evidence change. Standards confirmed the first-round findings closed, the same conservative coverage and 11-file atomic control migration, no forbidden path and no new baseline smell. Both axes reported `npm run harness:control` and `git diff --cached --check 26a4b2c` passing.

This dual PASS completes M1-S2 and makes M2-S1 the unique next action. Full `harness:check`, Hosted Runtime Settings replay, installer/GPU/model/video execution, signing/legal approval and Release Evidence were intentionally not run for this docs-only migration; every such missing runtime gate remains Partial/Gap in `harness-coverage.md` rather than being inferred from confirmation.

The final conclusion-only status sync received a fresh short review because it changed the staged diff. Standards remained `PASS` with P0/P1/P2 empty. Spec returned `FAIL` with one P1: the roadmap milestone summary still called M1 `In progress — M1-S1 confirmed`, contradicting its detailed M1-S2 Complete state and M2-S1 Next ordering. The summary row is now `Complete — M1-S1 + M1-S2 confirmed and reviewed`; this is a stale-status correction only. Final Spec and Standards rechecks of that corrected staged diff both returned `PASS` with P0/P1/P2 empty, confirmed M2-S1 as the unique explicit-dispatch next action, and found no new scope drift, forbidden path, fact conflict or baseline smell.

## 2026-08-02 M2-S1 prerequisite — Evidence validator Hosted timeout migration

M2-S1 could not be dispatched directly from local feature commit `9a1e62b` because the Active plan requires a dispatchable `master` ref whose full SHA matches the run `headSha`. The branch first passed local `npm run harness:check`, was pushed, and opened as PR #25. Its required `Clean Windows Harness` run `30752033590` returned a real RED before merge: control-plane validation passed, but `scripts/validate-evidence.test.ts` timed out its first positive PowerShell integration case at the implicit Vitest 5s budget after 9.221s. The remaining validator cases passed; no Evidence assertion failed. M1-S2 remains complete, but M2-S1 is blocked until this one prerequisite RED closes and the protected PR merges.

Diagnosis established the actual public seam. Five isolated local runs passed in 0.586–0.642s of test time; an eight-process diagnostic stress attempt did not reproduce the Hosted long tail and its accidental untracked `%SystemDrive%/` cache directory was inspected and removed. The deterministic command with `--testTimeout=500` then reproduced the identical timeout at the same test in 1.51s, providing a fast RED for the environment-budget boundary. Evidence indicates a cold-start/resource-contention tail rather than a validator assertion or branch regression: the M1 branch did not change the validator/test, and subsequent Hosted validator cases completed in roughly 0.8–1.2s.

The user explicitly approved a Harness Migration after receiving the exact old/new contract. `harness-migration-2026-08-02-evidence-validator-timeout.md` records the authorization. The only Judge change is a finite 30s timeout on the `evidence validator` suite that starts real `powershell.exe`; `validate-evidence.ps1`, fixtures and every positive/negative assertion remain unchanged, while the pure static GPU-preference suite retains the default timeout. Coverage strength is not promoted. Required completion checks are the deterministic timeout regression, the complete validator file, control/diff checks, full Harness, independent Spec/Standards review and a new PR #25 Clean Windows Harness GREEN.

The first post-change checks are GREEN. The deterministic command retaining CLI `--testTimeout=500` passed because the explicitly scoped suite contract took precedence and the real validator completed in 0.662s. The entire file then passed 18/18 in 9.80s: all 15 validator positive/negative cases executed, while the three static GPU-preference tests remained on their default budget. This proves the migration changed only environment headroom and did not skip or weaken an assertion.

Control-plane validation and `git diff --check` passed. The first full post-change Harness attempt ran all 506 frontend tests GREEN, including the validator suite at 13.007s under concurrent load, then the managed sandbox denied Vite permission to clear the existing `dist/assets` directory. This was an execution sandbox boundary, not a repository failure. Re-running the unchanged `npm.cmd run harness:check` with the required filesystem permission passed control validation, all frontend tests, complementary E2E/ordinary builds and all Rust tests; final `dist` is the ordinary production artifact.

The first independent review returned `FAIL` with no P0/P1 implementation defect. Spec reported one P2: the migration record incorrectly placed the post-push PR #25 Clean Windows run under `Before commit`, creating an impossible ordering. Standards reported one delivery P1: this state file had not yet recorded the two-axis verdict and closure. The migration record now keeps local checks and independent review in the pre-commit list, and moves the remote run to an explicit after-commit/push, before-merge gate. This paragraph records both findings and their closure. The same Spec and Standards reviewers must recheck the corrected stable staged diff before commit; Hosted/M2 status remains unchanged.

The corrected stable diff then received final `PASS` from both independent axes with P0/P1/P2 empty. Spec confirmed the executable pre-commit versus post-push/pre-merge ordering, exact four-file scope, local 30s suite budget, unchanged static-suite default, unchanged validator/fixtures/assertions and no coverage promotion. Standards confirmed authorization, complete migration history, no forbidden write or temporary residue, and no baseline smell. Both rechecks reported `npm.cmd run harness:control` and `git diff --cached --check 9a1e62b` passing. This closed the pre-commit independent-review gate; the subsequent result is recorded in the next section.

## 2026-08-02 M2-S1 current-target Hosted Runtime Settings replay

The prerequisite Harness Migration was committed as `b64a22f` and pushed to PR #25. The replacement Clean Windows Harness run `30754208415` passed in 8m36s with exact `headSha` `b64a22f20962980089b08c1873b4bc8294850dbe`; its repository Harness step passed. PR #25 was then merged through the protected branch. Local `master`, `origin/master` and GitHub's `refs/heads/master` were independently resolved and all equalled `a329059b8172dab82c7326deb0af322045a0c396` before dispatch.

The existing manual `Runtime Settings Desktop E2E` workflow was dispatched once from `master`. Workflow-dispatch run `30756311932` completed successfully in 8m28s with exact `headSha` `a329059b8172dab82c7326deb0af322045a0c396`; job `91518951537` used the pinned desktop toolchain and matching WebView2 driver. The Judge log records the sole public command `npm run e2e:runtime-settings`, whose script invoked `run-runtime-settings-e2e.ps1` without `-SkipBuild`.

The real Tauri/SQLite phases passed: schema inspection; model add; seeding a pending import; proving it remained idle after restart; explicit continuation of that same import; first-restart persistence; model deletion; pending result persistence across restart; and second-restart absence. The final log states `initialize -> add -> pending restart recovery -> delete -> restart`. No Rain secret, live model, Whisper download, video import or Evidence rewrite was used. The redacted failure-diagnostics upload step was skipped because the Judge passed, so no failure artifact was produced.

This completes M2-S1 and refreshes `AC-HE-05` for the named target commit only. It does not make the manual workflow a default merge gate and does not prove installer, signing, GPU/CPU release-package or canonical real-video freshness. This documentation-only Evidence sync changes no product source, workflow, locked Harness or Evidence artifact. Required local checks are `npm run harness:control` and `git diff --check`; an independent read-only Spec/Standards review must verify the target SHA, log boundary, current facts and M2-S2 handoff before commit.

The first independent M2-S1 review used baseline a329059b8172dab82c7326deb0af322045a0c396 and the stable four-file staged diff. Spec returned PASS with P0/P1/P2 empty and independently confirmed the exact target SHA, run identity, public command, no-SkipBuild boundary, no Rain secrets, real schema/add/restarts/delete/pending recovery, target-commit-only scope and M2-S2 handoff. Standards returned FAIL: two P1 findings identified a historical Hosted baseline presented as current in the agent-first plan and an M2 milestone summary still marked Ready with authorization; one P1 required this state record to persist the review; one P2 required a blank line before the maintenance heading. There were no product, workflow, Harness, Evidence or implementation defects.

The correction explicitly labels the agent-first opening snapshot historical, sets the M2 milestone to In progress — M2-S1 Complete; M2-S2 Next, records both review axes here and restores Markdown section separation. The same Spec and Standards reviewers must recheck the corrected staged diff before commit.

The corrected staged diff then received final PASS from both independent axes with P0/P1/P2 empty and no baseline smell. Spec confirmed no semantic drift or Evidence overclaim. Standards confirmed every first-round finding closed, only the intended four documentation files staged, no temporary residue or forbidden write, npm.cmd run harness:control PASS and git diff --cached --check against a329059b8172dab82c7326deb0af322045a0c396 PASS. This dual verdict completes the independent review gate for the M2-S1 Evidence sync; M2-S2 remains the unique next action.

## 2026-08-02 M2-S2 canonical Evidence freshness audit

The read-only audit is recorded in docs/development/canonical-evidence-freshness-2026-08-02.md against master b2fb7113318e389200b9ce07c912d8aebd4474f1. The complete schema v2 Evidence tree is unchanged since repository association commit 408b6db9b37d753522e153d6b7801fe887500eb1, the current validator still returns ok=true, and no paid model, video run or Evidence mutation occurred.

The audit separates immutable artifact facts from current product proof. The package remains citable for its recorded video hash, transcript, blocks, configuration, timings and screenshot, and remains a useful current validator regression fixture. It does not prove the current isolated CUDA worker, refactored persistence/import recovery paths or evolved StudyInterface. The manifest also lacks a Git commit field, so 408b6db is a repository association point rather than cryptographic source binding. All current-target full-pipeline claims require an exact-RC rerun.

The audit corrected one stale fact: database-summary.json records 34 Nodes, not the 59 previously stated here. Coverage rows that referenced the canonical package now distinguish current Strong tests from Historical Evidence; AC-LV-09 is explicitly a current-target Evidence Gap. The independent gate is closed, M2-S2 is complete, and M3-S1 release artifact contract confirmation is the unique next action.

Required pre-commit checks are the current public Evidence validator, npm run harness:control, git diff --check and an independent read-only Spec/Standards review. Full harness:check is not required for this docs-only classification Slice; no product, workflow, locked Harness, script or Evidence path is changed. Findings, closure and final verdict must be appended before commit.

The first independent M2-S2 review used baseline `b2fb7113318e389200b9ce07c912d8aebd4474f1` and the staged six-document diff. Both Spec and Standards returned FAIL with no P0/P2 or baseline implementation smell. Both found one P1 status contradiction: the new audit result prematurely called M2-S2 complete and advanced M3-S1 while every controlling plan correctly kept the Slice in review. Spec also found the historical schema v2 session narrative still said 59 Nodes even though `database-summary.json` records 34 and this Slice claimed to correct the stale fact.

The correction kept the audit decision ready but M2-S2 `In review`, made closing the independent gate the unique current action, and changed the remaining stale narrative count to 34. It did not change the Evidence package, an AC, a coverage-strength decision or the exact-RC rerun contract.

The corrected staged diff then received final PASS from both independent axes with P0/P1/P2 empty and no baseline smell. Spec independently reconfirmed the repository association, missing manifest target binding, blob/hash/count facts, conservative Historical/current-Gap classifications, unchanged ACs, exact-RC rerun boundary and no paid-call authorization. Standards confirmed both first-round findings closed, consistent In-review/Pending status during review, discoverable Active audit, six-document-only write set, no temporary residue or forbidden path, and proportionate docs-only validation. Both reviewers reported `npm.cmd run harness:control`, the current public Evidence validator and `git diff --cached --check b2fb7113318e389200b9ce07c912d8aebd4474f1` passing. This dual PASS closes M2-S2; the conclusion-only status sync makes M3-S1 the unique next action.

## 2026-08-03 M3-S1 release artifact contract

Branch `codex/m3-release-artifact-contract` starts from clean `master` commit `c1662d67f244f9976dafacf46fc5ed31a4d54589`, matching `origin/master` and the expected post-PR #27 merge. Takeover commands passed: `git status --short` was empty, `git branch --show-current` returned `master` before branching, `git log -5 --oneline` showed `c1662d6` at the top, and `npm.cmd run harness:control` passed.

Slice contract:

- AC / gap: M3-S1 artifact boundary for `AC-RL-01`, `AC-RL-02`, `AC-RL-07`, `AC-RL-08`, `AC-RL-10`, `AC-RL-12` and `AC-RL-18`; no AC text or coverage strength is changed.
- Observable result: release reviewers have an Active contract for the only public Windows x64 NSIS installer, version `0.1.0`, identifier `com.rain.app`, CPU-safe main executable, isolated CUDA worker/runtime resources, machine-readable artifact manifest, forbidden contents and future Evidence Judges.
- In scope: docs-only artifact contract, control-map source registration, roadmap status, conservative coverage notes and this state sync.
- Out of scope: installer build, GitHub Release, CPU/GPU short samples, Hosted desktop dispatch, real video Evidence, signing, SBOM/notices, CUDA legal approval, installer/download UI and product source changes.
- Owner: Tauri release config, GPU bundle script, release manifest generator, artifact hygiene scanner and human release/legal owner.
- Judge: local `npm.cmd run harness:control`, `git diff --check`, and independent read-only Spec + Standards review. Full `harness:check` is intentionally not required for this documentation-only contract unless review identifies a control risk.
- Allowed writes: `docs/development/release-artifact-contract.md`, control/plan/coverage documents and this state file. Locked Harness, product source, workflow, Evidence and generated artifacts remain untouched.

Current write set defines the artifact contract without signing off implementation. `harness-coverage.md` still keeps `AC-RL-01/10/18` as Gap and `AC-RL-02/12` as Partial; no Release Evidence tier is promoted. M3-S2 remains blocked until M3-S1 passes independent review, PR Clean Windows Harness and protected merge.

Required pre-commit checks are `npm.cmd run harness:control`, `git diff --check` and independent read-only Spec/Standards review of the stable diff. Findings, closure and final verdict must be appended here before commit.

The first independent Spec review returned `PASS` with P0/P1/P2 empty. It confirmed the docs-only atomic boundary, correct release AC references, single public Windows x64 NSIS `0.1.0` / `com.rain.app` identity, CPU-safe main plus isolated CUDA worker/runtime, `nvcuda.dll` exclusion, manifest and forbidden-content boundaries, conservative coverage and no authorization for paid model, real-video, GPU, CPU, installer, signing, licensing or Release Evidence.

The first independent Standards review returned `FAIL` with no content or boundary defect. It found one P1 process blocker: the new Active contract file was still untracked, so ordinary diff/review commands omitted the central source even though control documents already linked it. It also found one P2: the new contract had a trailing blank line at EOF that only became visible when checking the untracked file directly. Closure: the full six-file write set is now staged including `docs/development/release-artifact-contract.md`, and the EOF blank line was removed. Required rechecks are `npm.cmd run harness:control`, `git diff --cached --check` and independent Standards re-review of the staged diff.

The Standards re-review returned final `PASS` with P0/P1/P2 empty. It confirmed the prior untracked-file P1 and EOF P2 are closed, the staged diff contains exactly the intended six documentation files, `git diff --cached --check` and `npm.cmd run harness:control` pass, and all unrun heavy gates remain future Partial/Gap or Release Evidence requirements. Together with the earlier Spec `PASS`, this closes the independent review gate for M3-S1. Full `harness:check`, installer build, GitHub Release, GPU/CPU samples, signing/legal approval, SBOM/notices, disclosure UI and real-video Evidence were intentionally not run for this docs-only artifact contract.

PR #28 was opened from commit `4e9f961` and its first Clean Windows Harness run `30797502667` passed in 10m16s. A conclusion-only status sync then changed only control-plane status text from In review to complete/next-action wording; it did not change the artifact contract, AC text, coverage strength, product source, locked Harness, workflow, Evidence or generated artifacts. This final sync needs a short independent read-only review, local `npm.cmd run harness:control`, `git diff --cached --check`, a replacement Clean Windows Harness on the updated PR head, protected merge and local master sync.

## 2026-08-03 M3-S2 no NVIDIA/CUDA CPU Evidence runner

Branch `codex/m3-s2-no-nvidia-cpu-evidence` starts from clean `master` commit `9bf1df162ea0be53eb0a532f6b71fb0100a8150a`, matching `origin/master` and the user's expected post-PR #28 merge. Takeover commands passed: `git status --short --branch` showed `## master...origin/master`, `git rev-parse HEAD` and `git rev-parse origin/master` both returned `9bf1df162ea0be53eb0a532f6b71fb0100a8150a`, `git log -1 --oneline` showed the PR #28 merge, and `npm.cmd run harness:control` passed.

Slice contract:

- AC / gap: `AC-RL-07` no NVIDIA/CUDA clean Windows CPU Release Evidence runner. This is a runner-enablement Slice inside M3-S2, not the evidence-signing run itself.
- Observable result: release reviewers get a repeatable command, `npm run evidence:no-nvidia-cpu -- -InstallerPath <candidate.exe>`, that refuses development-tree execution and records environment, artifact and CPU short-sample proof from an installed candidate.
- In scope: `scripts/run-no-nvidia-cpu-evidence.ps1`, package script wiring, a static contract test, conservative coverage/status docs and this state sync.
- Out of scope: building a target installer, publishing a GitHub Release, running on a clean no-NVIDIA machine, installing CUDA/NVIDIA Evidence, signing/legal/SBOM, installer lifecycle, paid model calls and real-video Evidence.
- Owner: release-evidence runner plus existing CPU-safe Rain main executable, `whisper_backend` selector and production `start_asr` command.
- Judge: PowerShell parser check, `npx.cmd vitest run scripts/no-nvidia-cpu-evidence.test.ts`, `npm.cmd run harness:control`, `git diff --check`, and independent read-only Spec + Standards review. Full `harness:check` is required before code Slice delivery unless the independent review narrows it further.
- Allowed writes: `scripts/run-no-nvidia-cpu-evidence.ps1`, `scripts/no-nvidia-cpu-evidence.test.ts`, `package.json`, M3 control/status docs and this file.
- Locked files: `harness/`, `src-tauri/tests/`, product source, workflow, generated Evidence and build artifacts remain untouched.

The runner requires a real NSIS installer path and installs it into an isolated directory. It captures OS/GPU facts, rejects any NVIDIA display adapter, `nvidia-smi.exe` or system `nvcuda.dll`, records installer and installed `rain.exe` SHA-256, inspects the installed main executable's PE imports for CUDA DLLs, starts the installed app through `tauri-driver`, waits for production Settings readiness, queries production `get_runtime_capability(auto)`, clicks the production Settings preflight and requires the visible text to include CPU backend plus the same fallback reason, and then runs production `start_asr` against the bundled `asr-capability/sample.mp4` with `backendPreference=auto`. It requires backend `cpu`, a non-empty fallback reason and non-empty monotonic sentences. If a model path is supplied, the runner hashes and uses it; otherwise it drives the production model download UI for the selected Whisper size and records the downloaded model hash. Failure manifests are written with redacted diagnostics.

Current validation passed: PowerShell AST parsing of `scripts/run-no-nvidia-cpu-evidence.ps1`; `npx.cmd vitest run scripts/no-nvidia-cpu-evidence.test.ts` (4 tests); `npm.cmd run harness:control`; `git diff --check`; and full `npm.cmd run harness:check` (86 frontend/script test files passed, 510 tests passed, one live-key test skipped, complementary E2E/ordinary builds passed, Rust tests passed). No installer, clean no-NVIDIA host, CPU sample, workflow, paid model, real video, Release Evidence or generated evidence artifact has been run in this local session, so `AC-RL-07` remains Partial.

Required before commit: stage the full intended diff, run `git diff --cached --check`, and send the stable staged diff through independent read-only Spec and Standards review. Findings, closure and final verdict must be appended here before commit. After PR Clean Windows Harness and protected merge, the next single action is to run this runner on a clean no-NVIDIA/CUDA Windows host against the formal candidate installer and review the produced Evidence.

Independent read-only review of the latest staged diff returned final PASS on both axes with P0/P1/P2 empty. Spec confirmed the runner-enablement scope, real-installer requirement, no-NVIDIA checks, installed main CUDA import check, production Settings readiness, visible Auto CPU fallback text, production `start_asr` short sample, target/installer hash manifest and conservative `AC-RL-07` Partial status. Standards confirmed the staged scope is limited to the intended runner, static contract test, package script and conservative docs; no product source, locked Harness, workflow, generated Evidence or build artifact changed; cleanup is guarded to `%TEMP%` by default; diagnostics are redacted; direct Tauri command driving is acceptable because it is through the installed production app after UI readiness and visible fallback checks; and the static test is honestly documented as runner-contract coverage, not Release Evidence.

Missing Evidence remains explicit: no clean no-NVIDIA/CUDA Windows run, installer build/install, CPU short-sample Evidence artifact, paid model, real video, NVIDIA/GPU, signing, SBOM/legal, workflow or lifecycle Evidence was produced in this Slice. The final pre-commit checks are `git diff --cached --check` and a commit of the reviewed staged diff.

## 2026-08-03 M3-S2 NSIS artifact generator prerequisite

Branch `codex/m3-s2-nsis-artifact-generator` starts from clean `master` commit `07ef5eccf8aa657f30e157b628b72ede5dd3ce19`, matching `origin/master` after PR #29. Takeover and `npm.cmd run harness:control` passed. The user supplied `D:\huancongqu\rian` as the installer output location; it existed but was empty.

The first real `npm.cmd run bundle:gpu` attempt built the isolated CUDA worker, production frontend and release `rain.exe`, then exited without an installer. Local Tauri schema inspection established the cause: Tauri 2 defaults `bundle.active` to `false`, while `src-tauri/tauri.gpu.conf.json` previously declared only resources. The public command therefore could not satisfy the M3-S1 single-NSIS contract.

This atomic prerequisite Slice maps to `AC-RL-01`, `AC-RL-02` and the installer-input prerequisite of `AC-RL-07`. Its implementation owner is the GPU Tauri release overlay. It explicitly enables bundling and limits the target list to `nsis`; `scripts/gpu-release-bundle.test.ts` checks both the worker-first command and the single-NSIS configuration. The required runtime Judge is a successful `npm.cmd run bundle:gpu`, exactly one generated NSIS copied to the supplied output directory, and recorded installer SHA-256. Static and full Harness checks plus independent read-only Spec and Standards review remain required before delivery.

The corrected local command completed the GPU worker, production frontend, CPU-safe release main executable and NSIS phases, ending with `Finished 1 bundle`. The only bundle artifact was `Rain_0.1.0_x64-setup.exe`, 477,378,526 bytes. It was copied without overwrite to `D:\huancongqu\rian\Rain_0.1.0_x64-setup.exe`; source and destination SHA-256 both equal `8fd2757ea91f19796bf6098f1e0a9e6cda86102dbfecd302b2b504263b18c6aa`. This is a provisional generator-validation artifact built from the uncommitted Slice worktree, not a formal target candidate and not Release Evidence. After protected merge and `master` sync, the exact merged commit must be rebuilt before the clean-host M3-S2 run.

Local verification is GREEN: `npx.cmd vitest run scripts/gpu-release-bundle.test.ts` passed 2/2; `npm.cmd run harness:control` passed; `git diff --check` passed; and full `npm.cmd run harness:check` passed with 87 frontend/script test files and 512 tests GREEN, one live-key test skipped by contract, complementary E2E/ordinary production builds GREEN, and all Rust suites GREEN (98 library tests plus integration suites, with the existing single real-model case ignored). The stable staged diff must now receive independent read-only Spec and Standards review before commit.

The first independent read-only review returned Spec `PASS` with P0/P1/P2 empty. Standards returned `FAIL` with one P1 and no P0/P2: `agent-first-development-plan.md` and `rain-project-delivery-plan.md` still described runner enablement as the current Slice, contradicting this section's NSIS generator prerequisite. The correction records PR #29's merged runner, names this generator repair as the current atomic Slice, and preserves the exact-master rebuild plus clean no-NVIDIA execution as the next action. No AC, implementation or Evidence claim changed. The same Standards reviewer must recheck the corrected staged diff.

The corrected five-file staged diff then received final `PASS` from both independent axes with P0/P1/P2 empty. Spec found no new contract or scope drift. Standards confirmed its prior P1 was closed, the staged scope was correct, and `npm.cmd run harness:control`, the 2/2 targeted test and `git diff --cached --check` passed. This closes the independent pre-commit review gate; the provisional installer remains non-Evidence, and exact-merged-master rebuild plus clean-host execution remains the only next M3-S2 action after merge.

Scope remains narrow: no product runtime source, locked `harness/`, locked `src-tauri/tests/`, workflow or tracked Evidence is changed. Building the candidate does not approve CUDA redistribution, sign the package, publish a GitHub Release, run a paid model, generate real-video Evidence or prove `AC-RL-07`. The current workstation has an NVIDIA GeForce RTX 5060 Ti, `nvidia-smi.exe` and system `nvcuda.dll`, so it is ineligible for no-NVIDIA Evidence. A genuinely clean no-NVIDIA/CUDA Windows execution environment remains required after this prerequisite merges.

The preceding requirement was the then-current M3-S2 handoff. It is historical and is superseded in full by the immediately following GPU-required Harness Migration; it must not be used as the current next action.

## 2026-08-03 GPU-required Core Release Harness Migration

Branch `codex/m3-gpu-required-release-migration` starts from clean `master` commit `3cf38f223ab084bc8f37766720806cfa90362ae3`, matching `origin/master`. Takeover and `npm.cmd run harness:control` passed before edits. The user first said “跳过这个吧，默认有gpu显卡” and then explicitly confirmed the clarified meaning: formally cancel no-NVIDIA support, make an NVIDIA GPU the minimum requirement, and execute a Harness Migration.

The canonical term is now **Supported release host**: Windows x64 with a supported NVIDIA GPU and compatible driver. This Slice changes only the release support matrix. CPU-safe Rain main, CPU adapter, explicit CPU mode, Auto visible fallback, Forced GPU fail-closed behavior and ordinary no-CUDA Harness builds remain current. No product runtime implementation changes.

All earlier dated PROJECT_STATE entries that name clean no-NVIDIA execution, dual-environment Evidence or M3-S2 as a future/current gate are preserved only as historical snapshots and are superseded by this section. The current next runtime Slice is M3-S3 supported-NVIDIA Evidence.

`AC-RL-07` is retained as a unique `Superseded` historical AC rather than silently deleted or marked passed. `AC-RL-08` owns supported NVIDIA candidate Evidence and `AC-RL-18` owns minimum-hardware/no-NVIDIA-unsupported disclosure. The old `scripts/run-no-nvidia-cpu-evidence.ps1`, its static test and `evidence:no-nvidia-cpu` npm entry are retired as shadow Judges. The formal migration record is `docs/development/harness-migration-2026-08-03-gpu-required-release.md`.

The exact-master installer built before this migration remains at `D:\huancongqu\rian\3cf38f223ab084bc8f37766720806cfa90362ae3\Rain_0.1.0_x64-setup.exe`, SHA-256 `6e7d41b4602545b7ec22e785a088fa3452fb27426f734c70fad0d3f950a6f0bc`. It is a pre-migration artifact and cannot sign the next target. After protected merge, M3-S3 must rebuild from the new exact `master` before running supported NVIDIA Evidence.

Required local gates are: 90 unique acceptance IDs at 89 Confirmed + one Superseded; one Retired `AC-RL-07` coverage row; unchanged 99-row disposition counts; no active no-NVIDIA release blocker; retired runner absence; `npm.cmd run harness:control`; full `npm.cmd run harness:check`; `git diff --check`; and independent read-only Spec + Standards review. No paid model, real video, external site, workflow, generated Evidence, signing or legal approval is authorized in this docs/tooling migration.

Local verification is GREEN. The mechanical audit found 90 unique AC IDs (89 Confirmed, one Superseded), 90 unique coverage rows with one Retired `AC-RL-07`, unchanged 99 decision rows at 72 Confirmed AC / 23 Proposed / 4 Out-of-scope, no retired runner/package entry, and zero changes under locked Harness, product source, workflow or Evidence paths. `npm.cmd run harness:control` and full `npm.cmd run harness:check` passed: 86 frontend/script files and 508 tests passed, one live-key test skipped by contract, complementary E2E/ordinary builds passed, and all Rust suites passed (98 library tests plus integration suites; the existing one real-model case remained ignored). The four-test reduction from the previous 512 total is exactly the retired no-NVIDIA runner contract test. Stable staged diff review remains required before commit.

The first independent read-only Spec review returned `FAIL` with one P1 and no P0/P2: the delivery plan's “current reliable conclusions” still said all 90 ACs were Confirmed and all original 50 M1-S2 coverage rows were Partial/Gap. The correction now states 89 Confirmed + one Superseded and distinguishes the 49 active Partial/Gap rows from the one Retired `AC-RL-07`. The corrected staged diff must pass the same Spec reviewer before commit; the independent Standards review remains separate.

The first independent read-only Standards review returned `FAIL` with one P1 and no P0/P2: “supported NVIDIA GPU + compatible driver” had no independently executable eligibility predicate, so M3-S3 host qualification and `AC-RL-18` disclosure could not be reproduced. The correction makes the existing production behavior canonical rather than inventing a GPU list: the exact installed candidate's versioned worker probe must return an available device and memory through the expected protocol, and the selected Evidence model must pass `whisper_backend`'s existing model-bytes plus 512 MiB headroom gate. M3-S3 records GPU/driver/memory/protocol/probe/package/model facts and signs only that exact configuration; disclosure cannot extrapolate beyond valid Evidence. No runtime code or product threshold changed. The corrected final staged diff must pass both original reviewers.

Both original independent reviewers then re-read the complete corrected staged diff and returned final `PASS` with P0/P1/P2 all empty. Spec confirmed its count P1 was closed, the executable supported-host predicate matches the existing production probe/memory behavior, `AC-RL-08/18` remain faithful to the user-authorized support amendment, and no runtime or support promise expanded. Standards confirmed its predicate P1 was closed, all Active sources reference the same exact-candidate Judge, configuration signing cannot extrapolate to other GPUs/drivers, the Spec count correction is accurate, forbidden paths remain untouched, and `harness:control`, mechanical counts and cached whitespace checks pass. This completes the independent review gate for the migration; it does not create M3-S3 Evidence or approve signing, licensing, paid models or real-video execution.

## 2026-08-03 M3-S3 supported NVIDIA Evidence runner

Branch `codex/m3-nvidia-evidence-runner` starts from clean merged `master@b31eb503a1c68d9584397815705153e4ed7e5cde`, matching `origin/master`. Takeover reread the Active control plane and `npm.cmd run harness:control` passed before edits. The user approved continuing the unique M3-S3 action. Repository inventory found no executable NVIDIA Release Evidence runner, so this atomic Slice is runner enablement only; target candidate build and formal execution remain the next separate action after protected merge.

Slice Contract: `AC-RL-08` and `AC-LV-21` own the behavior; `scripts/run-nvidia-release-evidence.ps1` owns installed-candidate orchestration and target-bound output; the installed Rain Tauri command/event interfaces, CPU-safe main executable and isolated CUDA worker remain the production modules under Judge. Allowed writes are the non-locked runner/contract module, PowerShell external-interface behavior test, package command and control documentation. Product source, locked `harness/`, locked `src-tauri/tests/`, workflow, tracked/generated Evidence and build artifacts are out of scope.

The runner requires a real NSIS installer, external local Whisper model, exact 40-character target commit, expected installer SHA-256 and the build-generated release artifact manifest. Before installation it verifies that the manifest binds that target and exact installer filename/size/hash/NSIS kind; after installation it requires a path-safe, duplicate-free bidirectional CUDA payload set and rejects bundled `nvcuda.dll`. It refuses a dirty tracked checkout or hash mismatch; records NVIDIA controller/driver/`nvidia-smi`/`nvcuda.dll`, installed main import isolation, production worker protocol probe and the existing model-bytes + 512 MiB memory gate; and signs only the exact observed configuration. Through the installed production app it captures progress events and validates non-empty monotonic output for Auto CUDA, Forced CUDA and Forced CPU, polls to prove Forced CPU never starts the worker, cancels after CUDA selection without CPU retry, injects a terminating executable at the installed worker path to prove Auto classified fallback and Forced CUDA fail-close, restores the original worker by hash, and proves an invalid-model error does not retry CPU. Evidence phases and both success/failure manifests are atomically persisted and scanned after redaction. No LLM interface exists in this runner.

This Slice does not execute the runner, install a candidate, use a model or media, or create Evidence. Its current non-Evidence test is the PowerShell external-interface behavior contract, not a string-presence test. Required remaining gates are control-plane/whitespace checks, complete `npm.cmd run harness:check`, stable staged independent read-only Spec + Standards review, commit/PR Clean Windows Harness, protected merge and master sync. Only then may the exact new master candidate be rebuilt and the runner executed against the candidate's bundled short probe sample; this is local Whisper short-sample Release Evidence, not paid-model or full real-video Evidence.

The historical local verification for the original runner is retained above as a snapshot; the current contract test count and gates are recorded in the 2026-08-10 follow-up below. No installer, GPU worker, model, media, Tauri desktop, LLM or Evidence run occurred. The stable staged diff still requires independent Spec and Standards review before commit.

## 2026-08-10 / 2026-08-11 Stage 0 and M3-S3 contract hardening

This follow-up runs in `D:\xiangmu\rain 未完成` on `b31eb503a1c68d9584397815705153e4ed7e5cde`. It preserves the existing staged M3-S3 WIP and does not stage, reset, checkout, install dependencies, contact external services, run Cargo, build an installer, use GPU/model/LLM or generate Release Evidence.

Before code work, the user data sources were copied outside the repository to `D:\xiangmu\rain-backups\20260810-stage0`: `rain.db` and `whisper-models\ggml-large-v3.bin`. Source and backup SHA-256 values matched exactly: database `E0E3E8609FB6DADE3852413F76E067CC66A2CA1D9F6C1C0818CAC7528DA6D4E7`; model `64D182B440B98D5203C4F9BD541544D84C605196C4F7B845DFA11FB23594D1E2`. The D: volume had 168.2 GiB free before the copy. The backup is user data, not a repository artifact.

Stage 0 corrected the Active canonical checkout, the 72/23/4 product-decision summary, the M3 supported-NVIDIA-only exit wording, and the copied checkout's real-E2E tool/root/target/model path interface. The non-locked control validator now rejects decision-count drift, a Superseded AC reintroduced as an active release exit criterion, and an obviously obsolete Active primary checkout. Its RED run had 3 expected failures; after the smallest validator change, `scripts/control-plane-validator.test.ts` passed 12/12 and `npm.cmd run harness:control` passed.

M3-S3 now has an internal `nvidia-release-evidence-contract.psm1` behind the same `evidence:nvidia-release` CLI. Before installer launch, a required build-generated artifact manifest must bind the expected target SHA and supplied installer filename, byte length, SHA-256 and NSIS Windows x64 kind. After installation, the CUDA payload validator rejects missing, additional, duplicate and path-escaping entries as well as a bundled `nvcuda.dll`, rather than trusting a manifest self-claim. The evidence writer atomically checkpoints passed/failed phases and uses one redacted success/failure manifest family; its scanner covers common bearer/API/AWS-style credentials, key/value secrets, email addresses and Windows user-profile paths. The runner behavior contract had a 4-test RED before the module existed and is GREEN at 4/4 through PowerShell process/module interfaces, including negative provenance, payload and redaction cases.

The parameterized real-E2E runner now provides an opt-in, no-side-effect `-PlanOnly` CLI result so tests can exercise default CUDA and configured tool-root resolution without a live key, build or desktop process. Its initial RED failed because `-PlanOnly` did not exist and reached the live-key guard; after the minimal interface addition, `scripts/validate-evidence.test.ts` passed 18/18. This does not call the normal real-E2E path or alter its default video/business decision.

Allowed verification after the changes: PowerShell AST parsing passed for `run-real-e2e.ps1`, `run-nvidia-release-evidence.ps1` and the contract module; targeted NVIDIA contract passed 4/4; control validator passed 12/12; `npm.cmd run harness:control` passed; `npx.cmd tsc --noEmit` passed; `npm.cmd run build:e2e` and `npm.cmd run build` passed (only existing Vite dynamic-import chunk warnings); and `npm.cmd test` passed 87 files / 515 tests with one contractually skipped live-key test. `cargo`, `harness:check`, installer build/install, GPU, model, LLM and real desktop Evidence remain intentionally unrun.

Still deliberately open: cancellation needs a deterministic long/cancellable fixture or an approved desktop adapter seam, and Forced CPU process attribution needs a session/process-tree adapter rather than a global process-name poll. No fake installer or desktop adapter was added merely to claim those cases pass; they remain a separate next Slice. The final candidate also still requires its own generated artifact manifest, supported-host real execution, signing/legal/SBOM/hygiene and lifecycle Evidence before any Release AC can advance.

## 2026-08-11 M3-S3 second independent-review safety closure

The second independent Spec + Standards review found that the first runner enablement was not safe to present as directly executable: manifest self-description was not an independent provenance trust source; cancellation/process attribution lacked a deterministic session-scoped adapter; a successful top-level Evidence manifest could otherwise overstate what was observed. This section supersedes any earlier runner prose that says it can currently sign or directly issue passed M3-S3 Evidence. It cannot.

The non-locked runner contract now requires the independent `ExpectedArtifactManifestSha256` input and verifies the candidate manifest bytes before trusting fields. The manifest must contain a controlled-build source repository, matching target commit, `cleanTree=true`, generator id/version, and build-record id/timestamp. Active contract text states that this expected hash may only originate from the controlled merged-target build record; a plain self-description is neither a signature nor an attestation. Missing or mismatched trust inputs fail closed.

The payload validator now scans the entire installed tree for CUDA/driver DLLs, rejects CUDA/driver DLLs outside the payload root and rejects `nvcuda.dll`; PE import inspection rejects a failed tool exit or unusable output. Evidence persistence has a single atomic partial/failure/success family, structured secret/PII redaction, and a success writer that rejects duplicate, missing, failed, extra or out-of-order required stages. A custom install directory must be new or empty and is recorded as owned by the current run. Both runners quote Edge driver paths with spaces; `run-real-e2e.ps1` resolves relative EvidenceRoot against RepoRoot, uses RepoRoot as its process working directory, and its PlanOnly path remains side-effect free.

The M3-S3 runner deliberately stops at `runtime-adapter-readiness` before installer launch, driver launch, desktop startup, GPU observation or model inference. The explicit blocking condition is the missing deterministic cancellation fixture plus session-scoped process-tree adapter. Its failure manifest is expected behavior and cannot be promoted to Release Evidence. The next single action is a separate adapter/fixture Slice with a fake deterministic seam; only after that Slice and its independent review may a real target candidate be considered. No real installer/GPU/model/LLM/desktop Evidence was run in this closure.

Second-round TDD evidence to date: NVIDIA contract behavior had 8 RED findings and is GREEN at 8/8, including a real external PowerShell CLI failure path for bad provenance and runtime-adapter blocking with persisted redaction. The real-E2E PlanOnly interface had one RED and is GREEN at 18/18; the control validator had two RED cases (semantic no-NVIDIA exit wording without an AC id on the same line, and slash/case legacy checkout paths) and is GREEN at 14/14. A duplicate phase now rejects before replacing its already-persisted phase artifact; the all-tree DLL scan also covers an unapproved `cudnn` DLL outside the payload root. The untracked `scripts/nvidia-release-evidence-contract.psm1` is intentional to preserve the pre-existing staged boundary, but it must be included in the eventual commit; no `git add`, reset or checkout was performed.

Final allowed local gates passed: targeted runner/control/validator tests 40/40; `npm.cmd test` 87 files and 521 tests passed with one contractually skipped live-key test; `npx.cmd tsc --noEmit`; `npm.cmd run harness:control`; `npm.cmd run build:e2e`; `npm.cmd run build`; PowerShell AST parsing for both runners and the contract module; and working-tree plus staged `git diff --check`. The only build output was the existing Vite dynamic-import warning family. The payload behavior test was given a 15-second per-test timeout because its eight isolated PowerShell invocations can exceed Vitest's default five seconds under the full suite's parallel load; its assertions remain unchanged and the final full-suite run passed.

The final follow-up Standards/Spec closure added three RED-to-GREEN contract cases without executing an installer: provenance now rejects a release-artifact manifest missing any active minimum structure from `release-artifact-contract.md` §5 (including `version=0.1.0`, main executable, CUDA resources, forbidden findings, generation time and generator); the NSIS adapter passes `/S` plus an unquoted raw absolute `/D=<InstallDir>` as the final `Start-Process -ArgumentList` item, verified through a fake process adapter with a path containing spaces; and main-executable PE imports use the exact same explicit CUDA/NVIDIA runtime-family classification as the installed-tree scan, including `cufft`, `cudnn`, `nvrtc`, `cusolver`, `cusparse`, `curand`, `cupti`, `cufile`, `nvblas` and `nvcuda`, while ordinary `custom-*`/`nvwidgets` imports remain allowed. The follow-up targeted runner/control/validator suite passed 42/42; the final `npm.cmd test` passed 87 files / 523 tests with one contractually skipped live-key test, and `tsc`, `harness:control`, E2E/production builds, PowerShell AST and staged/working-tree whitespace checks passed. At that historical checkpoint the runner remained fail-closed at `runtime-adapter-readiness`; the later cancellation/process-observation Slice below supersedes that readiness status. No installer, GPU, model, LLM, desktop or Release Evidence was run. The untracked contract module remains intentionally unstaged and must be included in the eventual commit.

## 2026-08-11 M3-S3 cancellation fixture and session process observation enablement

This low-disk Slice preserves all staged/unstaged/untracked WIP and does not run Cargo, Whisper/CUDA compilation, an installer, GPU/model/LLM/media execution or network access. `src-tauri/target` was absent before edits. It closes only the two pre-agreed deep-module seams behind the existing single runner CLI; it does not create or upgrade `AC-RL-08` Evidence.

The cancellation fixture contract now streams a canonical 16 kHz mono 16-bit PCM WAV into the operating-system TEMP tree using a 64 KiB buffer and removes it in `finally`. The file is deterministic: 180 seconds, 5,760,044 bytes, SHA-256 `5545b8236a5eb7a03694955687d8adca43490b2f31efdb7f635a2c7409857045`, a fixed minimum duration floor of 120 seconds and a 2,000 ms post-backend-selection cancellation window. Behavior tests verify its header/length/hash/disk ceiling and success/failure cleanup; a caller cannot weaken the duration floor. The runner requires the task still to be running after CUDA selection, cancels within the fixed window and fails closed when the fixture completed early.

The process-observation contract now supplies a production Windows CIM/process-start-event adapter and an injectable fake adapter. It selects exactly one Rain root by executable path, PID, start time, WebDriver session start and trusted launcher ancestry; observation windows use queued process-start events so a worker that has already exited before the read is still captured. Completion rechecks root PID/path/start time, rejects PID reuse or exit, attributes only workers whose event parent chain reaches this root, isolates other Rain instances and unregisters/removes the subscription in `finally`. The runner starts the observer immediately after creating its WebDriver session, replaces the global `Get-Process -Name rain-whisper-cuda` poll in Forced CPU, and requires a session-owned worker fact for cancellation. Runtime readiness now validates/generates/cleans the deterministic fixture and checks the required Windows event commands; its external CLI behavior writes `runtime-adapter-readiness=passed` and then safely fails at target-checkout for a mismatched fixture target before installer execution.

TDD evidence in this Slice: the fixture interface, immutable duration floor and explicit cancellation window each failed before their minimum implementation; process observation failed first for a missing interface, then a 500 ms PID reuse case failed until start-time identity tolerance was tightened; the real runner CLI initially remained blocked at runtime readiness and then advanced only to the safe target-checkout failure. The current NVIDIA contract suite is GREEN at 14/14, including fake short-lived worker attribution/other-instance isolation/subscription cleanup/PID reuse behavior and the real CLI failure/redaction path. These are enablement results only. A reviewed merged-target installer, real supported NVIDIA host execution, formal Evidence, signing, legal/SBOM and lifecycle work remain blocked/separate.

Final local gates for this Slice passed without creating `src-tauri/target`: targeted NVIDIA contracts 14/14; `npm.cmd test` 87 files / 527 tests passed with one contractually skipped live-key test; `npx.cmd tsc --noEmit`; `npm.cmd run harness:control`; `npm.cmd run build:e2e`; `npm.cmd run build`; PowerShell AST parsing for the runner, contract module and real-E2E runner; and both working-tree and staged `git diff --check`. `src-tauri/target` remained absent at the final check. Vite emitted only the pre-existing dynamic/static import warning family. The contract module remains intentionally untracked to preserve the staged boundary, but `scripts/nvidia-release-evidence-contract.psm1` is required in the eventual commit; no `git add`, reset or checkout was performed.

### 2026-08-11 independent-review fail-closed corrections

The first independent review of this enablement Slice returned FAIL with one Standards P2 and two Spec P1s. The deterministic bytes and session attribution were directionally correct, but fixture construction/disposal/deletion errors could mask each other, the two-second cancellation window was incorrectly restarted when PowerShell observed an already-delivered backend event, and a disappeared/broken event subscription could be read as an empty worker set. No real runner execution was attempted while these findings were open.

The fixture public interface now has a production/fake IO adapter used only for lifecycle fault injection. File stream and BinaryWriter construction are inside the guarded lifecycle; writer and stream disposal run in independent guarded blocks; generation, disposal, Action and removal errors are merged; and removal never uses silent best-effort cleanup. Behavior REDs proved creation failure, writer-disposal failure that previously skipped stream disposal, and Action plus deletion failure that previously lost the Action error. The tests leave zero fixture bytes after their own controlled fault cleanup, while production deletion failure remains a blocking surfaced error.

The progress callback now records an absolute epoch millisecond timestamp at callback delivery plus a monotonic sequence. The runner selects that captured CUDA event, verifies the task was still running, calls `cancel_import`, captures its immediate completion time and conservatively validates callback-to-command-completion against the two-second window; PowerShell polling cannot reset the clock. A 2,001 ms delayed-read fixture was RED before the timing validator and is now rejected. Unsafe or negative clock mapping, missing timestamp/sequence, completion before request and an exceeded window all fail closed.

The Windows event token now binds a unique source identifier, subscription id, `Win32_ProcessStartTrace` provider metadata and event-job id. Production window/read/complete paths verify exactly one matching subscriber, matching provider identity and a running job before treating the event queue as evidence; root PID/path/start time is still rechecked. Missing, duplicate, stopped and failed subscription fake cases were RED and now all throw before a second read, so Forced CPU cannot pass from a silently empty event set. Observer cleanup errors remain blocking and are merged by the runner.

The final observer review replaced the earlier non-Action CIM subscription assumption with a real `Register-CimIndicationEvent -Action` PSEventJob. Its Action enqueues `NewEvent` into a token-bound `ConcurrentQueue`; Read atomically drains that queue; health checks bind the unique subscriber, provider metadata and queue identity, and accept only the healthy action-job states `NotStarted` (idle) or `Running` (active). Missing jobs and `Failed`, `Stopped`, `Disconnected` or `Completed` states fail closed. Stop independently attempts subscriber unregister, queued-event removal, job removal, queue drain and final absence verification; errors are aggregated without skipping later cleanup steps. Runtime readiness now performs a real register/health/read/unregister smoke without launching Rain or a worker. This local Windows account returns `Access denied` for `Win32_ProcessStartTrace`, so the runner correctly remains fail-closed at readiness on this host; an Evidence host must grant the runner account permission to subscribe to that provider and pass the real job smoke before installer execution. This is an environmental enablement block, not fake Evidence.

Post-correction gates are GREEN: NVIDIA contracts 32/32; `npm.cmd test` 87 files / 545 tests passed with one contractually skipped live-key test; `npx.cmd tsc --noEmit`; `npm.cmd run harness:control`; `npm.cmd run build:e2e`; and `npm.cmd run build`. PowerShell AST parsing for both runners and the contract module, working-tree/staged `git diff --check`, and the old-active-fact scan also passed; `src-tauri/target` remained absent and the pre-existing staged/unstaged/untracked boundary was preserved. None of these gates executed installer, GPU, model, Cargo, Whisper or Release Evidence work. Final regressions cover the stream-open/writer-construction failure, callback-to-cancel completion timing, explicit good/bad PSEventJob states, continued cleanup after a missing subscriber, and the real job-backed production subscription smoke; on this local account the latter records the required fail-closed `Access denied` outcome.

### 2026-08-11 PR #32 Clean Windows portability correction

Clean Windows Harness run `31470451001` failed on commit `4a2aa2ac592c5fcc94340640090b1ab0678430d3` during `npm test`: the NVIDIA contract file had eight failures while 537 tests passed and one live-key test skipped. The workflow stopped before the frontend builds and Rust/Whisper gate, so that run is failed and must not be described as GREEN. The failures reduced to four Windows portability causes: the PowerShell 7 job launched hard-coded Windows PowerShell children whose inherited module path could not autoload `Get-FileHash`; payload-manifest exclusion compared 8.3 and long absolute path representations; the custom InstallDir test compared those representations literally; and a single redaction finding was unwrapped to a scalar before `.Count` under StrictMode.

The repair uses a streamed .NET `FileStream` plus `SHA256` helper throughout the contract and runner, and the behavior test shadows `Get-FileHash` to prove provenance no longer depends on module autoload. Test subprocesses honor `RAIN_TEST_POWERSHELL_EXE`, otherwise prefer `pwsh.exe` and fall back to `powershell.exe`. Payload validation canonicalizes its root/item facts and excludes only the root-relative manifest leaf, while retaining duplicate, traversal and nested-extra-file rejection. The InstallDir assertion compares the returned path with the filesystem canonical path. Singleton-sensitive results, including the evidence-tree scanner and NVIDIA driver-DLL discovery, are explicitly array-wrapped before `.Count`.

Local post-repair verification is GREEN at NVIDIA contracts 36/36 and `npm.cmd test` 87 files / 549 tests passed with one contractually skipped live-key test; `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e` and `npm.cmd run build` passed. This is local portability enablement only: Cargo/Rust/Whisper, installer, GPU, model and Release Evidence were not run locally, `src-tauri/target` remained absent, and a new Clean Windows Harness result is still required after the repair commit is pushed.

### 2026-08-11 PR #32 Clean Windows contract-test timeout correction

Clean Windows Harness run `31471790846` on portability commit `e27a2d98eb5aad0ae784aedcc775b72d8b884b13` passed control-plane validation and reached `npm test`, where 548 tests passed and one live-key test skipped. Its only failure was the success-manifest contract integration test exceeding Vitest's default 5-second timeout: the test completed its five intentionally isolated PowerShell contract processes in 8233 ms under shared Windows runner load. The workflow therefore stopped before the frontend builds and Rust/Whisper gate and is not GREEN.

The correction leaves the global Vitest timeout unchanged and gives only that five-process integration test a 15-second budget. All five behavioral cases remain intact, so missing, out-of-order and duplicate phases are still rejected, the first duplicate record remains preserved, and a complete ordered phase set still writes a passed manifest. Local targeted verification completed the test in about 2 seconds and the NVIDIA contract file remained GREEN at 36/36; the full lightweight gates also passed with 87 test files / 549 tests passed and one live-key test skipped, followed by `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e` and `npm.cmd run build`. Cargo/Rust/Whisper, installer, GPU, model and Release Evidence were not run locally; `src-tauri/target` remained absent and a new Clean Windows Harness result is required after this correction is pushed.

### 2026-08-11 PR #32 Clean Windows Vitest worker-RPC correction

Clean Windows Harness run `31472428097` on timeout commit `b5aa31ef1efd5dbbf2e2a41506d501970ccb01b3` completed all assertions with 87 test files / 549 tests passed and one live-key test skipped, but Vitest then reported one unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"` error and exited 1. The NVIDIA contract file spent 71.65 seconds in synchronous child-process calls while Vitest's worker RPC uses a 60-second response budget. The local 15-second test timeout had allowed the five-case assertion to complete, but did not make the worker responsive; the workflow again stopped before frontend builds and the Rust/Whisper gate and is not GREEN.

The test harness now invokes PowerShell contracts and the runner with asynchronous `execFile` calls and awaits every result before asserting the same CLI output. A dedicated event-loop behavior regression races a zero-delay event-loop turn against a real PowerShell contract invocation: it failed while `spawnSync` blocked the worker and passes only when the event loop remains responsive during the child process. The package-level test command and global Vitest/RPC timeouts remain unchanged. Local post-repair verification is GREEN at NVIDIA contracts 37/37 and 87 test files / 550 tests passed with one live-key test skipped and no unhandled worker error, followed by `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e` and `npm.cmd run build`. Cargo/Rust/Whisper, installer, GPU, model and Release Evidence were not run locally; `src-tauri/target` remained absent and a new Clean Windows Harness result is still required.

Clean Windows Harness run `31473425771` on async worker-RPC commit `0d96b6d9a92e2132d18d82d9d2e3da18df17448a` subsequently completed successfully, including the repository Harness's clean-host Rust/Whisper gate. This establishes the PR's clean Windows Harness enablement at that commit; it is not installer/GPU/model Release Evidence and does not upgrade `AC-RL-08` from Partial.

### 2026-08-11 PR #32 child-process lifecycle correction

The asynchronous test adapter now gives each PowerShell invocation a 4000 ms process budget, below both Vitest's default 5000 ms test budget and the explicitly justified 15-second multi-invocation test budgets. Each active `ChildProcess` is paired with its settlement promise; timeout or test cleanup terminates it, the callback clears its timer and removes it from the active set, and `afterEach` waits for every active process to settle before deleting owned TEMP roots. Timeout and cleanup termination errors are explicit, and cleanup aggregates termination, settlement and TEMP-removal errors instead of silently continuing. Controlled short-lived hang regressions prove both the timeout path and the terminate/settle-before-delete ordering without starting Rain, installer, GPU or model work. Local post-correction gates are GREEN at NVIDIA contracts 39/39 and 87 test files / 552 tests passed with one live-key test skipped, followed by `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e` and `npm.cmd run build`; no local Cargo/Rust/Whisper or Release Evidence work ran and `src-tauri/target` remained absent.

Clean Windows Harness run `31475022498` on lifecycle commit `1f9f940c1fb983eda70fe58953cb12c77dad55ff` subsequently completed successfully. Final review then found one test-adapter cleanup gap: a denied `ChildProcess.kill()` could escape the timeout callback, while `afterEach` could wait without a separate upper bound and delete TEMP even though the child might still access it.

The follow-up separates invocation-result settlement from the child process's actual exit signal. A timeout kill failure now settles the invocation immediately with a clear blocking error but leaves the child tracked. Cleanup independently waits at most 250 ms for real process exit, aggregates termination failure, exit-settlement timeout and residual-active-child facts, and preserves/reports every owned TEMP root while any child may still access it. Normal termination still observes process exit before deleting TEMP. An injected fake child whose kill throws and whose exit never arrives proves the complete path returns within its bounded test window, reports all three failure classes, retains the TEMP path and cannot hang the Vitest worker; the normal real-child cleanup ordering regression remains GREEN.

Local follow-up gates are GREEN at NVIDIA contracts 41/41 and 87 test files / 554 tests passed with one live-key test skipped, followed by `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e` and `npm.cmd run build`. PowerShell AST and whitespace checks passed, no local Cargo/Rust/Whisper, installer, GPU, model or Release Evidence work ran, and `src-tauri/target` remained absent. A new Clean Windows Harness result is required for this follow-up commit; the prior successful remote run remains valid only for `1f9f940c`.

Clean Windows Harness run `31476650564` on bounded-cleanup commit `d4163c20ebe468a3d502ab18d213e96b82693532` reached `npm test` with 553 tests passing and one live-key test skipped, but its sole real-runner CLI test took 5299 ms and exceeded Vitest's unchanged global 5000 ms budget. That test invokes the real PowerShell runner twice. The shared 4000 ms child budget terminated the slower runner, after which the fail-closed cleanup correctly reported that the Windows child had not exited within 250 ms, retained its TEMP path and failed the test. The workflow stopped before builds and Rust/Whisper; this run is failed, and the cleanup result is expected protection rather than a lifecycle regression.

The correction separates workload budgets: lightweight contract PowerShell calls retain 4000 ms, each real runner CLI invocation receives 12000 ms, and only the two-invocation real-runner behavior test receives a 30000 ms Vitest budget. The runner allowance is more than twice the observed remote 5299 ms duration, while two maximum invocations plus the 2000 ms real-Windows cleanup-exit allowance remain below the local test ceiling. The global Vitest timeout is unchanged. The injected denied-kill/never-exit regression continues to supply its own 20 ms cleanup allowance, so bounded fail-closed behavior remains fast and is not relaxed.

Budget configuration was RED before this split and is GREEN after it. The real runner CLI behavior completed locally in about 1.2 seconds and still produced the expected provenance/readiness/checkout failure manifests; the complete NVIDIA file passed 42/42. Full local lightweight gates passed with 87 test files / 555 tests and one live-key test skipped, followed by `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e` and `npm.cmd run build`. No local Cargo/Rust/Whisper, installer, GPU, model or Release Evidence work ran, and `src-tauri/target` remained absent. A new Clean Windows Harness result is required for the correction commit.

## 2026-08-11 M3 controlled merged-target artifact build

Status: `In progress - local TDD GREEN; remote build not dispatched`. The user authorized a new non-release Slice on branch `codex/m3-controlled-merged-artifact-build`, created directly from merged `master` commit `3006757838b972b511917663e4ba8328804607d6`. The prior local checkout was the old PR #32 head and is not a permissible candidate source or artifact provenance substitute.

Slice contract:

- AC / gap: implementation support for `AC-RL-01`、`AC-RL-02`、`AC-RL-08`、`AC-RL-10` and `AC-RL-12`; no AC or coverage tier is promoted by this Slice.
- Observable result: a reviewed hosted-Windows-only control workflow can later build the exact candidate source, identify the source-derived NSIS installer by filename/kind plus basic MZ/PE shape, silently install it into a unique runner-TEMP directory, derive a machine-readable artifact manifest from the actual installed bytes, then silently run the generated uninstaller and verify cleanup before finally deleting any residual install directory. It uploads core installer/manifest/checksums first, then issues an independent controlled-build record plus manual administrator launcher as a second control artifact.
- Provenance boundary: candidate source target remains `3006757838b972b511917663e4ba8328804607d6`; the later workflow/generator/launcher control commit is a different `toolingCommit`. The build record, launcher and runner must validate both facts separately. The runner must never require its tooling checkout HEAD to equal the candidate source target.
- In scope: non-locked PowerShell generator/runner provenance interfaces and tests, build-worker portability, one new manual workflow, package wiring and Active control documents.
- Out of scope: existing Harness workflows, `harness/`, `src-tauri/tests/`, product runtime, local Cargo/Whisper/CUDA build, local installer/GPU/model/LLM execution, workflow dispatch, GitHub Release, signing, SBOM/notices, CUDA legal approval, lifecycle Evidence and real Release Evidence.
- Judge: fake installed-tree PowerShell CLI contracts; existing NVIDIA provenance contract; generated launcher contract; static workflow safety contract; then light local TypeScript/control/build gates only. The existing Clean Windows Harness remains the independent PR gate.

The pre-existing runner readiness facts were reconciled before implementation: cancellation fixture and session-scoped process adapter are implemented, but this non-administrator account receives `Access denied` from `Win32_ProcessStartTrace`; that remains a required fail-closed outcome. The eventual exact launcher must be run manually by the user in an elevated PowerShell and must not attempt `Start-Process -Verb RunAs`.

The A-F RED/GREEN seams are implemented locally: A generated a target-bound manifest and record from fake installed bytes; B rejected driver DLLs, builder paths, E2E markers, models, expanded secret forms and CUDA imports through the shared CUDA/NVIDIA classifier; C made the CUDA-worker builder hosted-path portable with invocation-owned target pruning; D required independent record provenance before installation and rejects `null` forbidden-finding categories fail-closed; E generated a manually elevated, tooling-commit-bound launcher with explicit atomic temporary-file cleanup failures; F statically bound manual `windows-2025` dispatch, fixed CMake 4.0.0 and all other pinned tool downloads/hashes, canonical-master reachability, conservative staged disk gates, immediate remote download cleanup, a real NSIS silent-install adapter with unique TEMP ownership, manifest generation before generated-uninstaller `/S` cleanup, and the first-core-upload digest before record/launcher/second-control-upload sequencing.

The first independent Spec and Standards review returned FAIL and no commit, push or dispatch occurred while findings were open. The corrections now bind the workflow, manifest, independent record, runner and launcher to canonical `llbz510/rain`; separately prove candidate-target and tooling-commit reachability from canonical `master`; record the canonical run URL/event/ref/id/attempt; derive product/version/identifier/NSIS naming from target-bound Tauri metadata, require only source-derived identity plus basic MZ/PE shape for the NSIS bootstrapper without constraining its PE machine, and require the installed `Rain.exe` to be AMD64 with the exact `resources/whisper-backends` payload set. They reject nonempty, missing or `null` forbidden-finding categories; reconcile the installed main executable, CUDA worker and complete CUDA/NVIDIA runtime-family DLL set, paths, sizes and SHA-256 values against the accepted release manifest before any GPU/runtime Judge; and run generated-uninstaller `/S`, verify its zero exit, the absence of every residual file under the installation root and observable system-side-effect cleanup, then finally remove residual TEMP ownership. CMake 4.0.0 is installed from its fixed URL/SHA-256 rather than a runner default; runner image/OS/architecture, Node/npm/Cargo/MSVC/NSIS and all tool-download hashes are bound into both manifest and independent record. Manifest, record and launcher publication is atomic with bounded retry and explicit aggregate temporary-cleanup failure, and destructive worker-target pruning requires a same-invocation ownership marker. The administrator handoff requires the user to verify the canonical run URL and second control-artifact digest before combining both downloaded artifacts; it never self-elevates.

Post-correction local gates are GREEN at 91 passed test files / 619 passed tests, with one contractually skipped live-key test (92 files / 620 tests total), followed by `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e`, `npm.cmd run build`, PowerShell AST parsing for every changed/new script and module, and working-tree plus staged `git diff --check`. The frontend builds emitted only the existing Vite dynamic/static import warnings. No generated installer, actual NSIS process, Cargo/Rust/Whisper/CUDA build, GPU, model or external service was run locally, `src-tauri/target` remains absent, and this workflow has not been dispatched. A corrected independent Spec and Standards re-review plus the first real hosted workflow run are still required; until then this Slice is not an artifact, Release, GPU Evidence or an AC promotion.

The second independent Spec/Standards review also remained fail-closed until its follow-up findings were corrected through RED-to-GREEN seams. The fixed CMake 4.0.0 extraction now enters standard command resolution and explicit environment/parameters for both the CUDA worker and separate Tauri/Cargo build, then is removed only by aggregate always/finally cleanup. Every native Git provenance/cleanliness call checks its exit status. Disk gates probe each distinct volume containing the actual `RUNNER_TEMP`, `GITHUB_WORKSPACE`, download, CMake and target paths. The persisted `installationProof` is logical and host-neutral: it binds the installer hash, silent-install outcome and relative installed identities but excludes `InstalledRoot` and raw `/D` absolute paths. The hygiene scanner now covers `.env.*`, PEM/key/properties, AWS `AKIA`, unknown readable text and debug artifacts, requires release payload configuration, and shares the expanded CUDA/NVIDIA family classifier including `nvToolsExt` and `nvopencl`.

The generated uninstaller is attempted whenever it exists, including post-install validation failure; its `/S` invocation must wait and exit zero, every residual file under the entire install root is rejected, observable system-side-effect state is reconciled, and Action/uninstall/residual cleanup errors are aggregated. Worker marker, owned target, workflow install/archive/CMake roots, generator atomic file and administrator launcher atomic file cleanup failures are likewise explicit and aggregated rather than swallowed. `AC-RL-12` retains the original installer archive/unpack Judge: the controlled workflow uses 7-Zip to expose an archive tree, and the generator scans that tree additively with—not instead of—the real installed tree. Active contract, module-map, plan, coverage and delivery documents now state that dual-Judge and CMake lifetime without promoting any AC.

Second-review targeted gates are GREEN at 6 files / 127 tests. The full light gate is GREEN at 92 passed test files / 640 passed tests plus one contractually skipped live-key file/test (93 files / 641 tests total), followed by `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e`, `npm.cmd run build`, AST parsing of all six changed/new PowerShell scripts/modules, fixed `HEAD` and merge-base `3006757838b972b511917663e4ba8328804607d6`, and both staged/working-tree `git diff --check`. Builds emitted only the existing Vite dynamic/static import warnings. No Cargo, generated or real installer process, Whisper/CUDA build, GPU, model, LLM/external service, workflow dispatch, commit or push occurred; `src-tauri/target` remains absent. Independent Spec and Standards re-review and the first disposable hosted workflow run remain required before this work can become artifact or Release Evidence.

Third-review closure is GREEN in the current uncommitted worktree. The manifest/runner contract rejects any `resources.cudaPayloadManifest.configuration` other than `release` and any hygiene scope set other than exactly `installed-tree`, `installer-archive`. The archive Judge now refuses an empty or bootstrapper-only 7-Zip tree before it can be scanned or declared clean; it requires AMD64 Rain and a hash-matched release payload. The workflow delegates native CUDA/LLVM/NSIS/CMake installation to `controlled-toolchain-install.psm1`, aggregates the primary, all cleanup and disk-gate errors, probes the actual `C:\Program Files` tool roots, and refuses to consume CMake unless the module published `cmakeReady`. Generated launcher Git provenance is tested both against a real failed native checkout and against the serialized helper's nonzero exit; no launcher Git call can treat a failed command as clean. NSIS uninstallation aggregates its process exit, all-root residual payload scan, registry/shortcut snapshot and owned-root cleanup errors; the worker ownership-only seam removes its temporary target. Seven focused suites passed 137 tests, and the full `npm.cmd test`, `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e`, `npm.cmd run build`, plus PowerShell AST parsing of eight changed/new scripts/modules all passed. The two builds emitted only the known Vite dynamic/static-import warnings. No Cargo/Rust/Whisper/CUDA build, installer execution, GPU/model/LLM run, workflow dispatch, commit or push occurred; `src-tauri/target` remains absent. This still requires independent Spec/Standards re-review and a disposable hosted workflow run before any artifact, Release or Evidence claim.

Fourth-review corrections remain within the same uncommitted, non-release Slice. Installed-artifact reconciliation now includes the actual CUDA payload-manifest path, byte size and SHA-256, including explicit tamper rejection. AWS `ASIA` temporary access keys and PEM private-key headers share the same secret classifier as existing key forms; readable unknown files are scanned before rejection, while PE `.exe`/`.dll` artifacts receive bounded streaming ASCII and both-alignment UTF-16LE token scans without treating arbitrary binary bytes as text. Ordinary PE-like fixture bytes remain accepted. The new `controlled-owned-directory.psm1` gives interruptible runner-TEMP directories sibling reservations bound to the exact invocation and target. It refuses pre-existing or foreign directories, aggregates cleanup failures without stopping later owned roots, and is wired into download, pinned CMake, CUDA worker, installer archive and generated install-root lifecycles. The workflow's `always()` step delegates residual TEMP cleanup to that ownership-checked module, so it cannot recursively delete an unreserved pre-existing path; the toolchain transaction independently refuses a pre-existing CMake root before installing or deleting anything. Local behavior/static tests cover both the owned cleanup and pre-existing-root negatives. The complete lightweight frontend/script suite passed 94 files / 659 tests, with one live-key file/test skipped by contract (95 files / 660 tests total); TypeScript, control-plane validation and both E2E/ordinary frontend builds also passed. No hosted workflow has run, so these are control-plane guarantees rather than an artifact or Release Evidence claim.

Fifth-review closure hardens the two remaining control-plane seams. A persisted TEMP marker now contains only the SHA-256 of a 256-bit random reservation token; the token itself is handed to the creating workflow step and never written into the marker. `controlled-toolchain-install.psm1` validates the exact downloads/CMake path, invocation owner, marker and token before it can call any install or cleanup adapter. Its `finally` removes downloads and incomplete CMake roots only through `controlled-owned-directory.psm1`, while a valid ready CMake reservation remains for the workflow's ownership-checked `always()` cleanup. Behavior tests prove that an unowned `C:\unowned`, a forged token and a pre-existing CMake root cannot trigger install or deletion, and that owned cleanup attempts every root and disk gate before reporting aggregated failures. `controlled-native-tool-probe.psm1` now owns native version-command execution: it captures output and `$LASTEXITCODE` together and returns a normalized fact only for exit zero plus nonblank output. The workflow routes node, npm, Cargo, rustup, rustc, Ninja, CMake, nvcc, clang and makensis probes through that module and constructs the toolchain record only afterward; a fake adapter proves plausible output with a nonzero exit is rejected. Focused verification passed 4 files / 17 tests. The complete lightweight frontend/script suite passed 95 files / 664 tests, with one live-key file/test skipped by contract (96 files / 665 tests total). No Cargo/Rust/Whisper/CUDA build, installer, GPU/model/LLM execution, dispatch, commit or push occurred, and these controls still require independent review plus the later disposable hosted workflow run.

Sixth-review closure removes the remaining owner-string and direct-cleanup bypasses in the same uncommitted Slice. `controlled-owned-directory.psm1` now writes schema-v2 markers whose HMAC binds the invocation owner, exact normalized target and per-directory reservation-token SHA-256 to a separate 256-bit invocation cleanup authority. The workflow creates that authority with a CSPRNG, masks it, passes it only through `GITHUB_ENV`, and does not persist it in a marker, artifact or record. Direct Open/Remove operations require both the reservation token and cleanup authority; the aggregate `always()` sweep requires the authority and verifies every marker HMAC, so a forged same-owner marker and foreign directory are preserved and reported. Downloads, CMake, worker target, archive root and generated NSIS install root use this interface; successful worker and install-root cleanup now also returns through the token-checked removal API, while interruption cleanup remains authority-checked. `release-artifact-generator.psm1` captures `dumpbin` output and exit status together and rejects nonzero, blank or unrecognizable PE import-table output before CUDA classification. The shared native probe also rejects exit-zero blank output, and the workflow routes `vswhere` through it before consuming the Visual Studio path. The module map records the authority/HMAC boundary and the complete probe set. Focused verification passed 6 files / 82 tests. The complete lightweight suite passed 96 files / 668 tests, with one live-key file/test skipped by contract (97 files / 669 tests total), followed by `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e`, `npm.cmd run build`, PowerShell AST parsing of all 10 changed/new scripts/modules, working and staged `git diff --check`, fixed HEAD/merge-base `3006757838b972b511917663e4ba8328804607d6`, and confirmation that `src-tauri/target` is absent. Builds emitted only the existing Vite dynamic/static-import warnings. No Cargo/Rust/Whisper/CUDA build, installer, GPU/model/LLM execution, workflow dispatch, commit or push occurred. Independent Spec/Standards review and the first disposable hosted workflow run remain required before any artifact, Release, Evidence or AC claim.

Seventh-review closure tightens the same ownership API without expanding product scope. Every reservation-token and cleanup-authority entry point now has `[ValidateNotNullOrEmpty()]` plus an explicit whitespace check, and internal reservation lookup always verifies the token hash instead of conditionally skipping it. Space/tab negatives are rejected; public reservation objects are now named `Rain.ControlledDirectoryReservation.v2`. The three upload-lifetime roots are no longer deterministic workflow-level paths: core artifact, control artifact and final assembly each receive a GUID-suffixed runner-TEMP direct-child path, HMAC-backed reservation and masked per-directory token before the directory is created. Their stable paths and tokens cross steps through `GITHUB_ENV`; consumer steps reopen them through the exact path/token/authority contract, existing/pre-created targets are rejected by the reservation module, and a final post-upload `always()` step runs the authority-checked aggregate sweep. Focused verification passed 3 files / 17 tests. The complete lightweight suite passed 96 files / 669 tests, with one live-key file/test skipped by contract (97 files / 670 tests total), followed by `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e`, `npm.cmd run build`, AST parsing of all 10 changed/new PowerShell files and working/staged `git diff --check`; builds emitted only the existing Vite dynamic/static-import warnings. Branch remains `codex/m3-controlled-merged-artifact-build`, HEAD and merge-base remain `3006757838b972b511917663e4ba8328804607d6`, `src-tauri/target` is absent, and no stale production v1 type or fixed artifact-root declaration remains. Independent review is still required; no Cargo/Rust/Whisper/CUDA build, installer, GPU/model/LLM execution, hosted workflow dispatch, commit, push, release or Evidence claim occurred.

Clean Windows Harness run `31723064771` on committed branch head `9539a679723f98b9ab458135158d9fe67170fdcd` supplied the next remote RED: 49 tests failed across four files during `npm test`. Forty-three release-artifact generator failures shared one cause: the hosted checkout supplied proof paths through the Windows 8.3 `C:\Users\RUNNER~1` alias while resolved inputs used `C:\Users\runneradmin`, and the NSIS proof compared those lexical strings. Three workflow-contract failures assumed LF although the remote checkout contained CRLF. The owned-directory forged-marker negative remained fail-closed but reached exact-target rejection before its expected HMAC rejection for the same alias reason. Of the two NVIDIA failures, one compared the same installed file through short and long parent paths and the other was an otherwise successful multi-process provenance test exceeding Vitest's default five-second budget under shared-runner load.

The portability correction compares existing installer, installed-root, main-executable, payload-manifest and silent `/D=` destinations by canonical filesystem identity, while preserving exact-root, path-type, byte-hash, `/S`, waited and zero-exit requirements. A new external behavior test obtains a real Windows 8.3 alias, proves it is accepted as the same bound install, and proves a different existing file is still rejected as an application-root escape. Workflow text is normalized from CRLF to LF once on read. The owned-directory forged marker records the fixture's canonical target so the negative exercises the intended invalid HMAC without weakening preservation, and NVIDIA path assertions compare canonical file identities. Only the remote-timed-out provenance integration test receives a 15-second budget; global and production timeouts are unchanged. The four formerly failing files are GREEN at 4 files / 128 tests. The complete lightweight suite is GREEN at 96 passed files / 670 passed tests plus one contractually skipped live-key file/test (97 files / 671 tests total), followed by `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e` and `npm.cmd run build`; builds emitted only the existing Vite dynamic/static-import warnings. Branch remains `codex/m3-controlled-merged-artifact-build`, HEAD remains `9539a679723f98b9ab458135158d9fe67170fdcd`, merge-base remains `3006757838b972b511917663e4ba8328804607d6`, and `src-tauri/target` is absent. These portability changes are uncommitted and require review plus a new clean-host run; no local Cargo/Rust/Whisper/CUDA build, installer, GPU/model/LLM execution, workflow dispatch, commit, push, release or Evidence claim occurred.

Clean Windows Harness run `31725194752` on committed head `e884649` reduced the preceding remote failure set from 49 to 6. One remaining NVIDIA contract failure was a test assertion that compared a short-path `/D=` destination lexically with its long-path spelling. The other five were valid manifest-to-record paths on PowerShell 7: `ConvertFrom-Json` materialized `controlledBuild.buildMetadata.builtAt` as a `DateTime`, while the contract compared its string rendering with the normalized ISO-8601 value.

The current uncommitted portability correction keeps the release contracts strict. The `/D=` assertion still requires exactly two arguments, `/S` and one raw `/D=<destination>` argument, and now proves that destination and the verified install root are the same existing filesystem identity. `New-RainControlledBuildRecord` normalizes a manifest timestamp represented as `DateTimeOffset`, `DateTime`, or a parseable invariant ISO string, then requires the same instant as the requested `BuiltAt`; it does not accept a merely parseable different timestamp. The reader seam is used only by the external contract test. New regression coverage proves a same-instant `DateTime` succeeds while a different instant, an invalid timestamp and a missing `builtAt` property each fail closed.

Current local verification is GREEN: the two directly affected files pass 116 tests; the complete lightweight suite passes 96 files / 671 tests, with one contractually skipped live-key file/test (97 files / 672 tests total). `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e`, `npm.cmd run build`, PowerShell AST parsing of the changed `release-artifact-generator.psm1`, and working-tree/staged `git diff --check` all pass. The normal builds retain only the existing Vite dynamic/static-import warnings. Branch remains `codex/m3-controlled-merged-artifact-build`; HEAD is `e884649`, merge-base is `3006757838b972b511917663e4ba8328804607d6`, and `src-tauri/target` is absent. No Cargo/Rust/Whisper/CUDA build, installer, GPU/model/LLM execution, workflow dispatch, commit or push occurred; a corrected independent review and another clean-host run are still required.

Clean Windows Harness run `31805706771` for PR #33 on committed head `c5678b41e872d00e65c9430bf3acfa5d5cd200a9` left only two RED assertions, both in `scripts/release-artifact-generator.test.ts`; the product tests were GREEN. The failing cases were `defers the controlled-build record until a first core-upload digest is available` and `accepts the same instant parsed as DateTime but fails closed for different, invalid, or missing manifest builtAt metadata`. In both cases, the PowerShell process returned a valid existing artifact path through the hosted runner's `RUNNER~1` 8.3 alias, while the test expected the long-path spelling. This was a test portability defect, not a generator or product behavior defect.

The follow-up correction changes only that test and this state document. `expectSameExistingFile` now first requires both paths to exist, compares their filesystem identities with `realpathSync.native`, and compares their bytes; it replaces the two lexical output-path assertions while retaining the `noRecordBeforeCoreUploadDigest` and controlled-record-content checks. Targeted generator verification is GREEN at 55/55 tests. The complete lightweight suite is GREEN at 96 passed files / 671 passed tests plus one contractually skipped live-key file/test (97 files / 672 tests total), followed by `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e` and `npm.cmd run build`; the ordinary build restores `dist` and retains only the existing Vite dynamic/static-import warnings. PowerShell AST parsing for all 13 script/module files, working-tree and staged `git diff --check`, and confirmation that `src-tauri/target` is absent all pass. No Cargo/Rust/Whisper/CUDA build, installer, GPU/model/LLM execution, workflow dispatch, commit or push occurred. The change needs review, commit/push, and a further Clean Windows Harness run before progressing to any hosted controlled build, artifact, Release, Evidence, or AC claim.

Clean Windows Harness run `31806779813` for PR #33 confirmed that product and release-artifact logic now pass. Its only two RED results were Vitest default-five-second timeouts in the external PowerShell contract tests at `release-artifact-generator.test.ts` lines 328 and 830: the first starts the generator twice (accepted 8.3 alias and rejected different existing path), while the second starts one manifest process plus four controlled-record processes (same-instant success plus different, invalid and missing timestamp rejections). The run did not identify a failed product assertion or a changed global test-timeout need.

The follow-up TDD correction adds only local `it` budgets: 15 seconds for the two-generator-process alias test and 30 seconds for the five-process timestamp test. Each comment cites run `31806779813`, Vitest's default five-second limit and its subprocess count. It neither splits, skips nor retries any case; it keeps every acceptance/rejection assertion and leaves Vitest's global timeout unchanged. Targeted verification is GREEN at 55/55 tests; the complete lightweight suite is GREEN at 96 passed files / 671 passed tests plus one contractually skipped live-key file/test (97 files / 672 tests total), followed by `npx.cmd tsc --noEmit`, `npm.cmd run harness:control`, `npm.cmd run build:e2e` and `npm.cmd run build`. No product code or release build action changed; PowerShell AST parsing for all 13 script/module files, working-tree and staged `git diff --check`, and confirmation that `src-tauri/target` is absent all pass.

## Maintenance checklist for every future session

Before making changes:

- Read `AGENTS.md`.
- Read this file completely.
- Check `git status --short --ignored` and distinguish source changes from ignored runtime/cache noise.
- Do not trust project progress claims unless backed by tests or evidence.

Before handing off after any project change:

- Update this file with:
  - branch/commit status;
  - files changed and why;
  - verification commands and results;
  - new or resolved defects;
  - new file-management rules if any.
- Run an appropriate verification command for the kind of change. For docs-only changes, `git diff --check` is enough unless build/test behavior changed.
- Keep the final response clear about what is committed, what is uncommitted, and what remains blocked.
