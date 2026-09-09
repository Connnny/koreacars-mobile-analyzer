# Start the Koreacars Analyzer web app on http://127.0.0.1:8787
# (optional) $env:PORT = 9000 before running to change the port
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path 'node_modules\puppeteer-core')) { npm install }
Write-Host 'Starting web app at http://127.0.0.1:8787  (Ctrl+C to stop)'
node server.mjs
