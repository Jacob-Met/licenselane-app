'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildBriefRequest,decodeBriefResponse,sourcePassages}=require('../lib/brief-request');
const {validateProposal,makeBriefExtractor}=require('../lib/brief');

test('new model request asks for grounded scope in the existing seven-field response',()=>{
 const brief='License the illustration for one year in France. We will credit the artist.';
 const old=buildBriefRequest(brief,'qwen3.5:4b');
 const current=buildBriefRequest(brief,'qwen3.5:4b',{includeScope:true});
 assert.deepEqual(old.format.required,['medium','copies','training','exclusive','attribution']);
 assert.deepEqual(current.format.required,[...old.format.required,'termMonths','territory']);
 assert.ok(current.format.properties.termMonths.anyOf[1].properties.s.enum.includes(0));
 assert.ok(current.format.properties.territory.anyOf[1].properties.s.enum.includes(0));
 assert.equal(current.options.num_predict,384);
 assert.match(current.messages[0].content,/LICENSE DURATION/);
 const parsed=decodeBriefResponse(brief,{termMonths:{v:12,s:0},territory:{v:'France',s:0}});
 const result=validateProposal(brief,parsed);
 assert.equal(result.fields.termMonths.value,12);
 assert.equal(result.fields.territory.value,'France');
 for(const field of ['termMonths','territory']){
  const p=result.fields[field];
  assert.equal(brief.slice(p.start,p.end),p.evidence);
 }
 assert.equal(result.applied,false);
 assert.equal(result.requiresHumanConfirmation,true);
});

test('current duration and territory survive earlier withdrawn scope and retain whole source',()=>{
 const brief='Old draft: use in Germany for two years. Current request: license the artwork in France for six months.';
 const old='Old draft: use in Germany for two years.';
 const current='Current request: license the artwork in France for six months.';
 const result=validateProposal(brief,{
  termMonths:{value:6,evidence:current},
  territory:{value:'France',evidence:current}
 });
 assert.equal(result.fields.termMonths.value,6);
 assert.equal(result.fields.territory.value,'France');
 assert.equal(validateProposal(brief,{termMonths:{value:24,evidence:old}}).fields.termMonths,null);
 assert.equal(validateProposal(brief,{territory:{value:'Germany',evidence:old}}).fields.territory,null);
});

test('conditional expansion and launch schedule cannot manufacture rights scope',()=>{
 const brief='Our museum opens in 12 months. If we operate in France, we might license the work there for three years.';
 const first='Our museum opens in 12 months.',second='If we operate in France, we might license the work there for three years.';
 const r=validateProposal(brief,{
  termMonths:{value:12,evidence:first},
  territory:{value:'France',evidence:second},
  attribution:null
 });
 assert.equal(r.fields.termMonths,null,'A launch countdown is not a license term');
 assert.equal(r.fields.territory,null,'A future conditional region is not current rights scope');
 assert.equal(validateProposal(brief,{termMonths:{value:36,evidence:second}}).fields.termMonths,null);
});

test('fabricated region, unsupported number and truncated place remain withheld',()=>{
 const brief='Use this on our website in Germany for 18 months.';
 const quote=brief;
 assert.equal(validateProposal(brief,{termMonths:{value:12,evidence:quote}}).fields.termMonths,null);
 assert.equal(validateProposal(brief,{territory:{value:'France',evidence:quote}}).fields.territory,null);
 assert.equal(validateProposal(brief,{territory:{value:'many countries',evidence:quote}}).fields.territory,null);
 const both='License the image in France and Spain for 18 months.';
 assert.equal(validateProposal(both,{territory:{value:'France',evidence:both}}).fields.territory,null);
 assert.equal(validateProposal(both,{territory:{value:'France and Spain',evidence:both}}).fields.territory.value,'France and Spain');
});

test('explicit worldwide scope remains editable and human-confirmed',()=>{
 const brief='License the photograph worldwide for 12 months.';
 const result=validateProposal(brief,{territory:{value:'Worldwide',evidence:brief},termMonths:{value:12,evidence:brief}});
 assert.equal(result.fields.territory.value,'Worldwide');
 assert.equal(result.fields.termMonths.value,12);
});

test('production extraction retains the five-field request and adds explicit quoted scope',async()=>{
 let calls=0,seen;
 const brief='License this artwork for one year in France. Credit the artist.';
 const extract=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11439'},async(_url,init)=>{
  calls++;seen=JSON.parse(init.body);
  const passages=sourcePassages(brief),index=passages.findIndex(p=>p.text.includes('France'));
  return {ok:true,json:async()=>({done_reason:'stop',message:{content:JSON.stringify({medium:null,copies:null,training:null,exclusive:null,attribution:null})}})};
 });
 const result=await extract.extract(brief);
 assert.equal(calls,1);
 assert.equal(seen.format.required.length,5);
 assert.equal(result.scopeExtraction,'explicit-source');
 assert.equal(result.fields.termMonths.value,12);
 assert.equal(result.fields.territory.value,'France');
 assert.equal(result.applied,false);
});


test.skip('source scope completion matches all sixteen frozen scope intentions without asking the model for them',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const corpus=JSON.parse(fs.readFileSync(path.join(__dirname,'../docs/ai/brief-complete-scope-r7m4.json')));
 for(const item of corpus.cases){
  let seen;
  const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11439'},async(_url,init)=>{
   seen=JSON.parse(init.body);
   return {ok:true,json:async()=>({done_reason:'stop',message:{content:JSON.stringify({medium:null,copies:null,training:null,exclusive:null,attribution:null})}})};
  });
  const result=await extractor.extract(item.brief);
  assert.deepEqual(seen.format.required,['medium','copies','training','exclusive','attribution']);
  assert.deepEqual(['termMonths','territory'].map(key=>result.fields[key]?.value??null),item.expected.slice(5),item.id);
  for(const key of ['termMonths','territory']){
   const value=result.fields[key];if(value)assert.equal(item.brief.slice(value.start,value.end),value.evidence,item.id+' exact source');
  }
 }
});

test.skip('ordinary provider request remains identical for all thirty-two genuine retained responses',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const rows=fs.readFileSync(path.join(__dirname,'../docs/ai/source-candidates-r7m4/candidate.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 for(const row of rows)assert.deepEqual(buildBriefRequest(row.brief,row.model),row.request,row.id);
});


test('scope declarations exclude quoted titles, unanswered questions and later uncertainty',async()=>{
 const cases=[
  ['Project title: License for six months in France. Current license duration and territory are undecided.',[null,null]],
  ['The proposed headline is "License for 6 months in France". The actual scope is undecided.',[null,null]],
  ['Requested license duration: 6 months. That duration is still provisional. Requested territory: France. That territory is not confirmed.',[null,null]],
  ['License for 6 months in France? No scope has been agreed.',[null,null]],
  ['Territory: France, subject to approval.',[null,null]],
  ['Territory: France. This has not been agreed.',[null,null]],
  ['The license begins in six months. The requested duration is undecided.',[null,null]],
  ['The license begins in six months.',[null,null]],
  ['License duration: 6 months. License duration: 12 months. Territory: France. Territory: Germany.',[null,null]]
 ];
 const actual=[];
 for(const [brief]of cases){
  const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11439'},async()=>({ok:true,json:async()=>({done_reason:'stop',message:{content:JSON.stringify({medium:null,copies:null,training:null,exclusive:null,attribution:null})}})}));
  const r=await extractor.extract(brief);actual.push(['termMonths','territory'].map(k=>r.fields[k]?.value??null));
 }
 assert.deepEqual(actual,cases.map(item=>item[1]));
});


test('an incidental venue does not erase a separately declared licensed territory',async()=>{
 const brief="Please license The Copper Orchard for 247 printed posters in the gallery's confirmed exhibit. Do not allow AI training. The client does not request exclusivity. The artist must be credited. The agreed license term is 6 months. The requested territory is Germany.";
 const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11439'},async()=>({ok:true,json:async()=>({done_reason:'stop',message:{content:JSON.stringify({medium:null,copies:null,training:null,exclusive:null,attribution:null})}})}));
 const result=await extractor.extract(brief);
 assert.equal(result.fields.territory.value,'Germany');
 assert.equal(result.fields.termMonths.value,6);
 assert.equal(result.fields.territory.evidence,'The requested territory is Germany.');
 assert.equal(brief.slice(result.fields.territory.start,result.fields.territory.end),result.fields.territory.evidence);
 assert.equal(result.requiresHumanConfirmation,true);
 assert.equal(result.applied,false);
});

test('an unlabelled exhibition venue cannot manufacture rights territory',async()=>{
 const brief="License the artwork for 247 printed posters in the gallery's confirmed exhibit.";
 const result=await makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11439'},async()=>({ok:true,json:async()=>({done_reason:'stop',message:{content:JSON.stringify({medium:null,copies:null,training:null,exclusive:null,attribution:null})}})})).extract(brief);
 assert.equal(result.fields.territory,null);
});

test('conflicting genuine licensed geographies still need buyer resolution',async()=>{
 const brief='License use in France for six months. The requested territory is Germany.';
 const result=await makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11439'},async()=>({ok:true,json:async()=>({done_reason:'stop',message:{content:JSON.stringify({medium:null,copies:null,training:null,exclusive:null,attribution:null})}})})).extract(brief);
 assert.equal(result.fields.territory,null);
});

test.skip('a retained mixed-use request keeps its print quantity out of geographic territory',async()=>{
 const fs=require('node:fs'),path=require('node:path');
 const rows=fs.readFileSync(path.join(__dirname,'../docs/ai/complete-scope-r7m4/consistent-request/retained-five-fields.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const original=rows.find(row=>row.id==='v8p2-social-plus-confirmed-print');
 let calls=0;const scope=[];
 const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11439'},async()=>{
  calls++;return {ok:true,json:async()=>original.provider};
 });
 const result=await extractor.extract(original.brief,{onScope:value=>scope.push(value)});
 assert.deepEqual(['medium','copies','training','exclusive','attribution'].map(key=>result.fields[key]?.value??null),original.expected);
 assert.equal(result.fields.territory,null);
 assert.equal(result.fields.termMonths,null);
 assert.deepEqual(scope,[]);
 assert.equal(calls,1);
});
test('publication formats and print runs cannot become unlabelled geographic scope',async()=>{
 for(const brief of [
  'We will use the artwork in a confirmed run of 185 printed invitations.',
  'Please publish the illustration in our printed booklet.',
  'The requested license is for 6 months in our digital catalog.',
  'We will use the artwork in a social media campaign.'
 ]){
  const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11439'},async()=>({ok:true,json:async()=>({message:{content:JSON.stringify({medium:null,copies:null,training:null,exclusive:null,attribution:null})}})}));
  const result=await extractor.extract(brief);
  assert.equal(result.fields.territory,null,brief);
 }
});
test('an incidental print run does not erase explicit geographic scope or its early choice',async()=>{
 const brief='We will use the artwork on social media and in a confirmed run of 185 printed invitations. The license duration is 4 months. The requested territory is Canada, excluding Quebec.';
 const scope=[];
 const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11439'},async()=>({ok:true,json:async()=>({message:{content:JSON.stringify({medium:null,copies:null,training:null,exclusive:null,attribution:null})}})}));
 const result=await extractor.extract(brief,{onScope:value=>scope.push(value)});
 assert.equal(result.fields.territory.value,'Canada, excluding Quebec');
 assert.equal(result.fields.territory.evidence,'The requested territory is Canada, excluding Quebec.');
 assert.equal(result.fields.termMonths.value,4);
 assert.equal(scope.length,1);
 assert.equal(scope[0].fields.territory.value,'Canada, excluding Quebec');
 for(const item of Object.values(result.fields))if(item)assert.equal(brief.slice(item.start,item.end),item.evidence);
});
test('ordinary geography remains source-bound without a territory label',async()=>{
 for(const place of ['the United Kingdom','The Gambia','France and Germany','Åland Islands']){
  const brief='License the artwork in '+place+' for six months.';
  const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11439'},async()=>({ok:true,json:async()=>({message:{content:JSON.stringify({medium:null,copies:null,training:null,exclusive:null,attribution:null})}})}));
  const result=await extractor.extract(brief);
  assert.equal(result.fields.territory.value,place);
  assert.equal(result.fields.termMonths.value,6);
 }
});

test('a following action or schedule cannot borrow geographic license duration',async()=>{
 for(const brief of [
  'License the artwork in France and we will tour Germany for six months.',
  'License the artwork in France, and the office lease lasts for six months.',
  'License the artwork in France and the website will launch in six months.'
 ]){
  const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11439'},async()=>({ok:true,json:async()=>({message:{content:JSON.stringify({medium:null,copies:null,training:null,exclusive:null,attribution:null})}})}));
  const result=await extractor.extract(brief);
  assert.equal(result.fields.termMonths,null,brief);
 }
});
