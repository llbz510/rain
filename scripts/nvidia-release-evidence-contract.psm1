Set-StrictMode -Version Latest

$script:AllowedCudaPayloadFiles = @(
  'rain-whisper-cuda.exe',
  'cublas64_12.dll',
  'cublasLt64_12.dll',
  'cudart64_12.dll'
)
$script:CudaOrDriverDllPrefixes = @(
  'nvcuda',
  'nvblas',
  'cuda',
  'cudart',
  'cublas',
  'cufft',
  'curand',
  'cusolver',
  'cusparse',
  'cudnn',
  'cupti',
  'cufile',
  'nvrtc',
  'nvjitlink',
  'nvml',
  'nvjpeg',
  'nvapi',
  'nvfatbin',
  'nvperf',
  'npp',
  'nvtx'
  'nvtoolsext'
  'nvopencl'
)
$script:CudaOrDriverDllNamePattern = "(?i)^(?:$([string]::Join('|', $script:CudaOrDriverDllPrefixes))).*\.dll$"
$script:CancellationFixtureSampleRateHz = 16000
$script:CancellationFixtureChannels = 1
$script:CancellationFixtureBitsPerSample = 16
$script:CancellationFixtureDurationSeconds = 180
$script:CancellationFixtureMinimumDurationSeconds = 120
$script:CancellationFixtureCancelWindowMilliseconds = 2000
$script:CancellationFixtureMaximumBytes = 6L * 1024L * 1024L
$script:CancellationFixtureSha256 = '5545b8236a5eb7a03694955687d8adca43490b2f31efdb7f635a2c7409857045'
$script:CanonicalRainRepository = 'llbz510/rain'
$script:CanonicalRainOrigin = 'https://github.com/llbz510/rain.git'
$script:ArtifactForbiddenFindingCategories = @(
  'secrets', 'e2eMarkers', 'absolutePaths', 'userData', 'forbiddenDlls',
  'modelFiles', 'sourceMaps', 'unscannedTextFiles', 'unreadableTextFiles', 'debugArtifacts'
)
$script:RequiredControlledCudaArchitecture = '120'
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

function Resolve-ReleaseEvidenceFile([string]$Path, [string]$Description) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Description does not exist: $Path"
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

function Resolve-ReleaseEvidenceDirectory([string]$Path, [string]$Description) {
  if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "$Description does not exist: $Path"
  }
  return (Resolve-Path -LiteralPath $Path).Path
}

function Get-ObjectProperty($Value, [string]$Name, [string]$Description) {
  if ($null -eq $Value -or -not ($Value.PSObject.Properties.Name -contains $Name)) {
    throw "$Description is missing required property '$Name'."
  }
  return $Value.$Name
}

function Get-ReleaseEvidenceSha256([string]$Path) {
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

function Assert-ReleaseEvidenceControlToolingCheckout {
  param(
    [Parameter(Mandatory = $true)][string]$RepoRoot,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedCommit
  )

  $controlRoot = Resolve-ReleaseEvidenceDirectory $RepoRoot 'Control tooling checkout'
  $git = Get-Command 'git.exe' -ErrorAction SilentlyContinue
  if (-not $git) { $git = Get-Command 'git' -ErrorAction Stop }
  $actual = (& $git.Source -C $controlRoot rev-parse HEAD 2>&1 | Out-String).Trim().ToLowerInvariant()
  if ($LASTEXITCODE -ne 0 -or $actual -notmatch '^[0-9a-f]{40}$') {
    throw "Could not resolve control tooling checkout HEAD: $actual"
  }
  if ($actual -ne $ExpectedCommit.ToLowerInvariant()) {
    throw "Control tooling checkout mismatch: expected $ExpectedCommit, found $actual."
  }

  $canonicalOrigin = $script:CanonicalRainOrigin.TrimEnd('/')
  $canonicalOriginWithoutGitSuffix = $canonicalOrigin.Substring(0, $canonicalOrigin.Length - 4)
  $origin = (& $git.Source -C $controlRoot remote get-url origin 2>&1 | Out-String).Trim().TrimEnd('/')
  if ($LASTEXITCODE -ne 0 -or $origin -notin @($canonicalOrigin, $canonicalOriginWithoutGitSuffix)) {
    throw "Control tooling checkout origin is not canonical: $origin"
  }

  $status = (& $git.Source -C $controlRoot status --porcelain --untracked-files=all 2>&1 | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect control tooling checkout cleanliness: $status"
  }
  if (-not [string]::IsNullOrWhiteSpace($status)) {
    throw "Control tooling checkout is not clean at tooling commit $actual."
  }
  return $actual
}

function Assert-ReleaseEvidenceTempRoot([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Cancellation fixture TEMP root must not be blank.' }
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
  $candidate = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
  $tempPrefix = $tempRoot + [System.IO.Path]::DirectorySeparatorChar
  if (-not $candidate.Equals($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
      -not $candidate.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Cancellation fixture root must be inside the operating-system TEMP directory: $candidate"
  }
  if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
    throw "Cancellation fixture TEMP root does not exist: $candidate"
  }
  return $candidate
}

function Assert-ReleaseEvidenceCancellationFixture {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$MinimumDurationSeconds = $script:CancellationFixtureMinimumDurationSeconds,
    [int64]$MaximumBytes = $script:CancellationFixtureMaximumBytes,
    [string]$ExpectedSha256 = ''
  )

  $fixturePath = Resolve-ReleaseEvidenceFile $Path 'Cancellation fixture'
  $item = Get-Item -LiteralPath $fixturePath
  if ($item.Length -gt $MaximumBytes) {
    throw "Cancellation fixture exceeds the disk budget of $MaximumBytes bytes."
  }
  if ($item.Length -lt 44) { throw 'Cancellation fixture is not a complete PCM WAV file.' }

  $stream = [System.IO.File]::OpenRead($fixturePath)
  try {
    $header = [byte[]]::new(44)
    if ($stream.Read($header, 0, $header.Length) -ne $header.Length) {
      throw 'Cancellation fixture WAV header is incomplete.'
    }
  } finally {
    $stream.Dispose()
  }

  $ascii = [System.Text.Encoding]::ASCII
  if ($ascii.GetString($header, 0, 4) -ne 'RIFF' -or
      $ascii.GetString($header, 8, 4) -ne 'WAVE' -or
      $ascii.GetString($header, 12, 4) -ne 'fmt ' -or
      $ascii.GetString($header, 36, 4) -ne 'data') {
    throw 'Cancellation fixture must use the canonical 44-byte PCM WAV layout.'
  }
  $riffSize = [BitConverter]::ToUInt32($header, 4)
  $formatChunkSize = [BitConverter]::ToUInt32($header, 16)
  $audioFormat = [BitConverter]::ToUInt16($header, 20)
  $channels = [BitConverter]::ToUInt16($header, 22)
  $sampleRate = [BitConverter]::ToUInt32($header, 24)
  $byteRate = [BitConverter]::ToUInt32($header, 28)
  $blockAlign = [BitConverter]::ToUInt16($header, 32)
  $bitsPerSample = [BitConverter]::ToUInt16($header, 34)
  $dataBytes = [BitConverter]::ToUInt32($header, 40)
  if ($formatChunkSize -ne 16 -or $audioFormat -ne 1 -or
      $channels -ne $script:CancellationFixtureChannels -or
      $sampleRate -ne $script:CancellationFixtureSampleRateHz -or
      $bitsPerSample -ne $script:CancellationFixtureBitsPerSample -or
      $blockAlign -ne 2 -or $byteRate -ne 32000) {
    throw 'Cancellation fixture must be 16 kHz mono 16-bit PCM WAV.'
  }
  if ($riffSize -ne ($item.Length - 8) -or $dataBytes -ne ($item.Length - 44)) {
    throw 'Cancellation fixture WAV byte counts do not match the file length.'
  }
  $durationSeconds = [double]$dataBytes / [double]$byteRate
  $requiredDurationSeconds = [Math]::Max($script:CancellationFixtureMinimumDurationSeconds, $MinimumDurationSeconds)
  if ($durationSeconds -lt $requiredDurationSeconds) {
    throw "Cancellation fixture duration must be at least $requiredDurationSeconds seconds; found $durationSeconds."
  }
  $hash = Get-ReleaseEvidenceSha256 $fixturePath
  if (-not [string]::IsNullOrWhiteSpace($ExpectedSha256) -and $hash -ne $ExpectedSha256.ToLowerInvariant()) {
    throw 'Cancellation fixture SHA-256 does not match the deterministic fixture contract.'
  }

  return [pscustomobject]@{
    path = $fixturePath
    format = 'pcm-s16le-wav'
    sampleRateHz = [int]$sampleRate
    channels = [int]$channels
    bitsPerSample = [int]$bitsPerSample
    durationSeconds = [int]$durationSeconds
    cancelAfterBackendSelectionWithinMilliseconds = $script:CancellationFixtureCancelWindowMilliseconds
    dataBytes = [int64]$dataBytes
    sizeBytes = [int64]$item.Length
    sha256 = $hash
    maximumBytes = $MaximumBytes
  }
}

function New-ReleaseEvidenceFixtureIoAdapter {
  return [pscustomobject]@{
    kind = 'system-io'
    open = {
      param($path)
      return [System.IO.FileStream]::new(
        $path,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::Write,
        [System.IO.FileShare]::None,
        64000,
        [System.IO.FileOptions]::SequentialScan
      )
    }
    createWriter = {
      param($stream)
      return [System.IO.BinaryWriter]::new($stream, [System.Text.Encoding]::ASCII, $true)
    }
    remove = {
      param($path)
      if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force -ErrorAction Stop }
    }
  }
}

function Assert-ReleaseEvidenceFixtureIoAdapter($IoAdapter) {
  if ($null -eq $IoAdapter) { $IoAdapter = New-ReleaseEvidenceFixtureIoAdapter }
  foreach ($method in @('open', 'createWriter', 'remove')) {
    if (-not ($IoAdapter.PSObject.Properties.Name -contains $method) -or $IoAdapter.$method -isnot [scriptblock]) {
      throw "Cancellation fixture IO adapter '$method' must be a script block."
    }
  }
  return $IoAdapter
}

function Merge-ReleaseEvidenceLifecycleError($Primary, $Secondary, [string]$Context) {
  if ($null -eq $Primary) { return $Secondary }
  $exception = [System.Exception]::new(
    "$($Primary.Exception.Message) ${Context}: $($Secondary.Exception.Message)",
    $Primary.Exception
  )
  return [System.Management.Automation.ErrorRecord]::new(
    $exception,
    'RainEvidenceFixtureLifecycleFailure',
    [System.Management.Automation.ErrorCategory]::OperationStopped,
    $null
  )
}

function New-ReleaseEvidenceCancellationFixture([string]$TempRoot, $IoAdapter) {
  $root = Assert-ReleaseEvidenceTempRoot $TempRoot
  $IoAdapter = Assert-ReleaseEvidenceFixtureIoAdapter $IoAdapter
  $path = Join-Path $root ("rain-release-cancellation-{0}.wav" -f [Guid]::NewGuid().ToString('N'))
  $bytesPerSample = [int]($script:CancellationFixtureChannels * $script:CancellationFixtureBitsPerSample / 8)
  $dataBytes = [int64]$script:CancellationFixtureSampleRateHz * $bytesPerSample * $script:CancellationFixtureDurationSeconds
  $sizeBytes = 44L + $dataBytes
  if ($sizeBytes -gt $script:CancellationFixtureMaximumBytes) {
    throw 'Deterministic cancellation fixture exceeds its fixed disk budget.'
  }

  $stream = $null
  $writer = $null
  $operationError = $null
  try {
    try {
      $stream = & $IoAdapter.open $path
      $writer = & $IoAdapter.createWriter $stream
      $writer.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))
      $writer.Write([uint32](36L + $dataBytes))
      $writer.Write([System.Text.Encoding]::ASCII.GetBytes('WAVE'))
      $writer.Write([System.Text.Encoding]::ASCII.GetBytes('fmt '))
      $writer.Write([uint32]16)
      $writer.Write([uint16]1)
      $writer.Write([uint16]$script:CancellationFixtureChannels)
      $writer.Write([uint32]$script:CancellationFixtureSampleRateHz)
      $writer.Write([uint32]($script:CancellationFixtureSampleRateHz * $bytesPerSample))
      $writer.Write([uint16]$bytesPerSample)
      $writer.Write([uint16]$script:CancellationFixtureBitsPerSample)
      $writer.Write([System.Text.Encoding]::ASCII.GetBytes('data'))
      $writer.Write([uint32]$dataBytes)
      $writer.Flush()

      $cycle = [byte[]]::new(320)
      for ($sampleIndex = 0; $sampleIndex -lt 160; $sampleIndex++) {
        if ($sampleIndex -lt 80) {
          $cycle[$sampleIndex * 2] = 0xb0
          $cycle[($sampleIndex * 2) + 1] = 0x04
        } else {
          $cycle[$sampleIndex * 2] = 0x50
          $cycle[($sampleIndex * 2) + 1] = 0xfb
        }
      }
      $buffer = [byte[]]::new(64000)
      for ($offset = 0; $offset -lt $buffer.Length; $offset += $cycle.Length) {
        [System.Buffer]::BlockCopy($cycle, 0, $buffer, $offset, $cycle.Length)
      }
      for ($remaining = $dataBytes; $remaining -gt 0; $remaining -= $buffer.Length) {
        $count = [int][Math]::Min([int64]$buffer.Length, $remaining)
        $stream.Write($buffer, 0, $count)
      }
      $stream.Flush($true)
    } catch {
      $operationError = Merge-ReleaseEvidenceLifecycleError $operationError $_ 'Additionally, fixture generation failed'
    } finally {
      if ($writer) {
        try { $writer.Dispose() } catch {
          $operationError = Merge-ReleaseEvidenceLifecycleError $operationError $_ 'Additionally, fixture writer disposal failed'
        }
      }
      if ($stream) {
        try { $stream.Dispose() } catch {
          $operationError = Merge-ReleaseEvidenceLifecycleError $operationError $_ 'Additionally, fixture stream disposal failed'
        }
      }
    }
    if ($operationError) { throw $operationError }
    return Assert-ReleaseEvidenceCancellationFixture `
      -Path $path `
      -ExpectedSha256 $script:CancellationFixtureSha256
  } catch {
    $failure = $_
    try { & $IoAdapter.remove $path } catch {
      $failure = Merge-ReleaseEvidenceLifecycleError $failure $_ 'Additionally, fixture cleanup failed'
    }
    throw $failure
  }
}

function Invoke-WithReleaseEvidenceCancellationFixture {
  param(
    [string]$TempRoot = [System.IO.Path]::GetTempPath(),
    $IoAdapter,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  $fixture = $null
  $IoAdapter = Assert-ReleaseEvidenceFixtureIoAdapter $IoAdapter
  $actionResult = $null
  $lifecycleError = $null
  try {
    $fixture = New-ReleaseEvidenceCancellationFixture $TempRoot $IoAdapter
    $actionResult = & $Action $fixture
  } catch {
    $lifecycleError = Merge-ReleaseEvidenceLifecycleError $lifecycleError $_ 'Additionally, fixture creation or Action failed'
  } finally {
    if ($fixture) {
      try { & $IoAdapter.remove ([string]$fixture.path) } catch {
        $lifecycleError = Merge-ReleaseEvidenceLifecycleError $lifecycleError $_ 'Additionally, fixture cleanup failed'
      }
    }
  }
  if ($lifecycleError) { throw $lifecycleError }
  return $actionResult
}

function Assert-ReleaseEvidenceCancellationTiming {
  param(
    [Parameter(Mandatory = $true)]$BackendSelectedEvent,
    [Parameter(Mandatory = $true)][string]$StatusBeforeRequest,
    [Parameter(Mandatory = $true)][double]$CancelRequestCompletedAtEpochMilliseconds,
    [Parameter(Mandatory = $true)][int]$MaximumDelayMilliseconds
  )

  if ([string](Get-ObjectProperty $BackendSelectedEvent 'backend' 'Backend-selected event') -ne 'cuda') {
    throw 'Cancellation timing requires a CUDA backend-selected event.'
  }
  $receivedAt = [double](Get-ObjectProperty $BackendSelectedEvent 'evidenceReceivedAtEpochMilliseconds' 'Backend-selected event')
  $sequence = [int](Get-ObjectProperty $BackendSelectedEvent 'evidenceSequence' 'Backend-selected event')
  if ([double]::IsNaN($receivedAt) -or [double]::IsInfinity($receivedAt) -or $receivedAt -le 0 -or $sequence -lt 0) {
    throw 'Backend-selected callback timestamp or sequence is invalid.'
  }
  if ($StatusBeforeRequest -ne 'running') {
    throw 'Cancellation fixture completed before cancellation could be requested.'
  }
  if ([double]::IsNaN($CancelRequestCompletedAtEpochMilliseconds) -or
      [double]::IsInfinity($CancelRequestCompletedAtEpochMilliseconds) -or
      $MaximumDelayMilliseconds -le 0) {
    throw 'Cancellation request clock mapping or maximum delay is invalid.'
  }
  $delayMilliseconds = $CancelRequestCompletedAtEpochMilliseconds - $receivedAt
  if ($delayMilliseconds -lt 0) {
    throw 'Cancellation callback/request clocks cannot be mapped safely.'
  }
  if ($delayMilliseconds -gt $MaximumDelayMilliseconds) {
    throw "Cancellation request exceeded the backend-selection window: $delayMilliseconds ms."
  }
  return [ordered]@{
    backendSelectedCallbackAtEpochMilliseconds = $receivedAt
    backendSelectedSequence = $sequence
    cancelRequestCompletedAtEpochMilliseconds = $CancelRequestCompletedAtEpochMilliseconds
    delayMilliseconds = [Math]::Round($delayMilliseconds, 3)
    maximumDelayMilliseconds = $MaximumDelayMilliseconds
  }
}

function ConvertTo-ReleaseEvidenceProcessTimestamp($Value, [string]$Description) {
  try {
    return [DateTimeOffset]$Value
  } catch {
    throw "$Description must be a valid process start timestamp."
  }
}

function ConvertTo-ReleaseEvidenceProcessIdentity($Value, [string]$Description, [switch]$RequirePath) {
  $processId = [int](Get-ObjectProperty $Value 'processId' $Description)
  $parentProcessId = [int](Get-ObjectProperty $Value 'parentProcessId' $Description)
  $startedAt = ConvertTo-ReleaseEvidenceProcessTimestamp (Get-ObjectProperty $Value 'startedAt' $Description) "$Description startedAt"
  $executablePath = ''
  if ($Value.PSObject.Properties.Name -contains 'executablePath' -and -not [string]::IsNullOrWhiteSpace([string]$Value.executablePath)) {
    $executablePath = [System.IO.Path]::GetFullPath([string]$Value.executablePath)
  } elseif ($RequirePath) {
    throw "$Description is missing an executable path."
  }
  return [pscustomobject]@{
    processId = $processId
    parentProcessId = $parentProcessId
    executablePath = $executablePath
    startedAt = $startedAt
  }
}

function Test-ReleaseEvidenceSameProcessStart($Left, $Right) {
  return [Math]::Abs(($Left - $Right).TotalMilliseconds) -le 10
}

function Test-ReleaseEvidenceDescendsFromLauncher($Candidate, [object[]]$Snapshot, $Launcher) {
  $current = $Candidate
  $visited = @{}
  while ($current.parentProcessId -gt 0) {
    if ($visited.ContainsKey([string]$current.parentProcessId)) { return $false }
    $visited[[string]$current.parentProcessId] = $true
    $parents = @($Snapshot | Where-Object {
      $_.processId -eq $current.parentProcessId -and $_.startedAt -le $current.startedAt
    } | Sort-Object startedAt -Descending)
    if ($parents.Count -eq 0) { return $false }
    $parent = $parents[0]
    if ($parent.processId -eq $Launcher.processId) {
      return Test-ReleaseEvidenceSameProcessStart $parent.startedAt $Launcher.startedAt
    }
    $current = $parent
  }
  return $false
}

function Assert-ReleaseEvidenceProcessEventJobState {
  param([AllowEmptyCollection()][object[]]$Jobs = @())
  $jobCount = @($Jobs).Count
  if ($jobCount -ne 1) {
    throw "Process observation requires exactly one event job; found $jobCount."
  }
  $state = [string](Get-ObjectProperty $Jobs[0] 'State' 'Process observation event job')
  if ($state -notin @('NotStarted', 'Running')) {
    throw "Process observation event job is not healthy: $state."
  }
  return [pscustomobject]@{ state = $state; healthy = $true }
}

function Assert-ReleaseEvidenceWindowsProcessSubscription($Token) {
  $sourceIdentifier = [string](Get-ObjectProperty $Token 'sourceIdentifier' 'Process observation token')
  $subscriptionId = [string](Get-ObjectProperty $Token 'subscriptionId' 'Process observation token')
  $jobId = [int](Get-ObjectProperty $Token 'jobId' 'Process observation token')
  $subscribers = @(Get-EventSubscriber -SourceIdentifier $sourceIdentifier -ErrorAction Stop)
  if ($subscribers.Count -ne 1) {
    throw "Process observation requires exactly one active event subscriber; found $($subscribers.Count)."
  }
  $metadata = Get-ObjectProperty $subscribers[0] 'MessageData' 'Process observation subscriber'
  if ([string](Get-ObjectProperty $metadata 'provider' 'Process observation subscriber metadata') -ne 'Win32_ProcessStartTrace' -or
      [string](Get-ObjectProperty $metadata 'subscriptionId' 'Process observation subscriber metadata') -ne $subscriptionId) {
    throw 'Process observation subscriber provider identity does not match its token.'
  }
  $metadataQueue = Get-ObjectProperty $metadata 'queue' 'Process observation subscriber metadata'
  $tokenQueue = Get-ObjectProperty $Token 'queue' 'Process observation token'
  if (-not [object]::ReferenceEquals($metadataQueue, $tokenQueue)) {
    throw 'Process observation subscriber queue identity does not match its token.'
  }
  $jobs = @(Get-Job -Id $jobId -ErrorAction Stop)
  Assert-ReleaseEvidenceProcessEventJobState -Jobs $jobs | Out-Null
}

function New-ReleaseEvidenceWindowsProcessCleanupAdapter {
  return [pscustomobject]@{
    unregister = {
      param($token)
      Unregister-Event -SourceIdentifier ([string]$token.sourceIdentifier) -ErrorAction Stop
    }
    removeEvents = {
      param($token)
      $sourceIdentifier = [string]$token.sourceIdentifier
      $removeError = $null
      foreach ($queuedEvent in @(Get-Event -ErrorAction Stop | Where-Object { $_.SourceIdentifier -eq $sourceIdentifier })) {
        try { Remove-Event -EventIdentifier $queuedEvent.EventIdentifier -ErrorAction Stop } catch {
          $removeError = Merge-ReleaseEvidenceLifecycleError $removeError $_ 'Additionally, queued process event removal failed'
        }
      }
      if ($removeError) { throw $removeError }
    }
    removeJob = {
      param($token)
      foreach ($job in @(Get-Job -ErrorAction Stop | Where-Object { $_.Id -eq [int]$token.jobId })) {
        Remove-Job -Id $job.Id -Force -ErrorAction Stop
      }
    }
    drainQueue = {
      param($token)
      $discarded = $null
      while ($token.queue.TryDequeue([ref]$discarded)) { }
    }
    verify = {
      param($token)
      $sourceIdentifier = [string]$token.sourceIdentifier
      if (@(Get-EventSubscriber -ErrorAction Stop | Where-Object { $_.SourceIdentifier -eq $sourceIdentifier }).Count -ne 0) {
        throw 'Process observation subscriber cleanup did not complete.'
      }
      if (@(Get-Event -ErrorAction Stop | Where-Object { $_.SourceIdentifier -eq $sourceIdentifier }).Count -ne 0) {
        throw 'Process observation queued-event cleanup did not complete.'
      }
      if (@(Get-Job -ErrorAction Stop | Where-Object { $_.Id -eq [int]$token.jobId }).Count -ne 0) {
        throw 'Process observation event-job cleanup did not complete.'
      }
      if (-not $token.queue.IsEmpty) {
        throw 'Process observation in-memory event queue cleanup did not complete.'
      }
    }
  }
}

function Invoke-ReleaseEvidenceProcessSubscriptionCleanup {
  param(
    [Parameter(Mandatory = $true)]$Token,
    $CleanupAdapter
  )
  if ($null -eq $CleanupAdapter) { $CleanupAdapter = New-ReleaseEvidenceWindowsProcessCleanupAdapter }
  $cleanupError = $null
  foreach ($step in @('unregister', 'removeEvents', 'removeJob', 'drainQueue', 'verify')) {
    $operation = Get-ObjectProperty $CleanupAdapter $step 'Process observation cleanup adapter'
    if ($operation -isnot [scriptblock]) {
      $stepError = [System.Management.Automation.ErrorRecord]::new(
        [System.InvalidOperationException]::new("Process observation cleanup adapter '$step' must be a script block."),
        'RainEvidenceProcessCleanupAdapterInvalid',
        [System.Management.Automation.ErrorCategory]::InvalidArgument,
        $CleanupAdapter
      )
      $cleanupError = Merge-ReleaseEvidenceLifecycleError $cleanupError $stepError "Additionally, process observation cleanup step '$step' could not run"
      continue
    }
    try { & $operation $Token } catch {
      $cleanupError = Merge-ReleaseEvidenceLifecycleError $cleanupError $_ "Additionally, process observation cleanup step '$step' failed"
    }
  }
  if ($cleanupError) { throw $cleanupError }
}

function New-ReleaseEvidenceWindowsProcessEventAdapter {
  $kind = 'windows-cim-process-start-events'
  return [pscustomobject]@{
    kind = $kind
    now = { [DateTimeOffset]::Now }
    start = {
      param($identity)
      $sourceIdentifier = "rain-release-process-start-$([Guid]::NewGuid().ToString('N'))"
      $subscriptionId = [Guid]::NewGuid().ToString('N')
      $queue = [System.Collections.Concurrent.ConcurrentQueue[object]]::new()
      $messageData = [pscustomobject]@{
        provider = 'Win32_ProcessStartTrace'
        subscriptionId = $subscriptionId
        queue = $queue
      }
      $job = Register-CimIndicationEvent `
        -Query 'SELECT * FROM Win32_ProcessStartTrace' `
        -SourceIdentifier $sourceIdentifier `
        -MessageData $messageData `
        -Action {
          $event.MessageData.queue.Enqueue($event.SourceEventArgs.NewEvent)
        } `
        -ErrorAction Stop
      return [pscustomobject]@{
        sourceIdentifier = $sourceIdentifier
        subscriptionId = $subscriptionId
        jobId = [int]$job.Id
        queue = $queue
      }
    }
    getSnapshot = {
      return @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop | ForEach-Object {
        [pscustomobject]@{
          processId = [int]$_.ProcessId
          parentProcessId = [int]$_.ParentProcessId
          executablePath = [string]$_.ExecutablePath
          startedAt = [DateTimeOffset]$_.CreationDate
        }
      })
    }
    read = {
      param($token)
      Assert-ReleaseEvidenceWindowsProcessSubscription $token
      $records = @()
      $trace = $null
      while ($token.queue.TryDequeue([ref]$trace)) {
        $startedAt = if ($trace.PSObject.Properties.Name -contains 'TIME_CREATED' -and $trace.TIME_CREATED) {
          [DateTimeOffset]([DateTime]::FromFileTimeUtc([int64]$trace.TIME_CREATED))
        } else {
          [DateTimeOffset]::Now
        }
        $records += [pscustomobject]@{
          processId = [int]$trace.ProcessID
          parentProcessId = [int]$trace.ParentProcessID
          processName = [string]$trace.ProcessName
          startedAt = $startedAt
        }
      }
      return $records
    }
    validateRoot = {
      param($token, $identity)
      return @(Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $([int]$identity.processId)" -ErrorAction Stop | ForEach-Object {
        [pscustomobject]@{
          processId = [int]$_.ProcessId
          parentProcessId = [int]$_.ParentProcessId
          executablePath = [string]$_.ExecutablePath
          startedAt = [DateTimeOffset]$_.CreationDate
        }
      }) | Select-Object -First 1
    }
    assertHealthy = {
      param($token)
      Assert-ReleaseEvidenceWindowsProcessSubscription $token
    }
    stop = {
      param($token)
      Invoke-ReleaseEvidenceProcessSubscriptionCleanup -Token $token
    }
  }
}

function Start-ReleaseEvidenceSessionWorkerObserver {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedRainExecutablePath,
    [Parameter(Mandatory = $true)][DateTimeOffset]$WebDriverSessionStartedAt,
    [Parameter(Mandatory = $true)][int]$TrustedLauncherProcessId,
    [Parameter(Mandatory = $true)][DateTimeOffset]$TrustedLauncherStartedAt,
    $EventAdapter
  )

  if ($null -eq $EventAdapter) { $EventAdapter = New-ReleaseEvidenceWindowsProcessEventAdapter }
  foreach ($method in @('start', 'getSnapshot', 'read', 'validateRoot', 'assertHealthy', 'stop')) {
    $methodValue = Get-ObjectProperty $EventAdapter $method 'Process observation adapter'
    if ($methodValue -isnot [scriptblock]) { throw "Process observation adapter '$method' must be a script block." }
  }
  $expectedPath = [System.IO.Path]::GetFullPath($ExpectedRainExecutablePath)
  $seed = [pscustomobject]@{
    expectedRainExecutablePath = $expectedPath
    webDriverSessionStartedAt = $WebDriverSessionStartedAt
    trustedLauncherProcessId = $TrustedLauncherProcessId
    trustedLauncherStartedAt = $TrustedLauncherStartedAt
  }
  $token = & $EventAdapter.start $seed
  try {
    & $EventAdapter.assertHealthy $token
    $snapshot = @(& $EventAdapter.getSnapshot | ForEach-Object {
      ConvertTo-ReleaseEvidenceProcessIdentity $_ 'Process snapshot entry'
    })
    $launchers = @($snapshot | Where-Object {
      $_.processId -eq $TrustedLauncherProcessId -and
      (Test-ReleaseEvidenceSameProcessStart $_.startedAt $TrustedLauncherStartedAt)
    })
    if ($launchers.Count -ne 1) {
      throw 'Trusted WebDriver launcher process identity is absent or was reused.'
    }
    $candidates = @($snapshot | Where-Object {
      -not [string]::IsNullOrWhiteSpace($_.executablePath) -and
      $_.executablePath.Equals($expectedPath, [System.StringComparison]::OrdinalIgnoreCase) -and
      $_.startedAt -ge $WebDriverSessionStartedAt -and
      (Test-ReleaseEvidenceDescendsFromLauncher $_ $snapshot $launchers[0])
    })
    if ($candidates.Count -ne 1) {
      throw "Expected exactly one Rain process owned by this WebDriver session; found $($candidates.Count)."
    }
    return [pscustomobject]@{
      adapter = $EventAdapter
      token = $token
      rootIdentity = [pscustomobject]@{
        processId = $candidates[0].processId
        parentProcessId = $candidates[0].parentProcessId
        executablePath = $candidates[0].executablePath
        startedAt = $candidates[0].startedAt.ToString('o')
      }
      active = $true
      kind = [string](Get-ObjectProperty $EventAdapter 'kind' 'Process observation adapter')
    }
  } catch {
    & $EventAdapter.stop $token
    throw
  }
}

function Start-ReleaseEvidenceWorkerObservationWindow {
  param([Parameter(Mandatory = $true)]$Observer)
  if (-not $Observer.active) { throw 'Process observation adapter is not active.' }
  & $Observer.adapter.assertHealthy $Observer.token
  [void]@(& $Observer.adapter.read $Observer.token)
  $startedAt = if ($Observer.adapter.PSObject.Properties.Name -contains 'now') {
    & $Observer.adapter.now
  } else {
    [DateTimeOffset]::Now
  }
  return [pscustomobject]@{
    observer = $Observer
    startedAt = [DateTimeOffset]$startedAt
    completed = $false
  }
}

function Complete-ReleaseEvidenceWorkerObservationWindow {
  param([Parameter(Mandatory = $true)]$Window)
  if ($Window.completed) { throw 'Process observation window has already been completed.' }
  $Window.completed = $true
  $observer = $Window.observer
  if (-not $observer.active) { throw 'Process observation adapter is not active.' }
  & $observer.adapter.assertHealthy $observer.token
  $currentRoots = @(& $observer.adapter.validateRoot $observer.token $observer.rootIdentity)
  if ($currentRoots.Count -ne 1) {
    throw 'Rain session process identity changed or exited during observation.'
  }
  $currentRoot = ConvertTo-ReleaseEvidenceProcessIdentity $currentRoots[0] 'Current Rain root process' -RequirePath
  $expectedRootStart = ConvertTo-ReleaseEvidenceProcessTimestamp $observer.rootIdentity.startedAt 'Expected Rain root startedAt'
  if ($currentRoot.processId -ne $observer.rootIdentity.processId -or
      -not $currentRoot.executablePath.Equals([string]$observer.rootIdentity.executablePath, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-ReleaseEvidenceSameProcessStart $currentRoot.startedAt $expectedRootStart)) {
    throw 'Rain session process identity changed or its PID was reused during observation.'
  }
  $events = @(& $observer.adapter.read $observer.token | ForEach-Object {
    $startedAt = ConvertTo-ReleaseEvidenceProcessTimestamp (Get-ObjectProperty $_ 'startedAt' 'Process start event') 'Process start event startedAt'
    [pscustomobject]@{
      processId = [int](Get-ObjectProperty $_ 'processId' 'Process start event')
      parentProcessId = [int](Get-ObjectProperty $_ 'parentProcessId' 'Process start event')
      processName = [string](Get-ObjectProperty $_ 'processName' 'Process start event')
      startedAt = $startedAt
    }
  } | Where-Object { $_.startedAt -ge $Window.startedAt })
  $workerStarts = @()
  foreach ($worker in @($events | Where-Object { $_.processName -ieq 'rain-whisper-cuda.exe' })) {
    $ancestorProcessIds = [System.Collections.Generic.List[int]]::new()
    $parentProcessId = $worker.parentProcessId
    $childStartedAt = $worker.startedAt
    $visited = @{}
    $attributed = $false
    while ($parentProcessId -gt 0 -and -not $visited.ContainsKey([string]$parentProcessId)) {
      $visited[[string]$parentProcessId] = $true
      if ($parentProcessId -eq $observer.rootIdentity.processId) {
        $ancestorProcessIds.Add([int]$parentProcessId)
        $attributed = $true
        break
      }
      $parent = @($events | Where-Object {
        $_.processId -eq $parentProcessId -and $_.startedAt -le $childStartedAt
      } | Sort-Object startedAt -Descending | Select-Object -First 1)
      if ($parent.Count -eq 0) { break }
      $ancestorProcessIds.Add([int]$parent[0].processId)
      $parentProcessId = $parent[0].parentProcessId
      $childStartedAt = $parent[0].startedAt
    }
    if ($attributed) {
      $workerStarts += [pscustomobject]@{
        processId = $worker.processId
        parentProcessId = $worker.parentProcessId
        processName = $worker.processName
        startedAt = $worker.startedAt.ToString('o')
        ancestorProcessIds = @($ancestorProcessIds)
      }
    }
  }
  return [pscustomobject]@{
    source = 'process-start-events'
    rootIdentity = $observer.rootIdentity
    workerStarts = @($workerStarts)
  }
}

function Stop-ReleaseEvidenceSessionWorkerObserver {
  param([Parameter(Mandatory = $true)]$Observer)
  if ($Observer.active) {
    try { & $Observer.adapter.stop $Observer.token } finally { $Observer.active = $false }
  }
}

function Assert-ReleaseEvidenceRuntimeAdapterReadiness {
  foreach ($commandName in @(
    'Get-CimInstance',
    'Register-CimIndicationEvent',
    'Get-Event',
    'Remove-Event',
    'Unregister-Event'
  )) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
      throw "Session process observation requires Windows command '$commandName'."
    }
  }
  $fixtureFacts = Invoke-WithReleaseEvidenceCancellationFixture -Action {
    param($fixture)
    return [ordered]@{
      format = $fixture.format
      durationSeconds = $fixture.durationSeconds
      sizeBytes = $fixture.sizeBytes
      sha256 = $fixture.sha256
      maximumBytes = $fixture.maximumBytes
      cancelAfterBackendSelectionWithinMilliseconds = $fixture.cancelAfterBackendSelectionWithinMilliseconds
    }
  }
  $processAdapter = New-ReleaseEvidenceWindowsProcessEventAdapter
  $processToken = $null
  $processSmokeError = $null
  try {
    $processToken = & $processAdapter.start ([pscustomobject]@{ purpose = 'readiness-smoke' })
    & $processAdapter.assertHealthy $processToken
    [void]@(& $processAdapter.read $processToken)
  } catch {
    $processSmokeError = $_
  } finally {
    if ($processToken) {
      try { & $processAdapter.stop $processToken } catch {
        $processSmokeError = Merge-ReleaseEvidenceLifecycleError $processSmokeError $_ 'Additionally, production process-event smoke cleanup failed'
      }
    }
  }
  if ($processSmokeError) {
    throw "Production process-event job readiness failed closed: $($processSmokeError.Exception.Message)"
  }
  return [ordered]@{
    cancellationFixture = $fixtureFacts
    processObservation = [ordered]@{
      source = 'Win32_ProcessStartTrace'
      rootIdentity = 'exact executable path + PID + process start time + WebDriver launcher ancestry'
      pidReuseCheck = $true
      subscriptionCleanup = 'finally'
      smoke = [ordered]@{
        jobBacked = $true
        healthChecked = $true
        cleanupVerified = $true
      }
    }
    enablementOnly = $true
  }
}

function Get-ReleaseEvidenceRelativePath([string]$Root, [string]$Path) {
  $rootPath = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
  $targetPath = [System.IO.Path]::GetFullPath($Path)
  $rootPrefix = $rootPath + [System.IO.Path]::DirectorySeparatorChar
  if ($targetPath.Equals($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) { return '' }
  if ($targetPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $targetPath.Substring($rootPrefix.Length)
  }
  return '..\outside-root'
}

function Test-SimplePayloadFileName([string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Name)) { return $false }
  if ([System.IO.Path]::IsPathRooted($Name)) { return $false }
  if ($Name -ne [System.IO.Path]::GetFileName($Name)) { return $false }
  return $Name -notmatch '[\\/]'
}

function Test-ReleaseEvidencePayloadManifestRelativeIdentity {
  param(
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][string]$ManifestLeafName
  )
  if ([System.IO.Path]::IsPathRooted($RelativePath)) { return $false }
  $normalized = $RelativePath.Replace([System.IO.Path]::AltDirectorySeparatorChar, [System.IO.Path]::DirectorySeparatorChar)
  if ($normalized.IndexOf([System.IO.Path]::DirectorySeparatorChar) -ge 0) { return $false }
  return $normalized.Equals($ManifestLeafName, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-ReleaseEvidenceCudaOrDriverDllName([AllowNull()][string]$Name) {
  return -not [string]::IsNullOrWhiteSpace($Name) -and $Name -match $script:CudaOrDriverDllNamePattern
}

function Assert-ReleaseEvidenceManifestSha256([string]$Value, [string]$Description) {
  if ($Value -notmatch '^[0-9a-fA-F]{64}$') {
    throw "$Description must be a SHA-256."
  }
  return $Value.ToLowerInvariant()
}

function Assert-ReleaseEvidenceManifestNonBlankString([string]$Value, [string]$Description) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "$Description must not be blank."
  }
  return $Value
}

function Get-ReleaseEvidenceControlledToolchain($Toolchain, [string]$Description) {
  $record = Get-ObjectProperty $Toolchain 'record' $Description
  $recordFileName = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $record 'fileName' "$Description record")) "$Description record.fileName"
  if ($recordFileName -ne [System.IO.Path]::GetFileName($recordFileName) -or $recordFileName.Contains(':') -or $recordFileName.Contains('..') -or $recordFileName -notmatch '(?i)\.json$') {
    throw "$Description record.fileName must be a simple JSON file name."
  }
  $recordSize = [int64](Get-ObjectProperty $record 'sizeBytes' "$Description record")
  if ($recordSize -lt 0) { throw "$Description record.sizeBytes must not be negative." }
  $recordHash = Assert-ReleaseEvidenceManifestSha256 ([string](Get-ObjectProperty $record 'sha256' "$Description record")) "$Description record.sha256"

  $cmake = Get-ObjectProperty $Toolchain 'cmake' $Description
  $cmakeVersion = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $cmake 'version' "$Description cmake")) "$Description cmake.version"
  $cmakeMinimumVersion = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $cmake 'minimumVersion' "$Description cmake")) "$Description cmake.minimumVersion"
  try {
    if ([version]$cmakeVersion -ne [version]'4.0.0' -or [version]$cmakeMinimumVersion -ne [version]'4.0.0') {
      throw "$Description must record exactly CMake 4.0.0 with minimumVersion 4.0.0."
    }
  } catch [System.Management.Automation.RuntimeException] { throw }
  catch { throw "$Description contains an invalid CMake version." }

  $cuda = Get-ObjectProperty $Toolchain 'cuda' $Description
  $cudaToolkitVersion = [string](Get-ObjectProperty $cuda 'toolkitVersion' "$Description cuda")
  if ($cudaToolkitVersion -ne '12.9.1') { throw "$Description cuda.toolkitVersion must be 12.9.1." }
  $architectures = @((Get-ObjectProperty $cuda 'architectures' "$Description cuda") | ForEach-Object { [string]$_ })
  if ($architectures.Count -ne 1 -or $architectures[0] -ne $script:RequiredControlledCudaArchitecture) {
    throw "$Description cuda.architectures must be exactly $script:RequiredControlledCudaArchitecture."
  }
  $architectureBasisUrl = [string](Get-ObjectProperty $cuda 'architectureBasisUrl' "$Description cuda")
  if ($architectureBasisUrl -ne $script:BlackwellArchitectureBasisUrl) {
    throw "$Description cuda.architectureBasisUrl must be $script:BlackwellArchitectureBasisUrl."
  }

  $versions = [ordered]@{}
  foreach ($component in @('ninja', 'llvm', 'rust')) {
    $componentValue = Get-ObjectProperty $Toolchain $component $Description
    $versions[$component] = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $componentValue 'version' "$Description $component")) "$Description $component.version"
  }

  $runner = Get-ObjectProperty $Toolchain 'runner' $Description
  $runnerFacts = [ordered]@{}
  foreach ($field in @('image', 'imageVersion', 'os', 'osVersion', 'architecture')) {
    $runnerFacts[$field] = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $runner $field "$Description runner")) "$Description runner.$field"
  }
  $hostedVersions = [ordered]@{}
  foreach ($component in @('node', 'npm', 'cargo', 'nsis')) {
    $componentValue = Get-ObjectProperty $Toolchain $component $Description
    $hostedVersions[$component] = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $componentValue 'version' "$Description $component")) "$Description $component.version"
  }
  $msvc = Get-ObjectProperty $Toolchain 'msvc' $Description
  $msvcVersion = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $msvc 'version' "$Description msvc")) "$Description msvc.version"
  $msvcHostArchitecture = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $msvc 'hostArchitecture' "$Description msvc")) "$Description msvc.hostArchitecture"
  $msvcTargetArchitecture = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $msvc 'targetArchitecture' "$Description msvc")) "$Description msvc.targetArchitecture"
  if ($msvcHostArchitecture.ToLowerInvariant() -ne 'x64' -or $msvcTargetArchitecture.ToLowerInvariant() -ne 'x64') {
    throw "$Description msvc.hostArchitecture and msvc.targetArchitecture must be x64."
  }
  $downloads = Get-ObjectProperty $Toolchain 'downloads' $Description
  $normalizedDownloads = [ordered]@{}
  foreach ($downloadName in $script:PinnedControlledToolDownloads.Keys) {
    $expectedDownload = $script:PinnedControlledToolDownloads[$downloadName]
    $download = Get-ObjectProperty $downloads $downloadName "$Description downloads"
    $downloadUrl = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $download 'url' "$Description downloads $downloadName url")) "$Description downloads $downloadName.url"
    $downloadHash = Assert-ReleaseEvidenceManifestSha256 ([string](Get-ObjectProperty $download 'sha256' "$Description downloads $downloadName sha256")) "$Description downloads $downloadName.sha256"
    if ($downloadUrl -ne $expectedDownload.url) {
      throw "$Description downloads $downloadName.url must be the pinned download URL."
    }
    if ($downloadHash -ne $expectedDownload.sha256) {
      throw "$Description downloads $downloadName.sha256 must be the pinned download hash."
    }
    $normalizedDownloads[$downloadName] = [ordered]@{ url = $downloadUrl; sha256 = $downloadHash }
  }
  return [pscustomobject]@{
    record = [ordered]@{ fileName = $recordFileName; sizeBytes = $recordSize; sha256 = $recordHash }
    cmake = [ordered]@{ version = $cmakeVersion; minimumVersion = $cmakeMinimumVersion }
    cuda = [ordered]@{ toolkitVersion = $cudaToolkitVersion; architectures = @($architectures); architectureBasisUrl = $architectureBasisUrl }
    ninja = [ordered]@{ version = $versions['ninja'] }
    llvm = [ordered]@{ version = $versions['llvm'] }
    rust = [ordered]@{ version = $versions['rust'] }
    runner = $runnerFacts
    node = [ordered]@{ version = $hostedVersions['node'] }
    npm = [ordered]@{ version = $hostedVersions['npm'] }
    cargo = [ordered]@{ version = $hostedVersions['cargo'] }
    msvc = [ordered]@{ version = $msvcVersion; hostArchitecture = $msvcHostArchitecture; targetArchitecture = $msvcTargetArchitecture }
    nsis = [ordered]@{ version = $hostedVersions['nsis'] }
    downloads = $normalizedDownloads
  }
}

function Assert-CandidateArtifactProvenance {
  param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedTargetCommit,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedInstallerSha256,
    [Parameter(Mandatory = $true)][string]$ArtifactManifestPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedArtifactManifestSha256,
    [Parameter(Mandatory = $true)][string]$ControlledBuildRecordPath
  )

  $installer = Resolve-ReleaseEvidenceFile $InstallerPath 'Installer'
  $artifactManifest = Resolve-ReleaseEvidenceFile $ArtifactManifestPath 'Artifact manifest'
  $controlledBuildRecordPath = Resolve-ReleaseEvidenceFile $ControlledBuildRecordPath 'Controlled-build record'
  try {
    $controlledBuildRecord = Get-Content -LiteralPath $controlledBuildRecordPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Controlled-build record is not valid JSON: $($_.Exception.Message)"
  }
  if ([int](Get-ObjectProperty $controlledBuildRecord 'schemaVersion' 'Controlled-build record') -ne 1) {
    throw 'Controlled-build record schemaVersion must be 1.'
  }
  $recordRepository = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $controlledBuildRecord 'repository' 'Controlled-build record')) 'Controlled-build record repository'
  if ($recordRepository -ne $script:CanonicalRainRepository) {
    throw "Controlled-build record repository must be $script:CanonicalRainRepository."
  }
  $recordSourceRepository = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $controlledBuildRecord 'sourceRepository' 'Controlled-build record')) 'Controlled-build record sourceRepository'
  if ($recordSourceRepository -ne $script:CanonicalRainOrigin) {
    throw "Controlled-build record sourceRepository must be $script:CanonicalRainOrigin."
  }
  $recordTargetCommit = [string](Get-ObjectProperty $controlledBuildRecord 'targetCommit' 'Controlled-build record')
  if ($recordTargetCommit -notmatch '^[0-9a-fA-F]{40}$') {
    throw 'Controlled-build record targetCommit must be a full 40-character Git SHA.'
  }
  $recordTargetCommit = $recordTargetCommit.ToLowerInvariant()
  if ($recordTargetCommit -ne $ExpectedTargetCommit.ToLowerInvariant()) {
    throw 'Controlled-build record target commit does not match the expected target commit.'
  }
  $recordToolingCommit = [string](Get-ObjectProperty $controlledBuildRecord 'toolingCommit' 'Controlled-build record')
  if ($recordToolingCommit -notmatch '^[0-9a-fA-F]{40}$') {
    throw 'Controlled-build record toolingCommit must be a full 40-character Git SHA.'
  }
  $recordToolingCommit = $recordToolingCommit.ToLowerInvariant()
  if ($recordToolingCommit -eq $recordTargetCommit) {
    throw 'Controlled-build record toolingCommit must be distinct from the candidate targetCommit.'
  }
  if ((Get-ObjectProperty $controlledBuildRecord 'cleanTree' 'Controlled-build record') -ne $true) {
    throw 'Controlled-build record cleanTree must be true.'
  }
  $recordGenerator = Get-ObjectProperty $controlledBuildRecord 'generator' 'Controlled-build record'
  $recordGeneratorId = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $recordGenerator 'id' 'Controlled-build record generator')) 'Controlled-build record generator.id'
  $recordGeneratorVersion = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $recordGenerator 'version' 'Controlled-build record generator')) 'Controlled-build record generator.version'
  $recordBuildMetadata = Get-ObjectProperty $controlledBuildRecord 'buildMetadata' 'Controlled-build record'
  $recordBuildRecordId = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $recordBuildMetadata 'buildRecordId' 'Controlled-build record metadata')) 'Controlled-build record buildMetadata.buildRecordId'
  $recordBuiltAt = [string](Get-ObjectProperty $recordBuildMetadata 'builtAt' 'Controlled-build record metadata')
  $parsedRecordBuiltAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse($recordBuiltAt, [ref]$parsedRecordBuiltAt)) {
    throw 'Controlled-build record buildMetadata.builtAt must be an ISO-8601 timestamp.'
  }
  $recordWorkflow = Get-ObjectProperty $controlledBuildRecord 'workflow' 'Controlled-build record'
  $recordWorkflowFile = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $recordWorkflow 'file' 'Controlled-build record workflow')) 'Controlled-build record workflow.file'
  if ($recordWorkflowFile -ne '.github/workflows/controlled-gpu-artifact-build.yml') {
    throw 'Controlled-build record workflow.file must be the controlled GPU artifact workflow.'
  }
  $recordWorkflowDefinitionCommit = [string](Get-ObjectProperty $recordWorkflow 'definitionCommit' 'Controlled-build record workflow')
  if ($recordWorkflowDefinitionCommit -notmatch '^[0-9a-fA-F]{40}$' -or $recordWorkflowDefinitionCommit.ToLowerInvariant() -ne $recordToolingCommit) {
    throw 'Controlled-build record workflow definition commit must match toolingCommit.'
  }
  $recordWorkflowRunId = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $recordWorkflow 'runId' 'Controlled-build record workflow')) 'Controlled-build record workflow.runId'
  if ($recordWorkflowRunId -notmatch '^[0-9]+$') {
    throw 'Controlled-build record workflow.runId must be a GitHub run id.'
  }
  $recordWorkflowRunAttempt = [int](Get-ObjectProperty $recordWorkflow 'runAttempt' 'Controlled-build record workflow')
  if ($recordWorkflowRunAttempt -lt 1) {
    throw 'Controlled-build record workflow.runAttempt must be positive.'
  }
  $recordWorkflowEvent = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $recordWorkflow 'event' 'Controlled-build record workflow')) 'Controlled-build record workflow.event'
  if ($recordWorkflowEvent -ne 'workflow_dispatch') {
    throw 'Controlled-build record workflow.event must be workflow_dispatch.'
  }
  $recordWorkflowRef = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $recordWorkflow 'ref' 'Controlled-build record workflow')) 'Controlled-build record workflow.ref'
  if ($recordWorkflowRef -ne 'refs/heads/master') {
    throw 'Controlled-build record workflow.ref must be refs/heads/master.'
  }
  $recordWorkflowRunUrl = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $recordWorkflow 'runUrl' 'Controlled-build record workflow')) 'Controlled-build record workflow.runUrl'
  $expectedWorkflowRunUrl = "https://github.com/$script:CanonicalRainRepository/actions/runs/$recordWorkflowRunId/attempts/$recordWorkflowRunAttempt"
  if ($recordWorkflowRunUrl -ne $expectedWorkflowRunUrl) {
    throw 'Controlled-build record workflow.runUrl must bind the canonical repository, run id, and attempt.'
  }
  $masterReachability = Get-ObjectProperty $controlledBuildRecord 'masterReachability' 'Controlled-build record'
  if ((Get-ObjectProperty $masterReachability 'candidate' 'Controlled-build record masterReachability') -ne $true -or
      (Get-ObjectProperty $masterReachability 'tooling' 'Controlled-build record masterReachability') -ne $true) {
    throw 'Controlled-build record must prove candidate and tooling reachability from canonical master.'
  }
  $recordToolchain = Get-ReleaseEvidenceControlledToolchain (Get-ObjectProperty $controlledBuildRecord 'toolchain' 'Controlled-build record') 'Controlled-build record toolchain'
  $recordCoreArtifact = Get-ObjectProperty $controlledBuildRecord 'coreArtifact' 'Controlled-build record'
  $recordCoreArtifactName = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $recordCoreArtifact 'name' 'Controlled-build record core artifact')) 'Controlled-build record coreArtifact.name'
  if ($recordCoreArtifactName -ne [System.IO.Path]::GetFileName($recordCoreArtifactName) -or
      $recordCoreArtifactName.Contains(':') -or $recordCoreArtifactName.Contains('..')) {
    throw 'Controlled-build record coreArtifact.name must be a simple artifact name.'
  }
  $recordCoreArtifactDigest = Assert-ReleaseEvidenceManifestSha256 ([string](Get-ObjectProperty $recordCoreArtifact 'digest' 'Controlled-build record core artifact')) 'Controlled-build record coreArtifact.digest'
  $recordInstaller = Get-ObjectProperty $controlledBuildRecord 'installer' 'Controlled-build record'
  $recordInstallerFileName = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $recordInstaller 'fileName' 'Controlled-build record installer')) 'Controlled-build record installer.fileName'
  $recordInstallerHash = Assert-ReleaseEvidenceManifestSha256 ([string](Get-ObjectProperty $recordInstaller 'sha256' 'Controlled-build record installer')) 'Controlled-build record installer.sha256'
  $recordInstallerSize = [int64](Get-ObjectProperty $recordInstaller 'sizeBytes' 'Controlled-build record installer')
  if ($recordInstallerSize -lt 0) { throw 'Controlled-build record installer.sizeBytes must not be negative.' }
  $recordInstallerKind = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $recordInstaller 'kind' 'Controlled-build record installer')) 'Controlled-build record installer.kind'
  $recordArtifactManifest = Get-ObjectProperty $controlledBuildRecord 'artifactManifest' 'Controlled-build record'
  $recordArtifactManifestFileName = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $recordArtifactManifest 'fileName' 'Controlled-build record artifact manifest')) 'Controlled-build record artifactManifest.fileName'
  $recordArtifactManifestHash = Assert-ReleaseEvidenceManifestSha256 ([string](Get-ObjectProperty $recordArtifactManifest 'sha256' 'Controlled-build record artifact manifest')) 'Controlled-build record artifactManifest.sha256'
  $recordArtifactManifestSize = [int64](Get-ObjectProperty $recordArtifactManifest 'sizeBytes' 'Controlled-build record artifact manifest')
  if ($recordArtifactManifestSize -lt 0) { throw 'Controlled-build record artifactManifest.sizeBytes must not be negative.' }
  if ($recordArtifactManifestHash -ne $ExpectedArtifactManifestSha256.ToLowerInvariant()) {
    throw 'Controlled-build record artifact-manifest SHA-256 does not match the expected artifact-manifest SHA-256.'
  }

  $artifactManifestHash = Get-ReleaseEvidenceSha256 $artifactManifest
  if ($artifactManifestHash -ne $ExpectedArtifactManifestSha256.ToLowerInvariant()) {
    throw 'Artifact manifest SHA-256 does not match the expected controlled-build record.'
  }
  $artifactManifestItem = Get-Item -LiteralPath $artifactManifest
  if ($artifactManifestItem.Name -ne $recordArtifactManifestFileName -or $artifactManifestItem.Length -ne $recordArtifactManifestSize) {
    throw 'Controlled-build record artifact manifest identity does not match the supplied artifact manifest.'
  }
  try {
    $manifest = Get-Content -LiteralPath $artifactManifest -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Artifact manifest is not valid JSON: $($_.Exception.Message)"
  }

  if ([int](Get-ObjectProperty $manifest 'schemaVersion' 'Artifact manifest') -ne 1) {
    throw 'Artifact manifest schemaVersion must be 1.'
  }
  if ([string](Get-ObjectProperty $manifest 'productName' 'Artifact manifest') -ne 'Rain') {
    throw 'Artifact manifest productName must be Rain.'
  }
  if ([string](Get-ObjectProperty $manifest 'version' 'Artifact manifest') -ne '0.1.0') {
    throw 'Artifact manifest version must be 0.1.0.'
  }
  if ([string](Get-ObjectProperty $manifest 'identifier' 'Artifact manifest') -ne 'com.rain.app') {
    throw 'Artifact manifest identifier must be com.rain.app.'
  }

  $hygieneScopes = @((Get-ObjectProperty $manifest 'hygieneScopes' 'Artifact manifest'))
  if ($hygieneScopes.Count -ne 2 -or
      [string]$hygieneScopes[0] -ne 'installed-tree' -or
      [string]$hygieneScopes[1] -ne 'installer-archive') {
    throw 'Artifact manifest hygieneScopes must be exactly installed-tree and installer-archive.'
  }

  $mainExecutable = Get-ObjectProperty $manifest 'mainExecutable' 'Artifact manifest'
  $mainExecutablePath = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $mainExecutable 'path' 'Artifact manifest mainExecutable')) 'Artifact manifest mainExecutable.path'
  $mainExecutableSize = [int64](Get-ObjectProperty $mainExecutable 'sizeBytes' 'Artifact manifest mainExecutable')
  if ($mainExecutableSize -lt 0) { throw 'Artifact manifest mainExecutable.sizeBytes must not be negative.' }
  $mainExecutableHash = Assert-ReleaseEvidenceManifestSha256 ([string](Get-ObjectProperty $mainExecutable 'sha256' 'Artifact manifest mainExecutable')) 'Artifact manifest mainExecutable.sha256'
  if ((Get-ObjectProperty $mainExecutable 'cudaImportsPresent' 'Artifact manifest mainExecutable') -ne $false) {
    throw 'Artifact manifest mainExecutable.cudaImportsPresent must be false.'
  }

  $resources = Get-ObjectProperty $manifest 'resources' 'Artifact manifest'
  $cudaWorker = Get-ObjectProperty $resources 'cudaWorker' 'Artifact manifest resources'
  $cudaWorkerPath = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $cudaWorker 'path' 'Artifact manifest CUDA worker')) 'Artifact manifest CUDA worker.path'
  $cudaWorkerSize = [int64](Get-ObjectProperty $cudaWorker 'sizeBytes' 'Artifact manifest CUDA worker')
  if ($cudaWorkerSize -lt 0) { throw 'Artifact manifest CUDA worker.sizeBytes must not be negative.' }
  $cudaWorkerHash = Assert-ReleaseEvidenceManifestSha256 ([string](Get-ObjectProperty $cudaWorker 'sha256' 'Artifact manifest CUDA worker')) 'Artifact manifest CUDA worker.sha256'
  if ([int](Get-ObjectProperty $cudaWorker 'protocolVersion' 'Artifact manifest CUDA worker') -ne 1) {
    throw 'Artifact manifest CUDA worker protocolVersion must be 1.'
  }
  if ([string](Get-ObjectProperty $cudaWorker 'configuration' 'Artifact manifest CUDA worker') -ne 'release') {
    throw 'Artifact manifest CUDA worker configuration must be release.'
  }

  $cudaPayloadManifest = Get-ObjectProperty $resources 'cudaPayloadManifest' 'Artifact manifest resources'
  $cudaPayloadManifestPath = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $cudaPayloadManifest 'path' 'Artifact manifest CUDA payload manifest')) 'Artifact manifest CUDA payload manifest.path'
  if ($cudaPayloadManifestPath.Replace('\', '/') -ne 'resources/whisper-backends/payload-manifest.json') {
    throw 'Artifact manifest CUDA payload manifest path must be resources/whisper-backends/payload-manifest.json.'
  }
  $cudaPayloadManifestSize = [int64](Get-ObjectProperty $cudaPayloadManifest 'sizeBytes' 'Artifact manifest CUDA payload manifest')
  if ($cudaPayloadManifestSize -lt 0) { throw 'Artifact manifest CUDA payload manifest sizeBytes must not be negative.' }
  [void](Assert-ReleaseEvidenceManifestSha256 ([string](Get-ObjectProperty $cudaPayloadManifest 'sha256' 'Artifact manifest CUDA payload manifest')) 'Artifact manifest CUDA payload manifest.sha256')
  if ([int](Get-ObjectProperty $cudaPayloadManifest 'schemaVersion' 'Artifact manifest CUDA payload manifest') -ne 1) {
    throw 'Artifact manifest CUDA payload manifest schemaVersion must be 1.'
  }
  if ([string](Get-ObjectProperty $cudaPayloadManifest 'configuration' 'Artifact manifest CUDA payload manifest') -ne 'release') {
    throw 'Artifact manifest CUDA payload manifest configuration must be release.'
  }

  $cudaRuntime = Get-ObjectProperty $resources 'cudaRuntime' 'Artifact manifest resources'
  $cudaRuntimeFiles = @((Get-ObjectProperty $cudaRuntime 'files' 'Artifact manifest CUDA runtime'))
  if ($cudaRuntimeFiles.Count -eq 0) {
    throw 'Artifact manifest CUDA runtime files must not be empty.'
  }
  foreach ($runtimeFile in $cudaRuntimeFiles) {
    [void](Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $runtimeFile 'name' 'Artifact manifest CUDA runtime file')) 'Artifact manifest CUDA runtime file.name')
    [void](Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $runtimeFile 'path' 'Artifact manifest CUDA runtime file')) 'Artifact manifest CUDA runtime file.path')
    $runtimeSize = [int64](Get-ObjectProperty $runtimeFile 'sizeBytes' 'Artifact manifest CUDA runtime file')
    if ($runtimeSize -lt 0) { throw 'Artifact manifest CUDA runtime file.sizeBytes must not be negative.' }
    [void](Assert-ReleaseEvidenceManifestSha256 ([string](Get-ObjectProperty $runtimeFile 'sha256' 'Artifact manifest CUDA runtime file')) 'Artifact manifest CUDA runtime file.sha256')
  }
  if ((Get-ObjectProperty $cudaRuntime 'driverLibraryBundled' 'Artifact manifest CUDA runtime') -ne $false) {
    throw 'Artifact manifest CUDA runtime driverLibraryBundled must be false.'
  }
  [void](Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $cudaRuntime 'distributionApproval' 'Artifact manifest CUDA runtime')) 'Artifact manifest CUDA runtime distributionApproval')

  $forbiddenFindings = Get-ObjectProperty $manifest 'forbiddenFindings' 'Artifact manifest'
  $unexpectedFindingCategories = @($forbiddenFindings.PSObject.Properties.Name | Where-Object { $script:ArtifactForbiddenFindingCategories -notcontains $_ })
  if ($unexpectedFindingCategories.Count -gt 0) {
    throw "Artifact manifest forbiddenFindings contains an unknown category: $($unexpectedFindingCategories -join ', ')."
  }
  foreach ($category in $script:ArtifactForbiddenFindingCategories) {
    # Read the PSPropertyInfo value directly.  Returning an empty array through
    # the PowerShell pipeline produces no output (and therefore looks like
    # $null), which must remain distinct from a JSON null here.
    $categoryProperty = $forbiddenFindings.PSObject.Properties[$category]
    if ($null -eq $categoryProperty) {
      throw "Artifact manifest forbiddenFindings is missing required property '$category'."
    }
    $categoryValue = $categoryProperty.Value
    if ($null -eq $categoryValue) {
      throw "Artifact manifest forbiddenFindings.$category must be an empty array, not null."
    }
    # ConvertFrom-Json unwraps a single-item JSON array to a scalar in Windows
    # PowerShell.  A scalar can therefore only be accepted here when it is
    # absent; any present scalar represents a non-empty forbidden finding.
    if ($categoryValue -is [string]) {
      throw "Artifact manifest forbiddenFindings.$category must be empty."
    }
    if ($categoryValue -isnot [System.Collections.IEnumerable]) {
      throw "Artifact manifest forbiddenFindings.$category must be an array."
    }
    if (@($categoryValue).Count -ne 0) {
      throw "Artifact manifest forbiddenFindings.$category must be empty."
    }
  }
  $generatedAt = [string](Get-ObjectProperty $manifest 'generatedAt' 'Artifact manifest')
  $parsedGeneratedAt = [DateTimeOffset]::MinValue
  if (-not [DateTimeOffset]::TryParse($generatedAt, [ref]$parsedGeneratedAt)) {
    throw 'Artifact manifest generatedAt must be an ISO-8601 timestamp.'
  }
  $artifactGenerator = Get-ObjectProperty $manifest 'generator' 'Artifact manifest'
  $artifactGeneratorId = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $artifactGenerator 'id' 'Artifact manifest generator')) 'Artifact manifest generator.id'
  $artifactGeneratorVersion = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $artifactGenerator 'version' 'Artifact manifest generator')) 'Artifact manifest generator.version'

  $targetCommit = [string](Get-ObjectProperty $manifest 'targetCommit' 'Artifact manifest')
  if ($targetCommit -notmatch '^[0-9a-fA-F]{40}$') {
    throw 'Artifact manifest targetCommit must be a full 40-character Git SHA.'
  }
  if ($targetCommit.ToLowerInvariant() -ne $ExpectedTargetCommit.ToLowerInvariant()) {
    throw 'Artifact manifest target commit does not match the expected target commit.'
  }

  $controlledBuild = Get-ObjectProperty $manifest 'controlledBuild' 'Artifact manifest'
  $sourceRepository = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $controlledBuild 'sourceRepository' 'Controlled-build record')) 'Controlled-build record sourceRepository'
  if ($sourceRepository -ne $recordSourceRepository) {
    throw 'Controlled-build record source repository does not match artifact manifest source repository.'
  }
  $controlledTargetCommit = [string](Get-ObjectProperty $controlledBuild 'targetCommit' 'Controlled-build record')
  if ($controlledTargetCommit -notmatch '^[0-9a-fA-F]{40}$' -or $controlledTargetCommit.ToLowerInvariant() -ne $ExpectedTargetCommit.ToLowerInvariant()) {
    throw 'Controlled-build record target commit does not match the expected target commit.'
  }
  if ($controlledTargetCommit.ToLowerInvariant() -ne $recordTargetCommit) {
    throw 'Controlled-build record target commit does not match artifact manifest target commit.'
  }
  $controlledToolingCommit = [string](Get-ObjectProperty $controlledBuild 'toolingCommit' 'Controlled-build record')
  if ($controlledToolingCommit -notmatch '^[0-9a-fA-F]{40}$') {
    throw 'Artifact manifest controlled-build toolingCommit must be a full 40-character Git SHA.'
  }
  if ($controlledToolingCommit.ToLowerInvariant() -ne $recordToolingCommit) {
    throw 'Controlled-build record tooling commit does not match artifact manifest tooling commit.'
  }
  if ((Get-ObjectProperty $controlledBuild 'cleanTree' 'Controlled-build record') -ne $true) {
    throw 'Controlled-build record cleanTree must be true.'
  }
  $manifestToolchain = Get-ReleaseEvidenceControlledToolchain (Get-ObjectProperty $controlledBuild 'toolchain' 'Artifact manifest controlledBuild') 'Artifact manifest controlled-build toolchain'
  if ((ConvertTo-Json -InputObject $manifestToolchain -Depth 20 -Compress) -ne (ConvertTo-Json -InputObject $recordToolchain -Depth 20 -Compress)) {
    throw 'Controlled-build record toolchain does not match artifact manifest controlled-build toolchain.'
  }
  $generator = Get-ObjectProperty $controlledBuild 'generator' 'Controlled-build record'
  $generatorId = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $generator 'id' 'Controlled-build generator')) 'Controlled-build generator identity'
  $generatorVersion = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $generator 'version' 'Controlled-build generator')) 'Controlled-build generator version'
  if ($generatorId -ne $recordGeneratorId -or $generatorVersion -ne $recordGeneratorVersion) {
    throw 'Controlled-build record generator does not match artifact manifest controlled-build generator.'
  }
  $buildMetadata = Get-ObjectProperty $controlledBuild 'buildMetadata' 'Controlled-build record'
  $buildRecordId = [string](Get-ObjectProperty $buildMetadata 'buildRecordId' 'Controlled-build metadata')
  $builtAt = [string](Get-ObjectProperty $buildMetadata 'builtAt' 'Controlled-build metadata')
  $parsedBuiltAt = [DateTimeOffset]::MinValue
  if ([string]::IsNullOrWhiteSpace($buildRecordId) -or -not [DateTimeOffset]::TryParse($builtAt, [ref]$parsedBuiltAt)) {
    throw 'Controlled-build metadata must contain a build record id and ISO-8601 timestamp.'
  }
  if ($buildRecordId -ne $recordBuildRecordId -or $builtAt -ne $recordBuiltAt) {
    throw 'Controlled-build record metadata does not match artifact manifest controlled-build metadata.'
  }

  $manifestInstaller = Get-ObjectProperty $manifest 'installer' 'Artifact manifest'
  $manifestFileName = [string](Get-ObjectProperty $manifestInstaller 'fileName' 'Artifact manifest installer')
  $manifestHash = [string](Get-ObjectProperty $manifestInstaller 'sha256' 'Artifact manifest installer')
  $manifestSize = [int64](Get-ObjectProperty $manifestInstaller 'sizeBytes' 'Artifact manifest installer')
  $manifestKind = [string](Get-ObjectProperty $manifestInstaller 'kind' 'Artifact manifest installer')
  $manifestHash = Assert-ReleaseEvidenceManifestSha256 $manifestHash 'Artifact manifest installer SHA-256'
  if ($manifestKind -notmatch '(?i)^nsis(?:[-_ ]windows)?[-_ ]x64$') {
    throw 'Artifact manifest installer kind must identify an NSIS Windows x64 installer.'
  }
  if ($manifestFileName -ne $recordInstallerFileName -or
      $manifestHash -ne $recordInstallerHash -or
      $manifestSize -ne $recordInstallerSize -or
      $manifestKind -ne $recordInstallerKind) {
    throw 'Controlled-build record installer identity does not match artifact manifest installer identity.'
  }

  $installerItem = Get-Item -LiteralPath $installer
  $installerHash = Get-ReleaseEvidenceSha256 $installer
  if ($installerItem.Name -ne $manifestFileName) {
    throw 'Artifact manifest installer file name does not match the supplied installer.'
  }
  if ($installerItem.Length -ne $manifestSize) {
    throw 'Artifact manifest installer size does not match the supplied installer.'
  }
  if ($installerHash -ne $manifestHash.ToLowerInvariant()) {
    throw 'Artifact manifest installer SHA-256 does not match the supplied installer.'
  }
  if ($installerHash -ne $ExpectedInstallerSha256.ToLowerInvariant()) {
    throw 'Installer SHA-256 mismatch against the expected installer hash.'
  }

  $installationProof = Get-ObjectProperty $manifest 'installationProof' 'Artifact manifest'
  $proofPropertyNames = @($installationProof.PSObject.Properties.Name)
  $unexpectedProofProperties = @($proofPropertyNames | Where-Object { @('kind', 'schemaVersion', 'installerSha256', 'mainExecutable', 'payloadManifest', 'silentInstall') -notcontains $_ })
  if ($unexpectedProofProperties.Count -gt 0) {
    throw 'Artifact manifest installationProof must not contain raw installation paths or arguments.'
  }
  if ([string](Get-ObjectProperty $installationProof 'kind' 'Artifact manifest installationProof') -ne 'rain-nsis-install-proof-v2' -or
      [int](Get-ObjectProperty $installationProof 'schemaVersion' 'Artifact manifest installationProof') -ne 2) {
    throw 'Artifact manifest installationProof must use the logical rain-nsis-install-proof-v2 schema.'
  }
  $proofInstallerHash = Assert-ReleaseEvidenceManifestSha256 ([string](Get-ObjectProperty $installationProof 'installerSha256' 'Artifact manifest installationProof')) 'Artifact manifest installationProof.installerSha256'
  if ($proofInstallerHash -ne $installerHash) {
    throw 'Artifact manifest installationProof is not bound to the supplied installer bytes.'
  }
  $proofMainExecutable = Get-ObjectProperty $installationProof 'mainExecutable' 'Artifact manifest installationProof'
  $proofMainPath = ([string](Get-ObjectProperty $proofMainExecutable 'path' 'Artifact manifest installationProof mainExecutable')).Replace('\', '/').ToLowerInvariant()
  if ($proofMainPath -ne 'rain.exe' -or [int](Get-ObjectProperty $proofMainExecutable 'machine' 'Artifact manifest installationProof mainExecutable') -ne 0x8664) {
    throw 'Artifact manifest installationProof must establish the logical AMD64 rain.exe layout.'
  }
  $proofPayloadManifest = Get-ObjectProperty $installationProof 'payloadManifest' 'Artifact manifest installationProof'
  $proofPayloadPath = ([string](Get-ObjectProperty $proofPayloadManifest 'path' 'Artifact manifest installationProof payloadManifest')).Replace('\', '/').ToLowerInvariant()
  if ($proofPayloadPath -ne 'resources/whisper-backends/payload-manifest.json') {
    throw 'Artifact manifest installationProof must establish the logical CUDA payload-manifest layout.'
  }
  $proofSilentInstall = Get-ObjectProperty $installationProof 'silentInstall' 'Artifact manifest installationProof'
  $unexpectedSilentProperties = @($proofSilentInstall.PSObject.Properties.Name | Where-Object { @('mode', 'destinationKind', 'waited', 'exitCode') -notcontains $_ })
  if ($unexpectedSilentProperties.Count -gt 0) {
    throw 'Artifact manifest installationProof must not contain raw installation paths or arguments.'
  }
  if ([string](Get-ObjectProperty $proofSilentInstall 'mode' 'Artifact manifest installationProof silentInstall') -ne 'silent' -or
      [string](Get-ObjectProperty $proofSilentInstall 'destinationKind' 'Artifact manifest installationProof silentInstall') -ne 'unique-runner-temp' -or
      (Get-ObjectProperty $proofSilentInstall 'waited' 'Artifact manifest installationProof silentInstall') -ne $true -or
      [int](Get-ObjectProperty $proofSilentInstall 'exitCode' 'Artifact manifest installationProof silentInstall') -ne 0) {
    throw 'Artifact manifest installationProof must establish a successful waited silent install into a unique runner-temporary destination.'
  }

  return [pscustomobject]@{
    targetCommit = $targetCommit.ToLowerInvariant()
    toolingCommit = $recordToolingCommit
    installer = [ordered]@{
      path = $installer
      fileName = $installerItem.Name
      sizeBytes = $installerItem.Length
      sha256 = $installerHash
      kind = $manifestKind
    }
    artifactManifest = [ordered]@{
      path = $artifactManifest
      sha256 = $artifactManifestHash
      schemaVersion = [int]$manifest.schemaVersion
      version = '0.1.0'
      installationProof = [ordered]@{
        kind = 'rain-nsis-install-proof-v2'; schemaVersion = 2; installerSha256 = $proofInstallerHash
        mainExecutable = [ordered]@{ path = 'rain.exe'; machine = 0x8664 }
        payloadManifest = [ordered]@{ path = 'resources/whisper-backends/payload-manifest.json' }
        silentInstall = [ordered]@{ mode = 'silent'; destinationKind = 'unique-runner-temp'; waited = $true; exitCode = 0 }
      }
      mainExecutable = [ordered]@{ path = $mainExecutablePath; sizeBytes = $mainExecutableSize; sha256 = $mainExecutableHash; cudaImportsPresent = $false }
      resources = [ordered]@{
        cudaWorker = [ordered]@{ path = $cudaWorkerPath; sizeBytes = $cudaWorkerSize; sha256 = $cudaWorkerHash; protocolVersion = 1 }
        cudaRuntime = [ordered]@{
          files = @($cudaRuntimeFiles | ForEach-Object {
            [ordered]@{
              name = [string]$_.name
              path = [string]$_.path
              sizeBytes = [int64]$_.sizeBytes
              sha256 = ([string]$_.sha256).ToLowerInvariant()
            }
          })
          fileCount = $cudaRuntimeFiles.Count
          driverLibraryBundled = $false
        }
      }
      generatedAt = $parsedGeneratedAt.ToString('o')
      forbiddenFindings = [ordered]@{
        secrets = @(); e2eMarkers = @(); absolutePaths = @(); userData = @(); forbiddenDlls = @();
        modelFiles = @(); sourceMaps = @(); unscannedTextFiles = @(); unreadableTextFiles = @(); debugArtifacts = @()
      }
      generator = [ordered]@{ id = $artifactGeneratorId; version = $artifactGeneratorVersion }
      controlledBuild = [ordered]@{
        sourceRepository = $sourceRepository
        targetCommit = $controlledTargetCommit.ToLowerInvariant()
        toolingCommit = $controlledToolingCommit.ToLowerInvariant()
        cleanTree = $true
        generator = [ordered]@{ id = $generatorId; version = $generatorVersion }
        buildMetadata = [ordered]@{ buildRecordId = $buildRecordId; builtAt = $parsedBuiltAt.ToString('o') }
        toolchain = $manifestToolchain
      }
    }
    controlledBuildRecord = [ordered]@{
      path = $controlledBuildRecordPath
      sha256 = Get-ReleaseEvidenceSha256 $controlledBuildRecordPath
      schemaVersion = [int]$controlledBuildRecord.schemaVersion
      repository = $recordRepository
      sourceRepository = $recordSourceRepository
      targetCommit = $recordTargetCommit
      toolingCommit = $recordToolingCommit
      cleanTree = $true
      generator = [ordered]@{ id = $recordGeneratorId; version = $recordGeneratorVersion }
      buildMetadata = [ordered]@{ buildRecordId = $recordBuildRecordId; builtAt = $parsedRecordBuiltAt.ToString('o') }
      workflow = [ordered]@{
        file = $recordWorkflowFile
        definitionCommit = $recordToolingCommit
        runUrl = $recordWorkflowRunUrl
        event = $recordWorkflowEvent
        ref = $recordWorkflowRef
        runId = $recordWorkflowRunId
        runAttempt = $recordWorkflowRunAttempt
      }
      masterReachability = [ordered]@{ candidate = $true; tooling = $true }
      toolchain = $recordToolchain
      coreArtifact = [ordered]@{ name = $recordCoreArtifactName; digest = $recordCoreArtifactDigest }
    }
  }
}

function Resolve-ReleaseEvidenceInstalledManifestFile {
  param(
    [Parameter(Mandatory = $true)][string]$InstalledRoot,
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][string]$Description
  )

  $relativePath = Assert-ReleaseEvidenceManifestNonBlankString $RelativePath "$Description path"
  if ([System.IO.Path]::IsPathRooted($relativePath)) {
    throw "$Description path must be relative to the installed application root."
  }
  $segments = @($relativePath -split '[\\/]' | Where-Object { $_ -ne '' })
  if ($segments.Count -eq 0 -or @($segments | Where-Object { $_ -eq '.' -or $_ -eq '..' }).Count -gt 0) {
    throw "$Description path must be a normalized relative path."
  }

  $rootPath = [System.IO.Path]::GetFullPath($InstalledRoot)
  $candidatePath = [System.IO.Path]::GetFullPath((Join-Path $rootPath ($segments -join [System.IO.Path]::DirectorySeparatorChar)))
  $rootPrefix = $rootPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $candidatePath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "$Description path escapes the installed application root."
  }
  if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) {
    throw "Installed artifact file is missing from the real installed tree: $relativePath"
  }
  return Get-Item -LiteralPath $candidatePath -Force
}

function Assert-InstalledArtifactManifest {
  param(
    [Parameter(Mandatory = $true)][string]$InstalledRoot,
    [Parameter(Mandatory = $true)][string]$ArtifactManifestPath
  )

  $installedRoot = (Get-Item -LiteralPath (Resolve-ReleaseEvidenceDirectory $InstalledRoot 'Installed application root')).FullName
  $artifactManifestPath = Resolve-ReleaseEvidenceFile $ArtifactManifestPath 'Artifact manifest'
  try {
    $manifest = Get-Content -LiteralPath $artifactManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "Artifact manifest is not valid JSON: $($_.Exception.Message)"
  }
  if ([int](Get-ObjectProperty $manifest 'schemaVersion' 'Artifact manifest') -ne 1) {
    throw 'Artifact manifest schemaVersion must be 1.'
  }

  $declaredFiles = [System.Collections.Generic.List[object]]::new()
  $mainExecutable = Get-ObjectProperty $manifest 'mainExecutable' 'Artifact manifest'
  [void]$declaredFiles.Add([pscustomobject]@{
    description = 'Artifact manifest main executable'
    path = [string](Get-ObjectProperty $mainExecutable 'path' 'Artifact manifest mainExecutable')
    sizeBytes = Get-ObjectProperty $mainExecutable 'sizeBytes' 'Artifact manifest mainExecutable'
    sha256 = [string](Get-ObjectProperty $mainExecutable 'sha256' 'Artifact manifest mainExecutable')
  })

  $resources = Get-ObjectProperty $manifest 'resources' 'Artifact manifest'
  $cudaWorker = Get-ObjectProperty $resources 'cudaWorker' 'Artifact manifest resources'
  [void]$declaredFiles.Add([pscustomobject]@{
    description = 'Artifact manifest CUDA worker'
    path = [string](Get-ObjectProperty $cudaWorker 'path' 'Artifact manifest CUDA worker')
    sizeBytes = Get-ObjectProperty $cudaWorker 'sizeBytes' 'Artifact manifest CUDA worker'
    sha256 = [string](Get-ObjectProperty $cudaWorker 'sha256' 'Artifact manifest CUDA worker')
  })

  $cudaPayloadManifest = Get-ObjectProperty $resources 'cudaPayloadManifest' 'Artifact manifest resources'
  [void]$declaredFiles.Add([pscustomobject]@{
    description = 'Artifact manifest CUDA payload manifest'
    path = [string](Get-ObjectProperty $cudaPayloadManifest 'path' 'Artifact manifest CUDA payload manifest')
    sizeBytes = Get-ObjectProperty $cudaPayloadManifest 'sizeBytes' 'Artifact manifest CUDA payload manifest'
    sha256 = [string](Get-ObjectProperty $cudaPayloadManifest 'sha256' 'Artifact manifest CUDA payload manifest')
  })

  $cudaRuntime = Get-ObjectProperty $resources 'cudaRuntime' 'Artifact manifest resources'
  $cudaRuntimeFiles = @((Get-ObjectProperty $cudaRuntime 'files' 'Artifact manifest CUDA runtime'))
  if ($cudaRuntimeFiles.Count -eq 0) {
    throw 'Artifact manifest CUDA runtime files must not be empty.'
  }
  foreach ($runtimeFile in $cudaRuntimeFiles) {
    [void]$declaredFiles.Add([pscustomobject]@{
      description = 'Artifact manifest CUDA runtime file'
      path = [string](Get-ObjectProperty $runtimeFile 'path' 'Artifact manifest CUDA runtime file')
      sizeBytes = Get-ObjectProperty $runtimeFile 'sizeBytes' 'Artifact manifest CUDA runtime file'
      sha256 = [string](Get-ObjectProperty $runtimeFile 'sha256' 'Artifact manifest CUDA runtime file')
    })
  }

  $seenPaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $verified = [System.Collections.Generic.List[object]]::new()
  foreach ($declared in $declaredFiles) {
    $relativePath = Assert-ReleaseEvidenceManifestNonBlankString ([string]$declared.path) "$($declared.description)"
    if (-not $seenPaths.Add($relativePath.Replace('/', '\\'))) {
      throw "Artifact manifest declares the installed artifact path more than once: $relativePath"
    }
    $expectedSize = [int64]$declared.sizeBytes
    if ($expectedSize -lt 0) {
      throw "$($declared.description) sizeBytes must not be negative."
    }
    $expectedHash = Assert-ReleaseEvidenceManifestSha256 ([string]$declared.sha256) "$($declared.description) SHA-256"
    $file = Resolve-ReleaseEvidenceInstalledManifestFile -InstalledRoot $installedRoot -RelativePath $relativePath -Description $declared.description
    $actualHash = Get-ReleaseEvidenceSha256 $file.FullName
    if ($file.Length -ne $expectedSize -or $actualHash -ne $expectedHash) {
      throw "Installed artifact file does not match release manifest: $relativePath"
    }
    [void]$verified.Add([ordered]@{
      relativePath = Get-ReleaseEvidenceRelativePath $installedRoot $file.FullName
      path = $file.FullName
      sizeBytes = $file.Length
      sha256 = $actualHash
    })
  }
  return [pscustomobject]@{
    installedRoot = $installedRoot
    artifactManifestPath = $artifactManifestPath
    files = @($verified)
  }
}

function Assert-InstalledCudaPayload {
  param(
    [Parameter(Mandatory = $true)][string]$InstalledRoot,
    [Parameter(Mandatory = $true)][string]$PayloadManifestPath
  )

  $installedRoot = (Get-Item -LiteralPath (Resolve-ReleaseEvidenceDirectory $InstalledRoot 'Installed application root')).FullName
  $payloadManifestItem = Get-Item -LiteralPath (Resolve-ReleaseEvidenceFile $PayloadManifestPath 'CUDA payload manifest')
  $payloadManifestPath = $payloadManifestItem.FullName
  $manifestRelative = Get-ReleaseEvidenceRelativePath $installedRoot $payloadManifestPath
  if ($manifestRelative -eq '..' -or $manifestRelative.StartsWith("..$([System.IO.Path]::DirectorySeparatorChar)")) {
    throw 'CUDA payload manifest is outside the installed application root.'
  }
  $payloadRoot = $payloadManifestItem.Directory.FullName
  try {
    $manifest = Get-Content -LiteralPath $payloadManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "CUDA payload manifest is not valid JSON: $($_.Exception.Message)"
  }
  if ([int](Get-ObjectProperty $manifest 'schemaVersion' 'CUDA payload manifest') -ne 1) {
    throw 'CUDA payload manifest schemaVersion must be 1.'
  }
  if ([string](Get-ObjectProperty $manifest 'configuration' 'CUDA payload manifest') -ne 'release') {
    throw 'CUDA payload manifest configuration must be release.'
  }
  if ([int](Get-ObjectProperty $manifest 'workerProtocolVersion' 'CUDA payload manifest') -ne 1) {
    throw 'Installed worker protocol version is not 1.'
  }
  if ((Get-ObjectProperty $manifest 'driverLibraryBundled' 'CUDA payload manifest') -ne $false) {
    throw 'Installed payload manifest claims that the driver library is bundled.'
  }

  $allowed = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($name in $script:AllowedCudaPayloadFiles) { [void]$allowed.Add($name) }
  $manifestEntries = @((Get-ObjectProperty $manifest 'files' 'CUDA payload manifest'))
  if ($manifestEntries.Count -eq 0) { throw 'CUDA payload manifest contains no files.' }
  $manifestByName = @{}
  foreach ($entry in $manifestEntries) {
    $name = [string](Get-ObjectProperty $entry 'name' 'CUDA payload manifest entry')
    if (-not (Test-SimplePayloadFileName $name)) {
      throw "CUDA payload manifest file name is not a simple file name: $name"
    }
    $key = $name.ToLowerInvariant()
    if ($manifestByName.ContainsKey($key)) {
      throw "CUDA payload manifest contains duplicate file name: $name"
    }
    if (-not $allowed.Contains($name)) {
      throw "CUDA payload manifest contains unapproved file: $name"
    }
    $entryHash = [string](Get-ObjectProperty $entry 'sha256' "CUDA payload manifest entry $name")
    if ($entryHash -notmatch '^[0-9a-fA-F]{64}$') {
      throw "CUDA payload manifest SHA-256 is invalid for $name"
    }
    [void](Get-ObjectProperty $entry 'sizeBytes' "CUDA payload manifest entry $name")
    $manifestByName[$key] = $entry
  }
  foreach ($required in $script:AllowedCudaPayloadFiles) {
    if (-not $manifestByName.ContainsKey($required.ToLowerInvariant())) {
      throw "Required CUDA payload is absent from its manifest: $required"
    }
  }

  $allInstalledFiles = @(Get-ChildItem -LiteralPath $installedRoot -Recurse -File -ErrorAction Stop)
  $driverDlls = @($allInstalledFiles | Where-Object { $_.Name -ieq 'nvcuda.dll' })
  if ($driverDlls.Count -gt 0) {
    throw "Installed tree must not contain nvcuda.dll: $($driverDlls[0].FullName)"
  }

  $cudaOrDriverDlls = @($allInstalledFiles | Where-Object {
    $_.Extension -ieq '.dll' -and (Test-ReleaseEvidenceCudaOrDriverDllName $_.Name)
  })
  foreach ($dll in $cudaOrDriverDlls) {
    $relativeFromPayload = Get-ReleaseEvidenceRelativePath $payloadRoot $dll.FullName
    $outsidePayloadRoot = $relativeFromPayload -eq '..' -or $relativeFromPayload.StartsWith("..$([System.IO.Path]::DirectorySeparatorChar)")
    if ($outsidePayloadRoot) {
      throw "Installed tree contains unapproved CUDA/driver DLL outside the payload root: $($dll.FullName)"
    }
    if (-not $allowed.Contains($dll.Name)) {
      throw "Installed CUDA payload contains unapproved CUDA/driver DLL: $($dll.FullName)"
    }
    if ($relativeFromPayload -ne $dll.Name) {
      throw "Installed CUDA payload contains CUDA/driver DLL outside the manifest file set: $($dll.FullName)"
    }
  }

  $actualByName = @{}
  foreach ($file in @(Get-ChildItem -LiteralPath $payloadRoot -Recurse -File -ErrorAction Stop)) {
    $relativePath = Get-ReleaseEvidenceRelativePath $payloadRoot $file.FullName
    if (Test-ReleaseEvidencePayloadManifestRelativeIdentity $relativePath $payloadManifestItem.Name) { continue }
    $key = $relativePath.ToLowerInvariant()
    if ($relativePath -ne $file.Name -or $actualByName.ContainsKey($key)) {
      throw "Installed CUDA payload contains files absent from its manifest: $relativePath"
    }
    $actualByName[$key] = $file
  }
  $unmanifested = @($actualByName.Keys | Where-Object { -not $manifestByName.ContainsKey($_) })
  if ($unmanifested.Count -gt 0) {
    throw "Installed CUDA payload contains files absent from its manifest: $($unmanifested -join ', ')"
  }

  $validatedFiles = foreach ($required in $script:AllowedCudaPayloadFiles) {
    $key = $required.ToLowerInvariant()
    if (-not $actualByName.ContainsKey($key)) {
      throw "Installed CUDA payload file is missing: $required"
    }
    $file = $actualByName[$key]
    $entry = $manifestByName[$key]
    $actualHash = Get-ReleaseEvidenceSha256 $file.FullName
    if ([int64]$entry.sizeBytes -ne $file.Length -or $actualHash -ne ([string]$entry.sha256).ToLowerInvariant()) {
      throw "Installed CUDA payload does not match its manifest: $required"
    }
    [ordered]@{
      name = $file.Name
      path = $file.FullName
      sizeBytes = $file.Length
      sha256 = $actualHash
    }
  }

  return [pscustomobject]@{
    payloadRoot = $payloadRoot
    manifestPath = $payloadManifestPath
    workerProtocolVersion = [int]$manifest.workerProtocolVersion
    driverLibraryBundled = $false
    files = @($validatedFiles)
    workerPath = $actualByName['rain-whisper-cuda.exe'].FullName
  }
}

function Get-ReleaseEvidenceSecretFindings([AllowNull()][string]$Text) {
  if ([string]::IsNullOrEmpty($Text)) { return @() }
  $findings = @()
  if ($Text -match '(?i)\bsk-[A-Za-z0-9._-]+') { $findings += 'OpenAI-style key' }
  if ($Text -match '(?i)\b(?:AKIA|ASIA)[A-Z0-9]{16}\b') { $findings += 'AWS credential' }
  if ($Text -match '(?i)-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----') { $findings += 'PEM private key' }
  if ($Text -match '(?i)\b(?:Bearer|Basic)\s+(?!\[REDACTED\])[^\s"''\r\n]+') { $findings += 'authorization credential' }
  if ($Text -match '(?i)\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*([=:])\s*(?!\[REDACTED\])') { $findings += 'key-value secret' }
  if ($Text -match '(?i)"(?:api[_-]?key|apiKey|api[_-]?secret|apiSecret|access[_-]?token|accessToken|refresh[_-]?token|refreshToken|client[_-]?secret|clientSecret|password|secret)"\s*:\s*"(?!\[REDACTED\])[^\"]+"') { $findings += 'JSON quoted secret' }
  return @($findings | Select-Object -Unique)
}

function Protect-ReleaseEvidenceDiagnosticText([AllowNull()][string]$Value) {
  if ($null -eq $Value) { return '' }
  $protected = $Value
  $protected = [regex]::Replace($protected, '(?i)\bsk-[A-Za-z0-9._-]+', '[REDACTED]')
  $protected = [regex]::Replace($protected, '(?i)\b(?:AKIA|ASIA)[A-Z0-9]{16}\b', '[REDACTED]')
  $protected = [regex]::Replace($protected, '(?i)\b(Bearer|Basic)\s+(?!\[REDACTED\])[^\s"''\r\n]+', '$1 [REDACTED]')
  $protected = [regex]::Replace($protected, '(?i)\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*([=:])\s*(?:"[^"]*"|''[^'']*''|[^\s,;]+)', '$1$2[REDACTED]')
  $protected = [regex]::Replace($protected, '(?i)("(?:api[_-]?key|apiKey|token|password|secret)"\s*:\s*")[^"]*(")', '$1[REDACTED]$2')
  $protected = [regex]::Replace($protected, '(?i)\b(?:authorization|x-api-key)\s*:\s*(?!\[REDACTED\])[^\s,;]+', 'authorization: [REDACTED]')
  $protected = [regex]::Replace($protected, '(?i)https?://[^\s/@:]+:[^\s/@]+@', 'https://[REDACTED]@')
  $protected = [regex]::Replace($protected, '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', '[REDACTED_EMAIL]')
  return [regex]::Replace($protected, '(?i)(?:\\\\\\?\\)?[A-Z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\r\n]+', 'C:\\Users\\[REDACTED]')
}

function Test-ReleaseEvidenceSensitivePropertyName([string]$Name) {
  return $Name -match '(?i)^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|x-api-key)$'
}

function Protect-ReleaseEvidenceValue($Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [string]) { return Protect-ReleaseEvidenceDiagnosticText $Value }
  if ($Value -is [System.Collections.IDictionary]) {
    $protected = [ordered]@{}
    foreach ($key in $Value.Keys) {
      $protected[$key] = if (Test-ReleaseEvidenceSensitivePropertyName ([string]$key)) { '[REDACTED]' } else { Protect-ReleaseEvidenceValue $Value[$key] }
    }
    return $protected
  }
  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    $protected = [ordered]@{}
    foreach ($property in $Value.PSObject.Properties) {
      $protected[$property.Name] = if (Test-ReleaseEvidenceSensitivePropertyName $property.Name) { '[REDACTED]' } else { Protect-ReleaseEvidenceValue $property.Value }
    }
    return $protected
  }
  if ($Value -is [System.Collections.IEnumerable]) {
    $protectedItems = [System.Collections.Generic.List[object]]::new()
    foreach ($item in $Value) { [void]$protectedItems.Add((Protect-ReleaseEvidenceValue $item)) }
    return ,$protectedItems.ToArray()
  }
  return $Value
}

function Write-AtomicTextFile([string]$Path, [string]$Text) {
  $directory = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  $temporary = Join-Path $directory ('.' + [Guid]::NewGuid().ToString('N') + '.tmp')
  try {
    [System.IO.File]::WriteAllText($temporary, $Text, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}

function Write-AtomicJsonFile([string]$Path, $Value) {
  $json = ConvertTo-Json -InputObject (Protect-ReleaseEvidenceValue $Value) -Depth 100
  Write-AtomicTextFile $Path $json
}

function Get-ReleaseEvidenceSensitiveFindings([string]$Text) {
  $findings = @(Get-ReleaseEvidenceSecretFindings $Text)
  if ($Text -match '(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b') { $findings += 'email address' }
  if ($Text -match '(?i)(?:\\\\\\?\\)?[A-Z]:[\\/](?:Users|Documents and Settings)[\\/](?!\[REDACTED\])') { $findings += 'Windows user-profile path' }
  return @($findings | Select-Object -Unique)
}

function ConvertTo-ReleaseEvidenceWindowsCommandLineArgument([AllowNull()][string]$Value) {
  if ([string]::IsNullOrEmpty($Value)) { return '""' }
  if ($Value -notmatch '[\s"]') { return $Value }

  $builder = [System.Text.StringBuilder]::new()
  [void]$builder.Append('"')
  $backslashCount = 0
  foreach ($character in [char[]]$Value) {
    if ($character -eq [char]'\') {
      $backslashCount++
      continue
    }
    if ($character -eq [char]'"') {
      [void]$builder.Append('\', ($backslashCount * 2) + 1)
      [void]$builder.Append('"')
      $backslashCount = 0
      continue
    }
    if ($backslashCount -gt 0) {
      [void]$builder.Append('\', $backslashCount)
      $backslashCount = 0
    }
    [void]$builder.Append($character)
  }
  if ($backslashCount -gt 0) {
    [void]$builder.Append('\', $backslashCount * 2)
  }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Join-ReleaseEvidenceWindowsCommandLine {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  return (@($Arguments | ForEach-Object { ConvertTo-ReleaseEvidenceWindowsCommandLineArgument ([string]$_) }) -join ' ')
}

function Get-ReleaseEvidenceNsisInstallArguments {
  param([Parameter(Mandatory = $true)][string]$Destination)

  if ([string]::IsNullOrWhiteSpace($Destination)) {
    throw 'NSIS install destination must not be blank.'
  }
  if ($Destination.Contains('"')) {
    throw 'NSIS install destination must not contain a quotation mark.'
  }
  $fullDestination = [System.IO.Path]::GetFullPath($Destination)
  if (-not [System.IO.Path]::IsPathRooted($fullDestination)) {
    throw 'NSIS install destination must be an absolute path.'
  }

  # NSIS consumes the raw remainder of the command line after /D=, so this must remain last and unquoted.
  return @('/S', "/D=$fullDestination")
}

function Start-ReleaseEvidenceNsisInstaller {
  param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$Destination,
    [scriptblock]$ProcessAdapter = $null
  )

  $arguments = @(Get-ReleaseEvidenceNsisInstallArguments -Destination $Destination)
  if ($null -ne $ProcessAdapter) {
    return & $ProcessAdapter -FilePath $Installer -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  }
  return Start-Process -FilePath $Installer -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
}

function Get-ReleaseEvidenceNsisSystemSideEffectSnapshot {
  param([Parameter(Mandatory = $true)][string]$Phase, [Parameter(Mandatory = $true)][string]$InstallRoot)
  $registryEntries = [System.Collections.Generic.List[string]]::new()
  foreach ($registryRoot in @(
    'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )) {
    if (-not (Test-Path -LiteralPath $registryRoot)) { continue }
    foreach ($key in @(Get-ChildItem -LiteralPath $registryRoot -ErrorAction Stop)) {
      $properties = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
      $displayNameProperty = $properties.PSObject.Properties['DisplayName']
      $installLocationProperty = $properties.PSObject.Properties['InstallLocation']
      $displayName = if ($null -ne $displayNameProperty) { [string]$displayNameProperty.Value } else { '' }
      $installLocation = if ($null -ne $installLocationProperty) { [string]$installLocationProperty.Value } else { '' }
      $matchesInstallRoot = $false
      if (-not [string]::IsNullOrWhiteSpace($installLocation)) {
        try {
          $matchesInstallRoot = [string]::Equals([System.IO.Path]::GetFullPath($installLocation.Trim('"')), [System.IO.Path]::GetFullPath($InstallRoot), [System.StringComparison]::OrdinalIgnoreCase)
        } catch {
          $matchesInstallRoot = $false
        }
      }
      if ($displayName -match '(?i)^Rain(?:\s|$)' -or $matchesInstallRoot) {
        [void]$registryEntries.Add("$registryRoot/$($key.PSChildName)|$displayName|$installLocation")
      }
    }
  }
  $shortcuts = [System.Collections.Generic.List[string]]::new()
  foreach ($shortcutRoot in @(
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')
  )) {
    if (-not (Test-Path -LiteralPath $shortcutRoot -PathType Container)) { continue }
    foreach ($shortcut in @(Get-ChildItem -LiteralPath $shortcutRoot -Filter 'Rain*.lnk' -File -Recurse -ErrorAction Stop)) {
      [void]$shortcuts.Add($shortcut.FullName)
    }
  }
  return [ordered]@{ uninstallRegistryEntries = @($registryEntries | Sort-Object); shortcuts = @($shortcuts | Sort-Object) }
}

function Get-ReleaseEvidencePeMachine {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Description
  )

  $file = Resolve-ReleaseEvidenceFile $Path $Description
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

function Invoke-ReleaseEvidenceNsisInstallAndVerify {
  param(
    [Parameter(Mandatory = $true)][string]$Installer,
    [Parameter(Mandatory = $true)][string]$TemporaryRoot,
    [scriptblock]$ReserveInstallRoot = $null,
    [scriptblock]$RemoveInstallRoot = {
      param([string]$Path)
      if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop }
    },
    [scriptblock]$ProcessAdapter = $null,
    [scriptblock]$SystemSideEffectProbe = ${function:Get-ReleaseEvidenceNsisSystemSideEffectSnapshot}
  )

  $temporaryRoot = Resolve-ReleaseEvidenceDirectory $TemporaryRoot 'NSIS temporary root'
  $installRoot = Join-Path $temporaryRoot ('rain-nsis-installed-' + [Guid]::NewGuid().ToString('N'))
  if (Test-Path -LiteralPath $installRoot) {
    throw "Generated NSIS install root already exists: $installRoot"
  }
  if ($null -ne $ReserveInstallRoot) {
    & $ReserveInstallRoot $installRoot
  }

  $uninstallerPath = Join-Path $installRoot 'uninstall.exe'
  $systemSideEffectsBefore = & $SystemSideEffectProbe -Phase 'before-install' -InstallRoot $installRoot
  $installError = $null
  try {
    $process = Start-ReleaseEvidenceNsisInstaller -Installer $Installer -Destination $installRoot -ProcessAdapter $ProcessAdapter
    if ($null -eq $process -or $null -eq $process.PSObject.Properties['ExitCode']) {
      throw 'NSIS installer did not return an exit code.'
    }
    if ([int]$process.ExitCode -ne 0) {
      throw "NSIS installer failed with exit code $($process.ExitCode)."
    }
    if (-not (Test-Path -LiteralPath $installRoot -PathType Container)) {
      throw "NSIS installer did not create its requested install root: $installRoot"
    }

    $verifiedFiles = @{}
    foreach ($required in @(
      [ordered]@{ name = 'rain.exe'; description = 'Rain main executable' },
      [ordered]@{ name = 'payload-manifest.json'; description = 'CUDA payload manifest' }
    )) {
      $matches = @(Get-ChildItem -LiteralPath $installRoot -Filter ([string]$required.name) -File -Recurse -ErrorAction Stop)
      if ($matches.Count -ne 1) {
        throw "Expected exactly one $($required.description) after NSIS installation, found $($matches.Count)."
      }
      $verifiedFiles[[string]$required.name] = $matches[0].FullName
    }

    $mainExecutableMachine = Get-ReleaseEvidencePeMachine -Path $verifiedFiles['rain.exe'] -Description 'Installed Rain main executable'
    if ($mainExecutableMachine -ne 0x8664) {
      throw 'Installed Rain main executable must be an AMD64 PE artifact.'
    }
    if (-not (Test-Path -LiteralPath $uninstallerPath -PathType Leaf)) {
      throw "Expected the generated NSIS uninstaller after installation: $uninstallerPath"
    }
    return [pscustomobject]@{
      kind = 'rain-nsis-install-proof-v1'
      schemaVersion = 1
      installerPath = $Installer
      installerSha256 = if (Test-Path -LiteralPath $Installer -PathType Leaf) { Get-ReleaseEvidenceSha256 $Installer } else { '' }
      installRoot = $installRoot
      mainExecutable = $verifiedFiles['rain.exe']
      mainExecutableMachine = $mainExecutableMachine
      payloadManifestPath = $verifiedFiles['payload-manifest.json']
      uninstallerPath = $uninstallerPath
      systemSideEffectsBefore = $systemSideEffectsBefore
      silentInstall = [ordered]@{
        arguments = @(Get-ReleaseEvidenceNsisInstallArguments -Destination $installRoot)
        waited = $true
        exitCode = [int]$process.ExitCode
      }
      process = $process
    }
  } catch {
    $installError = $_
  }

  $cleanupErrors = [System.Collections.Generic.List[string]]::new()
  if (Test-Path -LiteralPath $uninstallerPath -PathType Leaf) {
    try {
      Invoke-ReleaseEvidenceNsisUninstallAndVerify -Installation ([pscustomobject]@{
        installRoot = $installRoot
        uninstallerPath = $uninstallerPath
        systemSideEffectsBefore = $systemSideEffectsBefore
      }) -ProcessAdapter $ProcessAdapter -SystemSideEffectProbe $SystemSideEffectProbe | Out-Null
    } catch {
      [void]$cleanupErrors.Add("generated uninstaller cleanup failed: $($_.Exception.Message)")
    }
  }
  if (Test-Path -LiteralPath $installRoot) {
    try {
      & $RemoveInstallRoot $installRoot
    } catch {
      [void]$cleanupErrors.Add("residual install-root cleanup failed: $($_.Exception.Message)")
    }
  }
  if ($cleanupErrors.Count -gt 0) {
    throw "NSIS installation validation failed: $($installError.Exception.Message); additionally, $($cleanupErrors -join '; ')"
  }
  throw $installError
}

function Start-ReleaseEvidenceNsisUninstaller {
  param(
    [Parameter(Mandatory = $true)][string]$Uninstaller,
    [scriptblock]$ProcessAdapter = $null
  )

  $uninstaller = Resolve-ReleaseEvidenceFile $Uninstaller 'Generated NSIS uninstaller'
  $arguments = @('/S')
  if ($null -ne $ProcessAdapter) {
    return & $ProcessAdapter -FilePath $uninstaller -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
  }
  return Start-Process -FilePath $uninstaller -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
}

function Invoke-ReleaseEvidenceNsisUninstallAndVerify {
  param(
    [Parameter(Mandatory = $true)]$Installation,
    [scriptblock]$ProcessAdapter = $null,
    [scriptblock]$SystemSideEffectProbe = ${function:Get-ReleaseEvidenceNsisSystemSideEffectSnapshot},
    [switch]$CleanupInstallRoot,
    [scriptblock]$RemoveInstallRoot = {
      param([string]$Path)
      if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
      }
    }
  )

  $installRoot = Resolve-ReleaseEvidenceDirectory ([string](Get-ObjectProperty $Installation 'installRoot' 'NSIS installation')) 'NSIS installation root'
  $declaredUninstaller = [string](Get-ObjectProperty $Installation 'uninstallerPath' 'NSIS installation')
  $expectedUninstaller = Join-Path $installRoot 'uninstall.exe'
  if (-not [string]::Equals(
      [System.IO.Path]::GetFullPath($declaredUninstaller),
      [System.IO.Path]::GetFullPath($expectedUninstaller),
      [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'NSIS installation proof does not bind the generated uninstaller to the install root.'
  }

  $failures = [System.Collections.Generic.List[string]]::new()
  $process = $null
  try {
    $process = Start-ReleaseEvidenceNsisUninstaller -Uninstaller $expectedUninstaller -ProcessAdapter $ProcessAdapter
    if ($null -eq $process -or $null -eq $process.PSObject.Properties['ExitCode']) {
      throw 'NSIS uninstaller did not return an exit code.'
    }
    if ([int]$process.ExitCode -ne 0) {
      throw "NSIS uninstaller failed with exit code $($process.ExitCode)."
    }
  } catch {
    [void]$failures.Add($_.Exception.Message)
  }

  try {
    $residualProgramPayload = @()
    if (Test-Path -LiteralPath $installRoot -PathType Container) {
      $residualProgramPayload = @(
        Get-ChildItem -LiteralPath $installRoot -File -Recurse -Force -ErrorAction Stop
      )
    }
    if ($residualProgramPayload.Count -ne 0) {
      throw "NSIS uninstaller left program payload in the disposable install root: $($residualProgramPayload.FullName -join ', ')"
    }
  } catch {
    [void]$failures.Add($_.Exception.Message)
  }

  if ($Installation.PSObject.Properties.Name -contains 'systemSideEffectsBefore') {
    try {
      $systemSideEffectsAfter = & $SystemSideEffectProbe -Phase 'after-uninstall' -InstallRoot $installRoot
      $beforeJson = ConvertTo-Json -InputObject $Installation.systemSideEffectsBefore -Depth 20 -Compress
      $afterJson = ConvertTo-Json -InputObject $systemSideEffectsAfter -Depth 20 -Compress
      if ($beforeJson -ne $afterJson) {
        throw 'NSIS uninstaller did not restore the observable system-side-effect snapshot.'
      }
    } catch {
      [void]$failures.Add($_.Exception.Message)
    }
  }

  if ($CleanupInstallRoot) {
    try {
      & $RemoveInstallRoot $installRoot
    } catch {
      [void]$failures.Add("Disposable install-root cleanup failed: $($_.Exception.Message)")
    }
  }
  if ($failures.Count -gt 0) {
    throw "NSIS uninstaller verification failed: $($failures -join '; additionally, ')"
  }

  return [pscustomobject]@{
    installRoot = $installRoot
    uninstallerPath = $expectedUninstaller
    process = $process
    programPayloadRemoved = $true
    residualInstallRoot = Test-Path -LiteralPath $installRoot -PathType Container
  }
}

function Assert-ReleaseEvidenceMainExecutableImports {
  param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$ImportText)

  $importNames = @(
    [regex]::Matches($ImportText, '(?i)\b[A-Za-z0-9._-]+\.dll\b') |
      ForEach-Object { $_.Value.ToLowerInvariant() } |
      Select-Object -Unique
  )
  $forbiddenImports = @($importNames | Where-Object { Test-ReleaseEvidenceCudaOrDriverDllName ([string]$_) })
  if ($forbiddenImports.Count -gt 0) {
    throw "Rain main executable imports CUDA/driver libraries: $($forbiddenImports -join ', ')"
  }
  return @($importNames)
}

function Assert-PeImportInspectionResult {
  param(
    [Parameter(Mandatory = $true)][string]$ToolName,
    [Parameter(Mandatory = $true)][int]$ExitCode,
    [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Output
  )

  if ($ExitCode -ne 0) {
    throw "PE import inspection tool $ToolName failed with exit code $ExitCode."
  }
  if ([string]::IsNullOrWhiteSpace($Output)) {
    throw "PE import inspection tool $ToolName produced no recognizable import output."
  }
  if ($Output -notmatch '(?im)\b(?:import table|imports?|dll name)\b') {
    throw "PE import inspection tool $ToolName produced no recognizable import output."
  }
  return $Output
}

function Assert-ReleaseEvidenceInstallDirectory {
  param([Parameter(Mandatory = $true)][string]$InstallDir)

  if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    throw 'InstallDir must be explicitly provided for ownership validation.'
  }
  $fullPath = [System.IO.Path]::GetFullPath($InstallDir)
  if (Test-Path -LiteralPath $fullPath) {
    if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) {
      throw "InstallDir is not a directory: $fullPath"
    }
    if (@(Get-ChildItem -LiteralPath $fullPath -Force).Count -gt 0) {
      throw "Custom InstallDir must not contain existing files: $fullPath"
    }
    return [pscustomobject]@{ path = $fullPath; mode = 'custom-empty'; existedBeforeRun = $true }
  }
  $parent = Split-Path -Parent $fullPath
  if ([string]::IsNullOrWhiteSpace($parent) -or -not (Test-Path -LiteralPath $parent -PathType Container)) {
    throw "InstallDir parent directory does not exist: $parent"
  }
  return [pscustomobject]@{ path = $fullPath; mode = 'custom-new'; existedBeforeRun = $false }
}

function Protect-ReleaseEvidenceLogFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  Write-AtomicTextFile $Path (Protect-ReleaseEvidenceDiagnosticText (Get-Content -LiteralPath $Path -Raw))
}

function Assert-ReleaseEvidenceTreeRedacted([string]$RunRoot) {
  $root = Resolve-ReleaseEvidenceDirectory $RunRoot 'Evidence run root'
  $findings = @()
  foreach ($file in @(Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction Stop | Where-Object { $_.Extension -in @('.json', '.log', '.err', '.txt') })) {
    $matches = @(Get-ReleaseEvidenceSensitiveFindings (Get-Content -LiteralPath $file.FullName -Raw))
    if ($matches.Count -gt 0) { $findings += "$($file.Name): $($matches -join ', ')" }
  }
  if ($findings.Count -gt 0) {
    throw "Evidence redaction scanner found sensitive content: $($findings -join '; ')"
  }
}

function New-ReleaseEvidenceWriter {
  param(
    [Parameter(Mandatory = $true)][string]$RunRoot,
    [Parameter(Mandatory = $true)][string]$EvidenceId,
    [Parameter(Mandatory = $true)][string]$ExpectedTargetCommit,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedInstallerSha256,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedArtifactManifestSha256,
    [string[]]$RequiredPhases = @()
  )

  $normalizedRequiredPhases = @($RequiredPhases | ForEach-Object { [string]$_ })
  if (@($normalizedRequiredPhases | Where-Object { $_ -notmatch '^[a-z0-9][a-z0-9-]*$' }).Count -gt 0) {
    throw 'Required evidence phases must use lowercase dash-separated names.'
  }
  if (@($normalizedRequiredPhases | Select-Object -Unique).Count -ne $normalizedRequiredPhases.Count) {
    throw 'Required evidence phases must be unique.'
  }

  if (-not (Test-Path -LiteralPath $RunRoot -PathType Container)) {
    New-Item -ItemType Directory -Path $RunRoot -Force | Out-Null
  }
  $root = (Resolve-Path -LiteralPath $RunRoot).Path
  $phaseDirectory = Join-Path $root 'phases'
  New-Item -ItemType Directory -Path $phaseDirectory -Force | Out-Null
  $writer = [pscustomobject]@{
    RunRoot = $root
    EvidenceId = $EvidenceId
    ExpectedTargetCommit = $ExpectedTargetCommit.ToLowerInvariant()
    ExpectedInstallerSha256 = $ExpectedInstallerSha256.ToLowerInvariant()
    ExpectedArtifactManifestSha256 = $ExpectedArtifactManifestSha256.ToLowerInvariant()
    RequiredPhases = @($normalizedRequiredPhases)
    PartialManifestPath = Join-Path $root 'partial-manifest.json'
    ManifestPath = Join-Path $root 'manifest.json'
    PhaseDirectory = $phaseDirectory
  }
  Write-AtomicJsonFile $writer.PartialManifestPath ([ordered]@{
    schemaVersion = 1
    evidenceId = $writer.EvidenceId
    expectedTargetCommit = $writer.ExpectedTargetCommit
    expectedInstallerSha256 = $writer.ExpectedInstallerSha256
    expectedArtifactManifestSha256 = $writer.ExpectedArtifactManifestSha256
    requiredPhases = @($writer.RequiredPhases)
    result = 'running'
    phase = 'bootstrap'
    phases = @()
    generatedAt = [DateTimeOffset]::Now.ToString('o')
    updatedAt = [DateTimeOffset]::Now.ToString('o')
  })
  return $writer
}

function Read-ReleaseEvidencePartial($Writer) {
  return Get-Content -LiteralPath $Writer.PartialManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-ReleaseEvidencePhaseRecords($Partial) {
  $property = $Partial.PSObject.Properties['phases']
  if ($null -eq $property -or $null -eq $property.Value) { return @() }
  $value = $property.Value
  if ($value -is [System.Management.Automation.PSCustomObject] -and $value.PSObject.Properties.Count -eq 0) {
    return @()
  }
  return @($value)
}

function Write-ReleaseEvidencePhase {
  param(
    [Parameter(Mandatory = $true)]$Writer,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9-]*$')][string]$Phase,
    [Parameter(Mandatory = $true)][ValidateSet('passed', 'failed')][string]$Result,
    $Data = @{},
    [switch]$ReplaceExisting
  )

  $relativePath = "phases/$Phase.json"
  $phasePath = Join-Path $Writer.RunRoot $relativePath
  $partial = Read-ReleaseEvidencePartial $Writer
  $samePhase = @((Get-ReleaseEvidencePhaseRecords $partial) | Where-Object { $null -ne $_ -and $_.phase -eq $Phase })
  if ($samePhase.Count -gt 0 -and -not $ReplaceExisting) {
    throw "Evidence phase was already recorded: $Phase"
  }
  $record = [ordered]@{
    schemaVersion = 1
    phase = $Phase
    result = $Result
    data = $Data
    recordedAt = [DateTimeOffset]::Now.ToString('o')
  }
  Write-AtomicJsonFile $phasePath $record
  $existing = @()
  foreach ($existingPhase in @(Get-ReleaseEvidencePhaseRecords $partial)) {
    if ($null -ne $existingPhase -and $existingPhase.phase -ne $Phase) {
      $existing += $existingPhase
    }
  }
  $partial.phases = @($existing + [pscustomobject]@{
    phase = $Phase
    result = $Result
    artifact = $relativePath
    recordedAt = $record.recordedAt
  })
  $partial.phase = $Phase
  $partial.result = if ($Result -eq 'failed') { 'failed' } else { 'running' }
  $partial.updatedAt = [DateTimeOffset]::Now.ToString('o')
  Write-AtomicJsonFile $Writer.PartialManifestPath $partial
  return [pscustomobject]@{ path = $phasePath; relativePath = $relativePath; result = $Result }
}

function Write-ReleaseEvidenceFailureManifest {
  param(
    [Parameter(Mandatory = $true)]$Writer,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9-]*$')][string]$Phase,
    [Parameter(Mandatory = $true)][string]$ErrorText,
    $Facts = @{}
  )

  Write-ReleaseEvidencePhase -Writer $Writer -Phase $Phase -Result 'failed' -Data @{ error = $ErrorText } -ReplaceExisting | Out-Null
  $partial = Read-ReleaseEvidencePartial $Writer
  Write-AtomicJsonFile $Writer.ManifestPath ([ordered]@{
    schemaVersion = 1
    evidenceId = $Writer.EvidenceId
    expectedTargetCommit = $Writer.ExpectedTargetCommit
    expectedInstallerSha256 = $Writer.ExpectedInstallerSha256
    expectedArtifactManifestSha256 = $Writer.ExpectedArtifactManifestSha256
    phase = $Phase
    result = 'failed'
    partialManifest = 'partial-manifest.json'
    phases = @(Get-ReleaseEvidencePhaseRecords $partial)
    facts = $Facts
    error = $ErrorText
    generatedAt = [DateTimeOffset]::Now.ToString('o')
  })
  return $Writer.ManifestPath
}

function Assert-ReleaseEvidenceSuccessPhases {
  param(
    [Parameter(Mandatory = $true)]$Writer,
    [Parameter(Mandatory = $true)]$Partial
  )

  $required = @($Writer.RequiredPhases | ForEach-Object { [string]$_ })
  if ($required.Count -eq 0) {
    throw 'Evidence success requires an explicit complete phase contract.'
  }
  $records = @(Get-ReleaseEvidencePhaseRecords $Partial)
  $phaseNames = @($records | ForEach-Object { [string]$_.phase })
  if (@($phaseNames | Select-Object -Unique).Count -ne $phaseNames.Count) {
    throw 'Evidence success contains duplicate phase records.'
  }
  $nonPassed = @($records | Where-Object { $_.result -ne 'passed' } | ForEach-Object { [string]$_.phase })
  if ($nonPassed.Count -gt 0) {
    throw "Evidence success requires every phase to pass: $($nonPassed -join ', ')"
  }
  $missing = @($required | Where-Object { $_ -notin $phaseNames })
  if ($missing.Count -gt 0) {
    throw "Evidence success is missing required phases: $($missing -join ', ')"
  }
  $extra = @($phaseNames | Where-Object { $_ -notin $required })
  if ($extra.Count -gt 0) {
    throw "Evidence success contains unexpected phases: $($extra -join ', ')"
  }
  for ($index = 0; $index -lt $required.Count; $index++) {
    if ($phaseNames[$index] -ne $required[$index]) {
      throw 'Evidence success phases are out of order.'
    }
  }
}

function Write-ReleaseEvidenceSuccessManifest {
  param(
    [Parameter(Mandatory = $true)]$Writer,
    [Parameter(Mandatory = $true)]$Facts
  )

  $partial = Read-ReleaseEvidencePartial $Writer
  Assert-ReleaseEvidenceSuccessPhases -Writer $Writer -Partial $partial
  $partial.result = 'passed'
  $partial.updatedAt = [DateTimeOffset]::Now.ToString('o')
  Write-AtomicJsonFile $Writer.PartialManifestPath $partial
  Write-AtomicJsonFile $Writer.ManifestPath ([ordered]@{
    schemaVersion = 1
    evidenceId = $Writer.EvidenceId
    expectedTargetCommit = $Writer.ExpectedTargetCommit
    expectedInstallerSha256 = $Writer.ExpectedInstallerSha256
    expectedArtifactManifestSha256 = $Writer.ExpectedArtifactManifestSha256
    result = 'passed'
    partialManifest = 'partial-manifest.json'
    phases = @(Get-ReleaseEvidencePhaseRecords $partial)
    facts = $Facts
    generatedAt = [DateTimeOffset]::Now.ToString('o')
  })
  return $Writer.ManifestPath
}

Export-ModuleMember -Function @(
  'Get-ReleaseEvidenceSha256',
  'Get-ReleaseEvidenceSecretFindings',
  'Test-ReleaseEvidenceCudaOrDriverDllName',
  'Assert-ReleaseEvidenceControlToolingCheckout',
  'Test-ReleaseEvidencePayloadManifestRelativeIdentity',
  'Assert-CandidateArtifactProvenance',
  'Assert-InstalledArtifactManifest',
  'Assert-InstalledCudaPayload',
  'Protect-ReleaseEvidenceDiagnosticText',
  'Protect-ReleaseEvidenceLogFile',
  'Assert-ReleaseEvidenceTreeRedacted',
  'Join-ReleaseEvidenceWindowsCommandLine',
  'Get-ReleaseEvidenceNsisInstallArguments',
  'Start-ReleaseEvidenceNsisInstaller',
  'Invoke-ReleaseEvidenceNsisInstallAndVerify',
  'Start-ReleaseEvidenceNsisUninstaller',
  'Invoke-ReleaseEvidenceNsisUninstallAndVerify',
  'Assert-ReleaseEvidenceMainExecutableImports',
  'Assert-ReleaseEvidenceCancellationFixture',
  'Invoke-WithReleaseEvidenceCancellationFixture',
  'Assert-ReleaseEvidenceCancellationTiming',
  'Start-ReleaseEvidenceSessionWorkerObserver',
  'Start-ReleaseEvidenceWorkerObservationWindow',
  'Complete-ReleaseEvidenceWorkerObservationWindow',
  'Stop-ReleaseEvidenceSessionWorkerObserver',
  'Assert-ReleaseEvidenceRuntimeAdapterReadiness',
  'Assert-ReleaseEvidenceProcessEventJobState',
  'Invoke-ReleaseEvidenceProcessSubscriptionCleanup',
  'Assert-PeImportInspectionResult',
  'Assert-ReleaseEvidenceInstallDirectory',
  'New-ReleaseEvidenceWriter',
  'Write-ReleaseEvidencePhase',
  'Write-ReleaseEvidenceFailureManifest',
  'Write-ReleaseEvidenceSuccessManifest',
  'Write-AtomicJsonFile'
)
