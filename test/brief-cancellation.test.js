'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server'),{makeBriefExtractor}=require('../lib/brief');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=1000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await delay(10);}throw Error('Expected cancellation did not reach the provider');}
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
const emptyFields={medium:null,copies:null,training:null,exclusive:null,attribution:null};
test('abandoned brief closes its real provider connection and releases the next request',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-brief-cancel-'));let active=false,requests=0,cancelled=false,firstStarted,normalClosedEarly=false;const queue=[],timers=new Set(),started=new Promise(r=>firstStarted=r);
 const provider=http.createServer((req,res)=>{req.resume();const n=++requests;let timer,finished=false;const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);timers.delete(timer);active=false;queue.shift()?.();};const run=()=>{active=true;if(n===1)firstStarted();timer=setTimeout(()=>{res.end(JSON.stringify({message:{content:JSON.stringify(emptyFields)}}));finish();},n===1?2000:40);timers.add(timer);};res.on('close',()=>{if(!res.writableEnded){if(n===1)cancelled=true;else normalClosedEarly=true;finish();}});if(active)queue.push(run);else run();});
 const endpoint=await listen(provider),app=createApp({dataFile:path.join(dir,'licenses.json'),creatorCode:'',paypal:{configured:false},ai:{configured:false},briefExtractor:makeBriefExtractor({OLLAMA_BRIEF_URL:endpoint})}),base=await listen(app);
 t.after(async()=>{for(const timer of timers)clearTimeout(timer);app.closeAllConnections();provider.closeAllConnections();await Promise.all([new Promise(r=>app.close(r)),new Promise(r=>provider.close(r))]);fs.rmSync(dir,{recursive:true,force:true});});
 const controller=new AbortController(),body=JSON.stringify({brief:'Print 400 visitor guides.'}),abandoned=fetch(base+'/api/brief',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:controller.signal}).catch(()=>null);
 await started;controller.abort();await abandoned;await until(()=>cancelled);
 const begin=Date.now(),response=await fetch(base+'/api/brief',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brief:'Print 600 visitor guides.'})}),result=await response.json(),elapsed=Date.now()-begin;
 assert.equal(response.status,200);assert.equal(result.requiresHumanConfirmation,true);assert.equal(requests,2);assert.equal(normalClosedEarly,false);assert.ok(elapsed<1000,'replacement must not wait behind the abandoned two-second request');
 console.log(JSON.stringify({course:'isolated serial HTTP provider',abandonedProviderConnectionClosed:cancelled,replacementWaitMs:elapsed,providerRequests:requests}));
});
test('already-cancelled brief never starts provider work',async()=>{
 let calls=0;const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:12345'},async()=>{calls++;throw Error('Should not be called');});
 const controller=new AbortController();controller.abort();
 await assert.rejects(extractor.extract('Print 600 visitor guides.',{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,0);
});
test('closing a payment client does not cancel or replay an in-flight capture',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-payment-close-'));let captures=0,entered,release,paid=false;
 const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const paypal={configured:true,async create(){return {id:'CANCELBOUNDARYORDER',links:[]};},async capture(){captures++;entered();await gate;paid=true;},async inspect(l){return {id:l.orderId,intent:'CAPTURE',status:paid?'COMPLETED':'APPROVED',purchase_units:[{custom_id:l.id,amount:{currency_code:'USD',value:'49.00'},payments:{captures:paid?[{id:'CANCELBOUNDARYCAPTURE',status:'COMPLETED',amount:{currency_code:'USD',value:'49.00'}}]:[]}}]};}};
 const app=createApp({dataFile:path.join(dir,'licenses.json'),creatorCode:'',paypal,ai:{configured:false},briefExtractor:{configured:false}}),base=await listen(app);
 t.after(async()=>{release();app.closeAllConnections();await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 const made=await post('/api/licenses',{creatorApproved:true,request:{assetId:'lantern-atlas',project:'Client disconnected after confirmation',licensee:'Cancellation course museum',medium:'website',copies:0,attribution:true}}),id=made.license.id;
 await post('/api/licenses/'+id+'/order',{});
 const controller=new AbortController(),capture=fetch(base+'/api/licenses/'+id+'/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:controller.signal}).catch(()=>null);
 await started;controller.abort();await capture;release();await until(()=>JSON.parse(fs.readFileSync(path.join(dir,'licenses.json'))).licenses[id].status==='issued');
 const record=await(await fetch(base+'/api/licenses/'+id)).json();assert.equal(record.license.captureId,'CANCELBOUNDARYCAPTURE');assert.equal(captures,1);assert.equal(record.license.status,'issued');
});

test('a second brief gets immediate feedback without joining the active provider request',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-brief-busy-'));let requests=0,firstResponse;
 const provider=http.createServer((req,res)=>{req.resume();requests++;if(requests===1){firstResponse=res;return;}res.end(JSON.stringify({message:{content:JSON.stringify(emptyFields)}}));});
 const endpoint=await listen(provider),app=createApp({dataFile:path.join(dir,'licenses.json'),creatorCode:'',paypal:{configured:false},ai:{configured:false},briefExtractor:makeBriefExtractor({OLLAMA_BRIEF_URL:endpoint})}),base=await listen(app);
 t.after(async()=>{app.closeAllConnections();provider.closeAllConnections();await Promise.all([new Promise(r=>app.close(r)),new Promise(r=>provider.close(r))]);fs.rmSync(dir,{recursive:true,force:true});});
 const post=()=>fetch(base+'/api/brief',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({brief:'Print600 visitor guides.'})});
 const first=post();await until(()=>firstResponse);
 const second=await post();assert.equal(second.status,503);assert.match((await second.json()).error,/already reading another brief/);assert.equal(requests,1);assert.equal(firstResponse.writableEnded,false);
 firstResponse.end(JSON.stringify({message:{content:JSON.stringify(emptyFields)}}));assert.equal((await first).status,200);
 assert.equal((await post()).status,200);assert.equal(requests,2);
});
test('provider failure releases brief occupancy for an explicit retry',async()=>{
 let calls=0;const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:12345'},async()=>{calls++;if(calls===1)throw Error('Provider unavailable');return {ok:true,json:async()=>({message:{content:JSON.stringify(emptyFields)}})};});
 await assert.rejects(extractor.extract('Print600 visitor guides.'),/Provider unavailable/);
 const result=await extractor.extract('Print600 visitor guides.');assert.equal(result.requiresHumanConfirmation,true);assert.equal(calls,2);
});
