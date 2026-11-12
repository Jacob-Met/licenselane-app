'use strict';
// The completed purchase is a destination, not another section of the request form.
let paidRecoveryRefresh=null;
function stopPaidRecoveryRefresh(){
 const check=paidRecoveryRefresh;paidRecoveryRefresh=null;
 if(!check)return;clearTimeout(check.timer);check.controller?.abort();
}
function paidRecoveryActive(check){
 return paidRecoveryRefresh===check&&!document.hidden&&state.license?.id===check.id
  &&state.license?.recovery?.state==='pending'&&document.body.classList.contains('paid-record-view')
  &&!!document.querySelector('.paid-backup');
}
function paintPaidRecoveryRefresh(){
 const check=paidRecoveryRefresh,box=document.querySelector('.paid-backup');
 if(!check||!box)return;
 box.setAttribute('aria-busy',String(check.inFlight));
 box.querySelector('[data-backup-status]').textContent=check.error?'Could not check the recovery copy.':check.paused?'Recovery copy is still pending.':'Saving recovery copy…';
 const button=box.querySelector('button');button.disabled=check.inFlight;
 button.textContent=check.error?'Retry recovery check':'Check recovery backup';
}
async function refreshPaidRecovery(check,manual=false){
 if(!paidRecoveryActive(check)){if(paidRecoveryRefresh===check)stopPaidRecoveryRefresh();return;}
 if(check.inFlight)return;clearTimeout(check.timer);
 if(manual){check.started=Date.now();check.attempts=0;check.paused=false;check.error=false;}
 check.inFlight=true;paintPaidRecoveryRefresh();
 const controller=new AbortController();check.controller=controller;
 const timeout=setTimeout(()=>controller.abort(),8000);
 try{
  const data=await api('/api/licenses/'+check.id,undefined,{signal:controller.signal});
  if(!paidRecoveryActive(check))return;
  if(data.license?.id!==check.id)throw Error('The saved record did not match.');
  const hadFocus=document.activeElement===document.querySelector('.paid-backup button');
  state.license=data.license;state.certificate=data.certificate||null;
  if(data.license.status!=='issued'||data.license.recovery?.state!=='pending'){
   rememberLicense(data.license);stopPaidRecoveryRefresh();displayLicense(false);
   const ready=document.querySelector('.paid-backup-ready');
   if(hadFocus&&ready){ready.tabIndex=-1;ready.focus({preventScroll:true});}
   return;
  }
  check.attempts++;check.paused=Date.now()-check.started>=30000||check.attempts>=12;
 }catch(error){
  if(paidRecoveryRefresh===check){check.error=true;check.paused=true;}
 }finally{
  clearTimeout(timeout);check.controller=null;check.inFlight=false;
  if(paidRecoveryActive(check)){
   paintPaidRecoveryRefresh();
   if(!check.paused)check.timer=setTimeout(()=>refreshPaidRecovery(check),1500);
  }
 }
}
function watchPaidRecovery(l){
 if(l.recovery?.state!=='pending'||document.hidden){stopPaidRecoveryRefresh();return;}
 if(paidRecoveryRefresh?.id===l.id){paintPaidRecoveryRefresh();return;}
 stopPaidRecoveryRefresh();
 const check={id:l.id,started:Date.now(),attempts:0,inFlight:false,paused:false,error:false,controller:null,timer:null};
 paidRecoveryRefresh=check;paintPaidRecoveryRefresh();
 check.timer=setTimeout(()=>refreshPaidRecovery(check),0);
}
window.addEventListener('pagehide',stopPaidRecoveryRefresh);
window.addEventListener('hashchange',stopPaidRecoveryRefresh);
window.addEventListener('licenselane:viewchange',()=>{if(paidRecoveryRefresh&&!paidRecoveryActive(paidRecoveryRefresh))stopPaidRecoveryRefresh();});
document.addEventListener('visibilitychange',()=>{
 if(document.hidden)stopPaidRecoveryRefresh();
 else if(state.license?.status==='issued'&&document.body.classList.contains('paid-record-view'))watchPaidRecovery(state.license);
});

function leavePaidRecord(){
 stopPaidRecoveryRefresh();
 if(state.config?.recoveryOnly){$('checkout-section').hidden=true;document.body.classList.remove('paid-record-view');$('vault').open=true;$('vault').scrollIntoView({block:'start'});$('license-reference').focus();return;}
 document.body.classList.remove('paid-record-view');
 history.replaceState(history.state,'','#work-section');
 window.dispatchEvent(new Event('licenselane:viewchange'));
 $('work-section').focus({preventScroll:true});$('work-section').scrollIntoView({block:'start'});
}
function displayPaidRecord(l,scroll=true){
 const deliveryPending=l.recovery?.state==='pending';
 if(state.config?.recoveryOnly)$('vault').open=false;
 document.body.classList.add('paid-record-view');$('checkout-section').hidden=false;
 $('record-stage-title').textContent='Your saved license and files';
 const root=el('article','paid-record');root.setAttribute('aria-label',deliveryPending?'Payment received; files preparing':'Completed Sandbox purchase');
 const creatorView=state.creatorReviewRecordId===l.id;
 const back=el('button','record-back',state.config?.recoveryOnly?'← Saved records':creatorView?'← Back to inbox':'← Browse works');back.type='button';back.addEventListener('click',()=>{
  if(!creatorView){leavePaidRecord();return;}
  document.body.classList.remove('paid-record-view');window.dispatchEvent(new Event('licenselane:viewchange'));
  const inbox=$('creator-inbox'),link=document.querySelector('a[href="#creator-inbox"]');
  if(link)link.click();else if(inbox){inbox.open=true;inbox.scrollIntoView({block:'start'});inbox.querySelector('summary')?.focus({preventScroll:true});}
  inbox?.querySelector('.inbox-form')?.requestSubmit();
 });
 const nav=el('div','record-toolbar');const records=el('a','','Your records');records.href='#vault';records.addEventListener('click',()=>{$('vault').open=true;});nav.append(back,records);root.append(nav);
 const top=el('header','paid-heading');const title=el('div');title.append(el('p','paid-status',deliveryPending?'Payment received':'Verified license issued'),el('h2','paid-title',l.quote.assetTitle),el('p','paid-project',l.request.project));if(l.quote.period){const kind=licenseScope.periodState(l.quote.period);title.append(el('p','paid-validity',kind==='ended'?'Use period ended '+l.quote.period.endsOn:kind==='upcoming'?'Use starts '+l.quote.period.startsOn:'Use through '+l.quote.period.endsOn));}
 const amount=el('div','paid-amount');amount.append(el('strong','',money(l.quote.priceCents)),el('span','','Paid in Sandbox'));top.append(title,amount);root.append(top);
 if(creatorView){const decision=window.recordHandoff.decisionControls(l);if(decision)root.append(decision);}
 const file=el('section','paid-file');file.setAttribute('aria-label','Your purchased file');const edition=window.licenseEdition(l),fingerprint=edition.querySelector('.saved-edition-fingerprint');if(fingerprint)fingerprint.remove();file.append(edition);
 const downloads=el('div','paid-downloads');
 if(deliveryPending){const preparing=el('button','paid-download','Preparing your files…');preparing.type='button';preparing.disabled=true;downloads.append(preparing);}
 else{
  if(l.assetDelivery){
   const purchase=el('a','paid-download','Download purchase · ZIP');purchase.href='/api/licenses/'+l.id+'/purchase';purchase.download='';downloads.append(purchase);
   downloads.append(el('span','paid-download-contents','Original · terms · certificate'));
   const a=el('a','paid-terms paid-original','Download '+l.assetDelivery.filename);a.href='/api/licenses/'+l.id+'/asset';a.download='';downloads.append(a);
  }
  else downloads.append(el('p','','No downloadable asset was recorded for this license.'));
  const terms=el('a','paid-terms','Download exact terms');terms.href='/api/licenses/'+l.id+'/terms';terms.download='';downloads.append(terms);
 }
 file.append(downloads);root.append(file);
 const buyerToken=state.buyerAccess.get(l.id);
 if(buyerToken){
  const keep=el('section','paid-keep-access');keep.setAttribute('aria-label','Keep your buyer access');
  const copy=el('div');copy.append(el('h3','','Keep this purchase'),el('p','','Save your private access file to reopen this record in another browser.'));
  const save=el('button','secondary','Save buyer access');save.type='button';save.addEventListener('click',()=>downloadBuyerAccess(l));
  keep.append(copy,save,window.recordHandoff.buyerControls(l,buyerToken));root.append(keep);
 }

 if(l.recovery?.state==='pending'){
  const pending=el('section','paid-backup');pending.setAttribute('aria-label','Recovery backup');
  const message=el('p','','Saving recovery copy…');message.dataset.backupStatus='';message.setAttribute('role','status');pending.append(message);
  const check=el('button','secondary','Check recovery backup');check.type='button';check.addEventListener('click',()=>{if(paidRecoveryRefresh?.id!==l.id)watchPaidRecovery(l);if(paidRecoveryRefresh?.id===l.id)refreshPaidRecovery(paidRecoveryRefresh,true);});pending.append(check);root.append(pending);
 }else if(l.recovery?.state==='ready'){const ready=el('p','paid-backup-ready','Backed up for recovery');ready.setAttribute('role','status');root.append(ready);}
 const scope=el('p','paid-scope',l.request.licensee+' · '+l.request.medium+(l.request.copies?' · '+new Intl.NumberFormat('en-US').format(l.request.copies)+' copies':'')+' · '+l.quote.term+' · '+l.quote.territory);root.append(scope);
 if(l.quote.period){const period=el('section','paid-period'),kind=licenseScope.periodState(l.quote.period);period.append(el('h3','',kind==='upcoming'?'Your use period starts '+l.quote.period.startsOn:kind==='ended'?'This use period has ended':'Your agreed use period'),el('p','',licenseScope.periodLabel(l.quote.period)));if(kind==='ended')period.append(el('p','','Your purchased files remain available. A new use needs a new request.'));root.append(period);}
 if(!creatorView){const contact=window.recordHandoff.contact(l);if(contact)root.append(contact);}
 const details=el('details','paid-details');details.append(el('summary','','License terms and payment record'));const dl=el('dl','license-summary');
 for(const [name,value] of [['Work',l.quote.assetTitle],['Creator',l.quote.creator],['Licensee',l.request.licensee],['Project',l.request.project],['Use',l.request.medium+' · '+l.request.copies+' physical copies'],['Term',l.quote.term+' · '+l.quote.territory],['Agreed dates',l.quote.period?licenseScope.periodLabel(l.quote.period):'Not recorded in this saved agreement'],['Attribution','Credit '+l.quote.creator],['Rights','Nonexclusive; no AI training, resale or copyright transfer'],['License record',l.id],['PayPal order',l.orderId],['Sandbox capture',l.captureId]]){dl.append(el('dt','',name),el('dd','',String(value??'Not recorded')));}
 details.append(dl);const briefSection=requestBrief(l.request);if(briefSection)details.append(briefSection);if(fingerprint)details.append(fingerprint);
 if(!deliveryPending&&state.certificate){const c=state.certificate;details.append(el('p','paid-certificate-id','Certificate '+c.certificateId));const integrity=el('details','paid-fingerprint');integrity.append(el('summary','','Certificate fingerprint'),el('code','',c.integritySha256));details.append(integrity);const b=el('button','secondary','Download certificate JSON');b.type='button';b.addEventListener('click',downloadCertificate);details.append(b);}
 if(!deliveryPending&&state.certificate&&window.LicenseCertificate){const certificateSection=el('details','paid-details paid-issued-certificate');certificateSection.setAttribute('aria-label','Issued certificate');certificateSection.append(el('summary','','View or print certificate'));const printButton=el('button','secondary','Print certificate');printButton.type='button';const issuedCertificate=state.certificate;printButton.addEventListener('click',()=>window.LicenseCertificate.print(issuedCertificate));certificateSection.append(printButton,window.LicenseCertificate.create(issuedCertificate));root.append(certificateSection);}
 root.append(details);
 if(!state.config?.recoveryOnly&&!creatorView){
  const ended=licenseScope.periodState(l.quote.period)==='ended';
  const next=el('section','paid-next-use'),copy=el('div');copy.append(el('h3','',ended?'License this work again':'License another use'),el('p','',ended?'Choose a new start date, then review your next use.':'Start with this work and saved scope, then edit your new request.'));
  const reuse=el('button','secondary',ended?'Choose next use dates':'Use as new request');reuse.type='button';
  reuse.addEventListener('click',()=>beginProposalRevision(l,reuse,{separate:true}));
  next.append(copy,reuse);if(ended)root.querySelector('.paid-period').after(next);else root.append(next);
 }

 const recovery=el('details','paid-details paid-recovery');recovery.append(el('summary','','Keep or share this record'));recovery.append(el('p','','Keep the private buyer-access file for yourself. Share only the read-only record link or recovery reference.'));
 const actions=el('div','actions');
 const ref=el('button','secondary','Save recovery reference');ref.type='button';ref.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([recoveryAddress()?[l.id,'','LicenseLane saved record',l.quote.assetTitle+' — '+l.request.project,'','Primary: '+(state.config?.recoveryOnly?(state.config.primaryUrl||state.config.recoveryOrigin):location.origin)+'/#record='+l.id,'Recovery copy: '+recoveryAddress()+'/#record='+l.id,'','The recovery copy contains retained records; newer changes may not be present.',''].join('\n'):l.id+'\n'],{type:'text/plain'})),a=el('a');a.href=url;a.download='LicenseLane-'+l.id.slice(0,12)+'-reference.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);});actions.append(ref);if(recoveryAddress()&&!state.config?.recoveryOnly){const link=el('a','secondary','Open recovery copy');link.href=recoveryAddress()+'/#record='+l.id;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}recovery.append(actions,window.recordHandoff.controls(l));root.append(recovery);
 replace('checkout',[root]);window.dispatchEvent(new Event('licenselane:viewchange'));
 if(scroll){$('checkout-section').scrollIntoView({block:'start'});const heading=root.querySelector('.paid-title');heading.tabIndex=-1;heading.focus({preventScroll:true});}
 watchPaidRecovery(l);
}

// Retain only the operator-configured destination, never a buyer capability.
const SAVED_RECOVERY_ORIGIN_KEY='licenselane-recovery-origin-v1';
function exactRecoveryOrigin(value){
 try{const url=new URL(value);return url.protocol==='https:'&&url.origin===value?value:null;}catch{return null;}
}
function rememberRecoveryAddress(config){
 if(config?.recoveryOnly)return;
 try{const origin=exactRecoveryOrigin(config?.recoveryUrl);if(origin){localStorage.setItem(SAVED_RECOVERY_ORIGIN_KEY,origin);if('serviceWorker' in navigator)navigator.serviceWorker.register('/offline-shell.js',{scope:'/',updateViaCache:'none'}).catch(()=>{});}else localStorage.removeItem(SAVED_RECOVERY_ORIGIN_KEY);}catch{}
}
function savedRecoveryLink(){
 let origin,id;try{origin=exactRecoveryOrigin(localStorage.getItem(SAVED_RECOVERY_ORIGIN_KEY));id=localStorage.getItem(SAVED_LICENSE_KEY);}catch{return null;}
 if(!origin)return null;
 const link=el('a','secondary','Open saved recovery copy');link.href=origin+(/^[a-f0-9]{64}$/.test(id||'')?'/#record='+id:'/');link.rel='noopener noreferrer';return link;
}

function showSavedRecovery(){
 document.querySelector('.startup-recovery')?.remove();const link=savedRecoveryLink();if(!link)return false;
 const card=el('section','startup-recovery');card.setAttribute('aria-label','Saved artwork recovery');card.append(el('h2','','Your saved artwork'),el('p','','The primary desk is unavailable. Open your retained records on the recovery copy.'),link);
 document.body.classList.add('startup-recovery-view');$('desk').prepend(card);clearTimeout(window.toastHandle);$('toast').hidden=true;return true;
}
function clearSavedRecovery(){document.querySelector('.startup-recovery')?.remove();document.body.classList.remove('startup-recovery-view');}
