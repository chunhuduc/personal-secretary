// Google Sheets client + append helper for the message log.
//
// Sheet layout (see scripts/init-sheet.md for setup):
//   Tab "log": timestamp_iso | chat_id | chat_name | sender | text | raw_date_unix
//
// Scope is controlled by adding/removing the bot from Telegram chats
// directly - there is no whitelist, every message from every chat the
// bot is currently a member of gets logged.

import { google } from 'googleapis';

const LOG_RANGE = 'log!A:F';

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
