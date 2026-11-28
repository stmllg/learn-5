$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot 'speech_models'
$names = @('encoder-epoch-99-avg-1.onnx','decoder-epoch-99-avg-1.onnx','joiner-epoch-99-avg-1.onnx','tokens.txt','sherpa-onnx-asr.js','sherpa-onnx-wasm-main-asr.js','sherpa-onnx-wasm-main-asr.wasm')
$files = @()
foreach ($n in $names) {
  $p = Join-Path $dir $n
  $f = Get-Item -LiteralPath $p
  if ($f.Length -le 0) { throw "Empty: $n" }
  $h = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
  $files += @{name=$n;size=$f.Length;sha256=$h;parts=@(@{name=$n;size=$f.Length;sha256=$h})}
  Write-Host "$n $($f.Length) $h"
}
$sha = [Security.Cryptography.SHA256]::Create()
try {$v = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($files.sha256 -join '')))).Replace('-','').ToLowerInvariant()} finally {$sha.Dispose()}
$m = @{version=$v;files=$files;roles=@{encoder=$names[0];decoder=$names[1];joiner=$names[2];tokens=$names[3]}}
[IO.File]::WriteAllText((Join-Path $dir 'model-manifest.json'),($m | ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
Write-Host 'OK: speech_models/model-manifest.json'
