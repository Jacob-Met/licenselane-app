'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function checkpointBarrier(options={}){
 const statusFile=options.statusFile??process.env.LICENSELANE_CHECKPOINT_STATUS;
 const requestFile=options.requestFile??process.env.LICENSELANE_CHECKPOINT_REQUEST;
 if(!statusFile&&!requestFile)return null;
 if(!statusFile||!requestFile||!path.isAbsolute(statusFile)||!path.isAbsolute(requestFile))throw Error('Checkpoint status and request require absolute paths.');
 const timeoutMs=options.timeoutMs??15000,pollMs=options.pollMs??100;
 function acknowledged(license){
  if(!license.recoveryVersion)return true;
  try{const value=JSON.parse(fs.readFileSync(statusFile,'utf8'));return value.state==='replicated'&&value.record_versions?.[license.id]===license.recoveryVersion;}catch{return false;}
 }
 function request(license){
  const tmp=requestFile+'.'+crypto.randomBytes(8).toString('hex');
  try{fs.writeFileSync(tmp,JSON.stringify({id:license.id,version:license.recoveryVersion}),{mode:0o600});fs.renameSync(tmp,requestFile);}finally{try{fs.unlinkSync(tmp);}catch{}}
 }
 return {acknowledged,async wait(license){
  if(acknowledged(license))return true;
  try{request(license);}catch{return false;}
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){if(acknowledged(license))return true;await new Promise(r=>setTimeout(r,pollMs));}
  return acknowledged(license);
 }};
}
module.exports={checkpointBarrier};
