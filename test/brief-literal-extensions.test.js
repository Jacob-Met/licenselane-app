'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {makeBriefExtractor}=require('../lib/brief');
const keys=['medium','copies','training','exclusive','attribution'];
const primary={message:{content:JSON.stringify(Object.fromEntries(keys.map(key=>[key,null])))}};
const extract=async(brief,withReference=true)=>{
 let calls=0;
 const env={OLLAMA_BRIEF_URL:'http://127.0.0.1:11541',...(withReference?{BRIEF_REFERENCE_URL:'http://127.0.0.1:11542'}:{})};
 const result=await makeBriefExtractor(env,async url=>{
  calls++;
  assert.equal(url,'http://127.0.0.1:11541/api/chat','An explicit, confirmed source should not require another model');
  return{ok:true,json:async()=>primary};
 }).extract(brief);
 for(const item of Object.values(result.fields))if(item)assert.equal(brief.slice(item.start,item.end),item.evidence);
 assert.equal(result.applied,false);
 assert.equal(result.requiresHumanConfirmation,true);
 return {values:keys.map(key=>result.fields[key]?.value??null),calls,result};
};
test('a buyer can license printed posters without paying for a second inference',async()=>{
 const {values,calls}=await extract('License Harbor Tide for 247 printed posters for the gallery. No AI training. The artist must be credited.');
 assert.deepEqual(values,['print',247,false,null,true]);assert.equal(calls,1);
});
test('a buyer can reproduce physical cards without re-reading the brief',async()=>{
 const {values,calls}=await extract('Please reproduce 73 printed cards for the confirmed museum edition. We need nonexclusive rights.');
 assert.deepEqual(values,['print',73,null,false,null]);assert.equal(calls,1);
});
test('literal refusals and credited creator remain separate, editable permissions',async()=>{
 const {values,calls}=await extract('Do not allow AI training. The client does not request exclusivity. The artist must be credited.');
 assert.deepEqual(values,[null,null,false,false,true]);assert.equal(calls,1);
});
test('an explicit website instruction survives a partial primary response',async()=>{
 const {values,calls}=await extract('Please publish Harbor Tide on our website. No AI training.');
 assert.deepEqual(values,['website',null,false,null,null]);assert.equal(calls,1);
});
test('an expressly requested social media post is not treated as a future idea',async()=>{
 const {values,calls}=await extract('Only a social media post is requested for the exhibit. Creator credit is included.');
 assert.deepEqual(values,['social',null,null,null,true]);assert.equal(calls,1);
});
test('a current digital conflict never forces a medium',async()=>{
 const {values}=await extract('Please publish on our website. Please post on social media too.',false);
 assert.deepEqual(values,[null,null,null,null,null]);
});
test('print and website uses do not silently choose one',async()=>{
 const {values}=await extract('Please publish Harbor Tide on our website. Print 73 printed cards for the gallery too.',false);
 assert.deepEqual(values,[null,73,null,null,null]);
});
test('opposed physical counts need buyer resolution',async()=>{
 const {values}=await extract('Print 20 printed cards. Print 30 printed cards.',false);
 assert.deepEqual(values,['print',null,null,null,null]);
});
for(const [name,brief] of [
 ['withdrawn','Our previous order was to license 300 printed posters, but it was cancelled.'],
 ['historical','The festival had 300 printed posters in 2024.'],
 ['hypothetical','What if we license 300 printed posters someday?'],
 ['research','We want a price comparison for 300 printed posters, not a purchase.'],
 ['conditional','We could license 300 printed posters, but no current use is confirmed.']
])test('a '+name+' plan cannot become a current license',async()=>{
 const {values}=await extract(brief,false);assert.deepEqual(values,[null,null,null,null,null]);
});
test('the buyer HTTP entry returns a complete quote without waiting for an unused reference',async t=>{
 const {createApp}=require('../server'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-brief-literal-'));
 const brief='Please reproduce 73 printed cards for the confirmed museum edition. We need nonexclusive rights. No AI training. Artist must be credited. The agreed license term is 6 months. The requested territory is Germany.';
 let calls=0;
 const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11541',BRIEF_REFERENCE_URL:'http://127.0.0.1:11542'},async url=>{
  calls++;assert.equal(url,'http://127.0.0.1:11541/api/chat');return {ok:true,json:async()=>primary};
 });
 const app=createApp({dataFile:path.join(dir,'licenses.json'),creatorCode:'',paypal:{configured:false},ai:{configured:false},briefExtractor:extractor});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));fs.rmSync(dir,{force:true,recursive:true});});
 const response=await fetch('http://127.0.0.1:'+app.address().port+'/api/brief',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify({brief})});
 assert.equal(response.status,200);
 const records=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.deepEqual(records.map(r=>r.type),['scope','partial','complete']);
 const result=records.at(-1).data;
 assert.deepEqual(keys.map(k=>result.fields[k]?.value??null),['print',73,false,false,true]);
 assert.equal(result.fields.termMonths.value,6);assert.equal(result.fields.territory.value,'Germany');
 assert.equal(calls,1);assert.equal(result.requiresHumanConfirmation,true);assert.equal(result.applied,false);
});

for(const [name,brief,expected] of [
 ['passive required printed posters',
  'The exhibition requires 247 printed posters. AI training is expressly prohibited. Exclusive rights are prohibited. Artist credit must be included.',
  ['print',247,false,false,true]],
 ['print-run and imperative permission refusals',
  'A print run of 247 printed posters is required for the gallery. Prohibit AI training and exclusivity. Credit the artist.',
  ['print',247,false,false,true]],
 ['required quantity and coordinated prohibition',
  'Required quantity: 247 printed cards. AI training and exclusivity are prohibited. The artist must be credited.',
  ['print',247,false,false,true]],
])test(name+' stays with one local model request and original source',async()=>{
 const {values,calls}=await extract(brief);
 assert.deepEqual(values,expected);
 assert.equal(calls,1);
});

for(const [name,brief] of [
 ['not required','The gallery does not require 247 printed posters.'],
 ['passive not required','The 247 printed posters are not required.'],
 ['conditional','The gallery would require 247 printed posters if funding succeeds. AI training is prohibited in that hypothetical plan.'],
 ['cancelled','The earlier request required 247 printed posters but was cancelled.'],
 ['conditional paired rights','AI training and exclusivity are prohibited if the board eventually approves that plan.'],
 ['future prohibited rights','Prohibit AI training and exclusivity in the proposed future edition.']
])test(name+' does not silently become an approved scope',async()=>{
 const {values}=await extract(brief,false);
 assert.deepEqual(values,[null,null,null,null,null]);
});


test.skip('unavailable primary keeps mixed-use copy counts without suggesting print as the only current use',async()=>{
 const rows=require('node:fs').readFileSync(require('node:path').join(__dirname,'../docs/ai/complete-scope-r7m4/consistent-request/retained-five-fields.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 for(const id of ['v8p2-social-plus-confirmed-print','mixed-print-website']){
  const row=rows.find(row=>row.id===id);assert.ok(row,id);
  let calls=0;
  const result=await require('../lib/brief').makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11541'},async()=>{calls++;return {ok:false,status:503};}).extract(row.brief);
  assert.equal(calls,1);assert.equal(result.sourceOnly,true);assert.equal(result.model,null);
  assert.equal(result.fields.medium,null,id);
  assert.equal(result.fields.copies.value,id==='mixed-print-website'?275:185,id);
  assert.equal(result.fields.territory,null,id);
  assert.equal(result.modelCosts.primary.state,'unavailable');assert.equal(result.modelCosts.reference,null);
  assert.equal(result.requiresHumanConfirmation,true);assert.equal(result.applied,false);
  for(const field of Object.values(result.fields))if(field)assert.equal(row.brief.slice(field.start,field.end),field.evidence);
 }
});

test('uncertain, refused, retired and quoted digital alternatives do not erase a confirmed print-only use',async()=>{
 for(const other of [
  'Whether a website edition will follow is undecided.',
  'We will not use the artwork on our website.',
  'Our earlier plan was to use the artwork on social media.',
  'The title is "Our Website".'
 ]){
  const brief='Use the artwork for 185 printed invitations. '+other;
  const result=await require('../lib/brief').makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11541'},async()=>({ok:false,status:503})).extract(brief);
  assert.equal(result.fields.medium.value,'print',brief);assert.equal(result.fields.copies.value,185,brief);
 }
});

test('multiple recognized current uses still require the buyer to choose which use to review',async()=>{
 const brief='Use the artwork on our website and in 185 printed invitations.';
 const result=await require('../lib/brief').makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11541'},async()=>({ok:false,status:503})).extract(brief);
 assert.equal(result.fields.medium,null);assert.equal(result.fields.copies.value,185);
 assert.equal(result.sourceOnly,true);assert.equal(result.applied,false);
});

test('ordinary buyer wording yields useful quoted choices during a model outage',async()=>{
 const cases=[
  ['Print 240 posters for the festival. Credit the artist. No AI training. Nonexclusive rights.', ['print',240,false,false,true]],
  ['Order 175 flyers for the exhibition. Name the illustrator in the footer.', ['print',175,null,null,true]],
  ['Please post the artwork on our social media channels. Credit the creator.', ['social',null,null,null,true]],
  ['Publish the illustration on our social media feed. No model training.', ['social',null,false,null,null]],
  ['Please put the illustration on our website. Nonexclusive rights.', ['website',null,null,false,null]],
  ['Our website will feature the illustration. Credit the artist.', ['website',null,null,null,true]],
  ['Please display the artwork on the museum website. No AI training.', ['website',null,false,null,null]]
 ];
 for(const [brief,expected] of cases){
  let calls=0;
  const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11541'},async()=>{calls++;return{ok:false,status:503};});
  const response=await extractor.extract(brief);
  assert.equal(calls,1,brief);
  assert.equal(response.sourceOnly,true,brief);
  assert.equal(response.applied,false);
  assert.equal(response.requiresHumanConfirmation,true);
  assert.deepEqual(keys.map(key=>response.fields[key]?.value??null),expected,brief);
  for(const field of Object.values(response.fields))if(field)assert.equal(brief.slice(field.start,field.end),field.evidence);
 }
});
test('ordinary wording keeps hypothetical and denied uses out of the buyer proposal',async()=>{
 const cases=[
  ['Please display the work on our website and share it on social media.', [null,null,null,null,null]],
  ['Print 150 posters and post the image on our social media feed.', [null,150,null,null,null]],
  ['Print 60 posters for this season, but we might post it online next year.', ['print',60,null,null,null]],
  ['We will not print 100 posters, but please place the image on our website.', ['website',null,null,null,null]],
  ['Do not print 100 posters, but share it on our social media feed.', ['social',null,null,null,null]],
  ['If ticket sales grow, print 300 posters for the future exhibit.', [null,null,null,null,null]],
  ['The previously cancelled order was for 120 flyers; we are now using it on our website.', [null,null,null,null,null]],
  ['Do not print 200 posters.', [null,null,null,null,null]],
  ['Would you put this on our website next year?', [null,null,null,null,null]],
  ['Perhaps post this on our social media channel.', [null,null,null,null,null]],
  ['Print 140 posters or 240 flyers.', [null,null,null,null,null]]
 ];
 for(const [brief,expected] of cases){
  const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11541'},async()=>({ok:false,status:503}));
  if(expected.every(value=>value===null)){
   await assert.rejects(()=>extractor.extract(brief),/Local model could not extract/);
   continue;
  }
  const response=await extractor.extract(brief);
  assert.deepEqual(keys.map(key=>response.fields[key]?.value??null),expected,brief);
  assert.equal(response.applied,false);
  for(const field of Object.values(response.fields))if(field)assert.equal(brief.slice(field.start,field.end),field.evidence);
 }
});
test('the buyer HTTP endpoint offers the common print scope without inference or a write',async t=>{
 const {createApp}=require('../server'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ll-common-print-'));
 const brief='Print 240 posters for the festival. Credit the artist. No AI training. Nonexclusive rights. License duration: three months. Territory: Germany.';
 const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11541'},async()=>({ok:false,status:503}));
 const app=createApp({dataFile:path.join(directory,'licenses.json'),creatorCode:'',paypal:{configured:false},ai:{configured:false},briefExtractor:extractor});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
 const response=await fetch('http://127.0.0.1:'+app.address().port+'/api/brief',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify({brief})});
 assert.equal(response.status,200);
 const events=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.deepEqual(events.map(event=>event.type),['scope','partial','complete']);
 const result=events.at(-1).data;
 assert.deepEqual(keys.map(key=>result.fields[key]?.value??null),['print',240,false,false,true]);
 assert.equal(result.fields.termMonths.value,3);
 assert.equal(result.fields.territory.value,'Germany');
 assert.equal(result.sourceOnly,true);assert.equal(result.requiresHumanConfirmation,true);assert.equal(result.applied,false);
});

test('the original quoted choices are usable before model dispatch, and cancelling skips inference',async()=>{
 const brief='Print 240 posters for the festival. Credit the artist. No AI training. Nonexclusive rights.';
 const controller=new AbortController();
 let dispatched=0,previews=[];
 const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11541'},async()=>{
  dispatched++;throw Error('Cancelled before dispatch should not reach the provider');
 });
 await assert.rejects(extractor.extract(brief,{signal:controller.signal,onProgress:preview=>{
  previews.push(preview);
  assert.equal(preview.earlySource,true);
  assert.equal(preview.requiresHumanConfirmation,true);
  assert.equal(preview.applied,false);
  assert.deepEqual(keys.map(key=>preview.fields[key]?.value??null),['print',240,false,false,true]);
  controller.abort();
 }}),{name:'AbortError'});
 assert.equal(previews.length,1);assert.equal(dispatched,0);
});
test('the live buyer endpoint streams source choices while its provider is still working',async t=>{
 const {createApp}=require('../server'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-brief-live-source-'));
 const brief='Print 240 posters for the festival. Credit the artist. No AI training. Nonexclusive rights. License duration: three months. Territory: Germany.';
 let unblock,providerCompleted=false;
 const held=new Promise(resolve=>unblock=resolve);
 t.after(()=>unblock());
 const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11541'},async()=>{
  await held;providerCompleted=true;return{ok:false,status:503};
 });
 const app=createApp({dataFile:path.join(dir,'licenses.json'),creatorCode:'',paypal:{configured:false},ai:{configured:false},briefExtractor:extractor});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
 const response=await fetch('http://127.0.0.1:'+app.address().port+'/api/brief',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify({brief})});
 assert.equal(response.status,200);
 const reader=response.body.getReader(),state={buffer:'',decoder:new TextDecoder()};
 async function nextRecord(){
  while(!state.buffer.includes('\n')){const part=await reader.read();assert.equal(part.done,false);state.buffer+=state.decoder.decode(part.value,{stream:true});}
  const cut=state.buffer.indexOf('\n'),line=state.buffer.slice(0,cut);state.buffer=state.buffer.slice(cut+1);return JSON.parse(line);
 }
 const scope=await nextRecord();assert.equal(scope.type,'scope');
 const early=await nextRecord();assert.equal(early.type,'partial');
 assert.equal(providerCompleted,false);
 assert.equal(early.data.earlySource,true);
 assert.deepEqual(keys.map(key=>early.data.fields[key]?.value??null),['print',240,false,false,true]);
 assert.equal(early.data.fields.termMonths.value,3);
 assert.equal(early.data.fields.territory.value,'Germany');
 for(const field of Object.values(early.data.fields))if(field)assert.equal(brief.slice(field.start,field.end),field.evidence);
 unblock();
 const completed=await nextRecord();
 assert.equal(completed.type,'complete');
 assert.equal(providerCompleted,true);
 assert.equal(completed.data.sourceOnly,true);
 assert.deepEqual(keys.map(key=>completed.data.fields[key]?.value??null),['print',240,false,false,true]);
 assert.equal((await reader.read()).done,true);
});

test('a refused digital publication never erases a confirmed, independently quoted medium',async()=>{
 const cases=[
  ['Do not display the image on our website. Please print 120 posters for this event.', 'print',120],
  ['We will not feature the illustration on our website. Please print 120 posters.','print',120],
  ['Do not place the art on our website. Print 120 posters.','print',120],
  ['Do not upload the artwork to our website. Print 120 posters.','print',120],
  ['Do not show the artwork on our website. Print 120 posters.','print',120],
  ['Do not share the work on our social media feed. Publish the illustration on our website.','website',null],
  ['The website is excluded. Please publish the illustration to our social media feed.','social',null],
  ['Website use is disallowed. Please post the work on our social media account.','social',null],
  ['Publish the art on our website. Do not print 90 posters.','website',null],
  ['Print 80 flyers for the festival. We might post it on our website next summer.','print',80]
 ];
 for(const [brief,medium,copies]of cases){
  const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11541'},async()=>({ok:false,status:503}));
  let partial;
  const actual=await extractor.extract(brief,{onProgress:value=>partial=value});
  assert.equal(actual.sourceOnly,true);
  assert.equal(actual.fields.medium?.value??null,medium,brief);
  assert.equal(actual.fields.copies?.value??null,copies,brief);
  assert.equal(partial.fields.medium?.value??null,medium,brief+' early preview');
  for(const field of Object.values(actual.fields))if(field)assert.equal(brief.slice(field.start,field.end),field.evidence);
 }
});
test('direct model evidence cannot promote an explicitly refused channel',()=>{
 const examples=[
  ['Do not display the art on our website.','website'],
  ['We will not feature the art on our website.','website'],
  ['Do not place the art on our website.','website'],
  ['The website is excluded.','website'],
  ['Website use is disallowed.','website'],
  ['Do not share the work on social media.','social'],
  ['We will not show the work on our social feed.','social'],
  ['Do not upload the image to our website.','website']
 ];
 const {validateProposal}=require('../lib/brief'),{sourcePassages}=require('../lib/brief-request');
 for(const [brief,value]of examples){
  const passage=sourcePassages(brief)[0];
  const response=validateProposal(brief,{medium:{value,evidence:passage.text,start:passage.start}});
  assert.equal(response.fields.medium,null,brief);
 }
});
