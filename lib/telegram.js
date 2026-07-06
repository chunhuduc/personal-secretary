// Minimal Telegram Bot API helper - just enough to ACK control commands.

const TELEGRAM_API_BASE = 'https://api.telegram.org';

/** Sends a text reply to a chat via the Bot API sendMessage method. */
export async function sendMessage(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN env var is not set');

  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Non-fatal: log and continue. We never want a Telegram API hiccup to
    // block returning 200 to the original webhook call.
    console.error(`Telegram sendMessage failed (${res.status}): ${body}`);
  }
}
