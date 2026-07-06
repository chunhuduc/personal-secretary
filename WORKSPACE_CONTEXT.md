# Workspace context: personal-secretary

## Convention established here

**Pattern**: `<messaging source> -> Vercel webhook -> Google Sheets -> Claude (via Google Drive MCP)`

This project wires Telegram into that pattern first. The intent is to reuse the same
shape for other message sources later (Zalo, a second email account, Slack, etc.)
rather than inventing a new pipeline per source.

### Why Sheets as the sink

- `spreadsheets.values.append` is atomic server-side — no read-modify-write race
  under concurrent webhook invocations, unlike appending to a plain Drive text file.
- Columnar data is filterable by Claude (by sender, chat, time) more efficiently than
  parsing free text.
- Google Drive MCP can read Sheets directly (`search_files` + `read_file_content`),
  so no separate integration is needed on the Claude side.

### Two-tab shape

- `log` — one row per message: `timestamp_iso | chat_id | chat_name | sender | text | raw_date_unix`
- `config` — whitelist of source IDs to actually log:
  `chat_id | chat_name | enabled`

### Env-var contract (per source)

Each new source integration should define, at minimum:
- `<SOURCE>_BOT_TOKEN` or equivalent credential
- `<SOURCE>_WEBHOOK_SECRET` — shared secret checked against a header on every inbound
  request, to reject spoofed calls before doing any work
- `GOOGLE_SERVICE_ACCOUNT_JSON` — reusable across sources; the same service account
  can own multiple Sheets, or multiple tabs in one Sheet
- `SHEET_ID` — can be one Sheet shared across sources (with a `log_<source>` tab
  naming convention) or a dedicated Sheet per source, depending on volume
- `ADMIN_CHAT_IDS` / admin-identity equivalent — who can mutate the whitelist live

### On-demand whitelist control

Rather than an env var requiring redeploy, the whitelist lives in the `config` tab
and is mutated live via control commands sent through the source itself (here:
Telegram `/allow`, `/deny`, `/list` from an admin chat). The webhook reads the
whitelist fresh on every request, so changes apply immediately.

### Reusing this for a new source

1. Copy the `api/telegram-webhook.js` shape: verify-secret -> parse message ->
   control-command branch -> whitelist check -> append to a `log` (sub-)tab.
2. Reuse `lib/sheets.js` as-is if writing into the same Sheet (add a new tab per
   source, or parameterize the tab name).
3. Write a source-specific reply helper analogous to `lib/telegram.js` only if that
   source supports sending an ACK back (not all do).
4. Document the new source's env vars in `.env.example` and add its setup steps to
   `README.md`.

## Current status

- [personal-secretary](.) implements the Telegram leg of this pattern.
- No other sources wired in yet as of 2026-07-06.
