const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/submit-quiz.js');
const { calculateResult } = require('../quiz-data.js');
const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const id = '245abac2-a08f-4fd9-8047-c58ba4929bf1';
const payload = () => ({ email: ' Reader@example.com ', submissionId: id, answers: Array(10).fill(0), dataConsent: true, marketingConsent: false });
let calls;
beforeEach(() => {
  Object.assign(process.env, { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'private-test-key', RESEND_API_KEY: 'test-resend', EMAIL_FROM: 'quiz@example.com', NODE_ENV: 'production' });
  calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    if (url.includes('/rpc/')) return Response.json({ status: 'pending' });
    if (url.includes('/quiz_submissions?')) return new Response(null, { status: 204 });
    return Response.json({ id: 'email-test-id' });
  };
});
afterEach(() => { global.fetch = originalFetch; process.env = { ...originalEnv }; });
async function submit(body = payload(), changes = {}) {
  const req = { method: 'POST', headers: { host: 'quiz.example.com', origin: 'https://quiz.example.com', 'content-type': 'application/json', 'x-vercel-forwarded-for': '203.0.113.1' }, body, ...changes };
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
  await handler(req, res);
  return res;
}
test('saves before sending; calculates result on server; records provider acceptance', async () => {
  const input = payload(); input.result = 'injected-result';
  const res = await submit(input);
  assert.equal(res.code, 200);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /register_quiz_submission$/);
  assert.equal(calls[0].body.p_email, 'reader@example.com');
  assert.equal(calls[0].body.p_result, calculateResult(input.answers));
  assert.equal(calls[0].body.p_marketing, false);
  assert.match(calls[0].body.p_ip_hash, /^[a-f0-9]{64}$/);
  assert.equal(calls[1].url, 'https://api.resend.com/emails');
  assert.equal(calls[1].headers['Idempotency-Key'], `quiz/${id}`);
  assert.deepEqual(calls[1].body.to, ['reader@example.com']);
  assert.ok(calls[1].body.html.includes('Вы — '));
  assert.equal(calls[2].body.status, 'accepted');
  assert.equal(res.body.result, undefined);
});
test('rejects missing consent, bad answers and invalid emails without saving or sending', async () => {
  for (const change of [{ dataConsent: false }, { email: 'invalid' }, { answers: [0] }, { answers: Array(10).fill(99) }, { answers: Array(10).fill(null) }, { submissionId: 'bad-id' }]) {
    assert.equal((await submit({ ...payload(), ...change })).code, 400);
  }
  assert.equal(calls.length, 0);
});
test('fails closed if the database is unavailable; never emails unsaved entries', async () => {
  global.fetch = async () => { throw new Error('offline'); };
  assert.equal((await submit()).code, 503);
});
test('keeps saved data and reports failure honestly when email sending fails', async () => {
  const fetchMock = global.fetch;
  global.fetch = async (url, options) => url.includes('resend.com') ? Response.json({}, { status: 503 }) : fetchMock(url, options);
  const res = await submit();
  assert.equal(res.code, 502);
  assert.match(res.body.error, /Отправку письма пока не удалось подтвердить/);
  assert.equal(calls.length, 1);
});
test('retry uses the same idempotency key when acceptance could not be saved', async () => {
  const fetchMock = global.fetch;
  let failed = false;
  global.fetch = async (url, options) => {
    if (url.includes('/quiz_submissions?') && !failed) { failed = true; throw new Error('offline'); }
    return fetchMock(url, options);
  };
  assert.equal((await submit()).code, 502);
  assert.equal((await submit()).code, 200);
  const sends = calls.filter(c => c.url.includes('resend.com'));
  assert.equal(sends.length, 2);
  assert.equal(sends[0].headers['Idempotency-Key'], sends[1].headers['Idempotency-Key']);
});
test('completed retry returns success without sending another email', async () => {
  global.fetch = async () => Response.json({ status: 'accepted' });
  assert.equal((await submit()).code, 200);
  assert.equal(calls.length, 0);
});
test('rate limit prevents email sending', async () => {
  global.fetch = async () => Response.json({ error: 'rate_limit' });
  assert.equal((await submit()).code, 429);
  assert.equal(calls.length, 0);
});
test('disallows other origins and non-POST requests', async () => {
  assert.equal((await submit(payload(), { headers: { host: 'quiz.example.com', origin: 'https://other.example.com' } })).code, 403);
  assert.equal((await submit(payload(), { method: 'GET' })).code, 405);
  assert.equal(calls.length, 0);
});
test('unconfigured integration returns an actionable message without collecting data', async () => {
  delete process.env.RESEND_API_KEY;
  assert.equal((await submit()).code, 503);
  assert.equal(calls.length, 0);
});
