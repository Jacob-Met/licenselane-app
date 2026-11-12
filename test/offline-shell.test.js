const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const offlineShell=require('../lib/offline-shell');
test('offline shell excludes API and delivered files; any interface change versions the complete shell',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ll-shell-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'public'));
 fs.writeFileSync(path.join(root,'public/index.html'),'<script src="/app.js"></script><link href="/style.css"><img src="/api/licenses/private/preview">');
 fs.writeFileSync(path.join(root,'public/app.js'),'first');fs.writeFileSync(path.join(root,'public/style.css'),'style');fs.copyFileSync(path.join(__dirname,'../public/offline-shell.js'),path.join(root,'public/offline-shell.js'));
 const first=offlineShell(root);assert(!first.split('self.addEventListener')[0].includes('/api/'));
 fs.writeFileSync(path.join(root,'public/app.js'),'second');const second=offlineShell(root);assert.notEqual(first.match(/const CACHE_NAME=(.*);/)[1],second.match(/const CACHE_NAME=(.*);/)[1]);
 const handlers={},context={URL,Request,self:{location:{origin:'https://primary.test'},addEventListener:(name,fn)=>handlers[name]=fn}};vm.runInNewContext(second,context);
 for(const [url,method] of [['https://primary.test/api/config','GET'],['https://primary.test/api/licenses/id/asset','GET'],['https://primary.test/api/licenses/id/capture','POST'],['https://primary.test/app.js','POST'],['https://other.test/app.js','GET'],['https://primary.test/app.js?private=value','GET']]){
  let intercepted=false;handlers.fetch({request:new Request(url,{method}),respondWith:()=>{intercepted=true}});assert.equal(intercepted,false,url);
 }
});

test('a deployment crossing installation cannot replace the retained shell with mixed files',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ll-shell-integrity-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const pub=path.join(root,'public');fs.mkdirSync(pub);fs.writeFileSync(path.join(pub,'index.html'),'<script src="/app.js"></script>');fs.writeFileSync(path.join(pub,'app.js'),'original build');fs.copyFileSync(path.join(__dirname,'../public/offline-shell.js'),path.join(pub,'offline-shell.js'));
 const source=offlineShell(root);
 for(const changed of [true,false]){
  const handlers={},stored=new Map([['licenselane-shell-previous',new Map([['/','previous']])]]);let activated=false,pending;
  class BrowserRequest extends Request{constructor(input,options){super(new URL(input,'https://primary.test'),options);}}
  const context={URL,Request:BrowserRequest,Uint8Array,crypto:require('node:crypto').webcrypto,self:{location:{origin:'https://primary.test'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{activated=true}},caches:{open:async name=>{if(!stored.has(name))stored.set(name,new Map());return{put:async(key,response)=>stored.get(name).set(key,await response.text())};},delete:async name=>stored.delete(name)},fetch:async request=>{const file=new URL(request.url).pathname;return new Response(changed&&file==='/app.js'?'different deployment':fs.readFileSync(path.join(pub,file==='/'?'index.html':file.slice(1))));}};
  vm.runInNewContext(source,context);handlers.install({waitUntil:p=>pending=p});
  if(changed){await assert.rejects(pending,/Complete matching interface/);assert.equal(activated,false);assert.deepEqual([...stored.keys()],['licenselane-shell-previous']);}
  else{await pending;assert.equal(activated,true);assert.equal(stored.size,2);assert.equal([...stored.values()][1].size,3);}
 }
});

test('retained stylesheet fonts participate in shell identity without caching private image routes',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ll-shell-font-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const pub=path.join(root,'public');fs.mkdirSync(path.join(pub,'fonts'),{recursive:true});
 fs.writeFileSync(path.join(pub,'index.html'),'<link href="/gallery.css">');
 fs.writeFileSync(path.join(pub,'gallery.css'),'@font-face{font-family:Gallery;src:url("/fonts/Gallery.ttf")} .private{background:url("/api/licenses/private/preview")}');
 fs.writeFileSync(path.join(pub,'fonts/Gallery.ttf'),'first font');
 fs.copyFileSync(path.join(__dirname,'../public/offline-shell.js'),path.join(pub,'offline-shell.js'));
 const first=offlineShell(root),assets=JSON.parse(first.match(/const STATIC_ASSETS=(.*);/)[1]);
 assert.ok(assets['/fonts/Gallery.ttf']);assert.equal(assets['/api/licenses/private/preview'],undefined);
 fs.writeFileSync(path.join(pub,'fonts/Gallery.ttf'),'updated font');
 const second=offlineShell(root);assert.notEqual(first.match(/const CACHE_NAME=(.*);/)[1],second.match(/const CACHE_NAME=(.*);/)[1]);
 const handlers={},context={URL,Request,fetch:async()=>new Response('font'),self:{location:{origin:'https://primary.test'},addEventListener:(name,fn)=>handlers[name]=fn}};
 vm.runInNewContext(second,context);
 let intercepted=false;handlers.fetch({request:new Request('https://primary.test/fonts/Gallery.ttf'),respondWith:()=>{intercepted=true}});
 assert.equal(intercepted,true);
});
