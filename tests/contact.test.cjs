const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const jwt=require('jsonwebtoken');
const nodemailer=require('nodemailer');
process.env.JWT_SECRET='isolated-contact-secret';
const app=require('../dist/app').default;
const Model=require('../dist/models/ContactMessage').default;
const records=new Map();let server,base,failSave=false,failMail=false,sends=[];
const originals={};const envKeys=['SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_PASS','CONTACT_FROM_EMAIL','CONTACT_TO_EMAIL'];
const originalEnv=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
const admin=jwt.sign({id:'admin',role:'admin'},process.env.JWT_SECRET);
const staff=jwt.sign({id:'staff',role:'user'},process.env.JWT_SECRET);
function wrap(value){const query={select:()=>query,lean:()=>Promise.resolve(value),then:(resolve,reject)=>Promise.resolve(value).then(resolve,reject)};return query;}
function smtp(enabled=true){for(const key of envKeys)delete process.env[key];if(enabled)Object.assign(process.env,{SMTP_HOST:'smtp.example.test',SMTP_PORT:'465',SMTP_USER:'owner@example.test',SMTP_PASS:'not-a-real-password',CONTACT_FROM_EMAIL:'owner@example.test',CONTACT_TO_EMAIL:'inbox@example.test'});}
before(async()=>{
  for(const key of ['create','findOne','findOneAndUpdate','updateOne','find','countDocuments','findById','findByIdAndUpdate'])originals[key]=Model[key];
  Model.create=async data=>{
    if(failSave)throw Error('private-database-details');
    if([...records.values()].some(x=>x.submissionId===data.submissionId))throw {code:11000};
    const id=(records.size+1).toString(16).padStart(24,'0');
    const row={...data,_id:id,id,status:'new',notificationStatus:'pending',createdAt:new Date(),get(key){return this[key];}};records.set(id,row);return row;
  };
  Model.findOne=async query=>[...records.values()].find(x=>x.submissionId===query.submissionId)||null;
  Model.findById=id=>wrap(records.get(id)||null);
  Model.updateOne=async(query,update)=>{const row=records.get(query._id);if(row&&(!query.notificationStatus||query.notificationStatus.$in.includes(row.notificationStatus)))Object.assign(row,update.$set);};
  Model.findOneAndUpdate=async(query,update)=>{const row=records.get(query._id);if(!row||!['pending','failed','disabled'].includes(row.notificationStatus))return null;Object.assign(row,update.$set);return row;};
  Model.findByIdAndUpdate=(id,update)=>{const row=records.get(id);if(row)Object.assign(row,update.$set);return wrap(row||null);};
  Model.find=filter=>{
    let rows=[...records.values()].filter(x=>!filter.status||x.status===filter.status);let start=0,end=25;
    const q={sort:()=>q,skip:n=>{start=n;return q;},limit:n=>{end=n;return q;},select:()=>q,lean:async()=>rows.slice(start,start+end).map(({submissionId,get,id,...x})=>x)};return q;
  };
  Model.countDocuments=async filter=>[...records.values()].filter(x=>!filter.status||x.status===filter.status).length;
  originals.transport=nodemailer.createTransport;
  nodemailer.createTransport=options=>{assert.equal(options.secure,true);assert.equal(options.disableUrlAccess,true);return {close(){},async sendMail(mail){sends.push(mail);if(failMail)throw Error('secret-mail-password');return {accepted:['inbox@example.test']};}};};
  smtp(false);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{for(const [key,value]of Object.entries(originals))if(key!=='transport')Model[key]=value;nodemailer.createTransport=originals.transport;for(const [k,v]of Object.entries(originalEnv))if(v===undefined)delete process.env[k];else process.env[k]=v;server.closeAllConnections();await new Promise(r=>server.close(r));});
function payload(extra={}){return {submissionId:randomUUID(),firstName:'Jane',lastName:'Smith',email:`sender${records.size}@example.test`,interest:'Volunteering',message:'How can I help?\nThank you.',website:'',...extra};}
async function request(path='',method='GET',body,token){return fetch(base+'/api/contact'+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});}
test('public submission saves validated fields, with no false email claim',async()=>{const data=payload({firstName:' Jane ',extra:'discard'});const res=await request('','POST',data);assert.equal(res.status,201);assert.equal((await res.json()).message,'Thank you. Your message has been received.');const row=[...records.values()].at(-1);assert.equal(row.firstName,'Jane');assert.equal(row.extra,undefined);assert.equal(row.notificationStatus,'disabled');assert.equal(sends.length,0);});
test('backend rejects missing, malformed, oversized and bot fields without saving',async()=>{const count=records.size;for(const extra of [{firstName:' '},{email:'bad'},{email:'a@example.test\r\nBcc: attacker@example.test'},{message:''},{message:'x'.repeat(5001)},{interest:'bad'},{website:'spam'},{submissionId:{$gt:''}}])assert.equal((await request('','POST',payload(extra))).status,400);assert.equal(records.size,count);});
test('malformed JSON and oversized requests return safe client errors',async()=>{for(const [body,status]of [['{broken',400],[JSON.stringify({message:'x'.repeat(18000)}),413]]){const res=await fetch(base+'/api/contact',{method:'POST',headers:{'Content-Type':'application/json'},body});assert.equal(res.status,status);assert(!JSON.stringify(await res.json()).includes('stack'));}});
test('database failure does not return success or leak internals',async()=>{failSave=true;const res=await request('','POST',payload());failSave=false;assert.equal(res.status,503);assert(!JSON.stringify(await res.json()).includes('private'));});
test('SMTP notification uses fixed recipient/from and visitor Reply-To',async()=>{smtp();const data=payload();const res=await request('','POST',data);assert.equal(res.status,201);const mail=sends.at(-1);assert.equal(mail.from,'owner@example.test');assert.equal(mail.to,'inbox@example.test');assert.equal(mail.replyTo,data.email);assert(mail.text.includes(data.message));assert.equal([...records.values()].at(-1).notificationStatus,'sent');});
test('retrying the same submission stores and sends only once',async()=>{const data=payload();assert.equal((await request('','POST',data)).status,201);const count=records.size,sent=sends.length;assert.equal((await request('','POST',data)).status,200);assert.equal(records.size,count);assert.equal(sends.length,sent);assert.equal((await request('','POST',{...data,message:'changed'})).status,409);});
test('SMTP failure keeps message saved and allows authenticated notification retry',async()=>{failMail=true;assert.equal((await request('','POST',payload())).status,201);const row=[...records.values()].at(-1);assert.equal(row.notificationStatus,'failed');failMail=false;assert.equal((await request(`/${row.id}/notify`,'POST',{},admin)).status,200);assert.equal(row.notificationStatus,'sent');const count=sends.length;await request(`/${row.id}/notify`,'POST',{},admin);assert.equal(sends.length,count);});
test('inbox and mutation endpoints require admin access',async()=>{const id=[...records.keys()][0];for(const [path,method,body]of [['','GET'],[`/${id}`,'PATCH',{status:'read'}],[`/${id}/notify`,'POST',{}]]){assert.equal((await request(path,method,body)).status,401);assert.equal((await request(path,method,body,staff)).status,403);}});
test('admin inbox includes configuration, pagination and safe caching',async()=>{const res=await request('','GET',undefined,admin);assert.equal(res.status,200);assert.equal(res.headers.get('Cache-Control'),'no-store');const data=await res.json();assert.equal(data.pageSize,25);assert.equal(data.emailConfigured,true);assert.equal(data.total,records.size);assert(!('submissionId'in data.messages[0]));assert.equal((await request('?page=-1','GET',undefined,admin)).status,400);});
test('admin status updates allow only supported values and filter correctly',async()=>{const id=[...records.keys()][0];const res=await request(`/${id}`,'PATCH',{status:'resolved',email:'overwrite'},admin);assert.equal(res.status,200);assert.equal(records.get(id).status,'resolved');assert.notEqual(records.get(id).email,'overwrite');assert.equal((await request(`/${id}`,'PATCH',{status:'invalid'},admin)).status,400);assert.equal((await request('/invalid','PATCH',{status:'read'},admin)).status,400);const data=await(await request('?status=resolved','GET',undefined,admin)).json();assert.equal(data.total,1);});
test('repeated public submissions are rate limited per sender',async()=>{smtp(false);for(let i=0;i<5;i++)assert.equal((await request('','POST',payload({email:'rate@example.test'}))).status,201);const res=await request('','POST',payload({email:'rate@example.test'}));assert.equal(res.status,429);assert.equal(res.headers.get('Retry-After'),'900');});
test('health identifies the contact contract without exposing mail credentials',async()=>{const data=await(await fetch(base+'/api/health')).json();assert.equal(data.contact.contract,'contact-v1');assert.equal(data.contact.emailConfigured,false);assert(!JSON.stringify(data).includes('password'));});
