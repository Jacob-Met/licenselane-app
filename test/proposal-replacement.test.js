'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server');
test('buyer correction retires only the authorized pending proposal and replays after a lost response',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-replace-')),dataFile=path.join(dir,'licenses.json');
 let app=createApp({dataFile,creatorCode:'creator-only',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});
 async function start(){await new Promise(r=>app.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.address().port;}
 let base=await start();
 async function api(url,body){const r=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
 try{
  const request={assetId:'lantern-atlas',licensee:'Harbour Museum',project:'Estuary field guide',medium:'print',copies:1200,exclusive:false,training:false,attribution:true};
  const first=(await api('/api/requests',{request})).data,original=first.license;
  const correction={request:{...request,copies:800},replaces:original.id,saveKey:'a'.repeat(64),buyerAccessToken:first.buyerAccessToken};
  assert.equal((await api('/api/requests',{...correction,buyerAccessToken:undefined})).status,403);
  assert.equal((await api('/api/requests',{...correction,buyerAccessToken:'b'.repeat(64)})).status,403);
  assert.equal((await api('/api/requests',{...correction,request})).status,409);
  const saved=await api('/api/requests',correction);assert.equal(saved.status,200);
  const next=saved.data.license;assert.equal(next.status,'requested');assert.equal(next.replaces.id,original.id);assert.notEqual(saved.data.buyerAccessToken,first.buyerAccessToken);
  const prior=(await api('/api/licenses/'+original.id)).data.license;
  const terms=await (await fetch(base+'/api/licenses/'+original.id+'/terms')).text();assert.match(terms,/REPLACED/);assert.ok(terms.includes(next.id));
  assert.equal(prior.status,'superseded');assert.equal(prior.replacedBy,next.id);
  for(const key of ['request','quote','assetDelivery','assetEdition','policySnapshot'])assert.deepEqual(prior[key],original[key]);
  assert.equal((await api('/api/licenses/'+original.id+'/approve',{creatorCode:'creator-only',creatorApproved:true})).status,409);
  assert.equal((await api('/api/licenses/'+original.id+'/order',{buyerAccessToken:first.buyerAccessToken})).status,409);
  assert.equal((await api('/api/licenses/'+next.id+'/order',{buyerAccessToken:first.buyerAccessToken})).status,403);
  {const replay=(await api('/api/requests',correction)).data;assert.deepEqual(replay.license,saved.data.license);assert.ok(replay.buyerAccessToken===saved.data.buyerAccessToken);assert.equal(replay.replayed,true);}
  assert.equal((await api('/api/requests',{...correction,request:{...request,copies:700}})).status,409);
  assert.equal((await api('/api/requests',{...correction,saveKey:'c'.repeat(64)})).status,409);
  await new Promise(r=>app.close(r));app=createApp({dataFile,creatorCode:'creator-only',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});base=await start();
  {const replay=(await api('/api/requests',correction)).data;assert.deepEqual(replay.license,saved.data.license);assert.ok(replay.buyerAccessToken===saved.data.buyerAccessToken);assert.equal(replay.replayed,true);}
  const second=(await api('/api/requests',{request})).data;
  assert.equal((await api('/api/licenses/'+second.license.id+'/approve',{creatorCode:'creator-only',creatorApproved:true})).status,200);
  assert.equal((await api('/api/requests',{...correction,replaces:second.license.id,buyerAccessToken:second.buyerAccessToken,saveKey:'d'.repeat(64)})).status,409);
  const third=(await api('/api/requests',{request})).data,id=third.license.id;
  const race=await Promise.all([api('/api/licenses/'+id+'/approve',{creatorCode:'creator-only',creatorApproved:true}),api('/api/requests',{...correction,replaces:id,buyerAccessToken:third.buyerAccessToken,saveKey:'e'.repeat(64)})]);
  assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
  assert.ok(['approved','superseded'].includes((await api('/api/licenses/'+id)).data.license.status));
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
