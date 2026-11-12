'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createApp}=require('../server');
const origin='https://original.example';
async function fixture(t,custom=false){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-recovery-')),dataFile=path.join(dir,'licenses.json');
 let app=createApp({dataFile,creatorCode:'test-code',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+app.address().port;
 let assetId='lantern-atlas';
 if(custom){
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=';
  const r=await fetch(base+'/api/creator/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({creatorCode:'test-code',requestId:crypto.randomUUID(),title:'Retained shore',creator:'Recovery artist',description:'Original shoreline image for recovery.',priceCents:4900,permitted:['print'],maxCopies:2000,original:{name:'shore.png',data:png},preview:{name:'preview.png',data:png},confirmed:true})});
  assert.equal(r.status,200);assetId=(await r.json()).work.id;
 }
 const response=await fetch(base+'/api/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request:{assetId,licensee:'Recovery test museum',project:'Recovery test guide',medium:'print',copies:720,attribution:true}})});
 const created=await response.json();assert.equal(response.status,200);
 await new Promise(r=>app.close(r));
 const data=JSON.parse(fs.readFileSync(dataFile));const license=data.licenses[created.license.id];
 Object.assign(license,{status:'issued',orderId:'FIXTURE-ORDER',captureId:'FIXTURE-CAPTURE',issuedAt:'2026-01-01T00:00:00Z'});fs.writeFileSync(dataFile,JSON.stringify(data));
 let providerCalls=0;const forbidden=()=>{providerCalls++;throw Error('provider must remain disconnected');};
 app=createApp({dataFile,creatorCode:'test-code',recoveryOnly:true,recoveryOrigin:origin,primaryUrl:'https://original.example:40043',paypal:{configured:true,create:forbidden,capture:forbidden,inspect:forbidden},ai:{configured:true,review:forbidden},briefExtractor:{configured:true,extract:forbidden}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.address().port;
 t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const api=(url,body,method)=>fetch(base+url,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 return {dir,dataFile,license,token:created.buyerAccessToken,api,calls:()=>providerCalls};
}
function inventory(dir){return Object.fromEntries(fs.readdirSync(dir,{recursive:true}).filter(n=>fs.statSync(path.join(dir,n)).isFile()).map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,n))).digest('hex')]));}
test('recovery opens paid files and valid buyer access but refuses all mutation and provider paths',async t=>{
 const f=await fixture(t),before=inventory(f.dir),id=f.license.id;
 const config=await(await f.api('/api/config')).json();
 assert.equal(config.recoveryOnly,true);assert.equal(config.recoveryOrigin,origin);assert.equal(config.primaryUrl,'https://original.example:40043');
 for(const key of ['paypalConfigured','aiConfigured','briefConfigured'])assert.equal(config[key],false);
 assert.match(f.token,/^[a-f0-9]{64}$/);
 assert.equal((await f.api('/api/licenses/'+id+'/buyer-access',{buyerAccessToken:f.token})).status,200);
 assert.equal((await f.api('/api/licenses/'+id+'/buyer-access',{buyerAccessToken:'0'.repeat(64)})).status,403);
 for(const url of ['/api/requests','/api/requests/recover','/api/licenses','/api/licenses/recover','/api/review','/api/brief','/api/creator/inbox','/api/creator/catalog',...['approve','request-changes','order','capture','reconcile','recover-order'].map(a=>'/api/licenses/'+id+'/'+a)]){
  assert.equal((await f.api(url,{creatorCode:'test-code',buyerAccessToken:f.token,useAI:true})).status,423,url);
 }
 assert.equal((await f.api('/api/licenses/'+id,{},'PUT')).status,423);
 const file=await f.api('/api/licenses/'+id+'/asset'),bytes=Buffer.from(await file.arrayBuffer());assert.equal(file.status,200);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),f.license.assetDelivery.sha256);
 const terms=await(await f.api('/api/licenses/'+id+'/terms')).text();assert(terms.includes('720'));assert(terms.includes('73.00'));
 assert.equal((await f.api('/api/licenses/'+id+'/preview')).status,200);
 assert.equal(f.calls(),0);assert.deepEqual(inventory(f.dir),before);
});
test('recovery requires one exact original origin',()=>{
 for(const recoveryOrigin of [undefined,'https://example.test/path','https://user:pass@example.test','file:///tmp/test']){
  assert.throws(()=>createApp({recoveryOnly:true,recoveryOrigin}),/origin/);
 }
});

test('current primary address is explicit recovery navigation, not another identity',()=>{
 for(const primaryUrl of ['https://user:pass@desk.test','https://desk.test/path','https://desk.test?token=1','file:///tmp/app'])assert.throws(()=>createApp({recoveryOnly:true,recoveryOrigin:origin,primaryUrl}),/primary address/);
 assert.throws(()=>createApp({primaryUrl:'https://desk.test'}),/recovery mode/);
});

test('configured recovery address is an exact HTTPS origin and does not enable recovery mode',async t=>{
 for(const recoveryUrl of ['http://copy.test','https://user:pass@copy.test','https://copy.test/path','https://copy.test?token=private','javascript:alert(1)'])assert.throws(()=>createApp({recoveryUrl}),/exact HTTPS origin/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-recovery-address-'));
 const app=createApp({dataFile:path.join(dir,'licenses.json'),recoveryUrl:'https://copy.test',creatorCode:'test-only',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const config=await(await fetch('http://127.0.0.1:'+app.address().port+'/api/config')).json();assert.equal(config.recoveryUrl,'https://copy.test');assert.equal(config.recoveryOnly,undefined);assert.equal(config.paypalConfigured,false);
});

test('saved paid artwork opens when its mutable catalog original is unavailable',async t=>{
 const f=await fixture(t,true),id=f.license.id;
 fs.unlinkSync(path.join(f.dir,'creator-catalog',f.license.assetDelivery.sha256));
 const before=inventory(f.dir);
 const response=await f.api('/api/licenses/'+id);assert.equal(response.status,200,await response.clone().text());
 const saved=(await response.json()).license;
 assert.equal(saved.status,'issued');assert.equal(saved.edition.isCurrent,null);
 const asset=await f.api('/api/licenses/'+id+'/asset');assert.equal(asset.status,200);
 assert.equal(crypto.createHash('sha256').update(Buffer.from(await asset.arrayBuffer())).digest('hex'),f.license.assetDelivery.sha256);
 assert.equal((await f.api('/api/licenses/'+id+'/terms')).status,200);
 assert.equal((await f.api('/api/licenses/'+id+'/preview')).status,200);
 assert.deepEqual(inventory(f.dir),before);assert.equal(f.calls(),0);
});
test('recovery preview fallback serves exact matching bytes without writing restored data',async t=>{
 const f=await fixture(t),id=f.license.id;
 fs.unlinkSync(path.join(f.dir,'approved-assets',f.license.assetEdition.preview.sha256));
 const before=inventory(f.dir),response=await f.api('/api/licenses/'+id+'/preview');
 assert.equal(response.status,200);
 assert.equal(crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),f.license.assetEdition.preview.sha256);
 assert.deepEqual(inventory(f.dir),before);assert.equal(f.calls(),0);
});

test('stable installation origin identifies the same primary without enabling restoration or recovery',async t=>{
 for(const installationOrigin of ['file:///tmp/app','https://user:pass@desk.test','https://desk.test/path','https://desk.test?other=1'])assert.throws(()=>createApp({installationOrigin}),/origin/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-installation-origin-'));
 const app=createApp({dataFile:path.join(dir,'licenses.json'),installationOrigin:'https://desk.test',creatorCode:'test-only',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const config=await(await fetch('http://127.0.0.1:'+app.address().port+'/api/config')).json();
 assert.equal(config.installationOrigin,'https://desk.test');assert.equal(config.restoredOrigin,undefined);assert.equal(config.recoveryOnly,undefined);assert.equal(config.paypalConfigured,false);
});
