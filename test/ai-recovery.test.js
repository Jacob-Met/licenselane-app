const {test}=require('node:test');
const assert=require('node:assert/strict');
const {makeAI,quote,normalize}=require('../server');
test('unreachable local inference explains recovery without an internal error',async()=>{
 const ai=makeAI({OLLAMA_URL:'http://127.0.0.1:11439'},async()=>{throw new TypeError('fetch failed');});
 await assert.rejects(ai.review({}, {findings:[]}), e=>/turn off AI explanation/.test(e.message));
});
test('local inference does not follow redirects off the loopback trust boundary',async()=>{
 let options;
 const ai=makeAI({OLLAMA_URL:'http://127.0.0.1:11439'},async(url,o)=>{options=o;return {ok:true,json:async()=>({response:'Advisory explanation only.'})};});
 await ai.review({}, {findings:[]});
 assert.equal(options.redirect,'error');
});

test('truncated model explanation is not presented as a finished review',async()=>{
 const ai=makeAI({OLLAMA_URL:'http://127.0.0.1:11439'},async()=>({ok:true,json:async()=>({response:'Permission is...',done_reason:'length'})}));
 await assert.rejects(ai.review({}, {findings:[]}),/cut short/);
});
