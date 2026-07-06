#!/usr/bin/env node
// One-off backfill: reads existing rows from the Sheet `log` tab and inserts
// any that aren't already in Neon. Safe to re-run - skips rows already present
// via (chat_id, raw_date_unix, text) dedup.
//
// Usage: node scripts/backfill-embeddings.js
// Requires: DATABASE_URL, OPENAI_API_KEY, OWNER_ID, GOOGLE_SERVICE_ACCOUNT_JSON, SHEET_ID

import * as dotenv from 'fs';
import { google } from 'googleapis';
import { embed } from '../lib/embeddings.js';
import { insertMessage } from '../lib/db.js';
import { neon } from '@neondatabase/serverless';

// Load .env manually (no dotenv dep - just read the file if it exists)
try {
  const raw = dotenv.readFileSync(new URL('../.env', import.meta.url), 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // .env not present - rely on shell env
}

const BATCH_SIZE = 20;      // embed N messages before inserting
const RATE_DELAY_MS = 200;  // pause between batches to stay within OpenAI rate limits

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set');
  const keyJson = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  const auth = new google.auth.JWT({
    email: keyJson.client_email,
    key: keyJson.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function getExistingKeys() {
  const sql = neon(process.env.DATABASE_URL);
  const ownerId = process.env.OWNER_ID;
  // Fetch all (chat_id, raw_date_unix, text) combos already indexed for this owner.
  const rows = await sql`
    SELECT chat_id, raw_date_unix, text FROM messages WHERE owner_id = ${ownerId}
  `;
  const keys = new Set();
  for (const row of rows) {
    keys.add(`${row.chat_id}|${row.raw_date_unix}|${row.text}`);
  }
  return keys;
}

async function fetchSheetRows() {
  const sheets = getSheetsClient();
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error('SHEET_ID env var is not set');
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'log!A:F',
  });
  return res.data.values || [];
}

async function main() {
  const requiredVars = ['DATABASE_URL', 'OPENAI_API_KEY', 'OWNER_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON', 'SHEET_ID'];
  for (const v of requiredVars) {
    if (!process.env[v]) {
      console.error(`Missing required env var: ${v}`);
      process.exit(1);
    }
  }

  console.log('Fetching existing Neon keys...');
  const existingKeys = await getExistingKeys();
  console.log(`  ${existingKeys.size} rows already in Neon.`);

  console.log('Fetching Sheet rows...');
  const rows = await fetchSheetRows();
  // Skip header row (first row is headers if it contains 'timestamp_iso' or similar text)
  const dataRows = rows.filter((r, i) => {
    if (i === 0 && typeof r[0] === 'string' && r[0].toLowerCase().includes('timestamp')) return false;
    return true;
  });
  console.log(`  ${dataRows.length} data rows in Sheet.`);

  // Sheet columns: timestamp_iso | chat_id | chat_name | sender | text | raw_date_unix
  const toProcess = dataRows.filter((r) => {
    const chatId = r[1] || '';
    const rawDateUnix = r[5] || '';
    const text = r[4] || '';
    if (!text.trim()) return false;
    return !existingKeys.has(`${chatId}|${rawDateUnix}|${text}`);
  });

  console.log(`  ${toProcess.length} rows to embed and insert.`);
  if (toProcess.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (r) => {
        const [timestampIso, chatId, chatName, sender, text, rawDateUnixStr] = r;
        try {
          const embedding = await embed(text);
          await insertMessage({
            ownerId: process.env.OWNER_ID,
            chatId: String(chatId),
            chatName: chatName || '',
            sender: sender || '',
            text,
            ts: timestampIso || new Date().toISOString(),
            rawDateUnix: Number(rawDateUnixStr) || 0,
            embedding,
          });
          inserted++;
        } catch (err) {
          console.error(`  Error on row "${text.slice(0, 40)}...":`, err.message);
          errors++;
        }
      })
    );

    const done = Math.min(i + BATCH_SIZE, toProcess.length);
    console.log(`  ${done}/${toProcess.length} processed (${inserted} inserted, ${errors} errors)`);

    if (i + BATCH_SIZE < toProcess.length) {
      await sleep(RATE_DELAY_MS);
    }
  }

  console.log(`\nDone. ${inserted} rows inserted, ${errors} errors.`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
