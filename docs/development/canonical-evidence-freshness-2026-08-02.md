# Canonical Evidence Freshness Audit — 2026-08-02

Status: Active audit record
Slice: M2-S2
Audited target: master commit b2fb7113318e389200b9ce07c912d8aebd4474f1
Canonical evidence: evidence/rain-real-e2e-20260726-195652/
Repository association commit: 408b6db9b37d753522e153d6b7801fe887500eb1

## Question and boundary

This audit answers which conclusions from the schema v2 canonical Evidence can still be cited, which are historical only, and which must be rerun before a Release Candidate. It does not run a paid model, mutate Evidence, change an AC, change a locked Judge, or claim a current full-pipeline pass.

The manifest does not contain a Git commit SHA. Commit 408b6db is the first commit that contains the complete schema v2 Evidence tree and the corresponding runner/validator changes, so it is the repository association point, not a cryptographic generation-time source binding.

## Read-only checks

- The complete Evidence tree is byte-for-byte unchanged between 408b6db and audited master b2fb711.
- Current manifest Git blob: 2eb15171c69ad4fed77f2d99e054f535f028e183.
- Current manifest SHA-256: 02BF2E82454DB0898806E367F8A54268789765D2F018E0028ABD8B1D4D4DFCF9.
- The current public validator returned ok=true, schemaVersion=2, backend=cuda, llmModel=qwen3-omni-flash, sentenceCount=1953 and structuringBlockCount=12.
- The recorded configuration is ggml-large-v3.bin CUDA ASR plus DashScope qwen3-omni-flash for structuring and text assistant.
- The database summary records ready/ready, 1953 sentences, 12 structuring blocks and 34 Nodes. The previous PROJECT_STATE value of 59 Nodes was incorrect and is corrected by this Slice.
- No Evidence file was generated, rewritten or staged during this audit.

## Freshness classification

| Claim | Classification | Reason | Required action |
| --- | --- | --- | --- |
| Video hash, transcript contents, block contents, counts, recorded configuration, timings and screenshots | Citable historical artifact facts | They are immutable tracked bytes and still pass the current validator | Always name Evidence ID and repository association 408b6db; do not present them as a current-target run |
| Evidence schema, cross-artifact consistency, secret scan and validator acceptance | Current reusable Judge over the historical artifact | The current validator accepts the unchanged package and its negative tests remain controlled | Keep using it as a regression fixture; this does not refresh product behavior |
| Exact model fingerprints and the three recorded Verified role records | Historical exact-configuration Evidence | They prove the named configuration completed the 408b6db-era path; the manifest has no current target binding | Rerun on the exact RC before claiming current Release verification |
| ASR/CUDA execution | Historical only for current product behavior | Rain now uses a CPU-safe main process plus isolated CUDA worker, Auto fallback and forced modes; the old CUDA log does not prove that route | Rerun the current worker path on the exact NVIDIA RC and separately complete clean no-NVIDIA CPU Release Evidence |
| Cancellation, retry and restart event chain | Historical only for current product behavior | ASR lifecycle, persistence seams, import-task ownership and explicit pending recovery changed after 408b6db | Rerun cancellation/retry and explicit pending recovery on the exact RC |
| ready/database persistence result | Historical only for current product behavior | Schema ownership and SQLite persistence were deeply refactored after 408b6db | Rerun against the current schema and production persistence commands on the exact RC |
| Study page DOM and screenshot | Historical only for current product behavior | Study loading, playback, navigation, notes, progress and layout behavior changed after 408b6db | Capture current production DOM and screenshots on the exact RC |
| ASR, structuring and total timings | Historical only; not Performance Evidence | Different runtime path, code and environment invalidate comparison to an RC | Do not use these numbers for AC-PF or release budgets |
| Current end-to-end local-video release claim | Current Evidence Gap | No paid full run has executed on b2fb711 or a later RC | One exact-RC full Evidence run is mandatory before RC exit |

## Coverage consequences

The current product tests remain Strong where they traverse public production interfaces. Rows that cited the schema v2 package as Evidence are now labelled Historical Evidence unless a newer exact-target run exists. AC-LV-09 has no current-target Evidence and is therefore a current Evidence Gap. AC-LV-11 still has a strong validator and a valid historical package, but that package cannot sign a current release. AC-LV-12 retains current Strong capability/runtime gates plus historical evidence for one exact configuration; it does not prove the isolated worker or current RC.

Affected coverage rows: AC-LV-03, AC-LV-05, AC-LV-07, AC-LV-08, AC-LV-09, AC-LV-11, AC-LV-12, AC-ST-01 and AC-ST-07. No Confirmed AC text or product disposition changes.

## Exact-RC rerun contract

Before RC exit, a new full Evidence run must:

1. Resolve and record the exact protected RC commit before execution.
2. Bind the Evidence to that commit through an approved schema migration or an independently verified external attestation; the current manifest is insufficient for cryptographic target binding.
3. Use the current production runner and a normal current build, not stale binaries or a SkipBuild shortcut.
4. Exercise current capability checks, import runtime gates, isolated CUDA worker selection, cancellation/retry, explicit pending recovery, current SQLite persistence and current StudyInterface DOM/screenshot.
5. Record input/model/artifact hashes, actual backend/device/worker protocol, configuration fingerprints and sanitized logs.
6. Pass the current validator and independent Evidence review.
7. Keep the clean no-NVIDIA CPU installation/sample, installer lifecycle, signing and release publication as separate M3/M10 Release Evidence; the NVIDIA full run cannot substitute for them.

A paid Qwen call and long real-video execution require explicit cost/external-state authorization in the later RC Evidence Slice. This audit does not grant that authorization.

## Result

M2-S2 is complete after independent Spec and Standards PASS. The canonical schema v2 package remains valuable historical Evidence and a current validator regression fixture, but it is not current RC Evidence. M3-S1 release artifact contract confirmation is the unique next action.
