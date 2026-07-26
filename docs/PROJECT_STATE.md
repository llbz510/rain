# Rain Project State

> This file is the living project-state document for Rain. Every AI/developer session that changes the project must update it before handing off. Read this file before trusting old PRDs, plans, screenshots, or progress claims.

Last updated: 2026-07-26 +08:00
Current primary checkout after merge: `master` at `D:\gongju\shengcan\rain`
Current working base: `fb16dfb feat: gate verified evidence by model capability`
Remote status: no git remote is configured; `git push -u origin codex/rain-real-local-video` fails because `origin` does not exist. Check current HEAD with `git log -1 --oneline` instead of trusting a self-referential commit hash in this document.

## Current verified status

Rain is a Tauri + React + TypeScript desktop study app with a Rust backend. The real local-video pipeline has been repaired enough to run a real lecture video through local Whisper ASR, Qwen/DashScope structuring, persistence, cancellation/retry proof, and final UI screenshot evidence.

The verified real input video is:

`D:\xiazaiwenjian\bilidown\【华中科技大学】电子技术基础 张林（全138讲）电子信息工程专业必修课\1.2.1 信号及其放大.mp4`

Current schema v2 canonical evidence committed in this branch:

`evidence/rain-real-e2e-20260726-195652/`

Important evidence facts:

- Whisper backend: `cuda`
- Whisper model: `ggml-large-v3.bin`
- Structuring/text-assistant model: `qwen3-omni-flash`
- OpenAI-compatible base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- ASR sentence count: 1953
- Structuring block count: 12
- Database status/stage: `ready` / `ready`
- Database node count: 59
- ASR timing: 1408 seconds
- Structuring timing: 1050 seconds
- Pipeline timing: 2459 seconds
- Role status: the same configuration fingerprint passed ASR, structuring and text-assistant `Compatible` checks and was then recorded as `Verified`
- Runtime gates: missing ASR/structuring capability was rejected by `VideoImportController`; missing assistant capability was rejected before chat
- UI proof: WebDriver captured the production study page with the matching video, visible player and 21 rendered paragraphs
- Scope: this proves the named configuration and text assistant only; it does not verify other compatible models or vision

The previous schema v1 evidence at `evidence/rain-real-e2e-20260720-024848/` remains valid historical evidence for its recorded configuration, but it is not the current schema v2 capability proof.

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
5. `docs/development/harness-coverage.md` — AC-to-test/evidence coverage and gaps.
6. `docs/development/module-map.md` — module responsibilities, interfaces, and migration rules.
7. `package.json` — runnable frontend/test/E2E commands.
8. `scripts/run-real-e2e.ps1` — real E2E automation and runtime environment assumptions.
9. `scripts/validate-evidence.ps1` — what counts as acceptable real evidence.

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

1. No remote is configured, so push currently fails until a remote is added.
2. The main workspace has a lot of local build/cache data: `.worktrees/` was about 86.62GB during the 2026-07-22 check; `src-tauri/target` in the main workspace was about 15.33GB.
3. Historical failed evidence runs exist locally. `.gitignore` now hides new/old untracked run directories from normal status, but no destructive cleanup has been performed.
4. `sql:allow-execute` is currently enabled because the frontend database layer executes SQL through the Tauri SQL plugin. This is acceptable for a local-only trusted WebView, but it is broader than ideal if remote/untrusted content is ever loaded.
5. Real E2E code is imported from `src/App.tsx` behind an environment guard. This works, but a cleaner long-term boundary would isolate automation from the production bundle more strongly.
6. ASR output is readable Chinese and no longer mojibake, but recognition accuracy is not perfect. For example, lecture terms can still be misrecognized by Whisper.
7. The final Stage2 merge is deterministic local merging rather than a final global Qwen merge. This avoids DashScope token/rate failures and keeps every sentence covered, but it may produce less globally polished chapter naming than a successful global model merge.
8. Many root-level historical docs (`M*.md`, `PRD.md`, `HANDOFF.md`) make the root directory crowded and can mislead new agents if read as current truth without this state file.
9. The real E2E script is intentionally bound to this local machine setup: fixed local video hash/path assumptions and D-drive CUDA/Ninja tooling paths. Its LLM endpoint/model are now configurable through generic OpenAI-compatible environment variables, but it remains a local verification script rather than portable CI.
10. The main checkout at `D:\gongju\shengcan\rain` has been fast-forwarded to include the `codex/rain-real-local-video` repair branch through `7a9eeb1`. The separate worktree still exists and can be removed later only with explicit user approval.
11. PowerShell console output can display Chinese text as mojibake in some command pipelines. Check UTF-8 files with a direct UTF-8 reader before concluding that project artifacts are corrupt.
12. `git status` may show `M src-tauri/Cargo.toml` even when `git diff --exit-code -- src-tauri/Cargo.toml` returns 0. The observed cause is line-ending normalization: the committed blob contains CRLF line endings while the working-tree file has LF line endings under `core.autocrlf=true`. Treat this as a line-ending/index hygiene issue, not a Rust dependency change, unless `git diff` shows real content.
13. DEC-001's generic records, stale-result invalidation, role-assignment gate, real short-sample Whisper probe, provider-neutral structuring and text-assistant probes, preflight integration, local-video runtime gate, learning-page assistant gate, and schema v2 Evidence Harness are implemented. `AC-LV-12` has Strong + Evidence for the exact `ggml-large-v3.bin` CUDA + DashScope `qwen3-omni-flash` structuring/text-assistant configuration. Other model fingerprints remain merely `Compatible` or `Unavailable` until they receive their own complete evidence.
14. Advanced tree editing is not in the current Active acceptance scope. Its old Harness-only implementation and no-op controls were removed; restoring it requires a new AC plus real UI, persistence, and behavior tests.

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
- persistence: the matching video reached `ready`, with 1953 sentences and 59 nodes;
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
