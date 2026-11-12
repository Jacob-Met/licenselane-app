'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const source=path.resolve(__dirname,'..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const request={assetId:'lantern-atlas',project:'Coastal annual',licensee:'North Harbour Press',medium:'website',copies:0,attribution:true,exclusive:false,training:false};
async function fixture(legacy){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ll-edition-')),appRoot=path.join(folder,'app'),dataFile=path.join(folder,'state','licenses.json');
 fs.cpSync(source,appRoot,{recursive:true,filter:p=>!['.git','dist','docs','node_modules','.data'].includes(path.relative(source,p).split(path.sep)[0])});
 fs.mkdirSync(path.dirname(dataFile),{recursive:true});
 const app=require(path.join(appRoot,'server.js'));
 if(legacy){
  const bytes=fs.readFileSync(path.join(appRoot,'assets','versions',legacy));
  const l={id:'e'.repeat(64),request,quote:app.quote(request),status:'approved',orderId:null,captureId:null,
   assetDelivery:{filename:'lantern-atlas.svg',mime:'image/svg+xml',bytes:bytes.length,sha256:legacy},policySnapshot:app.POLICY};
  fs.writeFileSync(dataFile,JSON.stringify({licenses:{[l.id]:l}}));
 }
 let server,origin,providerCalls=0;
 const paypal={configured:true,create:async()=>{providerCalls++;throw Error('No payment expected.');}};
 const start=async()=>{server=app.createApp({dataFile,paypal,creatorCode:'',ai:{configured:false},briefExtractor:{configured:false}});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;};
 const stop=async()=>new Promise(r=>server.close(r));
 await start();
 const get=async route=>fetch(origin+route);
 const post=async(route,body)=>{const response=await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text());return response.json();};
 return {folder,appRoot,dataFile,get,post,start,stop,get providerCalls(){return providerCalls;},close:async()=>{await stop();fs.rmSync(folder,{recursive:true,force:true});}};
}
test('an old approved receipt identifies and previews its original Atlas before payment',async()=>{
 const oldHash='649d0daee02bb0822ada72200856db8d149348648f91523418ac04d29bfb3e17',f=await fixture(oldHash);
 try{
  const url='/api/licenses/'+'e'.repeat(64),l=(await (await f.get(url)).json()).license;
  assert.equal(l.edition.label,'Harbour city');assert.equal(l.edition.isCurrent,false);
  assert.equal(l.edition.bytes,9930);assert.equal(l.edition.sha256,oldHash);
  const preview=await f.get(l.edition.previewUrl);assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'image/svg+xml');
  assert.equal(sha(Buffer.from(await preview.arrayBuffer())),oldHash);
  const current=Buffer.from(await (await f.get('/assets/lantern-atlas.svg')).arrayBuffer());assert.notEqual(sha(current),oldHash);
  assert.equal((await f.get(url+'/asset')).status,409);
  const terms=await (await f.get(url+'/terms')).text();assert.match(terms,/Approved edition: Harbour city/);assert.match(terms,/NOT ISSUED/);
  assert.equal(f.providerCalls,0);
 }finally{await f.close();}
});
test('a proposed non-image asset keeps its preview and edition when the catalogue changes',async()=>{
 const f=await fixture();
 try{
  const saved=await f.post('/api/requests',{request:{...request,assetId:'copper-signal'}});
  const l=saved.license;assert.equal(l.status,'requested');assert.equal(l.edition.label,'Twelve navigation symbols');assert.equal(l.edition.isCurrent,true);
  const before=Buffer.from(await (await f.get(l.edition.previewUrl)).arrayBuffer());
  assert.equal(sha(before),l.assetEdition.preview.sha256);
  fs.writeFileSync(path.join(f.appRoot,'public','assets','copper-signal.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><title>Later preview</title></svg>');
  fs.appendFileSync(path.join(f.appRoot,'public','assets','copper-signal.zip'),'Later edition');
  await f.stop();await f.start();
  const after=(await (await f.get('/api/licenses/'+l.id)).json()).license;
  assert.equal(after.status,'requested');assert.equal(after.edition.isCurrent,false);
  assert.equal(after.edition.label,l.edition.label);assert.equal(after.edition.sha256,l.assetDelivery.sha256);
  assert.deepEqual(Buffer.from(await (await f.get(after.edition.previewUrl)).arrayBuffer()),before);
  assert.equal((await f.get('/api/licenses/'+l.id+'/asset')).status,409);assert.equal(f.providerCalls,0);
 }finally{await f.close();}
});
