'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {makeBriefExtractor}=require('../lib/brief');
async function proposal(dateText){
 const brief='The license is requested for 4 months in Canada. '+dateText;let early;
 const extractor=makeBriefExtractor({OLLAMA_BRIEF_URL:'http://127.0.0.1:11434'},async()=>({ok:true,json:async()=>({message:{content:JSON.stringify({medium:null,copies:null,training:null,exclusive:null,attribution:null})}})}));
 const result=await extractor.extract(brief,{onScope:value=>{early=value;}});
 const value=result.fields.startsOn||null;
 if(value){assert.equal(brief.slice(value.start,value.end),value.evidence);assert.deepEqual(early.fields.startsOn,value);}
 return value?.value??null;
}
test('explicit calendar starts keep exact source and require buyer confirmation',async()=>{
 for(const [text,wanted]of [
 ['Begin on 31 January 2027.','2027-01-31'],
 ['The start date is undecided. Confirmed start date: 31 January 2027.','2027-01-31'],
 ['Begin on 31 January 2027. That date was cancelled. Begin on 1 February 2027.','2027-02-01'],
 ['Project start date: 2027-01-31.','2027-01-31'],
 ['Start date is January 31, 2027.','2027-01-31'],
 ['The license begins on 29 February 2028.','2028-02-29'],
 ['Please start our project on 1 March 2027 UTC.','2027-03-01'],
 ['Confirmed start date: 2027-01-31. Confirmed start date: 2027-01-31.','2027-01-31'],
 ['Earlier plan: begin on 1 December 2026. Confirmed start date: 2027-01-31.','2027-01-31']
 ])assert.equal(await proposal(text),wanted,text);
});
test('ambiguous, non-start, invalid, unsettled and retired dates remain manual',async()=>{
 for(const text of [
 'Begin on 31 February 2027.','Begin on 29 February 2027.','Begin on 01/02/2027.',
 'Begin tomorrow.','The exhibition begins on 31 January 2027.','Deliver on 31 January 2027.',
 'Example: Begin on 31 January 2027.','The title is Begin on 31 January 2027.',
 '"Begin on 31 January 2027."','Do not begin on 31 January 2027.',
 'If approved, begin on 31 January 2027.','Begin on 31 January 2027 if approved.',
 'Begin on 31 January 2027. That is not confirmed.',
 'Begin on 31 January 2027. That date was cancelled.',
 'Begin on 31 January 2027. This is an example.',
 'Begin on 31 January 2027. No start date has been approved.',
 'Begin on 31 January 2027. Do not begin on 31 January 2027.',
 'Begin on 31 January 2027. The start date is undecided.',
 'Earlier plan. Begin on 31 January 2027.',
 'Begin on 31 January 2027. Begin on 1 February 2027.',
 'Begin on 31 January 2027 PST.',
 'The start date will be either 31 January 2027 or 1 February 2027.'
 ])assert.equal(await proposal(text),null,text);
});
