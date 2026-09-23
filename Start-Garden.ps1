param([switch]$Lan, [int]$Port = 8787)
$ErrorActionPreference = 'Stop'
$gardenNode = Get-Command node -ErrorAction SilentlyContinue
if ($gardenNode) {
    $gardenNodePath = $gardenNode.Source
} else {
    $gardenNodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (-not (Test-Path -LiteralPath $gardenNodePath)) { throw 'Для запуска Garden установите Node.js 24.' }
}
$env:PORT = [string]$Port
$env:HOST = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
Push-Location $PSScriptRoot
try {
    Write-Host "Garden: откройте http://127.0.0.1:$Port . Для остановки нажмите Ctrl+C."
    & $gardenNodePath 'server/index.mjs'
} finally { Pop-Location }
