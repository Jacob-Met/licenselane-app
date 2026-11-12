'use strict';
// Creator references stay read-only. Explicit buyer continuation uses a URL fragment,
// removed before any request. The server validates it before the browser adopts access.
window.recordHandoff=(()=>{
 const pattern=/^[a-f0-9]{64}$/,pendingKey='licenselane:pending-record-link';
 // Tab-scoped pending links are not authority: restoreBuyerAccess must still validate them.
 function validPending(value){return value&&typeof value==='object'&&pattern.test(value.id||'')&&typeof value.buyer==='boolean'&&!value.invalid&&(!value.buyer||pattern.test(value.token||''));}
 function keepPending(value){try{if(validPending(value))sessionStorage.setItem(pendingKey,JSON.stringify(value));else sessionStorage.removeItem(pendingKey);}catch{}}
 function readPending(){try{const value=JSON.parse(sessionStorage.getItem(pendingKey)||'null');if(validPending(value))return value;sessionStorage.removeItem(pendingKey);}catch{}return null;}
 let pending=takeHash()||readPending(),ready=false,opening=false;
 function takeHash(){
  const buyer=location.hash.startsWith('#buyer=');
  if(!buyer&&!location.hash.startsWith('#record='))return null;
  const raw=location.hash.slice(buyer?7:8);
  const [id,token,...extra]=raw.split('.');
  const value={id:buyer?id:raw,token:buyer?token:null,buyer,invalid:buyer&&extra.length>0};
  keepPending(value);
  history.replaceState(history.state,'',location.pathname+location.search);
  return value;
 }
 function notice(message,failed=false){
  let box=document.getElementById('record-link-notice');
  if(!box){box=document.createElement('section');box.id='record-link-notice';box.className='record-link-notice';box.setAttribute('aria-live','polite');document.getElementById('vault').after(box);}
  box.replaceChildren();
  const title=document.createElement('strong');title.textContent=failed?'Record link could not be opened':'Opening the shared record';
  const text=document.createElement('p');text.textContent=message;box.append(title,text);return box;
 }
 async function restore(){
  ready=true;
  if(pending===null)return false;
  const request=pending,id=request.id;
  if(opening)return true;
  if(request.invalid||!pattern.test(id)||(request.buyer&&!pattern.test(request.token||''))){notice('This private link is incomplete. Ask the sender to copy it again from the saved record.',true);pending=null;keepPending(null);return true;}
  opening=true;
  const box=notice('Checking the saved proposal on this LicenseLane server. Opening a link never starts a payment.');
  try{
   const applied=request.buyer?await restoreBuyerAccess(id,request.token,()=>pending===request):await openLicense(id);
   if(pending!==request)return true;
   pending=null;keepPending(null);box.remove();
   if(applied!==false&&!request.buyer&&!state.config?.recoveryOnly&&state.license?.status!=='issued')toast('Shared record opened. Buyer checkout access was not included.');
  }catch{
   if(pending!==request)return true;
   notice(request.buyer?'Buyer access could not be restored. Retry or use your saved buyer-access file.':'The record is unavailable here. Check that this is the original server, or retry when it is reachable. Your other records are still in Your license records.',true);
   const retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='Retry this record';
   retry.addEventListener('click',()=>restore());box.append(retry);
  }finally{opening=false;if(pending!==null&&pending!==request)restore();}
  return true;
 }
 function contact(license){
  const address=license.quote?.creatorContactEmail;if(!address)return null;
  const box=document.createElement('section');box.className='creator-contact-box';box.setAttribute('aria-label','Creator contact');
  const recipient=document.createElement('p');recipient.className='creator-contact';recipient.textContent=address;
  const email=document.createElement('a');email.className='creator-contact-action';email.textContent=license.status==='requested'?'Email request to creator':'Email creator';
  const reference=location.origin+location.pathname+'#record='+license.id;
  const pending=license.status==='requested',quote=license.quote,request=license.request;
  const lines=[pending?'Please review this license request.':'About my saved license record.','',
   'Work: '+quote.assetTitle,'Buyer: '+request.licensee,'Project: '+request.project,
   'Use: '+request.medium+(request.medium==='print'?' · '+request.copies+' copies':''),
   'Scope: '+quote.term+' · '+quote.territory,
   ...(quote.period?['Dates: '+quote.period.startsOn+' through '+quote.period.endsOn+' · UTC']:[]),
   'Saved amount: '+quote.currency+' '+(quote.priceCents/100).toFixed(2),'',reference];
  email.href='mailto:'+encodeURIComponent(address)+'?subject='+encodeURIComponent((pending?'License request: ':'License record: ')+quote.assetTitle)+'&body='+encodeURIComponent(lines.join('\n'));

  box.append(recipient,email);return box;
 }

 function decisionControls(license){
  if(!['approved','awaiting_payment','changes_requested','issued'].includes(license.status))return null;
  const request=license.request,quote=license.quote,correction=license.status==='changes_requested',issued=license.status==='issued';
  const ended=licenseScope.periodState(quote.period)==='ended';
  const decision=correction?'Changes requested':issued?'License issued (Sandbox)':'Terms approved';
  const next=correction?'Prepare a corrected proposal from this saved record for a new creator decision.':issued?(license.recovery?.state==='pending'?'Your payment was received; the files are still being prepared. Open the saved record to check their availability.':'Open this saved record to download your purchased files and exact terms.'):(ended?'The saved use period has ended. Request new dates before checkout.':'Payment is still required before this permission is active. Open your saved record to continue checkout.');
  const reference=location.origin+location.pathname+'#record='+license.id;
  const lines=[decision+' — '+quote.assetTitle,'','For '+request.licensee,'Project: '+request.project,
   ...(correction?['','Changes needed: '+license.creatorDecision.reason]:[]),'',
   'Saved use: '+request.medium+(request.medium==='print'?' · '+request.copies+' copies':''),
   'Scope: '+quote.term+' · '+quote.territory,
   ...(quote.period?['Dates: '+quote.period.startsOn+' through '+quote.period.endsOn+' · UTC']:[]),
   (issued?'Paid amount (Sandbox): ':'Saved amount: ')+quote.currency+' '+(quote.priceCents/100).toFixed(2),'',next,
   ...(!issued?['If this opens without your buyer access, restore your private buyer-access file or return to the browser where you saved the request.']:[]),'',reference];
  const box=document.createElement('section');box.className='creator-decision-handoff';box.setAttribute('aria-label','Decision for the buyer');
  const title=document.createElement('h3');title.textContent='Send your decision to the buyer';
  const status=document.createElement('p');status.className='decision-handoff-summary';status.textContent=decision+' · '+quote.assetTitle;
  const copy=document.createElement('button');copy.type='button';copy.className='primary';copy.textContent='Copy decision & record link';
  const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Read message';
  const input=document.createElement('textarea');input.readOnly=true;input.rows=9;input.spellcheck=false;input.value=lines.join('\n');input.setAttribute('aria-label','Message for the buyer');detail.append(summary,input);
  const feedback=document.createElement('p');feedback.className='muted';feedback.setAttribute('role','status');
  copy.addEventListener('click',async()=>{
   try{if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(input.value);feedback.textContent='Decision copied. Share it with the buyer; no message has been sent.';}
   catch{detail.open=true;input.focus();input.select();feedback.textContent='Message selected. Use your device’s Copy action, then share it with the buyer.';}
  });
  box.append(title,status,copy,detail,feedback);return box;
 }

 function controls(license){
  const box=document.createElement('details');box.className='record-handoff';
  const summary=document.createElement('summary');summary.textContent='Share this record with the creator';
  const note=document.createElement('p');note.textContent='Anyone with this private link can read these terms. It does not include your buyer checkout access or approve the proposal. Share it only with the intended recipient.';
  const label=document.createElement('label');label.textContent='Private record link';
  const input=document.createElement('input');input.type='text';input.readOnly=true;input.spellcheck=false;input.autocomplete='off';input.setAttribute('aria-label','Private record link');
  input.value=location.origin+location.pathname+'#record='+license.id;
  input.addEventListener('click',()=>input.select());label.append(input);
  const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Copy private record link';
  const feedback=document.createElement('p');feedback.className='muted';feedback.setAttribute('role','status');
  button.addEventListener('click',async()=>{
   try{if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(input.value);feedback.textContent='Link copied. No message has been sent.';}
   catch{input.focus();input.select();feedback.textContent='Link selected. Use your device’s Copy action, then share it yourself.';}
  });
  box.append(summary,note,label,button,feedback);
  if(['localhost','127.0.0.1','::1','[::1]'].includes(location.hostname)){
   const local=document.createElement('p');local.className='muted';local.textContent='This app is running on a local address. This link works in another browser on this computer; another device needs access to the same LicenseLane server.';box.append(local);
  }
  return box;
 }
 addEventListener('hashchange',event=>{
  const id=takeHash();
  // Rapid hash changes can leave older events queued after the latest link is consumed.
  // Cancel older reads once, before starting that link; ignore superseded hash events.
  if(id!==null||new URL(event.newURL).hash===location.hash)dispatchEvent(new Event('licenselane:navigation'));
  if(id!==null){pending=id;if(ready)restore();}
 });
 function buyerControls(license,token){
  const box=document.createElement('details');box.className='record-handoff buyer-continuation';
  const summary=document.createElement('summary');summary.textContent='Continue on another device';
  const note=document.createElement('p');note.textContent='Private buyer link — keep it for yourself.';
  const label=document.createElement('label');label.textContent='Buyer continuation link';
  const input=document.createElement('input');input.type='text';input.readOnly=true;input.spellcheck=false;input.autocomplete='off';input.setAttribute('aria-label','Buyer continuation link');
  // Do not put the capability in the document until its owner opens this control.
  box.addEventListener('toggle',()=>{input.value=box.open?location.origin+location.pathname+'#buyer='+license.id+'.'+token:'';});
  input.addEventListener('click',()=>input.select());label.append(input);
  const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Copy my buyer link';
  const feedback=document.createElement('p');feedback.className='muted';feedback.setAttribute('role','status');
  button.addEventListener('click',async()=>{
   try{if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');await navigator.clipboard.writeText(input.value);feedback.textContent='Private buyer link copied.';}
   catch{input.focus();input.select();feedback.textContent='Link selected. Use your device’s Copy action.';}
  });
  box.append(summary,note,label,button,feedback);return box;
 }
 return {restore,controls,contact,decisionControls,buyerControls,pendingReference:()=>validPending(pending)?pending.id:null};
})();
