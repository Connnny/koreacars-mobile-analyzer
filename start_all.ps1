# Koreacars Analyzer – alles nach einem PC-Neustart wieder starten.
# Nutzung:  doppelklicken  oder:  powershell -ExecutionPolicy Bypass -File .\start_all.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ''
Write-Host '=== Koreacars Analyzer: Start ===' -ForegroundColor Cyan

# 1) Abhängigkeiten
if (-not (Test-Path 'node_modules\puppeteer-core')) {
    Write-Host 'Installiere Abhängigkeiten (npm install) …'
    npm install
}

# 2) Ollama (lokales LLM) starten, falls nicht erreichbar
function Test-Port($uri) { try { Invoke-RestMethod -Uri $uri -TimeoutSec 2 | Out-Null; return $true } catch { return $false } }
if (-not (Test-Port 'http://127.0.0.1:11434/api/version')) {
    Write-Host 'Starte Ollama …' -ForegroundColor Yellow
    $ollama = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
    if (-not (Test-Path $ollama)) { $ollama = 'ollama' }
    Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 5
    if (Test-Port 'http://127.0.0.1:11434/api/version') { Write-Host '  Ollama läuft.' -ForegroundColor Green } else { Write-Host '  Ollama nicht erreichbar (Modell wird bei Bedarf nachgeladen).' -ForegroundColor DarkYellow }
} else {
    Write-Host 'Ollama läuft bereits.' -ForegroundColor Green
}

# 3) Node-Prozesse prüfen (verhindert Doppelstart nach erneutem Ausführen)
function Get-NodeProcess($marker) {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$marker*" -and $_.CommandLine -notlike '*powershell*' }
}
if (-not (Test-Port 'http://127.0.0.1:8787/api/health')) {
    Write-Host 'Starte Web-App …' -ForegroundColor Yellow
    if (-not (Test-Path 'logs')) { New-Item -ItemType Directory -Path 'logs' | Out-Null }
    Start-Process -FilePath 'node' -ArgumentList 'server.mjs' -WorkingDirectory $PWD -WindowStyle Hidden `
        -RedirectStandardOutput "$PWD\logs\web.log" -RedirectStandardError "$PWD\logs\web.err.log" | Out-Null
    Start-Sleep -Seconds 2
} else {
    Write-Host 'Web-App läuft bereits (http://127.0.0.1:8787).' -ForegroundColor Green
}

if (Test-Path 'bot_token.txt') {
    if (-not (Get-NodeProcess 'bot.mjs')) {
        Write-Host 'Starte Telegram-Bot …' -ForegroundColor Yellow
        if (-not (Test-Path 'logs')) { New-Item -ItemType Directory -Path 'logs' | Out-Null }
        Start-Process -FilePath 'node' -ArgumentList 'bot.mjs' -WorkingDirectory $PWD -WindowStyle Hidden `
            -RedirectStandardOutput "$PWD\logs\bot.log" -RedirectStandardError "$PWD\logs\bot.err.log" | Out-Null
        Start-Sleep -Seconds 2
    } else {
        Write-Host 'Telegram-Bot läuft bereits.' -ForegroundColor Green
    }
} else {
    Write-Host 'Kein bot_token.txt gefunden – Bot wird übersprungen (Anleitung im README).' -ForegroundColor DarkYellow
}

Write-Host ''
Write-Host '=== Fertig ===' -ForegroundColor Cyan
Write-Host 'Web-App : http://127.0.0.1:8787'
Write-Host 'Logs    : .\logs\ (web.log, bot.log)'
Write-Host 'Hinweis : Dieses Skript ist für den Start NACH dem Neustart gedacht.'
