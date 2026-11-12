'use strict';
function problem(message,status=400){return Object.assign(new Error(message),{status});}
function requestChanges(license,reason,confirmed){
 if(confirmed!==true)throw problem('Confirm the creator decision before requesting changes.');
 if(typeof reason!=='string'||reason.trim().length<10||reason.trim().length>1000)throw problem('Explain the changes needed in 10–1,000 characters.');
 reason=reason.trim();
 if(license.status==='changes_requested'&&license.creatorDecision?.reason===reason)return license;
 if(license.status!=='requested')throw problem('Only a proposal awaiting the creator can receive a changes request.',409);
 return {...license,status:'changes_requested',creatorDecision:{kind:'changes_requested',reason,decidedAt:new Date().toISOString()}};
}
function revisionLink(previous,request){
 if(!previous||previous.status!=='changes_requested')throw problem('Open a proposal with requested changes before preparing its revision.',409);
 if(JSON.stringify(previous.request)===JSON.stringify(request))throw problem('Change the scope to address the creator feedback, then review it again.',409);
 return {id:previous.id,decisionAt:previous.creatorDecision.decidedAt,reason:previous.creatorDecision.reason};
}
module.exports={requestChanges,revisionLink};
