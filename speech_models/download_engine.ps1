$ErrorActionPreference = 'Stop'
$dest = $PSScriptRoot
$base = 'https://stmllg.github.io/check/engine/'
$files = @('sherpa-onnx-wasm-main-asr.js','sherpa-onnx-wasm-main-asr.wasm','sherpa-onnx-asr.js','LICENSE-sherpa.txt','revision.txt')
foreach ($f in $files) {
  Write-Host "Downloading $f"
  $tmp = Join-Path $dest ($f + '.download')
  Invoke-WebRequest -UseBasicParsing -Uri ($base + $f) -OutFile $tmp
  if ((Get-Item $tmp).Length -eq 0) { throw "Empty file: $f" }
  if ($f.EndsWith('.wasm')) {
    $r = [IO.File]::OpenRead($tmp)
    try { $b = New-Object byte[] 4; if ($r.Read($b,0,4) -ne 4 -or [BitConverter]::ToString($b) -ne '00-61-73-6D') { throw 'Invalid WASM file' } } finally { $r.Dispose() }
  }
  if ($f.EndsWith('.js') -and (Get-Content $tmp -TotalCount 1) -match '^\s*<') { throw "Unexpected HTML: $f" }
  Move-Item -Force $tmp (Join-Path $dest $f)
}
Write-Host 'Engine download complete.'
