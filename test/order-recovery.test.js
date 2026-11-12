'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {createApp}=require('../server');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-order-recovery-'));const calls={create:0,capture:0,inspect:0};let transform=x=>x;
 const paypal={configured:true,async create(){calls.create++;throw Error('Synthetic connection lost after create');},async capture(){calls.capture++;throw Error('Recovery must not capture');},async inspect(l){calls.inspect++;return transform({id:l.orderId,intent:'CAPTURE',status:'APPROVED',purchase_units:[{custom_id:l.id,amount:{currency_code:'USD',value:'49.00'}}],links:[]});}};
 const app=createApp({dataFile:path.join(dir,'db.json'),paypal,creatorCode:'test-code'});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const api=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+app.address().port+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return {code:r.status,data:await r.json()};};
 const approved=await api('/api/licenses',{creatorCode:'test-code',creatorApproved:true,request:{assetId:'lantern-atlas',licensee:'Recovery Buyer',project:'Exact original project',medium:'website',copies:0,attribution:true,exclusive:false,training:false}});assert.equal(approved.code,200);const id=approved.data.license.id;
 await api('/api/licenses/'+id+'/order',{creatorCode:'test-code'});
 return {api,id,calls,setTransform:f=>{transform=f;},recover:(orderId='EXISTINGORDER')=>api('/api/licenses/'+id+'/recover-order',{creatorCode:'test-code',orderId})};
}
test('recover matching approved order by inspection only and reject replacement',async t=>{
 const x=await fixture(t);const r=await x.recover();assert.equal(r.code,200);assert.equal(r.data.license.status,'awaiting_payment');assert.equal(r.data.license.orderId,'EXISTINGORDER');assert.equal(r.data.certificate,null);assert.deepEqual(x.calls,{create:1,capture:0,inspect:1});
 assert.equal((await x.recover('OTHERORDER')).code,409);assert.equal(x.calls.inspect,1);
});
test('reject mismatched identity, reference, amount, currency, intent and provider state without binding',async t=>{
 const x=await fixture(t);const transforms=[o=>({...o,id:'WRONGORDER'}),o=>({...o,intent:'AUTHORIZE'}),o=>({...o,status:'VOIDED'}),o=>{o.purchase_units[0].custom_id='another-license';return o;},o=>{o.purchase_units[0].amount.value='48.00';return o;},o=>{o.purchase_units[0].amount.currency_code='EUR';return o;},o=>({...o,status:'COMPLETED'}),o=>({...o,purchase_units:[...o.purchase_units,...o.purchase_units]})];
 for(const change of transforms){x.setTransform(change);assert.equal((await x.recover()).code,409);const saved=(await x.api('/api/licenses/'+x.id)).data.license;assert.equal(saved.status,'order_unknown');assert.equal(saved.orderId,null);}
 assert.equal(x.calls.capture,0);assert.equal(x.calls.create,1);
});
test('recover completed matching capture and issue original asset without capturing again',async t=>{
 const x=await fixture(t);x.setTransform(o=>{o.status='COMPLETED';o.purchase_units[0].payments={captures:[{id:'EXISTINGCAPTURE',status:'COMPLETED',amount:{currency_code:'USD',value:'49.00'}}]};return o;});
 const r=await x.recover();assert.equal(r.code,200);assert.equal(r.data.license.status,'issued');assert.equal(r.data.certificate.paypalCaptureId,'EXISTINGCAPTURE');assert.equal(x.calls.capture,0);assert.equal(x.calls.create,1);
});
test('creator authorization and order ID validation precede provider inspection',async t=>{
 const x=await fixture(t);assert.equal((await x.api('/api/licenses/'+x.id+'/recover-order',{orderId:'EXISTINGORDER'})).code,403);assert.equal((await x.recover('https://example.com/order')).code,400);assert.equal(x.calls.inspect,0);
});
