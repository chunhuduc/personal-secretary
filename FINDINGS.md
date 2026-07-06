# FINDINGS.md — personal-secretary

Non-obvious facts learned the hard way, so a future session doesn't re-derive them.
Append newest at the top. Each entry: **what**, **why it matters**, **so do this**.

---

## Sheet append is required; Neon embed is best-effort (M4)
- **What:** In the webhook, `appendLog()` to the Sheet is the required write path. The Neon embed + insert runs in its own try/catch immediately after — a failure is logged and swallowed; it never blocks the Sheet write or the 200 response.
- **Why it matters:** The Sheet is the free-tier human-readable ledger that must stay alive even when OpenAI or Neon is down. Coupling the required path to the best-effort path would cause Telegram retries whenever the embedding service hiccups.
- **So do this:** Never move the Neon step outside its best-effort try/catch, and never make `appendLog()` depend on a successful embed.

## `@neondatabase/serverless` chosen over raw `pg` for Vercel serverless
- **What:** `lib/db.js` uses `neon()` from `@neondatabase/serverless` (HTTP/WebSocket Postgres) rather than the standard `pg` package.
- **Why it matters:** Standard `pg` uses TCP connections which conflict with Vercel's serverless connection limits. The Neon HTTP driver makes a fresh HTTPS request per query — no connection pool exhaustion under concurrent invocations.
- **So do this:** Keep `@neondatabase/serverless` as the driver. Don't swap in `pg` or `postgres` (node-postgres).

## Embedding cost is negligible; embed per message, not per session
- **What:** OpenAI `text-embedding-3-small` costs ~$0.02 / 1M tokens, which is ~$0.40 per 1M messages at typical chat-message lengths.
- **Why it matters:** Session-level chunking (IDEAS S1) is a future optimization — it's not needed to keep costs under control at the volumes this project targets.
- **So do this:** Embed every message individually (current approach). Don't add batching complexity until volume actually demands it.

## `owner_id` is stamped on every row from day one (M4 / IDEAS S7)
- **What:** Every `messages` row carries an `owner_id` column, defaulted from the `OWNER_ID` env var. All reads (search) are filtered by `owner_id`.
- **Why it matters:** Adding multi-user isolation as a retrofit after rows are already in the table would require a migration and backfill. Baking it in now makes the SaaS path (C1–C3) a configuration change, not a schema change.
- **So do this:** Always set `owner_id` in `insertMessage()` and always filter by it in `searchMessages()`. Don't skip it even in single-user mode.

## Webhook must return 200 even on internal errors
- **What:** Telegram retries delivery on any non-2xx response.
- **Why it matters:** If a Sheets write fails and we return 500, Telegram re-sends the
  same update repeatedly — a retry storm that can duplicate rows or hammer the function.
- **So do this:** After the secret check passes, always `res.status(200)`, even in the
  `catch`. Log the error server-side; don't surface it as a non-200. See
  `api/telegram-webhook.js`.

## Telegram bot privacy mode must be OFF to see group messages
- **What:** By default a bot only receives messages that mention/command it.
- **Why it matters:** Without disabling privacy, group chats log almost nothing.
- **So do this:** BotFather → `/setprivacy` → select bot → **Disable**. Bot must be
  re-added to existing groups for the change to take effect.

## Scope is presence-based, and it's Telegram-specific
- **What:** The bot logs a chat iff it's currently a member — no whitelist in code.
- **Why it matters:** It's tempting to generalize this to every future source, but a
  source like email can't be "added/removed per conversation."
- **So do this:** For non-membership sources, design a separate scoping mechanism. Don't
  copy the presence-based assumption blindly. (An earlier `config`-tab whitelist +
  `/allow` `/deny` `/list` commands was removed as redundant for Telegram — see git log.)

## Service-account JSON is stored base64-encoded in one env var
- **What:** `GOOGLE_SERVICE_ACCOUNT_JSON` holds the *base64* of the whole key file,
  decoded and `JSON.parse`d at runtime.
- **Why it matters:** Multiline JSON with real newlines doesn't survive env-var config
  cleanly; base64 is a single safe line. A raw paste will fail to parse.
- **So do this:** Encode with `base64 -w0 service-account.json` (Git Bash) or
  `[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))` (PowerShell).

## `values.append` is chosen specifically to avoid a write race
- **What:** All writes go through `spreadsheets.values.append`, never read-then-write.
- **Why it matters:** Concurrent webhook invocations doing read-modify-write on a Sheet
  would clobber each other's rows. `append` is atomic server-side.
- **So do this:** Keep the single append path in `lib/sheets.js`. Don't add a
  read-before-write anywhere in the hot path.

## The service account must be granted Editor on the Sheet
- **What:** Auth alone isn't enough — the Sheet has to be *shared* with the service
  account's `client_email` as Editor.
- **Why it matters:** Otherwise appends fail with a permission error at runtime, not at
  deploy.
- **So do this:** Share the Sheet with
  `vera-secretary@personal-secretary-501607.iam.gserviceaccount.com` (Editor).
