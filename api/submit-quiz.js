const { createHmac } = require('node:crypto');
const { quizData, calculateResult } = require('../quiz-data.js');

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const reply = (status, error) => res.status(status).json(error ? { error } : { ok: true });
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reply(405, 'Используйте форму в конце квиза.');
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, EMAIL_FROM } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RESEND_API_KEY || !EMAIL_FROM) {
    return reply(503, 'Отправка пока не настроена. Пожалуйста, зайдите позже.');
  }
  // This endpoint is called only by a page on the same Vercel host.
  const origin = req.headers.origin;
  if (origin && origin !== `https://${req.headers.host}` &&
      !(process.env.NODE_ENV !== 'production' && origin === `http://${req.headers.host}`)) {
    return reply(403, 'Откройте форму на сайте квиза.');
  }
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    return reply(415, 'Некорректный формат запроса.');
  }
  let body;
  try {
    if (Number(req.headers['content-length']) > 4096) return reply(413, 'Слишком большой запрос.');
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!raw || Buffer.byteLength(raw) > 4096) return reply(413, 'Слишком большой запрос.');
    body = JSON.parse(raw);
  } catch {
    return reply(400, 'Не удалось прочитать данные формы.');
  }
  if (!body || typeof body !== 'object') return reply(400, 'Некорректная форма.');
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email) ||
      body.dataConsent !== true || typeof body.marketingConsent !== 'boolean' ||
      !uuid.test(body.submissionId || '') || !Array.isArray(body.answers)) {
    return reply(400, 'Проверьте почту и согласие на сохранение результата.');
  }
  let result;
  try { result = calculateResult(body.answers); }
  catch { return reply(400, 'Ответьте на все вопросы квиза.'); }

  const databaseHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
  const dbUrl = SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  const database = async (path, options) => {
    const response = await fetch(dbUrl + path, { ...options, headers: databaseHeaders, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('database');
    return response.status === 204 ? null : response.json();
  };
  const clientIp = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();
  const ipHash = createHmac('sha256', SUPABASE_SERVICE_ROLE_KEY).update(clientIp).digest('hex');
  let row;
  try {
    const registration = await database('/rpc/register_quiz_submission', {
      method: 'POST', body: JSON.stringify({
        p_id: body.submissionId, p_email: email, p_result: result,
        p_marketing: body.marketingConsent, p_ip_hash: ipHash
      })
    });
    if (registration.error === 'rate_limit') return reply(429, 'Слишком много попыток. Попробуйте через час.');
    if (registration.error === 'conflict') return reply(409, 'Данные изменились. Измените поле почты и отправьте форму ещё раз.');
    row = registration;
    if (row.status === 'accepted') return reply(200);
  } catch {
    return reply(503, 'Не удалось сохранить результат. Попробуйте ещё раз.');
  }
  const r = quizData.results[result];
  const text = [`Ваш финансовый персонаж — ${r.name}`, r.source, r.tag, ...r.paragraphs].join('\n\n');
  const html = `<html lang="ru"><body style="font-family:Arial,sans-serif;color:#222;line-height:1.6;max-width:620px;margin:32px auto;padding:0 20px"><p>Результат квиза «Деньги и характер»</p><h1 style="color:#5142ab">Вы — ${escapeHtml(r.name)}</h1><p>${escapeHtml(r.source)}</p><h2>${escapeHtml(r.tag)}</h2>${r.paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('')}</body></html>`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `quiz/${body.submissionId}` },
      // All content comes from server-owned quiz data, never from submitted HTML.
      body: JSON.stringify({ from: EMAIL_FROM, to: [email], subject: `Ваш финансовый персонаж — ${r.name}`, text, html }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const name = typeof failure.name === 'string' && /^[a-z_]+$/.test(failure.name) ? failure.name : 'unknown';
      // Provider messages can contain email addresses. Log only safe categories.
      console.error('quiz_email_rejected', { status: response.status, category: name });
      if (response.status === 403 && /only send testing emails|own email address/i.test(failure.message || '')) {
        return reply(502, 'Квиз пока в тестовом режиме: письмо можно отправить только на почту владельца аккаунта Resend.');
      }
      if (response.status === 401 || name === 'invalid_api_key' || name === 'restricted_api_key') {
        return reply(502, 'Необходимо исправить ключ отправки писем в настройках сайта.');
      }
      if (/domain.*not.*verified|verify.*domain/i.test(failure.message || '')) {
        return reply(502, 'Необходимо подтвердить домен отправителя или настроить тестовый адрес отправки.');
      }
      if (response.status === 422 && /from|sender/i.test(failure.message || '')) {
        return reply(502, 'Необходимо исправить адрес отправителя в настройках сайта.');
      }
      throw new Error('email_rejected');
    }
    const sent = await response.json();
    if (!sent.id) throw new Error('email');
    // Resend acceptance is tracked separately from inbox delivery.
    await database(`/quiz_submissions?id=eq.${body.submissionId}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'accepted', provider_id: sent.id, accepted_at: new Date().toISOString() })
    });
    return reply(200);
  } catch (error) {
    console.error('quiz_email_unconfirmed', { category: error?.name || 'Error', stage: error?.message === 'database' ? 'save_acceptance' : 'send' });
    // Leave the saved submission pending for retry. The same Resend idempotency
    // key prevents duplicate sends during its 24-hour deduplication window.
    return reply(502, 'Отправку письма пока не удалось подтвердить. Нажмите кнопку ещё раз.');
  }
};
