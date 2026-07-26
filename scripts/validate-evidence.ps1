param(
  [Parameter(Mandatory=$true)]
  [string]$EvidenceManifest,
  [string]$ExpectedVideoSha256 = '3870B5BD62E574685AC99A8E44295F5E44AC44B76343666742C1C4CA48365F8A',
  [ValidateSet('cpu', 'cuda', '')]
  [string]$ExpectedWhisperBackend = ''
)

$ErrorActionPreference = 'Stop'
$expectedQwenBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
$expectedQwenModel = 'qwen3.5-omni-flash'

function Require-Value($Value, [string]$Message) {
  if ($null -eq $Value -or ($Value -is [string] -and [string]::IsNullOrWhiteSpace($Value))) { throw $Message }
}

function Read-JsonArtifact([string]$Path) {
  Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Resolve-ArtifactPath([string]$Artifact, [string]$Message) {
  Require-Value $Artifact $Message
  if ([System.IO.Path]::IsPathRooted($Artifact)) { throw "artifact path must be relative: $Artifact" }
  $root = [System.IO.Path]::GetFullPath($script:evidenceDir)
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $root $Artifact))
  $rootWithSeparator = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if ($candidate -ne $root -and -not $candidate.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "artifact escapes evidence directory: $Artifact"
  }
  if (-not (Test-Path -LiteralPath $candidate)) { throw "artifact not found: $Artifact" }
  return $candidate
}

function Assert-PositiveNumber($Value, [string]$Message) {
  if ($null -eq $Value) { throw $Message }
  $number = [double]$Value
  if ($number -le 0) { throw $Message }
}

function Assert-NoMojibake([string]$Text, [string]$Message) {
  if ($Text -match '(\uFFFD|\u951f\u65a4\u62f7|\p{Co}|銆愬|涓|鎶€|淇″|鍙婂|鏀惧|杩欎|绔犲|疄闄|笂鏄|妯″|绠＄)') { throw $Message }
}

function Assert-VideoProof($Video) {
  Require-Value $Video.path 'missing video.path'
  Require-Value $Video.sha256 'missing video.sha256'
  Assert-NoMojibake ([string]$Video.path) 'mojibake video path detected'
  if (-not (Test-Path -LiteralPath ([string]$Video.path))) { throw "video path not found: $($Video.path)" }
  $actual = (Get-FileHash -LiteralPath ([string]$Video.path) -Algorithm SHA256).Hash.ToUpperInvariant()
  if ([string]$Video.sha256 -ne $actual) { throw "manifest video hash does not match file: manifest=$($Video.sha256) actual=$actual" }
  if ($actual -ne $ExpectedVideoSha256.ToUpperInvariant()) { throw 'unexpected input video hash' }
}

function Assert-Runtime($Runtime, [int]$SchemaVersion) {
  if ($SchemaVersion -eq 1) {
    if ([string]$Runtime.qwenModel -ne $expectedQwenModel) { throw "unexpected qwen model: $($Runtime.qwenModel)" }
    if ([string]$Runtime.qwenBaseUrl -ne $expectedQwenBaseUrl) { throw "unexpected qwen base url: $($Runtime.qwenBaseUrl)" }
  } else {
    Require-Value $Runtime.llmModel 'missing runtime.llmModel'
    Require-Value $Runtime.llmBaseUrl 'missing runtime.llmBaseUrl'
    $uri = $null
    if (-not [System.Uri]::TryCreate([string]$Runtime.llmBaseUrl, [System.UriKind]::Absolute, [ref]$uri)) {
      throw "invalid runtime.llmBaseUrl: $($Runtime.llmBaseUrl)"
    }
    if ($uri.Scheme -notin @('http', 'https')) { throw "unsupported runtime.llmBaseUrl scheme: $($uri.Scheme)" }
  }
  if ([string]$Runtime.whisperBackend -notin @('cpu', 'cuda')) { throw "unexpected whisper backend: $($Runtime.whisperBackend)" }
  if (-not [string]::IsNullOrWhiteSpace($ExpectedWhisperBackend) -and [string]$Runtime.whisperBackend -ne $ExpectedWhisperBackend) {
    throw "unexpected whisper backend: expected=$ExpectedWhisperBackend actual=$($Runtime.whisperBackend)"
  }
  if ([string]$Runtime.whisperModel -notmatch '^ggml-large-v3\.bin$') { throw "unexpected whisper model: $($Runtime.whisperModel)" }
}

function Assert-CudaRuntimeEvidence($Runtime) {
  if ([string]$Runtime.whisperBackend -ne 'cuda' -and $ExpectedWhisperBackend -ne 'cuda') { return }
  if ([string]$Runtime.whisperBackend -ne 'cuda') { throw 'CUDA evidence requested but manifest does not report CUDA' }
  $logPath = Resolve-ArtifactPath 'logs/tauri-driver.err.log' 'missing tauri stderr log for CUDA proof'
  $log = Get-Content -LiteralPath $logPath -Raw -Encoding UTF8
  $hasCudaBackend = $log -match 'using CUDA\d+ backend' -or $log -match 'whisper_backend_init_gpu:.*CUDA'
  $hasGpuEnabled = $log -match 'use gpu\s*=\s*1'
  if (-not ($hasCudaBackend -and $hasGpuEnabled)) {
    throw 'missing strong CUDA runtime evidence in tauri-driver.err.log'
  }
}
function Assert-Transcript($Transcript, $Manifest) {
  $sentences = @($Transcript.sentences)
  if ($sentences.Count -le 0) { throw 'missing transcript sentences' }
  if ([int]$Manifest.asr.sentenceCount -ne $sentences.Count) { throw "manifest ASR sentence count does not match transcript: manifest=$($Manifest.asr.sentenceCount) transcript=$($sentences.Count)" }

  foreach ($sentence in $sentences) {
    Require-Value $sentence.id 'transcript sentence missing id'
    Require-Value $sentence.text "transcript sentence $($sentence.id) missing text"
    if ([string]$sentence.id -match '^demo_s_') { throw "demo sentence id detected: $($sentence.id)" }
    if ([string]$sentence.text -match 'This is sentence') { throw "demo transcript text detected: $($sentence.id)" }
    Assert-NoMojibake ([string]$sentence.text) "mojibake transcript text detected: $($sentence.id)"
    $start = [double]$sentence.startTime
    $end = [double]$sentence.endTime
    if ($end -le $start) { throw "invalid transcript timestamp: $($sentence.id)" }
  }

  $manualSamples = @($Manifest.asr.manualReviewSamples)
  $requiredSamples = [Math]::Min(10, $sentences.Count)
  if ($manualSamples.Count -lt $requiredSamples) { throw "manual review samples too few: $($manualSamples.Count) of required $requiredSamples" }
  $sentenceById = @{}
  foreach ($sentence in $sentences) { $sentenceById[[string]$sentence.id] = $sentence }
  foreach ($sample in $manualSamples) {
    Require-Value $sample.id 'manual review sample missing id'
    if (-not $sentenceById.ContainsKey([string]$sample.id)) { throw "manual review sample not in transcript: $($sample.id)" }
    Assert-NoMojibake ([string]$sample.text) "mojibake manual review sample detected: $($sample.id)"
    $source = $sentenceById[[string]$sample.id]
    if ([double]$sample.startTime -ne [double]$source.startTime -or [double]$sample.endTime -ne [double]$source.endTime) {
      throw "manual review sample timestamp mismatch: $($sample.id)"
    }
  }

  return $sentences
}

function Assert-StructuringBlocks($Blocks, $Sentences, [int]$ExpectedBlockCount) {
  $blocks = @($Blocks)
  if ($blocks.Count -le 0) { throw 'missing structuring blocks' }
  if ($ExpectedBlockCount -ne $blocks.Count) { throw "manifest structuring block count does not match artifact: manifest=$ExpectedBlockCount blocks=$($blocks.Count)" }

  $expectedIds = @($Sentences | ForEach-Object { [string]$_.id })
  $covered = @()
  foreach ($block in $blocks) {
    Require-Value $block.blockId 'structuring block missing blockId'
    $nodes = @($block.nodes)
    if ($nodes.Count -le 0) { throw "structuring block missing nodes: $($block.blockId)" }
    $nodeKinds = @($nodes | ForEach-Object { [string]$_.kind })
    foreach ($requiredKind in @('chapter', 'section', 'paragraph')) {
      if ($requiredKind -notin $nodeKinds) { throw "structuring block $($block.blockId) missing $requiredKind node" }
    }
    foreach ($paragraph in @($nodes | Where-Object { [string]$_.kind -eq 'paragraph' })) {
      Require-Value $paragraph.startSentenceId "paragraph node missing startSentenceId in $($block.blockId)"
      Require-Value $paragraph.endSentenceId "paragraph node missing endSentenceId in $($block.blockId)"
      if ([string]$paragraph.type -notin @('concept', 'example', 'analogy', 'transition')) { throw "paragraph node has invalid type in $($block.blockId): $($paragraph.type)" }
    }
    $covered += @($block.coveredSentenceIds | ForEach-Object { [string]$_ })
  }

  $missing = @($expectedIds | Where-Object { $_ -notin $covered })
  $extra = @($covered | Where-Object { $_ -notin $expectedIds })
  $duplicates = @($covered | Group-Object | Where-Object Count -gt 1 | ForEach-Object Name)
  if ($missing.Count -or $extra.Count -or $duplicates.Count) {
    throw "sentence coverage is not exact. missing=$($missing -join ',') extra=$($extra -join ',') duplicate=$($duplicates -join ',')"
  }
}

function Assert-DatabaseProof($Database, $Sentences, $Blocks, [int]$SchemaVersion) {
  if ([string]$Database.evidenceSource -ne 'rain-app-query') { throw 'database proof must come from rain-app-query' }
  if ([string]$Database.status -ne 'ready') { throw "database status is not ready: $($Database.status)" }
  if ([string]$Database.stage -ne 'ready') { throw "database stage is not ready: $($Database.stage)" }
  if ([int]$Database.sentenceCount -ne @($Sentences).Count) { throw 'database sentence count does not match transcript' }
  $databaseBlockCount = if ($SchemaVersion -eq 2) { [int]$Database.structuringBlockCount } else { [int]$Database.qwenBlockCount }
  if ($databaseBlockCount -ne @($Blocks).Count) { throw 'database structuring block count does not match structuring artifact' }
  if ([int]$Database.nodeCount -le 0) { throw 'database node count must be greater than zero' }
  Require-Value $Database.queriedAt 'database proof missing query timestamp'
}

function Assert-EventSubsequence([string[]]$Events, [string[]]$RequiredEvents, [string]$Name) {
  $cursor = 0
  foreach ($required in $RequiredEvents) {
    $found = $false
    while ($cursor -lt $Events.Count) {
      if ($Events[$cursor] -eq $required) {
        $found = $true
        $cursor += 1
        break
      }
      $cursor += 1
    }
    if (-not $found) { throw "$Name proof missing ordered event: $required" }
  }
}

function Assert-ProofArtifact($ManifestSection, [string]$Name, [string[]]$RequiredEvents, [string[]]$AppEvents) {
  if ($ManifestSection.result -ne 'passed') { throw "missing $Name proof" }
  Require-Value $ManifestSection.artifact "missing $Name proof artifact"
  $proofPath = Resolve-ArtifactPath ([string]$ManifestSection.artifact) "missing $Name proof artifact"
  $proof = Read-JsonArtifact $proofPath
  if ($proof.result -ne 'passed') { throw "$Name proof did not pass" }
  if ([string]$proof.source -ne 'rain-app-automation') { throw "$Name proof must come from rain-app-automation" }
  $proofEvents = @($proof.events | ForEach-Object { [string]$_ })
  foreach ($event in $RequiredEvents) {
    if ($event -notin $proofEvents) { throw "$Name proof missing event: $event" }
    if ($event -notin $AppEvents) { throw "app-events missing $Name event: $event" }
  }
  Assert-EventSubsequence $proofEvents $RequiredEvents $Name
  Assert-EventSubsequence $AppEvents $RequiredEvents "app-events $Name"
}

function Assert-ExactRoleSet($Records, [string]$Name) {
  $requiredRoles = @('asr', 'structuring', 'assistant')
  $roles = @($Records | ForEach-Object { [string]$_.role })
  foreach ($role in $requiredRoles) {
    if ($role -notin $roles) { throw "$Name missing role: $role" }
  }
  $unexpected = @($roles | Where-Object { $_ -notin $requiredRoles })
  $duplicates = @($roles | Group-Object | Where-Object Count -gt 1 | ForEach-Object Name)
  if ($unexpected.Count -or $duplicates.Count -or $roles.Count -ne $requiredRoles.Count) {
    throw "$Name roles must be exactly asr, structuring, assistant"
  }
}

function Assert-CapabilityEvidence($CapabilityEvidence, $Manifest) {
  if ([string]$CapabilityEvidence.source -ne 'rain-app-automation') {
    throw 'capability evidence must come from rain-app-automation'
  }
  Require-Value $Manifest.evidenceId 'schema v2 manifest missing evidenceId'

  $checks = @($CapabilityEvidence.checks)
  $verified = @($CapabilityEvidence.verifiedRecords)
  Assert-ExactRoleSet $checks 'capability checks'
  Assert-ExactRoleSet $verified 'verified capability records'

  foreach ($check in $checks) {
    if ([string]$check.status -ne 'Compatible') { throw "capability check is not Compatible: $($check.role)" }
    Require-Value $check.modelId "capability check missing modelId: $($check.role)"
    Require-Value $check.modelAlias "capability check missing modelAlias: $($check.role)"
    Require-Value $check.message "capability check missing message: $($check.role)"
    Require-Value $check.fingerprint "capability check missing fingerprint: $($check.role)"
    Assert-PositiveNumber $check.checkedAt "capability check missing checkedAt: $($check.role)"

    $record = @($verified | Where-Object { [string]$_.role -eq [string]$check.role })[0]
    if ([string]$record.status -ne 'Verified') { throw "capability record is not Verified: $($check.role)" }
    if ([string]$record.evidenceId -ne [string]$Manifest.evidenceId) {
      throw "capability evidenceId mismatch: $($check.role)"
    }
    if ([string]$record.modelId -ne [string]$check.modelId -or [string]$record.fingerprint -ne [string]$check.fingerprint) {
      throw "Verified capability does not match checked configuration: $($check.role)"
    }
    Require-Value $record.message "Verified capability missing message: $($check.role)"
    Assert-PositiveNumber $record.checkedAt "Verified capability missing checkedAt: $($check.role)"
  }
}

function Assert-RuntimeGateEvidence($GateEvidence, [string[]]$AppEvents) {
  if ([string]$GateEvidence.source -ne 'rain-app-automation') {
    throw 'runtime gate evidence must come from rain-app-automation'
  }

  if ([string]$GateEvidence.import.result -ne 'passed') { throw 'missing import runtime gate proof' }
  if ([string]$GateEvidence.import.implementation -ne 'VideoImportController') {
    throw 'import runtime gate must use VideoImportController'
  }
  if ($GateEvidence.import.rejectedWithoutCapabilities -ne $true) {
    throw 'import runtime gate did not reject missing capabilities'
  }
  $importRoles = @($GateEvidence.import.requiredRoles | ForEach-Object { [string]$_ })
  if ($importRoles.Count -ne 2 -or 'asr' -notin $importRoles -or 'structuring' -notin $importRoles) {
    throw 'import runtime gate roles must be asr and structuring'
  }

  if ([string]$GateEvidence.assistant.result -ne 'passed') { throw 'missing assistant runtime gate proof' }
  if ([string]$GateEvidence.assistant.implementation -ne 'decideModelRoleAssignment+streamAiChat') {
    throw 'assistant runtime gate must use the production role decision and stream adapter'
  }
  if ($GateEvidence.assistant.rejectedWithoutCapabilities -ne $true) {
    throw 'assistant runtime gate did not reject missing capabilities'
  }
  if ($GateEvidence.assistant.textOnly -ne $true) { throw 'assistant evidence must remain text-only' }
  if ([string]$GateEvidence.assistant.responseContract -ne 'RAIN_ASSISTANT_OK') {
    throw 'assistant response contract is invalid'
  }
  $assistantRoles = @($GateEvidence.assistant.requiredRoles | ForEach-Object { [string]$_ })
  if ($assistantRoles.Count -ne 1 -or $assistantRoles[0] -ne 'assistant') {
    throw 'assistant runtime gate role must be assistant'
  }

  Assert-EventSubsequence $AppEvents @(
    'capability_checks_complete',
    'import_gate_rejected_missing_capabilities',
    'assistant_gate_rejected_missing_capabilities',
    'start_import',
    'import_complete',
    'assistant_stream_complete'
  ) 'schema v2 runtime gates'
}

function Assert-Screenshots($Artifacts) {
  $screenshots = @($Artifacts.screenshots)
  if ($screenshots.Count -le 0) { throw 'missing screenshot evidence' }
  foreach ($screenshot in $screenshots) {
    $screenshotPath = Resolve-ArtifactPath ([string]$screenshot) 'missing screenshot artifact path'
    $bytes = [System.IO.File]::ReadAllBytes($screenshotPath)
    if ($bytes.Length -lt 8) { throw "screenshot artifact is empty: $screenshot" }
    $isPng = $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50 -and $bytes[2] -eq 0x4E -and $bytes[3] -eq 0x47
    if (-not $isPng) { throw "screenshot artifact is not a PNG: $screenshot" }
  }
}

if (-not (Test-Path -LiteralPath $EvidenceManifest)) { throw "manifest not found: $EvidenceManifest" }
$manifestPath = Resolve-Path -LiteralPath $EvidenceManifest
$manifest = Read-JsonArtifact $manifestPath.Path
$script:evidenceDir = Split-Path -Parent $manifestPath
$schemaVersion = if ($null -eq $manifest.schemaVersion) { 1 } else { [int]$manifest.schemaVersion }
if ($schemaVersion -notin @(1, 2)) { throw "unsupported evidence schemaVersion: $schemaVersion" }

Assert-VideoProof $manifest.video
if ($manifest.secretsDetected -ne $false) { throw 'evidence contains a secret' }
Assert-Runtime $manifest.runtime $schemaVersion
Assert-CudaRuntimeEvidence $manifest.runtime
Assert-PositiveNumber $manifest.timings.asrSeconds 'missing ASR timing evidence'
if ($schemaVersion -eq 2) {
  Assert-PositiveNumber $manifest.timings.structuringSeconds 'missing structuring timing evidence'
} else {
  Assert-PositiveNumber $manifest.timings.qwenSeconds 'missing Qwen timing evidence'
}

$transcriptPath = Resolve-ArtifactPath ([string]$manifest.artifacts.transcript) 'missing transcript artifact path'
$structuringPath = if ($schemaVersion -eq 2) {
  Resolve-ArtifactPath ([string]$manifest.artifacts.structuringBlocks) 'missing structuring artifact path'
} else {
  Resolve-ArtifactPath ([string]$manifest.artifacts.qwenBlocks) 'missing Qwen artifact path'
}
$databasePath = Resolve-ArtifactPath ([string]$manifest.artifacts.database) 'missing database artifact path'
$probePath = Resolve-ArtifactPath ([string]$manifest.artifacts.probe) 'missing probe artifact path'
$appEventsPath = Resolve-ArtifactPath ([string]$manifest.artifacts.appEvents) 'missing app-events artifact path'

$transcript = Read-JsonArtifact $transcriptPath
$structuringBlocks = Read-JsonArtifact $structuringPath
$database = Read-JsonArtifact $databasePath
$probe = Read-JsonArtifact $probePath
$appEventsArtifact = Read-JsonArtifact $appEventsPath
$appEvents = @($appEventsArtifact | ForEach-Object { [string]$_.event })

if (@($probe.streams | Where-Object { [string]$_.codec_type -eq 'video' }).Count -le 0) { throw 'probe artifact has no video stream' }
Assert-PositiveNumber $probe.format.duration 'probe artifact missing duration'
$sentences = Assert-Transcript $transcript $manifest
$expectedBlockCount = if ($schemaVersion -eq 2) { [int]$manifest.structuring.blockCount } else { [int]$manifest.qwen.blockCount }
Assert-StructuringBlocks $structuringBlocks $sentences $expectedBlockCount
Assert-DatabaseProof $database $sentences @($structuringBlocks) $schemaVersion
Assert-ProofArtifact $manifest.cancellation 'cancellation' @('start_import', 'cancel_import', 'import_cancelled') $appEvents
Assert-ProofArtifact $manifest.restart 'restart' @('start_import', 'import_cancelled', 'retry_import', 'import_complete') $appEvents
if ($schemaVersion -eq 2) {
  $capabilityPath = Resolve-ArtifactPath ([string]$manifest.artifacts.capabilities) 'missing capability artifact path'
  $runtimeGatesPath = Resolve-ArtifactPath ([string]$manifest.artifacts.runtimeGates) 'missing runtime gate artifact path'
  Assert-CapabilityEvidence (Read-JsonArtifact $capabilityPath) $manifest
  Assert-RuntimeGateEvidence (Read-JsonArtifact $runtimeGatesPath) $appEvents
}
Assert-Screenshots $manifest.artifacts

$secretPattern = 'sk-[A-Za-z0-9._-]+'
$secretHit = Get-ChildItem -LiteralPath $script:evidenceDir -File -Recurse | Where-Object { $_.Name -notmatch '\.(png|jpg|jpeg|webp)$' } | ForEach-Object {
  $content = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
  if ($content -match $secretPattern) { $_.FullName }
} | Select-Object -First 1
if ($secretHit) { throw "secret-like token found in evidence: $secretHit" }

[pscustomobject]@{
  ok = $true
  manifest = $manifestPath.Path
  sentenceCount = @($sentences).Count
  structuringBlockCount = @($structuringBlocks).Count
  backend = [string]$manifest.runtime.whisperBackend
  schemaVersion = $schemaVersion
  llmModel = if ($schemaVersion -eq 2) { [string]$manifest.runtime.llmModel } else { [string]$manifest.runtime.qwenModel }
} | ConvertTo-Json -Depth 4
