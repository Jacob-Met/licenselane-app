'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server');
test('the exact buyer brief survives review, correction, approval, download and restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-buyer-brief-')),dataFile=path.join(dir,'licenses.json');
 let app,base;
 async function start(){app=createApp({dataFile,creatorCode:'creator-only',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});await new Promise(r=>app.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.address().port;}
 const api=async(url,body)=>{const response=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 await start();
 try{
  const brief='  Print the Éstuary guide.\nKeep <place names> readable. Launch on 18 November.  ';
  const request={assetId:'lantern-atlas',licensee:'Estuary Study Group',project:'November cards',medium:'print',copies:320,exclusive:false,training:false,attribution:true,brief};
  assert.equal((await api('/api/review',request)).data.request.brief,brief);
  const saveKey='a'.repeat(64),saved=await api('/api/requests',{request,saveKey}),original=saved.data.license;
  assert.equal(saved.status,200);assert.equal(original.request.brief,brief);
  assert.equal((await api('/api/requests',{request,saveKey})).data.license.id,original.id);
  assert.equal((await api('/api/requests',{request:{...request,brief:'Changed only the project context'},saveKey})).status,409);
  const path='/api/licenses/'+original.id;
  await api(path+'/request-changes',{creatorCode:'creator-only',creatorConfirmed:true,reason:'Please confirm the printed credit wording in your brief.'});
  const revisedRequest={...request,brief:brief+'\nCredit: Atelier Meridian.'};
  const revised=(await api('/api/requests',{request:revisedRequest,revises:original.id})).data.license;
  assert.equal(revised.status,'requested');assert.notEqual(revised.id,original.id);
  assert.deepEqual(revised.quote,original.quote);
  const approved=await api('/api/licenses/'+revised.id+'/approve',{creatorCode:'creator-only',creatorApproved:true,request:{...revisedRequest,brief:'Injected replacement'}});
  assert.equal(approved.data.license.request.brief,revisedRequest.brief);
  assert.equal((await api(path)).data.license.request.brief,brief);
  const terms=await(await fetch(base+'/api/licenses/'+revised.id+'/terms')).text();
  assert.ok(terms.includes('BUYER PROJECT BRIEF\n'+revisedRequest.brief));
  await new Promise(r=>app.close(r));await start();
  assert.equal((await api('/api/licenses/'+revised.id)).data.license.request.brief,revisedRequest.brief);
  assert.equal((await api(path)).data.license.request.brief,brief);
  assert.equal((await api('/api/requests',{request:{...request,training:true,brief:'No training requested'}})).status,409);
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('legacy brief-free requests remain unchanged and invalid source types are refused',async()=>{
 const app=createApp({paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+app.address().port;
 const request={assetId:'lantern-atlas',licensee:'Archive Group',project:'Autumn guide',medium:'website',copies:0,exclusive:false,training:false,attribution:true};
 async function review(brief){const r=await fetch(base+'/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,...(brief===undefined?{}:{brief})})});return {status:r.status,data:await r.json()};}
 try{
  assert.deepEqual((await review()).data.request,request);
  assert.deepEqual((await review('  ')).data.request,request);
  for(const brief of [42,{},['source'],'x'.repeat(16001)])assert.equal((await review(brief)).status,400);
  const long='Long manually entered project context. '.repeat(150);assert.ok(long.length>4000);
  assert.equal((await review(long)).data.request.brief,long);
 }finally{await new Promise(r=>app.close(r));}
});
