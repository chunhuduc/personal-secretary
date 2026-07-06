# MASTER_PLAN.md — personal-secretary

The roadmap and current status. Update the status block whenever a milestone
starts or finishes. Keep dates absolute.

## Goal

**North star:** turn the passive Telegram→Sheet log into a proactive, semantic-aware
**virtual secretary**, packaged as a small **SaaS** for me + friends first (free tier
now, paid tiers later). See `IDEAS.md` for the full idea backlog (groups A–D + suggested).

The original foundation still holds: a reusable **messaging-source → store → Claude**
pipeline. Telegram is the first leg; the shape is meant to be copied for future sources
(Zalo, a second email, Slack).

## Current status — as of 2026-07-06

**Phase: Telegram leg built locally, not yet deployed. Next feature after go-live:
semantic retrieval (RAG) — see M4.**

- [x] GCP project `personal-secretary-501607` + service account
      `vera-secretary@personal-secretary-501607.iam.gserviceaccount.com`
- [x] Google Sheet created (`1gfIbjF0Xhx6Gk4_iCw4gqrIDiXrlX2WGblw-5cAMlS0`), `log` tab
      headers set, shared with the service account as Editor
- [x] `.env` fully populated (bot token, webhook secret, service-account JSON b64, sheet id)
- [x] Code written and sanity-checked locally (`npm run sanity`)
- [ ] **NEXT: `vercel deploy`** with the 4 env vars set in the Vercel project
- [ ] Register webhook: run `scripts/set-webhook.ps1` (or `.sh`) against the deployed URL
- [ ] End-to-end test: send a Telegram message → confirm a row lands in the `log` tab
- [ ] Confirm Claude can read the Sheet via the Google Drive MCP

## Milestones

### M1 — Telegram leg live (in progress)
Deploy to Vercel, register the webhook, verify a real message reaches the Sheet, and
verify Claude can query it. See `WORKFLOW.md → Deploy & register webhook`.

### M2 — Second source (not started)
Add one more source to prove the pattern generalizes. Candidate: a second email account
or Zalo. Reuse `lib/sheets.js`; add a `log_<source>` tab. **Watch out:** email can't
gate scope by bot membership like Telegram — it may need its own whitelist. Read
`WORKSPACE_CONTEXT.md` before starting.

### M3 — Query ergonomics (folded into M4)
Superseded: the "keep Sheet retrieval fast as it grows" concern is answered by moving
machine-retrieval to a vector index (M4). Session chunking / summary index (IDEAS S1)
stays a later refinement on top of M4.

### M4 — Semantic retrieval / RAG (NEXT — chosen to plan now)
Make the bot genuinely useful for personal use: stop stuffing the whole log into context;
embed each message and retrieve only the top-K relevant ones per query. This is IDEAS
**A1** and the technical foundation for A2 (secretary actions), B1 (proactive voice), and
suggested S5/S6.

- **Store decision (made):** add **Neon** (serverless Postgres + pgvector). Free tier
  with no time limit, good Vercel fit, and the base for the later multi-user/SaaS work
  (C1–C3, D1). This **overrides the "no separate DB" invariant** below — Sheet stays as
  the human-readable ledger, Neon becomes the machine-retrieval index.
- **Migration tool decision (made):** **Drizzle** (`drizzle-orm` + `drizzle-kit`) manages
  the Neon schema and all future migrations — no hand-written SQL DDL beyond enabling the
  `pgvector` extension once. `drizzle-orm` has native pgvector support (`vector()` column
  type, `cosineDistance()`/`l2Distance()` SQL helpers), so the query layer in `lib/db.js`
  is Drizzle too, not raw `@neondatabase/serverless` tagged templates. Applies to any
  future Postgres table, not just `messages`.
- **Scope (high level; detailed plan — currently DRAFT — in
  `plans/rag-semantic-retrieval.md`):**
  1. Neon schema: `messages(id, owner_id, chat_id, chat_name, sender, text, ts,
     raw_date_unix, embedding vector)`.
  2. Write path: on each webhook, `appendLog()` to Sheet stays **required** (unchanged,
     free-tier sync must not depend on the rest); embed + INSERT into Neon is
     **best-effort** in its own try/catch — a Neon/OpenAI failure never blocks the Sheet
     write or the 200 response.
  3. Backfill: one-off script to embed existing Sheet rows into Neon.
  4. Read path: embed the query, `ORDER BY embedding <=> q LIMIT K` (pgvector cosine).
  5. Expose to Claude via a small MCP vector-search server (not Drive-MCP-reads-whole-Sheet).
- **Bake in early (from IDEAS S7):** tag every row/vector with an owner/tenant id now, so
  multi-user isolation later isn't a painful retrofit.

## Open questions / decisions to make

- One Sheet with per-source tabs, or a Sheet per source? (Leaning: one Sheet, `log_<source>`
  tabs, until volume forces a split.)
- Retention: does the log grow unbounded, or do we archive/rotate old rows? Undecided.
- For non-membership sources (email), what replaces presence-based scope? Undecided —
  becomes concrete at M2.
- Embedding model + dimensions (leaning OpenAI `text-embedding-3-small`); K for top-K
  retrieval; whether to embed per-message or per-session (S1). Decided in the M4 plan.

## Non-goals

- No message *history backfill* — the bot only sees messages sent after it joins.
- No admin commands / whitelist tab (deliberately removed; see git history).
- ~~No separate DB — the Sheet is the store.~~ **Reversed at M4:** Neon (Postgres +
  pgvector) is added as the machine-retrieval index. The Sheet remains the human-readable
  ledger and the atomic-append write target; it is no longer the *only* store. Update
  `CLAUDE.md`'s invariant when M4 starts.
