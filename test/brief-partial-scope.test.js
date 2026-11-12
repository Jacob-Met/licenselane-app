'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {makeBriefExtractor}=require('../lib/brief');
test.skip('one explicit scope value is offered before the primary response without inventing the other fields',async()=>{
 const heather=require('../docs/ai/brief-complete-scope-r7m4.json').cases.find(x=>x.id==='r7m4-scope-heather-dates').brief;
 for(const [brief,expected]of [[heather,{territory:'United Kingdom'}],['The agreed license term is 6 months. Territory is undecided.',{termMonths:6}],['Requested start date: 2027-01-31. Duration and territory are undecided.',{startsOn:'2027-01-31'}]]){
  let early;
  const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11434'},async()=>{assert.ok(early,'usable source arrives before the controlled provider starts');throw Error('held primary');});
  await assert.rejects(extractor.extract(brief,{onScope:value=>{early=value;}}),/held primary/);
  assert.equal(early.applied,false);assert.equal(early.requiresHumanConfirmation,true);
  assert.deepEqual(Object.fromEntries(Object.entries(early.fields).filter(([,v])=>v).map(([k,v])=>[k,v.value])),expected);
  for(const field of Object.values(early.fields).filter(Boolean))assert.equal(brief.slice(field.start,field.end),field.evidence);
 }
});
test('unknown scope does not become an early action',async()=>{
 let early;
 const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11434'},async()=>{throw Error('held primary');});
 await assert.rejects(extractor.extract('The license duration, territory and start date are undecided.',{onScope:value=>{early=value;}}),/held primary/);
 assert.equal(early,undefined);
});
