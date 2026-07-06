# Neon setup

One Neon project, one `pgvector`-backed table, used as the machine-retrieval index
alongside the Sheet (see `plans/rag-semantic-retrieval.md` / `MASTER_PLAN.md` M4).

## 1. Create the project

1. Go to [neon.tech](https://neon.tech) → create a new project (free tier, no time limit).
2. Open the project's **Connection Details** → copy the **pooled** connection string
   (looks like `postgresql://<user>:<password>@<host>/<db>?sslmode=require`).
   This goes in `.env` as `DATABASE_URL`.

## 2. Enable pgvector

In the Neon SQL editor (or `psql`):

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 3. Create the `messages` table

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

`owner_id` is stamped on every row from day one (IDEAS S7 groundwork) so per-user
isolation later isn't a retrofit. Postgres RLS enforcement is out of scope for now —
deferred until there's real multi-user traffic.

## 4. Verify

```sql
\d messages
```

Confirm the `embedding` column is `vector(1536)` and both indexes exist.

Without `DATABASE_URL` set, `lib/db.js` throws a clear error rather than a network
timeout — see `scripts/sanity-check.js`.
