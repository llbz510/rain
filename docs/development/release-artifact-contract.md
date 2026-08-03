# Rain Release Artifact Contract

> 状态：`Active`
> 更新日期：2026-08-03
> 路线图位置：M3-S1 Release artifact contract
> 授权边界：本文件只确认正式发布产物的可执行合同。它不构建安装器、不签发 Release Evidence、不批准 CUDA runtime 许可、不修改产品代码、不运行 GPU/CPU 短样本、不生成真实视频 Evidence。
> 支持矩阵修订：2026-08-03 用户确认 Core Release 只支持具备受支持 NVIDIA GPU + 兼容驱动的 Windows x64 主机；`AC-RL-07` 和 M3-S2 no-NVIDIA Judge 已退役。

## 1. Slice Contract

| 字段 | 本轮合同 |
| --- | --- |
| Slice | M3-S1：确认 Release artifact contract |
| AC / Proposed AC | `AC-RL-01`、`AC-RL-02`、`AC-RL-08`、`AC-RL-10`、`AC-RL-12`、`AC-RL-18` 的当前产物边界合同；`AC-RL-07` 仅保留 Superseded 历史 |
| User-visible result | 用户和 release reviewer 能看到唯一公开安装包、CPU-safe 主程序、隔离 CUDA payload、manifest、禁止项和后续 Evidence Judge 的精确边界 |
| In scope | Windows x64 NSIS 产物身份；安装/资源逻辑位置；CUDA worker/runtime payload；模型、数据库和设置位置边界；release artifact manifest 最小 schema；禁止打包项；后续 Judge 的输入输出 |
| Out of scope | 构建安装器；推送 GitHub Release；安装/重装/升级/卸载 Evidence；NVIDIA 短样本；代码签名；SBOM/notices 生成；CUDA legal approval；下载页/安装器 UI 实现 |
| Owner | Tauri release config、GPU bundle script、release manifest generator、artifact hygiene scanner、人类 release/legal owner |
| Judge | 当前 Slice：`npm run harness:control`、`git diff --check`、独立只读 Spec + Standards review。后续实现 Slice：本文件第 8 节的 artifact/Evidence Judge |
| Evidence tier | 文档控制面 + 独立审查；不升级任何 coverage 等级 |
| Allowed writes | 本文件、`control-map.md`、`agent-first-development-plan.md`、`rain-project-delivery-plan.md`、`harness-coverage.md`、`PROJECT_STATE.md` |
| Locked files | `harness/`、`src-tauri/tests/`、产品源码、workflow、Evidence、构建产物 |

## 2. Public Artifact Identity

Core Release 只允许一个用户可见下载物：

| 字段 | 合同 |
| --- | --- |
| Product | `Rain` |
| Version | `0.1.0` |
| Identifier | `com.rain.app` |
| Platform | Windows x64 |
| Installer type | NSIS `.exe` |
| Suggested file name | `Rain_0.1.0_x64-setup.exe` |
| Public channel | GitHub Releases |
| Public asset count | Exactly one installer asset for Windows x64; no public MSI, portable zip, CPU-only installer, GPU-only installer, source-map bundle, or debug build |

The public installer must be bound to one target Git commit and one installer SHA-256. Future RC and release records must never describe an artifact built from a different commit as the same accepted candidate.

## 3. Installed Layout Contract

The release Judge must discover and record the real installed absolute paths. The contract below defines the logical ownership and allowed path classes.

| Artifact class | Logical location | Owner and rule |
| --- | --- | --- |
| Rain main executable | Installed application root, e.g. the NSIS app install directory | Must remain CPU-safe. Its PE import table must not import `cublas64_12.dll`, `cublasLt64_12.dll`, `cudart64_12.dll`, `nvcuda.dll`, or other CUDA driver/runtime DLLs. |
| Tauri frontend/resources | Installed application resource area resolved by Tauri | Ordinary production resources must come from the normal `npm run build` artifact and must not contain E2E automation markers. |
| CUDA worker executable | Tauri resource path `whisper-backends/rain-whisper-cuda.exe` | Only this worker may link CUDA runtime for local Whisper. It must speak `workerProtocolVersion = 1`. |
| CUDA runtime DLLs | Tauri resource path `whisper-backends/` | Allowed runtime DLL names for the current contract are `cublas64_12.dll`, `cublasLt64_12.dll`, and `cudart64_12.dll`. |
| CUDA payload manifest | Tauri resource path `whisper-backends/payload-manifest.json` | Must list every CUDA payload file by name, size and SHA-256, record `workerProtocolVersion`, and record `driverLibraryBundled = false`. |
| NVIDIA driver DLL | Not installed by Rain | `nvcuda.dll` is supplied by the installed NVIDIA display driver and must not be bundled. |
| Whisper model files | App data directory `whisper-models/` | Models are downloaded or discovered after install by the existing model-download/listing contract. The installer must not include GB-scale model files unless a later AC explicitly confirms that change. |
| Runtime settings, SQLite, notes and app data | Tauri app config/app data locations for `com.rain.app` | Installer, uninstaller and artifact hygiene Judge must treat these as user data, not bundled program payload. |
| Source videos | User-selected paths outside Rain ownership | Installer and uninstaller must never delete or package user source videos. |

The existing GPU overlay in `src-tauri/tauri.gpu.conf.json` is the current implementation-adjacent path for staging the worker resources. It is not by itself Release Evidence; the accepted artifact must be inspected after packaging and installation.

## 4. CUDA Payload Contract

The Core Release installer is a single GPU-enhanced universal package:

- It includes the CPU-safe Rain main program and CPU adapter.
- It includes the isolated CUDA worker and the allowed CUDA runtime DLLs in `whisper-backends/`.
- It does not include `nvcuda.dll`.
- It does not require CUDA Toolkit on the end-user machine.
- `Auto` may use CUDA only through the installed resource worker. CPU-safe startup and fallback remain implementation properties, but the Core Release support matrix requires a supported NVIDIA device and compatible driver.
- Forced CPU must not start the CUDA worker.
- Forced GPU must fail closed when the worker/runtime/device is unavailable.

The current approximate payload size remains about 804 MB, but size must be re-measured from the target installer and recorded in the release artifact manifest before any public disclosure.

## 5. Release Artifact Manifest

Every RC and formal release must publish a machine-readable artifact manifest generated from the built artifact, not handwritten from intended values.

Required minimum fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Manifest schema version for the release artifact contract |
| `productName` | Must be `Rain` |
| `version` | Must match Tauri version `0.1.0` for this release |
| `identifier` | Must be `com.rain.app` |
| `targetCommit` | Full Git commit SHA used to build the installer |
| `installer.fileName` | Public installer file name |
| `installer.sha256` | SHA-256 of the installer bytes |
| `installer.sizeBytes` | Installer byte length |
| `installer.kind` | Must identify NSIS Windows x64 |
| `mainExecutable.path` | Installed Rain executable path observed by the Judge |
| `mainExecutable.sha256` | SHA-256 of installed main executable |
| `mainExecutable.cudaImportsPresent` | Must be `false` |
| `resources.cudaWorker.path` | Installed worker path |
| `resources.cudaWorker.sha256` | SHA-256 of worker executable |
| `resources.cudaWorker.protocolVersion` | Must equal the production worker protocol version |
| `resources.cudaRuntime.files[]` | Name, installed path, size and SHA-256 for each allowed CUDA runtime DLL |
| `resources.cudaRuntime.driverLibraryBundled` | Must be `false` |
| `resources.cudaRuntime.distributionApproval` | Reference to human legal approval; may be `pending` for RC-internal candidates but must be approved before public release |
| `forbiddenFindings` | Results for secret/path/user-data/E2E/debug/driver-DLL scans |
| `generatedAt` | Generation timestamp |
| `generator` | Script/tool identity and version |

The manifest is not a substitute for the separate SBOM, notices, signature verification, CPU/GPU runtime Evidence or release notes. It is the common artifact identity that those records must reference.

## 6. Forbidden Contents

The installer, installed program directory and packaged resources must not contain:

- API keys, live-key fixtures or `.env` secrets.
- `RAIN_E2E_*` automation markers, real E2E runner UI markers, or E2E-only source maps in the production artifact.
- Debug worker overrides such as release-time dependence on `RAIN_WHISPER_CUDA_WORKER`.
- Developer absolute paths from this workstation or CI checkout paths, except inside signed diagnostic metadata explicitly approved by a later AC.
- SQLite databases, user settings, notes, user media, old Evidence directories, logs or temporary failure diagnostics.
- `nvcuda.dll` or any unapproved CUDA/driver DLL.
- Model files outside the app-data `whisper-models/` lifecycle.

## 7. Evidence Boundaries

This contract deliberately keeps current coverage conservative:

- `AC-RL-01` remains Gap until a target installer and public asset/SHA Judge exist.
- `AC-RL-02` remains Partial until the installed artifact proves CPU-safe imports plus exact worker/runtime/manifest contents.
- `AC-RL-07` is Superseded by the 2026-08-03 GPU-required release migration; no no-NVIDIA Release Evidence is required.
- `AC-RL-08` remains Partial until the same installer passes an NVIDIA Windows Auto/Forced/CPU/cancel/error Judge.
- `AC-RL-10` remains Gap until the artifact manifest, SBOM and notices are generated from the same target SHA.
- `AC-RL-12` remains Partial until an unpacked-installer hygiene scanner proves the forbidden contents are absent.
- `AC-RL-18` remains Gap until public download and installer UI text are judged against the actual artifact manifest and runtime Evidence.

No existing local GPU smoke, historical schema v2 video Evidence or clean Windows Harness run can be promoted into these Release Evidence slots.

## 8. Required Future Judges

The next runtime Evidence Slice is M3-S3 on a supported NVIDIA Windows host. Later Slice contracts must stay separate:

| Future Slice | Required Judge |
| --- | --- |
| M3 artifact generator | Builds from clean checkout, produces one NSIS installer, generates artifact manifest from bytes and installed files, and verifies main executable CUDA imports are absent |
| M3-S2 no NVIDIA/CUDA Evidence | `Retired` — `AC-RL-07` and its runner were superseded by the 2026-08-03 GPU-required release migration |
| M3-S3 NVIDIA Evidence | Uses `CONTEXT.md`'s production probe + model-memory predicate, records and signs only the exact GPU/driver/memory/protocol/package/model configuration, then proves Auto CUDA, Forced CUDA, Forced CPU no-worker, cancellation and classified worker/model failures |
| M3 lifecycle Slices | Clean install, same-version reinstall, old-fixture upgrade, uninstall and reinstall each record file/user-data manifests separately |
| M3-S5 signing/SBOM/legal/hygiene | Separately verifies signature, SBOM/notices, human CUDA redistribution approval and forbidden-content scan |
| M3-S6 disclosure UX | Verifies download page and installer UI text against the artifact manifest, NVIDIA Evidence, the executable host-eligibility predicate and only the exact configurations signed by valid M3-S3 Evidence |

If any future Judge finds the current Tauri config, resource layout or CUDA file list cannot satisfy this contract, the fix must be a new implementation Slice with its own review. Do not silently weaken this document to match a failing artifact.

## 9. M3-S1 Completion Conditions

- This file is Active and linked from the control plane.
- M3-S1 status changes from Next to Complete in the project roadmap only after independent Spec and Standards PASS.
- `harness-coverage.md` remains conservative: no Release AC is upgraded by this docs-only contract.
- `docs/PROJECT_STATE.md` records the Slice, validation, review findings and next single action.
- No product source, locked Harness, workflow, Evidence or generated artifact is modified.
