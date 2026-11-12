'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function binding(l){
 return digest({id:l.id,orderId:l.orderId,request:l.request,quote:l.quote,assetDelivery:l.assetDelivery,assetEdition:l.assetEdition,policySnapshot:l.policySnapshot});
}
function failure(message,status=409){return Object.assign(new Error(message),{status});}
function recoveryReceipts({directory,inspect,matchingCapture}){
 if(!directory||!path.isAbsolute(directory))throw Error('Recovery receipts require an absolute persistent directory.');
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const attempts=new Map();
 function eligible(l){return l&&['awaiting_payment','capture_unknown'].includes(l.status)&&typeof l.orderId==='string'&&l.orderId.length>0&&l.assetDelivery;}
 function resolve(l){
  if(!eligible(l))return l;
  let receipt;try{receipt=JSON.parse(fs.readFileSync(path.join(directory,l.id+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return l;throw e;}
  if(receipt.version!==1||receipt.binding!==binding(l)||!receipt.captureId)return l;
  return {...l,status:'issued',captureId:receipt.captureId,receiptVersion:2,issuedAt:receipt.verifiedAt,recovery:{state:'ready'}};
 }
 async function check(l){
  const known=resolve(l);if(known?.status==='issued')return known;
  if(!eligible(l))throw failure('This record has no retained order ready for payment inspection.');
  const previous=attempts.get(l.id);
  if(previous&&Date.now()-previous<10000)throw failure('The saved order was just checked. Wait a few seconds before checking again.',429);
  // Bound the in-memory throttle. The unguessable record reference permits only a
  // read of its retained order; callers cannot supply an alternative provider ID.
  if(attempts.size>=1000)attempts.delete(attempts.keys().next().value);
  attempts.set(l.id,Date.now());
  const order=await inspect(l),capture=matchingCapture(order,l);
  if(!capture)throw failure('PayPal has not confirmed a completed payment matching these saved terms. No payment was taken by this check.');
  const receipt={version:1,binding:binding(l),captureId:capture.id,verifiedAt:new Date().toISOString()};
  const destination=path.join(directory,l.id+'.json'),temp=destination+'.'+crypto.randomUUID()+'.tmp';
  let fd;try{
   fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,JSON.stringify(receipt)+'\n');fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
   fs.renameSync(temp,destination);
   const directoryFd=fs.openSync(directory,'r');try{fs.fsyncSync(directoryFd);}finally{fs.closeSync(directoryFd);}
  }finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
  return resolve(l);
 }
 return {resolve,check};
}
module.exports={recoveryReceipts};
