'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server');
test('capture waits for its uncertain state off worker and recovered intent only inspects the original payment',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-checkpoint-')),dataFile=path.join(dir,'licenses.json'),statusFile=path.join(dir,'latest.json'),requestFile=path.join(dir,'request.json');
 let captures=0,paid=false,lastRetained=null,retainedIntentData;
 const paypal={configured:true,async create(){return {id:'CHECKPOINTORDER',links:[]};},async capture(){assert.equal(lastRetained?.status,'capture_unknown','off-worker state must require inspection after loss');captures++;paid=true;},async inspect(l){return {id:l.orderId,intent:'CAPTURE',status:paid?'COMPLETED':'APPROVED',purchase_units:[{custom_id:l.id,amount:{currency_code:'USD',value:'49.00'},payments:{captures:paid?[{id:'CHECKPOINTCAPTURE',status:'COMPLETED',amount:{currency_code:'USD',value:'49.00'}}]:[]}}]};}};
 const options={dataFile,paypal,creatorCode:'',ai:{configured:false},briefExtractor:{configured:false},checkpointOptions:{statusFile,requestFile,timeoutMs:250,pollMs:5}};
 const app=createApp(options);await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
 let restored;
 t.after(async()=>{await new Promise(r=>app.close(r));if(restored)await new Promise(r=>restored.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const call=async(origin,route,body)=>{const r=await fetch(origin+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {code:r.status,body:await r.json()};};
 const api=(route,body)=>call(base,route,body);
 const made=await api('/api/licenses',{creatorApproved:true,request:{assetId:'lantern-atlas',project:'Checkpoint interruption study',licensee:'Recovery test museum',medium:'website',copies:0,attribution:true}});assert.equal(made.code,200);const id=made.body.license.id,prefix='/api/licenses/'+id;
 await api(prefix+'/order',{});
 const before=await api(prefix+'/capture',{});assert.equal(before.code,503);assert.match(before.body.error,/Payment was not sent/);assert.equal(captures,0);assert.equal(before.body.code,'RECOVERY_CHECKPOINT_PENDING');const blocked=(await api(prefix)).body.license;assert.equal(blocked.captureBlocked,'recovery_pending');assert.equal(blocked.orderId,'CHECKPOINTORDER');assert.equal(JSON.parse(fs.readFileSync(dataFile)).licenses[id].captureBlocked,'recovery_pending');
 function acknowledge(){const data=JSON.parse(fs.readFileSync(dataFile));lastRetained=structuredClone(data.licenses[id]);fs.writeFileSync(statusFile,JSON.stringify({state:'replicated',record_versions:{[id]:lastRetained.recoveryVersion}}));return data;}
 const awaiting=acknowledge().licenses[id];assert.equal(awaiting.status,'awaiting_payment');
 const oldOnly=await api(prefix+'/capture',{});assert.equal(oldOnly.code,503,'retained order alone must not authorize capture');assert.equal(captures,0);
 const captureRequest=api(prefix+'/capture',{});
 const deadline=Date.now()+1500;
 while(Date.now()<deadline){const current=JSON.parse(fs.readFileSync(dataFile)).licenses[id];if(current.status==='capture_unknown'&&current.recoveryVersion!==awaiting.recoveryVersion)break;await new Promise(r=>setTimeout(r,5));}
 retainedIntentData=acknowledge();assert.equal(retainedIntentData.licenses[id].status,'capture_unknown');assert.equal(retainedIntentData.licenses[id].captureBlocked,undefined);
 const captured=await captureRequest;assert.equal(captured.code,200);assert.equal(captured.body.license.status,'issued');assert.equal(captured.body.license.captureBlocked,undefined);assert.equal(captured.body.license.recovery.state,'pending');assert.equal(captured.body.license.captureId,'CHECKPOINTCAPTURE');assert.equal(captures,1);assert.equal(captured.body.license.recoveryVersion,undefined);
 assert.equal(captured.body.certificate===null,true,'an unretained issued certificate must not be delivered');
 for(const asset of ['asset','terms','certificate','purchase'])assert.equal((await fetch(base+prefix+'/'+asset)).status,503,'paid delivery waits for the issued checkpoint: '+asset);
 const repeated=await api(prefix+'/capture',{});assert.equal(repeated.body.license.status,'issued');assert.equal(repeated.body.license.recovery.state,'pending');assert.equal(captures,1);
 const reopened=await api(prefix);assert.equal(reopened.body.license.status,'issued');assert.equal(reopened.body.license.orderId,'CHECKPOINTORDER');assert.equal(reopened.body.license.recovery.state,'pending');
 acknowledge();const ready=await api(prefix);assert.equal(ready.body.license.recovery.state,'ready');assert.equal(captures,1);
 const bytes=await fetch(base+prefix+'/asset');assert.equal(bytes.status,200);
 const restoredDir=path.join(dir,'restored');fs.mkdirSync(restoredDir);const restoredFile=path.join(restoredDir,'licenses.json');fs.writeFileSync(restoredFile,JSON.stringify(retainedIntentData));
 if(fs.existsSync(path.join(dir,'approved-assets')))fs.cpSync(path.join(dir,'approved-assets'),path.join(restoredDir,'approved-assets'),{recursive:true});
 restored=createApp({...options,dataFile:restoredFile,checkpointOptions:{statusFile:path.join(restoredDir,'latest.json'),requestFile:path.join(restoredDir,'request.json'),timeoutMs:25,pollMs:5}});
 await new Promise(r=>restored.listen(0,'127.0.0.1',r));const restoredOrigin='http://127.0.0.1:'+restored.address().port;
 const recovered=await call(restoredOrigin,prefix);assert.equal(recovered.body.license.status,'capture_unknown');
 const replay=await call(restoredOrigin,prefix+'/capture',{});assert.equal(replay.code,409);assert.equal(captures,1);
 const inspected=await call(restoredOrigin,prefix+'/reconcile',{});assert.equal(inspected.code,200);assert.equal(inspected.body.license.status,'issued');assert.equal(inspected.body.license.captureId,'CHECKPOINTCAPTURE');assert.equal(captures,1);
});

test('restored pre-capture checkpoint resolves the same paid order without another capture',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-restored-order-')),dataFile=path.join(dir,'licenses.json');
 let app,captures=0,creates=0,inspections=0,paid=false,mismatch=false,base;
 const paypal={configured:true,async create(){creates++;return {id:'RESTOREDORDER',links:[]};},async capture(){captures++;paid=true;},async inspect(l){inspections++;return {id:l.orderId,intent:'CAPTURE',status:paid?'COMPLETED':'APPROVED',purchase_units:[{custom_id:mismatch?'wrong':l.id,amount:{currency_code:'USD',value:'49.00'},payments:{captures:paid?[{id:'RESTOREDCAPTURE',status:'COMPLETED',amount:{currency_code:'USD',value:'49.00'}}]:[]}}]};}};
 async function start(extra={}){app=createApp({dataFile,paypal,creatorCode:'test-code',ai:{configured:false},briefExtractor:{configured:false},...extra});await new Promise(r=>app.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.address().port;}
 t.after(async()=>{if(app)await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const api=async(route,body)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {code:r.status,body:await r.json()};};
 await start();const originalOrigin=base;
 const made=await api('/api/requests',{request:{assetId:'lantern-atlas',project:'Original approved restoration project',licensee:'Restoration museum',medium:'website',copies:0,attribution:true}});
 const id=made.body.license.id,token=made.body.buyerAccessToken,prefix='/api/licenses/'+id;
 await api(prefix+'/approve',{creatorApproved:true,creatorCode:'test-code'});
 await api(prefix+'/order',{buyerAccessToken:token});
 const beforeCapture=fs.readFileSync(dataFile),approved=JSON.parse(beforeCapture).licenses[id];
 assert.equal((await api(prefix+'/capture',{buyerAccessToken:token})).body.license.status,'issued');assert.equal(captures,1);
 const original=Buffer.from(await(await fetch(base+prefix+'/asset')).arrayBuffer());
 await new Promise(r=>app.close(r));app=null;fs.writeFileSync(dataFile,beforeCapture);
 await start({restoredOrigin:originalOrigin,restorationId:'a'.repeat(64)});
 assert.equal((await api('/api/config')).body.restoredOrigin,originalOrigin);
 assert.equal((await api(prefix)).body.license.restoration.state,'inspection_required');
 assert.equal((await api(prefix+'/capture',{buyerAccessToken:token})).code,409);assert.equal(captures,1);
 assert.equal((await api(prefix+'/reconcile',{buyerAccessToken:'0'.repeat(64)})).code,403);
 mismatch=true;assert.equal((await api(prefix+'/reconcile',{buyerAccessToken:token})).code,409);
 assert.equal((await api(prefix)).body.license.restoration.state,'inspection_required');
 mismatch=false;const resolved=await api(prefix+'/reconcile',{buyerAccessToken:token});
 assert.equal(resolved.body.license.status,'issued');assert.equal(resolved.body.license.captureId,'RESTOREDCAPTURE');assert.deepEqual(resolved.body.license.request,approved.request);assert.deepEqual(resolved.body.license.quote,approved.quote);
 assert.deepEqual(Buffer.from(await(await fetch(base+prefix+'/asset')).arrayBuffer()),original);
 assert.equal((await api(prefix+'/capture',{buyerAccessToken:token})).body.license.status,'issued');
 assert.equal(creates,1);assert.equal(captures,1);assert.equal(inspections,3);
 assert.equal(resolved.body.license.restorationChecked,undefined);
});
