// drizzle-kit config: generates SQL migrations from lib/schema.js into drizzle/
// and applies them to Neon. See scripts/init-neon.md.
//
// Usage:
//   npm run db:generate   (drizzle-kit generate - writes SQL into drizzle/)
//   npm run db:migrate    (drizzle-kit migrate  - applies them to DATABASE_URL)

import { readFileSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// Load .env manually (no dotenv dep - mirrors scripts/backfill-embeddings.js).
// Strips surrounding quotes so a quoted DATABASE_URL still parses.
try {
  const raw = readFileSync(new URL('./.env', import.meta.url), 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env not present - rely on shell env (e.g. CI).
}

export default defineConfig({
  schema: './lib/schema.js',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
