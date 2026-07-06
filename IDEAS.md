# IDEAS.md — personal-secretary

Quick capture. Jot ideas here the moment they hit — no structure required. Later, on a
focused PC session, triage them into `MASTER_PLAN.md` (real milestones) or discard.

**Format:** one dash per idea. Optionally prefix a tag and date. Don't polish — capture.
When an idea graduates into the plan, mark it `[planned]` or delete it.

Tags (optional): `[feature]` `[fix]` `[refactor]` `[infra]` `[question]` `[wild]`

**North star:** turn the passive Telegram→Sheet log into a proactive, semantic-aware
**virtual secretary**, packaged as a small **SaaS** for me + friends first (free tier
now, paid tiers later).

---

## Inbox — my ideas (grouped)

Numbered per group for stable references. Groups are just for reading; triage order is
decided in MASTER_PLAN.

### A. Retrieval & intelligence (make the bot actually useful)

- **A1** [feature] Semantic retrieval / RAG over the log — the near-term feature to make
  the bot genuinely useful. Today it only syncs to Sheet; pulling the *whole* log and
  asking AI to filter doesn't scale. Instead: embed each message (OpenAI
  `text-embedding-3-small`), store vectors in a vector DB, then answer a query by
  embedding it and fetching top-K nearest messages (pgvector cosine) — only those go into
  Claude's context. Keep the Sheet as the human-readable ledger; the vector DB is the
  machine-retrieval index. **Breaks the CLAUDE.md invariant "no separate DB — the Sheet
  is the store"** — explicit decision needed. Chosen store: **Neon** (serverless Postgres
  + pgvector, free tier with no time limit unlike Supabase, integrates well with Vercel,
  doubles as the base for the SaaS/multi-user direction). Backfill embeddings for existing
  rows. Read path likely exposed to Claude via a small MCP server (vector-search endpoint)
  rather than the Drive MCP reading the whole Sheet.
- **A2** [feature] Virtual secretary actions — bot auto-operates in a chat: takes notes,
  summarizes, creates calendar events, sets important reminders. Feeds context to
  GPT/Claude to continue brainstorming. Uses a system-default API key; auto-selects model
  by problem complexity. (The original vision; A1 is the retrieval foundation it needs.)

### B. Proactive / agentic behavior (passive logger → active agent)

- **B1** [feature] Proactive bot voice — bot occasionally speaks up unprompted: when it
  detects something noteworthy, or after silently performing an action worth surfacing.
  Notifies either the owner (DM) or right in the group chat it works in. Needs: a
  trigger/detection layer + a "is this worth interrupting?" gate (avoid noise) + a
  send-message path back into Telegram.
- **B2** [wild] Owner ↔ bot behavior tuning — owner talks to the bot to adjust its
  behavior/personality/rules on the fly ("stop logging X", "be more proactive about
  deadlines") instead of editing code/config. Needs a stored per-bot instruction/config
  layer read at runtime. Probably far off; relates to C1.

### C. Bot & user management (the SaaS control plane)

- **C1** [feature] Bot management (CRUD) — admin can create/edit/delete bot instances
  (per Telegram bot token) instead of hardcoding one bot in `.env`. Needs a bot registry
  (DB table) instead of single-bot env vars.
- **C2** [feature] Bot-to-user assignment — assign an existing bot to a different
  user/friend so each person gets their own instance without a redeploy. Depends on C1.
- **C3** [feature] Multi-user + admin controls — support multiple users (friends,
  teammates). One bot per user (1:1); admin manages user list, bot instances, permissions,
  usage limits.

### D. Product / SaaS packaging

- **D1** [infra] Simple SaaS direction — pivot from single personal pipeline toward a
  lightweight multi-tenant service, starting small (me + a few friends), not a public
  launch yet.
- **D2** [infra] Free tier + paid tier split — current auto-sync-to-Sheet pipeline is
  solid enough to offer as the free/first feature; layer paid, fancier features on top
  later (e.g. A2 secretary features), with payment integration (Stripe/etc.) added once
  there's something worth charging for.
- **D3** [wild] Landing page — likely needed eventually for D1, but low priority; revisit
  once there's something worth marketing.

---

## Suggested — for me to approve/reject (not yet mine)

Claude-proposed, aligned to the north star. Move approved ones up into the groups above
(and drop the `S` prefix); delete the rest.

### Retrieval & intelligence
- **S1** [feature] Session/thread chunking + summaries — group messages into conversation
  sessions (by time gaps / same chat), summarize each, and embed the *summaries* too.
  Retrieval on meaningful units beats retrieval on lone one-line messages; also gives cheap
  "what happened in chat X this week" answers. Natural extension of A1.
- **S2** [feature] Daily / weekly digest — bot compiles a short recap (open threads,
  reminders due, decisions made) and DMs it to the owner on a schedule. High personal
  utility, reuses A2 + B1 plumbing.
- **S3** [feature] Entity & action extraction — as messages arrive, extract structured
  bits (dates, people, @-mentions, "TODO:" / "remind me", links) into their own columns/
  table so retrieval can filter cheaply *before* semantic search. Cuts token cost and
  sharpens results.
- **S4** [question] Hybrid search — combine keyword (BM25 / Postgres full-text) with vector
  search and merge rankings. Fixes vector-only misses on exact terms (names, IDs, error
  codes). Cheap to add once A1's Postgres exists.

### Proactive / agentic
- **S5** [feature] Reminder engine — natural-language reminders ("nhắc tôi gọi X thứ 5")
  parsed from chat, stored with a due time, fired via B1's send path. The single most
  "secretary-like" feature; concrete and high-value.
- **S6** [feature] Ask-the-log command — in-chat command (e.g. `/ask <question>`) so you
  query your own history from Telegram without opening Claude/Sheet. Puts A1 in your pocket.

### Management / SaaS
- **S7** [infra] Per-user data isolation — from day one, tag every row/vector with an
  owner/tenant id and enforce it (Postgres RLS). Retrofitting isolation later is painful;
  cheap to bake in now and it unblocks C2/C3/D1.
- **S8** [infra] Usage metering & quotas — count messages/embeddings/queries per user.
  Needed to enforce free-tier limits (D2) and to price paid tiers sanely. Also your early
  warning for cost blowups.
- **S9** [infra] Secrets & key management — as bots multiply (C1), per-bot tokens and the
  shared API key need safer storage than `.env` (encrypted column / a secrets manager).
  Security groundwork before onboarding friends.

### Trust / operability
- **S10** [feature] Privacy & retention controls — per-chat opt-out, a "forget this" /
  redaction path, and a retention/rotation policy (the log grows unbounded today). Matters
  the moment someone *else's* messages are stored; also answers an open MASTER_PLAN
  question.
- **S11** [feature] Onboarding flow for a friend — one clean path: they add the bot, it DMs
  a welcome + consent note, provisions their instance (C1/C2), done. Turns "assign a bot"
  from a manual chore into a product.

---

## Graduated / discarded

<!-- move ideas here once they've become plan items or been dropped, so the inbox stays short -->
