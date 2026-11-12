'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createApp}=require('../server');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-payment-binding-'));let transform=o=>o;let captures=0;
 const paypal={configured:true,create:async()=>({id:'BOUNDORDER',links:[]}),capture:async()=>{captures++;throw Error('Synthetic lost capture response');},inspect:async l=>transform({id:l.orderId,intent:'CAPTURE',status:'COMPLETED',purchase_units:[{custom_id:l.id,amount:{currency_code:'USD',value:'49.00'},payments:{captures:[{id:'BOUNDCAPTURE',status:'COMPLETED',amount:{currency_code:'USD',value:'49.00'}}]}}]})};
 const app=createApp({dataFile:path.join(dir,'db.json'),paypal,creatorCode:''});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const api=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+app.address().port+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {code:r.status,data:await r.json()};};
 const r=await api('/api/licenses',{creatorApproved:true,request:{assetId:'lantern-atlas',licensee:'Binding buyer',project:'Bound original project',medium:'website',copies:0,attribution:true}});assert.equal(r.code,200);const route='/api/licenses/'+r.data.license.id;
 await api(route+'/order',{});return {api,route,change:f=>{transform=f;},captures:()=>captures};
}
const mutations={identity:o=>({...o,id:'OTHERORDER'}),intent:o=>({...o,intent:'AUTHORIZE'}),amount:o=>{o.purchase_units[0].amount.value='48.00';return o;},currency:o=>{o.purchase_units[0].amount.currency_code='EUR';return o;},reference:o=>{o.purchase_units[0].custom_id='other-license';return o;},extraUnit:o=>({...o,purchase_units:[...o.purchase_units,...o.purchase_units]})};
for(const [name,mutate] of Object.entries(mutations))test('capture and reconciliation refuse '+name+' mismatch, then recover exact order without another capture',async t=>{
 const x=await fixture(t);x.change(mutate);
 const capture=await x.api(x.route+'/capture',{});assert.equal(capture.code,200);assert.equal(capture.data.license.status,'capture_unknown');assert.equal(capture.data.certificate,null);
 const inspect=await x.api(x.route+'/reconcile',{});assert.equal(inspect.data.license.status,'capture_unknown');assert.equal((await x.api(x.route+'/certificate')).code,409);
 x.change(o=>mutate({...o,status:'APPROVED'}));const retry=await x.api(x.route+'/reconcile',{});assert.equal(retry.data.license.status,'capture_unknown','unbound approval must not unlock another capture');assert.equal((await x.api(x.route+'/capture',{})).code,409);
 x.change(o=>o);const recovered=await x.api(x.route+'/reconcile',{});assert.equal(recovered.data.license.status,'issued');assert.equal(recovered.data.certificate.paypalCaptureId,'BOUNDCAPTURE');assert.equal(x.captures(),1);
});
// Verification uses GET /v2/checkout/orders/{id}, not the capture POST response.
// Provider shape: https://developer.paypal.com/api/orders/v2/orders-get
for(const state of ['PENDING','PARTIAL'])test(state+' capture remains unresolved until exact completed receipt is inspected',async t=>{
 const x=await fixture(t);x.change(o=>{const capture=o.purchase_units[0].payments.captures[0];if(state==='PENDING')capture.status='PENDING';else capture.amount.value='20.00';return o;});
 const initial=await x.api(x.route+'/capture',{});assert.equal(initial.data.license.status,'capture_unknown');assert.equal(initial.data.certificate,null);
 assert.equal((await x.api(x.route+'/reconcile',{})).data.license.status,'capture_unknown');
 x.change(o=>o);assert.equal((await x.api(x.route+'/reconcile',{})).data.license.status,'issued');assert.equal(x.captures(),1);
});
test('exact APPROVED order permits explicit retry after unresolved capture',async t=>{
 const x=await fixture(t);x.change(o=>({...o,status:'APPROVED'}));
 assert.equal((await x.api(x.route+'/capture',{})).data.license.status,'capture_unknown');
 assert.equal((await x.api(x.route+'/reconcile',{})).data.license.status,'awaiting_payment');
 x.change(o=>o);assert.equal((await x.api(x.route+'/capture',{})).data.license.status,'issued');assert.equal(x.captures(),2);
});
test('authentication failure before Orders POST preserves approval and permits one later order',async t=>{
 const {makePayPal}=require('../server');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-preflight-'));let authFails=true,orders=0;
 const paypal=makePayPal({PAYPAL_CLIENT_ID:'synthetic-client',PAYPAL_CLIENT_SECRET:'synthetic-secret'},async(url)=>{
  if(url.endsWith('/v1/oauth2/token'))return {ok:!authFails,status:401,json:async()=>({access_token:'synthetic-token'})};
  assert.ok(url.endsWith('/v2/checkout/orders'));orders++;return {ok:true,json:async()=>({id:'RETRYORDER',links:[]})};
 });
 const app=createApp({dataFile:path.join(dir,'db.json'),paypal,creatorCode:''});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const post=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+app.address().port+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);return r.json();};
 const saved=await post('/api/licenses',{creatorApproved:true,request:{assetId:'lantern-atlas',licensee:'Preflight buyer',project:'Authenticated original project',medium:'website',copies:0,attribution:true}});const route='/api/licenses/'+saved.license.id+'/order';
 const failed=await post(route,{});assert.equal(failed.license.status,'approved');assert.equal(failed.license.orderId,null);assert.equal(orders,0);assert.match(failed.license.lastError,/authentication failed/);
 authFails=false;const retried=await post(route,{});assert.equal(retried.license.status,'awaiting_payment');assert.equal(retried.license.orderId,'RETRYORDER');assert.equal(retried.license.lastError,undefined);assert.equal(orders,1);
 await post(route,{});assert.equal(orders,1);
});
