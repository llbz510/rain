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
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
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

function Assert-CandidateArtifactProvenance {
  param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedTargetCommit,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedInstallerSha256,
    [Parameter(Mandatory = $true)][string]$ArtifactManifestPath,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedArtifactManifestSha256
  )

  $installer = Resolve-ReleaseEvidenceFile $InstallerPath 'Installer'
  $artifactManifest = Resolve-ReleaseEvidenceFile $ArtifactManifestPath 'Artifact manifest'
  $artifactManifestHash = Get-ReleaseEvidenceSha256 $artifactManifest
  if ($artifactManifestHash -ne $ExpectedArtifactManifestSha256.ToLowerInvariant()) {
    throw 'Artifact manifest SHA-256 does not match the expected controlled-build record.'
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

  $mainExecutable = Get-ObjectProperty $manifest 'mainExecutable' 'Artifact manifest'
  $mainExecutablePath = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $mainExecutable 'path' 'Artifact manifest mainExecutable')) 'Artifact manifest mainExecutable.path'
  $mainExecutableHash = Assert-ReleaseEvidenceManifestSha256 ([string](Get-ObjectProperty $mainExecutable 'sha256' 'Artifact manifest mainExecutable')) 'Artifact manifest mainExecutable.sha256'
  if ((Get-ObjectProperty $mainExecutable 'cudaImportsPresent' 'Artifact manifest mainExecutable') -ne $false) {
    throw 'Artifact manifest mainExecutable.cudaImportsPresent must be false.'
  }

  $resources = Get-ObjectProperty $manifest 'resources' 'Artifact manifest'
  $cudaWorker = Get-ObjectProperty $resources 'cudaWorker' 'Artifact manifest resources'
  $cudaWorkerPath = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $cudaWorker 'path' 'Artifact manifest CUDA worker')) 'Artifact manifest CUDA worker.path'
  $cudaWorkerHash = Assert-ReleaseEvidenceManifestSha256 ([string](Get-ObjectProperty $cudaWorker 'sha256' 'Artifact manifest CUDA worker')) 'Artifact manifest CUDA worker.sha256'
  if ([int](Get-ObjectProperty $cudaWorker 'protocolVersion' 'Artifact manifest CUDA worker') -ne 1) {
    throw 'Artifact manifest CUDA worker protocolVersion must be 1.'
  }

  $cudaRuntime = Get-ObjectProperty $resources 'cudaRuntime' 'Artifact manifest resources'
  $cudaRuntimeFiles = @((Get-ObjectProperty $cudaRuntime 'files' 'Artifact manifest CUDA runtime'))
  if ($cudaRuntimeFiles.Count -eq 0) {
    throw 'Artifact manifest CUDA runtime files must not be empty.'
  }
  foreach ($runtimeFile in $cudaRuntimeFiles) {
    [void](Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $runtimeFile 'name' 'Artifact manifest CUDA runtime file')) 'Artifact manifest CUDA runtime file.name')
    [void](Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $runtimeFile 'path' 'Artifact manifest CUDA runtime file')) 'Artifact manifest CUDA runtime file.path')
    [void](Get-ObjectProperty $runtimeFile 'sizeBytes' 'Artifact manifest CUDA runtime file')
    [void](Assert-ReleaseEvidenceManifestSha256 ([string](Get-ObjectProperty $runtimeFile 'sha256' 'Artifact manifest CUDA runtime file')) 'Artifact manifest CUDA runtime file.sha256')
  }
  if ((Get-ObjectProperty $cudaRuntime 'driverLibraryBundled' 'Artifact manifest CUDA runtime') -ne $false) {
    throw 'Artifact manifest CUDA runtime driverLibraryBundled must be false.'
  }
  [void](Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $cudaRuntime 'distributionApproval' 'Artifact manifest CUDA runtime')) 'Artifact manifest CUDA runtime distributionApproval')

  [void](Get-ObjectProperty $manifest 'forbiddenFindings' 'Artifact manifest')
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
  $controlledTargetCommit = [string](Get-ObjectProperty $controlledBuild 'targetCommit' 'Controlled-build record')
  if ($controlledTargetCommit -notmatch '^[0-9a-fA-F]{40}$' -or $controlledTargetCommit.ToLowerInvariant() -ne $ExpectedTargetCommit.ToLowerInvariant()) {
    throw 'Controlled-build record target commit does not match the expected target commit.'
  }
  if ((Get-ObjectProperty $controlledBuild 'cleanTree' 'Controlled-build record') -ne $true) {
    throw 'Controlled-build record cleanTree must be true.'
  }
  $generator = Get-ObjectProperty $controlledBuild 'generator' 'Controlled-build record'
  $generatorId = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $generator 'id' 'Controlled-build generator')) 'Controlled-build generator identity'
  $generatorVersion = Assert-ReleaseEvidenceManifestNonBlankString ([string](Get-ObjectProperty $generator 'version' 'Controlled-build generator')) 'Controlled-build generator version'
  $buildMetadata = Get-ObjectProperty $controlledBuild 'buildMetadata' 'Controlled-build record'
  $buildRecordId = [string](Get-ObjectProperty $buildMetadata 'buildRecordId' 'Controlled-build metadata')
  $builtAt = [string](Get-ObjectProperty $buildMetadata 'builtAt' 'Controlled-build metadata')
  $parsedBuiltAt = [DateTimeOffset]::MinValue
  if ([string]::IsNullOrWhiteSpace($buildRecordId) -or -not [DateTimeOffset]::TryParse($builtAt, [ref]$parsedBuiltAt)) {
    throw 'Controlled-build metadata must contain a build record id and ISO-8601 timestamp.'
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

  return [pscustomobject]@{
    targetCommit = $targetCommit.ToLowerInvariant()
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
      mainExecutable = [ordered]@{ path = $mainExecutablePath; sha256 = $mainExecutableHash; cudaImportsPresent = $false }
      resources = [ordered]@{
        cudaWorker = [ordered]@{ path = $cudaWorkerPath; sha256 = $cudaWorkerHash; protocolVersion = 1 }
        cudaRuntime = [ordered]@{ fileCount = $cudaRuntimeFiles.Count; driverLibraryBundled = $false }
      }
      generatedAt = $parsedGeneratedAt.ToString('o')
      generator = [ordered]@{ id = $artifactGeneratorId; version = $artifactGeneratorVersion }
      controlledBuild = [ordered]@{
        sourceRepository = $sourceRepository
        targetCommit = $controlledTargetCommit.ToLowerInvariant()
        cleanTree = $true
        generator = [ordered]@{ id = $generatorId; version = $generatorVersion }
        buildMetadata = [ordered]@{ buildRecordId = $buildRecordId; builtAt = $parsedBuiltAt.ToString('o') }
      }
    }
  }
}

function Assert-InstalledCudaPayload {
  param(
    [Parameter(Mandatory = $true)][string]$InstalledRoot,
    [Parameter(Mandatory = $true)][string]$PayloadManifestPath
  )

  $installedRoot = Resolve-ReleaseEvidenceDirectory $InstalledRoot 'Installed application root'
  $payloadManifestPath = Resolve-ReleaseEvidenceFile $PayloadManifestPath 'CUDA payload manifest'
  $manifestRelative = Get-ReleaseEvidenceRelativePath $installedRoot $payloadManifestPath
  if ($manifestRelative -eq '..' -or $manifestRelative.StartsWith("..$([System.IO.Path]::DirectorySeparatorChar)")) {
    throw 'CUDA payload manifest is outside the installed application root.'
  }
  $payloadRoot = Split-Path -Parent $payloadManifestPath
  try {
    $manifest = Get-Content -LiteralPath $payloadManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "CUDA payload manifest is not valid JSON: $($_.Exception.Message)"
  }
  if ([int](Get-ObjectProperty $manifest 'schemaVersion' 'CUDA payload manifest') -ne 1) {
    throw 'CUDA payload manifest schemaVersion must be 1.'
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
    if ($file.FullName -eq $payloadManifestPath) { continue }
    $relativePath = Get-ReleaseEvidenceRelativePath $payloadRoot $file.FullName
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

function Protect-ReleaseEvidenceDiagnosticText([AllowNull()][string]$Value) {
  if ($null -eq $Value) { return '' }
  $protected = $Value
  $protected = [regex]::Replace($protected, '(?i)\bsk-[A-Za-z0-9._-]+', '[REDACTED]')
  $protected = [regex]::Replace($protected, '(?i)\b(?:AKIA|ASIA)[A-Z0-9]{16}\b', '[REDACTED]')
  $protected = [regex]::Replace($protected, '(?i)\b(Bearer|Basic)\s+(?!\[REDACTED\])[^\s"''`r`n]+', '$1 [REDACTED]')
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
  $findings = @()
  if ($Text -match '(?i)\bsk-[A-Za-z0-9._-]+') { $findings += 'OpenAI-style key' }
  if ($Text -match '(?i)\b(?:AKIA|ASIA)[A-Z0-9]{16}\b') { $findings += 'AWS credential' }
  if ($Text -match '(?i)\b(?:Bearer|Basic)\s+(?!\[REDACTED\])[^\s"''`r`n]+') { $findings += 'authorization credential' }
  if ($Text -match '(?i)\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*([=:])\s*(?!\[REDACTED\])') { $findings += 'key-value secret' }
  if ($Text -match '(?i)"(?:api[_-]?key|apiKey|access[_-]?token|refresh[_-]?token|password|secret)"\s*:\s*"(?!\[REDACTED\])[^\"]+"') { $findings += 'JSON quoted secret' }
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
    $matches = Get-ReleaseEvidenceSensitiveFindings (Get-Content -LiteralPath $file.FullName -Raw)
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
  'Assert-CandidateArtifactProvenance',
  'Assert-InstalledCudaPayload',
  'Protect-ReleaseEvidenceDiagnosticText',
  'Protect-ReleaseEvidenceLogFile',
  'Assert-ReleaseEvidenceTreeRedacted',
  'Join-ReleaseEvidenceWindowsCommandLine',
  'Get-ReleaseEvidenceNsisInstallArguments',
  'Start-ReleaseEvidenceNsisInstaller',
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
