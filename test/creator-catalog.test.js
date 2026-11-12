'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=';
test('own creator work requires authorization, persists, quotes exact limits and retains a protected original',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-catalog-')),dataFile=path.join(dir,'licenses.json');
 let app=createApp({dataFile,creatorCode:'test-only-code'});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 let base='http://127.0.0.1:'+app.address().port;
 const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 try{
 const offer={requestId:require('node:crypto').randomUUID(),title:'Tidal study',creator:'Example artist',description:'Original abstract tidal shoreline image.',priceCents:4250,permitted:['website','print'],maxCopies:750,original:{name:'Tidal.png',data:png},preview:{name:'Preview.png',data:png},confirmed:true};
 assert.equal((await post('/api/creator/catalog',offer)).status,403);
 assert.equal((await post('/api/creator/catalog',{...offer,creatorCode:'test-only-code',confirmed:false})).status,400);
 assert.equal((await post('/api/creator/catalog',{...offer,creatorCode:'test-only-code',original:{name:'unsafe.svg',data:Buffer.from('<svg/>').toString('base64')}})).status,400);
 const result=await post('/api/creator/catalog',{...offer,creatorCode:'test-only-code'});assert.equal(result.status,200);const work=result.body.work;
 const retry=await post('/api/creator/catalog',{...offer,creatorCode:'test-only-code'});assert.equal(retry.body.work.id,work.id);
 assert.equal((await post('/api/creator/catalog',{...offer,title:'Different work',creatorCode:'test-only-code'})).status,409);
 assert.equal(work.download,undefined);assert.equal(work.original,undefined);
 assert.equal((await fetch(base+work.preview)).headers.get('content-type'),'image/png');
 assert.equal((await fetch(base+'/api/catalog/'+work.id+'/original')).status,404);
 const request={assetId:work.id,licensee:'Moss museum',project:'Tidal exhibition guide',medium:'print',copies:600,attribution:true};
 const review=await post('/api/review',request);assert.equal(review.body.quote.priceCents,6650);assert.equal(review.body.quote.eligible,true);
 assert.equal((await post('/api/review',{...request,copies:751})).body.quote.eligible,false);
 const saved=await post('/api/requests',{request});assert.equal(saved.status,200);const license=saved.body.license;
 assert.equal(license.assetDelivery.mime,'image/png');assert.equal(license.assetDelivery.bytes,Buffer.from(png,'base64').length);
 assert.equal((await fetch(base+'/api/licenses/'+license.id+'/asset')).status,409);
 assert.deepEqual(fs.readFileSync(path.join(dir,'approved-assets',license.assetDelivery.sha256)),Buffer.from(png,'base64'));
 await new Promise(r=>app.close(r));app=createApp({dataFile,creatorCode:'test-only-code'});await new Promise(r=>app.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.address().port;
 assert.equal((await (await fetch(base+'/api/catalog')).json()).works.find(w=>w.id===work.id).title,'Tidal study');
 assert.equal((await (await fetch(base+'/api/licenses/'+license.id)).json()).license.quote.priceCents,6650);
 const approved=await post('/api/licenses/'+license.id+'/approve',{creatorCode:'test-only-code',creatorApproved:true});assert.equal(approved.status,200);assert.equal(approved.body.license.status,'approved');
 }finally{await new Promise(r=>app.close(r));}
});


test('creator ZIP bundle survives review, payment, offer changes and restart byte for byte',async()=>{
 const crypto=require('node:crypto');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-bundle-')),dataFile=path.join(dir,'licenses.json');
 const bundle=fs.readFileSync(path.join(__dirname,'../public/assets/copper-signal.zip'));
 const digest=crypto.createHash('sha256').update(bundle).digest('hex');
 let paid=false,orders=0,captures=0;
 // Controlled provider for application regression; this does not establish a
 // genuine Sandbox purchase.
 const paypal={configured:true,
  async create(){orders++;return {id:'BUNDLEORDER01',links:[{rel:'approve',href:'https://www.sandbox.paypal.com/checkoutnow?token=BUNDLEORDER01'}]};},
  async capture(){captures++;paid=true;return {status:'COMPLETED'};},
  async inspect(l){return {id:l.orderId,intent:'CAPTURE',status:paid?'COMPLETED':'APPROVED',purchase_units:[{custom_id:l.id,amount:{currency_code:'USD',value:(l.quote.priceCents/100).toFixed(2)},payments:{captures:paid?[{id:'BUNDLECAPTURE01',status:'COMPLETED',amount:{currency_code:'USD',value:(l.quote.priceCents/100).toFixed(2)}}]:[]}}]};}
 };
 let app,base;
 async function start(){app=createApp({dataFile,creatorCode:'bundle-test-code',paypal,ai:{configured:false}});await new Promise(r=>app.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.address().port;}
 const post=async(url,body)=>{const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 await start();
 try{
  const offer={requestId:crypto.randomUUID(),title:'Coastal symbols collection',creator:'Example artist',description:'Twelve editable navigation symbols and their included readme, in one original ZIP.',priceCents:3900,permitted:['website','print'],maxCopies:1200,original:{name:'Coastal-symbols.zip',data:bundle.toString('base64')},preview:{name:'Preview.png',data:png},confirmed:true};
  assert.equal((await post('/api/creator/catalog',offer)).status,403);
  const saved=await post('/api/creator/catalog',{...offer,creatorCode:'bundle-test-code'});
  assert.equal(saved.status,200);const work=saved.body.work;
  assert.equal(work.delivery.contents.length,13);assert.deepEqual(work.delivery.contents[0],{name:'compass.svg',bytes:fs.statSync(path.join(__dirname,'../public/assets/compass.svg')).size});assert.equal(work.delivery.sha256,undefined);assert.equal(work.delivery.content,undefined);
  assert.equal(work.kind,'Creator bundle');assert.match(work.specs,/13 files/);assert.equal(work.original,undefined);assert.equal(work.download,undefined);
  assert.equal((await post('/api/creator/catalog',{...offer,creatorCode:'bundle-test-code'})).body.work.id,work.id);
  const preview=await fetch(base+work.preview);assert.equal(preview.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await preview.arrayBuffer()),Buffer.from(png,'base64'));
  assert.equal((await fetch(base+'/api/catalog/'+work.id+'/original')).status,404);
  const request={assetId:work.id,licensee:'Coast museum',project:'Visitor route guide',medium:'print',copies:700,attribution:true};
  const review=await post('/api/review',request);assert.equal(review.body.quote.priceCents,6300);
  const proposed=await post('/api/requests',{request,expectedOfferRevision:1});assert.equal(proposed.status,200);
  const license=proposed.body.license,buyerAccessToken=proposed.body.buyerAccessToken;
  assert.equal(license.assetDelivery.mime,'application/zip');assert.equal(license.assetDelivery.filename,'Coastal-symbols.zip');
  assert.deepEqual(license.assetDelivery.contents,work.delivery.contents);assert.deepEqual(license.edition.contents,work.delivery.contents);
  assert.equal(license.assetDelivery.bytes,bundle.length);assert.equal(license.assetDelivery.sha256,digest);
  assert.equal((await fetch(base+'/api/licenses/'+license.id+'/asset')).status,409);
  const approved=await post('/api/licenses/'+license.id+'/approve',{creatorCode:'bundle-test-code',creatorApproved:true});assert.equal(approved.body.license.status,'approved');
  const ordered=await post('/api/licenses/'+license.id+'/order',{buyerAccessToken});assert.equal(ordered.status,200);
  const issued=await post('/api/licenses/'+license.id+'/capture',{buyerAccessToken});assert.equal(issued.body.license.status,'issued');
  const readOriginal=async()=>{
   const downloaded=await fetch(base+'/api/licenses/'+license.id+'/asset');assert.equal(downloaded.status,200);
   assert.equal(downloaded.headers.get('content-type'),'application/zip');assert.equal(downloaded.headers.get('x-content-type-options'),'nosniff');
   assert.equal(downloaded.headers.get('content-disposition'),'attachment; filename="Coastal-symbols.zip"');
   assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bundle);
   const terms=await (await fetch(base+'/api/licenses/'+license.id+'/terms')).text();assert.match(terms,/Coastal-symbols.zip/);assert.match(terms,/Price: USD 63.00/);assert.match(terms,/Included files:/);assert.match(terms,/compass.svg/);const restored=(await (await fetch(base+'/api/licenses/'+license.id)).json()).license;assert.deepEqual(restored.edition.contents,work.delivery.contents);
  };
  await readOriginal();
  const {original,...correction}=offer;
  const updated=await post('/api/creator/catalog/'+work.id,{...correction,requestId:crypto.randomUUID(),expectedOfferRevision:1,title:'Coastal symbols, current offer',priceCents:4500,creatorCode:'bundle-test-code'});
  assert.equal(updated.status,200);assert.equal(updated.body.work.offerRevision,2);
  await readOriginal();
  await new Promise(r=>app.close(r));await start();await readOriginal();
  assert.equal((await (await fetch(base+'/api/catalog')).json()).works.find(w=>w.id===work.id).priceCents,4500);
  assert.equal(orders,1);assert.equal(captures,1);
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('bundle upload rejects an incomplete or empty archive and keeps ZIP out of previews',async()=>{
 const crypto=require('node:crypto'),{createCatalog}=require('../lib/creator-catalog');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-bundle-input-')),catalog=createCatalog(path.join(dir,'licenses.json'));
 const zip=fs.readFileSync(path.join(__dirname,'../public/assets/copper-signal.zip'));
 const base={title:'Coastal bundle',creator:'Example artist',description:'Twelve editable navigation symbols in an original bundle.',priceCents:3900,permitted:['website'],maxCopies:0,confirmed:true,preview:{name:'Preview.png',data:png}};
 const empty=Buffer.from('504b0506000000000000000000000000000000000000','hex');
 const corrupt=Buffer.from(zip);corrupt.writeUInt32LE(0xffffffff,corrupt.length-6);
 try{
  for(const bad of [zip.subarray(0,-4),Buffer.from('a renamed text file'),Buffer.from(png,'base64'),empty,corrupt]){
   assert.throws(()=>catalog.add({...base,requestId:crypto.randomUUID(),original:{name:'Original.zip',data:bad.toString('base64')}}),/complete ZIP/);
  }
  assert.throws(()=>catalog.add({...base,requestId:crypto.randomUUID(),original:{name:'Original.png',data:png},preview:{name:'Preview.zip',data:zip.toString('base64')}}),/real PNG or JPEG/);
  assert.equal(catalog.works().length,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('existing ZIP inventory is read from retained bytes without rewriting its catalog',()=>{
 const {createCatalog}=require('../lib/creator-catalog'),crypto=require('node:crypto');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-existing-inventory-')),file=path.join(dir,'licenses.json');
 try{
  let catalog=createCatalog(file);const bundle=fs.readFileSync(path.join(__dirname,'../public/assets/copper-signal.zip'));
  const work=catalog.add({requestId:crypto.randomUUID(),title:'Coastal bundle',creator:'Example artist',description:'Twelve editable coastal navigation symbols.',priceCents:3900,permitted:['website'],maxCopies:0,confirmed:true,preview:{name:'Preview.png',data:png},original:{name:'Coastal.zip',data:bundle.toString('base64')}});
  const index=path.join(dir,'creator-catalog/catalog.json'),stored=JSON.parse(fs.readFileSync(index));delete stored.works[0].original.contents;fs.writeFileSync(index,JSON.stringify(stored));const before=fs.readFileSync(index);
  catalog=createCatalog(file);assert.deepEqual(catalog.works()[0].delivery.contents,work.delivery.contents);assert.deepEqual(catalog.original(work.id).contents,work.delivery.contents);assert.deepEqual(fs.readFileSync(index),before);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('creator original names retain spaces and Unicode through issued HTTP delivery',async()=>{
 const crypto=require('node:crypto');
 for(const [name,bytes]of [['Étude nocturne – 夜.png',Buffer.from(png,'base64')],['Coastal symbols – 海.zip',fs.readFileSync(path.join(__dirname,'../public/assets/copper-signal.zip'))]]){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-named-original-'));let paid=false;
  const paypal={configured:true,async create(){return{id:'NAMEDORDER01',links:[{rel:'approve',href:'https://www.sandbox.paypal.com/checkoutnow?token=NAMEDORDER01'}]};},async capture(){paid=true;return{status:'COMPLETED'};},async inspect(l){return{id:l.orderId,intent:'CAPTURE',status:paid?'COMPLETED':'APPROVED',purchase_units:[{custom_id:l.id,amount:{currency_code:'USD',value:'39.00'},payments:{captures:paid?[{id:'NAMEDCAPTURE01',status:'COMPLETED',amount:{currency_code:'USD',value:'39.00'}}]:[]}}]};}};
  const app=createApp({dataFile:path.join(dir,'licenses.json'),creatorCode:'name-course',paypal,ai:{configured:false}});await new Promise(r=>app.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.address().port,post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
  try{
   const {work}=await post('/api/creator/catalog',{requestId:crypto.randomUUID(),creatorCode:'name-course',confirmed:true,title:'Night study',creator:'Example artist',description:'Original artwork with its creator-selected filename.',priceCents:3900,permitted:['website'],maxCopies:0,preview:{name:'Preview.png',data:png},original:{name,data:bytes.toString('base64')}});
   assert.equal(work.delivery.filename,name);
   const {license,buyerAccessToken}=await post('/api/requests',{request:{assetId:work.id,licensee:'Example museum',project:'Exhibition website',medium:'website',copies:0,attribution:true}});
   await post('/api/licenses/'+license.id+'/approve',{creatorCode:'name-course',creatorApproved:true});
   await post('/api/licenses/'+license.id+'/order',{buyerAccessToken});await post('/api/licenses/'+license.id+'/capture',{buyerAccessToken});
   const download=await fetch(base+'/api/licenses/'+license.id+'/asset');assert.equal(download.status,200);
   const disposition=download.headers.get('content-disposition');assert.ok(disposition.startsWith('attachment; filename="'));
   assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]),name);
   assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
   const terms=await(await fetch(base+'/api/licenses/'+license.id+'/terms')).text();assert.ok(terms.includes(name));
  }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
 }
});

test('creator can publish only their own gallery without losing offers, retry receipts or retained agreements',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-gallery-')),dataFile=path.join(dir,'licenses.json');
 let app,base;
 async function start(){app=createApp({dataFile,creatorCode:'gallery-test-code'});await new Promise(r=>app.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.address().port;}
 const get=async url=>(await fetch(base+url)).json();
 const post=async(url,body,headers={})=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const uuid=()=>require('node:crypto').randomUUID();
 await start();
 try{
  const initial=await get('/api/catalog'),demo=initial.works[0],settings={requestId:uuid(),expectedRevision:1,includeDemoWorks:false,confirmed:true};
  assert.equal((await post('/api/creator/catalog/settings',settings)).status,403);
  settings.creatorCode='gallery-test-code';
  assert.equal((await post('/api/creator/catalog/settings',settings)).status,400);
  const offer={requestId:uuid(),title:'Tidal study',creator:'Tidal studio',description:'Original tidal artwork for editorial projects.',priceCents:4250,permitted:['website'],maxCopies:0,original:{name:'Tidal.png',data:png},preview:{name:'Preview.png',data:png},confirmed:true,creatorCode:'gallery-test-code'};
  const work=(await post('/api/creator/catalog',offer)).body.work;
  const retained=(await post('/api/requests',{request:{assetId:demo.id,licensee:'Museum studio',project:'Museum exhibition website',medium:'website',copies:0,attribution:true}})).body.license;
  assert.ok(retained.id);
  assert.equal((await post('/api/creator/catalog/settings',settings,{Origin:'https://unrelated.example'})).status,403);
  const changed=await post('/api/creator/catalog/settings',settings);assert.equal(changed.status,200);assert.equal(changed.body.settings.revision,2);
  assert.deepEqual((await get('/api/catalog')).works.map(w=>w.id),[work.id]);
  assert.equal((await get('/api/catalog/'+demo.id)).work.id,demo.id);
  assert.equal((await get('/api/licenses/'+retained.id)).license.id,retained.id);
  assert.deepEqual((await post('/api/creator/catalog/settings',settings)).body,changed.body);
  assert.equal((await post('/api/creator/catalog/settings',{...settings,includeDemoWorks:true})).status,409);
  assert.equal((await post('/api/creator/catalog/settings',{...settings,requestId:uuid(),includeDemoWorks:true})).status,409);
  const update={...offer,requestId:uuid(),expectedOfferRevision:1,title:'Updated tidal study'};delete update.original;delete update.preview;
  assert.equal((await post('/api/creator/catalog/'+work.id,update)).status,200);
  assert.equal((await get('/api/creator/catalog')).settings.includeDemoWorks,false);
  const second=(await post('/api/creator/catalog',{...offer,requestId:uuid(),title:'Second tidal study'})).body.work;
  assert.equal((await get('/api/catalog')).works.length,2);
  await new Promise(r=>app.close(r));await start();
  assert.equal((await get('/api/creator/catalog')).settings.includeDemoWorks,false);
  for(const w of (await get('/api/creator/catalog')).works)assert.equal((await post('/api/creator/catalog/'+w.id+'/status',{creatorCode:'gallery-test-code',requestId:uuid(),expectedOfferRevision:w.offerRevision,status:'paused',confirmed:true})).status,200);
  assert.equal((await get('/api/catalog')).works.length,0);
  assert.equal((await post('/api/creator/catalog/settings',{...settings,requestId:uuid(),expectedRevision:2,includeDemoWorks:true})).status,200);
  assert.equal((await get('/api/catalog')).works.length,initial.works.length);
  assert.deepEqual((await post('/api/creator/catalog/settings',settings)).body,changed.body);
  assert.equal((await get('/api/creator/catalog')).settings.includeDemoWorks,true);
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
