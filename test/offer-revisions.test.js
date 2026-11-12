'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {createApp}=require('../server');
const code='revision-test-creator';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=';
// A distinct valid one-pixel PNG makes preview retention observable without third-party assets.
function alternatePng(){
 const chunk=(type,data)=>{const name=Buffer.from(type),value=Buffer.concat([name,data]);let crc=0xffffffff;for(const byte of value){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([len,value,sum]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.from([0,220,70,40,255]))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
const alternate=alternatePng();
function offer(changes={}){return {requestId:crypto.randomUUID(),title:'Tidal study',creator:'Example artist',description:'Original abstract tidal shoreline image.',priceCents:4250,permitted:['website','print'],maxCopies:750,original:{name:'Tidal.png',data:png},preview:{name:'Preview.png',data:png},confirmed:true,creatorCode:code,...changes};}
function correction(work,changes={}){return {requestId:crypto.randomUUID(),expectedOfferRevision:work.offerRevision,title:work.title,creator:work.creator,description:work.description,priceCents:work.priceCents,permitted:work.permitted,maxCopies:work.maxCopies,confirmed:true,creatorCode:code,...changes};}
function request(work){return {assetId:work.id,licensee:'Moss museum',project:'Tidal exhibition guide',medium:'website',copies:0,attribution:true};}
async function fixture(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-offer-revisions-')),dataFile=path.join(dir,'licenses.json');let app,base;
 const start=async()=>{app=createApp({dataFile,creatorCode:code,paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false},...options});await new Promise(r=>app.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.address().port;};
 await start();t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const api=async(url,body)=>{const response=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 return {api,dataFile,dir,raw:url=>fetch(base+url),restart:async()=>{await new Promise(r=>app.close(r));await start();}};
}
async function create(api){const result=await api('/api/creator/catalog',offer());assert.equal(result.status,200);return result.body.work;}
async function update(api,work,changes){return api('/api/creator/catalog/'+work.id,correction(work,changes));}
test('a correction keeps one work and the original while saved prices, terms and previews survive restart',async t=>{
 const f=await fixture(t),work=await create(f.api),req=request(work);
 const proposal=(await f.api('/api/requests',{request:req,expectedOfferRevision:1})).body.license;
 const approved=(await f.api('/api/licenses',{request:req,expectedOfferRevision:1,creatorApproved:true,creatorCode:code})).body.license;
 const termsBefore=await(await f.raw('/api/licenses/'+approved.id+'/terms')).text();
 const change=await update(f.api,work,{title:'Tidal study corrected',priceCents:5750,maxCopies:1200,preview:{name:'New-preview.png',data:alternate}});
 assert.equal(change.status,200);const revised=change.body.work;assert.equal(revised.id,work.id);assert.equal(revised.offerRevision,2);assert.notEqual(revised.preview,work.preview);
 const catalog=(await f.api('/api/catalog')).body.works.filter(w=>w.custom);assert.equal(catalog.length,1);assert.equal(catalog[0].priceCents,5750);
 for(const privateKey of ['original','previewFile','offerUpdates','previewHistory','requestDigest'])assert.equal(revised[privateKey],undefined);
 assert.deepEqual(Buffer.from(await(await f.raw(work.preview)).arrayBuffer()),Buffer.from(png,'base64'));
 assert.deepEqual(Buffer.from(await(await f.raw(revised.preview)).arrayBuffer()),Buffer.from(alternate,'base64'));
 const stored=(await f.api('/api/licenses/'+approved.id)).body.license;
 assert.equal(stored.quote.priceCents,4250);assert.equal(stored.quote.assetTitle,'Tidal study');assert.equal(stored.assetEdition.offerRevision,1);
 assert.equal(stored.edition.isCurrent,true);assert.equal(stored.edition.isCurrentOffer,false);assert.equal(stored.edition.currentOfferRevision,2);
 assert.equal(stored.assetDelivery.sha256,crypto.createHash('sha256').update(Buffer.from(png,'base64')).digest('hex'));
 assert.deepEqual(Buffer.from(await(await f.raw(stored.edition.previewUrl)).arrayBuffer()),Buffer.from(png,'base64'));
 assert.equal(await(await f.raw('/api/licenses/'+approved.id+'/terms')).text(),termsBefore);
 assert.equal((await f.api('/api/licenses/'+proposal.id+'/approve',{creatorCode:code,creatorApproved:true})).status,409);
 const alreadyApproved=await f.api('/api/licenses/'+approved.id+'/approve',{creatorCode:code,creatorApproved:true});assert.equal(alreadyApproved.status,200);assert.equal(alreadyApproved.body.license.quote.priceCents,4250);
 await f.restart();
 assert.equal((await f.api('/api/catalog')).body.works.find(w=>w.id===work.id).offerRevision,2);
 assert.deepEqual(Buffer.from(await(await f.raw(work.preview)).arrayBuffer()),Buffer.from(png,'base64'));
 assert.equal((await f.api('/api/licenses/'+approved.id)).body.license.quote.priceCents,4250);
 const review=await f.api('/api/review',req);assert.equal(review.body.quote.priceCents,5750);assert.equal(review.body.quote.offerRevision,2);assert.equal(review.body.work.preview,revised.preview);
});
test('stale or absent buyer revision cannot silently save or approve a changed offer',async t=>{
 const {api,dataFile}=await fixture(t),work=await create(api),req=request(work);
 const review=await api('/api/review',req);assert.equal(review.body.quote.offerRevision,1);
 await update(api,work,{priceCents:5500});
 for(const route of ['/api/requests','/api/licenses']){
  for(const expectedOfferRevision of [undefined,1,'2',null]){
   const result=await api(route,{request:req,expectedOfferRevision,creatorCode:code,creatorApproved:true});
   assert.equal(result.status,409);assert.equal(result.body.code,'OFFER_CHANGED');assert.equal(result.body.work.offerRevision,2);assert.equal(result.body.work.priceCents,5500);assert.equal(result.body.work.original,undefined);
  }
 }
 assert.equal(fs.existsSync(dataFile)?Object.keys(JSON.parse(fs.readFileSync(dataFile)).licenses).length:0,0);
 const fresh=await api('/api/review',req),saved=await api('/api/requests',{request:req,expectedOfferRevision:fresh.body.quote.offerRevision});
 assert.equal(saved.status,200);assert.equal(saved.body.license.quote.priceCents,5500);assert.equal(saved.body.license.assetEdition.offerRevision,2);
});
test('creator corrections require authority, preserve edits on conflict and retry the original result exactly once',async t=>{
 const {api}=await fixture(t),work=await create(api);
 assert.equal((await update(api,work,{creatorCode:'wrong',priceCents:4500})).status,403);
 assert.equal((await update(api,work,{original:{name:'Changed.png',data:alternate}})).status,400);
 assert.equal((await update(api,work,{expectedOfferRevision:undefined})).status,409);
 const unchanged=correction(work),noop=await api('/api/creator/catalog/'+work.id,unchanged);assert.equal(noop.status,200);assert.equal(noop.body.work.offerRevision,1);
 const change=correction(work,{priceCents:4500,preview:{name:'Updated.png',data:alternate}});
 const first=await api('/api/creator/catalog/'+work.id,change);assert.equal(first.status,200);assert.equal(first.body.work.offerRevision,2);
 const second=await update(api,first.body.work,{priceCents:4700});assert.equal(second.body.work.offerRevision,3);
 const replay=await api('/api/creator/catalog/'+work.id,change);assert.equal(replay.status,200);assert.deepEqual(replay.body.work,first.body.work);
 const noopReplay=await api('/api/creator/catalog/'+work.id,unchanged);assert.equal(noopReplay.body.work.offerRevision,1);
 assert.equal((await api('/api/creator/catalog/'+work.id,{...change,priceCents:4900})).status,409);
 assert.equal((await update(api,work,{priceCents:4900})).status,409);
 assert.equal((await api('/api/catalog')).body.works.find(w=>w.id===work.id).offerRevision,3);
 assert.equal((await api('/api/creator/catalog',offer({requestId:change.requestId}))).status,409);
});
test('concurrent windows cannot overwrite one another or create a duplicate work',async t=>{
 const {api}=await fixture(t),work=await create(api);
 const responses=await Promise.all([update(api,work,{priceCents:4800}),update(api,work,{priceCents:4900})]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const works=(await api('/api/catalog')).body.works.filter(w=>w.custom);assert.equal(works.length,1);assert.equal(works[0].offerRevision,2);assert.equal(works[0].priceCents,responses.find(r=>r.status===200).body.work.priceCents);
});
test('legacy first-offer proposals remain approvable without inventing a saved revision',async t=>{
 const f=await fixture(t),work=await create(f.api),saved=(await f.api('/api/requests',{request:request(work)})).body.license;
 const data=JSON.parse(fs.readFileSync(f.dataFile));delete data.licenses[saved.id].quote.offerRevision;delete data.licenses[saved.id].assetEdition.offerRevision;fs.writeFileSync(f.dataFile,JSON.stringify(data));
 const index=path.join(f.dir,'creator-catalog','catalog.json'),catalog=JSON.parse(fs.readFileSync(index));delete catalog.works[0].offerRevision;fs.writeFileSync(index,JSON.stringify(catalog));
 await f.restart();
 const legacy=(await f.api('/api/licenses/'+saved.id)).body.license;assert.equal(legacy.edition.isCurrentOffer,null);assert.equal(legacy.edition.currentOfferRevision,1);
 const result=await f.api('/api/licenses/'+saved.id+'/approve',{creatorCode:code,creatorApproved:true});assert.equal(result.status,200);assert.equal(result.body.license.status,'approved');assert.equal(result.body.license.assetEdition.offerRevision,undefined);
});
test('an offer changed while an optional explanation runs must be reviewed again',async t=>{
 let begin,finish;const started=new Promise(r=>begin=r),waiting=new Promise(r=>finish=r);
 const f=await fixture(t,{ai:{configured:true,review:async()=>{begin();await waiting;return 'Synthetic delayed explanation for concurrency testing.';}}});
 t.after(()=>finish());const work=await create(f.api),pending=f.api('/api/review',{...request(work),useAI:true});
 await started;await update(f.api,work,{priceCents:6200});finish();
 const result=await pending;assert.equal(result.status,409);assert.equal(result.body.code,'OFFER_CHANGED');assert.equal(result.body.work.priceCents,6200);
});

test('paused offers reject new requests while approved checkout and retained agreement survive edit and reopen',async t=>{
 const orders=[];const f=await fixture(t,{paypal:{configured:true,create:async license=>{orders.push({price:license.quote.priceCents,revision:license.assetEdition.offerRevision});return {id:'TESTPAUSEORDER01',links:[{rel:'approve',href:'https://www.sandbox.paypal.com/checkoutnow?token=TESTPAUSEORDER01'}]};}}});
 const work=await create(f.api),req=request(work);
 const pending=(await f.api('/api/requests',{request:req,expectedOfferRevision:1})).body.license;
 const approved=(await f.api('/api/licenses',{request:req,expectedOfferRevision:1,creatorApproved:true,creatorCode:code})).body.license;
 const beforeTerms=await(await f.raw('/api/licenses/'+approved.id+'/terms')).text();
 const set=(w,status)=>f.api('/api/creator/catalog/'+w.id+'/status',{requestId:crypto.randomUUID(),expectedOfferRevision:w.offerRevision,status,confirmed:true,creatorCode:code});
 const paused=await set(work,'paused');assert.equal(paused.status,200);assert.equal(paused.body.work.offerRevision,2);assert.equal(paused.body.work.offerStatus,'paused');
 assert.equal((await f.api('/api/catalog')).body.works.some(w=>w.id===work.id),false);
 assert.equal((await f.api('/api/creator/catalog')).body.works.find(w=>w.id===work.id).offerStatus,'paused');
 for(const [url,body]of [
  ['/api/review',req],
  ['/api/requests',{request:req,expectedOfferRevision:1}],
  ['/api/licenses',{request:req,expectedOfferRevision:2,creatorApproved:true,creatorCode:code}],
  ['/api/licenses/'+pending.id+'/approve',{creatorApproved:true,creatorCode:code}]
 ]){
  const result=await f.api(url,body);assert.equal(result.status,409);assert.equal(result.body.code,'OFFER_PAUSED');assert.equal(result.body.work.id,work.id);
 }
 assert.equal(Object.keys(JSON.parse(fs.readFileSync(f.dataFile)).licenses).length,2);
 assert.equal((await f.api('/api/licenses/'+approved.id+'/approve',{creatorApproved:true,creatorCode:code})).status,200);
 assert.equal(await(await f.raw('/api/licenses/'+approved.id+'/terms')).text(),beforeTerms);
 assert.deepEqual(Buffer.from(await(await f.raw(approved.edition.previewUrl)).arrayBuffer()),Buffer.from(png,'base64'));
 const edited=await update(f.api,paused.body.work,{priceCents:5500});assert.equal(edited.body.work.offerStatus,'paused');assert.equal(edited.body.work.offerRevision,3);
 await f.restart();
 assert.equal((await f.api('/api/catalog')).body.works.some(w=>w.id===work.id),false);
 const checkout=await f.api('/api/licenses/'+approved.id+'/order',{creatorCode:code});
 assert.equal(checkout.status,200);assert.equal(checkout.body.license.status,'awaiting_payment');assert.deepEqual(orders,[{price:4250,revision:1}]);
 const reopened=await set(edited.body.work,'active');assert.equal(reopened.body.work.offerRevision,4);assert.equal((await f.api('/api/catalog')).body.works.find(w=>w.id===work.id).offerStatus,'active');
 const stale=await f.api('/api/requests',{request:req,expectedOfferRevision:1});assert.equal(stale.status,409);assert.equal(stale.body.code,'OFFER_CHANGED');
 const fresh=await f.api('/api/review',req);assert.equal(fresh.body.quote.priceCents,5500);assert.equal(fresh.body.quote.offerRevision,4);
 const saved=await f.api('/api/requests',{request:req,expectedOfferRevision:4});assert.equal(saved.status,200);assert.equal(saved.body.license.quote.priceCents,5500);
 assert.equal((await f.api('/api/licenses/'+approved.id)).body.license.quote.priceCents,4250);
});
test('availability authorization, no-op and exact retry prevent stale windows from reopening an offer',async t=>{
 const {api}=await fixture(t),work=await create(api),url='/api/creator/catalog/'+work.id+'/status';
 const body={requestId:crypto.randomUUID(),expectedOfferRevision:1,status:'paused',confirmed:true,creatorCode:code};
 assert.equal((await api(url,{...body,creatorCode:'wrong'})).status,403);
 assert.equal((await api(url,{...body,confirmed:false})).status,400);
 assert.equal((await api(url,{...body,status:'deleted'})).status,400);
 const noop=await api(url,{...body,requestId:crypto.randomUUID(),status:'active'});assert.equal(noop.body.work.offerRevision,1);
 const paused=await api(url,body);assert.equal(paused.body.work.offerRevision,2);
 assert.equal((await api(url,{...body,requestId:crypto.randomUUID(),status:'active'})).status,409);
 const reopened=await api(url,{...body,requestId:crypto.randomUUID(),expectedOfferRevision:2,status:'active'});assert.equal(reopened.body.work.offerRevision,3);
 const replay=await api(url,body);assert.deepEqual(replay.body.work,paused.body.work);
 assert.equal((await api('/api/creator/catalog')).body.works.find(w=>w.id===work.id).offerStatus,'active');
 assert.equal((await api(url,{...body,status:'active'})).status,409);
});
test('concurrent availability and price changes have one winner and preserve that published result',async t=>{
 const {api}=await fixture(t),work=await create(api);
 const results=await Promise.all([
  update(api,work,{priceCents:5900}),
  api('/api/creator/catalog/'+work.id+'/status',{requestId:crypto.randomUUID(),expectedOfferRevision:1,status:'paused',confirmed:true,creatorCode:code})
 ]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 const current=(await api('/api/creator/catalog')).body.works.find(w=>w.id===work.id),winner=results.find(r=>r.status===200).body.work;
 assert.equal(current.offerRevision,2);assert.equal(current.priceCents,winner.priceCents);assert.equal(current.offerStatus,winner.offerStatus);
});
test('pausing during an optional explanation returns unavailable rather than an obsolete review',async t=>{
 let begin,finish;const started=new Promise(r=>begin=r),waiting=new Promise(r=>finish=r);
 const f=await fixture(t,{ai:{configured:true,review:async()=>{begin();await waiting;return 'Synthetic delayed explanation.';}}});t.after(()=>finish());
 const work=await create(f.api),pending=f.api('/api/review',{...request(work),useAI:true});await started;
 await f.api('/api/creator/catalog/'+work.id+'/status',{requestId:crypto.randomUUID(),expectedOfferRevision:1,status:'paused',confirmed:true,creatorCode:code});finish();
 const result=await pending;assert.equal(result.status,409);assert.equal(result.body.code,'OFFER_PAUSED');assert.equal(result.body.work.offerStatus,'paused');
});

test('an explicit work link retains paused identity without making it available for new requests',async t=>{
 const {api}=await fixture(t),work=await create(api);
 assert.equal((await api('/api/catalog/'+work.id)).body.work.id,work.id);
 await api('/api/creator/catalog/'+work.id+'/status',{requestId:crypto.randomUUID(),expectedOfferRevision:1,status:'paused',confirmed:true,creatorCode:code});
 const direct=await api('/api/catalog/'+work.id);assert.equal(direct.status,200);assert.equal(direct.body.work.id,work.id);assert.equal(direct.body.work.offerStatus,'paused');assert.equal(direct.body.work.offerRevision,2);
 for(const key of ['original','previewFile','offerUpdates','previewHistory','requestDigest'])assert.equal(direct.body.work[key],undefined);
 assert.equal((await api('/api/catalog')).body.works.some(w=>w.id===work.id),false);
 const denied=await api('/api/review',request(work));assert.equal(denied.status,409);assert.equal(denied.body.code,'OFFER_PAUSED');
 const missing=await api('/api/catalog/creator-not-a-work');assert.equal(missing.status,404);assert.equal(missing.body.work,undefined);
 assert.equal((await api('/api/catalog/lantern-atlas')).body.work.id,'lantern-atlas');
});

test('an interrupted proposal recovers its original agreement and private access after approval, changed offer and restart',async t=>{
 const f=await fixture(t),work=await create(f.api),saveKey=crypto.randomBytes(32).toString('hex'),body={request:request(work),expectedOfferRevision:1,saveKey};
 const first=await f.api('/api/requests',body);assert.equal(first.status,200);const original=first.body.license;
 assert.equal(original.saveAttempt,undefined);assert.equal(original.buyerTokenHash,undefined);
 assert.equal((await f.api('/api/licenses/'+original.id+'/approve',{creatorCode:code,creatorApproved:true})).status,200);
 const revised=(await update(f.api,work,{priceCents:5700})).body.work;
 await f.api('/api/creator/catalog/'+work.id+'/status',{requestId:crypto.randomUUID(),expectedOfferRevision:revised.offerRevision,status:'paused',confirmed:true,creatorCode:code});
 await f.restart();
 const recovered=await f.api('/api/requests',body);assert.equal(recovered.status,200);assert.equal(recovered.body.replayed,true);assert.equal(recovered.body.license.id,original.id);assert.equal(recovered.body.license.status,'approved');assert.equal(recovered.body.license.quote.priceCents,4250);
 assert.ok(recovered.body.buyerAccessToken===first.body.buyerAccessToken,'private access must be identical after recovery');
 const access=await f.api('/api/licenses/'+original.id+'/buyer-access',{buyerAccessToken:recovered.body.buyerAccessToken});assert.equal(access.status,200);
 assert.equal(recovered.body.license.saveAttempt,undefined);assert.equal(access.body.license.saveAttempt,undefined);
 const disk=fs.readFileSync(f.dataFile,'utf8');assert.ok(!disk.includes(saveKey),'save key must not be persisted');assert.ok(!disk.includes(first.body.buyerAccessToken),'private buyer capability must not be persisted');
 assert.equal(Object.keys(JSON.parse(disk).licenses).length,1);
 const fresh=await f.api('/api/requests',{...body,saveKey:crypto.randomBytes(32).toString('hex')});assert.equal(fresh.status,409);assert.equal(fresh.body.code,'OFFER_PAUSED');
});
test('concurrent retries create one proposal and return the same private access',async t=>{
 const {api,dataFile}=await fixture(t),work=await create(api),body={request:request(work),expectedOfferRevision:1,saveKey:crypto.randomBytes(32).toString('hex')};
 const responses=await Promise.all([api('/api/requests',body),api('/api/requests',body)]);
 assert.ok(responses.every(r=>r.status===200));assert.equal(responses[0].body.license.id,responses[1].body.license.id);
 assert.ok(responses[0].body.buyerAccessToken===responses[1].body.buyerAccessToken,'concurrent replies must restore one private capability');
 assert.equal(responses.filter(r=>r.body.replayed).length,1);assert.equal(Object.keys(JSON.parse(fs.readFileSync(dataFile)).licenses).length,1);
 const shared=await api('/api/licenses/'+responses[0].body.license.id);assert.equal(shared.body.buyerAccessToken,undefined);assert.equal(shared.body.license.saveAttempt,undefined);
});
test('a save key cannot be reused for changed terms, a different revision or another creation kind',async t=>{
 const {api,dataFile}=await fixture(t),work=await create(api),body={request:request(work),expectedOfferRevision:1,saveKey:crypto.randomBytes(32).toString('hex')};
 assert.equal((await api('/api/requests',body)).status,200);
 for(const changed of [
  {...body,request:{...body.request,project:'A different publication'}},
  {...body,expectedOfferRevision:2},
  {...body,revises:'f'.repeat(64)}
 ])assert.equal((await api('/api/requests',changed)).status,409);
 assert.equal((await api('/api/licenses',{...body,creatorCode:code,creatorApproved:true})).status,409);
 for(const saveKey of [null,'short','X'.repeat(64)])assert.equal((await api('/api/requests',{...body,saveKey})).status,400);
 assert.equal(Object.keys(JSON.parse(fs.readFileSync(dataFile)).licenses).length,1);
});
test('recovering a direct approval still requires creator authority and never replaces its saved terms',async t=>{
 const f=await fixture(t),work=await create(f.api),body={request:request(work),expectedOfferRevision:1,saveKey:crypto.randomBytes(32).toString('hex'),creatorCode:code,creatorApproved:true};
 const first=await f.api('/api/licenses',body);assert.equal(first.status,200);assert.equal(first.body.buyerAccessToken,undefined);
 await update(f.api,work,{priceCents:6300});await f.restart();
 assert.equal((await f.api('/api/licenses',{...body,creatorCode:'wrong'})).status,403);
 assert.equal((await f.api('/api/licenses',{...body,creatorApproved:false})).status,400);
 const recovered=await f.api('/api/licenses',body);assert.equal(recovered.status,200);assert.equal(recovered.body.license.id,first.body.license.id);assert.equal(recovered.body.license.quote.priceCents,4250);assert.equal(recovered.body.license.status,'approved');assert.equal(recovered.body.buyerAccessToken,undefined);assert.equal(recovered.body.license.saveAttempt,undefined);
 assert.equal(Object.keys(JSON.parse(fs.readFileSync(f.dataFile)).licenses).length,1);
});


test('lookup-only recovery survives restart and changed offers without creating proposals or exposing creator saves',async t=>{
 const f=await fixture(t),work=await create(f.api),saveKey=crypto.randomBytes(32).toString('hex');
 const first=await f.api('/api/requests',{request:request(work),expectedOfferRevision:1,saveKey});assert.equal(first.status,200);
 const approved=await f.api('/api/licenses/'+first.body.license.id+'/approve',{creatorCode:code,creatorApproved:true});assert.equal(approved.status,200);
 await update(f.api,work,{priceCents:6700});await f.restart();
 const before=fs.readFileSync(f.dataFile,'utf8');
 const recovered=await f.api('/api/requests/recover',{saveKey});assert.equal(recovered.status,200);
 assert.equal(recovered.body.license.id,first.body.license.id);assert.equal(recovered.body.license.status,'approved');assert.equal(recovered.body.license.quote.priceCents,4250);
 assert.equal(recovered.body.buyerAccessToken,first.body.buyerAccessToken);assert.equal(recovered.body.license.saveAttempt,undefined);assert.equal(recovered.body.license.buyerTokenHash,undefined);
 for(const invalid of [null,'short','f'.repeat(64)]){const result=await f.api('/api/requests/recover',{saveKey:invalid});assert.equal(result.status,invalid?.length===64?404:400);assert.equal(result.body.buyerAccessToken,undefined);}
 assert.equal(fs.readFileSync(f.dataFile,'utf8'),before,'Recovery and misses must not mutate stored agreements');
 const creatorKey=crypto.randomBytes(32).toString('hex');const direct=await f.api('/api/licenses',{request:{...request(work),project:'Creator direct agreement'},expectedOfferRevision:2,saveKey:creatorKey,creatorCode:code,creatorApproved:true});assert.equal(direct.status,200);
 assert.equal((await f.api('/api/requests/recover',{saveKey:creatorKey})).status,404);
});

test('creator lookup after restart requires authority and never changes the approved agreement',async t=>{
 const f=await fixture(t),work=await create(f.api),saveKey=crypto.randomBytes(32).toString('hex');
 const first=await f.api('/api/licenses',{request:request(work),expectedOfferRevision:1,saveKey,creatorCode:code,creatorApproved:true});assert.equal(first.status,200);
 await update(f.api,work,{priceCents:9900});await f.restart();const before=fs.readFileSync(f.dataFile,'utf8');
 for(const creatorCode of [undefined,'wrong'])assert.equal((await f.api('/api/licenses/recover',{saveKey,creatorCode})).status,403);
 const recovered=await f.api('/api/licenses/recover',{saveKey,creatorCode:code});
 assert.equal(recovered.status,200);assert.equal(recovered.body.license.id,first.body.license.id);assert.equal(recovered.body.license.quote.priceCents,4250);
 assert.equal(recovered.body.buyerAccessToken,undefined);assert.equal(recovered.body.license.saveAttempt,undefined);
 assert.equal((await f.api('/api/requests/recover',{saveKey})).status,404);
 for(const key of ['short','f'.repeat(64)])assert.equal((await f.api('/api/licenses/recover',{saveKey:key,creatorCode:code})).status,key.length===64?404:400);
 assert.equal(fs.readFileSync(f.dataFile,'utf8'),before);
 const proposalKey=crypto.randomBytes(32).toString('hex');await f.api('/api/requests',{request:request(work),expectedOfferRevision:2,saveKey:proposalKey});
 assert.equal((await f.api('/api/licenses/recover',{saveKey:proposalKey,creatorCode:code})).status,404);
});

test('published contact is reviewed with its offer and retained on saved proposals',async t=>{
 const f=await fixture(t);const created=await f.api('/api/creator/catalog',offer({contactEmail:'studio@example.com'}));assert.equal(created.status,200);const work=created.body.work;
 const req=request(work),saved=(await f.api('/api/requests',{request:req,expectedOfferRevision:1})).body.license;
 const approved=(await f.api('/api/licenses',{request:req,expectedOfferRevision:1,creatorApproved:true,creatorCode:code})).body.license;
 const terms=await(await f.raw('/api/licenses/'+approved.id+'/terms')).text();
 assert.equal(saved.quote.creatorContactEmail,'studio@example.com');
 const kept=await update(f.api,work,{});assert.equal(kept.body.work.contactEmail,'studio@example.com');assert.equal(kept.body.work.offerRevision,1);
 const changed=await update(f.api,work,{contactEmail:'requests@example.com'});assert.equal(changed.status,200);assert.equal(changed.body.work.offerRevision,2);
 assert.equal((await f.api('/api/review',req)).body.quote.creatorContactEmail,'requests@example.com');
 assert.equal((await f.api('/api/licenses/'+saved.id)).body.license.quote.creatorContactEmail,'studio@example.com');
 assert.equal((await f.api('/api/requests',{request:req,expectedOfferRevision:1})).status,409);
 assert.equal(await(await f.raw('/api/licenses/'+approved.id+'/terms')).text(),terms);
 const cleared=await update(f.api,changed.body.work,{contactEmail:''});assert.equal(cleared.status,200);assert.equal(cleared.body.work.offerRevision,3);
 assert.equal((await f.api('/api/review',req)).body.quote.creatorContactEmail,undefined);
 await f.restart();assert.equal((await f.api('/api/licenses/'+saved.id)).body.license.quote.creatorContactEmail,'studio@example.com');
});

test('contact accepts one optional email and refuses invalid address fields before publication',async t=>{
 const {api}=await fixture(t);
 for(const contactEmail of [null,42,{},'not an email','one@example.com, two@example.com','a@example.com\nother','a'.repeat(255)+'@example.com']){
  assert.equal((await api('/api/creator/catalog',offer({contactEmail}))).status,400);
 }
 assert.equal((await api('/api/catalog')).body.works.filter(w=>w.custom).length,0);
 const empty=await api('/api/creator/catalog',offer({contactEmail:''}));assert.equal(empty.status,200);assert.equal(empty.body.work.contactEmail,undefined);
});

test('ordered collection previews retain exact saved views across reorder, removal, restart and missing catalog',async t=>{
 const f=await fixture(t);
 const created=await f.api('/api/creator/catalog',offer({previewGallery:[{name:'Detail.png',data:alternate},{name:'Overview.png',data:png}]}));
 assert.equal(created.status,200);const work=created.body.work;assert.equal(work.previews.length,3);assert.equal(work.previewFiles,undefined);
 const approved=(await f.api('/api/licenses',{request:request(work),expectedOfferRevision:1,creatorApproved:true,creatorCode:code})).body.license;
 assert.equal(approved.edition.previewUrls.length,3);
 const expected=[png,alternate,png].map(x=>Buffer.from(x,'base64'));
 for(let i=0;i<3;i++)assert.deepEqual(Buffer.from(await(await f.raw(approved.edition.previewUrls[i])).arrayBuffer()),expected[i]);
 const changed=await update(f.api,work,{previewGallery:[{existingIndex:2},{existingIndex:1}]});
 assert.equal(changed.status,200);assert.equal(changed.body.work.offerRevision,2);
 assert.deepEqual(Buffer.from(await(await f.raw(changed.body.work.previews[1])).arrayBuffer()),expected[2]);
 assert.deepEqual(Buffer.from(await(await f.raw(work.previews[1])).arrayBuffer()),expected[1]);
 const omitted=await update(f.api,changed.body.work,{title:'Corrected collection title'});assert.equal(omitted.body.work.previews.length,3);
 const removed=await update(f.api,omitted.body.work,{previewGallery:[]});assert.equal(removed.body.work.previews.length,1);
 assert.equal((await f.raw(removed.body.work.preview+'&image=1')).status,404);
 await f.restart();
 fs.renameSync(path.join(f.dir,'creator-catalog'),path.join(f.dir,'retained-catalog'));
 const saved=(await f.api('/api/licenses/'+approved.id)).body.license;
 assert.equal(saved.edition.previewUrls.length,3);
 for(let i=0;i<3;i++)assert.deepEqual(Buffer.from(await(await f.raw(saved.edition.previewUrls[i])).arrayBuffer()),expected[i]);
});

test('collection previews reject invalid references and keep the existing offer on refused input',async t=>{
 const f=await fixture(t),work=await create(f.api);
 for(const previewGallery of [null,{},Array(6).fill({name:'Preview.png',data:png}),[{existingIndex:0}],[{existingIndex:1}],[{name:'Bad.png',data:'AA=='}]]){
  const result=await update(f.api,work,{previewGallery});assert.equal(result.status,400);
 }
 const current=(await f.api('/api/catalog')).body.works.find(w=>w.id===work.id);assert.equal(current.offerRevision,1);assert.equal(current.previews.length,1);
 for(const suffix of ['&image=-1','&image=6','&image=1.5'])assert.equal((await f.raw(work.preview+suffix)).status,400);
});
