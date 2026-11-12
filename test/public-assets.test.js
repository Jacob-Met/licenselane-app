'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server');
test('both real entry pages serve every linked script, stylesheet and font with its browser MIME type',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'licenselane-public-assets-'));
 const app=createApp({dataFile:path.join(dir,'licenses.json'),creatorCode:'asset-route-course'});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+app.address().port,checked=new Set();
 async function asset(url){
  const u=new URL(url,origin);assert.equal(u.origin,origin,'The app must self-host its assets');
  if(checked.has(u.pathname))return;checked.add(u.pathname);
  const r=await fetch(u);assert.equal(r.status,200,'Missing entry asset: '+u.pathname);
  const expected=u.pathname.endsWith('.css')?'text/css':u.pathname.endsWith('.js')?'application/javascript':u.pathname.endsWith('.ttf')?'font/ttf':null;
  if(expected)assert.equal(r.headers.get('content-type')?.split(';')[0],expected,u.pathname);
  const bytes=Buffer.from(await r.arrayBuffer());assert.ok(bytes.length>0,u.pathname);
  if(u.pathname.endsWith('.css')){
   for(const m of bytes.toString().matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)){if(!m[1].startsWith('data:'))await asset(new URL(m[1],u).href);}
  }
 }
 try{
  for(const entry of ['/','/creator.html']){
   const r=await fetch(origin+entry);assert.equal(r.status,200);
   for(const m of (await r.text()).matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/g))await asset(m[1]);
  }
  assert.ok([...checked].some(p=>p.endsWith('.ttf')),'The actual page must load its font');
 }finally{await new Promise(resolve=>app.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});

test('fresh galleries show the authored collection while old offers and retained PNG editions remain usable',async()=>{
 const crypto=require('node:crypto'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'licenselane-bundled-')),dataFile=path.join(dir,'licenses.json');
 let app,origin;const start=async()=>{app=createApp({dataFile,creatorCode:'bundled-course',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});await new Promise(r=>app.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+app.address().port;};
 const get=async url=>{const r=await fetch(origin+url);assert.equal(r.status,200,url);return r.json();};
 const post=async(url,body)=>{const r=await fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();};
 await start();
 try{
  const manifest=require('../public/assets/between-water-and-sky/collection.json'),works=(await get('/api/catalog')).works;
  assert.deepEqual(works.map(w=>w.id),manifest.works.map(w=>w.slug));
  assert.equal(fs.existsSync(dataFile),false);assert.equal(fs.existsSync(path.join(dir,'creator-catalog')),false,'Browsing must not seed or rewrite creator data');
  for(const [i,work] of works.entries()){
   const declared=manifest.works[i],preview=await fetch(origin+work.preview),original=await fetch(origin+work.download);
   assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'image/png');
   assert.equal(sha(Buffer.from(await preview.arrayBuffer())),declared.previewSha256);
   assert.equal(original.status,200);assert.equal(original.headers.get('content-type'),'application/zip');
   assert.equal(sha(Buffer.from(await original.arrayBuffer())),declared.originalSha256);
   const request={assetId:work.id,licensee:'Harbour Reading Room',project:'Water and Sky exhibition guide',medium:'print',copies:875,attribution:true};
   const review=await post('/api/review',request);assert.equal(review.quote.eligible,true);assert.equal(review.quote.priceCents,7300);assert.equal(review.quote.assetTitle,declared.title);
   const saved=(await post('/api/requests',{request})).license;
   assert.equal(saved.assetDelivery.sha256,declared.originalSha256);assert.equal(saved.assetEdition.preview.mime,'image/png');
   const retained=await fetch(origin+saved.edition.previewUrl);assert.equal(retained.headers.get('content-type'),'image/png');
   assert.equal(sha(Buffer.from(await retained.arrayBuffer())),declared.previewSha256);
  }
  for(const id of ['lantern-atlas','blue-hour','copper-signal'])assert.equal((await get('/api/catalog/'+id)).work.id,id);
  const before=fs.readFileSync(dataFile);await new Promise(r=>app.close(r));await start();
  assert.deepEqual((await get('/api/catalog')).works.map(w=>w.id),manifest.works.map(w=>w.slug));
  assert.deepEqual(fs.readFileSync(dataFile),before,'Starting the updated gallery must preserve saved agreements');
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
