# Rain Harness Migration — Evidence Validator Hosted Timeout — 2026-08-02

> Status: Active
> Authorization: On 2026-08-02, after receiving the PR #25 Clean Windows RED, the old/new timeout contract, and the unchanged-assertion boundary, the user explicitly replied "批准".
> Contracts: `AC-LV-11`, `AC-LV-12`; the validator also supports `AC-LV-09` and `AC-RL-14`.
> Purpose: give the Evidence validator integration Judge that starts real `powershell.exe` a finite, local Hosted Windows environment budget without changing the validator, fixture semantics, or any positive/negative assertion.

## 1. Trigger evidence and old contract

PR #25 head `9a1e62ba9d789047ad868ead760957ade25e2160` passed local `npm run harness:check`. Protected `Clean Windows Harness` run `30752033590` then ran the same command from a clean `windows-2025` checkout. Control validation passed, but the first positive case in `scripts/validate-evidence.test.ts` completed after 9.221s and was rejected by Vitest's implicit 5s timeout. The other 17 cases in that file passed or were intentionally skipped, and the failed log contained no Evidence assertion error.

The old contract did not assign an environment budget to this external-process Judge, so it inherited the 5s default intended for ordinary in-memory unit tests. The case synchronously starts a new Windows PowerShell process, reads a complete fixture, hashes the media file, and recursively scans the fixture for secret-like tokens. Five isolated local runs took 0.586–0.642s, while a Hosted cold start under parallel suite load exceeded 5s. The inherited default therefore judged runner scheduling rather than the Evidence contract.

Deterministic RED command:

```powershell
.\node_modules\.bin\vitest.cmd run scripts/validate-evidence.test.ts -t "accepts clean evidence shaped like real Stage2BlockOutput artifacts" --testTimeout=500 --reporter=verbose
```

It failed in 1.51s with `Test timed out in 500ms` at the same case. This is a fast signal for the environment-budget boundary; the original positive and negative assertions still judge validator correctness.

## 2. Replacement contract

- Only the `describe('evidence validator', ...)` suite receives an explicit `30_000ms` timeout.
- The pure static `real E2E runner GPU preference` suite retains the normal Vitest default.
- `scripts/validate-evidence.ps1`, fixtures, and all hash/mojibake/demo/CUDA/structure/cancellation/restart/database/capability/DOM/screenshot/secret assertions remain unchanged.
- The 30s value is finite environment headroom, not a performance AC. A hang, nonzero exit, or incorrect output still fails.
- Default `npm test`, `harness:check`, GitHub `Harness`, and every other test timeout remain unchanged.

## 3. Retired shadow and write boundary

This migration retires only the accidental rule that the external PowerShell suite inherits the 5s in-memory default. The replacement Judge is the same test file calling the same production validator; no shadow validator or duplicated assertion is introduced.

Allowed writes:

- `scripts/validate-evidence.test.ts`;
- `docs/development/harness-coverage.md`;
- this migration record;
- `docs/PROJECT_STATE.md`.

Forbidden writes: `scripts/validate-evidence.ps1`, product source, `harness/`, `src-tauri/tests/`, workflows, Evidence, installers, models, or video data.

## 4. Verification and review

Before commit:

1. The deterministic 500ms RED must turn GREEN under the local 30s suite contract.
2. The complete `scripts/validate-evidence.test.ts` file must pass with every original positive/negative case still executing.
3. `npm run harness:control`, `git diff --check`, and full `npm run harness:check` must pass.
4. Independent read-only Spec and Standards reviewers must both return no P0/P1/P2 against the same stable diff.

After commit and push, before merge:

- A new PR #25 `Clean Windows Harness` run must pass on the updated head.

This migration does not issue product or Release Evidence, run the Hosted Runtime Settings workflow, or promote a coverage tier.
