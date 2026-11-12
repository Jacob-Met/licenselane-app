'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server');
test('private buyer capability authorizes only its approved record and never creator approval',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-buyer-'));let orders=0,captures=0,paid=false;
 const paypal={configured:true,async create(){orders++;return {id:'TESTORDER',links:[]};},async capture(){captures++;paid=true;},async inspect(l){return {id:l.orderId,intent:'CAPTURE',status:paid?'COMPLETED':'APPROVED',purchase_units:[{custom_id:l.id,amount:{currency_code:'USD',value:(l.quote.priceCents/100).toFixed(2)},payments:{captures:paid?[{id:'TESTCAPTURE',status:'COMPLETED',amount:{currency_code:'USD',value:'85.00'}}]:[]}}]};}};
 const app=createApp({dataFile:path.join(dir,'licenses.json'),creatorCode:'creator-only',paypal,ai:{configured:false},briefExtractor:{configured:false}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
 const api=async(url,body)=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  const request={assetId:'lantern-atlas',licensee:'Estuary Press',project:'Tidal handbook',medium:'print',copies:1200,exclusive:false,training:false,attribution:true};
  const saved=await api('/api/requests',{request}),other=await api('/api/requests',{request:{...request,project:'Other book'}});
  const token=saved.data.buyerAccessToken,url='/api/licenses/'+saved.data.license.id;
  assert.match(token,/^[a-f0-9]{64}$/);assert.notEqual(token,other.data.buyerAccessToken);assert.equal(saved.data.license.buyerTokenHash,undefined);
  assert.equal((await api(url+'/approve',{buyerAccessToken:token,creatorApproved:true})).status,403);
  assert.equal((await api(url+'/order',{buyerAccessToken:token})).status,409);assert.equal(orders,0);
  const snapshot=await api(url);assert.equal(snapshot.data.buyerAccessToken,undefined);assert.ok(!JSON.stringify(snapshot).includes(token));assert.equal(snapshot.data.license.buyerTokenHash,undefined);
  assert.equal((await api(url+'/buyer-access',{buyerAccessToken:other.data.buyerAccessToken})).status,403);
  assert.equal((await api(url+'/buyer-access',{buyerAccessToken:token})).status,200);assert.equal(orders,0);
  await api(url+'/approve',{creatorCode:'creator-only',creatorApproved:true});
  assert.equal((await api(url+'/order',{})).status,403);
  assert.equal((await api(url+'/order',{buyerAccessToken:other.data.buyerAccessToken})).status,403);
  assert.equal((await api(url+'/order',{buyerAccessToken:token})).status,200);assert.equal(orders,1);
  assert.equal((await api(url+'/capture',{})).status,403);
  const issued=await api(url+'/capture',{buyerAccessToken:token});assert.equal(issued.status,200);assert.equal(issued.data.license.status,'issued');assert.equal(captures,1);
  assert.equal((await api(url+'/capture',{buyerAccessToken:token})).data.license.status,'issued');assert.equal(captures,1);
  const disk=fs.readFileSync(path.join(dir,'licenses.json'),'utf8');assert.ok(!disk.includes(token));assert.ok(disk.includes('buyerTokenHash'));
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('a read-only reference cannot use local-demo fallback for a buyer-owned record',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-local-buyer-'));const app=createApp({dataFile:path.join(dir,'licenses.json'),creatorCode:'',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
 const post=async(url,body)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const r=await post('/api/requests',{request:{assetId:'lantern-atlas',licensee:'Local Museum',project:'Local guide',medium:'website',copies:0,exclusive:false,training:false,attribution:true}}),saved=await r.json(),url='/api/licenses/'+saved.license.id;
  assert.equal((await post(url+'/approve',{creatorApproved:true})).status,200);
  assert.equal((await post(url+'/order',{})).status,403);
  assert.equal((await post(url+'/order',{buyerAccessToken:'0'.repeat(64)})).status,403);
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('approved buyer reconnects only its own matching lost-create order',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-buyer-recovery-'));let creates=0,captures=0;
 const app=createApp({dataFile:path.join(dir,'db.json'),creatorCode:'creator-test',paypal:{configured:true,async create(){creates++;throw Error('Synthetic lost response');},async capture(){captures++;},async inspect(l){return {id:l.orderId,intent:'CAPTURE',status:'APPROVED',purchase_units:[{custom_id:l.orderId==='WRONGORDER'?'other':l.id,amount:{currency_code:'USD',value:'49.00'}}]};}},ai:{configured:false},briefExtractor:{configured:false}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
 const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{
  const saved=await post('/api/requests',{request:{assetId:'lantern-atlas',licensee:'Canal Museum',project:'Canal site',medium:'website',copies:0,attribution:true}}),url='/api/licenses/'+saved.data.license.id,token=saved.data.buyerAccessToken;
  await post(url+'/approve',{creatorCode:'creator-test',creatorApproved:true});
  assert.equal((await post(url+'/order',{buyerAccessToken:token})).data.license.status,'order_unknown');
  assert.equal((await post(url+'/recover-order',{orderId:'MATCHORDER'})).status,403);
  assert.equal((await post(url+'/recover-order',{orderId:'MATCHORDER',buyerAccessToken:'0'.repeat(64)})).status,403);
  assert.equal((await post(url+'/recover-order',{orderId:'WRONGORDER',buyerAccessToken:token})).status,409);
  const fixed=await post(url+'/recover-order',{orderId:'MATCHORDER',buyerAccessToken:token});assert.equal(fixed.status,200);assert.equal(fixed.data.license.status,'awaiting_payment');assert.equal(fixed.data.license.orderId,'MATCHORDER');assert.equal(creates,1);assert.equal(captures,0);
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
