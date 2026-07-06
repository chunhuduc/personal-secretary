// Neon (Postgres + pgvector) query layer for semantic retrieval, via Drizzle
// ORM on the @neondatabase/serverless HTTP driver (see
// plans/rag-semantic-retrieval.md).
//
// This is the machine-retrieval index alongside the Sheet - the Sheet stays
// the human-readable ledger and the required write path; this is best-effort.
// The `messages` table is defined in lib/schema.js (Drizzle) and managed with
// drizzle-kit migrations - see scripts/init-neon.md.

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { and, cosineDistance, eq, sql } from 'drizzle-orm';
import { messages } from './schema.js';

let cachedDb = null;

/**
 * Builds (and caches, per warm serverless instance) a Drizzle client backed by
 * the Neon HTTP driver. Throws a clear error if DATABASE_URL is unset (mirrors
 * getSheetsClient()'s missing-env pattern).
 */
function getDb() {
  if (cachedDb) return cachedDb;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL env var is not set');
  }

  cachedDb = drizzle(neon(url), { schema: { messages } });
  return cachedDb;
}

/**
 * Inserts one message row with its embedding. Drizzle's vector column handles
 * the pgvector literal conversion from a plain number[].
 */
export async function insertMessage({
  ownerId,
  chatId,
  chatName,
  sender,
  text,
  ts,
  rawDateUnix,
  embedding,
}) {
  const db = getDb();
  await db.insert(messages).values({
    ownerId,
    chatId: String(chatId),
    chatName,
    sender,
    text,
    ts: new Date(ts),
    rawDateUnix,
    embedding,
  });
}

/**
 * Finds the top-K messages closest in meaning to queryEmbedding, scoped to
 * ownerId (and optionally chatId). Returns rows with a 0-1 cosine similarity
 * score (higher = more similar). Single shared search core for the HTTP
 * endpoint and the MCP server.
 */
export async function searchMessages({ ownerId, queryEmbedding, k = 20, chatId }) {
  const db = getDb();

  // similarity = 1 - cosine distance; order by distance ascending (nearest first).
  const distance = cosineDistance(messages.embedding, queryEmbedding);
  const score = sql`1 - (${distance})`.as('score');

  const where = chatId
    ? and(eq(messages.ownerId, ownerId), eq(messages.chatId, String(chatId)))
    : eq(messages.ownerId, ownerId);

  return db
    .select({
      text: messages.text,
      chat_name: messages.chatName,
      sender: messages.sender,
      ts: messages.ts,
      score,
    })
    .from(messages)
    .where(where)
    .orderBy(distance)
    .limit(k);
}
