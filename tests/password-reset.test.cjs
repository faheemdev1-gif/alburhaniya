const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
process.env.JWT_SECRET = 'isolated-password-reset-tests';
Object.assign(process.env, { SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_USER: 'resend', SMTP_PASS: 'test-only', CONTACT_FROM_EMAIL: 'info@example.test', ADMIN_SITE_URL: 'https://www.alburhaniyainternational.org.uk' });
const app = require('../dist/app').default;
const User = require('../dist/models/User').default;
const { passwordResetFixture } = require('./helpers/passwordResetFixture.cjs');
const f = passwordResetFixture(User, nodemailer);
const admin = f.seed({ email: 'owner@example.test' });
const tokenFrom = mail => /\/admin\/reset-password#token=([a-f0-9]{64})/.exec(mail.text)?.[1];
const hash = token => createHash('sha256').update(token).digest('hex');
const oldJwt = jwt.sign({ id: admin._id, role: 'admin' }, process.env.JWT_SECRET);
let server, base, firstToken;
before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { f.restore(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
async function request(path, body, headers = {}) {
  return fetch(base + '/api/auth' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
async function until(check) { for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); } throw Error('Isolated background job did not complete'); }
const reset = (token, overrides = {}) => request('/reset-password', { token, newPassword: 'New-secure-password-123', confirmPassword: 'New-secure-password-123', ...overrides });

test('recovery secrets are excluded from ordinary user queries and health reports SMTP readiness', async () => {
  for (const key of ['password', 'authVersion', 'passwordResetTokenHash', 'passwordResetExpiresAt', 'passwordResetRequestedAt']) assert.equal(User.schema.path(key).options.select, false);
  const health = await (await fetch(base + '/api/health')).json();
  assert.deepEqual(health.passwordReset, { contract: 'admin-password-reset-v1', emailConfigured: true });
});
test('missing SMTP is reported consistently without creating a reset token', async () => {
  const pass = process.env.SMTP_PASS; delete process.env.SMTP_PASS;
  try {
    for (const email of ['config@example.test', 'unknown-config@example.test']) {
      const res = await request('/forgot-password', { email }); assert.equal(res.status, 503); assert.match((await res.json()).message, /temporarily unavailable/);
    }
    assert.equal(admin.passwordResetTokenHash, undefined);
  } finally { process.env.SMTP_PASS = pass; }
});
test('malformed input, NoSQL email injection, invalid JSON and oversized auth bodies are rejected', async () => {
  for (const email of [null, '', 'invalid', { $ne: null }, 'a@example.test\r\nBcc:evil@example.test']) assert.equal((await request('/forgot-password', { email })).status, 400);
  assert.equal((await request('/reset-password', { token: { $ne: null } })).status, 400);
  const bad = await fetch(base + '/api/auth/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }); assert.equal(bad.status, 400);
  assert.equal((await request('/forgot-password', { email: 'a'.repeat(5000) })).status, 413);
});
test('known and unknown accounts receive identical receipts before slow SMTP; only the account email receives the link', async () => {
  let release; f.state.holdMail = new Promise(r => { release = r; });
  try {
    const res = await request('/forgot-password', { email: ' OWNER@EXAMPLE.TEST ' }, { Host: 'attacker.example', 'X-Forwarded-Host': 'attacker.example' });
    assert.equal(res.status, 202); assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    const unknown = await request('/forgot-password', { email: 'absent@example.test' });
    assert.equal(unknown.status, 202); assert.deepEqual(await unknown.json(), body);
    await until(() => f.mail.length === 1); firstToken = tokenFrom(f.mail[0]); assert(firstToken);
    assert.equal(f.mail[0].to, admin.email); assert.equal(f.mail[0].from, 'info@example.test');
    assert(!f.mail[0].text.includes('attacker.example')); assert(!JSON.stringify(body).includes(firstToken));
    assert.equal(admin.passwordResetTokenHash, hash(firstToken)); assert.notEqual(admin.passwordResetTokenHash, firstToken);
    assert(admin.passwordResetExpiresAt > new Date(Date.now() + 14 * 60_000)); assert.equal(f.rows.size, 1);
  } finally { release(); f.state.holdMail = null; }
});
test('a reset request preserves the password and old session; rapid repeats do not send another email', async () => {
  assert(await bcrypt.compare('Old-password-123', admin.password));
  assert.equal((await request('/me', undefined, { Authorization: 'Bearer ' + oldJwt })).status, 200);
  assert.equal((await request('/forgot-password', { email: admin.email })).status, 202);
  await new Promise(r => setTimeout(r, 40)); assert.equal(f.mail.length, 1);
});
test('expired tokens, mismatched passwords, short passwords and bcrypt truncation are rejected without changing the account', async () => {
  const expiry = admin.passwordResetExpiresAt; admin.passwordResetExpiresAt = new Date(Date.now() - 1000);
  assert.equal((await reset(firstToken)).status, 400); admin.passwordResetExpiresAt = expiry;
  for (const overrides of [{ confirmPassword: 'Different-password' }, { newPassword: 'short', confirmPassword: 'short' }, { newPassword: '😀'.repeat(30), confirmPassword: '😀'.repeat(30) }]) assert.equal((await reset(firstToken, overrides)).status, 400);
  assert(await bcrypt.compare('Old-password-123', admin.password)); assert.equal(admin.authVersion, 0);
});
test('successful reset hashes the password, consumes the token, invalidates old sessions and requires normal sign-in', async () => {
  const res = await reset(firstToken); assert.equal(res.status, 200); const receipt = await res.json(); assert.equal(receipt.token, undefined);
  assert(await bcrypt.compare('New-secure-password-123', admin.password)); assert.equal(admin.passwordResetTokenHash, undefined); assert.equal(admin.passwordResetExpiresAt, undefined); assert.equal(admin.authVersion, 1);
  assert.equal((await reset(firstToken)).status, 400);
  assert.equal((await request('/me', undefined, { Authorization: 'Bearer ' + oldJwt })).status, 401);
  assert.equal((await request('/login', { email: admin.email, password: 'Old-password-123' })).status, 401);
  const login = await request('/login', { email: admin.email, password: 'New-secure-password-123' }); assert.equal(login.status, 200);
  const session = await login.json(); assert.equal(jwt.decode(session.token).authVersion, 1);
  const me = await request('/me', undefined, { Authorization: 'Bearer ' + session.token }); assert.equal(me.status, 200);
  const profile = await me.json(); for (const field of ['password', 'authVersion', 'passwordResetTokenHash']) assert.equal(profile[field], undefined);
  await until(() => f.mail.some(mail => /password was changed/.test(mail.subject)));
  assert(f.mail.every(mail => !mail.text.includes('New-secure-password-123')));
});
test('two simultaneous uses of a valid token allow exactly one password change', async () => {
  const row = f.seed({ email: 'race@example.test' }); await request('/forgot-password', { email: row.email });
  await until(() => f.mail.some(mail => mail.to === row.email)); const token = tokenFrom(f.mail.find(mail => mail.to === row.email));
  const results = await Promise.all([reset(token), reset(token, { newPassword: 'Other-secure-password', confirmPassword: 'Other-secure-password' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]); assert.equal(row.authVersion, 1);
});
test('a newer reset replaces an older link and password versions are compatible with pre-existing MongoDB accounts', async () => {
  const row = f.seed({ email: 'replacement@example.test' }); delete row.authVersion;
  await request('/forgot-password', { email: row.email }); await until(() => f.mail.some(mail => mail.to === row.email));
  const old = tokenFrom(f.mail.find(mail => mail.to === row.email)); row.passwordResetRequestedAt = new Date(Date.now() - 61_000);
  await request('/forgot-password', { email: row.email }); await until(() => f.mail.filter(mail => mail.to === row.email && tokenFrom(mail)).length === 2);
  const recent = tokenFrom(f.mail.filter(mail => mail.to === row.email).at(-1)); assert.notEqual(old, recent);
  assert.equal((await reset(old)).status, 400); assert.equal((await reset(recent)).status, 200); assert.equal(row.authVersion, 1);
});
test('SMTP errors and non-acceptance clear only the failed token, keep the same public receipt and preserve the password', async () => {
  for (const flag of ['failMail', 'rejectMail']) {
    const row = f.seed({ email: flag.toLowerCase() + '@example.test' }); f.state[flag] = true;
    const res = await request('/forgot-password', { email: row.email }); assert.equal(res.status, 202);
    await until(() => f.mail.some(mail => mail.to === row.email)); await until(() => row.passwordResetTokenHash === undefined);
    f.state[flag] = false; assert(await bcrypt.compare('Old-password-123', row.password)); assert.equal(row.authVersion, 0);
  }
});
test('storage failure is recoverable and never exposes database credentials', async () => {
  f.state.failStore = true;
  try { const res = await reset('a'.repeat(64)); assert.equal(res.status, 503); assert(!JSON.stringify(await res.json()).includes('secret')); }
  finally { f.state.failStore = false; }
});
test('session checks use the database role, reject deleted users and fail closed during database errors', async () => {
  const row = f.seed({ email: 'editor@example.test', role: 'editor' });
  const token = jwt.sign({ id: row._id, role: 'admin' }, process.env.JWT_SECRET);
  assert.equal((await fetch(base + '/api/newsletter', { headers: { Authorization: 'Bearer ' + token } })).status, 403);
  f.rows.delete(row._id); assert.equal((await request('/me', undefined, { Authorization: 'Bearer ' + token })).status, 401);
  f.state.failStore = true; try { assert.equal((await request('/me', undefined, { Authorization: 'Bearer ' + token })).status, 503); } finally { f.state.failStore = false; }
});
test('regular password saves also hash the password, revoke sessions and clear outstanding reset links', async () => {
  const row = new User({ name: 'Existing user', email: 'saved@example.test', password: 'Changed-password', authVersion: 3, passwordResetTokenHash: 'old', passwordResetExpiresAt: new Date() }); row.isNew = false;
  await new Promise((resolve, reject) => User.schema.s.hooks.execPre('save', row, [], error => error ? reject(error) : resolve()));
  assert(await bcrypt.compare('Changed-password', row.password)); assert.equal(row.authVersion, 4); assert.equal(row.passwordResetTokenHash, undefined); assert.equal(row.getChanges().$inc.authVersion, 1);
});
test('per-email and IP attempt limits cannot be bypassed with forwarding headers', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await request('/forgot-password', { email: 'limited@example.test' }, { 'X-Forwarded-For': `10.0.0.${i}` })).status, 202);
  const blocked = await request('/forgot-password', { email: 'limited@example.test' }, { 'X-Forwarded-For': '10.0.0.100' }); assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '900');
  let res; for (let i = 0; i < 16; i++) { res = await reset('b'.repeat(64)); if (res.status === 429) break; }
  assert.equal(res.status, 429);
});
