const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../dist/app').default;
const Model = require('../dist/models/SiteContent').default;
const { SITE_URL, MAIN_EMAIL, migrateSiteIdentity } = require('../dist/services/siteIdentity');
const { donationSiteUrl } = require('../dist/services/stripeCheckout');
const { newsletterSiteUrl } = require('../dist/services/newsletterNotification');
let server, base;
const original = Model.findOne;
const stored = {contact:{email:'info@al-burhaniyainternational.co.uk',phone:'+44 1234'},branding:{footerLinks:[{label:'Donate',href:'https://al-burhaniyainternational.co.uk/donate'}]},about:{paragraph1:'Existing custom community text'}};
before(async()=>{Model.findOne=()=>({lean:async()=>({content:stored})});server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}`;});
after(async()=>{Model.findOne=original;server.closeAllConnections();await new Promise(r=>server.close(r));});
test('both HTTPS versions of the new website can call the backend, including JSON POST preflight',async()=>{
 for(const origin of [SITE_URL,'https://alburhaniyainternational.org.uk']){
  const res=await fetch(base+'/api/health',{headers:{Origin:origin}});assert.equal(res.headers.get('Access-Control-Allow-Origin'),origin);
  const preflight=await fetch(base+'/api/contact',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);assert.match(preflight.headers.get('Access-Control-Allow-Methods'),/POST/);
 }
 const bad=await fetch(base+'/api/health',{headers:{Origin:SITE_URL+'.attacker.test'}});assert.equal(bad.headers.get('Access-Control-Allow-Origin'),null);
});
test('public CMS content uses the new identity without losing saved custom content or mutating records on read',async()=>{
 const res=await fetch(base+'/api/site-content');assert.equal(res.status,200);const data=await res.json();assert.equal(data.contact.email,MAIN_EMAIL);assert.equal(data.branding.footerLinks[0].href,SITE_URL+'/donate');assert.equal(data.contact.phone,stored.contact.phone);assert.equal(data.about.paragraph1,stored.about.paragraph1);assert.equal(stored.contact.email,'info@al-burhaniyainternational.co.uk');
});
test('migration preserves third-party addresses and URLs and retains paths, query strings and email links',()=>{
 const data=migrateSiteIdentity({email:'office@partner.test',link:'https://partner.test/path',old:'https://www.al-burhaniyainternational.co.uk/newsletter/confirm#token=123',mail:'mailto:info@al-burhaniyainternational.co.uk',lookalike:'https://al-burhaniyainternational.co.uk.attacker.test/path'});
 assert.equal(data.email,'office@partner.test');assert.equal(data.link,'https://partner.test/path');assert.equal(data.old,SITE_URL+'/newsletter/confirm#token=123');assert.equal(data.mail,'mailto:'+MAIN_EMAIL);assert.equal(data.lookalike,'https://al-burhaniyainternational.co.uk.attacker.test/path');
});
test('Stripe and newsletter URLs default to the canonical new www domain',()=>{
 const vars=['DONATION_SITE_URL','NEWSLETTER_SITE_URL'];const previous=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
 try{for(const key of vars)delete process.env[key];assert.equal(donationSiteUrl(),SITE_URL);assert.equal(newsletterSiteUrl(),SITE_URL);}finally{for(const[k,v]of Object.entries(previous))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
