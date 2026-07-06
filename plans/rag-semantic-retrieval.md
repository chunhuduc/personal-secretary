# Plan — M4: Semantic retrieval / RAG over the message log (IDEAS A1)

> Status: DRAFT — to be revised before implementation. Not started.

## Context — why this change

Today the pipeline only appends every Telegram message to a Google Sheet. To use that
history as context (while coding / brainstorming), the only option is to pull the *whole*
log and ask an AI to filter it — which doesn't scale in tokens, latency, or accuracy as
the log grows. The fix is **semantic retrieval (RAG)**: embed each message into a vector,
store vectors in a DB, and at query time fetch only the top-K messages most similar in
*meaning* to the question. Only those go into Claude's context.

This is the near-term feature that makes the bot genuinely useful for personal use, and
it is the technical foundation for later ideas (A2 secretary actions, B1 proactive voice,
S5 reminders, S6 `/ask`). It is milestone **M4** in `MASTER_PLAN.md`.

### Decisions already made (with the user)

- **Store: Neon** (serverless Postgres + `pgvector`). Free tier with no time limit,
  good Vercel fit, and the base for later multi-user/SaaS work.
- **Sheet stays as the free-tier, human-readable ledger.** Sheet-sync must remain a
  standalone feature that does **not** depend on embedding. → In the webhook, the Sheet
  append is **required**; the Neon embed+insert is **best-effort** (own try/catch, failure
  is swallowed and logged, never blocks the Sheet write or the 200 response).
- **Embedding model: OpenAI `text-embedding-3-small`** (1536 dims). Cost is negligible
  (~$0.02 / 1M tokens ≈ $0.40 per 1M messages), so per-message embedding is fine.
- **Read path: core search module → HTTP endpoint first (testable) → MCP server wraps it
  later.** Both share one search function.
- **Multi-tenancy baked in now (IDEAS S7):** every row carries an `owner_id`, defaulted
  from env for the single-user phase, so multi-user isolation later isn't a retrofit.
- **This reverses the CLAUDE.md invariant "no separate DB — the Sheet is the store."**
  The plan updates that invariant explicitly.

## Existing code to reuse / touch

- `lib/sheets.js` — `appendLog()` and the `getSheetsClient()` pattern (cached client from
  a base64 service-account env var). New DB/embedding clients follow the same
  cache-per-warm-instance shape. **Do not** change the Sheet write path or `values.append`.
- `api/telegram-webhook.js` — `handler()`. Add the best-effort Neon step after the
  existing `appendLog()` call, inside its own try/catch, before the 200 response.
- `.env.example` — the committed env contract (currently 4 vars); add the new ones.
- `vercel.json` — currently only registers the webhook function; add the new query fn.
- `scripts/sanity-check.js` — offline, no-network logic check; extend so new modules fail
  clearly (not cryptically) when their env vars are absent, mirroring the existing
  `GOOGLE_SERVICE_ACCOUNT_JSON` assertion.
- `scripts/init-sheet.md` — style reference for a new `scripts/init-neon.md` setup guide.
- `FINDINGS.md`, `WORKFLOW.md`, `MASTER_PLAN.md`, `CLAUDE.md` — doc updates.

## New env vars (add to `.env.example`)

- `DATABASE_URL` — Neon connection string (pooled, `?sslmode=require`).
- `OPENAI_API_KEY` — for embeddings.
- `OWNER_ID` — tenant id stamped on rows in the single-user phase (e.g. your Telegram
  user id or a fixed slug). Defaults retrieval to this owner too.
- `EMBEDDING_MODEL` (optional, default `text-embedding-3-small`).
- `SEARCH_TOP_K` (optional, default `20`).

## Dependencies

- `@neondatabase/serverless` — HTTP/WebSocket Postgres driver that works cleanly in Vercel
  serverless (avoids TCP connection-limit issues). Use its tagged-template `sql` for
  parameterized queries.
- `openai` — official SDK for the embeddings call (or a thin `fetch` wrapper to avoid the
  dep; decide at implementation — leaning on the SDK for clarity).

## Implementation steps

### 1. Neon setup (manual, documented) — `scripts/init-neon.md`

Write a setup guide mirroring `init-sheet.md`:
- Create a Neon project, copy the pooled `DATABASE_URL`.
- `CREATE EXTENSION IF NOT EXISTS vector;`
- Schema:
  ```sql
  CREATE TABLE messages (
    id            bigserial PRIMARY KEY,
    owner_id      text        NOT NULL,
    chat_id       text        NOT NULL,
    chat_name     text,
    sender        text,
    text          text        NOT NULL,
    ts            timestamptz NOT NULL,
    raw_date_unix bigint,
    embedding     vector(1536)
  );
  CREATE INDEX ON messages USING hnsw (embedding vector_cosine_ops);
  CREATE INDEX ON messages (owner_id, chat_id, ts);
  ```
  (`owner_id` column + index is the S7 groundwork; RLS deferred until real multi-user.)

### 2. `lib/embeddings.js` (new)

- `getOpenAIClient()` — cached per warm instance; throws a **clear** error if
  `OPENAI_API_KEY` is missing (mirror `lib/sheets.js`'s missing-env pattern).
- `export async function embed(text)` → returns `number[]` (1536). Reads
  `EMBEDDING_MODEL` (default small). Trims/guards empty text.

### 3. `lib/db.js` (new)

- `getSql()` — cached Neon client from `DATABASE_URL`; clear error if unset.
- `export async function insertMessage({ ownerId, chatId, chatName, sender, text, ts,
  rawDateUnix, embedding })` — parameterized INSERT. Embedding passed as a pgvector
  literal.
- `export async function searchMessages({ ownerId, queryEmbedding, k, chatId? })` —
  `SELECT ... ORDER BY embedding <=> $q LIMIT k`, filtered by `owner_id` (and optional
  `chat_id`). Returns rows with a similarity score. This is the single shared search core.

### 4. Wire the write path — `api/telegram-webhook.js`

After the existing required `appendLog(...)` (unchanged), add a best-effort block:
```js
// Best-effort: embed + index into Neon for semantic retrieval.
// Must never block the Sheet write or the 200 response (free-tier Sheet
// sync stays independent of the RAG layer).
try {
  const text = message.text || message.caption || '';
  if (text.trim()) {
    const embedding = await embed(text);
    await insertMessage({
      ownerId: process.env.OWNER_ID,
      chatId: message.chat.id, chatName: chatDisplayName(message.chat),
      sender: senderDisplayName(message.from), text,
      ts: new Date().toISOString(), rawDateUnix: message.date, embedding,
    });
  }
} catch (err) {
  console.error('rag index (non-fatal):', err);
}
```
The outer 200-always contract is untouched.

### 5. Read path core + HTTP endpoint — `api/search.js` (new)

- Auth: require a shared secret header (reuse the `TELEGRAM_WEBHOOK_SECRET` pattern, or a
  new `SEARCH_SECRET`) so the endpoint isn't open. Reject with 401 otherwise.
- Body: `{ query, k?, chatId? }`. Defaults `owner_id = OWNER_ID`, `k = SEARCH_TOP_K`.
- Flow: `embed(query)` → `searchMessages(...)` → return JSON
  `{ results: [{ text, chat_name, sender, ts, score }] }`.
- Register in `vercel.json` with a short `maxDuration`.

### 6. MCP server — `mcp/search-server.js` (new, thin)

- A stdio MCP server exposing one tool, e.g. `search_messages(query, k?, chatId?)`, that
  calls the **same** `searchMessages` core (import `lib/db.js` + `lib/embeddings.js`
  directly; no need to go through the HTTP endpoint locally).
- Document how to register it in Claude Code (`.mcp.json` / `claude mcp add`) in WORKFLOW.
- This is the "ask my log while coding/brainstorming" experience.

### 7. Backfill — `scripts/backfill-embeddings.js` (new)

- Read existing rows from the Sheet `log!A:F` (reuse the Sheets client).
- For each row without a Neon counterpart, `embed()` + `insertMessage()`. Batch and rate-
  limit gently. Idempotent (skip rows already present — e.g. de-dupe on
  `(chat_id, raw_date_unix, text)` or track a checkpoint).
- One-off `node scripts/backfill-embeddings.js`.

### 8. Sanity + docs

- `scripts/sanity-check.js`: add offline assertions that `lib/db.js` and
  `lib/embeddings.js` throw clear errors when `DATABASE_URL` / `OPENAI_API_KEY` are unset
  (no network), matching the existing style. Assert `api/search.js` returns 401 without
  the secret.
- `.env.example`: add the new vars with comments.
- `FINDINGS.md`: new entries — Sheet append required vs. Neon embed best-effort;
  `@neondatabase/serverless` chosen for serverless connection handling; embedding cost is
  negligible; `owner_id` stamped from day one.
- `WORKFLOW.md`: new flows — "Set up Neon + run backfill", "Register the search MCP server".
- `MASTER_PLAN.md`: flip M4 to in-progress.
- `CLAUDE.md`: update the "No separate DB" invariant to reflect Neon as the retrieval
  index (Sheet still the ledger + atomic-append target); note the best-effort write rule
  and the `owner_id` convention.

## Verification (end-to-end)

1. `npm run sanity` — passes with new offline assertions (no network).
2. Neon: run `scripts/init-neon.md` SQL; confirm `\d messages` and the vector extension.
3. Local write test: invoke the webhook handler (as sanity does) with a fake message +
   real `DATABASE_URL`/`OPENAI_API_KEY`; confirm a row with a non-null `embedding` lands
   in Neon, and that a **forced embed failure still returns 200** and still wrote to Sheet.
4. Backfill: run `scripts/backfill-embeddings.js` against the existing log; confirm counts
   match and reruns are idempotent.
5. Read test: `curl` `api/search.js` (deployed or `vercel dev`) with the secret and a
   query whose answer uses *different words* than the stored message (proves semantic, not
   keyword, match). Confirm 401 without the secret.
6. MCP test: register `mcp/search-server.js` in Claude Code, ask a question, confirm it
   returns relevant top-K messages that then inform the answer.

## Out of scope (later ideas, not this plan)

- Session chunking + summaries (S1), hybrid keyword+vector search (S4), reminder engine
  (S5), `/ask` in-chat command (S6), Postgres RLS enforcement, usage metering (S8). The
  `owner_id` column is the only forward-hook included now.
