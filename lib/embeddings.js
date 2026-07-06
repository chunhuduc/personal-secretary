// OpenAI embedding client for semantic retrieval (see plans/rag-semantic-retrieval.md).
//
// Used to embed both incoming messages (write path, best-effort) and search
// queries (read path) into the same vector space so pgvector cosine distance
// is meaningful between them.

import OpenAI from 'openai';

const DEFAULT_MODEL = 'text-embedding-3-small';

let cachedClient = null;

/**
 * Builds (and caches, per warm serverless instance) an OpenAI client from
 * OPENAI_API_KEY.
 */
function getOpenAIClient() {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY env var is not set');
  }

  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

/**
 * Embeds a single piece of text into a vector. Returns number[] (1536 dims
 * for the default model).
 */
export async function embed(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    throw new Error('embed() requires non-empty text');
  }

  const client = getOpenAIClient();
  const model = process.env.EMBEDDING_MODEL || DEFAULT_MODEL;

  const response = await client.embeddings.create({
    model,
    input: trimmed,
  });

  return response.data[0].embedding;
}
