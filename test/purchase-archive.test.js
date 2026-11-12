'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {purchaseArchive}=require('../lib/purchase-archive');
const {createApp}=require('../server');

// Read the central directory, then use its offsets to inspect the local records.
// The delivered ZIP is also extracted with a separate ZIP implementation in the
// actual-browser receiving course.
function entries(zip){
  const end=zip.length-22;assert.equal(zip.readUInt32LE(end),0x06054b50);
  const count=zip.readUInt16LE(end+10),start=zip.readUInt32LE(end+16);
  assert.equal(start+zip.readUInt32LE(end+12),end);
  let at=start;const result=new Map();
  for(let i=0;i<count;i++){
    assert.equal(zip.readUInt32LE(at),0x02014b50);assert.equal(zip.readUInt16LE(at+10),0);
    assert.equal(zip.readUInt16LE(at+8)&0x800,0x800);
    const size=zip.readUInt32LE(at+24),nameLength=zip.readUInt16LE(at+28);
    const name=zip.subarray(at+46,at+46+nameLength).toString('utf8'),offset=zip.readUInt32LE(at+42);
    assert.equal(zip.readUInt32LE(offset),0x04034b50);
    assert.equal(zip.readUInt32LE(offset+14),zip.readUInt32LE(at+16));
    assert.equal(zip.readUInt32LE(offset+22),size);
    const localName=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28);
    assert.equal(zip.subarray(offset+30,offset+30+localName).toString('utf8'),name);
    result.set(name,zip.subarray(offset+30+localName+extra,offset+30+localName+extra+size));
    at+=46+nameLength+zip.readUInt16LE(at+30)+zip.readUInt16LE(at+32);
  }
  assert.equal(at,end);assert.equal(result.size,count);return result;
}
test('purchase ZIP retains Unicode filenames, exact contents and stable bytes',()=>{
  const input={original:Buffer.from('123456789'),filename:'東京 spring.png',terms:{filename:'LicenseLane-example-terms.txt',download:Buffer.from('Exact terms\n')},certificate:{certificateId:'LL-EXAMPLE',project:'Print study',integritySha256:'a'.repeat(64),sandboxOnly:true}};
  const zip=purchaseArchive(input),files=entries(zip);
  assert.deepEqual([...files.keys()],['original/東京 spring.png','LicenseLane-example-terms.txt','LL-EXAMPLE.json','LL-EXAMPLE-certificate.html']);
  assert.deepEqual(files.get('original/東京 spring.png'),input.original);
  assert.equal(zip.readUInt32LE(14),0xcbf43926,'standard CRC-32 check vector');
  assert.deepEqual(files.get(input.terms.filename),input.terms.download);
  assert.equal(files.get('LL-EXAMPLE.json').toString(),JSON.stringify(input.certificate,null,2));
  assert.deepEqual(purchaseArchive(input),zip);
  for(const filename of ['../outside.png','/absolute.png','a\\b.png','line\nname.png']){
    assert.throws(()=>purchaseArchive({...input,filename}),/filename/);
  }
});
test('issued purchase downloads match individual files and the recovery reader',async t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ll-purchase-')),dataFile=path.join(folder,'licenses.json'),servers=[];
  let captures=0,orders=0;const paid=new Set();
  const paypal={configured:true,async create(l){orders++;return {id:'ORDER'+l.id.slice(0,12).toUpperCase(),links:[]};},async capture(l){captures++;paid.add(l.id);},async inspect(l){return {id:l.orderId,intent:'CAPTURE',status:paid.has(l.id)?'COMPLETED':'APPROVED',purchase_units:[{custom_id:l.id,amount:{currency_code:'USD',value:(l.quote.priceCents/100).toFixed(2)},payments:{captures:paid.has(l.id)?[{id:'CAPTURE'+l.id.slice(0,12).toUpperCase(),status:'COMPLETED',amount:{currency_code:'USD',value:(l.quote.priceCents/100).toFixed(2)}}]:[]}}]};}};
  async function start(extra={}){const server=createApp({dataFile,paypal,creatorCode:'',checkpoint:null,ai:{configured:false},briefExtractor:{configured:false},...extra});servers.push(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
  t.after(async()=>{for(const server of servers)await new Promise(r=>server.close(r));fs.rmSync(folder,{recursive:true,force:true});});
  const primary=await start(),recovery=await start({recoveryOnly:true,recoveryOrigin:'https://original.example'});
  const post=async(route,body)=>{const response=await fetch(primary+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const bodyText=await response.text();assert.equal(response.status,200,route+' '+bodyText);return JSON.parse(bodyText);};
  for(const assetId of ['lantern-atlas','blue-hour','copper-signal']){
    const made=await post('/api/licenses',{creatorApproved:true,request:{assetId,project:'Portable purchase study',licensee:'Example studio',medium:'website',copies:0,attribution:true,brief:'Retain this exact buyer brief.'}});
    const prefix='/api/licenses/'+made.license.id;
    assert.equal((await fetch(primary+prefix+'/purchase')).status,409);
    await post(prefix+'/order',{});
    assert.equal((await fetch(primary+prefix+'/purchase')).status,409);
    const issued=await post(prefix+'/capture',{});
    const response=await fetch(primary+prefix+'/purchase');assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'application/zip');assert.equal(response.headers.get('cache-control'),'no-store');
    const zip=Buffer.from(await response.arrayBuffer()),files=entries(zip);
    assert.equal(files.size,4);
    const original=Buffer.from(await(await fetch(primary+prefix+'/asset')).arrayBuffer());
    const terms=Buffer.from(await(await fetch(primary+prefix+'/terms')).arrayBuffer());
    assert.deepEqual(files.get('original/'+issued.license.assetDelivery.filename),original);
    assert.deepEqual(files.get('LicenseLane-'+made.license.id.slice(0,12)+'-terms.txt'),terms);
    assert.equal(files.get(issued.certificate.certificateId+'.json').toString(),JSON.stringify(issued.certificate,null,2));
    assert.ok(files.get(issued.certificate.certificateId+'-certificate.html').toString().includes(issued.certificate.integritySha256));
    const recovered=await fetch(recovery+prefix+'/purchase');assert.equal(recovered.status,200);
    assert.deepEqual(Buffer.from(await recovered.arrayBuffer()),zip);
    if(assetId==='copper-signal')assert.equal(original.readUInt32LE(0),0x04034b50,'an original ZIP stays intact inside the purchase');
    const retained=path.join(folder,'approved-assets',issued.license.assetDelivery.sha256);
    fs.writeFileSync(retained,'damaged retained test original');
    assert.equal((await fetch(primary+prefix+'/purchase')).status,409);
    assert.equal((await fetch(recovery+prefix+'/purchase')).status,409);
  }
  assert.equal(orders,3);assert.equal(captures,3);
});
