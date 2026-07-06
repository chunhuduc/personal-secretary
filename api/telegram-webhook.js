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
import { embed } from '../lib/embeddings.js';
import { insertMessage } from '../lib/db.js';

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

    const timestampIso = new Date().toISOString();
    const chatName = chatDisplayName(message.chat);
    const sender = senderDisplayName(message.from);
    const text = message.text || message.caption || '';

    await appendLog({
      timestampIso,
      chatId: message.chat.id,
      chatName,
      sender,
      text,
      rawDateUnix: message.date,
    });

    // Best-effort: embed + index into Neon for semantic retrieval.
    // Must never block the Sheet write or the 200 response (free-tier Sheet
    // sync stays independent of the RAG layer).
    try {
      if (text.trim()) {
        const embedding = await embed(text);
        await insertMessage({
          ownerId: process.env.OWNER_ID,
          chatId: message.chat.id,
          chatName,
          sender,
          text,
          ts: timestampIso,
          rawDateUnix: message.date,
          embedding,
        });
      }
    } catch (err) {
      console.error('rag index (non-fatal):', err);
    }

    res.status(200).json({ ok: true, logged: true });
  } catch (err) {
    console.error('telegram-webhook error:', err);
    // Still 200: Telegram must not retry due to our internal errors.
    res.status(200).json({ ok: false, error: err.message });
  }
}
