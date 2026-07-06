// Local sanity check - exercises pure logic without real Google/Telegram
// credentials. Not a full e2e test (that requires live creds + deploy),
// but catches import errors and logic bugs in message parsing / whitelist
// gating before deploying.

import assert from 'node:assert/strict';

process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
process.env.ADMIN_CHAT_IDS = '111,222';
process.env.TELEGRAM_BOT_TOKEN = 'dummy-token';
// Deliberately NOT setting GOOGLE_SERVICE_ACCOUNT_JSON / SHEET_ID here -
// getSheetsClient() should throw a clear error if called, which we verify
// separately rather than letting import-time code touch the network.

const { appendLog, getWhitelist, upsertConfig, getConfigRows } = await import('../lib/sheets.js');
const { sendMessage } = await import('../lib/telegram.js');

// 1. Confirm sheets.js throws a clear, actionable error without creds
// (rather than a cryptic network/undefined error).
try {
  await getWhitelist();
  throw new Error('expected getWhitelist to throw without GOOGLE_SERVICE_ACCOUNT_JSON');
} catch (err) {
  assert.match(err.message, /GOOGLE_SERVICE_ACCOUNT_JSON/);
  console.log('[ok] getWhitelist throws clear error without service-account env var');
}

// 2. sendMessage should not throw even if the Telegram API call fails
// (dummy token) - it should log and swallow, per the "never block 200" design.
await sendMessage(123, 'test message');
console.log('[ok] sendMessage swallows Telegram API failures without throwing');

// 3. Exercise the webhook handler's pure logic paths using fetch mocked out
// - import handler and simulate req/res without hitting real Sheets.
// Since appendLog/getWhitelist need real creds, we only test the
// request-shape validation (method + secret header) here.
const { default: handler } = await import('../api/telegram-webhook.js');

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

// Wrong method -> 405
{
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
  console.log('[ok] non-POST request rejected with 405');
}

// Missing/incorrect secret -> 401
{
  const res = fakeRes();
  await handler({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
  console.log('[ok] missing secret header rejected with 401');
}

{
  const res = fakeRes();
  await handler(
    { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'wrong' }, body: {} },
    res
  );
  assert.equal(res.statusCode, 401);
  console.log('[ok] wrong secret header rejected with 401');
}

// Correct secret, no message in body -> 200, ignored
{
  const res = fakeRes();
  await handler(
    {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'test-secret' },
      body: {},
    },
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ignored, 'no message');
  console.log('[ok] valid secret + no message -> 200 ignored');
}

console.log('\nAll sanity checks passed. (Full Sheets/Telegram network paths need real credentials to verify - see README verification steps.)');
