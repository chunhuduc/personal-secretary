# CLAUDE.md — personal-secretary

Guidance for Claude Code working in this repo. Read this first, then the doc it points to.

## What this project is

A **Telegram → Vercel webhook → Google Sheets** logging pipeline, read back by Claude
via the Google Drive MCP. A Telegram bot (privacy OFF) logs every message from every
chat it's a member of; a Vercel serverless function appends each message as a row to a
Google Sheet `log` tab; Claude queries that Sheet later.

The larger intent is a **reusable pattern** for piping messaging sources (Telegram
first, then Zalo / a second email / Slack) into a Sheet Claude can search.

## Doc map — read the right file

| File | Purpose | Update when |
|------|---------|-------------|
| `CLAUDE.md` (this) | How to work here, invariants | Conventions/commands change |
| `MASTER_PLAN.md` | Roadmap, milestones, current status | A milestone starts/finishes |
| `FINDINGS.md` | Hard-won facts (gotchas, quirks) so we don't re-learn them | You discover something non-obvious |
| `WORKFLOW.md` | Step-by-step operational flows (deploy, add a source, rotate secrets) | A flow changes or a new one is needed |
| `IDEAS.md` | Quick idea capture; triaged into `MASTER_PLAN.md` later | Anytime — dump ideas, triage later |
| `WORKSPACE_CONTEXT.md` | The reusable cross-source pattern & rationale | The pattern itself evolves |
| `plans/` | Detailed implementation plans (from planning mode or ad-hoc) | A non-trivial plan is produced — save it here, not outside the workspace |

**Before extending to a new message source, read `WORKSPACE_CONTEXT.md` and
`WORKFLOW.md` first** — don't reinvent the pipeline per source.

## Plans

Detailed plans (from `/plan` or any planning task) go in `plans/`, never outside the
workspace. Use `plans/<short-topic>.md`; once a plan is executed, either delete it or
leave it as a record — don't let stale plans silently drift from `MASTER_PLAN.md`.

## Architecture invariants — do not break

- **Reuse `lib/sheets.js` as-is** for new sources (same service account, same Sheet,
  new tab). Don't spin up a second Sheets client.
- **The webhook must always return HTTP 200** once the secret check passes — even on
  internal errors. Telegram retries on non-200 and a Sheets hiccup must not cause a
  retry storm. See `api/telegram-webhook.js`.
- **Verify the shared secret before doing any work.** Every inbound request is checked
  against `X-Telegram-Bot-Api-Secret-Token`; reject spoofed calls with 401.
- **`spreadsheets.values.append` is the only write path** — it's atomic server-side, so
  there's no read-modify-write race under concurrent invocations. Never switch to
  read-then-write.
- **No whitelist.** Scope is presence-based: the bot logs a chat iff it's a member.
  Control scope by adding/removing the bot in Telegram, not in code. (Presence-based
  scoping is Telegram-specific — a source that can't gate by membership, e.g. email,
  may need its own mechanism. Don't assume it generalizes.)
- **No separate DB — the Sheet is the store.** *Pending change:* `plans/rag-semantic-retrieval.md`
  (DRAFT, not started) proposes adding Neon/pgvector as a best-effort machine-retrieval
  index alongside the Sheet. Until that plan is executed, this invariant still holds as
  written; update it here once M4 (see `MASTER_PLAN.md`) actually starts.

## Log row shape (`log` tab)

`timestamp_iso | chat_id | chat_name | sender | text | raw_date_unix` — range `log!A:F`.

## Conventions

- ES modules (`"type": "module"`), Node ≥ 20, `.js` extensions in imports.
- Secrets live in `.env` (gitignored). `.env.example` is the committed contract — keep
  it in sync when you add an env var.
- Match the existing comment density and naming; the two source files are the style
  reference.

## Commands

- `npm run sanity` — local syntax/logic check (`scripts/sanity-check.js`); no network.
- `vercel deploy` — deploy (needs the 4 env vars set in the Vercel project).
- `scripts/set-webhook.ps1` / `.sh` — register the webhook with Telegram post-deploy.

## Git

- Never add a `Co-Authored-By` trailer to commits (global rule).
- Never commit `.env`, service-account JSON, or `.vercel/`.
