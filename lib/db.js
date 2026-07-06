// Neon (Postgres + pgvector) client + message index helpers for semantic
// retrieval (see plans/rag-semantic-retrieval.md).
//
// This is the machine-retrieval index alongside the Sheet - the Sheet stays
// the human-readable ledger and the required write path; this is best-effort.
// See scripts/init-neon.md for the `messages` table schema.

import { neon } from '@neondatabase/serverless';

let cachedSql = null;

/**
 * Builds (and caches, per warm serverless instance) a Neon SQL client from
 * DATABASE_URL.
 */
function getSql() {
  if (cachedSql) return cachedSql;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL env var is not set');
  }

  cachedSql = neon(url);
  return cachedSql;
}

function toVectorLiteral(embedding) {
  return `[${embedding.join(',')}]`;
}

/**
 * Inserts one message row with its embedding. Parameterized - safe against
 * injection even though text is free-form chat content.
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
  const sql = getSql();
  await sql`
    INSERT INTO messages (owner_id, chat_id, chat_name, sender, text, ts, raw_date_unix, embedding)
    VALUES (
      ${ownerId}, ${String(chatId)}, ${chatName}, ${sender}, ${text}, ${ts}, ${rawDateUnix},
      ${toVectorLiteral(embedding)}::vector
    )
  `;
}

/**
 * Finds the top-K messages closest in meaning to queryEmbedding, scoped to
 * ownerId (and optionally chatId). Returns rows with a 0-1 cosine similarity
 * score (higher = more similar). Single shared search core for the HTTP
 * endpoint and the MCP server.
 */
export async function searchMessages({ ownerId, queryEmbedding, k = 20, chatId }) {
  const sql = getSql();
  const vectorLiteral = toVectorLiteral(queryEmbedding);

  if (chatId) {
    return sql`
      SELECT text, chat_name, sender, ts, 1 - (embedding <=> ${vectorLiteral}::vector) AS score
      FROM messages
      WHERE owner_id = ${ownerId} AND chat_id = ${String(chatId)}
      ORDER BY embedding <=> ${vectorLiteral}::vector
      LIMIT ${k}
    `;
  }

  return sql`
    SELECT text, chat_name, sender, ts, 1 - (embedding <=> ${vectorLiteral}::vector) AS score
    FROM messages
    WHERE owner_id = ${ownerId}
    ORDER BY embedding <=> ${vectorLiteral}::vector
    LIMIT ${k}
  `;
}
