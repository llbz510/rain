import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..')
const workflowPath = join(repoRoot, '.github', 'workflows', 'controlled-gpu-artifact-build.yml')
const workerBuildScriptPath = join(repoRoot, 'scripts', 'build-whisper-cuda-worker.ps1')
const toolchainInstallModulePath = join(repoRoot, 'scripts', 'controlled-toolchain-install.psm1')
const ownedDirectoryModulePath = join(repoRoot, 'scripts', 'controlled-owned-directory.psm1')
const candidateTargetCommit = '3006757838b972b511917663e4ba8328804607d6'
const checkoutAction = 'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683'
const uploadArtifactAction = 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'
const pinnedNsisDirectUrl = 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.11/nsis-3.11-setup.exe'
const legacyNsisDownloadPageUrl = 'https://sourceforge.net/projects/nsis/files/NSIS%203/3.11/nsis-3.11-setup.exe/download'

function resolvePowerShellExecutable() {
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    const probe = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$null'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (probe.status === 0) return candidate
  }
  throw new Error('controlled GPU artifact workflow tests require pwsh.exe or powershell.exe.')
}

const powerShellExecutable = resolvePowerShellExecutable()

function readWorkflow() {
  return readFileSync(workflowPath, 'utf8').replace(/\r\n/g, '\n')
}

function workflowRunBlock(workflow: string, stepName: string) {
  const stepStart = requiredIndex(workflow, `      - name: ${stepName}\n`)
  const runStart = requiredIndex(workflow.slice(stepStart), '        run: |\n') + stepStart
  const bodyStart = runStart + '        run: |\n'.length
  const nextStep = workflow.indexOf('\n      - name:', bodyStart)
  return workflow.slice(bodyStart, nextStep >= 0 ? nextStep : workflow.length)
    .split('\n')
    .map((line) => line.startsWith('          ') ? line.slice(10) : line)
    .join('\n')
}

function parsePowerShell(source: string) {
  const encodedSource = Buffer.from(source, 'utf8').toString('base64')
  const parserCommand = [
    `$source = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedSource}'))`,
    '$tokens = $null',
    '$parseErrors = $null',
    '[void][System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)',
    'foreach ($parseError in $parseErrors) { [Console]::Error.WriteLine($parseError.Message) }',
    'if ($parseErrors.Count -gt 0) { exit 1 }',
  ].join('\n')
  const result = spawnSync(powerShellExecutable, [
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    Buffer.from(parserCommand, 'utf16le').toString('base64'),
  ], {
    encoding: 'utf8',
    windowsHide: true,
  })
  return {
    status: result.status,
    error: result.error?.message,
    output: `${result.stdout}\n${result.stderr}`.trim(),
  }
}

function requiredIndex(source: string, needle: string) {
  const index = source.indexOf(needle)
  expect(index, `missing workflow contract text: ${needle}`).toBeGreaterThanOrEqual(0)
  return index
}

function buildJobEligibilityExpression(workflow: string) {
  const match = workflow.match(/jobs:\s*\r?\n\s*build:\s*[\s\S]*?\r?\n\s*if:\s*([^\r\n]+)/)
  expect(match, 'build job must declare an eligibility expression').not.toBeNull()
  return match![1].trim()
}

function assertCanonicalDispatchEligibility(workflow: string) {
  const expression = buildJobEligibilityExpression(workflow)
  expect(expression).not.toMatch(/\benv\./)
  expect(expression).toBe(`\${{ github.repository == 'llbz510/rain' && github.ref == 'refs/heads/master' && inputs.confirm_target == 'BUILD-${candidateTargetCommit}' }}`)
}

function assertPinnedCmakeConsumers(workflow: string, toolchainModule: string) {
  expect(toolchainModule).toContain('foreach ($pathLine in @($llvmBin, $nsisHome, $cmakeBin))')
  expect(toolchainModule).toContain('& $adapterToUse.appendLine $GitHubPathFile $pathLine')
  expect(toolchainModule).toContain('"CMAKE=$cmakePath"')
  expect(workflow).toContain("if ($env:TOOLCHAIN_CMAKE_READY -ne 'true')")
  expect(workflow).toContain('$resolvedBuildCmake = (Get-Command cmake.exe -ErrorAction Stop).Source')
  expect(workflow).toContain("if (-not [string]::Equals($resolvedBuildCmake, $env:CMAKE_PATH, [System.StringComparison]::OrdinalIgnoreCase))")
  expect(workflow).toContain('-CmakePath $env:CMAKE_PATH')
}

function assertReservedCmakeRootIsolatedFromBuildChildren(workflow: string, toolchainModule: string, workerBuildScript: string) {
  const buildBlock = workflowRunBlock(workflow, 'Build CUDA worker and NSIS candidate remotely')
  const workerInvocation = requiredIndex(buildBlock, '& $workerScript -ProjectRoot $candidateRoot')
  const tauriInvocation = requiredIndex(buildBlock, 'npx.cmd --no-install tauri build --config src-tauri/tauri.gpu.conf.json')
  const removal = 'Remove-Item -LiteralPath Env:CMAKE_ROOT -ErrorAction SilentlyContinue'
  const workerRemoval = requiredIndex(workerBuildScript, removal)
  const workerCargoInvocation = requiredIndex(workerBuildScript, '& cmd.exe /d /s /c $commandLine')
  const tauriRemoval = buildBlock.lastIndexOf(removal, tauriInvocation)

  expect(toolchainModule).not.toMatch(/"CMAKE_ROOT=/)
  expect(toolchainModule).toContain('$cmakePackageRoot = Split-Path -Parent $cmakeBin')
  expect(toolchainModule).toContain('cmakeRoot = $cmakePackageRoot')
  expect(workerRemoval).toBeLessThan(workerCargoInvocation)
  expect(tauriRemoval).toBeGreaterThan(workerInvocation)
  expect(tauriRemoval).toBeLessThan(tauriInvocation)
  expect(workflow).toContain('$cmakeRoot = Split-Path -Parent (Split-Path -Parent $cmakePath)')
  expect(workflow).toContain('cmake = [ordered]@{ version = $cmakeVersion; minimumVersion = $env:CMAKE_MINIMUM_VERSION; executable = $cmakePath; root = $cmakeRoot }')
}

function assertNativeGitFailureClosed(workflow: string) {
  expect(workflow).toContain('function Invoke-ControlledGitText')
  expect(workflow).toContain('$exitCode = $LASTEXITCODE')
  expect(workflow).toContain("$controlStatus = Invoke-ControlledGitText $controlRoot 'Control tooling status' @('status', '--porcelain', '--untracked-files=all')")
  expect(workflow).toContain("$candidateStatus = Invoke-ControlledGitText $candidateRoot 'Candidate status' @('status', '--porcelain', '--untracked-files=all')")
  expect(workflow).toContain('$candidateCleanupStatusExitCode = $LASTEXITCODE')
  expect(workflow).toContain("if ($candidateCleanupStatusExitCode -ne 0) { throw \"Could not verify candidate cleanup status: $candidateCleanupStatusExitCode\" }")
}

describe('controlled GPU artifact build workflow contract', () => {
  it('is a manual, two-artifact hosted build that binds the exact merged candidate before evidence can exist', () => {
    expect(existsSync(workflowPath), 'controlled build workflow must exist').toBe(true)
    const workflow = readWorkflow()
    const toolchainModule = readFileSync(toolchainInstallModulePath, 'utf8')

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).not.toMatch(/^\s*(?:pull_request|push|release):/m)
    expect(workflow).toContain(`CANDIDATE_TARGET_COMMIT: ${candidateTargetCommit}`)
    expect(workflow).toContain(`BUILD-${candidateTargetCommit}`)
    assertCanonicalDispatchEligibility(workflow)
    expect(workflow).toContain('permissions:\n  contents: read')
    expect(workflow).toContain('runs-on: windows-2025')
    expect(workflow).not.toContain('RAIN_CONTROLLED_WINDOWS_RUNNER')
    expect(workflow).toContain('timeout-minutes: 180')
    expect(workflow).toContain('CMAKE_MINIMUM_VERSION: 4.0.0')
    expect(workflow).toContain("CUDA_ARCHITECTURES: '120'")

    expect(workflow).toContain(checkoutAction)
    expect(workflow).toContain('path: control')
    expect(workflow).toContain('ref: ${{ github.sha }}')
    expect(workflow).toContain('path: candidate')
    expect(workflow).toContain(`ref: ${candidateTargetCommit}`)
    expect(workflow).toContain('persist-credentials: false')
    expect(workflow).toContain("if ($env:GITHUB_REPOSITORY -ne 'llbz510/rain')")
    expect(workflow).toContain("$canonicalOrigin = 'https://github.com/llbz510/rain.git'")
    expect(workflow).toContain("@('remote', 'get-url', 'origin')")
    expect(workflow).toContain("Assert-CanonicalOrigin $controlRoot 'Control tooling'")
    expect(workflow).toContain("Assert-CanonicalOrigin $candidateRoot 'Candidate'")
    expect(workflow).toContain("Invoke-ControlledGitText $controlRoot 'Canonical master fetch for tooling reachability'")
    expect(workflow).toContain("Invoke-ControlledGitText $controlRoot 'Control tooling reachability from canonical master'")
    expect(workflow).toContain("Invoke-ControlledGitText $candidateRoot 'Canonical master fetch for candidate reachability'")
    expect(workflow).toContain("Invoke-ControlledGitText $candidateRoot 'Candidate reachability from canonical master'")
    assertNativeGitFailureClosed(workflow)
    expect(workflow).toContain('dumpbin.exe')
    expect(workflow).toContain('BUILT_AT=$builtAt')
    expect(workflow).toContain('WORKFLOW_RUN_URL=https://github.com/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID/attempts/$env:GITHUB_RUN_ATTEMPT')
    expect(workflow).toContain('-BuiltAt $env:BUILT_AT')
    expect(workflow).toContain('-Repository $env:GITHUB_REPOSITORY')
    expect(workflow).toContain('-WorkflowRunUrl $env:WORKFLOW_RUN_URL')
    expect(workflow).toContain('-WorkflowEvent $env:GITHUB_EVENT_NAME')
    expect(workflow).toContain('-WorkflowRef $env:GITHUB_REF')
    expect(workflow).toContain('-CandidateMasterReachable $true -ToolingMasterReachable $true')
    expect(workflow).toContain("'before-download'")
    expect(toolchainModule).toContain("'before-install'")
    expect(workflow).toContain("'before-cuda-worker-build'")
    expect(workflow).toContain("'before-tauri-package'")
    expect(workflow).toContain("Import-Module -Name (Join-Path $controlRoot 'scripts\\controlled-build-disk.psm1')")
    expect(workflow).toContain("-Paths @($env:RUNNER_TEMP, $env:GITHUB_WORKSPACE)")
    expect(toolchainModule).toContain("@($DownloadsRoot, $CmakeExtractRoot, $cudaRoot, $llvmRoot, $nsisHome)")
    expect(workflow).toContain("-Paths @($workerTarget, (Join-Path $candidateRoot 'src-tauri\\target'))")
    expect(workflow).not.toContain('Get-RunnerFreeBytes')
    expect(workflow).not.toContain('$env:SystemDrive')
    expect(toolchainModule).toContain('Remove-RainControlledOwnedDirectory -Path $DownloadsRoot')
    expect(workflow).toContain('Invoke-ReleaseEvidenceNsisInstallAndVerify -Installer $installer.FullName -TemporaryRoot $env:RUNNER_TEMP')
    expect(workflow).toContain("(Join-Path $controlRoot 'scripts\\nvidia-release-evidence-contract.psm1')")
    expect(workflow).toMatch(/7z\.exe\s+x/i)
    expect(workflow).toContain('$installerArchiveRoot')
    expect(workflow).toContain('-InstallerArchiveRoot $installerArchiveRoot')
    expect(workflow).toContain('Installer archive cleanup failed')

    expect(toolchainModule).toContain("& $adapterToUse.install (Join-Path $DownloadsRoot 'cuda.exe') @('-s') 'CUDA'")
    expect(toolchainModule).toContain("& $adapterToUse.install (Join-Path $DownloadsRoot 'llvm.exe') @('/S') 'LLVM'")
    expect(toolchainModule).toContain("& $adapterToUse.install (Join-Path $DownloadsRoot 'nsis.exe') @('/S') 'NSIS'")

    expect(workflow).toContain('https://developer.download.nvidia.com/compute/cuda/12.9.1/local_installers/cuda_12.9.1_576.57_windows.exe')
    expect(workflow).toContain('F0CA7CC7B4CEA2FAC2C4951819D2A9CAEA31E04000E9110E2048719525F8EA0E')
    expect(workflow).toContain('https://github.com/llvm/llvm-project/releases/download/llvmorg-22.1.7/LLVM-22.1.7-win64.exe')
    expect(workflow).toContain('e091fcf965ce589c83c0f7c5356b2fcf3e658a8ec990bfcf79cce4389a0d1eb3')
    expect(workflow).toContain(pinnedNsisDirectUrl)
    expect(workflow).not.toContain(legacyNsisDownloadPageUrl)
    expect(workflow).toContain('38D49F8FE09B1C332B01D0940E57B7258F4447733643273A01C59959AD9D3B0A')
    expect(workflow).toMatch(/Get-FileHash -LiteralPath \$\w+ -Algorithm SHA256/)
    expect(workflow).toContain("Invoke-RainControlledNativeToolProbe -Name 'cargo'")
    expect(workflow).toContain('Verify CMake 4+ and record controlled remote toolchain')
    expect(workflow).toContain('CMake 4 or newer is required')
    expect(workflow).toContain('TOOLCHAIN_RECORD_PATH=')
    expect(workflow).toContain('architectureBasisUrl')
    expect(workflow).toContain('https://developer.nvidia.com/cuda-gpus')
    expect(workflow).toContain('npm ci')
    expect(workflow).toContain('build-whisper-cuda-worker.ps1')
    expect(workflow).toContain('-CmakePath $env:CMAKE_PATH')
    expect(workflow).toContain('$workerReservation = New-RainControlledDirectoryReservation')
    expect(workflow).toContain('Remove-RainControlledOwnedDirectory -Path $workerTarget')
    expect(workflow).toContain('-ToolchainRecordPath $env:TOOLCHAIN_RECORD_PATH')
    expect(workflow).toContain('git -C $candidateRoot clean -ffdx')
    expect(workflow).toContain('after-candidate-cleanup')
    expect(readFileSync(workerBuildScriptPath, 'utf8')).toContain("'--locked'")

    const coreUploadIndex = requiredIndex(workflow, 'id: upload_core')
    const recordIndex = requiredIndex(workflow, 'New-RainControlledBuildRecord')
    const launcherIndex = requiredIndex(workflow, 'generate-nvidia-evidence-admin-launcher.ps1')
    const controlUploadIndex = requiredIndex(workflow, 'id: upload_control')
    expect(coreUploadIndex).toBeLessThan(recordIndex)
    expect(recordIndex).toBeLessThan(launcherIndex)
    expect(launcherIndex).toBeLessThan(controlUploadIndex)
    expect(workflow).toContain(uploadArtifactAction)
    expect(workflow).toContain('steps.upload_core.outputs.artifact-digest')
    expect(workflow).toContain('CORE_ARTIFACT_ROOT')
    expect(workflow).toContain('CONTROL_ARTIFACT_ROOT')
    expect(workflow).toContain('if-no-files-found: error')
    expect(workflow).toContain('compression-level: 0')
    expect(workflow).toContain('control artifact digest')
    expect(workflow).toContain('Before downloading, verify the canonical workflow run URL and second control-artifact upload digest')

    expect(workflow).not.toMatch(/(?:nvidia-smi|scripts[\\/]run-nvidia-release-evidence\.ps1|evidence:nvidia-release|harness:check|cargo test|gh release|softprops\/action-gh-release|Start-Process\s+-Verb\s+RunAs)/i)
    expect(workflow).not.toMatch(/(?:ggml-[^\s'"`]*\.bin|\.gguf|whisper-models)/i)
  })

  it('rejects job eligibility gates that use an illegal env context before a hosted build can be scheduled', () => {
    const workflow = readWorkflow()
    const canonicalExpression = buildJobEligibilityExpression(workflow)
    const illegalEnvFixture = workflow.replace(
      canonicalExpression,
      "${{ github.ref == 'refs/heads/master' && github.event.inputs.confirm_target == format('BUILD-{0}', env.CANDIDATE_TARGET_COMMIT) }}",
    )

    expect(() => assertCanonicalDispatchEligibility(illegalEnvFixture)).toThrow()
    expect(() => assertCanonicalDispatchEligibility(illegalEnvFixture)).toThrow(/env/)
  })

  it('keeps the pinned-download PowerShell block parseable and braces diagnostic variables before a colon', () => {
    const workflow = readWorkflow()
    const downloadBlock = workflowRunBlock(workflow, 'Download and verify pinned CUDA, LLVM, NSIS, and CMake packages')
    const parseResult = parsePowerShell(downloadBlock)
    const legalScopeNames = new Set(['env', 'global', 'local', 'private', 'script', 'using', 'function', 'variable', 'alias', 'drive'])
    const unbracedVariableColonReferences = Array.from(workflow.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*):/g))
      .map((match) => match[0])
      .filter((reference) => !legalScopeNames.has(reference.slice(1, -1).toLowerCase()))

    expect(parseResult.error, parseResult.output).toBeUndefined()
    expect(parseResult.status, parseResult.output).toBe(0)
    expect(downloadBlock).toContain('SHA-256 mismatch for ${Uri}: expected')
    expect(unbracedVariableColonReferences).toEqual([])
  })

  it('uses hosted curl redirect and exit handling before the existing pinned-download hash gate', () => {
    const workflow = readWorkflow()
    const preflightBlock = workflowRunBlock(workflow, 'Verify hosted Windows capacity and preinstalled build prerequisites')
    const downloadBlock = workflowRunBlock(workflow, 'Download and verify pinned CUDA, LLVM, NSIS, and CMake packages')
    const curlCommand = '& curl.exe --location --fail --silent --show-error --output $Destination --url $Uri'

    expect(preflightBlock).toContain("foreach ($command in @('node.exe', 'npm.cmd', 'cargo.exe', 'rustup.exe', 'ninja.exe', '7z.exe', 'curl.exe'))")
    expect(preflightBlock).toContain("Invoke-RainControlledNativeToolProbe -Name 'curl' -Path (Get-Command curl.exe -ErrorAction Stop).Source -Arguments @('--version')")
    expect(workflow).not.toContain('curl = [ordered]@{')
    expect(downloadBlock).not.toContain('Invoke-WebRequest')
    expect(downloadBlock).toContain(curlCommand)
    expect(downloadBlock).toMatch(/& curl\.exe --location --fail --silent --show-error --output \$Destination --url \$Uri\n\s*\$curlExitCode = \$LASTEXITCODE\n\s*if \(\$curlExitCode -ne 0\)/)
    expect(downloadBlock).toContain('throw "Pinned download failed for ${Uri}: curl.exe exited with code $curlExitCode."')
    expect(downloadBlock).toMatch(/Get-FileHash -LiteralPath \$\w+ -Algorithm SHA256/)
    expect(requiredIndex(downloadBlock, curlCommand)).toBeLessThan(requiredIndex(downloadBlock, '$actualSha256 ='))
  })

  it('pins CMake, records the complete hosted toolchain, and guarantees installed-tree and candidate cleanup', () => {
    const workflow = readWorkflow()
    const toolchainModule = readFileSync(toolchainInstallModulePath, 'utf8')
    const cmakeUrl = 'https://github.com/Kitware/CMake/releases/download/v4.0.0/cmake-4.0.0-windows-x86_64.zip'
    const cmakeSha256 = '89E87F3E297B70F1349EE7C5F90783CA96EFB986B70C558C799C3C9B1B716456'

    expect(workflow).toContain(`CMAKE_ARCHIVE_URL: ${cmakeUrl}`)
    expect(workflow).toContain(`CMAKE_ARCHIVE_SHA256: ${cmakeSha256}`)
    expect(workflow).toContain("Get-VerifiedDownload $env:CMAKE_ARCHIVE_URL $env:CMAKE_ARCHIVE_SHA256 (Join-Path $toolDownloads 'cmake.zip')")
    expect(toolchainModule).toContain("& $adapterToUse.expand (Join-Path $DownloadsRoot 'cmake.zip') $CmakeExtractRoot")
    expect(toolchainModule).toContain("Remove-RainControlledToolchainPackageFile -Adapter $adapterToUse -Path (Join-Path $DownloadsRoot 'cmake.zip') -Description 'CMake'")
    expect(toolchainModule).toContain('"CMAKE_PATH=$cmakePath"')
    assertPinnedCmakeConsumers(workflow, toolchainModule)
    expect(workflow).not.toContain("foreach ($command in @('node.exe', 'npm.cmd', 'cargo.exe', 'rustup.exe', 'ninja.exe', 'cmake.exe'))")

    for (const field of ['runner = [ordered]@{', 'node = [ordered]@{', 'npm = [ordered]@{', 'cargo = [ordered]@{', 'msvc = [ordered]@{', 'nsis = [ordered]@{', 'downloads = [ordered]@{']) {
      expect(workflow).toContain(field)
    }
    expect(workflow).toContain('MSVC_VERSION=$($msvcVersion.Name)')
    expect(toolchainModule).toContain('NSIS_HOME=$nsisHome')
    expect(workflow).toContain("Invoke-RainControlledNativeToolProbe -Name 'makensis' -Path (Join-Path $env:NSIS_HOME 'makensis.exe') -Arguments @('/VERSION')")
    expect(workflow).toContain("runner = [ordered]@{ image = $env:ImageOS; imageVersion = $env:ImageVersion")
    expect(workflow).toContain("cmake = [ordered]@{ url = $env:CMAKE_ARCHIVE_URL; sha256 = $env:CMAKE_ARCHIVE_SHA256 }")
    expect(workflow).toContain("cuda = [ordered]@{ url = $env:CUDA_INSTALLER_URL; sha256 = $env:CUDA_INSTALLER_SHA256 }")
    expect(workflow).toContain("llvm = [ordered]@{ url = $env:LLVM_INSTALLER_URL; sha256 = $env:LLVM_INSTALLER_SHA256 }")
    expect(workflow).toContain("nsis = [ordered]@{ url = $env:NSIS_INSTALLER_URL; sha256 = $env:NSIS_INSTALLER_SHA256 }")
    expect(workflow).toContain('Toolchain record temporary cleanup failed')
    expect(workflow).not.toContain('Remove-Item -LiteralPath $temporaryRecordPath -Force -ErrorAction SilentlyContinue')

    expect(workflow).toContain("-Stage 'before-download' -Paths @($env:RUNNER_TEMP, $env:GITHUB_WORKSPACE) -MinimumBytes 24GB")
    expect(toolchainModule).toContain("diskGate 'before-install' @($DownloadsRoot, $CmakeExtractRoot, $cudaRoot, $llvmRoot, $nsisHome) 20GB")
    expect(toolchainModule).toContain("diskGate 'after-tool-install-cleanup' @($DownloadsRoot, $CmakeExtractRoot) 14GB")
    expect(workflow).toContain("-Stage 'before-cuda-worker-build' -Paths @($workerTarget, (Join-Path $candidateRoot 'src-tauri\\target')) -MinimumBytes 16GB")
    expect(workflow).toContain("-Stage 'before-tauri-package' -Paths @($workerTarget, (Join-Path $candidateRoot 'src-tauri\\target')) -MinimumBytes 12GB")
    expect(workflow).toContain("-Stage 'after-candidate-cleanup' -Paths @($env:GITHUB_WORKSPACE, (Join-Path $candidateRoot 'src-tauri\\target')) -MinimumBytes 12GB")
    expect(workflow).toContain('Clean candidate build residue before immutable upload\n        if: ${{ always() }}')
    expect(workflow).toContain('$candidateCleanupErrors = [System.Collections.Generic.List[string]]::new()')
    expect(workflow).toContain('Invocation-owned TEMP cleanup failed')
    expect(workflow).toContain('Controlled cleanup failures:')
    expect(workflow).toContain('$artifactGenerationError')
    expect(workflow).toContain('$artifactCleanupErrors')
    expect(workflow).toContain('Artifact generation failed:')

    const installIndex = requiredIndex(workflow, 'Invoke-ReleaseEvidenceNsisInstallAndVerify -Installer $installer.FullName -TemporaryRoot $env:RUNNER_TEMP')
    const generatorIndex = requiredIndex(workflow, 'New-RainControlledReleaseArtifacts -ManifestOnly')
    const uninstallIndex = requiredIndex(workflow, 'Invoke-ReleaseEvidenceNsisUninstallAndVerify -Installation $installedTree')
    expect(installIndex).toBeLessThan(generatorIndex)
    expect(generatorIndex).toBeLessThan(uninstallIndex)
    expect(workflow.slice(generatorIndex, uninstallIndex)).toContain('Copy-Item -LiteralPath $installer.FullName')
  })

  it('keeps CMake internal root out of worker and Tauri children while recording the actual pinned executable and package root', () => {
    const workflow = readWorkflow()
    const toolchainModule = readFileSync(toolchainInstallModulePath, 'utf8')
    const workerBuildScript = readFileSync(workerBuildScriptPath, 'utf8')

    expect(() => assertReservedCmakeRootIsolatedFromBuildChildren(workflow, toolchainModule, workerBuildScript)).not.toThrow()

    const reinjectedModuleFixture = toolchainModule.replace(
      '"CMAKE=$cmakePath"',
      '"CMAKE=$cmakePath",\n      "CMAKE_ROOT=$CmakeExtractRoot",',
    )
    expect(() => assertReservedCmakeRootIsolatedFromBuildChildren(workflow, reinjectedModuleFixture, workerBuildScript)).toThrow()
  })

  it('rejects a workflow fixture that exposes pinned CMake only to the worker build', () => {
    const workflow = readWorkflow()
    const toolchainModule = readFileSync(toolchainInstallModulePath, 'utf8')
    const workerOnlyFixture = toolchainModule.replace(
      'foreach ($pathLine in @($llvmBin, $nsisHome, $cmakeBin))',
      '# pinned CMake omitted from the shared build PATH',
    )

    expect(() => assertPinnedCmakeConsumers(workflow, workerOnlyFixture)).toThrow()
  })

  it('rejects a workflow fixture that can interpret a failed native git status as clean', () => {
    const workflow = readWorkflow()
    const uncheckedStatusFixture = workflow.replace(
      "$controlStatus = Invoke-ControlledGitText $controlRoot 'Control tooling status' @('status', '--porcelain', '--untracked-files=all')",
      '$controlStatus = (& git -C $controlRoot status --porcelain --untracked-files=all | Out-String).Trim()',
    )

    expect(() => assertNativeGitFailureClosed(uncheckedStatusFixture)).toThrow()
  })

  it('keeps native-tool installation inside the tested toolchain transaction and rejects a hollow 7z archive scope', () => {
    const workflow = readWorkflow()

    expect(workflow).toContain("Import-Module -Name (Join-Path $controlRoot 'scripts\\controlled-toolchain-install.psm1')")
    expect(workflow).toContain('Invoke-RainControlledToolchainInstall')
    expect(workflow).not.toContain("& (Join-Path $env:PINNED_TOOL_DOWNLOADS 'cuda.exe') -s")
    expect(workflow).not.toContain("& (Join-Path $env:PINNED_TOOL_DOWNLOADS 'llvm.exe') /S")
    expect(workflow).not.toContain("& (Join-Path $env:PINNED_TOOL_DOWNLOADS 'nsis.exe') /S")
    expect(workflow).toContain('Assert-RainReleaseArtifactArchiveContents -InstallerArchiveRoot $installerArchiveRoot')
  })

  it('reserves every interruptible TEMP root and delegates always cleanup to the ownership-checked module', () => {
    const workflow = readWorkflow()
    const ownedDirectoryModule = readFileSync(ownedDirectoryModulePath, 'utf8')

    expect(workflow).toContain('CONTROLLED_INVOCATION_ID: github-${{ github.run_id }}-${{ github.run_attempt }}')
    expect(workflow).toContain('Write-Output "::add-mask::$cleanupAuthorityToken"')
    expect(workflow).toContain('CONTROLLED_CLEANUP_AUTHORITY_TOKEN=$cleanupAuthorityToken')
    expect(workflow).not.toMatch(/^\s*(?:CORE_ARTIFACT_ROOT|CONTROL_ARTIFACT_ROOT|ASSEMBLY_ROOT):/m)
    for (const pathExpression of ['$coreArtifactRoot', '$controlArtifactRoot', '$assemblyRoot', '$toolDownloads', '$cmakeExtractRoot', '$workerTarget', '$installerArchiveRoot']) {
      expect(workflow).toContain(`New-RainControlledDirectoryReservation -Path ${pathExpression} -AllowedParent $env:RUNNER_TEMP -OwnerId $env:CONTROLLED_INVOCATION_ID -CleanupAuthorityToken $env:CONTROLLED_CLEANUP_AUTHORITY_TOKEN`)
    }
    for (const variable of ['CORE_ARTIFACT_ROOT', 'CONTROL_ARTIFACT_ROOT', 'ASSEMBLY_ROOT']) {
      expect(workflow).toContain(`"${variable}=$`)
      expect(workflow).toContain(`"${variable}_RESERVATION_TOKEN=$`)
      expect(workflow).toContain(`-Path $env:${variable} -AllowedParent $env:RUNNER_TEMP -OwnerId $env:CONTROLLED_INVOCATION_ID -ReservationToken $env:${variable}_RESERVATION_TOKEN -CleanupAuthorityToken $env:CONTROLLED_CLEANUP_AUTHORITY_TOKEN`)
    }
    for (const reservation of ['$coreArtifactReservation', '$controlArtifactReservation', '$assemblyReservation']) {
      expect(workflow).toContain(`Write-Output "::add-mask::$(${reservation}.token)"`)
    }
    expect(workflow).toContain("- name: Clean all invocation-owned runner TEMP roots\n        if: ${{ always() }}")
    expect(workflow).toContain('PINNED_DOWNLOADS_RESERVATION_TOKEN=')
    expect(workflow).toContain('-DownloadsReservationToken $env:PINNED_DOWNLOADS_RESERVATION_TOKEN -CmakeReservationToken $cmakeReservation.token')
    expect(workflow).toContain('-ReserveInstallRoot { param($path) [void]($installReservationHolder.reservation = New-RainControlledDirectoryReservation -Path $path -AllowedParent $env:RUNNER_TEMP -OwnerId $env:CONTROLLED_INVOCATION_ID -CleanupAuthorityToken $env:CONTROLLED_CLEANUP_AUTHORITY_TOKEN) }')
    expect(workflow).toContain('-RemoveInstallRoot $removeReservedInstallRoot')
    expect(workflow).toContain('Remove-RainControlledOwnedDirectory -Path $installerArchiveRoot -AllowedParent $env:RUNNER_TEMP -OwnerId $env:CONTROLLED_INVOCATION_ID -ReservationToken $archiveReservation.token -CleanupAuthorityToken $env:CONTROLLED_CLEANUP_AUTHORITY_TOKEN')
    expect(workflow).toContain('Invoke-RainControlledDirectoryCleanup -AllowedParent $env:RUNNER_TEMP -OwnerId $env:CONTROLLED_INVOCATION_ID -CleanupAuthorityToken $env:CONTROLLED_CLEANUP_AUTHORITY_TOKEN')
    expect(ownedDirectoryModule).toContain('Controlled directory cleanup requires its invocation reservation')
    expect(ownedDirectoryModule).toContain('does not belong to this invocation and exact target')
  })

  it('routes every native version fact through the exit-code-checking probe module before record creation', () => {
    const workflow = readWorkflow()
    expect(workflow).toContain("Import-Module -Name (Join-Path $controlRoot 'scripts\\controlled-native-tool-probe.psm1') -Force")
    for (const name of ['node', 'npm', 'cargo', 'rustup', 'ninja', 'vswhere', 'cmake', 'nvcc', 'clang', 'rustc', 'makensis']) {
      expect(workflow).toContain(`Invoke-RainControlledNativeToolProbe -Name '${name}'`)
    }
    const finalProbe = requiredIndex(workflow, "Invoke-RainControlledNativeToolProbe -Name 'makensis'")
    const recordCreation = requiredIndex(workflow, '$toolchainRecord = [ordered]@{')
    expect(finalProbe).toBeLessThan(recordCreation)
  })
})
