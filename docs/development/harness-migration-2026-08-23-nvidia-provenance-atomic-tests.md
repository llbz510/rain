# Rain Harness Migration — NVIDIA provenance atomic tests — 2026-08-23

> Status: Active
> Authorization: After receiving the old/new contract and two Hosted REDs, the user explicitly replied: “可以，别忘了更新计划”。
> Contract: `AC-RL-08` remains `Partial`; this migration does not issue Release Evidence or promote any AC.
> Purpose: preserve every provenance assertion while replacing an accidental aggregate five-second runner budget with four independently judged, default-budget cases.

## 1. Trigger evidence and old contract

`scripts/nvidia-release-evidence.test.ts` previously had one default-Vitest-timeout `it` named `requires an independent record to bind candidate target provenance separately from tooling provenance`. It serially created fixture records and called `invokeContract` four times: one accepted independent record, then records missing `coreArtifact`, carrying a wrong artifact-manifest SHA-256, and carrying a tooling commit inconsistent with the artifact manifest.

Each `invokeContract` starts a real PowerShell contract child with its own unchanged `4_000ms` budget. The combined outer Judge inherited Vitest's `5_000ms` default. Protected `Clean Windows Harness` run `32645461910` RED at `5057ms`, and run `32646313003` RED at `5069ms`, at the same old outer test. These failures did not report a failed provenance assertion. Five local complete old-scenario measurements were about `2.15–2.22s`; a temporary command-line-only `--testTimeout=1000` reproduced the structural RED locally without changing configuration.

## 2. Replacement contract and Judge mapping

The retired Judge is only the aggregate timeout shape. The four provenance observations, fixture isolation, PowerShell entry, and assertions are retained one-for-one as four default-`5_000ms` tests:

| Old observation inside one Judge | Replacement Judge |
| --- | --- |
| Accepted independent candidate target/tooling provenance record | `accepts an independent record that binds candidate target provenance separately from tooling provenance` |
| Missing controlled-build `coreArtifact` | `rejects an independent provenance record that omits coreArtifact` |
| Controlled-build artifact-manifest SHA-256 differs from the expected SHA-256 | `rejects an independent provenance record whose artifact-manifest SHA-256 is wrong` |
| Controlled-build tooling commit differs from artifact-manifest tooling commit | `rejects an independent provenance record whose tooling commit does not match its artifact manifest` |

Each replacement creates its own fixture and calls `invokeContract` exactly once. No test receives an explicit timeout. `contractProcessTimeoutMs` remains `4_000`; the production PowerShell contract module, runner, Evidence tests, global Vitest configuration, and all other timeout values remain unchanged. A failed or hung child still fails its own atomic Judge.

## 3. Allowed and forbidden boundary

Allowed writes for the test-behavior migration itself are only:

- the four nonlocked provenance test cases in `scripts/nvidia-release-evidence.test.ts`;
- this migration record;
- `docs/PROJECT_STATE.md`.

Forbidden writes include product source, `harness/`, `src-tauri/tests/`, the NVIDIA Evidence production module/runner, global Vitest timeout configuration, workflow, Evidence, installers, models, GPU execution, and release metadata. The two other NVIDIA Evidence tests that also exceeded their existing five-second outer budget in run `32645461910` are explicitly outside this migration and must receive a separate diagnosis and authorization.

The same user reply that authorized this migration also explicitly instructed “别忘了更新计划”. That instruction separately authorizes synchronization of `docs/development/agent-first-development-plan.md` and `docs/development/rain-project-delivery-plan.md` so the current controlled-build closeout transitions to a Launch functionality audit instead of automatically expanding M3 release work. This is required control-plane maintenance, not a second product implementation Slice: it changes no AC, Judge, Evidence tier or product behavior. The two plan files are outside the migration's test-behavior write boundary but inside that separately stated user authorization, and they must be reviewed with the same stable diff.

## 4. TDD, verification, and completion boundary

Before the split, the temporary command-line-only RED was:

```powershell
npm.cmd test -- --run scripts/nvidia-release-evidence.test.ts -t "requires an independent record to bind candidate target provenance separately from tooling provenance" --testTimeout=1000
```

The replacement is GREEN only when all four focused default-budget atomic tests pass with their original positive/negative assertions. Before review, run the permitted complete frontend test suite, TypeScript check, `harness:control`, E2E and ordinary frontend builds, PowerShell AST, whitespace check, and verify `src-tauri/target` is absent. Do not run Cargo, `harness:check`, an installer, GPU/model/LLM test, or new Evidence.

Independent Spec and Standards review must both pass the stable diff. A new protected `Clean Windows Harness` run is the only judge that can close the two Hosted timeout REDs. Even then, `AC-RL-08` remains `Partial`; no artifact, Release, Evidence, or AC upgrade follows from this Harness migration.
