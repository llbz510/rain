import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = join(__dirname, '..')
const generatorModulePath = join(repoRoot, 'scripts', 'release-artifact-generator.psm1')
const temporaryRoots: string[] = []

function resolvePowerShellExecutable() {
  for (const candidate of ['pwsh.exe', 'powershell.exe']) {
    const probe = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$null'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (probe.status === 0) return candidate
  }
  throw new Error('release-artifact generator tests require pwsh.exe or powershell.exe.')
}

const powerShellExecutable = resolvePowerShellExecutable()

function sha256(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function windowsShortPath(path: string) {
  const command = `(New-Object -ComObject Scripting.FileSystemObject).GetFolder(${psQuoted(path)}).ShortPath`
  return execFileSync(powerShellExecutable, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ], { encoding: 'utf8', windowsHide: true }).trim()
}

function newTemporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), 'rain-release-artifact-generator-test-'))
  temporaryRoots.push(root)
  return root
}

function psQuoted(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function writeFixtureFile(path: string, contents: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, contents, 'utf8')
}

function writePeFixture(path: string, machine: number) {
  const bytes = Buffer.alloc(512)
  bytes.write('MZ', 0, 'ascii')
  bytes.writeUInt32LE(0x80, 0x3c)
  bytes.write('PE\0\0', 0x80, 'ascii')
  bytes.writeUInt16LE(machine, 0x84)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, bytes)
}

function writeNsisInstallerFixture(path: string, machine = 0x8664) {
  writePeFixture(path, machine)
  const bytes = readFileSync(path)
  bytes.write('Nullsoft Install System', 0x120, 'ascii')
  writeFileSync(path, bytes)
}

function writeTauriMetadataFixture(root: string, metadata: {
  productName?: string
  version?: string
  identifier?: string
} = {}) {
  const sourceTauriRoot = join(root, 'src-tauri')
  writeFixtureFile(join(sourceTauriRoot, 'tauri.conf.json'), JSON.stringify({
    productName: metadata.productName ?? 'Rain',
    version: metadata.version ?? '0.1.0',
    identifier: metadata.identifier ?? 'com.rain.app',
  }))
  writeFixtureFile(join(sourceTauriRoot, 'tauri.gpu.conf.json'), JSON.stringify({
    bundle: {
      active: true,
      targets: ['nsis'],
      resources: {
        'target/whisper-gpu-bundle/whisper-backends/rain-whisper-cuda.exe': 'whisper-backends/rain-whisper-cuda.exe',
        'target/whisper-gpu-bundle/whisper-backends/cublas64_12.dll': 'whisper-backends/cublas64_12.dll',
        'target/whisper-gpu-bundle/whisper-backends/cublasLt64_12.dll': 'whisper-backends/cublasLt64_12.dll',
        'target/whisper-gpu-bundle/whisper-backends/cudart64_12.dll': 'whisper-backends/cudart64_12.dll',
        'target/whisper-gpu-bundle/whisper-backends/payload-manifest.json': 'whisper-backends/payload-manifest.json',
      },
    },
  }))
}

function writeControlledToolchainRecordFixture(root: string) {
  const toolchainRecordPath = join(root, 'controlled-toolchain-record.json')
  writeFixtureFile(toolchainRecordPath, JSON.stringify({
    schemaVersion: 1,
    runner: {
      image: 'windows-2025',
      imageVersion: '2026.08.01.1',
      os: 'Microsoft Windows Server 2025',
      osVersion: '10.0.26100',
      architecture: 'X64',
    },
    cmake: { version: '4.0.0', minimumVersion: '4.0.0' },
    cuda: {
      toolkitVersion: '12.9.1',
      architectures: ['120'],
      architectureBasisUrl: 'https://developer.nvidia.com/cuda-gpus',
    },
    ninja: { version: '1.12.1' },
    llvm: { version: '22.1.7' },
    rust: { version: '1.96.1' },
    node: { version: 'v24.0.0' },
    npm: { version: '11.0.0' },
    cargo: { version: 'cargo 1.96.1' },
    msvc: { version: '14.44.35207', hostArchitecture: 'x64', targetArchitecture: 'x64' },
    nsis: { version: 'v3.11' },
    downloads: {
      cmake: {
        url: 'https://github.com/Kitware/CMake/releases/download/v4.0.0/cmake-4.0.0-windows-x86_64.zip',
        sha256: '89e87f3e297b70f1349ee7c5f90783ca96efb986b70c558c799c3c9b1b716456',
      },
      cuda: {
        url: 'https://developer.download.nvidia.com/compute/cuda/12.9.1/local_installers/cuda_12.9.1_576.57_windows.exe',
        sha256: 'f0ca7cc7b4cea2fac2c4951819d2a9caea31e04000e9110e2048719525f8ea0e',
      },
      llvm: {
        url: 'https://github.com/llvm/llvm-project/releases/download/llvmorg-22.1.7/LLVM-22.1.7-win64.exe',
        sha256: 'e091fcf965ce589c83c0f7c5356b2fcf3e658a8ec990bfcf79cce4389a0d1eb3',
      },
      nsis: {
        url: 'https://sourceforge.net/projects/nsis/files/NSIS%203/3.11/nsis-3.11-setup.exe/download',
        sha256: '38d49f8fe09b1c332b01d0940e57b7258f4447733643273a01c59959ad9d3b0a',
      },
    },
  }))
  return toolchainRecordPath
}

function createInstalledTreeFixture(root: string) {
  const installRoot = join(root, 'installed')
  const payloadRoot = join(installRoot, 'resources', 'whisper-backends')
  const installerPath = join(root, 'Rain_0.1.0_x64-setup.exe')
  const archiveRoot = join(root, 'installer-archive')
  const mainExecutable = join(installRoot, 'rain.exe')
  const worker = join(payloadRoot, 'rain-whisper-cuda.exe')
  const payloadFiles = [
    worker,
    join(payloadRoot, 'cublas64_12.dll'),
    join(payloadRoot, 'cublasLt64_12.dll'),
    join(payloadRoot, 'cudart64_12.dll'),
  ]

  writeNsisInstallerFixture(installerPath)
  writePeFixture(join(archiveRoot, 'embedded-bootstrapper.exe'), 0x14c)
  // 7z extraction is an independent, additive judge.  Its fixture must look
  // like an unpacked Rain payload rather than merely contain an NSIS stub.
  writePeFixture(join(archiveRoot, 'Rain.exe'), 0x8664)
  const archivePayloadRoot = join(archiveRoot, 'resources', 'whisper-backends')
  const archivePayloadFiles = [
    join(archivePayloadRoot, 'rain-whisper-cuda.exe'),
    join(archivePayloadRoot, 'cublas64_12.dll'),
    join(archivePayloadRoot, 'cublasLt64_12.dll'),
    join(archivePayloadRoot, 'cudart64_12.dll'),
  ]
  for (const path of archivePayloadFiles) writeFixtureFile(path, `archive fixture ${path.split('\\').pop()}`)
  writeFixtureFile(join(archiveRoot, 'resources', 'whisper-backends', 'payload-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    configuration: 'release',
    workerProtocolVersion: 1,
    driverLibraryBundled: false,
    files: archivePayloadFiles.map((path) => ({
      name: path.split('\\').pop(),
      sizeBytes: readFileSync(path).length,
      sha256: sha256(path),
    })),
  }))
  writeTauriMetadataFixture(root)
  const toolchainRecordPath = writeControlledToolchainRecordFixture(root)
  writePeFixture(mainExecutable, 0x8664)
  for (const path of payloadFiles) writeFixtureFile(path, `fixture ${path.split('\\').pop()}`)

  writeFixtureFile(join(payloadRoot, 'payload-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    configuration: 'release',
    workerProtocolVersion: 1,
    driverLibraryBundled: false,
    files: payloadFiles.map((path) => ({
      name: path.split('\\').pop(),
      sizeBytes: readFileSync(path).length,
      sha256: sha256(path),
    })),
  }, null, 2))

  return { installRoot, installerPath, payloadRoot, toolchainRecordPath, archiveRoot }
}

function createNsisInstallationProof(installerPath: string, installRoot: string) {
  return {
    kind: 'rain-nsis-install-proof-v1',
    schemaVersion: 1,
    installerPath,
    installerSha256: sha256(installerPath),
    installRoot,
    mainExecutable: join(installRoot, 'rain.exe'),
    mainExecutableMachine: 0x8664,
    payloadManifestPath: join(installRoot, 'resources', 'whisper-backends', 'payload-manifest.json'),
    silentInstall: {
      arguments: ['/S', `/D=${installRoot}`],
      waited: true,
      exitCode: 0,
    },
  }
}

function runGenerator({
  installerPath,
  installRoot,
  outputRoot,
  sourceRoot = installRoot.includes('installed') ? installRoot.slice(0, installRoot.lastIndexOf('installed')).replace(/[\\/]$/, '') : installRoot,
  toolchainRecordPath = join(sourceRoot, 'controlled-toolchain-record.json'),
  archiveRoot = join(sourceRoot, 'installer-archive'),
  importReader = "{ param([string]$Path) 'DLL Name: KERNEL32.dll`nDLL Name: USER32.dll' }",
  repository = 'llbz510/rain',
  sourceRepository = 'https://github.com/llbz510/rain.git',
  manifestOnly = false,
  omitInstallationProof = false,
  installationProof,
}: {
  installerPath: string
  installRoot: string
  outputRoot: string
  sourceRoot?: string
  toolchainRecordPath?: string
  archiveRoot?: string
  importReader?: string
  repository?: string
  sourceRepository?: string
  manifestOnly?: boolean
  omitInstallationProof?: boolean
  installationProof?: ReturnType<typeof createNsisInstallationProof>
}) {
  const candidateTarget = '3006757838b972b511917663e4ba8328804607d6'
  const toolingCommit = '1111111111111111111111111111111111111111'
  const proof = installationProof ?? createNsisInstallationProof(installerPath, installRoot)
  const proofBase64 = Buffer.from(JSON.stringify(proof), 'utf8').toString('base64')
  const proofPreamble = omitInstallationProof
    ? ''
    : `$nsisInstallationProof = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${proofBase64}')) | ConvertFrom-Json`
  const proofArgument = omitInstallationProof ? '' : ' -NsisInstallationProof $nsisInstallationProof'
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$module = Import-Module -Name ${psQuoted(generatorModulePath)} -Force -PassThru`,
    proofPreamble,
    `$result = New-RainControlledReleaseArtifacts ${manifestOnly ? '-ManifestOnly ' : ''}-InstallerPath ${psQuoted(installerPath)} -InstalledRoot ${psQuoted(installRoot)} -InstallerArchiveRoot ${psQuoted(archiveRoot)} -CandidateSourceRoot ${psQuoted(sourceRoot)} -ToolchainRecordPath ${psQuoted(toolchainRecordPath)} -OutputDirectory ${psQuoted(outputRoot)} -CandidateTargetCommit ${psQuoted(candidateTarget)} -ToolingCommit ${psQuoted(toolingCommit)} -Repository ${psQuoted(repository)} -SourceRepository ${psQuoted(sourceRepository)} -GeneratorId 'rain-controlled-artifact-generator' -GeneratorVersion '1' -BuildRecordId 'test-build-001' -BuiltAt '2026-08-11T12:00:00.0000000+00:00' -WorkflowFile '.github/workflows/controlled-gpu-artifact-build.yml' -WorkflowRunUrl 'https://github.com/llbz510/rain/actions/runs/123/attempts/1' -WorkflowEvent 'workflow_dispatch' -WorkflowRef 'refs/heads/master' -WorkflowRunId '123' -WorkflowRunAttempt 1 -WorkflowDefinitionCommit ${psQuoted(toolingCommit)} -CandidateMasterReachable $true -ToolingMasterReachable $true -CoreArtifactName 'rain-candidate-core' -CoreArtifactDigest '${'2'.repeat(64)}' -GetPeImportText ${importReader}${proofArgument}`,
    '$result | ConvertTo-Json -Depth 30 -Compress',
  ].join('; ')
  const stdout = execFileSync(powerShellExecutable, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ], { encoding: 'utf8', windowsHide: true })
  return JSON.parse(stdout)
}

function runControlledBuildRecord({
  installerPath,
  artifactManifestPath,
  sourceRoot,
  outputRoot,
  manifestReadAdapter,
}: {
  installerPath: string
  artifactManifestPath: string
  sourceRoot: string
  outputRoot: string
  manifestReadAdapter: string
}) {
  const candidateTarget = '3006757838b972b511917663e4ba8328804607d6'
  const toolingCommit = '1111111111111111111111111111111111111111'
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `Import-Module -Name ${psQuoted(generatorModulePath)} -Force`,
    `$manifestReadAdapter = ${manifestReadAdapter}`,
    `$result = New-RainControlledBuildRecord -InstallerPath ${psQuoted(installerPath)} -ArtifactManifestPath ${psQuoted(artifactManifestPath)} -CandidateSourceRoot ${psQuoted(sourceRoot)} -ToolchainRecordPath (Join-Path ${psQuoted(sourceRoot)} 'controlled-toolchain-record.json') -OutputDirectory ${psQuoted(outputRoot)} -CandidateTargetCommit ${psQuoted(candidateTarget)} -ToolingCommit ${psQuoted(toolingCommit)} -Repository 'llbz510/rain' -SourceRepository 'https://github.com/llbz510/rain.git' -GeneratorId 'rain-controlled-artifact-generator' -GeneratorVersion '1' -BuildRecordId 'test-build-001' -BuiltAt '2026-08-11T12:00:00.0000000+00:00' -WorkflowFile '.github/workflows/controlled-gpu-artifact-build.yml' -WorkflowRunUrl 'https://github.com/llbz510/rain/actions/runs/123/attempts/1' -WorkflowEvent 'workflow_dispatch' -WorkflowRef 'refs/heads/master' -WorkflowRunId '123' -WorkflowRunAttempt 1 -WorkflowDefinitionCommit ${psQuoted(toolingCommit)} -CandidateMasterReachable $true -ToolingMasterReachable $true -CoreArtifactName 'rain-candidate-core' -CoreArtifactDigest '${'2'.repeat(64)}' -ManifestReadAdapter $manifestReadAdapter`,
    '$result | ConvertTo-Json -Depth 30 -Compress',
  ].join('; ')
  const stdout = execFileSync(powerShellExecutable, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command,
  ], { encoding: 'utf8', windowsHide: true })
  return JSON.parse(stdout)
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('controlled release artifact generator', () => {
  it('accepts a bound NSIS proof expressed through the real Windows 8.3 alias but still rejects a different existing path', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const shortRoot = windowsShortPath(root)
    expect(shortRoot.toLowerCase()).not.toBe(root.toLowerCase())

    const shortInstallerPath = installerPath.replace(root, shortRoot)
    const shortInstallRoot = installRoot.replace(root, shortRoot)
    const aliasedProof = createNsisInstallationProof(shortInstallerPath, shortInstallRoot)
    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
      installationProof: aliasedProof,
      manifestOnly: true,
    })).not.toThrow()

    const escapedProof = createNsisInstallationProof(shortInstallerPath, shortInstallRoot)
    escapedProof.mainExecutable = shortInstallerPath
    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'escaped-output'),
      installationProof: escapedProof,
      manifestOnly: true,
    })).toThrow(/exact application-root layout/i)
  })

  it('serializes the normalized remote toolchain record into the core manifest', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const result = runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
      manifestOnly: true,
    })
    const manifest = JSON.parse(readFileSync(result.artifactManifestPath, 'utf8'))
    expect(manifest.controlledBuild.toolchain).toMatchObject({
      record: expect.objectContaining({ fileName: 'controlled-toolchain-record.json' }),
      cuda: { toolkitVersion: '12.9.1', architectures: ['120'] },
      runner: expect.objectContaining({ image: 'windows-2025', architecture: 'X64' }),
      node: { version: 'v24.0.0' },
      npm: { version: '11.0.0' },
      cargo: { version: 'cargo 1.96.1' },
      msvc: { version: '14.44.35207', hostArchitecture: 'x64', targetArchitecture: 'x64' },
      nsis: { version: 'v3.11' },
      downloads: expect.objectContaining({
        cmake: expect.objectContaining({ sha256: '89e87f3e297b70f1349ee7c5f90783ca96efb986b70c558c799c3c9b1b716456' }),
        cuda: expect.objectContaining({ sha256: 'f0ca7cc7b4cea2fac2c4951819d2a9caea31e04000e9110e2048719525f8ea0e' }),
        llvm: expect.objectContaining({ sha256: 'e091fcf965ce589c83c0f7c5356b2fcf3e658a8ec990bfcf79cce4389a0d1eb3' }),
        nsis: expect.objectContaining({ sha256: '38d49f8fe09b1c332b01d0940e57b7258f4447733643273a01c59959ad9d3b0a' }),
      }),
    })
  })

  it('fails closed when a controlled toolchain record omits a pinned download hash', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, toolchainRecordPath } = createInstalledTreeFixture(root)
    const toolchain = JSON.parse(readFileSync(toolchainRecordPath, 'utf8'))
    delete toolchain.downloads.nsis.sha256
    writeFixtureFile(toolchainRecordPath, JSON.stringify(toolchain))

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).toThrow(/downloads nsis sha256/i)
  })

  it('refuses a remote toolchain record that omits the explicit Blackwell-compatible CUDA architecture', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, toolchainRecordPath } = createInstalledTreeFixture(root)
    const toolchain = JSON.parse(readFileSync(toolchainRecordPath, 'utf8'))
    toolchain.cuda.architectures = ['89']
    writeFixtureFile(toolchainRecordPath, JSON.stringify(toolchain))

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).toThrow(/cuda\.architectures must be exactly 120/i)
  })

  it('derives a target-bound manifest and independent record from actual candidate bytes', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const outputRoot = join(root, 'candidate-output')
    const candidateTarget = '3006757838b972b511917663e4ba8328804607d6'
    const toolingCommit = '1111111111111111111111111111111111111111'
    const result = runGenerator({ installerPath, installRoot, outputRoot })
    const manifestPath = result.artifactManifestPath as string
    const recordPath = result.controlledBuildRecordPath as string
    expect(existsSync(manifestPath)).toBe(true)
    expect(existsSync(recordPath)).toBe(true)

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const serializedManifest = readFileSync(manifestPath, 'utf8')
    const record = JSON.parse(readFileSync(recordPath, 'utf8'))
    expect(manifest.targetCommit).toBe(candidateTarget)
    expect(manifest).toMatchObject({
      productName: 'Rain',
      version: '0.1.0',
      identifier: 'com.rain.app',
      installer: expect.objectContaining({ kind: 'nsis-windows-x64' }),
    })
    expect(manifest.controlledBuild.targetCommit).toBe(candidateTarget)
    expect(manifest.controlledBuild.toolingCommit).toBe(toolingCommit)
    expect(manifest.mainExecutable.path).toBe('rain.exe')
    expect(manifest.resources.cudaWorker.path).toBe('resources/whisper-backends/rain-whisper-cuda.exe')
    expect(manifest.resources.cudaPayloadManifest).toMatchObject({
      path: 'resources/whisper-backends/payload-manifest.json',
      configuration: 'release',
    })
    expect(manifest.resources.cudaRuntime.files.map((file: { name: string }) => file.name).sort()).toEqual([
      'cublas64_12.dll',
      'cublasLt64_12.dll',
      'cudart64_12.dll',
    ])
    expect(manifest.hygieneScopes).toEqual(['installed-tree', 'installer-archive'])
    expect(manifest.installationProof).toEqual({
      kind: 'rain-nsis-install-proof-v2',
      schemaVersion: 2,
      installerSha256: sha256(installerPath),
      mainExecutable: { path: 'rain.exe', machine: 0x8664 },
      payloadManifest: { path: 'resources/whisper-backends/payload-manifest.json' },
      silentInstall: { mode: 'silent', destinationKind: 'unique-runner-temp', waited: true, exitCode: 0 },
    })
    expect(serializedManifest).not.toContain(installRoot)
    expect(serializedManifest).not.toContain('/D=')
    expect(record.targetCommit).toBe(candidateTarget)
    expect(record.toolingCommit).toBe(toolingCommit)
    expect(record.repository).toBe('llbz510/rain')
    expect(record.sourceRepository).toBe('https://github.com/llbz510/rain.git')
    expect(record.workflow).toMatchObject({
      runUrl: 'https://github.com/llbz510/rain/actions/runs/123/attempts/1',
      event: 'workflow_dispatch',
      ref: 'refs/heads/master',
      runId: '123',
      runAttempt: 1,
    })
    expect(record.masterReachability).toEqual({ candidate: true, tooling: true })
    expect(manifest.controlledBuild.toolchain).toMatchObject({
      cmake: { version: '4.0.0', minimumVersion: '4.0.0' },
      cuda: { toolkitVersion: '12.9.1', architectures: ['120'] },
    })
    expect(record.toolchain).toMatchObject({
      cmake: { version: '4.0.0', minimumVersion: '4.0.0' },
      cuda: { toolkitVersion: '12.9.1', architectures: ['120'] },
    })
    expect(record.artifactManifest.sha256).toBe(sha256(manifestPath))
    expect(record.installer.sha256).toBe(sha256(installerPath))
  })

  it('keeps installer archive/unpack hygiene scanning as an additive release judge', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    writeFixtureFile(join(archiveRoot, '.env.production'), 'SECRET_TOKEN=fixture-value')
    expect(() => runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .toThrow(/installer-archive.*secret|secret.*installer-archive/i)
  })

  it('rejects an empty installer archive extraction instead of declaring an unscanned scope clean', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    rmSync(archiveRoot, { recursive: true, force: true })
    mkdirSync(archiveRoot, { recursive: true })

    expect(() => runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .toThrow(/installer archive.*empty|archive.*no files/i)
  })

  it('rejects an installer archive extraction that lacks the Rain executable or CUDA payload manifest', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, archiveRoot } = createInstalledTreeFixture(root)
    rmSync(archiveRoot, { recursive: true, force: true })
    writeFixtureFile(join(archiveRoot, 'unrelated-file.txt'), 'not a Rain payload')

    expect(() => runGenerator({ installerPath, installRoot, archiveRoot, outputRoot: join(root, 'candidate-output') }))
      .toThrow(/installer archive.*AMD64 Rain executable|archive.*CUDA payload/i)
  })

  it('rejects a controlled toolchain record whose CMake version drifts above the pinned 4.0.0', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, toolchainRecordPath } = createInstalledTreeFixture(root)
    const toolchain = JSON.parse(readFileSync(toolchainRecordPath, 'utf8'))
    toolchain.cmake.version = '4.0.1'
    writeFixtureFile(toolchainRecordPath, JSON.stringify(toolchain))

    expect(() => runGenerator({ installerPath, installRoot, outputRoot: join(root, 'candidate-output') }))
      .toThrow(/cmake\.version must be exactly 4\.0\.0/i)
  })

  it('rejects a text file that merely has an .exe name instead of a PE/NSIS installer artifact', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeFixtureFile(installerPath, 'this is not an NSIS installer')

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).toThrow(/basic PE artifact/i)
  })

  it('rejects an installer whose source-derived product metadata does not match the expected NSIS artifact name', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeTauriMetadataFixture(root, { productName: 'Different Product' })

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).toThrow(/source-derived NSIS installer file name/i)
  })

  it('accepts an I386 NSIS bootstrapper when the installed Rain executable is AMD64', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeNsisInstallerFixture(installerPath, 0x14c)

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).not.toThrow()
  })

  it('does not accept a name-matched random PE without a successful bound NSIS installation proof', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writePeFixture(installerPath, 0x14c)

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
      omitInstallationProof: true,
    })).toThrow(/successful bound NSIS installation proof/i)
  })

  it('rejects an installed Rain executable outside the exact application-root layout', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    rmSync(join(installRoot, 'rain.exe'))
    writePeFixture(join(installRoot, 'unexpected', 'rain.exe'), 0x8664)

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).toThrow(/Rain main executable must be installed at rain\.exe/i)
  })

  it('rejects an installed NVIDIA driver DLL that is outside the approved CUDA payload', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, payloadRoot } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', 'nvcuda.dll'), 'fixture driver dll')

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).toThrow(/forbidden DLL/i)
  })

  it('rejects installed text that exposes an absolute builder path', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, payloadRoot } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', 'build-metadata.json'), JSON.stringify({
      sourceRoot: 'D:\\agent\\_work\\rain',
    }))

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).toThrow(/absolute builder path/i)
  })

  it.each([
    ['an OpenAI-style key', 'const credential = "sk-rain-fixture-not-a-real-key";', /secret/i],
    ['a Bearer credential', 'Authorization: Bearer rain-fixture-token-value', /secret/i],
    ['a JSON quoted API secret', '{"apiSecret":"rain-fixture-secret-value"}', /secret/i],
    ['a Windows user-profile path', '{"cache":"C:\\Users\\fixture-user\\AppData\\Local\\Rain"}', /absolute builder path/i],
  ])('rejects installed text that exposes %s', (_label, contents, expectedError) => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', 'fixture-config.json'), contents)

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).toThrow(expectedError)
  })

  it.each([
    ['an environment variant', '.env.production', 'SAFE_FIXTURE=true', /secret/i],
    ['a PEM credential container', 'fixture.pem', 'fixture certificate', /secret/i],
    ['a private-key container', 'fixture.key', 'fixture key', /secret/i],
    ['an AWS access key in properties', 'fixture.properties', 'aws.accessKeyId=AKIA1234567890ABCDEF', /secret/i],
    ['a temporary AWS access key in properties', 'temporary.properties', 'aws.accessKeyId=ASIA1234567890ABCDEF', /secret/i],
    ['a PEM private-key body in unknown readable text', 'fixture.bundle', '-----BEGIN PRIVATE KEY-----\nfixture-private-material', /secret/i],
    ['an unknown readable text artifact', 'fixture.bundle', 'readable text with no known extension', /unscanned text artifact/i],
    ['a debug symbol', 'rain.pdb', 'fixture debug symbols', /debug artifact/i],
  ])('rejects installed artifact hygiene risk: %s', (_label, name, contents, expectedError) => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', name), contents)
    expect(() => runGenerator({ installerPath, installRoot, outputRoot: join(root, 'candidate-output') }))
      .toThrow(expectedError)
  })

  it.each([
    ['ASCII', Buffer.from('MZ\0\0fixture ASIA1234567890ABCDEF payload', 'ascii')],
    ['UTF-16LE', Buffer.from('MZ fixture -----BEGIN PRIVATE KEY----- payload', 'utf16le')],
  ])('rejects a PE-like binary that embeds a %s secret token without treating ordinary PE bytes as text', (_encoding, bytes) => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const binaryPath = join(installRoot, 'resources', 'fixture-helper.dll')
    mkdirSync(join(binaryPath, '..'), { recursive: true })
    writeFileSync(binaryPath, bytes)

    expect(() => runGenerator({ installerPath, installRoot, outputRoot: join(root, 'candidate-output') }))
      .toThrow(/secret/i)
  })

  it('accepts ordinary PE-like binary bytes that do not contain a sensitive token', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writePeFixture(join(installRoot, 'resources', 'ordinary-helper.dll'), 0x8664)

    expect(() => runGenerator({ installerPath, installRoot, outputRoot: join(root, 'candidate-output') }))
      .not.toThrow()
  })

  it('requires the CUDA payload manifest to declare release configuration', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, payloadRoot } = createInstalledTreeFixture(root)
    const manifestPath = join(payloadRoot, 'payload-manifest.json')
    const payloadManifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    payloadManifest.configuration = 'debug'
    writeFixtureFile(manifestPath, JSON.stringify(payloadManifest))
    expect(() => runGenerator({ installerPath, installRoot, outputRoot: join(root, 'candidate-output') }))
      .toThrow(/configuration must be release/i)
  })

  it('rejects an installed E2E automation marker', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', 'frontend.js'), 'window.__RAIN_E2E_READY__ = true')

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).toThrow(/E2E marker/i)
  })

  it('rejects an installed model payload file', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', 'whisper-models', 'ggml-large-v3.bin'), 'not a real model')

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).toThrow(/model file/i)
  })

  it('requires whisper-backends to contain exactly the declared worker, CUDA runtime, and payload manifest', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath, payloadRoot } = createInstalledTreeFixture(root)
    writeFixtureFile(join(payloadRoot, 'unexpected-worker-note.txt'), 'unexpected payload file')

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).toThrow(/exact declared payload set/i)
  })

  it('rejects a second CUDA worker or allowed CUDA runtime DLL outside whisper-backends', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    writeFixtureFile(join(installRoot, 'resources', 'duplicate', 'rain-whisper-cuda.exe'), 'duplicate worker')

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
    })).toThrow(/must occur exactly once in whisper-backends/i)
  })

  it('rejects source maps and RAIN_WHISPER_CUDA_WORKER release-build markers from the installed tree', () => {
    const sourceMapRoot = newTemporaryRoot()
    const sourceMapFixture = createInstalledTreeFixture(sourceMapRoot)
    writeFixtureFile(join(sourceMapFixture.installRoot, 'resources', 'frontend.js.map'), '{"sources":["src/main.tsx"]}')
    expect(() => runGenerator({
      installerPath: sourceMapFixture.installerPath,
      installRoot: sourceMapFixture.installRoot,
      outputRoot: join(sourceMapRoot, 'candidate-output'),
    })).toThrow(/source map/i)

    const markerRoot = newTemporaryRoot()
    const markerFixture = createInstalledTreeFixture(markerRoot)
    writeFixtureFile(join(markerFixture.installRoot, 'resources', 'frontend.js'), 'window.RAIN_WHISPER_CUDA_WORKER = true')
    expect(() => runGenerator({
      installerPath: markerFixture.installerPath,
      installRoot: markerFixture.installRoot,
      outputRoot: join(markerRoot, 'candidate-output'),
    })).toThrow(/E2E marker/i)
  })

  it('rejects a CUDA import in the CPU-safe main executable', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
      importReader: "{ param([string]$Path) 'DLL Name: cudart64_12.dll' }",
    })).toThrow(/CUDA or NVIDIA driver DLL/i)
  })

  it.each([
    'cudnn64_9.dll',
    'nvrtc64_120_0.dll',
    'cufft64_11.dll',
    'cusolver64_11.dll',
    'cusparse64_12.dll',
    'curand64_10.dll',
    'cupti64_2025.1.dll',
    'cufile.dll',
    'nvblas64_12.dll',
    'nvToolsExt64_1.dll',
    'nvopencl64.dll',
    'nppif64_12.dll',
  ])('rejects every shared CUDA/NVIDIA runtime-family import: %s', (dllName) => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
      importReader: `{ param([string]$Path) 'DLL Name: ${dllName}' }`,
    })).toThrow(/CUDA or NVIDIA driver DLL/i)
  })

  it('rejects a fork repository before it can generate a controlled artifact record', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)

    expect(() => runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'candidate-output'),
      repository: 'untrusted-fork/rain',
    })).toThrow(/Repository must be llbz510\/rain/i)
  })

  it('defers the controlled-build record until a first core-upload digest is available', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const outputRoot = join(root, 'candidate-output')
    const candidateTarget = '3006757838b972b511917663e4ba8328804607d6'
    const toolingCommit = '1111111111111111111111111111111111111111'
    const coreDigest = '2'.repeat(64)
    const importReader = "{ param([string]$Path) 'DLL Name: KERNEL32.dll`nDLL Name: USER32.dll' }"
    const proofBase64 = Buffer.from(JSON.stringify(createNsisInstallationProof(installerPath, installRoot)), 'utf8').toString('base64')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `Import-Module -Name ${psQuoted(generatorModulePath)} -Force`,
      `$nsisInstallationProof = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${proofBase64}')) | ConvertFrom-Json`,
      `$manifestResult = New-RainControlledReleaseArtifacts -ManifestOnly -InstallerPath ${psQuoted(installerPath)} -InstalledRoot ${psQuoted(installRoot)} -InstallerArchiveRoot (Join-Path ${psQuoted(root)} 'installer-archive') -CandidateSourceRoot ${psQuoted(root)} -ToolchainRecordPath (Join-Path ${psQuoted(root)} 'controlled-toolchain-record.json') -OutputDirectory ${psQuoted(outputRoot)} -CandidateTargetCommit ${psQuoted(candidateTarget)} -ToolingCommit ${psQuoted(toolingCommit)} -Repository 'llbz510/rain' -SourceRepository 'https://github.com/llbz510/rain.git' -GeneratorId 'rain-controlled-artifact-generator' -GeneratorVersion '1' -BuildRecordId 'test-build-001' -BuiltAt '2026-08-11T12:00:00.0000000+00:00' -WorkflowFile '.github/workflows/controlled-gpu-artifact-build.yml' -WorkflowRunUrl 'https://github.com/llbz510/rain/actions/runs/123/attempts/1' -WorkflowEvent 'workflow_dispatch' -WorkflowRef 'refs/heads/master' -WorkflowRunId '123' -WorkflowRunAttempt 1 -WorkflowDefinitionCommit ${psQuoted(toolingCommit)} -CandidateMasterReachable $true -ToolingMasterReachable $true -GetPeImportText ${importReader} -NsisInstallationProof $nsisInstallationProof`,
      `$noRecordBeforeCoreUploadDigest = -not (Test-Path -LiteralPath (Join-Path ${psQuoted(outputRoot)} 'controlled-build-record.json'))`,
      `$manifestReadAdapter = { param($path) $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json; $value.controlledBuild.buildMetadata.builtAt = [DateTime]::Parse([string]$value.controlledBuild.buildMetadata.builtAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind); return $value }`,
      `$recordResult = New-RainControlledBuildRecord -InstallerPath ${psQuoted(installerPath)} -ArtifactManifestPath $manifestResult.artifactManifestPath -CandidateSourceRoot ${psQuoted(root)} -ToolchainRecordPath (Join-Path ${psQuoted(root)} 'controlled-toolchain-record.json') -OutputDirectory ${psQuoted(outputRoot)} -CandidateTargetCommit ${psQuoted(candidateTarget)} -ToolingCommit ${psQuoted(toolingCommit)} -Repository 'llbz510/rain' -SourceRepository 'https://github.com/llbz510/rain.git' -GeneratorId 'rain-controlled-artifact-generator' -GeneratorVersion '1' -BuildRecordId 'test-build-001' -BuiltAt '2026-08-11T12:00:00.0000000+00:00' -WorkflowFile '.github/workflows/controlled-gpu-artifact-build.yml' -WorkflowRunUrl 'https://github.com/llbz510/rain/actions/runs/123/attempts/1' -WorkflowEvent 'workflow_dispatch' -WorkflowRef 'refs/heads/master' -WorkflowRunId '123' -WorkflowRunAttempt 1 -WorkflowDefinitionCommit ${psQuoted(toolingCommit)} -CandidateMasterReachable $true -ToolingMasterReachable $true -CoreArtifactName 'rain-candidate-core' -CoreArtifactDigest ${psQuoted(coreDigest)} -ManifestReadAdapter $manifestReadAdapter`,
      `[ordered]@{ manifestPath = $manifestResult.artifactManifestPath; recordPath = $recordResult.controlledBuildRecordPath; noRecordBeforeCoreUploadDigest = $noRecordBeforeCoreUploadDigest } | ConvertTo-Json -Compress`,
    ].join('; ')

    const stdout = execFileSync(powerShellExecutable, [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command,
    ], { encoding: 'utf8', windowsHide: true })
    const result = JSON.parse(stdout)
    expect(result.manifestPath).toBe(join(outputRoot, 'release-artifact-manifest.json'))
    expect(result.recordPath).toBe(join(outputRoot, 'controlled-build-record.json'))
    expect(result.noRecordBeforeCoreUploadDigest).toBe(true)
    const record = JSON.parse(readFileSync(result.recordPath, 'utf8'))
    expect(record.coreArtifact).toEqual({ name: 'rain-candidate-core', digest: coreDigest })
  })

  it('accepts the same instant parsed as DateTime but fails closed for different, invalid, or missing manifest builtAt metadata', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const sourceRoot = root
    const manifestResult = runGenerator({
      installerPath,
      installRoot,
      outputRoot: join(root, 'manifest-output'),
      manifestOnly: true,
    })
    const readAsDateTime = "{ param($path) $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json; $value.controlledBuild.buildMetadata.builtAt = [DateTime]::Parse([string]$value.controlledBuild.buildMetadata.builtAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind); return $value }"

    const accepted = runControlledBuildRecord({
      installerPath,
      artifactManifestPath: manifestResult.artifactManifestPath,
      sourceRoot,
      outputRoot: join(root, 'same-instant-record'),
      manifestReadAdapter: readAsDateTime,
    })
    expect(accepted.controlledBuildRecordPath).toBe(join(root, 'same-instant-record', 'controlled-build-record.json'))

    const readDifferentDateTime = "{ param($path) $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json; $value.controlledBuild.buildMetadata.builtAt = [DateTime]::Parse('2026-08-11T12:00:01.0000000+00:00', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind); return $value }"
    expect(() => runControlledBuildRecord({
      installerPath,
      artifactManifestPath: manifestResult.artifactManifestPath,
      sourceRoot,
      outputRoot: join(root, 'different-instant-record'),
      manifestReadAdapter: readDifferentDateTime,
    })).toThrow(/controlled-build metadata does not match/i)

    const readInvalidTimestamp = "{ param($path) $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json; $value.controlledBuild.buildMetadata.builtAt = 'not-an-iso-8601-timestamp'; return $value }"
    expect(() => runControlledBuildRecord({
      installerPath,
      artifactManifestPath: manifestResult.artifactManifestPath,
      sourceRoot,
      outputRoot: join(root, 'invalid-timestamp-record'),
      manifestReadAdapter: readInvalidTimestamp,
    })).toThrow(/controlled-build metadata does not match/i)

    const readMissingTimestamp = "{ param($path) $value = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json; [void]$value.controlledBuild.buildMetadata.PSObject.Properties.Remove('builtAt'); return $value }"
    expect(() => runControlledBuildRecord({
      installerPath,
      artifactManifestPath: manifestResult.artifactManifestPath,
      sourceRoot,
      outputRoot: join(root, 'missing-timestamp-record'),
      manifestReadAdapter: readMissingTimestamp,
    })).toThrow(/builtAt/i)
  })

  it('retries atomic manifest and record publication without leaving a partial temporary file', () => {
    const root = newTemporaryRoot()
    const { installRoot, installerPath } = createInstalledTreeFixture(root)
    const outputRoot = join(root, 'candidate-output')
    const candidateTarget = '3006757838b972b511917663e4ba8328804607d6'
    const toolingCommit = '1111111111111111111111111111111111111111'
    const proofBase64 = Buffer.from(JSON.stringify(createNsisInstallationProof(installerPath, installRoot)), 'utf8').toString('base64')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `Import-Module -Name ${psQuoted(generatorModulePath)} -Force`,
      '$state = [pscustomobject]@{ attempts = 0 }',
      "$adapter = [pscustomobject]@{ writeText = { param($path, $text) [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false)) }; publish = { param($temporary, $destination) $state.attempts++; if ($state.attempts -eq 1) { throw [System.IO.IOException]::new('simulated sharing violation') }; [System.IO.File]::Move($temporary, $destination) }; remove = { param($path) if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }; sleep = { param($attempt) } }",
      `$nsisInstallationProof = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${proofBase64}')) | ConvertFrom-Json`,
      `$result = New-RainControlledReleaseArtifacts -InstallerPath ${psQuoted(installerPath)} -InstalledRoot ${psQuoted(installRoot)} -InstallerArchiveRoot (Join-Path ${psQuoted(root)} 'installer-archive') -CandidateSourceRoot ${psQuoted(root)} -ToolchainRecordPath (Join-Path ${psQuoted(root)} 'controlled-toolchain-record.json') -OutputDirectory ${psQuoted(outputRoot)} -CandidateTargetCommit ${psQuoted(candidateTarget)} -ToolingCommit ${psQuoted(toolingCommit)} -Repository 'llbz510/rain' -SourceRepository 'https://github.com/llbz510/rain.git' -GeneratorId 'rain-controlled-artifact-generator' -GeneratorVersion '1' -BuildRecordId 'test-build-atomic' -BuiltAt '2026-08-11T12:00:00.0000000+00:00' -WorkflowFile '.github/workflows/controlled-gpu-artifact-build.yml' -WorkflowRunUrl 'https://github.com/llbz510/rain/actions/runs/123/attempts/1' -WorkflowEvent 'workflow_dispatch' -WorkflowRef 'refs/heads/master' -WorkflowRunId '123' -WorkflowRunAttempt 1 -WorkflowDefinitionCommit ${psQuoted(toolingCommit)} -CandidateMasterReachable $true -ToolingMasterReachable $true -CoreArtifactName 'rain-candidate-core' -CoreArtifactDigest '${'2'.repeat(64)}' -GetPeImportText { param([string]$Path) 'DLL Name: KERNEL32.dll' } -AtomicWriteAdapter $adapter -NsisInstallationProof $nsisInstallationProof`,
      `$temporaryFiles = @(Get-ChildItem -LiteralPath ${psQuoted(outputRoot)} -Force -Filter '*.tmp' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)`,
      '[ordered]@{ attempts = $state.attempts; manifest = $result.artifactManifestPath; record = $result.controlledBuildRecordPath; temporaryFiles = @($temporaryFiles) } | ConvertTo-Json -Compress',
    ].join('; ')
    const stdout = execFileSync(powerShellExecutable, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true })
    const result = JSON.parse(stdout)

    expect(result.attempts).toBe(3)
    expect(existsSync(result.manifest)).toBe(true)
    expect(existsSync(result.record)).toBe(true)
    expect(result.temporaryFiles).toEqual([])
  })

  it('fails explicitly instead of swallowing a release-artifact temporary cleanup failure', () => {
    const root = newTemporaryRoot()
    const outputPath = join(root, 'candidate-output', 'release-artifact-manifest.json')
    const command = [
      "$ErrorActionPreference = 'Stop'",
      `$module = Import-Module -Name ${psQuoted(generatorModulePath)} -Force -PassThru`,
      "$adapter = [pscustomobject]@{ writeText = { param($path, $text) [System.IO.File]::WriteAllText($path, $text, [System.Text.UTF8Encoding]::new($false)) }; publish = { param($temporary, $destination) [System.IO.File]::Move($temporary, $destination) }; remove = { param($path) throw [System.IO.IOException]::new('simulated temporary cleanup failure') }; sleep = { param($attempt) } }",
      `& $module { param($path, $adapter) Write-RainReleaseArtifactJson -Path $path -Value ([ordered]@{ fixture = $true }) -AtomicWriteAdapter $adapter } ${psQuoted(outputPath)} $adapter`,
    ].join('; ')

    expect(() => execFileSync(powerShellExecutable, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command,
    ], { encoding: 'utf8', windowsHide: true })).toThrow(/release artifact temporary cleanup failed/i)
  })
})
