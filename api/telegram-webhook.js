// Vercel serverless function: Telegram webhook receiver.
//
// Flow:
//   1. Only accept POST.
//   2. Verify the request actually came from Telegram via the shared
//      secret_token header (set during setWebhook).
//   3. Log every message from every chat the bot is currently a member of.
//      Scope is controlled by adding/removing the bot from chats in
//      Telegram itself - there is no separate whitelist.
//   4. Always respond 200 quickly - Telegram retries on non-200.

import { appendLog } from '../lib/sheets.js';

function extractMessage(body) {
  return body?.message || body?.edited_message || body?.channel_post || null;
}

function chatDisplayName(chat) {
  return chat?.title || chat?.username || chat?.first_name || String(chat?.id ?? 'unknown');
}

function senderDisplayName(from) {
  if (!from) return 'unknown';
  return from.username || [from.first_name, from.last_name].filter(Boolean).join(' ') || 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const secret = req.headers['x-telegram-bot-api-secret-token'];
  if (!secret || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    res.status(401).json({ error: 'invalid secret token' });
    return;
  }

  // Always intend to return 200 from here on - Telegram retries on
  // failure, and we don't want a Sheets hiccup to trigger a retry storm.
  try {
    const message = extractMessage(req.body);
    if (!message) {
      res.status(200).json({ ok: true, ignored: 'no message' });
      return;
    }

    await appendLog({
      timestampIso: new Date().toISOString(),
      chatId: message.chat.id,
      chatName: chatDisplayName(message.chat),
      sender: senderDisplayName(message.from),
      text: message.text || message.caption || '',
      rawDateUnix: message.date,
    });

    res.status(200).json({ ok: true, logged: true });
  } catch (err) {
    console.error('telegram-webhook error:', err);
    // Still 200: Telegram must not retry due to our internal errors.
    res.status(200).json({ ok: false, error: err.message });
  }
}
