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

// 5. Confirm lib/embeddings.js throws a clear error without OPENAI_API_KEY
// (guard: unset it if the shell happened to have it set)
const savedOpenAI = process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;
// Re-import so the cached client is fresh for this assertion
const embedModule = await import('../lib/embeddings.js?sanity=1');
try {
  await embedModule.embed('hello');
  throw new Error('expected embed() to throw without OPENAI_API_KEY');
} catch (err) {
  assert.match(err.message, /OPENAI_API_KEY/);
  console.log('[ok] embed() throws clear error without OPENAI_API_KEY');
}
if (savedOpenAI) process.env.OPENAI_API_KEY = savedOpenAI;

// 6. Confirm lib/db.js throws a clear error without DATABASE_URL
const savedDbUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;
const dbModule = await import('../lib/db.js?sanity=1');
try {
  await dbModule.searchMessages({ ownerId: 'x', queryEmbedding: [], k: 1 });
  throw new Error('expected searchMessages() to throw without DATABASE_URL');
} catch (err) {
  assert.match(err.message, /DATABASE_URL/);
  console.log('[ok] searchMessages() throws clear error without DATABASE_URL');
}
if (savedDbUrl) process.env.DATABASE_URL = savedDbUrl;

// 7. api/search.js returns 401 without the X-Search-Secret header
// (import without the secret set so we can test 401 cleanly)
delete process.env.SEARCH_SECRET;
const { default: searchHandler } = await import('../api/search.js?sanity=1');

{
  const res = fakeRes();
  await searchHandler({ method: 'POST', headers: {}, body: { query: 'test' } }, res);
  assert.equal(res.statusCode, 401);
  console.log('[ok] search endpoint rejects request with missing secret (401)');
}

{
  const res = fakeRes();
  await searchHandler(
    { method: 'POST', headers: { 'x-search-secret': 'wrong' }, body: { query: 'test' } },
    res
  );
  assert.equal(res.statusCode, 401);
  console.log('[ok] search endpoint rejects request with wrong secret (401)');
}

console.log('\nAll sanity checks passed. (Full Sheets / Neon / OpenAI network paths need real credentials to verify - see README verification steps.)');
