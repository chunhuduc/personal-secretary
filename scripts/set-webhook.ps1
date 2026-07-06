# Registers (or re-registers) the Telegram webhook after a Vercel deploy.
#
# Usage:
#   $env:TELEGRAM_BOT_TOKEN = "..."
#   $env:TELEGRAM_WEBHOOK_SECRET = "..."
#   .\scripts\set-webhook.ps1 -DeployUrl "https://your-project.vercel.app"

param(
    [Parameter(Mandatory = $true)]
    [string]$DeployUrl
)

if (-not $env:TELEGRAM_BOT_TOKEN) { throw "Set `$env:TELEGRAM_BOT_TOKEN first" }
if (-not $env:TELEGRAM_WEBHOOK_SECRET) { throw "Set `$env:TELEGRAM_WEBHOOK_SECRET first" }

$webhookUrl = "$($DeployUrl.TrimEnd('/'))/api/telegram-webhook"

Write-Host "Registering webhook: $webhookUrl"
$setResult = Invoke-RestMethod -Method Post `
    -Uri "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)/setWebhook" `
    -Form @{ url = $webhookUrl; secret_token = $env:TELEGRAM_WEBHOOK_SECRET }
$setResult | ConvertTo-Json -Depth 5

Write-Host "`nVerifying with getWebhookInfo:"
$info = Invoke-RestMethod -Uri "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)/getWebhookInfo"
$info | ConvertTo-Json -Depth 5
