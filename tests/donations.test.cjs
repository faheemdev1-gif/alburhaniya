const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const envKeys=['STRIPE_SECRET_KEY','DONATION_SITE_URL'];
const oldEnv=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
const originalFetch=global.fetch;
const app=require('../dist/app').default;
const {DONATION_CONTRACT}=require('../dist/services/stripeCheckout');
let server,base,fail=0,unsafeUrl=false,wrongAmount=false,breakNetwork=false;
const calls=[],sessions=new Map(),attempts=new Map();
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function newSession(data={}){const id='cs_test_'+randomUUID().replaceAll('-','');const row={id,url:'https://checkout.stripe.com/c/pay/'+id,amount_total:1000,currency:'gbp',mode:'payment',status:'open',payment_status:'unpaid',metadata:{donation_contract:DONATION_CONTRACT,amount_pence:'1000'},...data};sessions.set(id,row);return row;}
before(async()=>{
  delete process.env.STRIPE_SECRET_KEY;delete process.env.DONATION_SITE_URL;
  global.fetch=async(url,options={})=>{
    if(!String(url).startsWith('https://api.stripe.com/'))return originalFetch(url,options);
    assert(String(url).startsWith('https://api.stripe.com/v1/checkout/sessions'));assert.equal(options.redirect,'error');assert(options.signal);
    calls.push({url,options});if(breakNetwork)throw Error('private-secret-network-error');if(fail)return response({error:{message:'private-stripe-secret-error'}},fail);
    if(options.method==='GET'){const id=String(url).split('/').at(-1);return sessions.has(id)?response(sessions.get(id)):response({error:{}},404);}
    const body=new URLSearchParams(options.body),key=options.headers['Idempotency-Key'];
    if(attempts.has(key)){const attempt=attempts.get(key);return attempt.body===options.body?response(attempt.session):response({error:{type:'idempotency_error'}},400);}
    const row=newSession({amount_total:Number(body.get('line_items[0][price_data][unit_amount]'))+(wrongAmount?1:0),metadata:{donation_contract:body.get('metadata[donation_contract]'),amount_pence:body.get('metadata[amount_pence]')}});
    if(unsafeUrl)row.url='https://checkout.stripe.com.attacker.test/pay';attempts.set(key,{session:row,body:options.body});return response(row);
  };
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{global.fetch=originalFetch;for(const[k,v]of Object.entries(oldEnv))if(v===undefined)delete process.env[k];else process.env[k]=v;server.closeAllConnections();await new Promise(r=>server.close(r));});
function request(path,method='GET',body){return originalFetch(base+'/api/donations'+path,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const checkout=(amountPence=1000,extra={})=>request('/checkout','POST',{amountPence,requestId:randomUUID(),...extra});
test('unconfigured backend returns an honest error without creating a Stripe session',async()=>{const res=await checkout();assert.equal(res.status,503);assert.match((await res.json()).message,/not configured/);assert.equal(calls.length,0);process.env.STRIPE_SECRET_KEY='sk_test_isolated123';});
test('all preset and custom amounts create exact GBP totals with fixed server-owned URLs',async()=>{
  for(const amount of[1000,2500,5000,10000,25000,50000,7317]){
    const res=await checkout(amount,{currency:'usd',quantity:99,success_url:'https://attacker.test'});assert.equal(res.status,200);const data=await res.json();assert.equal(data.amountPence,amount);assert.match(data.url,/^https:\/\/checkout\.stripe\.com\//);
    const call=calls.at(-1),body=new URLSearchParams(call.options.body);assert.equal(body.get('line_items[0][price_data][unit_amount]'),String(amount));assert.equal(body.get('line_items[0][price_data][currency]'),'gbp');assert.equal(body.get('line_items[0][quantity]'),'1');assert.equal(body.get('mode'),'payment');assert.equal(body.get('submit_type'),'donate');assert.equal(body.get('adaptive_pricing[enabled]'),'false');assert.match(body.get('success_url'),/^https:\/\/al-burhaniyainternational\.co\.uk\/donation\/return/);assert.equal(call.options.headers.Authorization,'Bearer sk_test_isolated123');assert.equal(call.options.headers['Stripe-Version'],'2025-06-30.basil');assert(!JSON.stringify(data).includes('sk_test'));
  }
});
test('unsafe, fractional, zero, excessive and non-integer amounts never reach Stripe',async()=>{const count=calls.length;for(const amount of[0,-100,99,1000001,10.999,'2500',null,{$gt:0}])assert.equal((await checkout(amount)).status,400);assert.equal((await checkout(1000,{requestId:'bad'})).status,400);assert.equal(calls.length,count);});
test('checkout JSON has a small size limit, rejects malformed data and non-JSON',async()=>{for(const[body,status]of[['{broken',400],[JSON.stringify({extra:'x'.repeat(3000)}),413]])assert.equal((await originalFetch(base+'/api/donations/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body})).status,status);assert.equal((await originalFetch(base+'/api/donations/checkout',{method:'POST',body:'amount=25'})).status,415);});
test('retry uses the same Stripe session and changed parameters cannot reuse its request ID',async()=>{const requestId=randomUUID();const first=await(await checkout(2500,{requestId})).json();const second=await(await checkout(2500,{requestId})).json();assert.equal(first.url,second.url);assert.equal((await checkout(5000,{requestId})).status,409);assert.equal(calls.at(-1).options.headers['Idempotency-Key'],'donation-v1:'+requestId);});
test('Stripe configuration, network and API failures do not leak secrets',async()=>{for(const status of[401,429,500]){fail=status;const res=await checkout();assert.equal(res.status,503);assert(!JSON.stringify(await res.json()).includes('private'));}fail=0;breakNetwork=true;assert.equal((await checkout()).status,503);breakNetwork=false;});
test('unexpected checkout amounts or unsafe redirect URLs are rejected',async()=>{unsafeUrl=true;assert.equal((await checkout()).status,503);unsafeUrl=false;wrongAmount=true;assert.equal((await checkout()).status,503);wrongAmount=false;});
test('checkout URL configuration cannot use insecure remote origins or credentials',async()=>{for(const url of['http://attacker.test','https://owner:secret@example.test','javascript:alert(1)','https://example.test/path']){process.env.DONATION_SITE_URL=url;assert.equal((await checkout()).status,503);}delete process.env.DONATION_SITE_URL;});
test('return status is verified with Stripe; only a completed, paid donation shows paid',async()=>{const row=newSession();const path='/session/'+row.id;assert.deepEqual(await(await request(path)).json(),{status:'pending',amountPence:1000});row.status='complete';assert.equal((await(await request(path)).json()).status,'pending');row.payment_status='paid';const res=await request(path);assert.equal(res.headers.get('Cache-Control'),'no-store');const result=await res.json();assert.deepEqual(result,{status:'paid',amountPence:1000});assert.equal(Object.keys(result).length,2);row.status='expired';row.payment_status='unpaid';assert.equal((await(await request(path)).json()).status,'expired');});
test('other account sessions, forged IDs and mismatched totals cannot show success',async()=>{const foreign=newSession({metadata:{}});assert.equal((await request('/session/'+foreign.id)).status,404);const wrong=newSession({amount_total:2500});assert.equal((await request('/session/'+wrong.id)).status,404);assert.equal((await request('/session/not-a-session')).status,400);assert.equal((await request('/session/cs_test_notfound123456789')).status,404);});
test('health exposes readiness but no Stripe credentials',async()=>{const res=await originalFetch(base+'/api/health');const data=await res.json();assert.equal(data.donations.contract,DONATION_CONTRACT);assert.equal(data.donations.configured,true);assert(!JSON.stringify(data).includes('sk_test'));});
test('public checkout creation is rate limited without trusting forwarding headers',async()=>{let res;for(let i=0;i<105;i++){res=await checkout();if(res.status===429)break;}assert.equal(res.status,429);assert.equal(res.headers.get('Retry-After'),'900');});
