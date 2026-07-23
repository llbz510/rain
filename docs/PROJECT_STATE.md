# Rain Project State

> This file is the living project-state document for Rain. Every AI/developer session that changes the project must update it before handing off. Read this file before trusting old PRDs, plans, screenshots, or progress claims.

Last updated: 2026-07-23 21:26 +08:00
Current primary checkout after merge: `master` at `D:\gongju\shengcan\rain`
Merged repair branch through commit: `7a9eeb1 Clarify Rain project state document freshness`
Remote status: no git remote is configured; `git push -u origin codex/rain-real-local-video` fails because `origin` does not exist. Check current HEAD with `git log -1 --oneline` instead of trusting a self-referential commit hash in this document.

## Current verified status

Rain is a Tauri + React + TypeScript desktop study app with a Rust backend. The real local-video pipeline has been repaired enough to run a real lecture video through local Whisper ASR, Qwen/DashScope structuring, persistence, cancellation/retry proof, and final UI screenshot evidence.

The verified real input video is:

`D:\xiazaiwenjian\bilidown\【华中科技大学】电子技术基础 张林（全138讲）电子信息工程专业必修课\1.2.1 信号及其放大.mp4`

Curated evidence committed in this branch:

`evidence/rain-real-e2e-20260720-024848/`

Important evidence facts:

- Whisper backend: `cuda`
- Whisper model: `ggml-large-v3.bin`
- Qwen model: `qwen3.5-omni-flash`
- Qwen base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- ASR sentence count: 1953
- Qwen block count: 12
- Database status/stage: `ready` / `ready`
- Database node count: 59
- ASR timing: 413 seconds
- Qwen timing: 1061 seconds
- Pipeline timing: 1475 seconds

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
2. `docs/PROJECT_STATE.md` — current truth, recent changes, known defects, and file responsibilities.
3. `package.json` — runnable frontend/test/E2E commands.
4. `scripts/run-real-e2e.ps1` — real E2E automation and runtime environment assumptions.
5. `scripts/validate-evidence.ps1` — what counts as acceptable real evidence.

Do not infer real progress from PRD wording, old screenshots, or old evidence directories. Validate with commands or committed evidence.

## Directory and file responsibilities

| Path | Purpose | Notes |
| --- | --- | --- |
| `src/` | React/TypeScript application code. | Includes pipeline, models, settings, UI, and E2E runner entry guarded by environment config. |
| `src/pipeline/` | Frontend pipeline orchestration for ASR and Stage2 structuring. | `stage2-runner.ts` owns Qwen block calls and deterministic merge. |
| `src/llm/` | OpenAI-compatible LLM HTTP client. | Currently used for DashScope-compatible Qwen calls. |
| `src/models/` | Frontend database and domain models. | Uses Tauri SQL plugin; this is why `sql:allow-execute` exists. |
| `src/e2e/` | Real app automation helper for evidence generation. | Guarded by runtime environment; not normal user workflow code. |
| `src/__tests__/` | Product/unit/regression tests owned by implementation. | Can be modified when implementing features. |
| `harness/` | Locked frontend harness tests. | Do not modify unless user explicitly approves harness changes. |
| `src-tauri/` | Rust backend, Tauri config, capabilities, and Rust tests. | `src-tauri/target/` is local build output and ignored by `src-tauri/.gitignore`. |
| `src-tauri/tests/` | Locked Rust harness tests. | Do not modify unless user explicitly approves harness changes. |
| `scripts/` | Project automation scripts. | `run-real-e2e.ps1` runs real workflow; `validate-evidence.ps1` validates evidence. |
| `evidence/` | Curated proof artifacts only. | Failed/partial E2E runs are ignored by `.gitignore`; force-add only intentionally curated evidence. |
| `docs/` | Long-lived project docs, plans, specs, and this state document. | `docs/PROJECT_STATE.md` must be updated after every session that changes the project. |
| `docs/superpowers/` | Superpowers specs/plans used by prior agent work. | Historical plans/construction docs, not automatically current truth; plan checkboxes and old test counts are not progress evidence. |
| `prototype/` | Mockups and early prototypes. | Do not treat as runtime source. |
| `test-fixtures/` | Small test media fixtures. | `test-fixtures/sample.mp4` is intentionally tracked. |
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
9. The real E2E script is intentionally bound to this local machine setup: fixed local video hash/path assumptions, DashScope Qwen config, and D-drive CUDA/Ninja tooling paths. Treat it as a local verification script, not a portable CI script.
10. The main checkout at `D:\gongju\shengcan\rain` has been fast-forwarded to include the `codex/rain-real-local-video` repair branch through `7a9eeb1`. The separate worktree still exists and can be removed later only with explicit user approval.

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
