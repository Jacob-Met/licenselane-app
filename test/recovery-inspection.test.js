'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp,certificate}=require('../server');
async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ll-inspect-')),dataFile=path.join(root,'data','licenses.json'),receipts=path.join(root,'receipts');let server;
 async function start(extra={}){server=createApp({dataFile,creatorCode:'test',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false},...extra});await new Promise(r=>server.listen(0,'127.0.0.1',r));}
 async function stop(){await new Promise(r=>server.close(r));}
 function api(route,body){return fetch('http://127.0.0.1:'+server.address().port+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
 await start();
 let response=await api('/api/requests',{request:{assetId:'lantern-atlas',licensee:'Museum Reader',project:'Recovery study',medium:'print',copies:30,attribution:true}});
 assert.equal(response.status,200);const created=await response.json();await stop();
 const data=JSON.parse(fs.readFileSync(dataFile)),l=data.licenses[created.license.id];Object.assign(l,{status:'capture_unknown',orderId:'ORDER123'});fs.writeFileSync(dataFile,JSON.stringify(data));
 let calls=0;
 let order={id:l.orderId,intent:'CAPTURE',status:'COMPLETED',purchase_units:[{custom_id:l.id,amount:{currency_code:'USD',value:(l.quote.priceCents/100).toFixed(2)},payments:{captures:[{id:'CAPTURE123',status:'COMPLETED',amount:{currency_code:'USD',value:(l.quote.priceCents/100).toFixed(2)}}]}}]};
 const options={recoveryOnly:true,recoveryOrigin:'https://original.test',recoveryReceiptsDirectory:receipts,recoveryInspector:{inspect:async record=>{calls++;assert.equal(record.orderId,l.orderId);return order;}}};
 await start(options);
 t.after(async()=>{await stop();fs.rmSync(root,{recursive:true,force:true});});
 return {root,dataFile,receipts,l,api,calls:()=>calls,setOrder:value=>order=value,order:()=>structuredClone(order),restart:async()=>{await stop();await start(options);},stop,start};
}
test('authenticated recovery survives restart and checkpoint replacement without changing retained data',async t=>{
 const f=await setup(t),url='/api/licenses/'+f.l.id,before=fs.readFileSync(f.dataFile);
 assert.equal((await f.api(url+'/asset')).status,409);
 const config=await(await f.api('/api/config')).json();assert.equal(config.recoveryPaymentCheckConfigured,true);assert.equal(config.paypalConfigured,false);
 const response=await f.api(url+'/check-payment',{});assert.equal(response.status,200,await response.clone().text());
 const paid=(await response.json()).license;assert.equal(paid.status,'issued');assert.equal(paid.receiptVersion,2);assert.equal(f.calls(),1);
 const terms=await(await f.api(url+'/terms')).text(),cert=await(await f.api(url+'/certificate')).json();
 assert.equal((await f.api(url+'/asset')).status,200);
 assert.deepEqual(fs.readFileSync(f.dataFile),before);
 await f.restart();fs.writeFileSync(f.dataFile,before);
 assert.equal((await(await f.api(url)).json()).license.status,'issued');
 assert.equal(await(await f.api(url+'/terms')).text(),terms);
 assert.deepEqual((await(await f.api(url+'/certificate')).json()),cert);
 assert.equal((await f.api(url+'/check-payment',{})).status,200);assert.equal(f.calls(),1);
 // Primary's later issuance uses its own audit clock but the same canonical terms.
 const current=JSON.parse(before);current.licenses[f.l.id]={...f.l,status:'issued',receiptVersion:2,captureId:'CAPTURE123',issuedAt:'2030-01-01T00:00:00Z'};fs.writeFileSync(f.dataFile,JSON.stringify(current));
 assert.equal(await(await f.api(url+'/terms')).text(),terms);
 assert.deepEqual((await(await f.api(url+'/certificate')).json()),cert);
 for(const action of ['order','capture','reconcile','recover-order'])assert.equal((await f.api(url+'/'+action,{})).status,423);
 current.licenses[f.l.id]={...f.l,request:{...f.l.request,project:'Different project'}};fs.writeFileSync(f.dataFile,JSON.stringify(current));
 assert.equal((await f.api(url+'/asset')).status,409,'receipt never grants changed retained agreement');
});
test('only a completed full-price capture bound to the retained order and license grants a file',async t=>{
 const f=await setup(t),url='/api/licenses/'+f.l.id;
 const invalid=[
  o=>o.id='OTHER',o=>o.intent='AUTHORIZE',o=>o.status='APPROVED',
  o=>o.purchase_units[0].custom_id='other',o=>o.purchase_units[0].amount.value='0.01',
  o=>o.purchase_units[0].payments.captures[0].amount.currency_code='EUR',
  o=>o.purchase_units[0].payments.captures[0].amount.value='0.01',
  o=>o.purchase_units[0].payments.captures[0].status='PENDING',
  o=>o.purchase_units.push(structuredClone(o.purchase_units[0]))
 ];
 const valid=f.order();
 for(const mutate of invalid){const order=structuredClone(valid);mutate(order);f.setOrder(order);await f.restart();assert.equal((await f.api(url+'/check-payment',{})).status,409);assert.equal((await f.api(url+'/asset')).status,409);assert.equal(fs.readdirSync(f.receipts).length,0);}
});
test('legacy receipt preserves verifiedAt while new receipt excludes local observation times',()=>{
 const base={id:'a'.repeat(64),status:'issued',orderId:'ORDER',captureId:'CAPTURE',issuedAt:'2025-01-01T00:00:00Z',quote:{},request:{}};
 assert.equal(certificate(base).verifiedAt,base.issuedAt);
 const newer={...base,receiptVersion:2};
 assert.deepEqual(certificate(newer),certificate({...newer,issuedAt:'2030-01-01T00:00:00Z'}));
 assert.equal(certificate(newer).verifiedAt,undefined);assert.equal(certificate(newer).paypalOrderId,'ORDER');
});
