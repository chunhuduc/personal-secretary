# Plan — M5: Virtual secretary actions (IDEAS A2)

> Status: DRAFT — to be revised before implementation. Not started.

## Context — why this change

Today the pipeline is passive: it logs every Telegram message to a Sheet (M1) and,
once M4 ships, indexes each message into Neon for semantic retrieval. The bot never
*acts* and never *speaks* — Claude only reads the log externally via MCP.

A2 is the original product vision: the bot **auto-operates in a chat** — takes notes,
summarizes, sets reminders, creates calendar events, and feeds relevant context to an
LLM to continue brainstorming. It "uses a system-default API key" and "auto-selects
model by problem complexity" (`IDEAS.md` A2). M4 (retrieval) is the foundation it
stands on: actions that need history pull it via semantic search rather than dumping the
whole log.

This introduces **two firsts** for the project:
- The **first server-side LLM calls** (an Anthropic client inside the serverless
  function, not Claude reading externally via MCP).
- The **first outbound Telegram messages** (a send-back path — the bot has only ingested
  until now).

It is milestone **M5** in `MASTER_PLAN.md`.

## Decisions already made / recommended

- **Best-effort, non-blocking.** Actions run after the required `appendLog()`, in their
  own try/catch, and never block the Sheet write or the always-200 response (see
  `FINDINGS.md` "Webhook must return 200"). The M4 Neon write already follows this shape;
  A2 follows it too.
- **Phase it** so the trigger-model question doesn't block everything:
  - **Phase 1 — command-triggered (MVP).** The owner explicitly invokes actions via
    leading command tokens: `/summarize`, `/note <text>`, `/todo <text>`, `/act
    <prompt>` (and `/ask <question>` if S6 is built alongside). Deterministic, cheap, no
    noise gate, no per-message LLM cost. This is the recommended first slice.
  - **Phase 2 — proactive / auto (north-star).** Every message passes a cheap gate (one
    Haiku classification: "is this actionable?"); only actionable messages escalate to a
    full action pass. This is where B1's "is this worth interrupting?" gate and the
    proactive send-back live. Deferred behind Phase 1; needs cost caps + noise control.
- **LLM = Claude, model routed by complexity.** A cheap model for the gate/simple
  actions, a stronger one for reasoning. See `lib/llm.js` below.
- **Notes stored in the Sheet** (new `notes` tab), consistent with the "Sheet is the
  human-readable ledger" philosophy; optionally mirrored to Neon later.
- **The Telegram send-back path is shared infra.** A2, S5 (reminders), and S6 (`/ask`)
  all need to send messages back — build it once in `lib/telegram.js`.

## Existing code to reuse / touch

- `api/telegram-webhook.js` — `handler()`. Add command parsing + dispatch after the
  existing `appendLog()` (and after the M4 best-effort embed), inside its own try/catch,
  before the 200. The always-200 contract is untouched.
- `lib/sheets.js` — `getSheetsClient()` + `appendLog()` shape. Reuse the **same** client
  for the new `notes` tab by parameterizing the range/tab (per the CLAUDE.md invariant:
  same service account, same Sheet, new tab — do **not** spin up a second Sheets client).
- `lib/db.js` + `lib/embeddings.js` (from M4) — `searchMessages()` / `embed()` to pull
  relevant history as context for `summarize` / `/act` brainstorming.
- `FINDINGS.md` — the always-200 rule and the base64 service-account note.
- `.env.example`, `vercel.json`, `scripts/sanity-check.js`, `MASTER_PLAN.md`, `CLAUDE.md`,
  `WORKFLOW.md` — doc / config updates.

## New components

### `lib/llm.js` (new)

- Cached Anthropic client (`@anthropic-ai/sdk`) from `ANTHROPIC_API_KEY`; throws a
  **clear** error if the key is missing (mirror `lib/sheets.js`'s missing-env pattern).
- `export async function complete({ system, messages, complexity })` — a small wrapper
  with a **model router**:
  - `simple` / gate → `claude-haiku-4-5-20251001`
  - `standard` → `claude-sonnet-5`
  - `hard` → `claude-opus-4-8`

  This is the "auto-selects model by problem complexity" requirement.
- **Before writing this file, load the `claude-api` skill** for correct model IDs,
  request params, streaming/token limits, and SDK idioms.

### `lib/telegram.js` (new)

- `export async function sendMessage(chatId, text)` — POST to the Bot API `sendMessage`
  using `TELEGRAM_BOT_TOKEN`. Guard/return (with a clear log) if the token is missing.
- This is the **B1 send-back groundwork** reused by A2 / S5 / S6.

### `lib/actions/` (new) — dispatcher + handlers

- `dispatch(command, args, ctx)` — routes a parsed command to a handler; unknown command
  → a friendly reply, still 200.
- `summarize` — pull a recent window for the chat (Sheet `log` or Neon by `chat_id`,
  reusing `searchMessages()` / the Sheets client) → `complete()` → reply text.
- `note` / `todo` — `complete()` extracts a structured note/TODO → append to the new
  Sheet `notes` tab (`timestamp | chat_id | type | content | source_msg`) via the reused
  Sheets client → confirmation reply.
- `reminder` — minimal parse of due-time + text, stored; **S5 is the fuller engine** —
  A2 ships only a minimal version and explicitly defers the scheduler/firing to S5.
- `calendar` (Phase 2 / stretch) — create a Google Calendar event. **Flag:** calendar
  access from a deployed serverless function is non-trivial — the service account needs
  domain-wide delegation or a shared calendar, or a stored OAuth refresh token. Spike
  required; likely deferred out of the MVP.

## New env vars (add to `.env.example`)

- `ANTHROPIC_API_KEY` — the system-default LLM key.
- `SECRETARY_ENABLED` (optional) — feature flag to gate the whole action layer.
- (Phase 2 calendar) `GOOGLE_CALENDAR_ID` + a delegation/OAuth secret — TBD in the spike.

## Dependencies

- `@anthropic-ai/sdk` — server-side Claude calls. (Consult the `claude-api` skill.)
- No new dep for the Telegram send path (plain `fetch` to the Bot API).

## Implementation steps

1. **`lib/telegram.js`** — the `sendMessage()` send-back path.
2. **`lib/llm.js`** — cached Anthropic client + `complete()` model router (load the
   `claude-api` skill first).
3. **`lib/actions/`** — dispatcher + `summarize`, `note`/`todo`, minimal `reminder`.
4. **New Sheet tab `notes`** — document setup in `scripts/init-sheet.md` (or a note in
   `scripts/init-neon.md` if mirrored to Neon); parameterize the range in `lib/sheets.js`.
5. **Wire `api/telegram-webhook.js`** — parse a leading `/command`, dispatch, reply via
   `lib/telegram.js`; all best-effort in its own try/catch, still always-200, still logs
   to the Sheet first.
6. **Sanity + docs** — see below.

## Open decisions (resolve at implementation)

1. Trigger model: command-triggered (Phase 1, recommended) vs proactive auto-act
   (Phase 2). Phased so it doesn't block.
2. Calendar auth feasibility from serverless (service-account delegation vs stored
   OAuth) — spike; may defer.
3. Notes/actions storage: Sheet `notes` tab (recommended) vs a Neon `actions` table vs
   both.
4. Cost controls: per-owner rate limit / daily LLM-call cap (ties to S8 metering).
5. Model-router thresholds (which actions map to which model).
6. Overlap: reminders (S5) and proactive send-back (B1) — A2 ships minimal versions; the
   full features are their own backlog items.

## Verification (end-to-end)

1. `npm run sanity` — extended offline assertions: `lib/llm.js` and `lib/telegram.js`
   throw clear errors without their env vars; the command parser routes a fake
   `/summarize` / `/note` message correctly; an unknown command or a missing key still
   returns 200 and the message is still logged to the Sheet.
2. Live: `/summarize` in a chat with history → the bot replies with a summary.
3. Live: `/note buy milk` → a row lands in the `notes` tab + a confirmation reply.
4. Force an LLM failure (bad key) and confirm the webhook still returns 200 and still
   wrote the message to the Sheet (best-effort discipline holds).

## Out of scope (later ideas, not this plan)

- The full reminder scheduler/firing engine (S5), proactive "worth interrupting?" gating
  and unprompted messages (B1), owner↔bot behavior tuning (B2), usage metering/quotas
  (S8), and multi-user isolation (S7). A2 ships command-triggered actions + a minimal
  reminder + the shared send-back path; the proactive layer is Phase 2.
