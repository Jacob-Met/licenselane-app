'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server'),{creatorInbox}=require('../lib/creator-inbox');
test('creator inbox authorizes reads and discovers a proposal without browser-local IDs; no mutation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-inbox-')),file=path.join(dir,'data.json'),app=createApp({dataFile:file,creatorCode:'test-creator-only',paypal:{configured:false},ai:{configured:false},briefExtractor:{configured:false}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.address().port;
 const post=async(p,body)=>{const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 try{const request={assetId:'lantern-atlas',licensee:'Island Press',project:'Winter coast',medium:'print',copies:390,attribution:true,exclusive:false,training:false};const license=(await post('/api/requests',{request})).data.license;const before=fs.readFileSync(file,'utf8');
 assert.equal((await post('/api/creator/inbox',{})).status,403);assert.equal((await post('/api/creator/inbox',{creatorCode:'wrong'})).status,403);
 const result=await post('/api/creator/inbox',{creatorCode:'test-creator-only',query:'island'});assert.equal(result.status,200);assert.equal(result.data.items.length,1);assert.equal(result.data.items[0].id,license.id);assert.equal(result.data.items[0].priceCents,6100);assert.equal(result.data.items[0].status,'requested');assert.equal(fs.readFileSync(file,'utf8'),before);
 assert.equal((await post('/api/creator/inbox',{creatorCode:'test-creator-only',query:'no match'})).data.total,0);assert.equal((await post('/api/creator/inbox',{creatorCode:'test-creator-only',status:'invented'})).status,400);
 }finally{await new Promise(r=>app.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('bounded stable pages and explicit projection exclude sensitive fields',()=>{
 const records={};for(let n=0;n<43;n++){const id=n.toString(16).padStart(64,'0');records[id]={id,createdAt:'2026-11-10T10:00:00Z',status:'requested',request:{project:'Guide '+n,licensee:'Archive',medium:'print',copies:n},quote:{assetTitle:'Map',priceCents:4900},buyerTokenHash:'DO-NOT-RETURN',approvalUrl:'DO-NOT-RETURN',paypalOrder:{secret:'DO-NOT-RETURN'}};}
 const a=creatorInbox(records),b=creatorInbox(records,{cursor:a.nextCursor});assert.equal(a.items.length,40);assert.equal(b.items.length,3);assert.equal(new Set([...a.items,...b.items].map(x=>x.id)).size,43);assert.equal(b.hasMore,false);assert.equal(JSON.stringify(a).includes('DO-NOT-RETURN'),false);assert.throws(()=>creatorInbox(records,{cursor:'bad'}),/Invalid/);assert.throws(()=>creatorInbox(records,{query:'x'.repeat(101)}),/100/);
});
test('creator payment triage separates uncertain outcomes from unpaid and issued records',()=>{
 const states=['requested','changes_requested','approved','awaiting_payment','creating_order','order_unknown','capture_unknown','issued'];
 const records=Object.fromEntries(states.map((status,n)=>{const id=n.toString(16).padStart(64,'0');return [id,{id,status,createdAt:'2026-11-10T10:00:00Z',request:{project:'Exhibition',licensee:'River Museum',medium:'website',copies:0},quote:{assetTitle:'Lantern Atlas',priceCents:4900},buyerTokenHash:'private',paypalOrder:{secret:'private'}}]}));
 assert.deepEqual(creatorInbox(records,{status:'payment_attention'}).items.map(x=>x.status).sort(),['capture_unknown','creating_order','order_unknown']);
 assert.deepEqual(creatorInbox(records,{status:'issued'}).items.map(x=>x.status),['issued']);
 assert.deepEqual(creatorInbox(records,{status:'awaiting_payment'}).items.map(x=>x.status),['awaiting_payment']);
 assert.equal(creatorInbox(records,{status:'payment_attention',query:'Museum'}).total,3);
 assert.equal(JSON.stringify(creatorInbox(records,{status:'payment_attention'})).includes('private'),false);
});

test('creator scope search and summaries preserve saved quote terms across revisions',()=>{
 const saved=(id,term,territory)=>({id,createdAt:'2026-11-11T10:00:00Z',status:'issued',request:{project:'Field guide',licensee:'Island Press',medium:'print',copies:390,termMonths:12,territory:'Worldwide'},quote:{assetTitle:'Atlas',priceCents:6100,term,territory}});
 const records={a:saved('a','6 months','France'),b:saved('b','3 months','Japan'),legacy:saved('legacy',undefined,undefined)};
 const france=creatorInbox(records,{status:'issued',query:'fRaNcE'});assert.equal(france.total,1);assert.equal(france.items[0].term,'6 months');assert.equal(france.items[0].territory,'France');
 assert.deepEqual(creatorInbox(records,{status:'issued',query:'3 months'}).items.map(x=>x.id),['b']);
 const legacy=creatorInbox(records,{status:'issued'}).items.find(x=>x.id==='legacy');assert.equal(legacy.term,null);assert.equal(legacy.territory,null);
 assert.equal(creatorInbox(records,{status:'issued',query:'Worldwide'}).total,0);
});
