'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server');
test('buyer withdrawal preserves terms, is private and idempotent, and races safely with creator approval and replacement',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-replace-')),dataFile=path.join(dir,'licenses.json');
 let app=createApp({dataFile,creatorCode:'creator-only',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});
 async function start(){await new Promise(r=>app.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.address().port;}
 let base=await start();
 async function api(url,body){const r=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
 try{
  const request={assetId:'lantern-atlas',licensee:'Harbour Museum',project:'Canceled field guide',medium:'print',copies:320,exclusive:false,training:false,attribution:true};
  const first=(await api('/api/requests',{request})).data,original=first.license,url='/api/licenses/'+original.id;
  const body={buyerAccessToken:first.buyerAccessToken,buyerWithdrawn:true};
  assert.equal((await api(url+'/withdraw',{buyerWithdrawn:true,creatorCode:'creator-only'})).status,403);
  assert.equal((await api(url+'/withdraw',{...body,buyerWithdrawn:false})).status,400);
  const saved=await api(url+'/withdraw',body);assert.equal(saved.status,200);assert.equal(saved.data.license.status,'withdrawn');
  for(const key of ['request','quote','assetDelivery','assetEdition','policySnapshot'])assert.deepEqual(saved.data.license[key],original[key]);
  assert.deepEqual((await api(url+'/withdraw',body)).data,saved.data);
  assert.equal((await api(url+'/approve',{creatorCode:'creator-only',creatorApproved:true})).status,409);
  assert.equal((await api(url+'/request-changes',{creatorCode:'creator-only',creatorConfirmed:true,reason:'Please change the requested print scope.'})).status,409);
  assert.equal((await api(url+'/order',{buyerAccessToken:first.buyerAccessToken})).status,409);
  assert.equal((await api('/api/requests',{request:{...request,copies:800},replaces:original.id,saveKey:'a'.repeat(64),buyerAccessToken:first.buyerAccessToken})).status,409);
  const terms=await(await fetch(base+url+'/terms')).text();assert.match(terms,/WITHDRAWN BY BUYER/);
  await new Promise(r=>app.close(r));app=createApp({dataFile,creatorCode:'creator-only',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});base=await start();
  assert.deepEqual((await api(url+'/withdraw',body)).data,saved.data);
  const second=(await api('/api/requests',{request})).data,id=second.license.id;
  const race=await Promise.all([api('/api/licenses/'+id+'/approve',{creatorCode:'creator-only',creatorApproved:true}),api('/api/licenses/'+id+'/withdraw',{buyerWithdrawn:true,buyerAccessToken:second.buyerAccessToken})]);
  assert.deepEqual(race.map(x=>x.status).sort(),[200,409]);
  const third=(await api('/api/requests',{request})).data,thirdId=third.license.id;
  const changeRace=await Promise.all([api('/api/requests',{request:{...request,copies:800},replaces:thirdId,saveKey:'c'.repeat(64),buyerAccessToken:third.buyerAccessToken}),api('/api/licenses/'+thirdId+'/withdraw',{buyerWithdrawn:true,buyerAccessToken:third.buyerAccessToken})]);
  assert.deepEqual(changeRace.map(x=>x.status).sort(),[200,409]);
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
