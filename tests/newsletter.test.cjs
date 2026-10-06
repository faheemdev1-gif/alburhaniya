const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { newsletterFixture } = require('./helpers/newsletterFixture.cjs');
const envKeys = ['JWT_SECRET','SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_PASS','CONTACT_FROM_EMAIL','NEWSLETTER_FROM_EMAIL','NEWSLETTER_SITE_URL'];
const oldEnv = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
process.env.JWT_SECRET = 'newsletter-isolated-test-secret';
const app = require('../dist/app').default;
const Model = require('../dist/models/NewsletterSubscriber').default;
const service = require('../dist/services/newsletterNotification');
const f = newsletterFixture(Model, nodemailer);
let server, base;
const admin = jwt.sign({ id: 'admin', role: 'admin' }, process.env.JWT_SECRET);
const staff = jwt.sign({ id: 'staff', role: 'user' }, process.env.JWT_SECRET);
function smtp(enabled = true) {
  for (const key of envKeys) if (key !== 'JWT_SECRET') delete process.env[key];
  if (enabled) Object.assign(process.env, { SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_USER: 'owner@example.test', SMTP_PASS: 'private-test-password', CONTACT_FROM_EMAIL: 'owner@example.test' });
}
before(async () => { smtp(false); server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { f.restore(); for (const [k,v] of Object.entries(oldEnv)) if (v === undefined) delete process.env[k]; else process.env[k] = v; server.closeAllConnections(); await new Promise(r => server.close(r)); });
function request(path, method = 'GET', data, token) {
  return fetch(base + '/api/newsletter' + path, { method, headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
}
const subscribe = email => request('/subscribe', 'POST', { email, website: '' });
const mailToken = mail => /\/confirm#token=([a-f0-9]{64})/.exec(mail.text)[1];
const unlinkToken = mail => /\/unsubscribe#token=([a-f0-9.]+)/.exec(mail.text)[1];
const latest = () => [...f.rows.values()].at(-1);

test('unconfigured email saves one normalized pending request and returns an honest receipt', async () => {
  const res = await subscribe('  Jane@Example.Test '); assert.equal(res.status, 202); const body = await res.json(); assert.equal(body.confirmationAvailable, false); assert.match(body.message, /saved/);
  assert.equal(latest().email, 'jane@example.test'); assert.equal(latest().status, 'pending'); assert.equal(f.mail.length, 0);
  await subscribe('jane@example.test'); assert.equal(f.rows.size, 1);
});
test('validation rejects invalid, injected, oversized and bot inputs before storage', async () => {
  const count = f.rows.size;
  for (const data of [null,[],{}, { email: { $gt: '' } },{ email: 'bad' },{ email: 'a\0@example.test' },{ email: 'a@example.test\r\nBcc: b@example.test' }, { email: 'x'.repeat(255)+'@example.test' }, { email: 'a@example.test', website: 'spam' }]) assert.equal((await request('/subscribe', 'POST', data)).status, 400);
  assert.equal(f.rows.size, count);
  assert.equal((await fetch(base+'/api/newsletter/subscribe',{method:'POST',body:'email=a@example.test'})).status,415);
});
test('JSON parser has a small limit and safe errors', async () => {
  for (const [body,status] of [['{broken',400],[JSON.stringify({email:'x'.repeat(5000)}),413]]) {
    const res = await fetch(base+'/api/newsletter/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},body}); assert.equal(res.status,status); assert(!JSON.stringify(await res.json()).includes('stack'));
  }
});
test('database failure returns failure without leaking connection details', async () => {
  f.state.failStore = true; const res = await subscribe('storage@example.test'); f.state.failStore = false; assert.equal(res.status,503); assert(!JSON.stringify(await res.json()).includes('private'));
});
test('SMTP sends confirmation to the visitor and stores only the hashed token', async () => {
  smtp(); const res = await subscribe('confirm@example.test'); assert.equal(res.status,200);
  const row = latest(), mail = f.mail.at(-1), token = mailToken(mail);
  assert.equal(row.status,'pending'); assert.equal(row.confirmationHash, service.tokenHash(token)); assert.notEqual(row.confirmationHash,token); assert(row.confirmationExpiresAt > new Date());
  assert.equal(mail.to,row.email); assert.equal(mail.from,'owner@example.test'); assert.match(mail.text,/48 hours/); assert.equal(f.transportOptions.at(-1).disableUrlAccess,true); assert.equal(f.transportOptions.at(-1).secure,true);
  const before = f.mail.length; await subscribe(row.email); assert.equal(f.mail.length,before);
});
test('GET does not confirm; POST confirms once, then remains idempotent', async () => {
  const row = latest(), token = mailToken(f.mail.at(-1));
  assert.equal((await request('/confirm?token='+token)).status,401); assert.equal(row.status,'pending');
  assert.equal((await request('/confirm','POST',{token})).status,200); assert.equal(row.status,'confirmed'); assert(row.confirmedAt instanceof Date);
  assert.equal((await request('/confirm','POST',{token})).status,200);
  const count = f.mail.length; await subscribe(row.email); assert.equal(row.status,'confirmed'); assert.equal(f.mail.length,count);
});
test('invalid and expired confirmation links cannot add subscribers to the list', async () => {
  await subscribe('expired@example.test'); const row = latest(), token = mailToken(f.mail.at(-1)); row.confirmationExpiresAt = new Date(0);
  for (const value of [token,'0'.repeat(64),'bad',{$gt:''}]) assert.equal((await request('/confirm','POST',{token:value})).status,400);
  assert.equal(row.status,'pending');
});
test('signed unsubscribe is idempotent and forged links cannot change consent', async () => {
  const row = [...f.rows.values()].find(r=>r.email==='confirm@example.test'); const mail = f.mail.find(m=>m.to===row.email); const token = unlinkToken(mail);
  assert.equal((await request('/unsubscribe','POST',{token:token.slice(0,-1)+(token.endsWith('a')?'b':'a')})).status,400); assert.equal(row.status,'confirmed');
  assert.equal((await request('/unsubscribe','POST',{token})).status,200); assert.equal(row.status,'unsubscribed'); assert.equal(row.confirmationHash,undefined);
  assert.equal((await request('/unsubscribe','POST',{token})).status,200);
  await subscribe(row.email); assert.equal(row.status,'pending'); assert.equal(row.confirmedAt,undefined); assert.equal((await request('/confirm','POST',{token:mailToken(mail)})).status,400);
});
test('SMTP failure keeps pending request, returns an actionable error and retries safely', async () => {
  f.state.failMail = true; const res = await subscribe('mailfail@example.test'); assert.equal(res.status,503); assert(!JSON.stringify(await res.json()).includes('private'));
  const row=latest(); assert.equal(row.notificationStatus,'failed'); assert.equal(row.status,'pending'); f.state.failMail=false;
  const count=f.mail.length; assert.equal((await request(`/${row.id}/resend`,'POST',{},admin)).status,503); assert.equal(f.mail.length,count);
  row.notificationAttemptedAt=new Date(0); assert.equal((await request(`/${row.id}/resend`,'POST',{},admin)).status,200); assert.equal(row.notificationStatus,'sent');
});
test('atomic claim prevents concurrent duplicate confirmation emails', async () => {
  let release; f.state.holdMail=new Promise(r=>{release=r;});
  const pending=subscribe('concurrent@example.test');
  while (!f.mail.some(m=>m.to==='concurrent@example.test')) await new Promise(r=>setTimeout(r,5));
  const second=await subscribe('concurrent@example.test'); assert.equal(second.status,200); assert.equal(f.mail.filter(m=>m.to==='concurrent@example.test').length,1);
  f.state.holdMail=null; release(); assert.equal((await pending).status,200);
});
test('a unique index race resolves to the existing request without duplicates', async () => {
  f.state.collision=true; assert.equal((await subscribe('race@example.test')).status,200); assert.equal([...f.rows.values()].filter(r=>r.email==='race@example.test').length,1);
});
test('subscriber management and CSV export require an admin JWT', async () => {
  const id=latest().id;
  for (const [path,method,data] of [['','GET'],['/export','GET'],[`/${id}/resend`,'POST',{}],[`/${id}/unsubscribe`,'POST',{}]]) {
    assert.equal((await request(path,method,data)).status,401); assert.equal((await request(path,method,data,staff)).status,403);
  }
});
test('admin listing is paginated, filters literally, and never returns token hashes', async () => {
  for(let i=0;i<27;i++)f.seed({email:`list${i}@example.test`,status:'confirmed',confirmedAt:new Date()});
  const res=await request('?status=confirmed','GET',undefined,admin); assert.equal(res.headers.get('Cache-Control'),'no-store'); const data=await res.json(); assert.equal(data.subscribers.length,25); assert.equal(data.total,27); assert.equal(data.emailConfigured,true);
  const page2=await(await request('?status=confirmed&page=2','GET',undefined,admin)).json();assert.equal(page2.subscribers.length,2);
  const pending=await(await request('?status=pending','GET',undefined,admin)).json(); assert(!JSON.stringify(pending).includes('confirmationHash'));assert(!JSON.stringify(pending).includes('confirmationExpiresAt'));
  const search=await(await request('?search='+encodeURIComponent('list.*'),'GET',undefined,admin)).json();assert.equal(search.total,0);
  for(const query of ['?page=-1','?status=bad','?search[x]=x'])assert.equal((await request(query,'GET',undefined,admin)).status,400);
});
test('CSV includes confirmed addresses only, confirmation dates, unsubscribe links and formula escaping', async () => {
  f.seed({email:'=formula@example.test',status:'confirmed',confirmedAt:new Date()});
  const res=await request('/export','GET',undefined,admin),csv=await res.text();assert.equal(res.status,200);assert.match(res.headers.get('Content-Type'),/text\/csv/);assert.match(csv,/confirmed_at,unsubscribe_url/);assert.match(csv,/"'=formula@example.test"/);assert(!csv.includes('mailfail@example.test'));assert(!csv.includes('confirmationHash'));assert.match(csv,/\/newsletter\/unsubscribe#token=/);
});
test('admin can unsubscribe and resend pending confirmations but cannot manually confirm', async () => {
  const row=latest(); assert.equal((await request(`/${row.id}/resend`,'POST',{},admin)).status,409); assert.equal((await request(`/${row.id}`,'PATCH',{status:'confirmed'},admin)).status,404);
  assert.equal((await request(`/${row.id}/unsubscribe`,'POST',{},admin)).status,200);assert.equal(row.status,'unsubscribed');assert.equal((await request(`/${row.id}/resend`,'POST',{},admin)).status,409);
  assert.equal((await request('/bad/resend','POST',{},admin)).status,400);
  smtp(false); const pending=[...f.rows.values()].find(r=>r.status==='pending');const res=await request(`/${pending.id}/resend`,'POST',{},admin); assert.equal(res.status,202);
});
test('sign-ups are rate limited per email with a Retry-After header', async () => {
  for(let i=0;i<5;i++)assert.equal((await subscribe('rate@example.test')).status,202);
  const res=await subscribe('rate@example.test');assert.equal(res.status,429);assert.equal(res.headers.get('Retry-After'),'900');
});
test('health reports newsletter readiness without exposing credentials', async () => {
  const data=await(await fetch(base+'/api/health')).json();assert.equal(data.newsletter.contract,'newsletter-v1');assert.equal(data.newsletter.emailConfigured,false);assert(!JSON.stringify(data).includes('password'));
  smtp();process.env.NEWSLETTER_SITE_URL='https://attacker:secret@example.test';assert.equal(service.newsletterEmailConfigured(),false);delete process.env.NEWSLETTER_SITE_URL;
});
