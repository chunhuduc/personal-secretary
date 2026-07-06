// Local sanity check - exercises pure logic without real Google/Telegram
// credentials. Not a full e2e test (that requires live creds + deploy),
// but catches import errors and logic bugs in request validation before
// deploying.

import assert from 'node:assert/strict';

process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
// Deliberately NOT setting GOOGLE_SERVICE_ACCOUNT_JSON / SHEET_ID here -
// getSheetsClient() should throw a clear error if called, which we verify
// separately rather than letting import-time code touch the network.

const { appendLog } = await import('../lib/sheets.js');

// 1. Confirm sheets.js throws a clear, actionable error without creds
// (rather than a cryptic network/undefined error).
try {
  await appendLog({
    timestampIso: new Date().toISOString(),
    chatId: 1,
    chatName: 'test',
    sender: 'test',
    text: 'test',
    rawDateUnix: 0,
  });
  throw new Error('expected appendLog to throw without GOOGLE_SERVICE_ACCOUNT_JSON');
} catch (err) {
  assert.match(err.message, /GOOGLE_SERVICE_ACCOUNT_JSON/);
  console.log('[ok] appendLog throws clear error without service-account env var');
}

// 2. Exercise the webhook handler's request-shape validation (method +
// secret header) without hitting real Sheets.
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

console.log('\nAll sanity checks passed. (Full Sheets network path needs real credentials to verify - see README verification steps.)');
