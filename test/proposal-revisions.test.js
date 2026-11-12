'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server');
test('creator feedback closes the original and buyer revision requires a fresh independent approval',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-revision-')),dataFile=path.join(dir,'licenses.json');let orders=0;
 let app=createApp({dataFile,creatorCode:'creator-only',paypal:{configured:true,async create(){orders++;return {id:'SYNTHETIC-ORDER'};}},ai:{configured:false},briefExtractor:{configured:false}});
 async function start(){await new Promise(r=>app.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.address().port;}
 let base=await start();
 async function api(url,body){const r=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
 try{
  const request={assetId:'lantern-atlas',licensee:'Harbour Museum',project:'Estuary field guide',medium:'print',copies:1200,exclusive:false,training:false,attribution:true};
  const originalResponse=(await api('/api/requests',{request})).data,originalToken=originalResponse.buyerAccessToken,original=originalResponse.license,url='/api/licenses/'+original.id,reason='Please reduce the first print edition to 800 copies and name the season.';
  const decision={reason,creatorConfirmed:true};
  assert.equal((await api(url+'/request-changes',decision)).status,403);
  assert.equal((await api(url+'/request-changes',{...decision,creatorCode:'creator-only',reason:'short'})).status,400);
  assert.equal((await api(url+'/request-changes',{reason,creatorCode:'creator-only'})).status,400);
  const changed=await api(url+'/request-changes',{...decision,creatorCode:'creator-only'});
  assert.equal(changed.status,200);assert.equal(changed.data.license.status,'changes_requested');assert.deepEqual(changed.data.license.request,original.request);
  assert.deepEqual(changed.data.license.quote,original.quote);assert.deepEqual(changed.data.license.assetDelivery,original.assetDelivery);
  const repeated=await api(url+'/request-changes',{...decision,creatorCode:'creator-only'});
  assert.deepEqual(repeated.data.license,changed.data.license);
  assert.equal((await api(url+'/approve',{creatorApproved:true,creatorCode:'creator-only'})).status,409);
  assert.equal((await api(url+'/order',{creatorCode:'creator-only'})).status,409);
  assert.equal((await api(url+'/capture',{creatorCode:'creator-only'})).status,409);
  assert.equal((await api(url+'/certificate')).status,409);assert.equal(orders,0);
  assert.equal((await api('/api/requests',{request,revises:original.id})).status,409);
  const corrected={...request,project:'Autumn estuary field guide',copies:800};
  assert.equal((await api('/api/requests',{request:{...corrected,training:true},revises:original.id})).status,409);
  const revisedResponse=(await api('/api/requests',{request:corrected,revises:original.id})).data,revisedToken=revisedResponse.buyerAccessToken,revised=revisedResponse.license;
  assert.notEqual(revisedToken,originalToken);
  assert.equal((await api(url+'/order',{buyerAccessToken:originalToken})).status,409);
  assert.equal((await api('/api/licenses/'+revised.id+'/order',{buyerAccessToken:originalToken})).status,403);
  assert.equal((await api('/api/licenses/'+revised.id+'/order',{buyerAccessToken:revisedToken})).status,409);
  assert.equal((await api('/api/licenses/'+revised.id+'/approve',{buyerAccessToken:revisedToken,creatorApproved:true})).status,403);
  assert.notEqual(revised.id,original.id);assert.equal(revised.status,'requested');assert.equal(revised.orderId,null);assert.equal(revised.captureId,null);assert.equal(revised.creatorDecision,undefined);
  assert.equal(revised.revisionOf.id,original.id);assert.equal(revised.revisionOf.reason,reason);assert.equal(revised.quote.priceCents,7300);
  assert.equal((await api('/api/licenses/'+revised.id+'/order',{creatorCode:'creator-only'})).status,409);
  assert.equal((await api('/api/licenses/'+revised.id+'/approve',{creatorApproved:true})).status,403);
  const approved=await api('/api/licenses/'+revised.id+'/approve',{creatorCode:'creator-only',creatorApproved:true});
  assert.equal(approved.status,200);assert.equal(approved.data.license.status,'approved');assert.deepEqual(approved.data.license.request,corrected);
  assert.equal((await api('/api/licenses/'+revised.id+'/request-changes',{...decision,creatorCode:'creator-only'})).status,409);
  assert.deepEqual((await api(url)).data.license,changed.data.license);
  const terms=await (await fetch(base+url+'/terms')).text();assert.match(terms,/NOT ISSUED/);assert.ok(terms.includes(reason));
  await new Promise(r=>app.close(r));app=createApp({dataFile,creatorCode:'creator-only',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});base=await start();
  assert.deepEqual((await api(url)).data.license,changed.data.license);assert.equal((await api('/api/licenses/'+revised.id)).data.license.revisionOf.reason,reason);
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
