'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createApp,normalize,quote,certificate}=require('../server'),scope=require('../public/license-scope');
const request={assetId:'lantern-atlas',licensee:'Ridgewater Museum',project:'Tidal exhibition guide',medium:'print',copies:413,attribution:true,exclusive:false,training:false};
test('requested scope narrows a worldwide offer without widening duration or inferring geography',()=>{
 assert.deepEqual(normalize(request),request,'Legacy requests keep their original shape');
 const scoped=normalize({...request,termMonths:3,territory:'France'}),review=quote(scoped);
 assert.equal(review.eligible,true);assert.equal(review.term,'3 months');assert.equal(review.territory,'France');assert.equal(review.priceCents,6100);assert.equal(review.limits.maxTermMonths,12);
 assert.equal(quote(normalize({...request,termMonths:13,territory:'France'})).eligible,false);
 assert.deepEqual(scope.covered({termMonths:3,territory:'france'},{maxTermMonths:6,territory:'France'}),{duration:true,territory:true});
 assert.equal(scope.covered({termMonths:3,territory:'Paris'},{maxTermMonths:6,territory:'France'}).territory,false,'Named regions require explicit matching rather than geographic inference');
 assert.equal(scope.covered({termMonths:3,territory:'Worldwide'},{maxTermMonths:6,territory:'France'}).territory,false);
 for(const value of [null,true,0,121,2.5,'3 months',{},[]])assert.throws(()=>normalize({...request,termMonths:value,territory:'France'}));
 for(const value of [null,{},'', 'France\nGermany'])assert.throws(()=>normalize({...request,termMonths:3,territory:value}));
});
test('creator scope is revision-bound and exact approved scope survives later offers and restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-scope-')),dataFile=path.join(dir,'licenses.json');let app,base;
 const start=async()=>{app=createApp({dataFile,creatorCode:'scope-test',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});await new Promise(r=>app.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.address().port;};
 const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 await start();try{
  const png=fs.readFileSync(path.join(__dirname,'../public/assets/between-water-and-sky/the-tidal-archive-preview.png')).toString('base64');
  const offer={requestId:crypto.randomUUID(),title:'Tidal archive',creator:'Ridgewater Studio',description:'An original study for a limited exhibition.',priceCents:4900,permitted:['print'],maxCopies:1000,maxTermMonths:6,territory:'France',original:{name:'tidal.png',data:png},preview:{name:'preview.png',data:png},confirmed:true,creatorCode:'scope-test'};
  const added=await post('/api/creator/catalog',offer);assert.equal(added.status,200);const work=added.data.work;
  const wanted={...request,assetId:work.id,termMonths:3,territory:'France',brief:'For three months only, in France.'};
  for(const change of [{termMonths:7},{territory:'Worldwide'},{territory:'Germany'}]){const rejected=await post('/api/requests',{request:{...wanted,...change},expectedOfferRevision:1});assert.equal(rejected.status,409);}
  const saved=await post('/api/requests',{request:wanted,expectedOfferRevision:1});assert.equal(saved.status,200);const id=saved.data.license.id;
  const pending=await post('/api/requests',{request:{...wanted,project:'Later exhibition'},expectedOfferRevision:1});assert.equal(pending.status,200);
  const approved=await post('/api/licenses/'+id+'/approve',{creatorCode:'scope-test',creatorApproved:true,request:{...wanted,termMonths:6,territory:'Worldwide'}});assert.equal(approved.status,200);assert.equal(approved.data.license.quote.term,'3 months');assert.equal(approved.data.license.quote.territory,'France');const retained=approved.data.license;
  const {original,...update}=offer;const changed=await post('/api/creator/catalog/'+work.id,{...update,requestId:crypto.randomUUID(),expectedOfferRevision:1,maxTermMonths:9,territory:'Germany'});assert.equal(changed.status,200);assert.equal(changed.data.work.offerRevision,2);
  assert.equal((await post('/api/requests',{request:wanted,expectedOfferRevision:1})).status,409);
  assert.equal((await post('/api/licenses/'+pending.data.license.id+'/approve',{creatorCode:'scope-test',creatorApproved:true})).status,409);
  const oldEditor={...update,requestId:crypto.randomUUID(),expectedOfferRevision:2,description:'A revised description, with existing scope retained.'};delete oldEditor.maxTermMonths;delete oldEditor.territory;
  const compatible=await post('/api/creator/catalog/'+work.id,oldEditor);assert.equal(compatible.status,200);assert.equal(compatible.data.work.maxTermMonths,9);assert.equal(compatible.data.work.territory,'Germany');
  await new Promise(r=>app.close(r));await start();const reopened=(await(await fetch(base+'/api/licenses/'+id)).json()).license;for(const field of ['request','quote','policySnapshot','assetSnapshot','approvedAt','assetDelivery'])assert.deepEqual(reopened[field],retained[field],field+' remains immutable');assert.equal(reopened.edition.isCurrentOffer,false);
  const cert=certificate({...retained,status:'issued',captureId:'CONTROLLED_SCOPE',issuedAt:'2026-11-11T00:00:00.000Z'});assert.equal(cert.term,'3 months');assert.equal(cert.territory,'France');assert.deepEqual(cert.policy,retained.policySnapshot);
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('pre-snapshot records retain their historical terms footer and policy wording',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-legacy-scope-')),dataFile=path.join(dir,'licenses.json'),id='a'.repeat(64),record={id,request,quote:quote(normalize(request)),status:'approved'};
 fs.writeFileSync(dataFile,JSON.stringify({licenses:{[id]:record}}));
 const app=createApp({dataFile,paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 try{const response=await fetch('http://127.0.0.1:'+app.address().port+'/api/licenses/'+id+'/terms');assert.equal(response.status,200);const text=await response.text();assert.ok(text.includes('One named project, one year, worldwide, with the declared distribution volume and medium.'));assert.ok(text.includes('Legacy record: policy wording shown is the current demo policy; no approval-time wording was stored.'),'Historical exported wording must not change when current scope policy changes');}
 finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
