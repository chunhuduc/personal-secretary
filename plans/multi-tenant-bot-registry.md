# Plan — Multi-tenant bot registry (operator-provisioned) — SaaS foundation

> IDEAS **C1 + C2 + D1**, on **S7** (isolation), touching **S9** (secrets).
> Proposed milestone: **M6 — Multi-tenant / bot registry**. Pulled ahead of M5
> (secretary actions) because a friend wants to use the secretary now.

## Context — why this change

Today the pipeline is single-tenant: one bot, one owner, one Sheet, all wired through
single env vars (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `OWNER_ID`, `SHEET_ID`).
A friend now wants their own secretary. The goal is a **small multi-tenant foundation**:
the operator (me) can add / assign / disable **multiple Telegram bots**, each belonging to a
different owner with isolated data, **without a redeploy per bot**.

Neon already stamps `owner_id` on every row (S7). What's missing is a **bot registry** so
incoming updates route to the right owner, and a **CLI** to provision a bot at runtime.

## Onboarding model — operator-provisioned (decided)

Bot creation and privacy-mode-off are **BotFather-only** (no Telegram API for either), so a
human does them regardless. Since a token would be leaked if it ever transited a logged chat,
the operator handles all secret-touching steps. This makes both sides simpler.

**Friend's journey (2 steps, zero secrets):**
1. I send: "Here's your secretary — `t.me/<their_bot>`. Send it this code to activate:
   `<claim-code>`."
2. They open the bot and send `/start <claim-code>`. That **binds** the bot to them (their
   `telegram_user_id` is captured — see "1:1 binding" below). Done. If they later want the raw
   Sheet, they text me their Google email and I share it as viewer (manual, rare).

## 1:1 binding + scope enforcement (decided)

A Telegram bot is a **public account** — anyone who knows its @username can DM it or add it to
a group. So the registry must bind each bot to **its one owner** and enforce that, or a
stranger's messages would land in the owner's Sheet. Two layers:

**Binding (claim code, first-claim-wins).** The operator doesn't know the friend's numeric
`telegram_user_id` at provisioning time. So `register-bot.js` generates a one-time
**claim code** stored on the bot row (`claim_code`, `owner_telegram_user_id` NULL). The friend
sends `/start <code>`; the webhook validates it, stamps `from.id` as the owner's
`telegram_user_id`, and clears the code. First valid claim wins; afterward the bot is bound and
further `/start <code>` are ignored. Handles "I don't know their id" and "a stranger races the
claim" together.

**Enforcement — DM + owner-present groups (decided).** Once bound:
- **Private chats:** serve only if `from.id == owner_telegram_user_id`; else ignore (optionally
  a one-line "this is a private assistant" reply). Still 200.
- **Group/supergroup chats:** serve only if the **owner is a member** of that group, verified
  via Telegram **`getChatMember(chatId, ownerTelegramUserId)`** (works for a regular non-admin
  bot; `creator`/`administrator`/`member` = present, `left`/`kicked`/error = absent). To avoid a
  `getChatMember` call on every group message, **cache the per-group verdict** in an
  `allowed_chats` table (verify on first sight / on the `my_chat_member` add event; re-verify
  lazily on a TTL and on membership-change updates). Groups where the owner isn't present are
  ignored (and the bot may `leaveChat`).

This **overturns the current CLAUDE.md "No whitelist — presence-based scope" invariant** (a
single-tenant assumption); the plan updates it. BotFather `/setjoingroups Disable` is available
per bot as an extra platform-level hardening (blocks group add at Telegram's side entirely), but
the scope gate above is the primary enforcement and works regardless.

**Operator's per-friend work (~3-5 min, once):** BotFather `/newbot` → `/setprivacy` **Disable**
→ create + share their spreadsheet (Sheets UI) → run one CLI command with the token + owner +
sheet id. Bots live under my BotFather account.

**Why not self-serve now:** self-serve can't automate the BotFather steps (the hard part), yet
it forces the heaviest backend — a public token-accepting endpoint, `drive.file` scope + an
SA-ownership spike, and an invite-code system. That's the *public-launch* path; overkill for
"me + a few friends" (D1). Deferred to Out of scope.

## Locked decisions

- **Sheets:** one master **service account** (mine) is Editor on every spreadsheet; each owner
  gets a **separate spreadsheet** I create and share to them as **viewer**. Each owner row
  stores its `sheet_id`. Reuses the single `lib/sheets.js` client/auth — only `spreadsheetId`
  varies per write. **No new Google scope needed** (SA still only writes; I share manually in
  the UI).
- **Bot tokens: encrypted at rest** (AES-256-GCM, key from `SECRETS_KEY`). Webhook secrets
  stored **hashed** (sha256), never raw. Token never enters a chat (CLI-only handling).
- **Assume Drizzle is set up** by the other agent (`drizzle-orm` + `drizzle-kit`,
  `lib/schema.js`, `drizzle.config.js`, `drizzle/`). New tables are Drizzle schema additions;
  migrations via `drizzle-kit generate`. No hand-written DDL.
- **Validate the token via Telegram `getMe`** in the CLI before storing (fail loudly on typo).

## Architecture

### Webhook routing for N bots — dynamic path route
Replace `api/telegram-webhook.js` with **`api/telegram-webhook/[botId].js`**. Each bot's
`setWebhook` targets `<PUBLIC_BASE_URL>/api/telegram-webhook/<botId>` with its own
`secret_token`. Flow (all invariants preserved):
1. `botId` from `req.query.botId`; unknown/disabled → **404** before any work.
2. Verify `X-Telegram-Bot-Api-Secret-Token` against the bot's stored **secret hash** →
   mismatch **401**.
3. From here **always 200** (Telegram retries on non-200).
4. Resolve `{ ownerId, sheetId, ownerTgId, claimCode }` from the registry (cached per warm
   instance, ~60s TTL so a disable takes effect within ~a minute).
5. **Binding gate:** if the bot is unbound (`owner_telegram_user_id` NULL) and the update is
   `/start <claim-code>` matching, bind it (stamp `from.id`, clear the code) and reply/ack.
   Any other update to an unbound bot is ignored (200).
6. **Scope gate:** drop the update unless it passes enforcement — private chat from the bound
   owner, or a group where the owner is present (cached `allowed_chats` verdict; see
   enforcement above). Non-matching updates are ignored (200), never logged.
7. **Required:** `appendLog({ sheetId, ... })` to that owner's spreadsheet.
8. **Best-effort:** `embed()` + `insertMessage({ ownerId, botId, ... })` — own try/catch,
   never blocks the 200.

Identity (path) is separate from auth (secret). The **receive path never decrypts a token**,
keeping secret exposure to the provision path only. The binding + scope gates run **before**
the Sheet write, so a stranger's message is never logged.

## Drizzle schema additions (`lib/schema.js`)

`owners.id` is **text**, matching the existing `messages.owner_id` (no data migration; the
current `OWNER_ID` becomes the seed owner's id).

- **`owners`**: `id text PK` (slug, e.g. `duc`, `friend1`) · `name text` ·
  `telegram_user_id text` (nullable until claimed) · `email text` (nullable; only if they want
  the Sheet shared) · `sheet_id text` · `tier text default 'free'` ·
  `is_admin boolean default false` · `created_at timestamptz default now()`.
- **`bots`**: `id bigserial PK` (used in the webhook path) · `owner_id text` FK → `owners.id`
  · `name text` · `token_encrypted text` (`iv:authTag:ciphertext`, base64) ·
  `webhook_secret_hash text` · `claim_code text` (nullable; one-time, cleared on bind) ·
  `enabled boolean default true` · `created_at`. (The bound owner id is read via `owner_id` →
  `owners.telegram_user_id`.)
- **`allowed_chats`**: `bot_id bigint` + `chat_id text` (PK pair) · `allowed boolean` ·
  `checked_at timestamptz` — cached `getChatMember` verdict for group scope, re-verified on TTL
  / membership-change.
- **`messages`**: add nullable `bot_id bigint` (provenance; `owner_id` stays the isolation key).

Generate + apply with `drizzle-kit generate` / `migrate`.

## Files to create

- **`lib/crypto.js`** — AES-256-GCM `encrypt`/`decrypt` (Node `crypto`, 32-byte `SECRETS_KEY`
  base64) + `hashSecret()` (sha256 hex). Clear error if the key is missing/wrong length
  (mirror `lib/sheets.js`).
- **`lib/registry.js`** — `getBot(botId)` →
  `{ id, ownerId, sheetId, ownerTgId, claimCode, secretHash, enabled }`, cached per warm
  instance (~60s TTL). The request-time bot→owner→sheet resolver. Also `bindBot(botId, tgUserId)`
  (stamp owner tg id + clear claim code, first-claim-wins), and `getChatVerdict(botId, chatId)` /
  `setChatVerdict(...)` over `allowed_chats`.
- **`lib/telegram-api.js`** — thin `fetch` wrappers over the Bot API for the **receive-side**
  calls the scope gate needs: `getChatMember(token, chatId, userId)`, and (optional)
  `sendMessage` for the `/start` ack + `leaveChat` for disallowed groups. This is the one place
  the webhook path decrypts a token (only when a group verdict must be (re)checked or a reply
  sent) — kept minimal and separate from the send-back path M5 will build.
- **`api/telegram-webhook/[botId].js`** — the dynamic handler (flow above, incl. binding +
  scope gates). Move the `extractMessage` / `chatDisplayName` / `senderDisplayName` helpers into
  **`lib/telegram-format.js`** (shared, not duplicated).
- **`scripts/register-bot.js`** — operator CLI. Args:
  `--owner <id> --token <botfather-token> --name <botName> --sheet <sheetId> [--email <addr>]`.
  Steps: ensure the owner exists (create if new, with `sheet_id`/`email`); `getMe`-validate the
  token; generate a random webhook secret **and a claim code**; `encrypt` the token +
  `hashSecret` the secret; insert the `bots` row (with `claim_code`, `owner_telegram_user_id`
  NULL); compute `<PUBLIC_BASE_URL>/api/telegram-webhook/<newBotId>`; call `setWebhook` with that
  URL + secret. **Print the `t.me/<botusername>` link + the claim code** to hand to the friend.
  Also `--disable <botId>` / `--list` for management. Token stays on the operator machine +
  encrypted in DB.
- **`scripts/seed-tenants.js`** — one-off: insert the existing owner
  (`id=OWNER_ID, sheet_id=SHEET_ID, is_admin=true`, and `telegram_user_id=<my id>` so the
  primary bot is **pre-bound** — no claim step for me) + existing bot
  (`token=encrypt(TELEGRAM_BOT_TOKEN)`, `secret_hash=hash(TELEGRAM_WEBHOOK_SECRET)`,
  `name='primary'`, `claim_code=NULL`); print the new webhook URL to re-point the primary bot.

## Files to modify

- **`lib/sheets.js`** — `appendLog({ sheetId, ... })`; `sheetId` defaults to
  `process.env.SHEET_ID` (backward compat). One cached client (same SA), only `spreadsheetId`
  varies. **No scope change.**
- **`lib/db.js`** — `insertMessage()` accepts optional `botId`.
- **`api/telegram-webhook.js`** — delete after cutover (see migration).
- **`scripts/sanity-check.js`** — offline assertions: `lib/crypto.js` encrypt→decrypt
  round-trips + errors clearly without `SECRETS_KEY`; `lib/registry.js` errors clearly without
  `DATABASE_URL`; the new route returns 405 (non-POST) / 401 (bad secret) / 404 (unknown bot)
  without network; **the scope gate is a pure function** — unit-test it directly (bound-owner DM
  → allow; non-owner DM → ignore; unbound bot + wrong/no claim code → ignore) with no network.
- **`.env.example`** — add `SECRETS_KEY` (32-byte base64) and `PUBLIC_BASE_URL` (for
  `setWebhook`). Annotate `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` / `OWNER_ID` /
  `SHEET_ID` as **seed-only** (bootstrap the first tenant; the registry then owns bots).
- **`vercel.json`** — register `api/telegram-webhook/[botId].js` (maxDuration 10); drop the old
  webhook entry after cutover.
- **Docs:** `CLAUDE.md` (invariants: registry is source of truth for bots/owners; one Sheets
  client / many spreadsheets; receive path never decrypts; tokens encrypted / secrets hashed;
  token never enters a chat), `MASTER_PLAN.md` (add M6 before M5), `FINDINGS.md` (bot
  creation + privacy-off are BotFather-only / not API-automatable; dynamic route + secret verify;
  encrypt-token vs hash-secret split), `WORKFLOW.md` (new flow: "Onboard a friend's bot").

## Migration / backward compatibility

1. Apply the Drizzle migration (`owners`, `bots`, `messages.bot_id`).
2. Run `scripts/seed-tenants.js` — creates the existing owner + primary bot from env vars.
   `messages.owner_id` already equals `OWNER_ID`, so existing rows stay attributed. No message
   data migration.
3. Re-point the primary bot with `setWebhook` to `/api/telegram-webhook/<primaryBotId>` (script
   prints the URL). Verify a real message still lands in the primary Sheet + Neon.
4. Delete `api/telegram-webhook.js` and its `vercel.json` entry once verified.

## Verification (end-to-end)

1. `npm run sanity` — passes with new offline assertions (crypto round-trip, registry error,
   405/401/404 on the route). No network.
2. Migration applied; confirm `owners`, `bots`, `messages.bot_id` exist in Neon.
3. Seed + re-point primary bot → real Telegram message lands in the **primary** Sheet
   (`owner_id=OWNER_ID`) + non-null Neon embedding. **No redeploy.**
4. **Second bot + binding:** in BotFather create a bot + `/setprivacy` Disable; create + share a
   friend Sheet; run
   `node scripts/register-bot.js --owner friend1 --token <t> --name friend1 --sheet <id>`
   → it prints the `t.me/...` link + claim code. Send `/start <code>` from the friend account →
   bot binds (`owner_telegram_user_id` set, `claim_code` cleared). Then a normal message lands in
   the **friend's** Sheet with `owner_id=friend1`. `searchMessages({ ownerId: 'friend1' })`
   returns only their data; the primary owner's search never sees it. **No redeploy between bots.**
5. **1:1 enforcement:** from a *different* account, DM the friend bot → **not logged** (ignored,
   still 200). Add the friend bot to a group the owner is **not** in → messages **not logged**
   (`getChatMember` says absent; optional `leaveChat`). Add it to a group the owner **is** in →
   messages **are** logged. Replay `/start <code>` from a stranger after binding → ignored.
6. `--disable <friendBotId>` → within ~60s its messages stop logging (404 / short-circuit).
7. Negative: bad secret → 401; unknown `botId` → 404; forced internal error after auth →
   still 200 (no retry storm). Bad token in the CLI → `getMe` fails, nothing stored.

## Security callouts

- **Bot tokens in the DB** are AES-256-GCM encrypted; key in `SECRETS_KEY`. A combined DB +
  env-key leak exposes tokens. Acceptable for me + friends; revisit with a KMS / secrets manager
  before any public launch. The receive path never decrypts, shrinking exposure to the
  register/rotate path (operator machine) only.
- **Webhook secrets** stored **hashed** (sha256), never raw. Rotating = new secret + `setWebhook`
  + update the hash.
- **Never paste a bot token into a Telegram chat** — it would be logged to the Sheet + Neon.
  Token handling is CLI-only.
- **Claim code** is one-time and cleared on bind. A race (stranger claims before the owner) is
  only possible in the window between the operator printing the code and the friend using it —
  acceptable for "me + friends".

## Out of scope (this milestone)

- Self-serve onboarding (friend creates their own bot + Sheet) — requires automating BotFather
  (impossible) or a hosted token-accepting endpoint + full Drive/SA spike. Public-launch path.
- Per-owner Claude config (system prompt, timezone, language) — M7+.
- Billing / usage limits — M7+.
- Zalo / email / Slack sources — unaffected; follow existing per-source pattern.
