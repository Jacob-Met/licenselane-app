'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createApp}=require('../server');
test('waiting status reads avoid original-file processing and expose only the current decision',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ll-status-')),app=createApp({dataFile:path.join(root,'licenses.json'),creatorCode:'local-status-test',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true});});const base='http://127.0.0.1:'+app.address().port;
 const saved=await(await fetch(base+'/api/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request:{assetId:'the-tidal-archive',licensee:'Status museum',project:'Decision observation',medium:'website',copies:0,attribution:true,termMonths:3,territory:'France',startsOn:'2090-01-01'}})})).json();assert.equal(saved.license.status,'requested');const url=base+'/api/licenses/'+saved.license.id;
 let artworkBytes=0;const read=fs.readFileSync;fs.readFileSync=function(file,...args){const result=read.call(this,file,...args);if(String(file).includes('/public/assets/')&&String(file).endsWith('.zip'))artworkBytes+=result.length;return result;};
 try{
  assert.equal((await fetch(url)).status,200);assert(artworkBytes>0,'ordinary record display checks the current original');const fullReadBytes=artworkBytes;
  artworkBytes=0;const status=await(await fetch(url+'/status')).json();assert.deepEqual(status,{id:saved.license.id,status:'requested'});assert.equal(artworkBytes,0);
  const approval=await fetch(url+'/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({creatorCode:'local-status-test',creatorApproved:true})});assert.equal(approval.status,200);artworkBytes=0;assert.deepEqual(await(await fetch(url+'/status')).json(),{id:saved.license.id,status:'approved'});assert.equal(artworkBytes,0);t.diagnostic('Original bytes avoided per unchanged poll: '+fullReadBytes);
 }finally{fs.readFileSync=read;}
});
