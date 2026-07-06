# Neon setup

One Neon project, one `pgvector`-backed table, used as the machine-retrieval index
alongside the Sheet (see `plans/rag-semantic-retrieval.md` / `MASTER_PLAN.md` M4).

## 1. Create the project

1. Go to [neon.tech](https://neon.tech) → create a new project (free tier, no time limit).
2. Open the project's **Connection Details** → copy the **pooled** connection string
   (looks like `postgresql://<user>:<password>@<host>/<db>?sslmode=require`).
   This goes in `.env` as `DATABASE_URL`.

## 2. Enable pgvector

The schema is managed by Drizzle migrations (below), but the `pgvector` extension
must be enabled once by hand first — the generated migration creates a `vector`
column and an HNSW index that depend on it. In the Neon SQL editor (or `psql`):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 3. Apply the schema (Drizzle)

The `messages` table is defined in [`lib/schema.js`](../lib/schema.js) — the single
source of truth. Do not hand-write `CREATE TABLE`; change the schema file and
regenerate. With `DATABASE_URL` in `.env`:

```bash
npm run db:generate   # drizzle-kit generate → writes SQL into drizzle/
npm run db:migrate    # drizzle-kit migrate  → applies it to DATABASE_URL
```

`db:generate` diffs `lib/schema.js` against the existing `drizzle/` migrations and
writes a new timestamped SQL file; `db:migrate` applies any unapplied migrations and
records them in the `drizzle.__drizzle_migrations` table. Committing the `drizzle/`
folder keeps the migration history reproducible.

`owner_id` is stamped on every row from day one (IDEAS S7 groundwork) so per-user
isolation later isn't a retrofit. Postgres RLS enforcement is out of scope for now —
deferred until there's real multi-user traffic.

## 4. Verify

```sql
\d messages
```

Confirm the `embedding` column is `vector(1536)` and both indexes exist
(`messages_embedding_hnsw_idx` HNSW + `messages_owner_chat_ts_idx` btree).

Without `DATABASE_URL` set, `lib/db.js` throws a clear error rather than a network
timeout — see `scripts/sanity-check.js`.
