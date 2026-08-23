Set-StrictMode -Version Latest

$runtimeFamilyClassifierModule = Join-Path $PSScriptRoot 'nvidia-release-evidence-contract.psm1'
Import-Module -Name $runtimeFamilyClassifierModule -Force -ErrorAction Stop

$script:RequiredCudaPayloadFiles = @(
  'rain-whisper-cuda.exe',
  'cublas64_12.dll',
  'cublasLt64_12.dll',
  'cudart64_12.dll'
)
$script:AllowedCudaRuntimeFiles = @(
  'cublas64_12.dll',
  'cublasLt64_12.dll',
  'cudart64_12.dll'
)
$script:TextArtifactExtensions = @(
  '.config', '.css', '.cjs', '.env', '.html', '.ini', '.js', '.json', '.log',
  '.key', '.map', '.md', '.mjs', '.pem', '.properties', '.ps1', '.toml', '.txt', '.xml', '.yaml', '.yml'
)
$script:MaximumTextArtifactBytes = 32MB
$script:CanonicalRainRepository = 'llbz510/rain'
$script:CanonicalRainOrigin = 'https://github.com/llbz510/rain.git'
$script:RequiredCudaArchitectures = @('120')
$script:BlackwellArchitectureBasisUrl = 'https://developer.nvidia.com/cuda-gpus'
$script:PinnedControlledToolDownloads = [ordered]@{
  cmake = [ordered]@{
    url = 'https://github.com/Kitware/CMake/releases/download/v4.0.0/cmake-4.0.0-windows-x86_64.zip'
    sha256 = '89e87f3e297b70f1349ee7c5f90783ca96efb986b70c558c799c3c9b1b716456'
  }
  cuda = [ordered]@{
    url = 'https://developer.download.nvidia.com/compute/cuda/12.9.1/local_installers/cuda_12.9.1_576.57_windows.exe'
    sha256 = 'f0ca7cc7b4cea2fac2c4951819d2a9caea31e04000e9110e2048719525f8ea0e'
  }
  llvm = [ordered]@{
    url = 'https://github.com/llvm/llvm-project/releases/download/llvmorg-22.1.7/LLVM-22.1.7-win64.exe'
    sha256 = 'e091fcf965ce589c83c0f7c5356b2fcf3e658a8ec990bfcf79cce4389a0d1eb3'
  }
  nsis = [ordered]@{
    url = 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.11/nsis-3.11-setup.exe'
    sha256 = '38d49f8fe09b1c332b01d0940e57b7258f4447733643273a01c59959ad9d3b0a'
  }
}

function Resolve-RainReleaseArtifactFile([string]$Path, [string]$Description) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Description does not exist: $Path"
  }
  # DirectoryInfo/FileInfo.FullName expands a Windows 8.3 alias to the same long path used
  # by the hosted runner, while Resolve-Path preserves the caller's lexical alias.
  return (Get-Item -LiteralPath $Path -Force).FullName
}

function Resolve-RainReleaseArtifactDirectory([string]$Path, [string]$Description) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "$Description does not exist: $Path"
  }
  return (Get-Item -LiteralPath $Path -Force).FullName
}

function Test-RainReleaseArtifactSameExistingPath([string]$Left, [string]$Right, [bool]$Directory) {
  try {
    $leftIdentity = if ($Directory) {
      Resolve-RainReleaseArtifactDirectory $Left 'Compared directory'
    } else {
      Resolve-RainReleaseArtifactFile $Left 'Compared file'
    }
    $rightIdentity = if ($Directory) {
      Resolve-RainReleaseArtifactDirectory $Right 'Compared directory'
    } else {
      Resolve-RainReleaseArtifactFile $Right 'Compared file'
    }
    return [string]::Equals($leftIdentity, $rightIdentity, [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    return [string]::Equals(
      [System.IO.Path]::GetFullPath($Left),
      [System.IO.Path]::GetFullPath($Right),
      [System.StringComparison]::OrdinalIgnoreCase)
  }
}

function Get-RainReleaseArtifactSha256([string]$Path) {
  $stream = $null
  $hasher = $null
  try {
    $stream = [System.IO.File]::Open(
      $Path,
      [System.IO.FileMode]::Open,
      [System.IO.FileAccess]::Read,
      [System.IO.FileShare]::Read
    )
    $hasher = [System.Security.Cryptography.SHA256]::Create()
    return ([System.BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
  } finally {
    try {
      if ($hasher) { $hasher.Dispose() }
    } finally {
      if ($stream) { $stream.Dispose() }
    }
  }
}

function Get-RainReleaseArtifactProperty($Value, [string]$Name, [string]$Description) {
  if ($Value -is [System.Collections.IDictionary]) {
    if (-not $Value.Contains($Name)) {
      throw "$Description is missing required property '$Name'."
    }
    return $Value[$Name]
  }
  if ($null -eq $Value -or -not ($Value.PSObject.Properties.Name -contains $Name)) {
    throw "$Description is missing required property '$Name'."
  }
  return $Value.$Name
}

function Assert-RainReleaseArtifactVersion([string]$Value, [string]$Description, [version]$MinimumVersion) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Description must not be blank." }
  try {
    $parsed = [version]$Value
  } catch {
    throw "$Description must be a dotted version: $Value"
  }
  if ($parsed -lt $MinimumVersion) {
    throw "$Description must be at least $MinimumVersion; observed $Value."
  }
  return $Value
}

function Assert-RainReleaseArtifactNonBlankString([string]$Value, [string]$Description) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Description must not be blank." }
  return $Value
}

function Assert-RainReleaseArtifactSha256String([string]$Value, [string]$Description) {
  if ($Value -notmatch '^[0-9a-fA-F]{64}$') { throw "$Description must be a SHA-256 value." }
  return $Value.ToLowerInvariant()
}

function Get-RainControlledToolchainRecord([string]$ToolchainRecordPath) {
  $path = Resolve-RainReleaseArtifactFile $ToolchainRecordPath 'Controlled toolchain record'
  try {
    $source = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Controlled toolchain record is not valid JSON: $($_.Exception.Message)"
  }
  if ([int](Get-RainReleaseArtifactProperty $source 'schemaVersion' 'Controlled toolchain record') -ne 1) {
    throw 'Controlled toolchain record schemaVersion must be 1.'
  }
  $cmake = Get-RainReleaseArtifactProperty $source 'cmake' 'Controlled toolchain record'
  $cmakeVersion = Assert-RainReleaseArtifactVersion ([string](Get-RainReleaseArtifactProperty $cmake 'version' 'Controlled toolchain record cmake')) 'Controlled toolchain record cmake.version' ([version]'4.0.0')
  $cmakeMinimumVersion = Assert-RainReleaseArtifactVersion ([string](Get-RainReleaseArtifactProperty $cmake 'minimumVersion' 'Controlled toolchain record cmake')) 'Controlled toolchain record cmake.minimumVersion' ([version]'4.0.0')
  if ($cmakeVersion -ne '4.0.0') {
    throw 'Controlled toolchain record cmake.version must be exactly 4.0.0.'
  }
  if ($cmakeMinimumVersion -ne '4.0.0') {
    throw 'Controlled toolchain record cmake.minimumVersion must be 4.0.0.'
  }

  $cuda = Get-RainReleaseArtifactProperty $source 'cuda' 'Controlled toolchain record'
  $cudaToolkitVersion = [string](Get-RainReleaseArtifactProperty $cuda 'toolkitVersion' 'Controlled toolchain record cuda')
  if ($cudaToolkitVersion -ne '12.9.1') {
    throw "Controlled toolchain record cuda.toolkitVersion must be the pinned 12.9.1 release; observed $cudaToolkitVersion."
  }
  $cudaArchitectures = @((Get-RainReleaseArtifactProperty $cuda 'architectures' 'Controlled toolchain record cuda') | ForEach-Object { [string]$_ })
  if ($cudaArchitectures.Count -ne $script:RequiredCudaArchitectures.Count -or
      @($cudaArchitectures | Where-Object { $script:RequiredCudaArchitectures -notcontains $_ }).Count -ne 0) {
    throw "Controlled toolchain record cuda.architectures must be exactly $($script:RequiredCudaArchitectures -join ', ')."
  }
  $cudaArchitectureBasis = [string](Get-RainReleaseArtifactProperty $cuda 'architectureBasisUrl' 'Controlled toolchain record cuda')
  if ($cudaArchitectureBasis -ne $script:BlackwellArchitectureBasisUrl) {
    throw "Controlled toolchain record cuda.architectureBasisUrl must be $script:BlackwellArchitectureBasisUrl."
  }

  $ninja = Get-RainReleaseArtifactProperty $source 'ninja' 'Controlled toolchain record'
  $llvm = Get-RainReleaseArtifactProperty $source 'llvm' 'Controlled toolchain record'
  $rust = Get-RainReleaseArtifactProperty $source 'rust' 'Controlled toolchain record'
  $ninjaVersion = [string](Get-RainReleaseArtifactProperty $ninja 'version' 'Controlled toolchain record ninja')
  $llvmVersion = [string](Get-RainReleaseArtifactProperty $llvm 'version' 'Controlled toolchain record llvm')
  $rustVersion = [string](Get-RainReleaseArtifactProperty $rust 'version' 'Controlled toolchain record rust')
  foreach ($entry in @(
    @{ value = $ninjaVersion; description = 'Controlled toolchain record ninja.version' },
    @{ value = $llvmVersion; description = 'Controlled toolchain record llvm.version' },
    @{ value = $rustVersion; description = 'Controlled toolchain record rust.version' }
  )) {
    if ([string]::IsNullOrWhiteSpace([string]$entry.value)) { throw "$($entry.description) must not be blank." }
  }

  $runner = Get-RainReleaseArtifactProperty $source 'runner' 'Controlled toolchain record'
  $runnerFacts = [ordered]@{}
  foreach ($field in @('image', 'imageVersion', 'os', 'osVersion', 'architecture')) {
    $runnerFacts[$field] = Assert-RainReleaseArtifactNonBlankString ([string](Get-RainReleaseArtifactProperty $runner $field "Controlled toolchain record runner")) "Controlled toolchain record runner.$field"
  }

  $hostedVersions = [ordered]@{}
  foreach ($component in @('node', 'npm', 'cargo', 'nsis')) {
    $componentValue = Get-RainReleaseArtifactProperty $source $component 'Controlled toolchain record'
    $hostedVersions[$component] = Assert-RainReleaseArtifactNonBlankString ([string](Get-RainReleaseArtifactProperty $componentValue 'version' "Controlled toolchain record $component")) "Controlled toolchain record $component.version"
  }
  $msvc = Get-RainReleaseArtifactProperty $source 'msvc' 'Controlled toolchain record'
  $msvcVersion = Assert-RainReleaseArtifactNonBlankString ([string](Get-RainReleaseArtifactProperty $msvc 'version' 'Controlled toolchain record msvc')) 'Controlled toolchain record msvc.version'
  $msvcHostArchitecture = Assert-RainReleaseArtifactNonBlankString ([string](Get-RainReleaseArtifactProperty $msvc 'hostArchitecture' 'Controlled toolchain record msvc')) 'Controlled toolchain record msvc.hostArchitecture'
  $msvcTargetArchitecture = Assert-RainReleaseArtifactNonBlankString ([string](Get-RainReleaseArtifactProperty $msvc 'targetArchitecture' 'Controlled toolchain record msvc')) 'Controlled toolchain record msvc.targetArchitecture'
  if ($msvcHostArchitecture.ToLowerInvariant() -ne 'x64' -or $msvcTargetArchitecture.ToLowerInvariant() -ne 'x64') {
    throw 'Controlled toolchain record msvc hostArchitecture and targetArchitecture must be x64.'
  }

  $downloads = Get-RainReleaseArtifactProperty $source 'downloads' 'Controlled toolchain record'
  $normalizedDownloads = [ordered]@{}
  foreach ($downloadName in $script:PinnedControlledToolDownloads.Keys) {
    $expectedDownload = $script:PinnedControlledToolDownloads[$downloadName]
    $download = Get-RainReleaseArtifactProperty $downloads $downloadName 'Controlled toolchain record downloads'
    $downloadUrl = Assert-RainReleaseArtifactNonBlankString ([string](Get-RainReleaseArtifactProperty $download 'url' "Controlled toolchain record downloads $downloadName url")) "Controlled toolchain record downloads $downloadName url"
    $downloadHash = Assert-RainReleaseArtifactSha256String ([string](Get-RainReleaseArtifactProperty $download 'sha256' "Controlled toolchain record downloads $downloadName sha256")) "Controlled toolchain record downloads $downloadName sha256"
    if ($downloadUrl -ne $expectedDownload.url) {
      throw "Controlled toolchain record downloads $downloadName url must be the pinned download URL."
    }
    if ($downloadHash -ne $expectedDownload.sha256) {
      throw "Controlled toolchain record downloads $downloadName sha256 must be the pinned download hash."
    }
    $normalizedDownloads[$downloadName] = [ordered]@{ url = $downloadUrl; sha256 = $downloadHash }
  }

  $item = Get-Item -LiteralPath $path
  return ,([ordered]@{
    record = [ordered]@{
      fileName = $item.Name
      sizeBytes = $item.Length
      sha256 = Get-RainReleaseArtifactSha256 $path
    }
    cmake = [ordered]@{ version = $cmakeVersion; minimumVersion = $cmakeMinimumVersion }
    cuda = [ordered]@{
      toolkitVersion = $cudaToolkitVersion
      architectures = @($cudaArchitectures)
      architectureBasisUrl = $cudaArchitectureBasis
    }
    ninja = [ordered]@{ version = $ninjaVersion }
    llvm = [ordered]@{ version = $llvmVersion }
    rust = [ordered]@{ version = $rustVersion }
    runner = $runnerFacts
    node = [ordered]@{ version = $hostedVersions['node'] }
    npm = [ordered]@{ version = $hostedVersions['npm'] }
    cargo = [ordered]@{ version = $hostedVersions['cargo'] }
    msvc = [ordered]@{ version = $msvcVersion; hostArchitecture = $msvcHostArchitecture; targetArchitecture = $msvcTargetArchitecture }
    nsis = [ordered]@{ version = $hostedVersions['nsis'] }
    downloads = $normalizedDownloads
  })
}

function Assert-RainControlledToolchainMatch($Actual, $Expected, [string]$Description) {
  $actualRecord = Get-RainReleaseArtifactProperty $Actual 'record' $Description
  $expectedRecord = Get-RainReleaseArtifactProperty $Expected 'record' $Description
  foreach ($field in @('fileName', 'sizeBytes', 'sha256')) {
    if ([string](Get-RainReleaseArtifactProperty $actualRecord $field "$Description record") -ne [string](Get-RainReleaseArtifactProperty $expectedRecord $field "$Description record")) {
      throw "$Description record identity does not match the controlled toolchain record."
    }
  }
  $actualCmake = Get-RainReleaseArtifactProperty $Actual 'cmake' $Description
  $expectedCmake = Get-RainReleaseArtifactProperty $Expected 'cmake' $Description
  foreach ($field in @('version', 'minimumVersion')) {
    if ([string](Get-RainReleaseArtifactProperty $actualCmake $field "$Description cmake") -ne [string](Get-RainReleaseArtifactProperty $expectedCmake $field "$Description cmake")) {
      throw "$Description cmake does not match the controlled toolchain record."
    }
  }
  $actualCuda = Get-RainReleaseArtifactProperty $Actual 'cuda' $Description
  $expectedCuda = Get-RainReleaseArtifactProperty $Expected 'cuda' $Description
  foreach ($field in @('toolkitVersion', 'architectureBasisUrl')) {
    if ([string](Get-RainReleaseArtifactProperty $actualCuda $field "$Description cuda") -ne [string](Get-RainReleaseArtifactProperty $expectedCuda $field "$Description cuda")) {
      throw "$Description cuda does not match the controlled toolchain record."
    }
  }
  $actualArchitectures = @((Get-RainReleaseArtifactProperty $actualCuda 'architectures' "$Description cuda") | ForEach-Object { [string]$_ })
  $expectedArchitectures = @((Get-RainReleaseArtifactProperty $expectedCuda 'architectures' "$Description cuda") | ForEach-Object { [string]$_ })
  if (($actualArchitectures -join ',') -ne ($expectedArchitectures -join ',')) {
    throw "$Description CUDA architectures do not match the controlled toolchain record."
  }
  foreach ($component in @('ninja', 'llvm', 'rust')) {
    $actualComponent = Get-RainReleaseArtifactProperty $Actual $component $Description
    $expectedComponent = Get-RainReleaseArtifactProperty $Expected $component $Description
    if ([string](Get-RainReleaseArtifactProperty $actualComponent 'version' "$Description $component") -ne [string](Get-RainReleaseArtifactProperty $expectedComponent 'version' "$Description $component")) {
      throw "$Description $component does not match the controlled toolchain record."
    }
  }
  foreach ($component in @('runner', 'node', 'npm', 'cargo', 'msvc', 'nsis', 'downloads')) {
    $actualComponent = Get-RainReleaseArtifactProperty $Actual $component $Description
    $expectedComponent = Get-RainReleaseArtifactProperty $Expected $component $Description
    if ((ConvertTo-Json -InputObject $actualComponent -Depth 10 -Compress) -ne (ConvertTo-Json -InputObject $expectedComponent -Depth 10 -Compress)) {
      throw "$Description $component does not match the controlled toolchain record."
    }
  }
}

function Get-RainReleaseArtifactRelativePath([string]$Root, [string]$Path, [string]$Description) {
  $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
  $pathFull = [System.IO.Path]::GetFullPath($Path)
  $rootPrefix = $rootFull + [System.IO.Path]::DirectorySeparatorChar
  if (-not $pathFull.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Description must be inside the installed root: $pathFull"
  }

  $relative = $pathFull.Substring($rootPrefix.Length).Replace('\', '/')
  if ([string]::IsNullOrWhiteSpace($relative) -or
      [System.IO.Path]::IsPathRooted($relative) -or
      $relative.Contains(':') -or
      $relative.Split('/') -contains '..') {
    throw "$Description is not a canonical install-root-relative path: $relative"
  }
  return $relative
}

function Get-RainReleaseArtifactUniqueInstalledFile([string]$InstalledRoot, [string]$Name, [string]$Description) {
  $matches = @(
    Get-ChildItem -LiteralPath $InstalledRoot -File -Recurse -Force |
      Where-Object { $_.Name -ieq $Name }
  )
  if ($matches.Count -ne 1) {
    throw "$Description must occur exactly once below the installed root; found $($matches.Count)."
  }
  return $matches[0].FullName
}

function Assert-RainReleaseArtifactPeImportOutput {
  param(
    [AllowEmptyString()][string]$Output,
    [int]$ExitCode
  )
  $text = ([string]$Output).Trim()
  if ($ExitCode -ne 0) {
    throw "dumpbin.exe failed while inspecting Rain main executable imports with exit code $ExitCode."
  }
  if ([string]::IsNullOrWhiteSpace($text)) {
    throw 'dumpbin.exe returned blank Rain main executable import output.'
  }
  if ($text -notmatch '(?im)^\s*Section contains the following imports:\s*$' -or
      $text -notmatch '(?im)^\s*[A-Za-z0-9._+-]+\.dll\s*$') {
    throw 'dumpbin.exe output does not contain a recognizable PE import table.'
  }
  return $text
}

function Get-RainReleaseArtifactPeImports([string]$Path) {
  $dumpbin = Get-Command 'dumpbin.exe' -ErrorAction SilentlyContinue
  if (-not $dumpbin) {
    throw 'dumpbin.exe is required to inspect Rain main executable imports.'
  }
  $output = & $dumpbin.Source /imports $Path 2>&1
  $exitCode = $LASTEXITCODE
  return Assert-RainReleaseArtifactPeImportOutput -Output ($output | Out-String) -ExitCode $exitCode
}

function Get-RainTauriSourceMetadata([string]$CandidateSourceRoot) {
  $sourceRoot = Resolve-RainReleaseArtifactDirectory $CandidateSourceRoot 'Candidate source root'
  $tauriConfigPath = Resolve-RainReleaseArtifactFile (Join-Path $sourceRoot 'src-tauri\tauri.conf.json') 'Tauri source metadata'
  $gpuConfigPath = Resolve-RainReleaseArtifactFile (Join-Path $sourceRoot 'src-tauri\tauri.gpu.conf.json') 'Tauri GPU bundle metadata'
  try {
    $tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $gpuConfig = Get-Content -LiteralPath $gpuConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Tauri source metadata is not valid JSON: $($_.Exception.Message)"
  }
  $productName = [string](Get-RainReleaseArtifactProperty $tauriConfig 'productName' 'Tauri source metadata')
  $version = [string](Get-RainReleaseArtifactProperty $tauriConfig 'version' 'Tauri source metadata')
  $identifier = [string](Get-RainReleaseArtifactProperty $tauriConfig 'identifier' 'Tauri source metadata')
  if ([string]::IsNullOrWhiteSpace($productName) -or [string]::IsNullOrWhiteSpace($version) -or [string]::IsNullOrWhiteSpace($identifier)) {
    throw 'Tauri source metadata productName, version, and identifier must not be blank.'
  }
  $bundle = Get-RainReleaseArtifactProperty $gpuConfig 'bundle' 'Tauri GPU bundle metadata'
  if ((Get-RainReleaseArtifactProperty $bundle 'active' 'Tauri GPU bundle metadata') -ne $true) {
    throw 'Tauri GPU bundle metadata must enable bundling.'
  }
  $targets = @((Get-RainReleaseArtifactProperty $bundle 'targets' 'Tauri GPU bundle metadata'))
  if ($targets.Count -ne 1 -or [string]$targets[0] -ne 'nsis') {
    throw 'Tauri GPU bundle metadata must target exactly NSIS.'
  }
  $resources = Get-RainReleaseArtifactProperty $bundle 'resources' 'Tauri GPU bundle metadata'
  $expectedResources = [ordered]@{
    'target/whisper-gpu-bundle/whisper-backends/rain-whisper-cuda.exe' = 'whisper-backends/rain-whisper-cuda.exe'
    'target/whisper-gpu-bundle/whisper-backends/cublas64_12.dll' = 'whisper-backends/cublas64_12.dll'
    'target/whisper-gpu-bundle/whisper-backends/cublasLt64_12.dll' = 'whisper-backends/cublasLt64_12.dll'
    'target/whisper-gpu-bundle/whisper-backends/cudart64_12.dll' = 'whisper-backends/cudart64_12.dll'
    'target/whisper-gpu-bundle/whisper-backends/payload-manifest.json' = 'whisper-backends/payload-manifest.json'
  }
  $resourceProperties = @($resources.PSObject.Properties)
  if ($resourceProperties.Count -ne $expectedResources.Count) {
    throw 'Tauri GPU bundle metadata must declare exactly the controlled whisper-backends resources.'
  }
  foreach ($sourcePath in $expectedResources.Keys) {
    $property = @($resourceProperties | Where-Object { $_.Name -eq $sourcePath })
    if ($property.Count -ne 1 -or [string]$property[0].Value -ne $expectedResources[$sourcePath]) {
      throw "Tauri GPU bundle metadata does not bind the required resource: $sourcePath"
    }
  }
  return [pscustomobject]@{
    sourceRoot = $sourceRoot
    productName = $productName
    version = $version
    identifier = $identifier
    expectedInstallerFileName = "$productName`_$version`_x64-setup.exe"
    installerKind = 'nsis-windows-x64'
  }
}

function Get-RainReleaseArtifactPeMachine([string]$Path, [string]$Description) {
  $file = Resolve-RainReleaseArtifactFile $Path $Description
  $item = Get-Item -LiteralPath $file
  if ($item.Length -lt 0x40) {
    throw "$Description is not a basic PE artifact."
  }
  $stream = [System.IO.File]::Open($file, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  try {
    $header = [byte[]]::new(0x40)
    if ($stream.Read($header, 0, $header.Length) -ne $header.Length -or
        $header[0] -ne [byte][char]'M' -or $header[1] -ne [byte][char]'Z') {
      throw "$Description is not a basic PE artifact."
    }
    $peOffset = [BitConverter]::ToInt32($header, 0x3c)
    if ($peOffset -lt 0x40 -or $peOffset + 6 -gt $item.Length) {
      throw "$Description is not a basic PE artifact."
    }
    $stream.Position = $peOffset
    $signature = [byte[]]::new(6)
    if ($stream.Read($signature, 0, $signature.Length) -ne $signature.Length -or
        $signature[0] -ne [byte][char]'P' -or $signature[1] -ne [byte][char]'E' -or
        $signature[2] -ne 0 -or $signature[3] -ne 0) {
      throw "$Description is not a basic PE artifact."
    }
    return [BitConverter]::ToUInt16($signature, 4)
  } finally {
    $stream.Dispose()
  }
}

function Assert-RainNsisInstallerArtifact([string]$InstallerPath, $SourceMetadata) {
  $installer = Resolve-RainReleaseArtifactFile $InstallerPath 'Installer'
  $installerItem = Get-Item -LiteralPath $installer
  if ($installerItem.Name -ne $SourceMetadata.expectedInstallerFileName) {
    throw "Installer file name does not match the source-derived NSIS installer file name: expected $($SourceMetadata.expectedInstallerFileName), found $($installerItem.Name)."
  }
  # NSIS bootstrapper stubs can be I386 even when their installed application is x64.
  # The installer machine field is therefore deliberately not the artifact architecture proof.
  [void](Get-RainReleaseArtifactPeMachine -Path $installer -Description 'Installer')
  return $installer
}

function Assert-RainNsisInstallationProof {
  param(
    $Proof,
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][string]$InstalledRoot
  )

  if ($null -eq $Proof) {
    throw 'Controlled artifact generation requires a successful bound NSIS installation proof.'
  }
  if ([string](Get-RainReleaseArtifactProperty $Proof 'kind' 'NSIS installation proof') -ne 'rain-nsis-install-proof-v1') {
    throw 'NSIS installation proof kind is not recognized.'
  }
  if ([int](Get-RainReleaseArtifactProperty $Proof 'schemaVersion' 'NSIS installation proof') -ne 1) {
    throw 'NSIS installation proof schemaVersion must be 1.'
  }

  $installer = Resolve-RainReleaseArtifactFile $InstallerPath 'Installer'
  $installed = Resolve-RainReleaseArtifactDirectory $InstalledRoot 'Installed root'
  $proofInstallerPath = [string](Get-RainReleaseArtifactProperty $Proof 'installerPath' 'NSIS installation proof')
  if (-not (Test-RainReleaseArtifactSameExistingPath $proofInstallerPath $installer $false)) {
    throw 'NSIS installation proof is not bound to the supplied installer path.'
  }
  if ([string](Get-RainReleaseArtifactProperty $Proof 'installerSha256' 'NSIS installation proof') -ne (Get-RainReleaseArtifactSha256 $installer)) {
    throw 'NSIS installation proof is not bound to the supplied installer bytes.'
  }
  $proofInstalledRoot = [string](Get-RainReleaseArtifactProperty $Proof 'installRoot' 'NSIS installation proof')
  if (-not (Test-RainReleaseArtifactSameExistingPath $proofInstalledRoot $installed $true)) {
    throw 'NSIS installation proof is not bound to the supplied installed root.'
  }
  $expectedMainExecutable = Join-Path $installed 'rain.exe'
  $proofMainExecutable = [string](Get-RainReleaseArtifactProperty $Proof 'mainExecutable' 'NSIS installation proof')
  if (-not (Test-RainReleaseArtifactSameExistingPath $proofMainExecutable $expectedMainExecutable $false) -or
      [int](Get-RainReleaseArtifactProperty $Proof 'mainExecutableMachine' 'NSIS installation proof') -ne 0x8664) {
    throw 'NSIS installation proof does not establish an AMD64 Rain.exe at the exact application-root layout.'
  }
  $expectedPayloadManifest = Join-Path $installed 'resources\whisper-backends\payload-manifest.json'
  $proofPayloadManifest = [string](Get-RainReleaseArtifactProperty $Proof 'payloadManifestPath' 'NSIS installation proof')
  if (-not (Test-RainReleaseArtifactSameExistingPath $proofPayloadManifest $expectedPayloadManifest $false)) {
    throw 'NSIS installation proof does not establish the exact CUDA payload layout.'
  }
  $silentInstall = Get-RainReleaseArtifactProperty $Proof 'silentInstall' 'NSIS installation proof'
  $arguments = @((Get-RainReleaseArtifactProperty $silentInstall 'arguments' 'NSIS installation proof silentInstall') | ForEach-Object { [string]$_ })
  $hasBoundSilentDestination = $false
  if ($arguments.Count -eq 2 -and $arguments[0] -ceq '/S' -and $arguments[1].StartsWith('/D=', [System.StringComparison]::Ordinal)) {
    $hasBoundSilentDestination = Test-RainReleaseArtifactSameExistingPath $arguments[1].Substring(3) $installed $true
  }
  if (-not $hasBoundSilentDestination -or
      (Get-RainReleaseArtifactProperty $silentInstall 'waited' 'NSIS installation proof silentInstall') -ne $true -or
      [int](Get-RainReleaseArtifactProperty $silentInstall 'exitCode' 'NSIS installation proof silentInstall') -ne 0) {
    throw 'NSIS installation proof must record a successful waited /S installation into the exact root.'
  }
  return [pscustomobject][ordered]@{
    kind = 'rain-nsis-install-proof-v2'
    schemaVersion = 2
    installerSha256 = Get-RainReleaseArtifactSha256 $installer
    mainExecutable = [ordered]@{ path = 'rain.exe'; machine = 0x8664 }
    payloadManifest = [ordered]@{ path = 'resources/whisper-backends/payload-manifest.json' }
    silentInstall = [ordered]@{
      mode = 'silent'
      destinationKind = 'unique-runner-temp'
      waited = $true
      exitCode = 0
    }
  }
}

function Test-RainReleaseArtifactCudaImports([string]$ImportText) {
  $importNames = @(
    [regex]::Matches($ImportText, '(?i)\b[A-Za-z0-9._-]+\.dll\b') |
      ForEach-Object { $_.Value.ToLowerInvariant() } |
      Select-Object -Unique
  )
  return @($importNames | Where-Object { Test-ReleaseEvidenceCudaOrDriverDllName ([string]$_) }).Count -gt 0
}

function New-RainReleaseArtifactAtomicWriteAdapter {
  return [pscustomobject]@{
    writeText = {
      param([string]$TemporaryPath, [string]$Text)
      [System.IO.File]::WriteAllText($TemporaryPath, $Text, [System.Text.UTF8Encoding]::new($false))
    }
    publish = {
      param([string]$TemporaryPath, [string]$DestinationPath)
      if ([System.IO.File]::Exists($DestinationPath)) {
        [System.IO.File]::Replace($TemporaryPath, $DestinationPath, $null)
      } else {
        [System.IO.File]::Move($TemporaryPath, $DestinationPath)
      }
    }
    remove = {
      param([string]$Path)
      if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
      }
    }
    sleep = {
      param([int]$Attempt)
      Start-Sleep -Milliseconds (50 * $Attempt)
    }
  }
}

function Assert-RainReleaseArtifactAtomicWriteAdapter($Adapter) {
  if ($null -eq $Adapter) { return New-RainReleaseArtifactAtomicWriteAdapter }
  foreach ($method in @('writeText', 'publish', 'remove', 'sleep')) {
    if (-not ($Adapter.PSObject.Properties.Name -contains $method) -or $Adapter.$method -isnot [scriptblock]) {
      throw "Release artifact atomic-write adapter '$method' must be a script block."
    }
  }
  return $Adapter
}

function Write-RainReleaseArtifactJson {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)]$Value,
    $AtomicWriteAdapter
  )

  $adapter = Assert-RainReleaseArtifactAtomicWriteAdapter $AtomicWriteAdapter
  $directory = Split-Path -Parent $Path
  if ([string]::IsNullOrWhiteSpace($directory)) {
    throw "Release artifact output path must have a parent directory: $Path"
  }
  [void][System.IO.Directory]::CreateDirectory($directory)
  $json = ConvertTo-Json -InputObject $Value -Depth 30
  $lastError = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $temporary = Join-Path $directory ('.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $operationError = $null
    $cleanupError = $null
    try {
      & $adapter.writeText $temporary $json
      & $adapter.publish $temporary $Path
    } catch {
      $operationError = $_
    } finally {
      try {
        & $adapter.remove $temporary
      } catch {
        $cleanupError = $_
      }
    }
    if ($null -ne $cleanupError) {
      if ($null -ne $operationError) {
        throw "Release artifact atomic write failed: $($operationError.Exception.Message); additionally, temporary cleanup failed for ${temporary}: $($cleanupError.Exception.Message)"
      }
      throw "Release artifact temporary cleanup failed for ${temporary}: $($cleanupError.Exception.Message)"
    }
    if ($null -eq $operationError) {
      return
    }
    if ($operationError.Exception -is [System.IO.IOException]) {
      $lastError = $operationError
      if ($attempt -ge 3) { break }
      & $adapter.sleep $attempt
      continue
    }
    throw $operationError
  }
  throw "Could not atomically publish release artifact after 3 attempts: $($lastError.Exception.Message)"
}

function Assert-RainControlledCanonicalBuildContext {
  param(
    [Parameter(Mandatory = $true)][string]$Repository,
    [Parameter(Mandatory = $true)][string]$SourceRepository,
    [Parameter(Mandatory = $true)][string]$WorkflowFile,
    [Parameter(Mandatory = $true)][string]$WorkflowRunUrl,
    [Parameter(Mandatory = $true)][string]$WorkflowEvent,
    [Parameter(Mandatory = $true)][string]$WorkflowRef,
    [Parameter(Mandatory = $true)][string]$WorkflowRunId,
    [Parameter(Mandatory = $true)][int]$WorkflowRunAttempt,
    [Parameter(Mandatory = $true)][bool]$CandidateMasterReachable,
    [Parameter(Mandatory = $true)][bool]$ToolingMasterReachable
  )

  if ($Repository -ne $script:CanonicalRainRepository) {
    throw "Repository must be $script:CanonicalRainRepository."
  }
  if ($SourceRepository -ne $script:CanonicalRainOrigin) {
    throw "SourceRepository must be $script:CanonicalRainOrigin."
  }
  if ($WorkflowFile -ne '.github/workflows/controlled-gpu-artifact-build.yml') {
    throw 'WorkflowFile must be the controlled GPU artifact workflow.'
  }
  if ($WorkflowRunId -notmatch '^[0-9]+$' -or $WorkflowRunAttempt -lt 1) {
    throw 'WorkflowRunId and a positive WorkflowRunAttempt are required.'
  }
  if ($WorkflowEvent -ne 'workflow_dispatch') {
    throw 'WorkflowEvent must be workflow_dispatch.'
  }
  if ($WorkflowRef -ne 'refs/heads/master') {
    throw 'WorkflowRef must be refs/heads/master.'
  }
  $expectedRunUrl = "https://github.com/$script:CanonicalRainRepository/actions/runs/$WorkflowRunId/attempts/$WorkflowRunAttempt"
  if ($WorkflowRunUrl -ne $expectedRunUrl) {
    throw 'WorkflowRunUrl must bind the canonical repository, run id, and attempt.'
  }
  if (-not $CandidateMasterReachable -or -not $ToolingMasterReachable) {
    throw 'Candidate and tooling commits must be reachable from canonical master.'
  }
}

function Assert-RainReleaseArtifactArchiveContents {
  param([Parameter(Mandatory = $true)][string]$InstallerArchiveRoot)

  $archive = Resolve-RainReleaseArtifactDirectory $InstallerArchiveRoot 'Installer archive root'
  $files = @(Get-ChildItem -LiteralPath $archive -File -Recurse -Force -ErrorAction Stop)
  if ($files.Count -eq 0) {
    throw 'Installer archive extraction is empty; an unscanned archive scope cannot be declared clean.'
  }

  $rainExecutables = @($files | Where-Object { $_.Name -ieq 'rain.exe' })
  if ($rainExecutables.Count -ne 1) {
    throw "Installer archive extraction must contain exactly one AMD64 Rain executable; found $($rainExecutables.Count)."
  }
  if ((Get-RainReleaseArtifactPeMachine -Path $rainExecutables[0].FullName -Description 'Installer archive Rain executable') -ne 0x8664) {
    throw 'Installer archive Rain executable must be an AMD64 PE artifact.'
  }

  $pluginDirectories = @(Get-ChildItem -LiteralPath $archive -Directory -Recurse -Force -ErrorAction Stop | Where-Object { $_.Name -ceq '$PLUGINSDIR' })
  if ($pluginDirectories.Count -ne 1) {
    throw "Installer archive extraction must contain exactly one explicit NSIS `$PLUGINSDIR wrapper; found $($pluginDirectories.Count)."
  }
  $pluginRoot = $pluginDirectories[0].FullName
  if ((Get-RainReleaseArtifactRelativePath $archive $pluginRoot 'Installer archive NSIS wrapper') -ne '$PLUGINSDIR') {
    throw 'Installer archive NSIS $PLUGINSDIR wrapper must be a direct child of the extraction root.'
  }
  $expectedRainExecutable = Join-Path $pluginRoot 'Rain.exe'
  if (-not (Test-RainReleaseArtifactSameExistingPath $rainExecutables[0].FullName $expectedRainExecutable $false)) {
    throw 'Installer archive Rain executable must be located at $PLUGINSDIR/Rain.exe.'
  }

  $payloadManifests = @($files | Where-Object { $_.Name -ieq 'payload-manifest.json' })
  if ($payloadManifests.Count -ne 1) {
    throw "Installer archive extraction must contain exactly one CUDA payload manifest; found $($payloadManifests.Count)."
  }
  $payloadDirectory = Join-Path $pluginRoot 'resources\whisper-backends'
  $expectedPayloadManifest = Join-Path $payloadDirectory 'payload-manifest.json'
  if (-not (Test-RainReleaseArtifactSameExistingPath $payloadManifests[0].FullName $expectedPayloadManifest $false)) {
    throw 'Installer archive CUDA payload manifest must be located at $PLUGINSDIR/resources/whisper-backends/payload-manifest.json.'
  }
  try {
    $payload = Get-Content -LiteralPath $payloadManifests[0].FullName -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Installer archive CUDA payload manifest is not valid JSON: $($_.Exception.Message)"
  }
  if ([int](Get-RainReleaseArtifactProperty $payload 'schemaVersion' 'Installer archive CUDA payload manifest') -ne 1 -or
      [string](Get-RainReleaseArtifactProperty $payload 'configuration' 'Installer archive CUDA payload manifest') -ne 'release' -or
      [int](Get-RainReleaseArtifactProperty $payload 'workerProtocolVersion' 'Installer archive CUDA payload manifest') -ne 1 -or
      (Get-RainReleaseArtifactProperty $payload 'driverLibraryBundled' 'Installer archive CUDA payload manifest') -ne $false) {
    throw 'Installer archive CUDA payload manifest does not declare the required release payload contract.'
  }

  $payloadEntries = @((Get-RainReleaseArtifactProperty $payload 'files' 'Installer archive CUDA payload manifest'))
  if ($payloadEntries.Count -ne $script:RequiredCudaPayloadFiles.Count) {
    throw 'Installer archive CUDA payload manifest file list is not the required exact payload set.'
  }
  $payloadByName = @{}
  foreach ($entry in $payloadEntries) {
    $name = [string](Get-RainReleaseArtifactProperty $entry 'name' 'Installer archive CUDA payload manifest file')
    if ([string]::IsNullOrWhiteSpace($name) -or $name -ne [System.IO.Path]::GetFileName($name)) {
      throw "Installer archive CUDA payload manifest has an unsafe file name: $name"
    }
    $key = $name.ToLowerInvariant()
    if ($payloadByName.ContainsKey($key)) {
      throw "Installer archive CUDA payload manifest contains duplicate file '$name'."
    }
    $payloadByName[$key] = $entry
  }
  foreach ($requiredName in $script:RequiredCudaPayloadFiles) {
    $matches = @($files | Where-Object { $_.Name -ieq $requiredName })
    if ($matches.Count -ne 1 -or -not $payloadByName.ContainsKey($requiredName.ToLowerInvariant())) {
      throw "Installer archive extraction must contain exactly one required CUDA payload file '$requiredName'; found $($matches.Count)."
    }
    $entry = $payloadByName[$requiredName.ToLowerInvariant()]
    $file = $matches[0]
    $expectedFile = Join-Path $payloadDirectory $requiredName
    if (-not (Test-RainReleaseArtifactSameExistingPath $file.FullName $expectedFile $false)) {
      throw "Installer archive CUDA payload file '$requiredName' must be located below the explicit `$PLUGINSDIR/resources/whisper-backends payload directory."
    }
    if ([int64](Get-RainReleaseArtifactProperty $entry 'sizeBytes' "Installer archive CUDA payload manifest file $requiredName") -ne $file.Length -or
        [string](Get-RainReleaseArtifactProperty $entry 'sha256' "Installer archive CUDA payload manifest file $requiredName") -ne (Get-RainReleaseArtifactSha256 $file.FullName)) {
      throw "Installer archive CUDA payload manifest does not match actual file '$requiredName'."
    }
  }
  $actualPayloadFiles = @(Get-ChildItem -LiteralPath $payloadDirectory -File -Recurse -Force -ErrorAction Stop)
  $expectedPayloadNames = @($script:RequiredCudaPayloadFiles) + 'payload-manifest.json'
  $unexpectedPayloadFiles = @($actualPayloadFiles | Where-Object { $_.Name -notin $expectedPayloadNames })
  if ($actualPayloadFiles.Count -ne $expectedPayloadNames.Count -or $unexpectedPayloadFiles.Count -gt 0) {
    throw 'Installer archive CUDA payload directory must contain exactly the payload manifest, worker, and three CUDA runtime DLLs.'
  }
  return [pscustomobject]@{
    archiveRoot = $archive
    fileCount = $files.Count
    rainExecutable = $rainExecutables[0].FullName
    payloadManifest = $payloadManifests[0].FullName
  }
}

function Test-RainReleaseArtifactSecretText([AllowNull()][string]$Text) {
  return @(Get-ReleaseEvidenceSecretFindings $Text).Count -gt 0
}

function Test-RainReleaseArtifactBinaryContainsSecret([string]$Path) {
  $stream = $null
  try {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    $buffer = [byte[]]::new(65536)
    $carry = [byte[]]::new(0)
    while (($read = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $combined = [byte[]]::new($carry.Length + $read)
      if ($carry.Length -gt 0) { [System.Buffer]::BlockCopy($carry, 0, $combined, 0, $carry.Length) }
      [System.Buffer]::BlockCopy($buffer, 0, $combined, $carry.Length, $read)
      $candidateTexts = @(
        [System.Text.Encoding]::ASCII.GetString($combined),
        [System.Text.Encoding]::Unicode.GetString($combined)
      )
      if ($combined.Length -gt 1) {
        $candidateTexts += [System.Text.Encoding]::Unicode.GetString($combined, 1, $combined.Length - 1)
      }
      foreach ($candidateText in $candidateTexts) {
        if (Test-RainReleaseArtifactSecretText $candidateText) { return $true }
      }
      $carryLength = [Math]::Min(512, $combined.Length)
      $carry = [byte[]]::new($carryLength)
      [System.Buffer]::BlockCopy($combined, $combined.Length - $carryLength, $carry, 0, $carryLength)
    }
    return $false
  } finally {
    if ($stream) { $stream.Dispose() }
  }
}

function Get-RainReleaseArtifactHygieneFindings([string]$InstalledRoot) {
  $findings = [ordered]@{
    secrets = @()
    e2eMarkers = @()
    absolutePaths = @()
    userData = @()
    forbiddenDlls = @()
    modelFiles = @()
    sourceMaps = @()
    unscannedTextFiles = @()
    unreadableTextFiles = @()
    debugArtifacts = @()
  }
  $installedFiles = @(
    Get-ChildItem -LiteralPath $InstalledRoot -File -Recurse -Force |
      Sort-Object -Property FullName
  )

  foreach ($file in $installedFiles) {
    $relative = Get-RainReleaseArtifactRelativePath $InstalledRoot $file.FullName "Installed artifact file $($file.Name)"
    $name = $file.Name
    $nameLower = $name.ToLowerInvariant()
    $pathSegments = @($relative.Split('/'))
    $extension = $file.Extension.ToLowerInvariant()

    if ($extension -eq '.dll' -and
        $script:AllowedCudaRuntimeFiles -notcontains $nameLower -and
        (Test-ReleaseEvidenceCudaOrDriverDllName $name)) {
      $findings.forbiddenDlls += $relative
    }
    if ($nameLower -match '^ggml-.*\.bin$' -or $nameLower.EndsWith('.gguf') -or $pathSegments -contains 'whisper-models') {
      $findings.modelFiles += $relative
    }
    if ($extension -in @('.db', '.sqlite', '.sqlite3') -or
        $nameLower -in @('rain.db', 'settings.json', 'notes.json') -or
        $pathSegments -contains 'evidence' -or $pathSegments -contains 'logs') {
      $findings.userData += $relative
    }
    if ($nameLower -eq '.env' -or $nameLower.StartsWith('.env.') -or $extension -in @('.pem', '.key')) {
      $findings.secrets += $relative
    }
    if ($extension -eq '.map') {
      $findings.sourceMaps += $relative
    }
    if ($extension -in @('.pdb', '.dbg', '.ilk')) {
      $findings.debugArtifacts += $relative
    }

    $isTextArtifact = $script:TextArtifactExtensions -contains $extension -or $nameLower -eq '.env' -or $nameLower.StartsWith('.env.')
    if (-not $isTextArtifact) {
      if ($extension -in @('.exe', '.dll')) {
        if (Test-RainReleaseArtifactBinaryContainsSecret $file.FullName) { $findings.secrets += $relative }
        continue
      }
      if ($extension -in @('.pdb', '.dbg', '.ilk')) { continue }
      if ($file.Length -gt $script:MaximumTextArtifactBytes) {
        $findings.unscannedTextFiles += $relative
        continue
      }
      try {
        $unknownText = [System.IO.File]::ReadAllText($file.FullName, [System.Text.UTF8Encoding]::new($false, $true))
        if (Test-RainReleaseArtifactSecretText $unknownText) { $findings.secrets += $relative }
        if ($unknownText.IndexOf([char]0) -lt 0 -and $unknownText -notmatch '[\x01-\x08\x0B\x0C\x0E-\x1F]') {
          $findings.unscannedTextFiles += $relative
        }
      } catch {
        # Unknown binary artifacts are covered by the explicit binary policies.
      }
      continue
    }
    if ($file.Length -gt $script:MaximumTextArtifactBytes) {
      $findings.unscannedTextFiles += $relative
      continue
    }

    try {
      $text = [System.IO.File]::ReadAllText($file.FullName, [System.Text.UTF8Encoding]::new($false, $true))
    } catch {
      $findings.unreadableTextFiles += $relative
      continue
    }
    if ($text -match '(?i)(?:RAIN_E2E_[A-Z0-9_]*|RAIN_WHISPER_CUDA_WORKER)') {
      $findings.e2eMarkers += $relative
    }
    if ($text -match '(?i)\b[a-z]:(?:\\+|/)[^\r\n"'']+') {
      $findings.absolutePaths += $relative
    }
    if (Test-RainReleaseArtifactSecretText $text) { $findings.secrets += $relative }
  }

  $findingPropertyNames = @($findings.Keys)
  foreach ($propertyName in $findingPropertyNames) {
    $findings[$propertyName] = @($findings[$propertyName] | Sort-Object -Unique)
  }
  return $findings
}

function Assert-RainReleaseArtifactHygiene($Findings) {
  $failures = @()
  if (@($Findings.forbiddenDlls).Count -gt 0) {
    $failures += "forbidden DLL: $($Findings.forbiddenDlls -join ', ')"
  }
  if (@($Findings.absolutePaths).Count -gt 0) {
    $failures += "absolute builder path: $($Findings.absolutePaths -join ', ')"
  }
  if (@($Findings.e2eMarkers).Count -gt 0) {
    $failures += "E2E marker: $($Findings.e2eMarkers -join ', ')"
  }
  if (@($Findings.modelFiles).Count -gt 0) {
    $failures += "model file: $($Findings.modelFiles -join ', ')"
  }
  if (@($Findings.sourceMaps).Count -gt 0) {
    $failures += "source map: $($Findings.sourceMaps -join ', ')"
  }
  if (@($Findings.userData).Count -gt 0) {
    $failures += "user data: $($Findings.userData -join ', ')"
  }
  if (@($Findings.secrets).Count -gt 0) {
    $failures += "secret: $($Findings.secrets -join ', ')"
  }
  if (@($Findings.unscannedTextFiles).Count -gt 0) {
    $failures += "unscanned text artifact: $($Findings.unscannedTextFiles -join ', ')"
  }
  if (@($Findings.unreadableTextFiles).Count -gt 0) {
    $failures += "unreadable text artifact: $($Findings.unreadableTextFiles -join ', ')"
  }
  if (@($Findings.debugArtifacts).Count -gt 0) {
    $failures += "debug artifact: $($Findings.debugArtifacts -join ', ')"
  }
  if ($failures.Count -gt 0) {
    throw "Release artifact hygiene check failed: $($failures -join '; ')"
  }
}

function New-RainControlledReleaseArtifacts {
  param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][string]$InstalledRoot,
    [Parameter(Mandatory = $true)][string]$InstallerArchiveRoot,
    [Parameter(Mandatory = $true)][string]$CandidateSourceRoot,
    [Parameter(Mandatory = $true)][string]$ToolchainRecordPath,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$CandidateTargetCommit,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ToolingCommit,
    [Parameter(Mandatory = $true)][string]$Repository,
    [Parameter(Mandatory = $true)][string]$SourceRepository,
    [Parameter(Mandatory = $true)][string]$GeneratorId,
    [Parameter(Mandatory = $true)][string]$GeneratorVersion,
    [Parameter(Mandatory = $true)][string]$BuildRecordId,
    [Parameter(Mandatory = $true)][string]$BuiltAt,
    [Parameter(Mandatory = $true)][string]$WorkflowFile,
    [Parameter(Mandatory = $true)][string]$WorkflowRunUrl,
    [Parameter(Mandatory = $true)][string]$WorkflowEvent,
    [Parameter(Mandatory = $true)][string]$WorkflowRef,
    [Parameter(Mandatory = $true)][string]$WorkflowRunId,
    [Parameter(Mandatory = $true)][int]$WorkflowRunAttempt,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$WorkflowDefinitionCommit,
    [Parameter(Mandatory = $true)][bool]$CandidateMasterReachable,
    [Parameter(Mandatory = $true)][bool]$ToolingMasterReachable,
    [bool]$CleanTree = $true,
    [scriptblock]$GetPeImportText = ${function:Get-RainReleaseArtifactPeImports},
    [string]$CoreArtifactName = '',
    [string]$CoreArtifactDigest = '',
    $AtomicWriteAdapter,
    $NsisInstallationProof,
    [switch]$ManifestOnly
  )

  Assert-RainControlledCanonicalBuildContext -Repository $Repository -SourceRepository $SourceRepository -WorkflowFile $WorkflowFile -WorkflowRunUrl $WorkflowRunUrl -WorkflowEvent $WorkflowEvent -WorkflowRef $WorkflowRef -WorkflowRunId $WorkflowRunId -WorkflowRunAttempt $WorkflowRunAttempt -CandidateMasterReachable $CandidateMasterReachable -ToolingMasterReachable $ToolingMasterReachable
  if ([string]::IsNullOrWhiteSpace($GeneratorId) -or [string]::IsNullOrWhiteSpace($GeneratorVersion)) {
    throw 'GeneratorId and GeneratorVersion must not be blank.'
  }
  if ([string]::IsNullOrWhiteSpace($BuildRecordId)) { throw 'BuildRecordId must not be blank.' }
  if ([string]::IsNullOrWhiteSpace($WorkflowFile) -or [string]::IsNullOrWhiteSpace($WorkflowRunId) -or $WorkflowRunAttempt -lt 1) {
    throw 'WorkflowFile, WorkflowRunId and a positive WorkflowRunAttempt are required.'
  }
  if (-not $CleanTree) { throw 'Controlled build candidate checkout must be clean.' }

  $parsedBuiltAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse($BuiltAt, [ref]$parsedBuiltAt)) {
    throw 'BuiltAt must be an ISO-8601 timestamp.'
  }

  $sourceMetadata = Get-RainTauriSourceMetadata $CandidateSourceRoot
  $toolchain = Get-RainControlledToolchainRecord $ToolchainRecordPath
  $installer = Assert-RainNsisInstallerArtifact -InstallerPath $InstallerPath -SourceMetadata $sourceMetadata
  $installed = Resolve-RainReleaseArtifactDirectory $InstalledRoot 'Installed root'
  $installerArchive = Resolve-RainReleaseArtifactDirectory $InstallerArchiveRoot 'Installer archive root'
  [void](Assert-RainReleaseArtifactArchiveContents -InstallerArchiveRoot $installerArchive)
  $nsisInstallationProof = Assert-RainNsisInstallationProof -Proof $NsisInstallationProof -InstallerPath $installer -InstalledRoot $installed
  $output = [System.IO.Path]::GetFullPath($OutputDirectory)
  [void][System.IO.Directory]::CreateDirectory($output)

  $mainExecutable = Get-RainReleaseArtifactUniqueInstalledFile $installed 'rain.exe' 'Rain main executable'
  $expectedMainExecutable = Join-Path $installed 'rain.exe'
  if (-not [string]::Equals(
      [System.IO.Path]::GetFullPath($mainExecutable),
      [System.IO.Path]::GetFullPath($expectedMainExecutable),
      [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Rain main executable must be installed at rain.exe in the application root.'
  }
  if ((Get-RainReleaseArtifactPeMachine -Path $mainExecutable -Description 'Installed Rain main executable') -ne 0x8664) {
    throw 'Installed Rain main executable must be an AMD64 PE artifact.'
  }
  $payloadManifestPath = Get-RainReleaseArtifactUniqueInstalledFile $installed 'payload-manifest.json' 'CUDA payload manifest'
  try {
    $payloadManifest = Get-Content -LiteralPath $payloadManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "CUDA payload manifest is not valid JSON: $($_.Exception.Message)"
  }

  if ([int](Get-RainReleaseArtifactProperty $payloadManifest 'schemaVersion' 'CUDA payload manifest') -ne 1) {
    throw 'CUDA payload manifest schemaVersion must be 1.'
  }
  if ([string](Get-RainReleaseArtifactProperty $payloadManifest 'configuration' 'CUDA payload manifest') -ne 'release') {
    throw 'CUDA payload manifest configuration must be release.'
  }
  if ([int](Get-RainReleaseArtifactProperty $payloadManifest 'workerProtocolVersion' 'CUDA payload manifest') -ne 1) {
    throw 'CUDA payload manifest workerProtocolVersion must be 1.'
  }
  if ((Get-RainReleaseArtifactProperty $payloadManifest 'driverLibraryBundled' 'CUDA payload manifest') -ne $false) {
    throw 'CUDA payload manifest driverLibraryBundled must be false.'
  }

  $payloadEntries = @((Get-RainReleaseArtifactProperty $payloadManifest 'files' 'CUDA payload manifest'))
  if ($payloadEntries.Count -ne $script:RequiredCudaPayloadFiles.Count) {
    throw 'CUDA payload manifest file list is not the required exact payload set.'
  }
  $payloadByName = @{}
  foreach ($entry in $payloadEntries) {
    $name = [string](Get-RainReleaseArtifactProperty $entry 'name' 'CUDA payload manifest file')
    if ([string]::IsNullOrWhiteSpace($name) -or $name -ne [System.IO.Path]::GetFileName($name)) {
      throw "CUDA payload manifest file name is not a simple file name: $name"
    }
    $key = $name.ToLowerInvariant()
    if ($payloadByName.ContainsKey($key)) { throw "CUDA payload manifest contains duplicate file '$name'." }
    $payloadByName[$key] = $entry
  }

  $payloadDirectory = Split-Path -Parent $payloadManifestPath
  $payloadDirectoryRelative = Get-RainReleaseArtifactRelativePath $installed $payloadDirectory 'CUDA payload directory'
  if ($payloadDirectoryRelative -ne 'resources/whisper-backends') {
    throw "CUDA payload manifest must be located in resources/whisper-backends, found $payloadDirectoryRelative."
  }
  $payloadFiles = @{}
  foreach ($name in $script:RequiredCudaPayloadFiles) {
    $key = $name.ToLowerInvariant()
    if (-not $payloadByName.ContainsKey($key)) {
      throw "CUDA payload manifest is missing required file '$name'."
    }
    $path = Resolve-RainReleaseArtifactFile (Join-Path $payloadDirectory $name) "CUDA payload file $name"
    $item = Get-Item -LiteralPath $path
    $entry = $payloadByName[$key]
    if ([int64](Get-RainReleaseArtifactProperty $entry 'sizeBytes' "CUDA payload manifest file $name") -ne $item.Length) {
      throw "CUDA payload manifest size does not match actual file '$name'."
    }
    $hash = Get-RainReleaseArtifactSha256 $path
    if ([string](Get-RainReleaseArtifactProperty $entry 'sha256' "CUDA payload manifest file $name") -ne $hash) {
      throw "CUDA payload manifest SHA-256 does not match actual file '$name'."
    }
    $payloadFiles[$key] = [ordered]@{
      name = $item.Name
      path = Get-RainReleaseArtifactRelativePath $installed $path "CUDA payload file $name"
      sizeBytes = $item.Length
      sha256 = $hash
    }
  }

  $expectedPayloadLeaves = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  [void]$expectedPayloadLeaves.Add('payload-manifest.json')
  foreach ($name in $script:RequiredCudaPayloadFiles) { [void]$expectedPayloadLeaves.Add($name) }
  $actualPayloadFiles = @(Get-ChildItem -LiteralPath $payloadDirectory -File -Recurse -Force)
  foreach ($actualPayloadFile in $actualPayloadFiles) {
    $relative = Get-RainReleaseArtifactRelativePath $payloadDirectory $actualPayloadFile.FullName 'CUDA payload file'
    if ($relative -ne $actualPayloadFile.Name -or -not $expectedPayloadLeaves.Contains($actualPayloadFile.Name)) {
      throw "whisper-backends must contain the exact declared payload set; found unexpected file $relative."
    }
  }
  if ($actualPayloadFiles.Count -ne $expectedPayloadLeaves.Count) {
    throw 'whisper-backends must contain the exact declared payload set.'
  }
  $allInstalledFiles = @(Get-ChildItem -LiteralPath $installed -File -Recurse -Force)
  foreach ($name in $script:RequiredCudaPayloadFiles) {
    $matchingFiles = @($allInstalledFiles | Where-Object { $_.Name -ieq $name })
    if ($matchingFiles.Count -ne 1 -or $matchingFiles[0].Directory.FullName -ne (Get-Item -LiteralPath $payloadDirectory).FullName) {
      throw "CUDA payload file $name must occur exactly once in whisper-backends."
    }
  }

  $installedFindings = Get-RainReleaseArtifactHygieneFindings $installed
  $archiveFindings = Get-RainReleaseArtifactHygieneFindings $installerArchive
  $forbiddenFindings = [ordered]@{}
  foreach ($category in @($installedFindings.Keys)) {
    $forbiddenFindings[$category] = @(
      @($installedFindings[$category] | ForEach-Object { "installed-tree/$_" }) +
      @($archiveFindings[$category] | ForEach-Object { "installer-archive/$_" }) |
        Sort-Object -Unique
    )
  }
  Assert-RainReleaseArtifactHygiene $forbiddenFindings

  $importText = & $GetPeImportText $mainExecutable
  $cudaImportsPresent = Test-RainReleaseArtifactCudaImports ([string]($importText | Out-String))
  if ($cudaImportsPresent) {
    throw 'Rain main executable imports a CUDA or NVIDIA driver DLL.'
  }

  $installerItem = Get-Item -LiteralPath $installer
  $mainItem = Get-Item -LiteralPath $mainExecutable
  $payloadManifestItem = Get-Item -LiteralPath $payloadManifestPath
  $worker = $payloadFiles['rain-whisper-cuda.exe']
  $runtimeFiles = @(
    foreach ($name in $script:AllowedCudaRuntimeFiles) {
      $payloadFiles[$name.ToLowerInvariant()]
    }
  )
  $candidateCommit = $CandidateTargetCommit.ToLowerInvariant()
  $toolingCommitNormalized = $ToolingCommit.ToLowerInvariant()
  $workflowDefinitionCommitNormalized = $WorkflowDefinitionCommit.ToLowerInvariant()
  $builtAtNormalized = $parsedBuiltAt.ToString('o')
  $generatedAt = [DateTimeOffset]::UtcNow.ToString('o')
  $buildMetadata = [ordered]@{
    buildRecordId = $BuildRecordId
    builtAt = $builtAtNormalized
  }
  $generator = [ordered]@{
    id = $GeneratorId
    version = $GeneratorVersion
  }
  $controlledBuild = [ordered]@{
    repository = $Repository
    sourceRepository = $SourceRepository
    targetCommit = $candidateCommit
    toolingCommit = $toolingCommitNormalized
    cleanTree = $true
    generator = $generator
    buildMetadata = $buildMetadata
    masterReachability = [ordered]@{
      candidate = $true
      tooling = $true
    }
    toolchain = $toolchain
  }
  $manifest = [ordered]@{
    schemaVersion = 1
    productName = $sourceMetadata.productName
    version = $sourceMetadata.version
    identifier = $sourceMetadata.identifier
    targetCommit = $candidateCommit
    controlledBuild = $controlledBuild
    installer = [ordered]@{
      fileName = $installerItem.Name
      sizeBytes = $installerItem.Length
      sha256 = Get-RainReleaseArtifactSha256 $installer
      kind = $sourceMetadata.installerKind
    }
    installationProof = $nsisInstallationProof
    hygieneScopes = @('installed-tree', 'installer-archive')
    mainExecutable = [ordered]@{
      path = Get-RainReleaseArtifactRelativePath $installed $mainExecutable 'Rain main executable'
      sizeBytes = $mainItem.Length
      sha256 = Get-RainReleaseArtifactSha256 $mainExecutable
      cudaImportsPresent = $false
    }
    resources = [ordered]@{
      cudaWorker = [ordered]@{
        path = $worker.path
        sizeBytes = $worker.sizeBytes
        sha256 = $worker.sha256
        protocolVersion = 1
        configuration = 'release'
      }
      cudaPayloadManifest = [ordered]@{
        path = Get-RainReleaseArtifactRelativePath $installed $payloadManifestPath 'CUDA payload manifest'
        sizeBytes = $payloadManifestItem.Length
        sha256 = Get-RainReleaseArtifactSha256 $payloadManifestPath
        schemaVersion = 1
        configuration = 'release'
      }
      cudaRuntime = [ordered]@{
        files = @($runtimeFiles)
        driverLibraryBundled = $false
        distributionApproval = 'pending'
      }
    }
    forbiddenFindings = $forbiddenFindings
    generatedAt = $generatedAt
    generator = $generator
  }

  $artifactManifestPath = Join-Path $output 'release-artifact-manifest.json'
  Write-RainReleaseArtifactJson -Path $artifactManifestPath -Value $manifest -AtomicWriteAdapter $AtomicWriteAdapter
  if ($ManifestOnly) {
    return [pscustomobject]@{
      artifactManifestPath = $artifactManifestPath
      controlledBuildRecordPath = $null
    }
  }

  $recordResult = New-RainControlledBuildRecord `
    -InstallerPath $installer `
    -ArtifactManifestPath $artifactManifestPath `
    -CandidateSourceRoot $CandidateSourceRoot `
    -ToolchainRecordPath $ToolchainRecordPath `
    -OutputDirectory $output `
    -CandidateTargetCommit $candidateCommit `
    -ToolingCommit $toolingCommitNormalized `
    -Repository $Repository `
    -SourceRepository $SourceRepository `
    -GeneratorId $GeneratorId `
    -GeneratorVersion $GeneratorVersion `
    -BuildRecordId $BuildRecordId `
    -BuiltAt $builtAtNormalized `
    -WorkflowFile $WorkflowFile `
    -WorkflowRunUrl $WorkflowRunUrl `
    -WorkflowEvent $WorkflowEvent `
    -WorkflowRef $WorkflowRef `
    -WorkflowRunId $WorkflowRunId `
    -WorkflowRunAttempt $WorkflowRunAttempt `
    -WorkflowDefinitionCommit $workflowDefinitionCommitNormalized `
    -CandidateMasterReachable $CandidateMasterReachable `
    -ToolingMasterReachable $ToolingMasterReachable `
    -CoreArtifactName $CoreArtifactName `
    -CoreArtifactDigest $CoreArtifactDigest `
    -AtomicWriteAdapter $AtomicWriteAdapter

  return [pscustomobject]@{
    artifactManifestPath = $artifactManifestPath
    controlledBuildRecordPath = $recordResult.controlledBuildRecordPath
  }
}

function New-RainControlledBuildRecord {
  param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][string]$ArtifactManifestPath,
    [Parameter(Mandatory = $true)][string]$CandidateSourceRoot,
    [Parameter(Mandatory = $true)][string]$ToolchainRecordPath,
    [Parameter(Mandatory = $true)][string]$OutputDirectory,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$CandidateTargetCommit,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ToolingCommit,
    [Parameter(Mandatory = $true)][string]$Repository,
    [Parameter(Mandatory = $true)][string]$SourceRepository,
    [Parameter(Mandatory = $true)][string]$GeneratorId,
    [Parameter(Mandatory = $true)][string]$GeneratorVersion,
    [Parameter(Mandatory = $true)][string]$BuildRecordId,
    [Parameter(Mandatory = $true)][string]$BuiltAt,
    [Parameter(Mandatory = $true)][string]$WorkflowFile,
    [Parameter(Mandatory = $true)][string]$WorkflowRunUrl,
    [Parameter(Mandatory = $true)][string]$WorkflowEvent,
    [Parameter(Mandatory = $true)][string]$WorkflowRef,
    [Parameter(Mandatory = $true)][string]$WorkflowRunId,
    [Parameter(Mandatory = $true)][int]$WorkflowRunAttempt,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$WorkflowDefinitionCommit,
    [Parameter(Mandatory = $true)][bool]$CandidateMasterReachable,
    [Parameter(Mandatory = $true)][bool]$ToolingMasterReachable,
    [Parameter(Mandatory = $true)][string]$CoreArtifactName,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$CoreArtifactDigest,
    $AtomicWriteAdapter,
    [scriptblock]$ManifestReadAdapter = { param([string]$Path) Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
  )

  Assert-RainControlledCanonicalBuildContext -Repository $Repository -SourceRepository $SourceRepository -WorkflowFile $WorkflowFile -WorkflowRunUrl $WorkflowRunUrl -WorkflowEvent $WorkflowEvent -WorkflowRef $WorkflowRef -WorkflowRunId $WorkflowRunId -WorkflowRunAttempt $WorkflowRunAttempt -CandidateMasterReachable $CandidateMasterReachable -ToolingMasterReachable $ToolingMasterReachable
  if ([string]::IsNullOrWhiteSpace($GeneratorId) -or [string]::IsNullOrWhiteSpace($GeneratorVersion)) {
    throw 'GeneratorId and GeneratorVersion must not be blank.'
  }
  if ([string]::IsNullOrWhiteSpace($BuildRecordId)) { throw 'BuildRecordId must not be blank.' }
  if ([string]::IsNullOrWhiteSpace($CoreArtifactName) -or
      $CoreArtifactName -ne [System.IO.Path]::GetFileName($CoreArtifactName) -or
      $CoreArtifactName.Contains(':') -or $CoreArtifactName.Contains('..')) {
    throw 'CoreArtifactName must be a simple artifact name.'
  }

  $parsedBuiltAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse($BuiltAt, [ref]$parsedBuiltAt)) {
    throw 'BuiltAt must be an ISO-8601 timestamp.'
  }
  $sourceMetadata = Get-RainTauriSourceMetadata $CandidateSourceRoot
  $toolchain = Get-RainControlledToolchainRecord $ToolchainRecordPath
  $installer = Assert-RainNsisInstallerArtifact -InstallerPath $InstallerPath -SourceMetadata $sourceMetadata
  $artifactManifest = Resolve-RainReleaseArtifactFile $ArtifactManifestPath 'Artifact manifest'
  $output = [System.IO.Path]::GetFullPath($OutputDirectory)
  [void][System.IO.Directory]::CreateDirectory($output)
  try {
    $manifest = & $ManifestReadAdapter $artifactManifest
  } catch {
    throw "Artifact manifest is not valid JSON: $($_.Exception.Message)"
  }

  $candidateCommit = $CandidateTargetCommit.ToLowerInvariant()
  $toolingCommitNormalized = $ToolingCommit.ToLowerInvariant()
  $workflowDefinitionCommitNormalized = $WorkflowDefinitionCommit.ToLowerInvariant()
  if ($candidateCommit -eq $toolingCommitNormalized) {
    throw 'ToolingCommit must be distinct from CandidateTargetCommit.'
  }
  if ($workflowDefinitionCommitNormalized -ne $toolingCommitNormalized) {
    throw 'WorkflowDefinitionCommit must match ToolingCommit.'
  }
  if ([string](Get-RainReleaseArtifactProperty $manifest 'targetCommit' 'Artifact manifest') -ne $candidateCommit) {
    throw 'Artifact manifest targetCommit does not match CandidateTargetCommit.'
  }
  if ([string](Get-RainReleaseArtifactProperty $manifest 'productName' 'Artifact manifest') -ne $sourceMetadata.productName -or
      [string](Get-RainReleaseArtifactProperty $manifest 'version' 'Artifact manifest') -ne $sourceMetadata.version -or
      [string](Get-RainReleaseArtifactProperty $manifest 'identifier' 'Artifact manifest') -ne $sourceMetadata.identifier) {
    throw 'Artifact manifest product metadata does not match the candidate Tauri source metadata.'
  }
  $controlledBuild = Get-RainReleaseArtifactProperty $manifest 'controlledBuild' 'Artifact manifest'
  if ([string](Get-RainReleaseArtifactProperty $controlledBuild 'repository' 'Artifact manifest controlledBuild') -ne $Repository -or
      [string](Get-RainReleaseArtifactProperty $controlledBuild 'sourceRepository' 'Artifact manifest controlledBuild') -ne $SourceRepository -or
      [string](Get-RainReleaseArtifactProperty $controlledBuild 'targetCommit' 'Artifact manifest controlledBuild') -ne $candidateCommit -or
      [string](Get-RainReleaseArtifactProperty $controlledBuild 'toolingCommit' 'Artifact manifest controlledBuild') -ne $toolingCommitNormalized -or
      (Get-RainReleaseArtifactProperty $controlledBuild 'cleanTree' 'Artifact manifest controlledBuild') -ne $true) {
    throw 'Artifact manifest controlled-build provenance does not match the requested controlled-build record.'
  }
  $manifestMasterReachability = Get-RainReleaseArtifactProperty $controlledBuild 'masterReachability' 'Artifact manifest controlledBuild'
  if ((Get-RainReleaseArtifactProperty $manifestMasterReachability 'candidate' 'Artifact manifest controlledBuild masterReachability') -ne $true -or
      (Get-RainReleaseArtifactProperty $manifestMasterReachability 'tooling' 'Artifact manifest controlledBuild masterReachability') -ne $true) {
    throw 'Artifact manifest must prove candidate and tooling reachability from canonical master.'
  }
  Assert-RainControlledToolchainMatch (Get-RainReleaseArtifactProperty $controlledBuild 'toolchain' 'Artifact manifest controlledBuild') $toolchain 'Artifact manifest controlled-build toolchain'
  $manifestGenerator = Get-RainReleaseArtifactProperty $controlledBuild 'generator' 'Artifact manifest controlledBuild'
  if ([string](Get-RainReleaseArtifactProperty $manifestGenerator 'id' 'Artifact manifest controlled-build generator') -ne $GeneratorId -or
      [string](Get-RainReleaseArtifactProperty $manifestGenerator 'version' 'Artifact manifest controlled-build generator') -ne $GeneratorVersion) {
    throw 'Artifact manifest controlled-build generator does not match the requested controlled-build record.'
  }
  $manifestMetadata = Get-RainReleaseArtifactProperty $controlledBuild 'buildMetadata' 'Artifact manifest controlledBuild'
  $manifestBuiltAtValue = Get-RainReleaseArtifactProperty $manifestMetadata 'builtAt' 'Artifact manifest controlled-build metadata'
  $manifestBuiltAt = [DateTimeOffset]::MinValue
  $manifestBuiltAtParsed = if ($manifestBuiltAtValue -is [DateTimeOffset]) {
    $manifestBuiltAt = [DateTimeOffset]$manifestBuiltAtValue
    $true
  } elseif ($manifestBuiltAtValue -is [DateTime]) {
    $manifestBuiltAt = [DateTimeOffset]([DateTime]$manifestBuiltAtValue)
    $true
  } else {
    [DateTimeOffset]::TryParse(
      [string]$manifestBuiltAtValue,
      [Globalization.CultureInfo]::InvariantCulture,
      [Globalization.DateTimeStyles]::RoundtripKind,
      [ref]$manifestBuiltAt)
  }
  $manifestBuiltAtMatches = $manifestBuiltAtParsed -and $manifestBuiltAt.Equals($parsedBuiltAt)
  if ([string](Get-RainReleaseArtifactProperty $manifestMetadata 'buildRecordId' 'Artifact manifest controlled-build metadata') -ne $BuildRecordId -or
      -not $manifestBuiltAtMatches) {
    throw 'Artifact manifest controlled-build metadata does not match the requested controlled-build record.'
  }

  $installerItem = Get-Item -LiteralPath $installer
  $installerHash = Get-RainReleaseArtifactSha256 $installer
  $manifestInstaller = Get-RainReleaseArtifactProperty $manifest 'installer' 'Artifact manifest'
  if ([string](Get-RainReleaseArtifactProperty $manifestInstaller 'fileName' 'Artifact manifest installer') -ne $installerItem.Name -or
      [int64](Get-RainReleaseArtifactProperty $manifestInstaller 'sizeBytes' 'Artifact manifest installer') -ne $installerItem.Length -or
      [string](Get-RainReleaseArtifactProperty $manifestInstaller 'sha256' 'Artifact manifest installer') -ne $installerHash -or
      [string](Get-RainReleaseArtifactProperty $manifestInstaller 'kind' 'Artifact manifest installer') -ne $sourceMetadata.installerKind) {
    throw 'Artifact manifest installer identity does not match actual installer bytes.'
  }

  $artifactManifestItem = Get-Item -LiteralPath $artifactManifest
  $controlledBuildRecordPath = Join-Path $output 'controlled-build-record.json'
  if (Test-Path -LiteralPath $controlledBuildRecordPath) {
    throw "Refusing to overwrite an existing controlled-build record: $controlledBuildRecordPath"
  }
  $generator = [ordered]@{ id = $GeneratorId; version = $GeneratorVersion }
  $buildMetadata = [ordered]@{ buildRecordId = $BuildRecordId; builtAt = $parsedBuiltAt.ToString('o') }
  $controlledBuildRecord = [ordered]@{
    schemaVersion = 1
    repository = $Repository
    sourceRepository = $SourceRepository
    targetCommit = $candidateCommit
    toolingCommit = $toolingCommitNormalized
    cleanTree = $true
    generator = $generator
    buildMetadata = $buildMetadata
    workflow = [ordered]@{
      file = $WorkflowFile
      definitionCommit = $workflowDefinitionCommitNormalized
      runUrl = $WorkflowRunUrl
      event = $WorkflowEvent
      ref = $WorkflowRef
      runId = $WorkflowRunId
      runAttempt = $WorkflowRunAttempt
    }
    masterReachability = [ordered]@{
      candidate = $true
      tooling = $true
    }
    toolchain = $toolchain
    coreArtifact = [ordered]@{
      name = $CoreArtifactName
      digest = $CoreArtifactDigest.ToLowerInvariant()
    }
    installer = [ordered]@{
      fileName = $installerItem.Name
      sizeBytes = $installerItem.Length
      sha256 = $installerHash
      kind = [string](Get-RainReleaseArtifactProperty $manifestInstaller 'kind' 'Artifact manifest installer')
    }
    artifactManifest = [ordered]@{
      fileName = $artifactManifestItem.Name
      sizeBytes = $artifactManifestItem.Length
      sha256 = Get-RainReleaseArtifactSha256 $artifactManifest
    }
  }
  Write-RainReleaseArtifactJson -Path $controlledBuildRecordPath -Value $controlledBuildRecord -AtomicWriteAdapter $AtomicWriteAdapter
  return [pscustomobject]@{ controlledBuildRecordPath = $controlledBuildRecordPath }
}

Export-ModuleMember -Function @(
  'Get-RainReleaseArtifactSha256',
  'Assert-RainReleaseArtifactPeImportOutput',
  'Assert-RainReleaseArtifactArchiveContents',
  'New-RainControlledReleaseArtifacts',
  'New-RainControlledBuildRecord'
)
