'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const source=path.resolve(__dirname,'..');
const request={assetId:'lantern-atlas',project:'Museum autumn guide',licensee:'Harbor Museum',medium:'print',copies:1500,attribution:true,exclusive:false,training:false};
async function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ll-upgrade-'));
 const appRoot=path.join(root,'app'),dataFile=path.join(root,'persistent','licenses.json');
 fs.cpSync(source,appRoot,{recursive:true,filter:p=>!['.git','dist','docs','node_modules','.data'].includes(path.relative(source,p).split(path.sep)[0])});
 const {createApp}=require(path.join(appRoot,'server.js'));
 let server,origin,captures=0;
 const paypal={configured:true,create:async()=>({id:'UPGRADEORDER',links:[]}),capture:async()=>{captures++;},inspect:async l=>({id:l.orderId,intent:'CAPTURE',status:'COMPLETED',purchase_units:[{custom_id:l.id,amount:{currency_code:'USD',value:(l.quote.priceCents/100).toFixed(2)},payments:{captures:[{id:'UPGRADECAPTURE',status:'COMPLETED',amount:{currency_code:'USD',value:(l.quote.priceCents/100).toFixed(2)}}]}}]})};
 async function start(){server=createApp({dataFile,paypal,creatorCode:''});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;}
 async function stop(){await new Promise(r=>server.close(r));}
 await start();
 const api=async(p,b)=>{const r=await fetch(origin+p,{method:b===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:b===undefined?undefined:JSON.stringify(b)});return {status:r.status,data:await r.json()};};
 const download=async id=>{const r=await fetch(origin+'/api/licenses/'+id+'/asset');return {status:r.status,bytes:Buffer.from(await r.arrayBuffer())};};
 const approve=async()=>{const r=await api('/api/licenses',{request,creatorApproved:true});assert.equal(r.status,200);return r.data.license;};
 const issue=async id=>{assert.equal((await api('/api/licenses/'+id+'/order',{})).status,200);return api('/api/licenses/'+id+'/capture',{});};
 return {root,appRoot,dataFile,api,download,approve,issue,start,stop,get captures(){return captures;},close:async()=>{await stop();fs.rmSync(root,{recursive:true,force:true});}};
}
test('issued file and approved terms survive artwork replacement and application restart',async()=>{
 const f=await fixture();
 try{
  const l=await f.approve();assert.equal((await f.download(l.id)).status,409);
  await f.issue(l.id);const original=await f.download(l.id);assert.equal(original.status,200);
  const cert=(await f.api('/api/licenses/'+l.id+'/certificate')).data;
  const asset=path.join(f.appRoot,'public','assets','lantern-atlas.svg');
  fs.writeFileSync(asset,'<svg xmlns="http://www.w3.org/2000/svg"><title>A new catalog edition</title></svg>');
  await f.stop();await f.start();
  const after=await f.download(l.id);assert.equal(after.status,200,'paid original must remain downloadable after catalog update');
  assert.deepEqual(after.bytes,original.bytes);assert.equal(crypto.createHash('sha256').update(after.bytes).digest('hex'),l.assetDelivery.sha256);
  assert.deepEqual((await f.api('/api/licenses/'+l.id+'/certificate')).data,cert,'approved certificate and terms do not change');
  assert.equal(f.captures,1,'download and restart must not repeat capture');
  const next=await f.approve();assert.notEqual(next.assetDelivery.sha256,l.assetDelivery.sha256,'new request binds new edition');
  assert.equal((await f.download(next.id)).status,409,'new edition still requires its own verified issue');
 }finally{await f.close();}
});

test('existing fingerprint-only records migrate before the live catalog changes',async()=>{
 const f=await fixture();
 try{
  const l=await f.approve();await f.issue(l.id);const original=await f.download(l.id);
  const before=(await f.api('/api/licenses/'+l.id+'/certificate')).data;
  await f.stop();
  fs.rmSync(path.join(path.dirname(f.dataFile),'approved-assets'),{recursive:true,force:true});
  await f.start(); // Simulates opening existing v0.4.1 persistent records on the new application.
  fs.writeFileSync(path.join(f.appRoot,'public','assets','lantern-atlas.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><title>Later catalog</title></svg>');
  await f.stop();await f.start();
  const after=await f.download(l.id);assert.equal(after.status,200);assert.deepEqual(after.bytes,original.bytes);
  assert.deepEqual((await f.api('/api/licenses/'+l.id+'/certificate')).data,before);
 }finally{await f.close();}
});
test('a damaged retained original never silently falls back to a replacement file',async()=>{
 const f=await fixture();
 try{
  const l=await f.approve();await f.issue(l.id);
  fs.writeFileSync(path.join(path.dirname(f.dataFile),'approved-assets',l.assetDelivery.sha256),'damaged backup bytes');
  const result=await f.download(l.id);assert.equal(result.status,409);assert.match(result.bytes.toString(),/retained original is damaged/);
  assert.equal((await f.api('/api/licenses/'+l.id+'/certificate')).status,200,'certificate remains recoverable');
  assert.equal(f.captures,1);
 }finally{await f.close();}
});
