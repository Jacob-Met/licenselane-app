'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {snapshot,restore,inventory,hash,restoredIdentity}=require('../lib/studio-backup'),{createApp}=require('../server');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ll-studio-test-')),data=path.join(root,'original');fs.mkdirSync(data);fs.mkdirSync(path.join(data,'approved-assets'));fs.writeFileSync(path.join(data,'licenses.json'),JSON.stringify({licenses:{}}));fs.writeFileSync(path.join(data,'approved-assets','a'.repeat(64)),Buffer.alloc(1024*1024,93));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return {root,data,dataFile:path.join(data,'licenses.json')};}
const origin='https://studio.example',commit='a'.repeat(40);
test('complete studio archive restores exact files, original identity and a new inspection generation',async t=>{
 const f=fixture(t),before=await inventory(f.data),b=await snapshot({...f,origin,commit});t.after(()=>b.cleanup());
 const dest=path.join(f.root,'restored'),r=await restore({archive:b.archive,sha256:b.sha256,destination:dest});
 assert.equal(r.origin,origin);assert.equal(r.files,2);for(const [name,digest]of Object.entries(before))assert.equal(await hash(path.join(dest,name)),digest);
 assert.deepEqual(await inventory(f.data),before);assert.equal(restoredIdentity(r.dataFile).restorationId,b.sha256);
 const app=createApp({dataFile:r.dataFile,paypal:{configured:false}});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.close(r)));
 const cfg=await(await fetch('http://127.0.0.1:'+app.address().port+'/api/config')).json();assert.equal(cfg.installationOrigin,origin);assert.equal(cfg.restoredOrigin,origin);
 await assert.rejects(restore({archive:b.archive,sha256:b.sha256,destination:dest}),/new destination/);
 assert.equal(await hash(path.join(dest,'approved-assets','a'.repeat(64))),before['approved-assets/'+'a'.repeat(64)]);
});
test('wrong checksum, changed manifest, corrupt gzip and linked source cannot replace a studio',async t=>{
 const f=fixture(t),b=await snapshot({...f,origin,commit});t.after(()=>b.cleanup());
 await assert.rejects(restore({archive:b.archive,sha256:'0'.repeat(64),destination:path.join(f.root,'wrong')}),/checksum/);
 const damaged=path.join(f.root,'damaged.tar.gz'),bytes=fs.readFileSync(b.archive);fs.writeFileSync(damaged,bytes.subarray(0,bytes.length-7));
 await assert.rejects(restore({archive:damaged,sha256:await hash(damaged),destination:path.join(f.root,'truncated')}));assert.equal(fs.existsSync(path.join(f.root,'truncated')),false);
 const raw=zlib.gunzipSync(bytes);raw[512+100]^=1;fs.writeFileSync(damaged,zlib.gzipSync(raw));await assert.rejects(restore({archive:damaged,sha256:await hash(damaged),destination:path.join(f.root,'changed')}));
 fs.symlinkSync(path.join(f.data,'licenses.json'),path.join(f.data,'linked'));await assert.rejects(snapshot({...f,origin,commit}),/linked files/);
});
test('creator backup requires authority and same origin, downloads once and leaves data unchanged',async t=>{
 const f=fixture(t),before=await inventory(f.data),app=createApp({dataFile:f.dataFile,creatorCode:'test-夜',sourceCommit:commit,installationOrigin:origin});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.close(r)));const base='http://127.0.0.1:'+app.address().port;
 const prepare=(creatorCode,extra={})=>fetch(base+'/api/creator/studio-backup',{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify({creatorCode})});
 assert.equal((await prepare('wrong')).status,403);assert.equal((await prepare('test-夜',{Origin:'https://elsewhere.example'})).status,403);
 const response=await prepare('test-夜');assert.equal(response.status,200);const value=await response.json();const download=await fetch(base+value.download);assert.equal(download.status,200);const bytes=Buffer.from(await download.arrayBuffer());assert.match(download.headers.get('content-disposition'),/LicenseLane-studio-[a-f0-9]{64}/);
 const archive=path.join(f.root,'download.tar.gz');fs.writeFileSync(archive,bytes);const restored=await restore({archive,sha256:await hash(archive),destination:path.join(f.root,'received')});assert.equal(restored.origin,origin);
 assert.equal((await fetch(base+value.download)).status,404);assert.deepEqual(await inventory(f.data),before);
});
test('restored metadata blocks an unfinished order before any provider capture',async t=>{
 const f=fixture(t);let app,base,captures=0;
 async function start(dataFile){app=createApp({dataFile,creatorCode:'local-test',paypal:{configured:true,capture(){captures++;throw Error('must not run');}}});await new Promise(r=>app.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.address().port;}
 t.after(async()=>{if(app)await new Promise(r=>app.close(r));});await start(f.dataFile);
 const saved=await(await fetch(base+'/api/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request:{assetId:'lantern-atlas',project:'Isolated restoration contract',licensee:'Example museum',medium:'website',copies:0,attribution:true}})})).json();
 await new Promise(r=>app.close(r));app=null;const data=JSON.parse(fs.readFileSync(f.dataFile));Object.assign(data.licenses[saved.license.id],{status:'order_created',orderId:'LOCAL-UNFINISHED'});fs.writeFileSync(f.dataFile,JSON.stringify(data));
 const b=await snapshot({...f,origin,commit});t.after(()=>b.cleanup());const restored=await restore({archive:b.archive,sha256:b.sha256,destination:path.join(f.root,'received')});await start(restored.dataFile);
 const prefix='/api/licenses/'+saved.license.id,record=await(await fetch(base+prefix)).json();assert.equal(record.license.restoration.state,'inspection_required');
 const capture=await fetch(base+prefix+'/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({buyerAccessToken:saved.buyerAccessToken})});assert.equal(capture.status,409);assert.equal(captures,0);
});
test('archive traversal and omitted entries fail before destination activation',async t=>{
 const f=fixture(t),b=await snapshot({...f,origin,commit});t.after(()=>b.cleanup());const raw=zlib.gunzipSync(fs.readFileSync(b.archive));
 const manifestSize=parseInt(raw.subarray(124,136).toString().split('\0')[0],8),offset=512+Math.ceil(manifestSize/512)*512;
 const bad=Buffer.from(raw);bad.fill(0,offset,offset+100);bad.write('data/../../escaped',offset);bad.fill(32,offset+148,offset+156);const sum=bad.subarray(offset,offset+512).reduce((a,v)=>a+v,0);bad.write(sum.toString(8).padStart(6,'0')+'\0 ',offset+148);
 const archive=path.join(f.root,'bad.tar.gz');fs.writeFileSync(archive,zlib.gzipSync(bad));await assert.rejects(restore({archive,sha256:await hash(archive),destination:path.join(f.root,'escape')}),/Unsupported|inventory/);assert.equal(fs.existsSync(path.join(f.root,'escaped')),false);
 fs.writeFileSync(archive,zlib.gzipSync(Buffer.concat([raw.subarray(0,offset),Buffer.alloc(1024)])));await assert.rejects(restore({archive,sha256:await hash(archive),destination:path.join(f.root,'missing')}),/missing files/);assert.equal(fs.existsSync(path.join(f.root,'missing')),false);
});
