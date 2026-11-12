'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const scope=require('../public/license-scope'),{createApp,normalize,quote,certificate}=require('../server');
const baseRequest={assetId:'lantern-atlas',licensee:'Calendar museum',project:'Dated exhibition',medium:'website',copies:0,attribution:true,termMonths:1,territory:'France'};
test('calendar periods preserve the agreed dates across shorter months and leap years',()=>{
 assert.deepEqual(scope.period('2027-01-31',1),{startsOn:'2027-01-31',endsBefore:'2027-03-01',endsOn:'2027-02-28',timeZone:'UTC'});
 assert.equal(scope.period('2028-01-31',1).endsOn,'2028-02-29');assert.equal(scope.period('2028-02-29',12).endsOn,'2029-02-28');
 assert.equal(scope.period('2028-01-01',1).endsOn,'2028-01-31');assert.equal(scope.period('2028-04-30',1).endsOn,'2028-05-29');
 for(const value of ['',null,'2027-02-29','2028-13-01','2028-04-31','2028-1-1'])assert.throws(()=>scope.date(value));
 assert.equal(scope.period(undefined,12),null);const p=scope.period('2028-01-31',1);assert.equal(scope.periodState(p,'2028-01-30'),'upcoming');assert.equal(scope.periodState(p,'2028-02-29'),'current');assert.equal(scope.periodState(p,'2028-03-01'),'ended');
});
test('dated and legacy quotes remain distinct without inventing a legacy commencement',()=>{
 const legacy=quote(normalize(baseRequest));assert.equal(legacy.period,undefined);assert.equal(legacy.policyVersion,'1.1');
 const request=normalize({...baseRequest,startsOn:'2090-01-31'}),q=quote(request);assert.equal(request.startsOn,'2090-01-31');assert.equal(q.period.endsOn,'2090-02-28');assert.equal(q.policyVersion,'1.2');assert.equal(q.priceCents,legacy.priceCents);
 assert.throws(()=>normalize({...baseRequest,startsOn:''}),/start date/);assert.equal(quote(normalize({...baseRequest,startsOn:'2000-01-01'})).eligible,false);
});
test('approved period stays bound through save retry, capture and stable certificate recovery',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ll-period-')),dataFile=path.join(root,'licenses.json');let creates=0,captures=0;
 const paypal={configured:true,async create(){creates++;return {id:'PERIODORDER',links:[]};},async capture(){captures++;},async inspect(l){return {id:l.orderId,intent:'CAPTURE',status:'COMPLETED',purchase_units:[{custom_id:l.id,amount:{currency_code:'USD',value:'49.00'},payments:{captures:[{id:'PERIODCAPTURE',status:'COMPLETED',amount:{currency_code:'USD',value:'49.00'}}]}}]};}};
 const app=createApp({dataFile,creatorCode:'local-only',paypal,ai:{configured:false},briefExtractor:{configured:false}});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true});});const base='http://127.0.0.1:'+app.address().port;
 const api=async(route,body)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 const body={request:{...baseRequest,startsOn:'2090-01-31'},saveKey:'a'.repeat(64)};const saved=await api('/api/requests',body);assert.equal(saved.status,200);const id=saved.body.license.id,token=saved.body.buyerAccessToken,prefix='/api/licenses/'+id;
 assert.equal((await api('/api/requests',body)).body.license.id,id);assert.equal((await api('/api/requests',{...body,request:{...body.request,startsOn:'2090-02-01'}})).status,409);
 const approved=await api(prefix+'/approve',{creatorCode:'local-only',creatorApproved:true});assert.deepEqual(approved.body.license.quote.period,saved.body.license.quote.period);
 await api(prefix+'/order',{buyerAccessToken:token});const paid=await api(prefix+'/capture',{buyerAccessToken:token});assert.equal(paid.body.license.status,'issued');assert.equal(creates,1);assert.equal(captures,1);assert.deepEqual(paid.body.certificate.period,saved.body.license.quote.period);
 const original=paid.body.certificate.integritySha256;const record=JSON.parse(fs.readFileSync(dataFile)).licenses[id];record.issuedAt='2091-05-01T00:00:00.000Z';assert.equal(certificate(record).integritySha256,original);
 const terms=await(await fetch(base+prefix+'/terms')).text();assert.match(terms,/Start date: 2090-01-31/);assert.match(terms,/Last included date: 2090-02-28/);
 // A previously approved dated record can reach its end while awaiting payment.
 const data=JSON.parse(fs.readFileSync(dataFile));const expired={...data.licenses[id],id:'b'.repeat(64),status:'approved',orderId:null,captureId:null,request:{...body.request,startsOn:'2000-01-01'},quote:{...saved.body.license.quote,period:scope.period('2000-01-01',1)}};data.licenses[expired.id]=expired;fs.writeFileSync(dataFile,JSON.stringify(data));
 assert.equal((await api('/api/licenses/'+expired.id+'/order',{buyerAccessToken:token})).status,409);assert.equal(creates,1);
 expired.status='awaiting_payment';expired.orderId='EXPIREDORDER';data.licenses[expired.id]=expired;fs.writeFileSync(dataFile,JSON.stringify(data));assert.equal((await api('/api/licenses/'+expired.id+'/capture',{buyerAccessToken:token})).status,409);assert.equal(captures,1);
});
test('a period ending during recovery retention blocks capture without losing the existing order',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ll-period-boundary-')),dataFile=path.join(root,'licenses.json');let day='2090-02-28',captures=0,waits=0;
 const paypal={configured:true,async create(){return {id:'BOUNDARYORDER',links:[]};},async capture(){captures++;throw Error('Must not dispatch after the agreed end');},async inspect(){throw Error('No provider inspection expected');}};
 const checkpoint={acknowledged:()=>true,async wait(){waits++;day='2090-03-01';return true;}};
 const app=createApp({dataFile,creatorCode:'local-only',paypal,checkpoint,calendarDate:()=>day,ai:{configured:false},briefExtractor:{configured:false}});await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.close(r));fs.rmSync(root,{recursive:true,force:true});});const base='http://127.0.0.1:'+app.address().port;
 const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const saved=await post('/api/requests',{request:{...baseRequest,startsOn:'2090-01-31'},saveKey:'c'.repeat(64)});assert.equal(saved.status,200);const prefix='/api/licenses/'+saved.body.license.id,authority={buyerAccessToken:saved.body.buyerAccessToken};
 assert.equal((await post(prefix+'/approve',{creatorCode:'local-only',creatorApproved:true})).status,200);assert.equal((await post(prefix+'/order',authority)).status,200);
 const capture=await post(prefix+'/capture',authority);assert.equal(capture.status,409);assert.match(capture.body.error,/agreed use period has ended/);assert.equal(waits,1);assert.equal(captures,0);
 const current=JSON.parse(fs.readFileSync(dataFile)).licenses[saved.body.license.id];assert.equal(current.status,'awaiting_payment');assert.equal(current.orderId,'BOUNDARYORDER');assert.equal(current.quote.period.endsOn,'2090-02-28');
});
