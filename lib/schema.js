// Drizzle schema - the single source of truth for the Neon `messages` table.
//
// This is the machine-retrieval index alongside the Google Sheet (see
// plans/rag-semantic-retrieval.md / MASTER_PLAN.md M4). The Sheet stays the
// human-readable ledger and required write path; Neon is best-effort.
//
// Migrations are generated from this file with `drizzle-kit generate` and
// applied with `drizzle-kit migrate` (see scripts/init-neon.md). Never
// hand-write CREATE TABLE / ALTER TABLE outside a generated migration; the one
// manual exception is enabling the `pgvector` extension once.

import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  index,
  pgTable,
  text,
  timestamp,
  vector,
} from 'drizzle-orm/pg-core';

export const messages = pgTable(
  'messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    // Tenant id, stamped from OWNER_ID on every row (IDEAS S7 groundwork) so
    // multi-user isolation later isn't a retrofit. RLS deferred.
    ownerId: text('owner_id').notNull(),
    chatId: text('chat_id').notNull(),
    chatName: text('chat_name'),
    sender: text('sender'),
    text: text('text').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    rawDateUnix: bigint('raw_date_unix', { mode: 'number' }),
    // 1536 dims = OpenAI text-embedding-3-small.
    embedding: vector('embedding', { dimensions: 1536 }),
  },
  (table) => [
    // HNSW index for fast approximate cosine-nearest-neighbour search.
    index('messages_embedding_hnsw_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops')
    ),
    // Btree for owner/chat/time-scoped scans and the owner_id filter on reads.
    index('messages_owner_chat_ts_idx').on(table.ownerId, table.chatId, table.ts),
  ]
);
