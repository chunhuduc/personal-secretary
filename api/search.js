// Vercel serverless function: semantic search over the message log.
//
// Flow:
//   1. Only accept POST.
//   2. Verify the shared secret via the X-Search-Secret header (mirrors the
//      telegram-webhook secret pattern).
//   3. Embed the query, fetch the top-K nearest messages from Neon
//      (pgvector cosine distance), return them as JSON.

import { embed } from '../lib/embeddings.js';
import { searchMessages } from '../lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const secret = req.headers['x-search-secret'];
  if (!secret || secret !== process.env.SEARCH_SECRET) {
    res.status(401).json({ error: 'invalid secret' });
    return;
  }

  const { query, k, chatId } = req.body || {};
  if (!query || typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'query is required' });
    return;
  }

  try {
    const queryEmbedding = await embed(query);
    const rows = await searchMessages({
      ownerId: process.env.OWNER_ID,
      queryEmbedding,
      k: k || Number(process.env.SEARCH_TOP_K) || 20,
      chatId,
    });

    res.status(200).json({
      results: rows.map((row) => ({
        text: row.text,
        chat_name: row.chat_name,
        sender: row.sender,
        ts: row.ts,
        score: row.score,
      })),
    });
  } catch (err) {
    console.error('search error:', err);
    res.status(500).json({ error: err.message });
  }
}
