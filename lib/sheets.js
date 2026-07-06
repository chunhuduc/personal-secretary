// Google Sheets client + helpers for the message log and chat whitelist.
//
// Sheet layout (see scripts/init-sheet.md for setup):
//   Tab "log":    timestamp_iso | chat_id | chat_name | sender | text | raw_date_unix
//   Tab "config": chat_id | chat_name | enabled

import { google } from 'googleapis';

const LOG_RANGE = 'log!A:F';
const CONFIG_RANGE = 'config!A2:C'; // skip header row
const CONFIG_FULL_RANGE = 'config!A:C';

let cachedClient = null;

/**
 * Builds (and caches, per warm serverless instance) an authenticated
 * Sheets API client from the base64-encoded service-account JSON key.
 */
function getSheetsClient() {
  if (cachedClient) return cachedClient;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON env var is not set');
  }

  let keyJson;
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    keyJson = JSON.parse(decoded);
  } catch (err) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_JSON could not be decoded/parsed as base64 JSON: ${err.message}`
    );
  }

  const auth = new google.auth.JWT({
    email: keyJson.client_email,
    key: keyJson.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  cachedClient = google.sheets({ version: 'v4', auth });
  return cachedClient;
}

function getSheetId() {
  const sheetId = process.env.SHEET_ID;
  if (!sheetId) throw new Error('SHEET_ID env var is not set');
  return sheetId;
}

/**
 * Appends one message row to the "log" tab. Atomic server-side - safe
 * under concurrent invocations, no read-modify-write race.
 */
export async function appendLog({ timestampIso, chatId, chatName, sender, text, rawDateUnix }) {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSheetId(),
    range: LOG_RANGE,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [[timestampIso, String(chatId), chatName, sender, text, rawDateUnix]],
    },
  });
}

/**
 * Reads the "config" tab and returns it as an array of
 * { chatId, chatName, enabled, rowNumber } — rowNumber is the 1-indexed
 * sheet row (accounting for the header), used for in-place updates.
 */
export async function getConfigRows() {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSheetId(),
    range: CONFIG_RANGE,
  });
  const rows = res.data.values || [];
  return rows.map((row, idx) => ({
    chatId: row[0] || '',
    chatName: row[1] || '',
    enabled: String(row[2] || '').toLowerCase() === 'true',
    rowNumber: idx + 2, // +2: 1-indexed sheet rows, plus header row offset
  }));
}

/** Returns a Set of chat_id strings currently enabled in the config tab. */
export async function getWhitelist() {
  const rows = await getConfigRows();
  return new Set(rows.filter((r) => r.enabled).map((r) => r.chatId));
}

/**
 * Adds or updates a row in the "config" tab for the given chat_id.
 * If the chat_id already has a row, it's updated in place; otherwise a
 * new row is appended.
 */
export async function upsertConfig(chatId, chatName, enabled) {
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();
  const rows = await getConfigRows();
  const existing = rows.find((r) => r.chatId === String(chatId));

  const values = [[String(chatId), chatName || existing?.chatName || '', String(enabled)]];

  if (existing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `config!A${existing.rowNumber}:C${existing.rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: CONFIG_FULL_RANGE,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
  }
}
