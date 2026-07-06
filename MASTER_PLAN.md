# MASTER_PLAN.md — personal-secretary

The roadmap and current status. Update the status block whenever a milestone
starts or finishes. Keep dates absolute.

## Goal

Build a reusable **messaging-source → Sheet → Claude** pipeline. Telegram is the first
leg; the shape is meant to be copied for future sources (Zalo, a second email, Slack).

## Current status — as of 2026-07-06

**Phase: Telegram leg built locally, not yet deployed.**

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

### M3 — Query ergonomics (not started)
Once ≥1 source is flowing, refine how Claude queries the log (naming conventions,
per-source tabs, maybe a lightweight summary/index tab) so retrieval stays fast as the
log grows.

## Open questions / decisions to make

- One Sheet with per-source tabs, or a Sheet per source? (Leaning: one Sheet, `log_<source>`
  tabs, until volume forces a split.)
- Retention: does the log grow unbounded, or do we archive/rotate old rows? Undecided.
- For non-membership sources (email), what replaces presence-based scope? Undecided —
  becomes concrete at M2.

## Non-goals

- No message *history backfill* — the bot only sees messages sent after it joins.
- No admin commands / whitelist tab (deliberately removed; see git history).
- No separate DB — the Sheet is the store, on purpose (Drive-MCP readable, atomic append).
