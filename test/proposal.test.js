'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server');
test('buyer proposal survives separate creator approval without sharing the creator code',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-proposal-'));let orders=0;
 const app=createApp({dataFile:path.join(dir,'licenses.json'),creatorCode:'creator-only',paypal:{configured:true,async create(){orders++;throw Error('not expected');}},ai:{configured:false},briefExtractor:{configured:false}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
 const api=async(url,body)=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  const request={assetId:'lantern-atlas',licensee:'Museum of Estuaries',project:'Winter tidal guide',medium:'print',copies:1200,exclusive:false,training:false,attribution:true};
  const saved=await api('/api/requests',{request});assert.equal(saved.status,200);const l=saved.data.license;assert.equal(l.status,'requested');assert.equal(l.quote.priceCents,8500);assert.equal(l.orderId,null);
  const url='/api/licenses/'+l.id;
  assert.equal((await api(url+'/approve',{creatorApproved:true})).status,403);
  assert.equal((await api(url+'/order',{creatorCode:'creator-only'})).status,409);
  assert.equal((await api(url+'/certificate')).status,409);
  assert.equal((await api(url+'/asset')).status,409);
  const reopened=await api(url);assert.deepEqual(reopened.data.license.request,request);
  const approved=await api(url+'/approve',{creatorCode:'creator-only',creatorApproved:true,request:{...request,copies:1}});
  assert.equal(approved.status,200);assert.equal(approved.data.license.status,'approved');assert.deepEqual(approved.data.license.request,request);assert.equal(approved.data.license.quote.priceCents,8500);
  const buyer=await api(url);assert.equal(buyer.data.license.status,'approved');assert.equal(buyer.data.license.orderId,null);assert.equal(orders,0);assert.ok(!JSON.stringify(buyer.data).includes('creator-only'));
  assert.equal((await api('/api/requests',{request:{...request,training:true}})).status,409);
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
