# Start the Telegram bot for the Koreacars analyzer.
# 1. Create a bot with @BotFather (Telegram) and copy the token.
# 2. Run this script. On first run it asks for the token and stores it in bot_token.txt.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$tokFile = Join-Path $PSScriptRoot 'bot_token.txt'

if (-not $env:TELEGRAM_BOT_TOKEN) {
    if (-not (Test-Path $tokFile)) {
        Write-Host ''
        Write-Host 'No Telegram token found yet.' -ForegroundColor Yellow
        Write-Host 'Steps:' -ForegroundColor White
        Write-Host '  1. Open Telegram -> search for @BotFather -> /newbot'
        Write-Host '  2. Follow the prompts and copy the token it gives you'
        Write-Host '  3. Paste it below (it will be saved to bot_token.txt)'
        Write-Host ''
        $tok = Read-Host 'Token'
        $tok = $tok.Trim()
        if ($tok -notmatch '^\d+:[A-Za-z0-9_-]{20,}$') {
            Write-Host 'That does not look like a Telegram bot token (format: 123456:ABC...). Try again.' -ForegroundColor Red
            exit 1
        }
        Set-Content -Path $tokFile -Value $tok -Encoding Ascii -NoNewline
        Write-Host "Saved to $tokFile" -ForegroundColor Green
    }
}

Write-Host 'Starting Koreacars analyzer bot (Ctrl+C to stop)…'
node bot.mjs
