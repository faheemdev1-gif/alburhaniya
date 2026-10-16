const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const Model = require('../dist/models/Event').default;
const { londonToday } = require('../dist/services/eventDate');
const envKeys = ['JWT_SECRET','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','CONTACT_FROM_EMAIL','CONTACT_TO_EMAIL','EVENT_TO_EMAIL','EVENT_FROM_EMAIL'];
const env = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
process.env.JWT_SECRET = 'isolated-registration-test';
const app = require('../dist/app').default;
let server, base, failStore = false, failMail = false;
const mail = [], rows = new Map(), originals = {};
const eventId = '111111111111111111111111';
function seed(id, capacity = 10, dateISO = '2099-01-01') {
 const row = new Model({ _id: id, title: 'Community Day', slug: 'community-day', capacity, registered: 0, registrations: [], dateISO, dateLabel: '1 January 2099', timeStart: '10:00', timeEnd: '12:00', location: 'Manchester', address: 'Community centre', price: 'Free', category: 'Gathering', categoryKey: 'gathering', organiser: 'Al-Burhaniya', image: 'image.jpg', thumbImage: 'image.jpg', shortDesc: 'Community day', fullDesc: 'Community day', day: '01', month: 'JAN', year: '2099' });
 rows.set(id, row); return row;
}
function compare(row, filter) {
 return Object.entries(filter).every(([key, value]) => {
  if (key === '$or') return value.some(f => compare(row, f));
  if (value && typeof value === 'object' && !(value instanceof Date) && !value._bsontype) return Object.entries(value).every(([op,target]) => {
   if(op === '$in')return target.includes(row[key]); if(op === '$lt')return row[key] < target; if(op === '$gte')return row[key] >= target;
   throw Error('Unsupported operator '+op);
  });
  return String(row[key]) === String(value);
 });
}
function query(value) { const q={ select:()=>q, then:(resolve,reject)=>Promise.resolve(value).then(resolve,reject) };return q; }
function choose(filter) {
 const row = rows.get(String(filter._id)); if(!row)return null;
 if(filter['registrations._id'] && !row.registrations.some(r=>String(r._id)===String(filter['registrations._id'])))return null;
 if(filter.dateISO && row.dateISO < filter.dateISO.$gte)return null;
 if(filter.$expr && row.registered + filter.$expr.$lte[0].$add[1] > row.capacity)return null;
 if(filter.registrations?.$not && row.registrations.some(r=>compare(r,filter.registrations.$not.$elemMatch)))return null;
 if(filter.registrations?.$elemMatch && !row.registrations.some(r=>compare(r,filter.registrations.$elemMatch)))return null;
 return row;
}
function update(filter, change) {
 if(failStore)throw Error('private-db');
 const row=choose(filter); if(!row)return null;
 if(change.$inc)row.registered+=change.$inc.registered;
 if(change.$push)row.registrations.push(change.$push.registrations);
 const record = filter.registrations?.$elemMatch ? row.registrations.find(r=>compare(r,filter.registrations.$elemMatch)) : row.registrations.find(r=>String(r._id)===String(filter['registrations._id']));
 for(const [key,value]of Object.entries(change.$set||{})){
  record[key.split('.').at(-1)]=value;
 }
 return row;
}
before(async()=>{
 for(const key of envKeys)if(key!=='JWT_SECRET')delete process.env[key];
 seed(eventId);
 for(const key of ['findOneAndUpdate','findById','updateOne','exists'])originals[key]=Model[key];
 Model.findOneAndUpdate=(filter,change)=>query(update(filter,change));
 Model.findById=id=>{if(failStore)throw Error('private-db');return query(rows.get(String(id))||null);};
 Model.updateOne=async(filter,change)=>({modifiedCount:update(filter,change)?1:0});
 Model.exists=async filter=>Boolean(choose(filter));
 originals.createTransport=nodemailer.createTransport;
 nodemailer.createTransport=()=>({close(){},async sendMail(data){mail.push(data);if(failMail)throw Error('private-smtp');return{accepted:[data.to]};}});
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api/events`;
});
after(async()=>{for(const key of ['findOneAndUpdate','findById','updateOne','exists'])Model[key]=originals[key];nodemailer.createTransport=originals.createTransport;for(const[k,v]of Object.entries(env))if(v===undefined)delete process.env[k];else process.env[k]=v;server.closeAllConnections();await new Promise(r=>server.close(r));});
const payload=(extra={})=>({submissionId:randomUUID(),firstName:'Jane',lastName:'Smith',email:randomUUID()+'@example.test',phone:'+44 1234',notes:'Two guests',places:2,website:'',...extra});
function req(path,method='GET',data,role){return fetch(base+path,{method,headers:{...(data!==undefined?{'Content-Type':'application/json'}:{}),...(role?{Authorization:'Bearer '+jwt.sign({id:'tester',role},process.env.JWT_SECRET)}:{})},...(data!==undefined?{body:JSON.stringify(data)}:{})});}
const register=(data,id=eventId)=>req(`/${id}/register`,'POST',data);
test('real event schema hides attendee details by default and validates registration fields',async()=>{
 assert.equal(Model.schema.path('registrations').options.select,false);
 const row=seed('222222222222222222222222');row.registrations.push(payload({places:5}));assert(row.validateSync());rows.delete(String(row._id));
 assert.match(londonToday(),/^\d{4}-\d{2}-\d{2}$/);
});
test('saves actual names, contact details, notes and requested places without claiming email delivery',async()=>{
 const data=payload();const res=await register(data);assert.equal(res.status,201);const receipt=await res.json();assert.equal(receipt.registered,2);assert.equal(receipt.spotsLeft,8);assert.equal(res.headers.get('Cache-Control'),'no-store');
 const row=rows.get(eventId).registrations[0];assert.equal(row.email,data.email);assert.equal(row.notes,data.notes);assert.equal(row.places,2);assert.equal(row.organiserNotificationStatus,'disabled');assert.equal(row.confirmationNotificationStatus,'disabled');assert.equal(mail.length,0);assert.equal(Object.hasOwn(receipt,'email'),false);
});
test('invalid IDs, missing attendee details, fractional places and injection are rejected before reservation',async()=>{
 const count=rows.get(eventId).registered;
 for(const data of [{},null,[],payload({email:{$gt:''}}),payload({firstName:'Jane\r\nBcc: attacker'}),payload({places:0}),payload({places:1.5}),payload({places:5}),payload({notes:'a'.repeat(2001)}),payload({website:'bot'})])assert.equal((await register(data)).status,400);
 assert.equal((await register(payload(),'not-an-id')).status,400);assert.equal(rows.get(eventId).registered,count);
});
test('registration JSON is bounded and malformed forms fail honestly',async()=>{
 for(const [body,status]of [['{bad',400],[JSON.stringify({notes:'x'.repeat(9000)}),413]])assert.equal((await fetch(base+`/${eventId}/register`,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,status);
 assert.equal((await fetch(base+`/${eventId}/register`,{method:'POST',body:'places=1'})).status,415);
});
test('retry reserves once; an existing email cannot register again or change the saved form',async()=>{
 const data=payload();const first=await(await register(data)).json();const second=await(await register(data)).json();assert.equal(first.reference,second.reference);assert.equal(first.registered,second.registered);assert.equal((await register({...data,submissionId:randomUUID()})).status,409);assert.equal((await register({...data,places:1})).status,409);
});
test('parallel reservation requests cannot both take the final places; closed and zero-capacity events reject registrations',async()=>{
 const id='333333333333333333333333';seed(id,3);const results=await Promise.all([register(payload(),id),register(payload(),id)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal(rows.get(id).registered,2);assert.equal(rows.get(id).registrations.length,1);
 seed('444444444444444444444444',10,'2000-01-01');assert.equal((await register(payload(),'444444444444444444444444')).status,409);
 seed('555555555555555555555555',0);assert.equal((await register(payload(),'555555555555555555555555')).status,409);assert.equal((await register(payload(),'666666666666666666666666')).status,404);
});
test('storage failure cannot return success or disclose internal database errors',async()=>{failStore=true;const res=await register(payload());failStore=false;assert.equal(res.status,503);assert(!JSON.stringify(await res.json()).includes('private'));});
test('SMTP sends organiser details to the fixed main mailbox and attendee confirmation to the visitor',async()=>{
 Object.assign(process.env,{SMTP_HOST:'smtp.example.test',SMTP_PORT:'465',SMTP_USER:'info@alburhaniyainternational.org.uk',SMTP_PASS:'test-password',CONTACT_FROM_EMAIL:'info@alburhaniyainternational.org.uk'});
 const data=payload({places:1});const res=await register(data);assert.equal(res.status,201);const id=(await res.json()).reference;
 const organiser=mail.find(m=>m.text.includes(id)&&m.to==='info@alburhaniyainternational.org.uk');assert(organiser);assert.equal(organiser.replyTo,data.email);assert.match(organiser.text,/Places: 1/);
 const visitor=mail.find(m=>m.text.includes(id)&&m.to===data.email);assert(visitor);assert.match(visitor.text,/reserved/);const count=mail.length;await register(data);assert.equal(mail.length,count);
});
test('SMTP failure keeps the registration and allows admin retries without reserving again',async()=>{
 failMail=true;const res=await register(payload({places:1}));assert.equal(res.status,201);failMail=false;const id=(await res.json()).reference;const count=rows.get(eventId).registered;
 assert.equal((await req(`/${eventId}/registrations/${id}/notify`,'POST',{},'admin')).status,200);assert.equal(rows.get(eventId).registered,count);const row=rows.get(eventId).registrations.find(r=>String(r._id)===id);assert.equal(row.organiserNotificationStatus,'sent');assert.equal(row.confirmationNotificationStatus,'sent');
});
test('registration details and notification retries are admin-only; listing omits submission tokens',async()=>{
 for(const role of [undefined,'user']){assert.equal((await req(`/${eventId}/registrations`,'GET',undefined,role)).status,role?403:401);assert.equal((await req(`/${eventId}/registrations/111111111111111111111111/notify`,'POST',{},role)).status,role?403:401);}
 const res=await req(`/${eventId}/registrations`,'GET',undefined,'admin');assert.equal(res.status,200);const data=await res.json();assert.equal(data.total,rows.get(eventId).registrations.length);assert(!JSON.stringify(data).includes('submissionId'));assert.equal(data.emailConfigured,true);
});
