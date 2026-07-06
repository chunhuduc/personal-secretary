# WORKFLOW.md — personal-secretary

Step-by-step operational flows. When a flow changes, update it here. When you invent a
new repeatable flow, add it.

---

## Flow: Deploy & register the webhook (M1)

The remaining steps to take the Telegram leg live.

1. **Set the 4 env vars in the Vercel project** (Vercel dashboard → Project → Settings →
   Environment Variables, or `vercel env add`). They mirror `.env`:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET`
   - `GOOGLE_SERVICE_ACCOUNT_JSON` (base64, single line)
   - `SHEET_ID`

2. **Deploy:**
   ```
   vercel deploy --prod
   ```
   Note the resulting deployment URL, e.g. `https://personal-secretary.vercel.app`.

3. **Register the webhook** (PowerShell):
   ```powershell
   $env:TELEGRAM_BOT_TOKEN     = "<token>"
   $env:TELEGRAM_WEBHOOK_SECRET = "<secret>"
   .\scripts\set-webhook.ps1 -DeployUrl "https://personal-secretary.vercel.app"
   ```
   (Git Bash equivalent: `scripts/set-webhook.sh`.) The script calls `setWebhook` then
   prints `getWebhookInfo` for verification — check `url` matches and there's no
   `last_error_message`.

4. **End-to-end test:** send a message in a chat the bot is in → confirm a new row
   appears in the `log` tab of the Sheet.

5. **Confirm Claude access:** ask Claude to read the Sheet via the Google Drive MCP
   (`search_files` for the sheet name → `read_file_content`).

**Verifying afterward:** `getWebhookInfo` should show `pending_update_count: 0` and no
recent error. If rows aren't landing, see `FINDINGS.md` (secret mismatch, service
account not shared as Editor, or privacy mode still ON).

---

## Flow: Add a new message source (M2)

Read `WORKSPACE_CONTEXT.md` first — it holds the rationale. Then:

1. **Copy the webhook shape** from `api/telegram-webhook.js` into
   `api/<source>-webhook.js`: verify shared secret → parse the message → append.
2. **Reuse `lib/sheets.js`.** Either write into a new tab (`log_<source>`) by
   parameterizing the range, or add a small sibling helper. Do **not** create a second
   Sheets client / new service account.
3. **Decide scope.** If the source can gate by bot/integration membership (like
   Telegram), keep presence-based scope. If it can't (email), design a whitelist — see
   the caveat in `FINDINGS.md` and `WORKSPACE_CONTEXT.md`.
4. **Add env vars** to `.env` and mirror them in `.env.example` (the committed
   contract). Convention: `<SOURCE>_*_TOKEN`, `<SOURCE>_WEBHOOK_SECRET`.
5. **Deploy + register** following the deploy flow above, adapted to the source's own
   webhook-registration mechanism.
6. **Document** the new source's setup steps in `README.md` and update `MASTER_PLAN.md`.

---

## Flow: Rotate a secret

1. Generate the new value (bot token via BotFather, or a fresh random webhook secret).
2. Update `.env` locally **and** the Vercel env var.
3. Redeploy (`vercel deploy --prod`) so the function picks up the new value.
4. If the webhook secret changed, re-run `scripts/set-webhook.ps1` so Telegram sends the
   new `secret_token`.
5. Verify with `getWebhookInfo` and a test message.

---

## Flow: Local sanity check (no network)

```
npm run sanity
```
Runs `scripts/sanity-check.js` — a syntax/logic check that does not hit Google or
Telegram. Run it before every commit that touches `api/` or `lib/`.
