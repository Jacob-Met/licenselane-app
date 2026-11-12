const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateProposal}=require('../lib/brief');
function copies(brief,raw={copies:null}){return validateProposal(brief,raw).fields.copies;}
test('retired print plan and confirmed zero',()=>{
 const brief='Marsh Studio — Autumn notices. Earlier plan, print 940 copies. Current confirmed order: use The Last Light on social media. No printed copies are needed. Include creator credit. Nonexclusive; no model training.';
 const c=copies(brief,{copies:null,medium:{value:'social',evidence:'social media'}});
 assert.equal(c?.value,0);assert.equal(c.evidence,'No printed copies are needed.');
 assert.equal(brief.slice(c.start,c.end),c.evidence);
});
test('explicit zero variants are source anchored and require confirmation',()=>{
 for(const phrase of ['We need zero physical copies.','Print 0 copies for this order.','No print run is needed.']){
  const r=validateProposal('Use our website. '+phrase,{copies:null});
  assert.equal(r.fields.copies?.value,0,phrase);
  assert.equal(r.fields.copies.evidence,phrase);
  assert.equal(r.applied,false);assert.equal(r.requiresHumanConfirmation,true);
 }
});
test('no zero from digital-only or training refusal',()=>{
 assert.equal(copies('Use our website for the campaign.'),null);
 assert.equal(copies('No AI training. Print 240 brochures.'),null);
 for(const phrase of ['Do not produce physical copies.','Do not print any flyers.','We will not order any printed copies.'])assert.equal(copies('Use on our website. '+phrase),null,phrase);
});
test('historical, conditional, unsettled and conflicting zero stays unknown',()=>{
 for(const phrase of ['Earlier plan: no printed copies.','If funding changes, no printed copies will be needed.','Whether no printed copies are needed is undecided.','Last year no printed copies were needed.']){
  assert.equal(copies('Use it on our website. '+phrase),null,phrase);
 }
 assert.equal(copies('Print 250 copies for this edition. No printed copies are needed.'),null);
 assert.equal(copies('Earlier plan: no printed copies. Print 250 copies for this order.'),null);
});
test('model numbers are not silently overwritten; withdrawn positive can be replaced',()=>{
 assert.equal(copies('Print 180 copies.',{copies:{value:180,evidence:'Print 180 copies.'}})?.value,180);
 const brief='Earlier plan, print 940 copies. Use social media now. No printed copies are needed.';
 assert.equal(copies(brief,{copies:{value:940,evidence:'print 940 copies'}})?.value,0);
});


test.skip('the full frozen Qwen buyer-brief replay stays correct',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const {decodeBriefResponse}=require('../lib/brief-request');
 const rows=fs.readFileSync(path.join(__dirname,'../docs/ai/source-candidates-r7m4/candidate.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const fields=['medium','copies','training','exclusive','attribution'];
 assert.equal(rows.length,32,'replay the full retained development course, not a selected subset');
 for(const row of rows){
  assert.equal(row.error,null,'genuine provider response is present for '+row.id);
  const raw=JSON.parse(row.provider.message?.content??row.provider.response);
  const result=validateProposal(row.brief,decodeBriefResponse(row.brief,raw));
  const actual=fields.map(field=>result.fields[field]?.value??null);
  assert.deepEqual(actual,row.expected,'retained real-model case: '+row.id);
  for(const item of Object.values(result.fields).filter(Boolean))
   assert.equal(row.brief.slice(item.start,item.end),item.evidence,row.id+' exact original source');
  assert.equal(result.applied,false);
  assert.equal(result.requiresHumanConfirmation,true);
 }
});


test('unseen zero source assertions reject quoted, questioned and competing alternatives',()=>{
 const cases=[
  ["Our actual plan is 250, not 'No printed copies are needed.'",null],
  ["No printed copies are needed?",null],
  ["The words 'No printed copies are needed' are our ad headline.",null],
  ["No printed copies are needed is a draft headline, not an approved decision.",null],
  ["We decided no printed copies are needed for this launch.",0],
  ["No printed copies are needed.",0],
  ["No printed copies are needed if we use the website.",null],
  ["No printed copies are needed. Our earlier plan mentioned 500 printed copies.",0],
  ["We earlier planned 500 printed copies. No printed copies are needed now.",0],
  ["The online edition needs no printed copies, while the print edition needs 200 printed copies.",null],
  ["We haven't decided whether no printed copies are needed.",null],
  ["No printed copies are needed in the current brief, but 250 were needed last year.",0],
  ["No physical copies for launch. Print 400 later only if budget allows.",0],
  ["No physical copies for launch. Print 400 for the bookstore edition.",null],
  ["A client asked whether no printed copies are needed; our count is undecided.",null]
 ];
 const mismatches=[];
 for(const [brief,expected] of cases){
  const item=copies(brief),actual=item?.value??null;
  if(actual!==expected)mismatches.push({brief,expected,actual});
  if(item)assert.equal(brief.slice(item.start,item.end),item.evidence,brief);
 }
 assert.deepEqual(mismatches,[]);
});

test('a directly model-proposed zero still needs a current, assertive source',()=>{
 const cases=[
  ["The words 'No printed copies are needed' are our ad headline.",null],
  ["No printed copies are needed?",null],
  ["We do not need any printed copies.",null],
  ["Do not produce physical copies.",null],
  ["Our actual plan is 250, not 'No printed copies are needed.'",null],
  ["Print 250 copies for this edition. No printed copies are needed.",null],
  ["No printed copies are needed.",0],
  ["Print 0 copies for this order.",0],
  ["Physical copies: 0.",0],
  ["No print copies are needed.",0],
  ["We decided no printed copies are needed for this launch.",0]
 ];
 for(const [brief,expected]of cases){
  const got=validateProposal(brief,{copies:{value:0,evidence:brief,start:0}}).fields.copies;
  assert.equal(got?.value??null,expected,brief);
 }
});
test('model evidence for a slogan cannot cite a different genuine zero choice',()=>{
 const brief="No printed copies are needed for the launch. The headline reads 'No printed copies are needed'.";
 const clipped="No printed copies are needed";
 const start=brief.lastIndexOf(clipped);
 const got=validateProposal(brief,{copies:{value:0,evidence:clipped,start}}).fields.copies;
 assert.equal(got,null);
 const legitimate="No printed copies are needed for the launch.";
 assert.equal(validateProposal(brief,{copies:{value:0,evidence:legitimate,start:0}}).fields.copies?.value,0);
});


test.skip('abandoned physical plans do not contradict an explicit current zero',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const frozen=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/ai/complete-scope-r7m4/fresh-complete-requests.json'),'utf8')).cases.find(c=>c.id==='r7m4-fresh-solstice');
 const result=copies(frozen.brief);
 assert.equal(result?.value,0);
 assert.equal(result.evidence,'Our current request is website use of The Last Light, with no printed copies.');
 assert.equal(frozen.brief.slice(result.start,result.end),result.evidence);
 for(const status of ['abandoned','discarded','scrapped','rejected','withdrawn']){
  for(const brief of [
   'No printed copies are needed. The '+status+' print plan called for 1,750 printed copies.',
   'The '+status+' print plan, print 1,750 copies. We need zero physical copies now.'
  ])assert.equal(copies(brief)?.value,0,brief);
 }
 const old='The abandoned print plan for 2,000 copies is not part of this request.';
 assert.equal(copies(frozen.brief,{copies:{value:2000,evidence:old}})?.value,0);
});
test('a negated retired label and another current quantity remain conflicts',()=>{
 for(const brief of [
  'No printed copies are needed. The not abandoned print plan requires 400 copies.',
  'No printed copies are needed. We never discarded the current order for 400 copies.',
  'The abandoned print plan called for 2,000 copies. No printed copies are needed. Print 400 copies for the confirmed order.',
  'The abandoned print plan called for 2,000 copies, but print 400 copies now. No printed copies are needed.',
  'The project is called Abandoned. Print 400 copies for the exhibition. No printed copies are needed.'
 ])assert.equal(copies(brief),null,brief);
 assert.equal(copies('The abandoned print plan called for 2,000 copies. Use our website.'),null);
 assert.equal(copies('The abandoned print plan called for 2,000 copies. Whether no printed copies are needed is undecided.'),null);
});
test.skip('the frozen abandoned-plan request needs no reference after a partial primary',async t=>{
 const {makeBriefExtractor}=require('../lib/brief'),{sourcePassages}=require('../lib/brief-request');
 const {createApp}=require('../server'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const course=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/ai/complete-scope-r7m4/fresh-complete-requests.json'),'utf8')).cases.find(c=>c.id==='r7m4-fresh-solstice');
 const passages=sourcePassages(course.brief),at=needle=>{const index=passages.findIndex(p=>p.text.includes(needle));assert.ok(index>=0);return index;};
 // Constructed partial provider response, not a recording of the primary wire.
 const primary={medium:{v:'website',s:at('Our current request')},copies:null,training:{v:false,s:at('no AI training')},exclusive:{v:false,s:at('nonexclusive permission')},attribution:{v:true,s:at('Creator credit')}};
 const calls=[],extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11541',BRIEF_REFERENCE_URL:'http://127.0.0.1:11542'},async url=>{
  calls.push(url);assert.equal(url,'http://127.0.0.1:11541/api/chat','An abandoned plan must not trigger another model pass');
  return {ok:true,json:async()=>({message:{content:JSON.stringify(primary)}})};
 });
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ll-abandoned-plan-'));
 const app=createApp({dataFile:path.join(dir,'licenses.json'),creatorCode:'',paypal:{configured:false},ai:{configured:false},briefExtractor:extractor});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));fs.rmSync(dir,{force:true,recursive:true});});
 const response=await fetch('http://127.0.0.1:'+app.address().port+'/api/brief',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify({brief:course.brief})});
 assert.equal(response.status,200);
 const records=(await response.text()).trim().split('\n').map(JSON.parse);
 assert.deepEqual(records.map(record=>record.type),['scope','partial','complete']);
 const result=records.at(-1).data;
 for(const [field,value]of Object.entries(course.expected)){
  assert.equal(result.fields[field]?.value,value,field);
  const item=result.fields[field];assert.equal(course.brief.slice(item.start,item.end),item.evidence);
 }
 assert.equal(calls.length,1);assert.equal(result.reference,undefined);
 assert.equal(result.applied,false);assert.equal(result.requiresHumanConfirmation,true);
});
