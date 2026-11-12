'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {originalFilename}=require('./filenames');
const inventory=require('../public/zip-inventory');
const MAX_ORIGINAL_BYTES=64*1024*1024;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function inspectOriginal(bytes,name,max=MAX_ORIGINAL_BYTES){
 if(typeof name!=='string'||!bytes.length||bytes.length>max)throw fail('Choose an original up to 64 MB.');
 let mime,contents;
 if(/\.zip$/i.test(name)){try{contents=inventory(bytes);mime='application/zip';}catch{throw fail('Choose a complete ZIP containing at least one file.');}}
 else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
 else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
 else throw fail('Choose a real PNG, JPEG or ZIP original.');
 return {bytes,mime,filename:originalFilename(name,mime==='application/zip'?'original.zip':mime==='image/png'?'work.png':'work.jpg'),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),...(contents?{contents,files:contents.length}:{})};
}
function createOriginalUploads(root){
 let active=false;
 const destination=sha=>{if(typeof sha!=='string'||!/^[a-f0-9]{64}$/.test(sha))throw fail('Invalid original reference.');return path.join(root,sha);};
 function resolve(ref){
  if(!ref||typeof ref.name!=='string')throw fail('Review your original again.');
  let bytes;try{const file=destination(ref.uploadSha);if(fs.statSync(file).size>MAX_ORIGINAL_BYTES)throw fail('Choose an original up to 64 MB.',413);bytes=fs.readFileSync(file);}catch(e){if(e.code==='ENOENT')throw fail('The original upload is not complete. Retry this save.',409);throw e;}
  const original=inspectOriginal(bytes,ref.name);if(original.sha256!==ref.uploadSha)throw fail('The uploaded original is damaged. Upload it again.',409);
  return original;
 }
 function status(sha){const file=destination(sha);try{const stat=fs.statSync(file);const ready=stat.isFile()&&stat.size<=MAX_ORIGINAL_BYTES&&crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===sha;return {ready,bytes:stat.size};}catch(e){if(e.code==='ENOENT')return {ready:false};throw e;}}
 async function receive(stream,sha,name,length){
  const final=destination(sha);
  if(!Number.isSafeInteger(length)||length<1||length>MAX_ORIGINAL_BYTES)throw fail('Choose an original up to 64 MB.',413);
  if(typeof name!=='string'||name.length>500)throw fail('Choose an original filename.');
  if(active)throw fail('Another original is uploading. Retry this same save shortly.',409);
  active=true;let handle,temp;
  try{
   fs.mkdirSync(root,{recursive:true,mode:0o700});temp=path.join(root,'.upload-'+crypto.randomUUID());handle=await fs.promises.open(temp,'wx',0o600);
   let received=0;const digest=crypto.createHash('sha256');
   for await(const chunk of stream){received+=chunk.length;if(received>length||received>MAX_ORIGINAL_BYTES)throw fail('Original upload exceeds its reviewed size.',413);digest.update(chunk);await handle.writeFile(chunk);}
   if(received!==length||digest.digest('hex')!==sha)throw fail('The uploaded original does not match the reviewed file.',409);
   await handle.sync();await handle.close();handle=null;
   const original=inspectOriginal(await fs.promises.readFile(temp),name);
   // An atomic rename publishes only complete, verified bytes. Matching uploads
   // reuse the same immutable content address, including after a lost response.
   await fs.promises.rename(temp,final);temp=null;
   return {ready:true,bytes:received,sha256:original.sha256};
  }finally{if(handle)await handle.close();if(temp)await fs.promises.rm(temp,{force:true});active=false;}
 }
 return {resolve,status,receive};
}
module.exports={MAX_ORIGINAL_BYTES,inspectOriginal,createOriginalUploads};
