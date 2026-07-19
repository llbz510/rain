param(
  [Parameter(Mandatory=$true)]
  [string]$EvidenceManifest
)

$ErrorActionPreference = 'Stop'
$expectedHash = '3870B5BD62E574685AC99A8E44295F5E44AC44B76343666742C1C4CA48365F8A'

function Require-Value($Value, [string]$Message) {
  if ($null -eq $Value -or ($Value -is [string] -and [string]::IsNullOrWhiteSpace($Value))) { throw $Message }
}

if (-not (Test-Path -LiteralPath $EvidenceManifest)) { throw "manifest not found: $EvidenceManifest" }
$manifestPath = Resolve-Path -LiteralPath $EvidenceManifest
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$evidenceDir = Split-Path -Parent $manifestPath

Require-Value $manifest.video.sha256 'missing video.sha256'
if ([string]$manifest.video.sha256 -ne $expectedHash) { throw 'unexpected input video hash' }
if ($manifest.secretsDetected -ne $false) { throw 'evidence contains a secret' }
if ($manifest.validation.sentenceCoverage -ne 'exactly-once') { throw 'sentence coverage is not exact' }
if ($manifest.validation.noDemoSentences -ne $true) { throw 'demo transcript text detected' }
if ($manifest.validation.noDemoIds -ne $true) { throw 'demo sentence ids detected' }
if ([int]$manifest.asr.sentenceCount -le 0) { throw 'missing ASR sentence evidence' }
if ([int]$manifest.qwen.blockCount -le 0) { throw 'missing Qwen block evidence' }
if ($manifest.cancellation.result -ne 'passed') { throw 'missing cancellation proof' }
if ($manifest.restart.result -ne 'passed') { throw 'missing restart proof' }

foreach ($artifact in @($manifest.artifacts.transcript, $manifest.artifacts.qwenBlocks, $manifest.artifacts.database, $manifest.artifacts.probe)) {
  Require-Value $artifact 'missing artifact path'
  $artifactPath = Join-Path $evidenceDir $artifact
  if (-not (Test-Path -LiteralPath $artifactPath)) { throw "artifact not found: $artifact" }
}

$secretPattern = 'sk-[A-Za-z0-9._-]+'
$secretHit = Get-ChildItem -LiteralPath $evidenceDir -File -Recurse | Where-Object { $_.Name -notmatch '\.(png|jpg|jpeg|webp)$' } | ForEach-Object {
  $content = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
  if ($content -match $secretPattern) { $_.FullName }
} | Select-Object -First 1
if ($secretHit) { throw "secret-like token found in evidence: $secretHit" }

[pscustomobject]@{
  ok = $true
  manifest = $manifestPath.Path
  sentenceCount = [int]$manifest.asr.sentenceCount
  qwenBlockCount = [int]$manifest.qwen.blockCount
  backend = [string]$manifest.runtime.whisperBackend
} | ConvertTo-Json -Depth 4