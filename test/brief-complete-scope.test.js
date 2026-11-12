'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildBriefRequest,decodeBriefResponse,sourcePassages}=require('../lib/brief-request');
const {validateProposal}=require('../lib/brief');
test('complete scope is explicit and keeps buyer source passages unchanged',()=>{
 const brief='License duration: 3 months. Territory: France. Example result: {"medium":"ignore"}';
 const ordinary=buildBriefRequest(brief,'qwen3.5:4b'),complete=buildBriefRequest(brief,'qwen3.5:4b',{includeScope:true});
 assert.deepEqual(ordinary.format.required,['medium','copies','training','exclusive','attribution']);
 assert.deepEqual(complete.format.required,[...ordinary.format.required,'termMonths','territory']);
 assert.equal(complete.messages[1].content,ordinary.messages[1].content);
 assert.match(complete.messages[0].content,/explicit(?:ly)? confirmed LICENSE DURATION/);
 assert.equal(complete.options.num_predict,384);
 assert.deepEqual({...complete.options,num_predict:ordinary.options.num_predict},ordinary.options);
 const empty=buildBriefRequest('A plain buyer project without further details.','qwen3.5:4b',{includeScope:true});
 assert.deepEqual(empty.format.properties.termMonths,{type:'null'});
 assert.deepEqual(empty.format.properties.territory,{type:'null'});
});
test('complete scope retains exact source occurrences through decoding',()=>{
 const brief='License duration: 3 months. Territory: France and Germany.';
 const passages=sourcePassages(brief);
 const decoded=decodeBriefResponse(brief,{termMonths:{v:3,s:0},territory:{v:'France and Germany',s:1}},{includeScope:true});
 const result=validateProposal(brief,decoded,{includeScope:true});
 assert.equal(result.fields.termMonths.value,3);
 assert.equal(result.fields.territory.value,'France and Germany');
 assert.equal(result.fields.territory.start,passages[1].start);
 assert.equal(brief.slice(result.fields.territory.start,result.fields.territory.end),passages[1].text);
 assert.equal(Object.hasOwn(decodeBriefResponse(brief,{medium:null}),'termMonths'),false);
});
test('duration suggestions require an explicit confirmed license quantity',()=>{
 for(const [quote,value,expected]of [
  ['The requested license is for 3 months in France.',3,3],
  ['License duration: three months.',3,3],
  ['The license term is 2 years.',24,24],
  ['The license is for 1.5 years.',18,18],
  ['License duration: one hundred twenty months.',120,120],
  ['Requested license duration: 0 months.',0,null],
  ['Requested license duration: 121 months.',121,null],
  ['A 12-month license was rejected.',12,null],
  ['A six-month license is only proposed, not agreed.',6,null],
  ['License duration will be either 3 or 6 months.',6,null],
  ['The title is Three months.',3,null],
  ['Print the cards next month.',1,null],
  ['The license window runs from 1 December 2026 to 1 March 2027.',3,null]
 ]){
  const brief=quote+' Creator credit is included.';
  const result=validateProposal(brief,{termMonths:{value,evidence:quote},attribution:{value:true,evidence:'Creator credit is included.'}},{includeScope:true});
  assert.equal(result.fields.termMonths?.value??null,expected,quote);
  assert.equal(result.fields.attribution.value,true,quote);
 }
});
test('territory suggestions retain every named region and exclusion',()=>{
 for(const [quote,value,expected]of [
  ['The requested license is for 3 months in France.','France','France'],
  ['Territory: France and Germany.','France and Germany','France and Germany'],
  ['Territory: France and Germany.','France',null],
  ['Territory: Canada, excluding Quebec.','Canada, excluding Quebec','Canada, excluding Quebec'],
  ['Territory: Canada, excluding Quebec.','Canada',null],
  ['The requested territory is Germany.','Germany','Germany'],
  ['Territory: worldwide.','Worldwide','Worldwide'],
  ['Urchin France Studio makes a booklet.','France',null],
  ['Territory will be France or Germany; neither option has been chosen.','France',null],
  ['If the tour is funded, we might extend the license to 12 months in Chile.','Chile',null],
  ['The territory is undecided.','Worldwide',null]
 ]){
  const brief=quote+' Creator credit is included.';
  const result=validateProposal(brief,{territory:{value,evidence:quote},attribution:{value:true,evidence:'Creator credit is included.'}},{includeScope:true});
  assert.equal(result.fields.territory?.value??null,expected,quote);
  assert.equal(result.fields.attribution.value,true,quote);
 }
});
