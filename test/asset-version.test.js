'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {createApp,normalize,quote,POLICY}=require('../server');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
test('upgrading directly from the old Atlas retains its approved file while new buyers receive the new edition',async()=>{
  const previousHash='649d0daee02bb0822ada72200856db8d149348648f91523418ac04d29bfb3e17';
  const previous=fs.readFileSync(path.join(__dirname,'../assets/versions',previousHash));
  const current=fs.readFileSync(path.join(__dirname,'../public/assets/lantern-atlas.svg'));
  assert.equal(sha(previous),previousHash);
  assert.notEqual(sha(current),previousHash);
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'licenselane-edition-'));
  const dataFile=path.join(folder,'licenses.json');
  const request=normalize({assetId:'lantern-atlas',project:'A previously approved atlas',licensee:'Coastal Studio',medium:'website',copies:0,attribution:true,training:false,exclusive:false});
  const legacy={id:'a'.repeat(64),request,quote:quote(request),status:'approved',createdAt:'2026-11-09T12:00:00.000Z',orderId:null,captureId:null,
    assetDelivery:{filename:'lantern-atlas.svg',mime:'image/svg+xml',bytes:previous.length,sha256:previousHash},policySnapshot:POLICY.map(p=>({...p}))};
  fs.writeFileSync(dataFile,JSON.stringify({licenses:{[legacy.id]:legacy}}));
  // The provider here is explicitly a test adapter; no actual payment is asserted.
  let captured=false;
  const paypal={configured:true,async create(){return {id:'TESTOLDEDITION01',links:[]};},
    async capture(){captured=true;return {status:'COMPLETED'};},
    async inspect(l){return {id:l.orderId,intent:'CAPTURE',status:captured?'COMPLETED':'APPROVED',purchase_units:[{custom_id:l.id,amount:{currency_code:'USD',value:(l.quote.priceCents/100).toFixed(2)},payments:{captures:captured?[{id:'TEST-CAPTURE',status:'COMPLETED',amount:{currency_code:'USD',value:(l.quote.priceCents/100).toFixed(2)}}]:[]}}]};}};
  const server=createApp({dataFile,paypal,creatorCode:'',ai:{configured:false}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const post=async(route,body)=>{const r=await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();};
  try{
    assert.deepEqual(fs.readFileSync(path.join(folder,'approved-assets',previousHash)),previous);
    assert.equal((await fetch(origin+'/api/licenses/'+legacy.id+'/asset')).status,409,'retaining a file does not issue a license');
    const fresh=await post('/api/licenses',{request:{...request,project:'A newly approved atlas'},creatorApproved:true});
    assert.equal(fresh.license.assetDelivery.sha256,sha(current));
    const checkout=await post('/api/licenses/'+legacy.id+'/order',{});
    assert.equal(checkout.license.status,'awaiting_payment');
    const issued=await post('/api/licenses/'+legacy.id+'/capture',{});
    assert.equal(issued.certificate.asset.sha256,previousHash);
    const download=await fetch(origin+'/api/licenses/'+legacy.id+'/asset');
    assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),previous);
    const preview=await fetch(origin+'/assets/lantern-atlas.svg');
    assert.equal(preview.status,200);assert.deepEqual(Buffer.from(await preview.arrayBuffer()),current);
  }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true});}
});
