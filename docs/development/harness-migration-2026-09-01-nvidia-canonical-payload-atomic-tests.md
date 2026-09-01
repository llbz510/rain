# Rain Harness Migration — NVIDIA canonical payload atomic tests — 2026-09-01

> Status: Active
> Authorization: User explicitly approved this reliability Slice after the aggregate Judge's concurrency diagnosis.
> Contract: `AC-RL-08` remains `Partial`; this migration neither runs Release Evidence nor promotes any AC.
> Purpose: preserve all seven canonical `whisper-backends` payload rejection assertions while replacing one concurrent aggregate Judge with seven independently judged default-budget cases.

## 1. Trigger evidence and old contract

The old Judge in `scripts/nvidia-release-evidence.test.ts` was `rejects provenance whose CUDA worker or runtime declarations leave the canonical whisper-backends payload set`. It created seven isolated artifact fixtures and launched their PowerShell `invokeContract` calls together through `Promise.all`, with one outer explicit 15-second timeout.

The user-authorized reliability diagnosis observed that the one-case and low-concurrency runs were GREEN, while high concurrency produced child `status: null` timeout results: 10-way was RED once in ten attempts, 12-way ten times in twelve attempts, and 16-way fifteen times in sixteen attempts. The public child-process boundary treats a timeout or termination as `status: null`, never as a successful rejection.

## 2. Replacement contract and Judge mapping

The retired shape is only the concurrent aggregate fan-out. The seven negative observations, each fixture's controlled-build record synchronization, the real PowerShell `invokeContract` boundary, the 4,000 ms child budget, `status === 1`, and its exact error matcher are retained one-for-one as default-budget atomic Vitest cases:

| Old observation | Atomic Judge case |
| --- | --- |
| CUDA worker path leaves canonical root | `CUDA worker path` |
| `cublas64_12.dll` path leaves canonical root | `CUDA runtime cublas64_12.dll path` |
| `cublasLt64_12.dll` path leaves canonical root | `CUDA runtime cublasLt64_12.dll path` |
| `cudart64_12.dll` path leaves canonical root | `CUDA runtime cudart64_12.dll path` |
| Unknown CUDA runtime declaration | `unknown CUDA runtime file` |
| Duplicate CUDA runtime declaration | `duplicate CUDA runtime file` |
| Missing CUDA runtime declaration | `missing CUDA runtime file` |

Each atomic case creates one fixture, mutates one manifest, synchronizes the record identity, and calls `invokeContract` exactly once. No case has an explicit timeout, no global timeout changes, and `contractProcessTimeoutMs` remains 4,000 ms. A `null` status, timeout, or incorrect error remains a failing Judge and is not retried or converted into a no-op.

## 3. Allowed and forbidden boundary

Allowed writes are limited to:

- the canonical payload aggregate case in `scripts/nvidia-release-evidence.test.ts`;
- this migration record; and
- the replace-only current handoff in `docs/PROJECT_STATE.md`.

Forbidden writes include the NVIDIA Evidence production module/runner, workflow, global Vitest configuration, `harness/`, `src-tauri/tests/`, all other NVIDIA tests, GPU/installer/model/LLM execution, Evidence, release metadata, product source, plans, coverage and Launch audit.

## 4. Verification and completion boundary

The RED fact is the observed high-concurrency timeout pattern above; it does not change a payload assertion or authorize a retry. GREEN requires the seven focused atomic cases to retain their individual fixture, `status === 1`, and exact error assertions, followed by an equivalent 12-way pressure replay that filters to the seven atomic cases without concurrent fan-out inside a single Judge.

The complete `scripts/nvidia-release-evidence.test.ts` suite, `npm.cmd run harness:control`, and `git diff --check` are required before review. Do not run `harness:check`, Cargo/Rust/Whisper/CUDA, installer/GPU/model/LLM work, workflow dispatch/rerun, or Release Evidence. Independent Spec and Standards reviews must pass the stable diff. A passing test migration does not authorize M3 resumption, a hosted rerun, merge, artifact, Evidence, or `AC-RL-08` upgrade.
