const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateProposal,makeBriefExtractor}=require('../lib/brief');
test('unknown terms remain null and no proposal is applied',()=>{
 const r=validateProposal('Use on our website.',{medium:{value:'website',evidence:'website'}});
 assert.equal(r.fields.training,null);assert.equal(r.fields.exclusive,null);assert.equal(r.fields.attribution,null);
 assert.equal(r.applied,false);assert.equal(r.requiresHumanConfirmation,true);
 assert.equal(r.fields.medium.start,11);
});
test('fabricated source evidence and invalid values are rejected',()=>{
 assert.throws(()=>validateProposal('website',{training:{value:false,evidence:'do not train'}}),/verbatim/);
 assert.throws(()=>validateProposal('print',{medium:{value:'merchandise',evidence:'print'}}),/medium/);
});
test('incomplete output and nonlocal model are not admitted',async()=>{
 const ai=makeBriefExtractor({OLLAMA_URL:'http://127.0.0.1:11439'},async()=>({ok:true,json:async()=>({done_reason:'length',response:'{}'})}));
 await assert.rejects(ai.extract('Use on our website.'),/incomplete/);
 assert.equal(makeBriefExtractor({OLLAMA_URL:'https://example.com'}).configured,false);
});

test('training evidence cannot support an attribution proposal',()=>{
 assert.throws(()=>validateProposal('Do not train models on it.',{attribution:{value:false,evidence:'Do not train models on it.'}}),/proposed field/);
});

test('genuine scheduled-print response retains named-photographer credit',()=>{
 // Actual qwen2.5:7b baseline response recorded 2026-11-10 by astra-birch-62d1.
 // The request previously failed after 27.292s because its correct credit quote
 // was rejected. This is recorded-response replay, not new model inference.
 const brief='Print 270 brochures next month. Name the photographer in the footer. Nonexclusive rights are enough. No AI training.';
 const raw={
  medium:null,
  copies:{value:270,evidence:'Print 270 brochures next month.'},
  training:{value:false,evidence:'No AI training.'},
  exclusive:null,
  attribution:{value:true,evidence:'Name the photographer in the footer.'}
 };
 const result=validateProposal(brief,raw);
 assert.equal(result.fields.copies.value,270);
 assert.equal(result.fields.training.value,false);
 assert.equal(result.fields.attribution.value,true);
 assert.equal(brief.slice(result.fields.attribution.start,result.fields.attribution.end),raw.attribution.evidence);
 assert.equal(result.fields.medium,null);
 assert.equal(result.fields.exclusive,null);
 assert.equal(result.applied,false);
 assert.equal(result.requiresHumanConfirmation,true);
});

test('named-creator credit preserves explicit values and exact source boundaries',()=>{
 for(const quote of ['Please name the illustrator in the footer.','Include the photographer’s name.','Do not name the illustrator.']){
  const value=!quote.startsWith('Do not');
  const result=validateProposal(quote,{attribution:{value,evidence:quote}});
  assert.equal(result.fields.attribution.value,value);
  assert.equal(result.fields.attribution.start,0);
  assert.equal(result.fields.attribution.end,quote.length);
 }
 assert.throws(()=>validateProposal('Name the project in the footer.',{attribution:{value:true,evidence:'Name the project in the footer.'}}),/proposed field/);
 assert.throws(()=>validateProposal('Do not train the illustrator’s model.',{attribution:{value:false,evidence:'Do not train the illustrator’s model.'}}),/proposed field/);
});

test('brief-only endpoint does not enable freeform explanations',async()=>{
 const env={OLLAMA_BRIEF_URL:'http://127.0.0.1:11539'};
 const {makeAI,createApp}=require('../server');
 const brief=makeBriefExtractor(env),ai=makeAI(env);
 assert.equal(brief.configured,true);assert.equal(ai.configured,false);
 const server=createApp({briefExtractor:brief,ai});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const config=await(await fetch('http://127.0.0.1:'+server.address().port+'/api/config')).json();assert.equal(config.briefConfigured,true);assert.equal(config.aiConfigured,false);}
 finally{await new Promise(r=>server.close(r));}
});
test('a dedicated brief endpoint takes precedence and still requires loopback',async()=>{
 let called;
 const brief=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11539',OLLAMA_URL:'http://127.0.0.1:11434'},async url=>{called=url;return {ok:true,json:async()=>({done_reason:'stop',response:'{}'})}});
 await brief.extract('Use on our website.');assert.equal(called,'http://127.0.0.1:11539/api/chat');
 assert.equal(makeBriefExtractor({OLLAMA_BRIEF_URL:'https://example.com',OLLAMA_URL:'http://127.0.0.1:11434'}).configured,false);
});

test.skip('retained undecided-attribution response omits the unsupported flag but keeps website',()=>{
 const replay=require('../docs/ai/brief-conditional-reprint-replay.json');
 const result=validateProposal(replay.brief,JSON.parse(replay.provider.response));
 assert.equal(result.fields.attribution,null,'Undecided is not a refusal to credit');
 assert.equal(result.fields.medium.value,'website');
 assert.equal(result.fields.copies,null);assert.equal(result.fields.exclusive,null);
 assert.equal(result.applied,false);assert.equal(result.requiresHumanConfirmation,true);
});

test('ambiguous and conditional source cannot become a confirmed intention',async t=>{
 const cases=[
  {field:'attribution',value:false,quote:'We have not decided whether to credit the artist.'},
  {field:'training',value:false,quote:'AI training permission is undecided.'},
  {field:'exclusive',value:true,quote:'We might request exclusive rights if funding arrives.'},
  {field:'copies',value:850,quote:'If ticket sales are strong, we might print 850 flyers.'}
 ];
 for(const {field,value,quote} of cases){
  await t.test(quote,()=>{
  const brief='Use it on our website now. '+quote;
  const result=validateProposal(brief,{medium:{value:'website',evidence:'Use it on our website now.'},[field]:{value,evidence:quote}});
  assert.equal(result.fields[field],null,quote);
  assert.equal(result.fields.medium.value,'website','One unsupported field must not discard explicit website use');
  });
 }
});

test('clipped evidence cannot reverse the surrounding explicit negation',()=>{
 const brief='Use it on our website now. We will not credit the artist.';
 const result=validateProposal(brief,{medium:{value:'website',evidence:'Use it on our website now.'},attribution:{value:true,evidence:'credit the artist'}});
 assert.equal(result.fields.attribution,null,'A quote stripped of not must not assert credit');
 assert.equal(result.fields.medium.value,'website');
});

test('unrelated uncertainty does not erase explicit permission refusals or credit',()=>{
 const brief='The publication date is undecided. No AI training. Nonexclusive rights are enough. We will credit the artist.';
 const result=validateProposal(brief,{training:{value:false,evidence:'No AI training.'},exclusive:{value:false,evidence:'Nonexclusive rights are enough.'},attribution:{value:true,evidence:'We will credit the artist.'}});
 assert.equal(result.fields.training.value,false);assert.equal(result.fields.exclusive.value,false);assert.equal(result.fields.attribution.value,true);
});

test('adjacent clauses preserve supported credit and training decisions',()=>{
 const brief='We will credit the artist, but we will not use the work for AI training.';
 const r=validateProposal(brief,{attribution:{value:true,evidence:'We will credit the artist'},training:{value:false,evidence:'we will not use the work for AI training'}});
 assert.equal(r.fields.attribution.value,true);assert.equal(r.fields.training.value,false);
 const unknown='Attribution is undecided, but no AI training is requested.';
 const u=validateProposal(unknown,{attribution:{value:false,evidence:'Attribution is undecided'},training:{value:false,evidence:'no AI training is requested'}});
 assert.equal(u.fields.attribution,null);assert.equal(u.fields.training.value,false);
});

test('a definite scheduled print run survives uncertainty in an adjacent clause',()=>{
 const brief='Print 270 brochures next month, while attribution is undecided.';
 const r=validateProposal(brief,{copies:{value:270,evidence:'Print 270 brochures next month'},attribution:{value:false,evidence:'attribution is undecided'}});
 assert.equal(r.fields.copies.value,270);assert.equal(r.fields.attribution,null);
});

test('explicit omitted credit remains an explicit refusal, not uncertainty',()=>{
 for(const brief of ['Creator attribution will be omitted.','We cannot give creator credit in this edition']){
  const r=validateProposal(brief,{attribution:{value:false,evidence:brief}});
  assert.equal(r.fields.attribution?.value,false,brief);
 }
});

test.skip('retained museum quote with changed terminal punctuation resolves only to original source',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const rows=fs.readFileSync(path.join(__dirname,'../docs/ai/brief-direct-development-v3-7f31.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 const replay=rows.find(row=>row.id==='prior-museum');
 const result=validateProposal(replay.brief,JSON.parse(replay.provider.response));
 for(const key of ['medium','training','exclusive','attribution']){
  assert.equal(result.fields[key].value,replay.expected[key]);
  const item=result.fields[key];
  assert.equal(replay.brief.slice(item.start,item.end),item.evidence);
 }
 assert.equal(result.fields.exclusive.evidence,'We do not want exclusive rights');
 assert.equal(result.fields.copies,null);
});
test('citation recovery never rewrites words or chooses between repeated phrases',()=>{
 assert.throws(()=>validateProposal('We do not want exclusive rights, and will credit the artist.',{exclusive:{value:true,evidence:'We want exclusive rights.'}}),/verbatim/);
 assert.throws(()=>validateProposal('No exclusive rights, please. No exclusive rights, ever.',{exclusive:{value:false,evidence:'No exclusive rights.'}}),/verbatim/);
 assert.throws(()=>validateProposal('Credit the artistically gifted team',{attribution:{value:true,evidence:'Credit the artist.'}}),/verbatim/);
});
test('explicit omitted credit and excluded training remain refusals',()=>{
 for(const [field,brief] of [['attribution','Creator attribution will be omitted.'],['attribution','We cannot give creator credit in this edition.'],['training','Please exclude it from training datasets.']]){
  const result=validateProposal(brief,{[field]:{value:false,evidence:brief}});
  assert.equal(result.fields[field]?.value,false,brief);
  assert.equal(result.fields[field].evidence,brief);
 }
});

test('the full accepted source reaches chat with exact positions and enough context',async()=>{
 const {sourcePassages}=require('../lib/brief-request');
 for(const fill of ['a','展','"','\n']){
  const prefix='Use this illustration on our website. ',suffix=' No AI training. Credit the artist.';
  const brief=prefix+fill.repeat(4000-prefix.length-suffix.length)+suffix;
  let observed;
  const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11539'},async(_url,init)=>{observed=JSON.parse(init.body);return {ok:true,json:async()=>({done_reason:'stop',message:{content:'{}'}})};});
  await extractor.extract(brief);
  const passages=sourcePassages(brief),covered=new Set();
  for(const passage of passages){
   assert.equal(brief.slice(passage.start,passage.end),passage.text);
   for(let i=passage.start;i<passage.end;i++)covered.add(i);
  }
  for(let i=0;i<brief.length;i++)if(/\S/u.test(brief[i]))assert.ok(covered.has(i),'Accepted source character '+i+' was lost');
  const source=observed.messages.find(m=>m.role==='user').content;
  assert.deepEqual(JSON.parse(source.slice(source.indexOf('\n')+1)),passages.map((p,i)=>[i,p.text]));
  const bytes=observed.messages.reduce((n,m)=>n+Buffer.byteLength(m.content,'utf8'),0);
  assert.ok(observed.options.num_ctx>=bytes+observed.options.num_predict+256);
  assert.ok(observed.options.num_ctx<=32768);
 }
});
test('indexed passages retain duplicate source positions and reject unavailable indexes',()=>{
 const {sourcePassages,decodeBriefResponse}=require('../lib/brief-request');
 const brief='Use our website. Use our website.';
 const passages=sourcePassages(brief);
 assert.equal(passages.length,2);assert.equal(passages[0].text,passages[1].text);
 const proposal=validateProposal(brief,decodeBriefResponse(brief,{medium:{v:'website',s:1}}));
 assert.equal(proposal.fields.medium.start,17);assert.equal(proposal.fields.medium.end,33);
 assert.throws(()=>decodeBriefResponse(brief,{medium:{v:'website',s:2}}),/unavailable/);
 assert.throws(()=>decodeBriefResponse(brief,{medium:{v:'website',s:-1}}),/unavailable/);
 assert.throws(()=>validateProposal(brief,{medium:{value:'website',evidence:'website',start:0}}),/position/);
});
test('a repeated quote uses the selected occurrence when checking its surrounding condition',()=>{
 const brief='If funded, credit the artist. For the confirmed order, credit the artist.';
 const evidence='credit the artist',start=brief.lastIndexOf(evidence);
 const proposal=validateProposal(brief,{attribution:{value:true,evidence,start}});
 assert.equal(proposal.fields.attribution.value,true);
 assert.equal(proposal.fields.attribution.start,start);
 assert.equal(validateProposal(brief,{attribution:{value:true,evidence,start:brief.indexOf(evidence)}}).fields.attribution,null);
});
test.skip('retained real chat results use exact sources and preserve every explicit value',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const {decodeBriefResponse,buildBriefRequest,constrainBriefRequestSources}=require('../lib/brief-request');
 for(const file of ['brief-chat4-7f31-regression.jsonl','brief-chat4-7f31-final.jsonl','brief-chat4-fresh-7f31-direct.jsonl']){
  const rows=fs.readFileSync(path.join(__dirname,'../docs/ai',file),'utf8').trim().split('\n').map(JSON.parse);
  for(const row of rows){
   const current=buildBriefRequest(row.brief,row.model),{num_batch,...historicalOptions}=current.options;
   assert.deepEqual({...current,options:historicalOptions},constrainBriefRequestSources(row.request,row.brief),'Historical prompt and options remain unchanged; source choices are narrowed for '+row.id);
   const result=validateProposal(row.brief,decodeBriefResponse(row.brief,JSON.parse(row.provider.message.content)));
   for(const [field,wanted] of Object.entries(row.expected))assert.equal(result.fields[field]?.value??null,wanted,row.id+': '+field);
   for(const item of Object.values(result.fields).filter(Boolean))assert.equal(row.brief.slice(item.start,item.end),item.evidence);
  }
 }
});
test('multiple digital uses are withheld without erasing a confirmed single digital use',()=>{
 for(const brief of ['Use our website and social posts.','This order covers our website and social posts.']){
  assert.equal(validateProposal(brief,{medium:{value:'website',evidence:brief}}).fields.medium,null);
 }
 for(const brief of ['Use our website, but no social posts.','Use our website, while social use is undecided.','Use our website and print 80 posters.']){
  assert.equal(validateProposal(brief,{medium:{value:'website',evidence:brief}}).fields.medium?.value,'website',brief);
 }
});

test.skip('separate current digital uses are withheld while withdrawn uses stay excluded',()=>{
 const {decodeBriefResponse}=require('../lib/brief-request');
 const fs=require('node:fs'),path=require('node:path');
 const rows=fs.readFileSync(path.join(__dirname,'../docs/ai/brief-production-course-7f31.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 for(const row of rows){
  const result=validateProposal(row.brief,decodeBriefResponse(row.brief,JSON.parse(row.provider.message.content)));
  ['medium','copies','training','exclusive','attribution'].forEach((field,i)=>assert.equal(result.fields[field]?.value??null,row.expected[i],row.id+': '+field));
 }
});

 test('superseded quantities are withheld while current source stays usable',()=>{
 const brief='Previous plan: print 900 copies. Current order: print 120 copies.';
 assert.equal(validateProposal(brief,{copies:{value:900,evidence:'print 900 copies'}}).fields.copies,null);
 assert.equal(validateProposal(brief,{copies:{value:120,evidence:'print 120 copies'}}).fields.copies.value,120);
 const changed='The order was cancelled: print 900 copies. Print 120 copies for the new order.';
 assert.equal(validateProposal(changed,{copies:{value:900,evidence:'print 900 copies'}}).fields.copies,null);
 assert.equal(validateProposal(changed,{copies:{value:120,evidence:'Print 120 copies'}}).fields.copies.value,120);
 });
test('pending approval remains unknown without erasing a separate confirmed use',()=>{
 for(const [field,value,quote] of [
  ['attribution',true,'Creator credit is still awaiting editorial approval.'],
  ['training',false,'Model training permission is pending committee approval.'],
  ['exclusive',true,'Exclusive rights remain awaiting final confirmation.']
 ]){
  const brief='Use the illustration on our website. '+quote;
  const result=validateProposal(brief,{medium:{value:'website',evidence:'Use the illustration on our website.'},[field]:{value,evidence:quote}});
  assert.equal(result.fields[field],null,quote);
  assert.equal(result.fields.medium.value,'website');
 }
});
test('unrelated approval waits do not remove an explicit credit decision',()=>{
 for(const brief of [
  'Creator credit is included while the delivery schedule is awaiting approval.',
  'The print run is awaiting approval, but creator credit is included.',
  'Creator credit is included. We are awaiting delivery.'
 ]){
  const result=validateProposal(brief,{attribution:{value:true,evidence:brief}});
  assert.equal(result.fields.attribution?.value,true,brief);
 }
});
test('excludes and excluding preserve explicit training refusals',()=>{
 for(const brief of ['This order is nonexclusive and excludes model training.','We request website use, excluding AI training.']){
  const result=validateProposal(brief,{training:{value:false,evidence:brief}});
  assert.equal(result.fields.training?.value,false,brief);
  assert.equal(brief.slice(result.fields.training.start,result.fields.training.end),brief);
 }
});

test.skip('all retained isolated 4B first responses keep supported scope after validation repair',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const {decodeBriefResponse}=require('../lib/brief-request');
 const rows=fs.readFileSync(path.join(__dirname,'../docs/ai/size-course-c29f/4b.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(rows.length,12);
 for(const row of rows){
  const result=validateProposal(row.brief,decodeBriefResponse(row.brief,JSON.parse(row.provider.message.content)));
  const actual=['medium','copies','training','exclusive','attribution'].map(key=>result.fields[key]?.value??null);
  assert.deepEqual(actual,row.expected,row.id);
  for(const field of Object.values(result.fields).filter(Boolean))assert.equal(row.brief.slice(field.start,field.end),field.evidence);
 }
});


test.skip('production source choices narrow the retained 4B request without changing its prompt or options',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const {buildBriefRequest,decodeBriefResponse,constrainBriefRequestSources}=require('../lib/brief-request');
 const rows=fs.readFileSync(path.join(__dirname,'../docs/ai/cache-course-c29f/batch128.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(rows.length,16);
 for(const row of rows){
  assert.deepEqual(buildBriefRequest(row.brief,row.model),constrainBriefRequestSources(row.request,row.brief),row.id);
  assert.equal(row.passed,true,row.id);
  const result=validateProposal(row.brief,decodeBriefResponse(row.brief,JSON.parse(row.provider.message.content)));
  ['medium','copies','training','exclusive','attribution'].forEach((field,i)=>assert.equal(result.fields[field]?.value??null,row.expected[i],row.id+': '+field));
  for(const item of Object.values(result.fields).filter(Boolean))assert.equal(row.brief.slice(item.start,item.end),item.evidence);
 }
});

test.skip('retired draft context survives commas without hiding the final print decision',()=>{
 const course=require('../docs/ai/brief-decision-source-c29f.json');
 const evidence='Final approved production decision: The Last Light will appear on 1,275 printed field-guide covers.';
 const result=validateProposal(course.brief,{medium:{value:'print',evidence}});
 assert.equal(result.fields.medium?.value,'print');
 const earlier='Earlier draft, print 900 copies, omit creator credit. Current order: print 120 copies and include creator credit.';
 assert.equal(validateProposal(earlier,{copies:{value:900,evidence:'print 900 copies'}}).fields.copies,null);
 assert.equal(validateProposal(earlier,{attribution:{value:false,evidence:'omit creator credit'}}).fields.attribution,null);
 assert.equal(validateProposal(earlier,{copies:{value:120,evidence:'print 120 copies'}}).fields.copies?.value,120);
 const revised='Earlier draft, print 900 copies, but current order: print 120 copies.';
 assert.equal(validateProposal(revised,{copies:{value:120,evidence:'print 120 copies'}}).fields.copies?.value,120);
 const digital='Earlier draft, print 900 copies. Use our website. Use our social channels.';
 assert.equal(validateProposal(digital,{medium:{value:'website',evidence:'Use our website.'}}).fields.medium,null);
});


test('prohibited quantities and media are withheld from clipped and whole source passages',()=>{
 for(const [field,value,brief,evidence] of [
  ['copies',900,'Do not print 900 copies. Print 120 copies.','print 900 copies'],
  ['copies',900,'Print 120 copies, not 900 copies.','Print 120 copies, not 900 copies.'],
  ['copies',1200,'Do not print 1,200 copies; print 240 copies.','Do not print 1,200 copies'],
  ['copies',900,'900 copies are prohibited. Print 120 copies.','900 copies are prohibited.'],
  ['medium','website','Do not use the artwork on a website. Use it in a printed guide.','website'],
  ['medium','social','Use the website, not social media.','Use the website, not social media.'],
  ['medium','website','Website use is prohibited. Print 120 copies.','Website use is prohibited.']
 ])assert.equal(validateProposal(brief,{[field]:{value,evidence}}).fields[field],null,brief);
});
test('scope refusals preserve adjacent allowed choices and unrelated negative wording',()=>{
 for(const [field,value,brief,evidence] of [
  ['copies',120,'Do not print 900 copies. Print 120 copies.','Print 120 copies.'],
  ['copies',120,'Print 120 copies, not 900 copies.','Print 120 copies, not 900 copies.'],
  ['copies',1200,'Print 1,200 copies, not 900 copies.','Print 1,200 copies, not 900 copies.'],
  ['copies',120,'Print 120 copies without lamination.','Print 120 copies without lamination.'],
  ['copies',120,'Do not delay the print 120 copies order.','Do not delay the print 120 copies order.'],
  ['copies',0,'No print copies are needed.','No print copies are needed.'],
  ['medium','website','Use the website, not social media.','Use the website, not social media.'],
  ['medium','website','We will not only use the website.','We will not only use the website.'],
  ['medium','website','Use the website without animation.','Use the website without animation.']
 ])assert.equal(validateProposal(brief,{[field]:{value,evidence}}).fields[field]?.value,value,brief);
});


test('quoted physical quantities must support the proposed count',()=>{
 for(const [brief,value] of [
  ['Print 120 copies.',900],
  ['Print 120 copies for 5 stores.',5],
  ['Print 1,200 copies for 5 stores.',200],
  ['Produce 240 printed covers with a budget of 900 dollars.',900],
  ['Print 120 copies and 90 cards.',250]
 ])assert.equal(validateProposal(brief,{copies:{value,evidence:brief}}).fields.copies,null,brief);
});
test('numeric grounding preserves supported counts and leaves unparsed quantities for source review',()=>{
 for(const [brief,value] of [
  ['Print 120 copies for 5 stores.',120],
  ['Print 1,200 copies for 5 stores.',1200],
  ['Produce 240 printed covers.',240],
  ['Print 120 copies and 90 cards.',90],
  ['Print one hundred copies for 5 stores.',100],
  ['Print 1 200 copies.',1200],
  ['Print 1.2k copies.',1200],
  ['No printed copies are needed.',0]
 ])assert.equal(validateProposal(brief,{copies:{value,evidence:brief}}).fields.copies?.value,value,brief);
});

test('quoted medium must name the proposed use rather than a different supported medium',()=>{
 for(const [brief,value] of [['Print 120 copies.','website'],['Use it on our website.','social'],['Use it on social media.','print']]){
  assert.equal(validateProposal(brief,{medium:{value,evidence:brief}}).fields.medium,null,brief);
 }
 for(const [brief,value] of [['Print 120 copies.','print'],['Use it on our website.','website'],['Use it on social media.','social'],['Use it on the web.','website'],['Make 120 posters.','print']]){
  assert.equal(validateProposal(brief,{medium:{value,evidence:brief}}).fields.medium?.value,value,brief);
 }
});

test.skip('genuine combined-permission responses keep each independent choice',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const {decodeBriefResponse}=require('../lib/brief-request');
 const rows=fs.readFileSync(path.join(__dirname,'../docs/ai/independent-rights-r7m4/baseline-first.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 for(const row of rows){
  const raw=decodeBriefResponse(row.brief,JSON.parse(row.provider.message.content));
  if(row.id==='r7m4-exclusive-with-credit'){
   // This first response actually cites the title rather than the print sentence.
   const partial=validateProposal(row.brief,raw);
   assert.equal(partial.fields.medium,null);
   assert.deepEqual(['copies','training','exclusive','attribution'].map(k=>partial.fields[k]?.value),[284,false,true,true]);
   assert.deepEqual(partial.withheldFields,['medium']);
   assert.equal(partial.requiresHumanConfirmation,true);
   assert.equal(partial.applied,false);
   continue;
  }
  const result=validateProposal(row.brief,raw);
  assert.deepEqual(['medium','copies','training','exclusive','attribution'].map(k=>result.fields[k]?.value??null),row.expected,row.id);
 }
 const supported=rows.find(r=>r.id==='r7m4-training-with-nonexclusive');
 for(const field of ['training','attribution']){
  const raw=decodeBriefResponse(supported.brief,JSON.parse(supported.provider.message.content));
  raw[field].value=false;
  assert.equal(validateProposal(supported.brief,raw).fields[field],null,field+' cannot reverse an explicit positive');
 }
 const raw=decodeBriefResponse(supported.brief,JSON.parse(supported.provider.message.content));
 raw.exclusive.value=true;
 assert.equal(validateProposal(supported.brief,raw).fields.exclusive,null,'nonexclusive still refuses exclusive');
});
test('refusing credit omission preserves explicit inclusion and uncertainty',()=>{
 for(const brief of ['Do not omit the artist credit.',"Don't omit creator credit.","Please do not exclude the illustrator's attribution."]){
  assert.equal(validateProposal(brief,{attribution:{value:true,evidence:brief}}).fields.attribution?.value,true,brief);
  assert.equal(validateProposal(brief,{attribution:{value:false,evidence:brief}}).fields.attribution,null,brief);
 }
 for(const brief of ['If approved, do not omit the artist credit.','Whether to omit creator credit is undecided.']){
  assert.equal(validateProposal(brief,{attribution:{value:true,evidence:brief}}).fields.attribution,null,brief);
 }
 for(const brief of ['Do not include artist credit.','Omit creator credit.','Artist attribution is prohibited.']){
  assert.equal(validateProposal(brief,{attribution:{value:false,evidence:brief}}).fields.attribution?.value,false,brief);
 }
});

test('one invalid field never repairs its value or removes supported independent choices',()=>{
 const brief='Print 284 copies. We request exclusive rights. Credit the artist. No model training.';
 const valid={copies:{value:284,evidence:'Print 284 copies.'},exclusive:{value:true,evidence:'We request exclusive rights.'}};
 for(const invalid of [
  {value:'print',evidence:'absent quotation'},
  {value:'print',evidence:'Credit the artist.'},
  {value:'merchandise',evidence:'Print 284 copies.'},
  {value:'print',evidence:'Print 284 copies.',start:1}
 ]){
  const result=validateProposal(brief,{...valid,medium:invalid});
  assert.equal(result.fields.medium,null);
  assert.equal(result.fields.copies.value,284);
  assert.equal(result.fields.exclusive.value,true);
  assert.equal(result.fields.training,null);
  assert.equal(result.applied,false);
  assert.deepEqual(result.withheldFields,['medium']);
 }
 assert.throws(()=>validateProposal(brief,{medium:{value:'print',evidence:'absent quotation'}}),/verbatim/);
});

test('source candidates omit unrelated passages without changing requested values or the prompt',()=>{
 const {buildBriefRequest,constrainBriefRequestSources}=require('../lib/brief-request');
 const brief='Summer programme. Print 73 copies. Credit the artist. No training or exclusivity.';
 const original=buildBriefRequest(brief,'qwen3.5:4b'),saved=structuredClone(original),candidate=constrainBriefRequestSources(original,brief);
 assert.deepEqual(original,saved);
 assert.deepEqual(candidate.messages,original.messages);
 assert.deepEqual(candidate.options,original.options);
 for(const [field,expected]of Object.entries({medium:[1],copies:[1],training:[3],exclusive:[3],attribution:[2]})){
  assert.deepEqual(candidate.format.properties[field].anyOf[1].properties.s.enum,expected,field);
  assert.deepEqual(candidate.format.properties[field].anyOf[1].properties.v,original.format.properties[field].anyOf[1].properties.v,field);
 }
 const absent=constrainBriefRequestSources(buildBriefRequest('Use it on our website.','qwen3.5:4b'),'Use it on our website.');
 for(const field of ['copies','training','exclusive','attribution'])assert.deepEqual(absent.format.properties[field],{type:'null'},field);
});
test.skip('source candidates retain every currently validated indexed source in genuine first responses',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const {buildBriefRequest,constrainBriefRequestSources,decodeBriefResponse}=require('../lib/brief-request');
 for(const filename of ['independent-rights-r7m4/baseline-first.jsonl','compact-compatible-v8p2/baseline.jsonl']){
  const rows=fs.readFileSync(path.join(__dirname,'../docs/ai',filename),'utf8').trim().split('\n').map(JSON.parse);
  for(const row of rows){
   const raw=JSON.parse(row.provider.message.content),result=validateProposal(row.brief,decodeBriefResponse(row.brief,raw));
   const candidate=constrainBriefRequestSources(buildBriefRequest(row.brief,row.model),row.brief);
   for(const [field,item]of Object.entries(result.fields)){
    if(!item)continue;
    assert.ok(candidate.format.properties[field].anyOf[1].properties.s.enum.includes(raw[field].s),row.id+': '+field);
   }
   if(row.id==='r7m4-exclusive-with-credit')assert.deepEqual(candidate.format.properties.medium.anyOf[1].properties.s.enum,[1],'The actual wrong title citation is unavailable');
  }
 }
});

test.skip('production source constraints preserve recorded provider failures and recover explicit zero',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const {buildBriefRequest,decodeBriefResponse}=require('../lib/brief-request');
 const rows=fs.readFileSync(path.join(__dirname,'../docs/ai/source-candidates-r7m4/candidate.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(rows.length,32);assert.equal(rows.filter(row=>row.passed).length,31);
 for(const row of rows){
  assert.deepEqual(buildBriefRequest(row.brief,row.model),row.request,row.id);
  const result=validateProposal(row.brief,decodeBriefResponse(row.brief,JSON.parse(row.provider.message.content)));
  assert.deepEqual(['medium','copies','training','exclusive','attribution'].map(field=>result.fields[field]?.value??null),row.id==='r7m4-candidates-retired-print'?row.expected:row.actual,row.id);
 }
 const failure=rows.find(row=>row.id==='r7m4-candidates-retired-print');
 assert.equal(failure.actual[1],null);assert.equal(failure.expected[1],0);assert.equal(failure.passed,false);
});


test('later confirmed geographic and time scope resolves an earlier unknown without inventing rights',async()=>{
 const cases=[
  {
   brief:'The license term is undecided. The final approved license term is 6 months. Territory is undecided. Final approved territory: Germany.',
   months:6,territory:'Germany'
  },
  {
   brief:'Territory: France. Territory has not been decided. Final approved territory: Germany. The license term is undecided. Final approved license term: 12 months.',
   months:12,territory:'Germany'
  },
  {
   brief:'Territory is undecided. We are considering Germany. License duration is undecided. We may request 6 months.',
   months:null,territory:null
  },
  {
   brief:'Final approved territory: Germany. The territory is undecided. Final approved license term: 6 months. The license term is undecided.',
   months:null,territory:null
  },
  {
   brief:'Territory is undecided. Final approved territory: Germany. Final approved territory: France.',
   months:null,territory:null
  }
 ];
 for(const row of cases){
  const extractor=makeBriefExtractor({OLLAMA_URL:'http://127.0.0.1:11434'},async()=>({
   ok:true,json:async()=>({done_reason:'stop',message:{content:'{}'}})
  }));
  const result=await extractor.extract(row.brief);
  assert.equal(result.fields.termMonths?.value??null,row.months,row.brief);
  assert.equal(result.fields.territory?.value??null,row.territory,row.brief);
  for(const item of [result.fields.termMonths,result.fields.territory].filter(Boolean)){
   assert.equal(row.brief.slice(item.start,item.end),item.evidence);
  }
  assert.equal(result.applied,false);
  assert.equal(result.requiresHumanConfirmation,true);
 }
});


test('unavailable local model leaves a usable source-quoted buyer request and no invented rights',async()=>{
 const brief='Please use the illustration on our website. No AI training. Nonexclusive rights. Creator credit is included. The license term is 6 months. Territory: Germany.';
 const ai=makeBriefExtractor({OLLAMA_URL:'http://127.0.0.1:11434'},async()=>({ok:false,status:503}));
 const result=await ai.extract(brief);
 assert.equal(result.sourceOnly,true);
 assert.equal(result.model,null);
 assert.equal(result.fields.medium.value,'website');
 assert.equal(result.fields.training.value,false);
 assert.equal(result.fields.exclusive.value,false);
 assert.equal(result.fields.attribution.value,true);
 assert.equal(result.fields.termMonths.value,6);
 assert.equal(result.fields.territory.value,'Germany');
 assert.equal(result.fields.copies,null);
 for(const item of Object.values(result.fields).filter(Boolean))assert.equal(brief.slice(item.start,item.end),item.evidence);
 assert.equal(result.applied,false);
 assert.equal(result.requiresHumanConfirmation,true);
});

test('unavailable local model keeps speculative, historical and uncertain wording unknown',async()=>{
 const brief='This is a hypothetical example: use our website. We might print 20 physical copies if funded. Attribution remains undecided.';
 const ai=makeBriefExtractor({OLLAMA_URL:'http://127.0.0.1:11434'},async()=>{throw Error('model unavailable')});
 await assert.rejects(ai.extract(brief),/model unavailable/);
});

test('the buyer stopping a failed model request never receives late source-only suggestions',async()=>{
 const controller=new AbortController();
 const brief='Please use the illustration on our website. No AI training.';
 const ai=makeBriefExtractor({OLLAMA_URL:'http://127.0.0.1:11434'},async()=>{controller.abort();throw Error('model unavailable')});
 await assert.rejects(ai.extract(brief,{signal:controller.signal}),/abort/i);
});


test('network transport loss gets source-only suggestions while unrelated adapter errors still surface',async()=>{
 const brief='Please use the illustration on our website. No AI training.';
 const down=makeBriefExtractor({OLLAMA_URL:'http://127.0.0.1:11434'},async()=>{throw new TypeError('fetch failed')});
 const recovered=await down.extract(brief);
 assert.equal(recovered.sourceOnly,true);
 assert.equal(recovered.fields.medium.value,'website');
 assert.equal(recovered.fields.training.value,false);
 const broken=makeBriefExtractor({OLLAMA_URL:'http://127.0.0.1:11434'},async()=>{throw Error('adapter bug')});
 await assert.rejects(broken.extract(brief),/adapter bug/);
});
