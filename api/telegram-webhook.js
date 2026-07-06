// Vercel serverless function: Telegram webhook receiver.
//
// Flow:
//   1. Only accept POST.
//   2. Verify the request actually came from Telegram via the shared
//      secret_token header (set during setWebhook).
//   3. If the message is a control command (/allow, /deny, /list) from an
//      admin chat, mutate the "config" tab and ACK back to Telegram.
//   4. Otherwise, check the sender's chat_id against the whitelist in the
//      "config" tab; if enabled, append the message to the "log" tab.
//   5. Always respond 200 quickly - Telegram retries on non-200.

import { appendLog, getConfigRows, getWhitelist, upsertConfig } from '../lib/sheets.js';
import { sendMessage } from '../lib/telegram.js';

function getAdminChatIds() {
  return (process.env.ADMIN_CHAT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

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

async function handleControlCommand(text, message) {
  const [command, ...args] = text.trim().split(/\s+/);
  const replyChatId = message.chat.id;

  if (command === '/list') {
    const rows = await getConfigRows();
    const enabled = rows.filter((r) => r.enabled);
    const lines = enabled.length
      ? enabled.map((r) => `${r.chatId}  ${r.chatName}`).join('\n')
      : '(no chats currently whitelisted)';
    await sendMessage(replyChatId, `Whitelisted chats:\n${lines}`);
    return;
  }

  if (command === '/allow') {
    const [chatId, ...nameParts] = args;
    if (!chatId) {
      await sendMessage(replyChatId, 'Usage: /allow <chat_id> [name]');
      return;
    }
    await upsertConfig(chatId, nameParts.join(' '), true);
    await sendMessage(replyChatId, `Allowed chat_id ${chatId}.`);
    return;
  }

  if (command === '/deny') {
    const [chatId] = args;
    if (!chatId) {
      await sendMessage(replyChatId, 'Usage: /deny <chat_id>');
      return;
    }
    await upsertConfig(chatId, undefined, false);
    await sendMessage(replyChatId, `Denied chat_id ${chatId}.`);
    return;
  }
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

    const text = message.text || message.caption || '';
    const chatId = message.chat.id;
    const isAdmin = getAdminChatIds().includes(String(chatId));

    if (isAdmin && /^\/(allow|deny|list)\b/.test(text)) {
      await handleControlCommand(text, message);
      res.status(200).json({ ok: true, handled: 'control-command' });
      return;
    }

    const whitelist = await getWhitelist();
    if (!whitelist.has(String(chatId))) {
      res.status(200).json({ ok: true, ignored: 'chat not whitelisted' });
      return;
    }

    await appendLog({
      timestampIso: new Date().toISOString(),
      chatId,
      chatName: chatDisplayName(message.chat),
      sender: senderDisplayName(message.from),
      text,
      rawDateUnix: message.date,
    });

    res.status(200).json({ ok: true, logged: true });
  } catch (err) {
    console.error('telegram-webhook error:', err);
    // Still 200: Telegram must not retry due to our internal errors.
    res.status(200).json({ ok: false, error: err.message });
  }
}
