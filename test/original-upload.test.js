'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{Readable}=require('node:stream');
const {createApp}=require('../server');
const {createOriginalUploads,MAX_ORIGINAL_BYTES}=require('../lib/original-upload');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP9sAAAAASUVORK5CYII=','base64');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
test('streamed original refuses interrupted, oversized and changed bytes and recovers exact completed content',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ll-upload-')),uploads=createOriginalUploads(root);
 try{
  async function* interrupted(){yield png.subarray(0,20);throw Error('interrupted');}
  await assert.rejects(uploads.receive(Readable.from(interrupted()),sha(png),'study.png',png.length),/interrupted/);
  assert.deepEqual(fs.readdirSync(root),[]);
  await assert.rejects(uploads.receive(Readable.from([png]),sha(png),'study.png',MAX_ORIGINAL_BYTES+1),/64 MB/);
  await assert.rejects(uploads.receive(Readable.from([png]),'0'.repeat(64),'study.png',png.length),/match/);
  assert.deepEqual(fs.readdirSync(root),[]);
  await uploads.receive(Readable.from([png]),sha(png),'study.png',png.length);
  assert.equal(createOriginalUploads(root).status(sha(png)).ready,true);
  assert.deepEqual(uploads.resolve({uploadSha:sha(png),name:'study.png'}).bytes,png);
  fs.writeFileSync(path.join(root,sha(png)),Buffer.from('damaged'));assert.equal(uploads.status(sha(png)).ready,false);
  await uploads.receive(Readable.from([png]),sha(png),'study.png',png.length);assert.equal(uploads.status(sha(png)).ready,true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('authenticated upload stays unpublished, binds an exact catalog request and survives restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-upload-app-')),dataFile=path.join(dir,'licenses.json');
 let app,base;async function start(options={}){app=createApp({dataFile,creatorCode:'local-test-code-夜-100%',...options});await new Promise(r=>app.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.address().port;}
 const headers={'Content-Type':'application/octet-stream','X-Creator-Code-Encoded':encodeURIComponent('local-test-code-夜-100%'),'X-Original-Name':encodeURIComponent('Estuary étude.png')};
 const url='/api/creator/originals/'+sha(png);
 const post=async body=>{const r=await fetch(base+'/api/creator/catalog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,value:await r.json()};};
 await start();
 try{
  assert.equal((await fetch(base+url)).status,403);
  assert.equal((await fetch(base+url,{method:'PUT',headers:{...headers,'X-Creator-Code-Encoded':encodeURIComponent('wrong')},body:png})).status,403);
  assert.equal((await fetch(base+url,{method:'PUT',headers:{...headers,Origin:'https://different.invalid'},body:png})).status,403);
  assert.equal((await fetch(base+url,{headers:{...headers,'X-Creator-Code-Encoded':'%broken'}})).status,403);
  const uploaded=await fetch(base+url,{method:'PUT',headers:{...headers,'X-Original-Bytes':String(png.length)},body:Readable.from([png.subarray(0,20),png.subarray(20)]),duplex:'half'});assert.equal(uploaded.status,200);assert.equal((await uploaded.json()).sha256,sha(png));
  assert.equal((await (await fetch(base+'/api/creator/catalog')).json()).works.length,0);
  const body={requestId:crypto.randomUUID(),creatorCode:'local-test-code-夜-100%',confirmed:true,title:'Estuary study',creator:'Example studio',description:'Original coastal artwork for a museum program.',priceCents:4250,permitted:['website','print'],maxCopies:750,original:{name:'Estuary étude.png',uploadSha:sha(png)},preview:{name:'preview.png',data:png.toString('base64')}};
  const saved=await post(body);assert.equal(saved.status,200);assert.equal(saved.value.work.delivery.filename,'Estuary étude.png');
  assert.equal((await post(body)).value.work.id,saved.value.work.id);
  assert.equal((await post({...body,original:{...body.original,name:'Changed.png'}})).status,409);
  const request={assetId:saved.value.work.id,licensee:'Example museum',project:'Visitor exhibition guide',medium:'print',copies:600,attribution:true};
  const r=await fetch(base+'/api/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request})});assert.equal(r.status,200);
  const {license}=await r.json();assert.equal(license.assetDelivery.sha256,sha(png));assert.deepEqual(fs.readFileSync(path.join(dir,'approved-assets',sha(png))),png);
  await new Promise(r=>app.close(r));await start();
  assert.equal((await (await fetch(base+url,{headers})).json()).ready,true);assert.equal((await post(body)).value.work.id,saved.value.work.id);
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('one in-flight original bounds staging and a competing caller can retry after completion',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ll-upload-busy-')),uploads=createOriginalUploads(root);
 let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 async function* slow(){entered();await gate;yield png;}
 try{
  const first=uploads.receive(Readable.from(slow()),sha(png),'study.png',png.length);await started;
  await assert.rejects(uploads.receive(Readable.from([png]),sha(png),'study.png',png.length),/Another original/);
  assert.equal(uploads.status(sha(png)).ready,false);release();await first;
  assert.equal(uploads.status(sha(png)).ready,true);assert.equal(fs.readdirSync(root).length,1);
 }finally{release();fs.rmSync(root,{recursive:true,force:true});}
});

test('existing ASCII upload codes retain their literal percent characters',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-upload-legacy-code-'));
 const app=createApp({dataFile:path.join(dir,'licenses.json'),creatorCode:'ASCII%41'});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.address().port+'/api/creator/originals/'+sha(png);
 try{
  assert.equal((await fetch(url,{headers:{'X-Creator-Code':'ASCII%41'}})).status,200);
  assert.equal((await fetch(url,{headers:{'X-Creator-Code-Encoded':encodeURIComponent('ASCII%41')}})).status,200);
  assert.equal((await fetch(url,{headers:{'X-Creator-Code-Encoded':'ASCII%41'}})).status,403);
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
