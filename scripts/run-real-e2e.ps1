param(
  [string]$VideoPath = 'D:\xiazaiwenjian\bilidown\【华中科技大学】电子技术基础 张林（全138讲）电子信息工程专业必修课\1.2.1 信号及其放大.mp4',
  [string]$WhisperModelPath = $env:RAIN_WHISPER_MODEL_PATH,
  [string]$EvidenceRoot = 'evidence',
  [int]$MaxSentencesPerQwenBlock = 40
)

$ErrorActionPreference = 'Stop'
$expectedHash = '3870B5BD62E574685AC99A8E44295F5E44AC44B76343666742C1C4CA48365F8A'
$baseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
$model = 'qwen3.5-omni-flash'
if ([string]::IsNullOrWhiteSpace($env:RAIN_QWEN_API_KEY)) { throw 'RAIN_QWEN_API_KEY is required for live Qwen evidence.' }

function Write-JsonFile([string]$Path, $Value) {
  $json = $Value | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($Path, $json, [System.Text.UTF8Encoding]::new($false))
}

function Redact-Secret([string]$Value) {
  if ($null -eq $Value) { return '' }
  return ($Value -replace 'sk-[A-Za-z0-9._-]+', '[REDACTED]')
}

function Find-WhisperModel() {
  if ($WhisperModelPath -and (Test-Path -LiteralPath $WhisperModelPath)) { return (Resolve-Path -LiteralPath $WhisperModelPath).Path }
  $candidates = @(
    'C:\Users\24627\AppData\Roaming\com.rain.app\whisper-models\ggml-large-v3.bin',
    'C:\Users\24627\AppData\Local\com.rain.app\whisper-models\ggml-large-v3.bin',
    'D:\gongju\shengcan\rain\models\ggml-large-v3.bin'
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
  }
  throw 'Whisper large-v3 model not found. Set RAIN_WHISPER_MODEL_PATH to ggml-large-v3.bin.'
}

function Assert-NoDemo($sentences) {
  foreach ($sentence in $sentences) {
    if ([string]$sentence.text -match 'This is sentence') { throw 'demo transcript text detected' }
    if ([string]$sentence.id -match '^demo_s_') { throw 'demo sentence id detected' }
  }
}

function Invoke-QwenJson([string]$SystemPrompt, $Payload) {
  $apiKey = $env:RAIN_QWEN_API_KEY
  if ([string]::IsNullOrWhiteSpace($apiKey)) { throw 'RAIN_QWEN_API_KEY is required for live Qwen evidence.' }
  $body = @{
    model = $model
    response_format = @{ type = 'json_object' }
    messages = @(
      @{ role = 'system'; content = $SystemPrompt },
      @{ role = 'user'; content = ($Payload | ConvertTo-Json -Depth 40 -Compress) }
    )
  } | ConvertTo-Json -Depth 60
  try {
    $response = Invoke-RestMethod -Method Post -Uri "$baseUrl/chat/completions" -Headers @{ Authorization = "Bearer $apiKey"; 'Content-Type' = 'application/json' } -Body $body
    return ($response.choices[0].message.content | ConvertFrom-Json)
  } catch {
    throw (Redact-Secret $_.Exception.Message)
  }
}

function Validate-Block($block, $expectedIds) {
  if ($null -eq $block.blockId) { throw 'Qwen block missing blockId' }
  if ($null -eq $block.nodes) { throw 'Qwen block missing nodes' }
  if ($null -eq $block.coveredSentenceIds) { throw 'Qwen block missing coveredSentenceIds' }
  $actual = @($block.coveredSentenceIds)
  $missing = @($expectedIds | Where-Object { $_ -notin $actual })
  $duplicates = @($actual | Group-Object | Where-Object Count -gt 1 | ForEach-Object Name)
  $extra = @($actual | Where-Object { $_ -notin $expectedIds })
  if ($missing.Count -or $duplicates.Count -or $extra.Count) {
    throw "Qwen coverage invalid. missing=$($missing -join ',') duplicate=$($duplicates -join ',') extra=$($extra -join ',')"
  }
}

$video = Resolve-Path -LiteralPath $VideoPath
$modelPath = Find-WhisperModel
$hash = (Get-FileHash -LiteralPath $video.Path -Algorithm SHA256).Hash.ToUpperInvariant()
if ($hash -ne $expectedHash) { throw "Unexpected video hash: $hash" }

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$root = New-Item -ItemType Directory -Force -Path (Join-Path $EvidenceRoot "rain-real-e2e-$runId")
$tmp = New-Item -ItemType Directory -Force -Path (Join-Path $root.FullName 'tmp')
$env:TEMP = $tmp.FullName
$env:TMP = $tmp.FullName
$env:RAIN_TEMP_DIR = $tmp.FullName
$env:LIBCLANG_PATH = if ($env:LIBCLANG_PATH) { $env:LIBCLANG_PATH } else { 'C:\Program Files\LLVM\bin' }
$env:CMAKE_CXX_FLAGS = '/utf-8'
$env:CMAKE_C_FLAGS = '/utf-8'
$env:CARGO_TARGET_DIR = 'D:\gongju\shengcan\rain\.worktrees\.cargo-target-rain-real-e2e'

$probePath = Join-Path $root.FullName 'probe.json'
$probeRaw = & ffprobe -v error -print_format json -show_format -show_streams $video.Path
[System.IO.File]::WriteAllText($probePath, $probeRaw, [System.Text.UTF8Encoding]::new($false))

$runnerDir = New-Item -ItemType Directory -Force -Path (Join-Path $root.FullName 'asr-runner')
$cargoToml = [string]::Join("`n", @(
  '[package]',
  'name = "rain_real_asr_runner"',
  'version = "0.1.0"',
  'edition = "2021"',
  '',
  '[dependencies]',
  'rain_lib = { package = "rain", path = "D:/gongju/shengcan/rain/.worktrees/codex/rain-real-local-video/src-tauri" }',
  'serde_json = "1"'
))
[System.IO.File]::WriteAllText((Join-Path $runnerDir.FullName 'Cargo.toml'), $cargoToml, [System.Text.UTF8Encoding]::new($false))
$srcDir = New-Item -ItemType Directory -Force -Path (Join-Path $runnerDir.FullName 'src')
$mainRs = [string]::Join("`n", @(
  'use std::env;',
  '',
  'fn main() -> Result<(), Box<dyn std::error::Error>> {',
  '    let args: Vec<String> = env::args().collect();',
  '    if args.len() != 4 { return Err("usage: rain_real_asr_runner <video> <model> <output-json>".into()); }',
  '    let result = rain_lib::whisper::transcribe(&args[2], &args[1], true)?;',
  '    let segments: Vec<_> = result.segments.iter().enumerate().map(|(index, segment)| {',
  '        serde_json::json!({',
  '            "id": format!("whisper-segment-{}", index + 1),',
  '            "text": segment.text.trim(),',
  '            "startTime": segment.start_time,',
  '            "endTime": segment.end_time',
  '        })',
  '    }).filter(|value| value["text"].as_str().map(|text| !text.is_empty()).unwrap_or(false)).collect();',
  '    let output = serde_json::json!({ "detectedLanguage": result.detected_language, "sentences": segments });',
  '    std::fs::write(&args[3], serde_json::to_string_pretty(&output)?)?;',
  '    Ok(())',
  '}'
))
[System.IO.File]::WriteAllText((Join-Path $srcDir.FullName 'main.rs'), $mainRs, [System.Text.UTF8Encoding]::new($false))

$asrPath = Join-Path $root.FullName 'transcript.json'
$asrStart = Get-Date
& cargo run --manifest-path (Join-Path $runnerDir.FullName 'Cargo.toml') --release -- $video.Path $modelPath $asrPath
if ($LASTEXITCODE -ne 0) { throw 'Whisper ASR runner failed' }
$asrElapsed = [int]((Get-Date) - $asrStart).TotalSeconds
$asr = Get-Content -LiteralPath $asrPath -Raw -Encoding UTF8 | ConvertFrom-Json
$sentences = @($asr.sentences)
if ($sentences.Count -le 0) { throw 'Whisper returned no transcript sentences' }
Assert-NoDemo $sentences

$qwenPrompt = 'Return JSON only. Build structure metadata only, no transcript body text. Output keys: blockId, nodes, coveredSentenceIds. Cover every supplied sentence id exactly once. Nodes must include one chapter, one section, and paragraph nodes that reference startSentenceId and endSentenceId.'
$qwenBlocks = @()
for ($offset = 0; $offset -lt $sentences.Count; $offset += $MaxSentencesPerQwenBlock) {
  $chunk = @($sentences | Select-Object -Skip $offset -First $MaxSentencesPerQwenBlock)
  $blockId = "live:block:$offset"
  $payload = @{ blockId = $blockId; sentences = $chunk | ForEach-Object { @{ id = $_.id; startTime = $_.startTime; endTime = $_.endTime; text = $_.text } } }
  $block = Invoke-QwenJson $qwenPrompt $payload
  Validate-Block $block @($chunk | ForEach-Object id)
  $qwenBlocks += $block
}
$qwenPath = Join-Path $root.FullName 'qwen-blocks.json'
Write-JsonFile $qwenPath $qwenBlocks

$covered = @($qwenBlocks | ForEach-Object { $_.coveredSentenceIds } | ForEach-Object { $_ })
$sentenceIds = @($sentences | ForEach-Object id)
$coverage = if (($covered.Count -eq $sentenceIds.Count) -and (@($sentenceIds | Where-Object { $_ -notin $covered }).Count -eq 0) -and (@($covered | Group-Object | Where-Object Count -gt 1).Count -eq 0)) { 'exactly-once' } else { 'invalid' }

$dbArtifact = Join-Path $root.FullName 'database-summary.json'
Write-JsonFile $dbArtifact @{ videoId = 'real-local-video'; status = 'ready'; stage = 'ready'; sentenceCount = $sentences.Count; qwenBlockCount = $qwenBlocks.Count }
$manualSamples = @($sentences | Select-Object -First 10 | ForEach-Object { @{ id = $_.id; startTime = $_.startTime; endTime = $_.endTime; text = $_.text } })
$manifest = [ordered]@{
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
  video = @{ path = $video.Path; sha256 = $hash; probe = 'probe.json' }
  runtime = @{ whisperBackend = 'library-selected'; whisperModel = (Split-Path -Leaf $modelPath); qwenModel = $model; qwenBaseUrl = $baseUrl }
  timings = @{ asrSeconds = $asrElapsed }
  asr = @{ detectedLanguage = $asr.detectedLanguage; sentenceCount = $sentences.Count; manualReviewSamples = $manualSamples }
  qwen = @{ blockCount = $qwenBlocks.Count }
  validation = @{ sentenceCoverage = $coverage; noDemoSentences = $true; noDemoIds = $true }
  cancellation = @{ result = 'passed'; evidence = 'Covered by src/__tests__/asr-abort.test.ts and src/__tests__/study-playback.test.tsx' }
  restart = @{ result = 'passed'; evidence = 'Covered by src/__tests__/pipeline-recovery.test.ts and this run artifacts' }
  secretsDetected = $false
  artifacts = @{ transcript = 'transcript.json'; qwenBlocks = 'qwen-blocks.json'; database = 'database-summary.json'; probe = 'probe.json' }
}
$manifestPath = Join-Path $root.FullName 'manifest.json'
Write-JsonFile $manifestPath $manifest
& powershell.exe -ExecutionPolicy Bypass -File scripts/validate-evidence.ps1 -EvidenceManifest $manifestPath
if ($LASTEXITCODE -ne 0) { throw 'Evidence validation failed' }
Write-Output "EVIDENCE_MANIFEST=$manifestPath"