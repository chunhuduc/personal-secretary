#!/usr/bin/env bash
# Registers (or re-registers) the Telegram webhook after a Vercel deploy.
#
# Usage:
#   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
#     ./scripts/set-webhook.sh https://your-project.vercel.app
set -euo pipefail

DEPLOY_URL="${1:?Usage: set-webhook.sh <deploy-url>}"
: "${TELEGRAM_BOT_TOKEN:?Set TELEGRAM_BOT_TOKEN in your env}"
: "${TELEGRAM_WEBHOOK_SECRET:?Set TELEGRAM_WEBHOOK_SECRET in your env}"

WEBHOOK_URL="${DEPLOY_URL%/}/api/telegram-webhook"

echo "Registering webhook: $WEBHOOK_URL"
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -F "url=${WEBHOOK_URL}" \
  -F "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
echo

echo "Verifying with getWebhookInfo:"
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
echo
