'use strict';
const state={catalog:null,config:null,selected:'lantern-atlas',review:null,license:null,certificate:null,restored:false,vault:new Map(),buyerAccess:new Map(),revisionOf:null,creatorReviewRecordId:null};
const $=id=>document.getElementById(id);
function el(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
function replace(id,nodes){const target=$(id);target.replaceChildren(...nodes);}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(window.toastHandle);window.toastHandle=setTimeout(()=>$('toast').hidden=true,4800);}
// A browser's observed payment is a continuity hint, never delivery authority.
const observedPayments=new Map(),OBSERVED_PAYMENT_PREFIX='licenselane:observed-payment:';
function retainObservedPayment(data){
 const license=data?.license;
 if(!license||!/^([a-f0-9]{64})$/.test(license.id||''))return data;
 const valid=value=>value&&typeof value.orderId==='string'&&value.orderId.length>0&&value.orderId.length<=128&&typeof value.captureId==='string'&&value.captureId.length>0&&value.captureId.length<=128;
 let observed=observedPayments.get(license.id);
 if(!observed){try{const saved=JSON.parse(localStorage.getItem(OBSERVED_PAYMENT_PREFIX+license.id)||'null');if(valid(saved))observed=saved;}catch{}}
 if(license.status==='issued'&&valid(license)){
  observed={orderId:license.orderId,captureId:license.captureId};
  observedPayments.set(license.id,observed);
  try{localStorage.setItem(OBSERVED_PAYMENT_PREFIX+license.id,JSON.stringify(observed));}catch{}
 }else if(observed&&['approved','creating_order','awaiting_payment','capture_unknown','order_unknown'].includes(license.status)){
  license.paymentObservation={orderId:observed.orderId,captureId:observed.captureId,mismatch:license.orderId!==observed.orderId};
  data.certificate=null;
 }
 return data;
}
async function api(endpoint,body,options={}){const response=await fetch(endpoint,{signal:options.signal,method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok){const error=new Error(data.error||'Request failed.');error.status=response.status;error.code=data.code;error.work=data.work;throw error;}return retainObservedPayment(data);}
// Keep the live catalog current without replacing the buyer's entered scope.
function refreshCatalogWork(work){
 if(!work?.id||!state.catalog)return;
 const index=state.catalog.works.findIndex(item=>item.id===work.id);
 if(index<0)return;
 const previous=state.catalog.works[index];
 if(Number.isInteger(previous.offerRevision)&&Number.isInteger(work.offerRevision)&&work.offerRevision<previous.offerRevision)return;
 const keepPaidView=state.license?.status==='issued'&&document.body.classList.contains('paid-record-view');
 state.catalog.works[index]=work;
 drawWorks();
 if(keepPaidView)document.body.classList.add('paid-record-view');
}
function selectedOfferPaused(){return state.catalog?.works.find(work=>work.id===state.selected)?.offerStatus==='paused';}
function syncOfferAvailability(){
 const unavailable=selectedOfferPaused()||!state.catalog?.works.some(work=>work.id===state.selected),button=document.querySelector('#request-form button[type=submit]');
 if(button)button.disabled=unavailable||!$('review-pending').hidden;
 $('review-rules').disabled=unavailable;
}
function showPausedOffer(){
 const note=$('draft-change'),choose=el('a','','Choose another work');
 choose.href='#work-section';
 choose.addEventListener('click',event=>{event.preventDefault();const target=document.querySelector('.work:not(:disabled)')||$('work-section');target.focus({preventScroll:true});$('work-section').scrollIntoView({behavior:'smooth',block:'start'});});
 note.replaceChildren(document.createTextNode('The creator paused this offer. Your fields and saved agreement are unchanged.'));
 if(state.catalog.works.some(work=>work.offerStatus!=='paused'))note.append(document.createTextNode(' '),choose,document.createTextNode(' for a new request.'));
 note.hidden=false;syncOfferAvailability();note.scrollIntoView({behavior:'smooth',block:'center'});
}
function showUnavailableOffer(message='This offer is unavailable.'){
 const note=$('draft-change'),choose=el('a','','Choose a listed work');
 choose.href='#work-section';
 choose.addEventListener('click',event=>{event.preventDefault();const target=document.querySelector('.work:not(:disabled)')||$('work-section');target.focus({preventScroll:true});$('work-section').scrollIntoView({behavior:'smooth',block:'start'});});
 note.replaceChildren(document.createTextNode(message));
 if(state.catalog.works.some(work=>work.offerStatus!=='paused'))note.append(document.createTextNode(' '),choose,document.createTextNode(' for a new request.'));
 note.hidden=false;syncOfferAvailability();
}
async function selectLinkedWork(id){
 state.linkedWorkId=id;
 state.review=null;state.license=null;state.certificate=null;state.restored=false;
 $('result-section').hidden=true;$('checkout-section').hidden=true;$('approval').hidden=true;
 let work=state.catalog.works.find(item=>item.id===id);
 state.selected=work?.id||null;drawWorks();
 if(!work){
  showUnavailableOffer('Loading the requested offer…');
  try{
   const result=await boundedRead('/api/catalog/'+encodeURIComponent(id),undefined,'This artwork is taking too long to load.');
   if(state.selected!==null||state.license)return;
   if(result.work?.id!==id){showUnavailableOffer();return;}
   work=result.work;state.catalog.works.push(work);state.selected=id;drawWorks();
  }catch(error){
   if(state.selected!==null||state.license)return;
   showUnavailableOffer(error.status===404?'This offer is unavailable.':error.code==='READ_TIMEOUT'?error.message:'This offer could not be loaded.');
   if(error.status!==404){
    const retry=el('button','','Retry artwork');retry.type='button';retry.id='retry-linked-work';
    retry.addEventListener('click',()=>selectLinkedWork(id));
    const actions=el('span','actions');actions.append(retry);$('draft-change').append(actions);
   }
   return;
  }
 }
 if(work.offerStatus==='paused')showPausedOffer();
 else{$('draft-change').hidden=true;document.querySelector('.work[aria-checked=true]')?.scrollIntoView({block:'center'});}
}
function handleOfferPaused(error){
 if(error.code!=='OFFER_PAUSED')return false;
 refreshCatalogWork(error.work);
 if(error.work?.id!==state.selected||!selectedOfferPaused()){toast('The earlier request was not saved because that offer was paused. Your current draft is unchanged.');return true;}
 state.review=null;$('approval').hidden=true;$('result-section').hidden=true;showPausedOffer();return true;
}
function handleOfferChanged(error,submittedReview){
 if(handleOfferPaused(error))return true;
 if(error.code!=='OFFER_CHANGED')return false;
 refreshCatalogWork(error.work);
 const current=state.review;
 const currentIsOlder=current&&current.request.assetId===error.work?.id&&Number.isInteger(error.work.offerRevision)&&(!Number.isInteger(current.quote.offerRevision)||current.quote.offerRevision<error.work.offerRevision);
 if(current!==submittedReview&&!currentIsOlder){
  toast('An earlier request was not saved because the creator changed the offer. Your current draft is unchanged.');
  return true;
 }
 state.review=null;
 $('result-section').hidden=true;$('approval').hidden=true;
 const note=$('draft-change');
 note.textContent='The creator changed this offer. Your fields are unchanged. Review your request again to check its current price and terms.';
 note.hidden=false;
 const reviewButton=document.querySelector('#request-form button[type=submit]');
 reviewButton.focus({preventScroll:true});
 note.scrollIntoView({behavior:'smooth',block:'center'});
 return true;
}
function money(cents){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);}
function drawWorks(){document.body.classList.remove('paid-record-view','reviewing-proposal');const fragment=[];for(const item of state.catalog.works){
 const button=el('button','work');button.type='button';button.setAttribute('role','radio');button.setAttribute('aria-checked',String(item.id===state.selected));button.disabled=item.offerStatus==='paused';button.setAttribute('aria-label',item.title+', '+(item.offerStatus==='paused'?'paused':money(item.priceCents)));
 const art=el('img','work-visual');art.src=item.preview;art.alt='';const details=el('div','work-details');details.append(el('small','',item.kind),el('strong','',item.title),el('em','', item.offerStatus==='paused'?'Paused':'From '+money(item.priceCents)));button.append(art,details);
 button.addEventListener('click',()=>{state.selected=item.id;state.review=null;state.license=null;$('draft-change').hidden=true;$('result-section').hidden=true;$('checkout-section').hidden=true;drawWorks();document.querySelector('.work[aria-checked=true]').focus();});
 fragment.push(button);
}replace('works',fragment);const empty=!state.catalog.works.length;$('scope-section').hidden=empty;document.querySelectorAll('a[href="#scope-section"]').forEach(a=>a.hidden=empty);drawAssetPreview();syncOfferAvailability();syncRequestedScopeOffer();}
function drawAssetPreview(){
 const item=state.catalog.works.find(w=>w.id===state.selected);
 if(!item){const info=el('div','asset-info');info.append(el('h3','',state.catalog.works.length?'Offer unavailable':'New works coming soon'),el('p','',state.catalog.works.length?'Choose a listed work to start a request.':'This studio has no works available for new requests.'));replace('asset-preview',[info]);return;}
 const media=el('div','asset-media'),img=el('img');
 img.src=item.preview;img.dataset.previewUrls=JSON.stringify(item.previews||[item.preview]);img.alt=item.title+' — '+item.description;media.append(img);
 if(item.audio){const audio=el('audio');audio.controls=true;audio.preload='metadata';audio.src=item.audio;audio.setAttribute('aria-label','Listen to '+item.title);media.append(audio);}
 const info=el('div','asset-info');
 const saved=el('section','asset-saved-records');saved.id='asset-saved-records';saved.hidden=true;info.append(el('h3','',item.title),el('p','asset-creator',item.creator),saved,el('p','asset-description',item.description),el('p','asset-specs',item.specs));
 const rights=el('dl','asset-rights');
 for(const [label,value] of [
  ['Available for',item.permitted.map(m=>({website:'Website',social:'Social',print:'Print'}[m]||m)).join(' · ')],
  ['Print limit',item.maxCopies?item.maxCopies.toLocaleString('en-US')+' physical copies':'No physical copies'],
  ['Offered scope','One named project · up to '+licenseScope.label(licenseScope.offer(item).maxTermMonths)+' · '+licenseScope.offer(item).territory],
  ['Terms','Creator credit · nonexclusive · no model training']
 ])rights.append(el('dt','',label),el('dd','',value));
 info.append(rights);if(item.delivery)info.append(window.deliveryDetails(item.delivery));
 const price=el('p','asset-price');price.append(el('small','','From'),document.createTextNode(money(item.priceCents)));
 const useLink=el('a','asset-use-link','Describe your use →');useLink.href='#scope-section';useLink.setAttribute('aria-label','Describe your use of '+item.title);useLink.addEventListener('click',()=>$('scope-section').focus({preventScroll:true}));
 info.append(price,useLink);
 if(!item.custom){const link=el('a','sample-download','Download sample '+(item.download.match(/\.([a-z0-9]+)$/i)?.[1]||'file').toUpperCase());link.href=item.download;link.download='';info.append(link);}
 replace('asset-preview',[media,info]);drawSavedWorkRecords();
}
function drawSavedWorkRecords(){
 const target=$('asset-saved-records');if(!target)return;
 const records=[...state.vault.values()].map(entry=>entry.license).filter(l=>l?.request.assetId===state.selected&&!recordArchived(l.id));
 const signature=JSON.stringify(records.map(l=>[l.id,l.status,l.request.project,l.request.medium,l.request.copies,l.quote.term,l.quote.territory,l.quote.period]));
 if(target.dataset.records===signature)return;target.dataset.records=signature;const expanded=target.querySelector('details')?.open;
 target.replaceChildren();target.hidden=!records.length;if(!records.length)return;
 target.append(el('h4','','Saved for this artwork'));
 const list=el('div','asset-saved-list');
 for(const l of records.slice().reverse()){
  const row=el('article','asset-saved-record'),info=el('div');
  info.append(el('strong','',l.request.project),el('p','',recordScope(l.request.medium,l.request.copies,l.quote.term,l.quote.territory)));
  if(l.quote.period)info.append(el('small','',licenseScope.periodLabel(l.quote.period)));
  const label=l.status==='issued'?'Open saved license':'Open saved request',button=el('button','secondary',label);button.type='button';
  button.addEventListener('click',async()=>{button.disabled=true;try{await openLicense(l.id);}catch(error){toast(error.message);}finally{button.disabled=false;}});
  row.append(info,button);list.append(row);
 }
 if(records.length>1){const details=el('details'),summary=el('summary','',records.length+' saved records');details.open=!!expanded;details.append(summary,list);target.append(details);}else target.append(list);
}
function drawPolicy(){replace('policy-list',state.catalog.policy.map(p=>{const li=el('li');li.id='policy-'+p.id;li.tabIndex=-1;li.append(el('span','',p.id),el('strong','',p.title),el('p','',p.text));return li;}));}
function reviewEditField(review){
 const {request,quote}=review,failed=new Set(quote.findings.filter(f=>!f.ok).map(f=>f.policyId));
 if(failed.has('P1'))return 'medium';
 if(failed.has('P2'))return 'exclusive';
 if(failed.has('P3'))return 'attribution';
 if(failed.has('P4'))return 'training';
 if(failed.has('P5')){
  if(licenseScope.periodState(quote.period)==='ended')return 'use-start-date';
  if(request.copies>0&&request.medium!=='print')return 'medium';
  if(request.copies>quote.limits.physicalCopies)return 'copies';
  if(request.termMonths>quote.limits.maxTermMonths)return 'term-months';
  if(quote.limits.territory&&quote.limits.territory!=='Worldwide'&&request.territory?.toLocaleLowerCase('en-US')!==quote.limits.territory.toLocaleLowerCase('en-US'))return 'requested-territory';
 }
 return 'project';
}
function formRequest(){const brief=$('project-brief').value;return {...(brief.trim()?{brief}:{}),assetId:state.selected,licensee:$('licensee').value.trim(),project:$('project').value.trim(),medium:$('medium').value,copies:Number($('copies').value),...readRequestedScope(),attribution:$('attribution').checked,exclusive:$('exclusive').checked,training:$('training').checked};}
function sameRequest(a,b){return ['assetId','licensee','project','medium','copies','attribution','exclusive','training','brief'].every(key=>a[key]===b[key])&&(a.termMonths??12)===(b.termMonths??12)&&(a.territory??'Worldwide')===(b.territory??'Worldwide')&&(a.startsOn??null)===(b.startsOn??null);}
function requestBrief(request,title='Buyer brief',disclosure=false){
 if(!request.brief)return null;
 const section=el(disclosure?'details':'section','request-brief'+(disclosure?' review-disclosure request-brief-disclosure':''));section.setAttribute('aria-label',title);
 const text=el('p','request-brief-text',request.brief);if(!disclosure)text.tabIndex=0;
 section.append(el(disclosure?'summary':'h4','',title),text);return section;
}
function invalidateChangedDraft(){
 if(!state.review)return;
 if(sameRequest(state.review.request,formRequest()))return;
 document.body.classList.remove('reviewing-proposal');
 state.review=null;
 $('result-section').hidden=true;
 $('approval').hidden=true;
 const note=$('draft-change');
 note.textContent=state.license
  ? 'Your existing approved license is unchanged. Review again to start a separate request; its current checkout remains below.'
  : 'Request changed. Review the revised scope before creator approval.';
 note.hidden=false;
}

// Keep retries bound to the original creation. Pending buyer saves retain only a private lookup handle.
const pendingSaveIntents=new Map();
function saveIntent(kind,review,revises){
 const payload={request:review.request,expectedOfferRevision:review.quote.offerRevision,...(revises?(state.revisionOf?.pending?{replaces:revises}:{revises}):{})};
 const intent=JSON.stringify({kind,...payload});
 if(!pendingSaveIntents.has(intent)){
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  pendingSaveIntents.set(intent,Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join(''));
 }
 return {intent,payload,saveKey:pendingSaveIntents.get(intent)};
}
const PENDING_PROPOSAL_PREFIX='licenselane:pending-proposal:';
function pendingProposalKeys(){
 try{return Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(key=>key?.startsWith(PENDING_PROPOSAL_PREFIX)&&/^[a-f0-9]{64}$/.test(key.slice(PENDING_PROPOSAL_PREFIX.length))).map(key=>key.slice(PENDING_PROPOSAL_PREFIX.length));}catch{return [];}
}
async function retainProposalSave(save){
 try{
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(save.intent))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const previous=pendingProposalKeys().find(key=>localStorage.getItem(PENDING_PROPOSAL_PREFIX+key)===digest);
  if(previous){save.saveKey=previous;pendingSaveIntents.set(save.intent,previous);}
  localStorage.setItem(PENDING_PROPOSAL_PREFIX+save.saveKey,digest);
 }
 catch{toast('Keep this tab open until your proposal is saved. Browser recovery storage is unavailable.');}
}
const PENDING_APPROVAL_PREFIX='licenselane:pending-approval:';
function pendingApprovalKeys(){
 try{return Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(key=>key?.startsWith(PENDING_APPROVAL_PREFIX)&&/^[a-f0-9]{64}$/.test(key.slice(PENDING_APPROVAL_PREFIX.length))).map(key=>key.slice(PENDING_APPROVAL_PREFIX.length));}catch{return [];}
}
async function retainApprovalSave(save){
 try{
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(save.intent))),byte=>byte.toString(16).padStart(2,'0')).join('');
  const previous=pendingApprovalKeys().find(key=>localStorage.getItem(PENDING_APPROVAL_PREFIX+key)===digest);
  if(previous){save.saveKey=previous;pendingSaveIntents.set(save.intent,previous);}
  localStorage.setItem(PENDING_APPROVAL_PREFIX+save.saveKey,digest);
 }catch{toast('Keep this tab open until the approval is saved. Browser recovery storage is unavailable.');}
}
function finishApprovalRecovery(saveKey,license){
 try{if(savedLicenseIds().includes(license.id))localStorage.removeItem(PENDING_APPROVAL_PREFIX+saveKey);}catch{}
}
async function recoverApprovalSave(saveKey,creatorCode){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);let data;
 try{data=await api('/api/licenses/recover',{saveKey,creatorCode},{signal:controller.signal});}finally{clearTimeout(timeout);}
 if(!data?.license?.id)throw Error('The saved approval could not be restored.');
 rememberLicense(data.license);finishApprovalRecovery(saveKey,data.license);drawVault();return data.license;
}
function finishProposalRecovery(saveKey,license){
 // Do not discard the recovery handle unless the ordinary record and private access are durable.
 try{const access=savedBuyerAccess();if(access.get(license.id)===state.buyerAccess.get(license.id)&&savedLicenseIds().includes(license.id))localStorage.removeItem(PENDING_PROPOSAL_PREFIX+saveKey);}catch{}
}
async function recoverProposalSave(saveKey){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);let data;
 try{data=await api('/api/requests/recover',{saveKey},{signal:controller.signal});}finally{clearTimeout(timeout);}
 if(!data?.license?.id||!data.buyerAccessToken)throw Error('The saved proposal could not be restored. Retry when the original server is reachable.');
 await rememberBuyerAccess(data.license.id,data.buyerAccessToken);rememberLicense(data.license);
 finishProposalRecovery(saveKey,data.license);drawVault();return data.license;
}
async function recoverPendingProposalSaves(){
 let recovered=false;
 for(const saveKey of (state.config?.recoveryOnly?[]:pendingProposalKeys())){try{await recoverProposalSave(saveKey);recovered=true;}catch{}}
 return recovered;
}
function completeSaveIntent(save,license){
 if(pendingSaveIntents.get(save.intent)===save.saveKey)pendingSaveIntents.delete(save.intent);
 if(license)finishProposalRecovery(save.saveKey,license);
 drawVault();
}

const saveRetryFeedback=new Map();
function clearSaveRetryFeedback(button){
 for(const [target,feedback] of saveRetryFeedback){
  if(button&&target!==button)continue;
  target.replaceChildren(...feedback.label);feedback.note.remove();if(feedback.hint)feedback.hint.hidden=feedback.hintHidden;
  if(feedback.describedBy===null)target.removeAttribute('aria-describedby');else target.setAttribute('aria-describedby',feedback.describedBy);
  saveRetryFeedback.delete(target);
 }
}
function showSaveRetry(button,error,review){
 if(error.status!==undefined||state.review!==review||!sameRequest(review.request,formRequest()))return false;
 clearTimeout(window.toastHandle);$('toast').hidden=true;
 let feedback=saveRetryFeedback.get(button);
 if(!feedback){
  const proposal=button.closest('.proposal-decision')?saveIntent('proposal',review,state.revisionOf?.id):null;
  const approval=button.id==='approve'?saveIntent('approved',review):null;
  const durable=proposal?pendingProposalKeys().includes(proposal.saveKey):approval&&pendingApprovalKeys().includes(approval.saveKey);
  const note=el('p','model-note save-retry-status',durable?'The save could not be confirmed. Choose Retry save. This browser can also recover the original save after a reload.':'The save could not be confirmed. Keep this tab open and choose Retry save. If it already completed, the same record will be recovered.');
  note.id='save-retry-'+(button.id||'proposal');note.setAttribute('role','status');
  const target=button.closest('.proposal-decision')||button.parentElement,hint=target.querySelector('.proposal-next');
  feedback={label:[...button.childNodes],note,hint,hintHidden:hint?.hidden,describedBy:button.getAttribute('aria-describedby')};saveRetryFeedback.set(button,feedback);
  if(hint)hint.hidden=true;target.append(note);button.setAttribute('aria-describedby',note.id);
 }
 button.textContent='Retry save';feedback.note.scrollIntoView({behavior:'smooth',block:'nearest'});return true;
}

function drawReview(){
 clearSaveRetryFeedback();
 document.body.classList.add('reviewing-proposal');
 const review=state.review,quote=review.quote,summary=el('div','quote-summary');
 const terms=el('div');terms.append(el('small','',quote.licenseType),el('strong','',quote.assetTitle));
 const cost=el('div');
 if(quote.eligible)cost.append(el('small','','Proposed price'),el('b','',money(quote.priceCents)));
 else cost.append(el('small','','Requested use'),el('strong','review-unavailable','Not offered'));
 const work=state.catalog.works.find(item=>item.id===review.request.assetId);
 const preview=Number.isSafeInteger(quote.offerRevision)&&/^creator-[a-f0-9-]+$/.test(review.request.assetId)
  ?'/api/catalog/'+review.request.assetId+'/preview?offer='+quote.offerRevision:work?.preview;
 if(preview){
  const inspect=el('button','review-preview-open');inspect.type='button';inspect.setAttribute('aria-label','Inspect reviewed artwork '+quote.assetTitle);inspect.dataset.previewTitle=quote.assetTitle;
  const image=el('img');image.src=preview;image.dataset.previewUrls=JSON.stringify((review.work?.offerRevision===quote.offerRevision?review.work?.previews:work?.offerRevision===quote.offerRevision?work?.previews:null)||[preview]);image.alt=quote.assetTitle+' — reviewed artwork';
  image.addEventListener('error',()=>{image.hidden=true;if(!inspect.querySelector('span'))inspect.append(el('span','','Preview unavailable'));},{once:true});
  inspect.append(image);summary.classList.add('with-artwork');summary.append(inspect);
 }
 terms.append(el('span','review-creator',quote.creator));cost.classList.add('review-quote-cost');summary.append(terms,cost);
 const validity=el('p','eligibility'+(quote.eligible?'':' fail'),quote.eligible?'Ready for creator review':'This request needs changes');
 const scope=el('dl','review-scope');
 const request=review.request;
 const media={website:'Website / digital product',social:'Social campaign',print:'Printed publication',merchandise:'Merchandise'};
 const rights=[
  request.attribution?'Creator credit included':'No creator credit requested',
  request.exclusive?'Exclusive rights requested':'Nonexclusive use',
  request.training?'Model training requested':'No model training'
 ];
 for(const [label,value] of [
  ['Licensee',request.licensee],
  ['Project',request.project],
  ['Use',(media[request.medium]||request.medium)+(request.medium==='print'||request.copies>0?' · '+new Intl.NumberFormat('en-US').format(request.copies)+' physical copies':'')],
  ['Term & territory',quote.term+' · '+quote.territory],
  ...(quote.period?[['Agreed dates',licenseScope.periodLabel(quote.period)]]:[]),
  ['Requested rights',rights.join(' · ')]
 ])scope.append(el('dt','',label),el('dd','',value));
 scope.setAttribute('aria-label','Exact request being reviewed');
 const nodes=[summary,...(review.work?.delivery?[window.deliveryDetails(review.work.delivery)]:[]),scope],briefSection=requestBrief(request,'Project brief for creator',true);
 if(briefSection)nodes.push(briefSection);
 const refusal=quote.eligible?null:el('section','review-refusal');
 if(refusal){refusal.setAttribute('aria-label','Changes needed');refusal.append(validity);nodes.splice(1,0,refusal);}else nodes.push(validity);
 const fullTerms=el('details','review-disclosure review-full-terms');fullTerms.append(el('summary','','Full license terms'));
 fullTerms.querySelector('summary').addEventListener('click',()=>requestAnimationFrame(()=>{if(fullTerms.open)fullTerms.scrollIntoView({behavior:'smooth',block:'start'});}));
 const policyList=el('ol','review-policy-list');
 for(const clause of $('policy-list').children){const copy=clause.cloneNode(true);if(copy.id)copy.id='review-'+copy.id;policyList.append(copy);}
 fullTerms.append(policyList);
 const checks=el('details','review-disclosure review-checks');checks.append(el('summary','','How these terms were checked'));
 const checked=el('div','review-check-list');checks.append(checked);
 if(state.revisionOf)nodes.push(el('p','revision-note','Revising '+state.revisionOf.project+' · '+state.revisionOf.reason+' Save this as a new proposal for the creator.'));
 if(review.modelWarning){const warning=el('div','model-note');warning.setAttribute('role','status');warning.append(el('strong','','AI explanation unavailable · published policy checks'),el('p','',review.modelWarning));nodes.push(warning);}
 for(const f of quote.findings){const item=el('div','finding'+(f.ok?'':' fail'));item.append(el('span','symbol',f.ok?'✓':'×'));const text=el('div');const source=el('a','policy-reference',f.policyId);source.href='#review-policy-'+encodeURIComponent(f.policyId);source.setAttribute('aria-label','Read creator policy clause '+f.policyId);source.addEventListener('click',event=>{const target=$('review-policy-'+f.policyId),policy=fullTerms;if(!target||!policy)return;event.preventDefault();policy.open=true;target.focus({preventScroll:true});target.scrollIntoView({behavior:'smooth',block:'center'});});text.append(el('div','finding-explanation',f.text),source);item.append(text);if(f.ok)checked.append(item);else refusal.append(item);}
 if(!quote.eligible&&review.request.medium==='print'&&quote.limits?.physicalCopies>0&&review.request.copies>quote.limits.physicalCopies){
  const revise=el('div','scope-revision');revise.append(el('p','','If a smaller print run meets your needs, revise the draft to this work’s published limit. This changes the scope and still requires a new review.'));
  const b=el('button','','Set draft to '+quote.limits.physicalCopies.toLocaleString('en-US')+' copies');b.type='button';
  b.addEventListener('click',()=>{$('copies').value=String(quote.limits.physicalCopies);$('copies').dispatchEvent(new Event('input',{bubbles:true}));$('copies').focus();$('copies').scrollIntoView({behavior:'smooth',block:'center'});});revise.append(b);nodes.push(revise);
 }
 nodes.push(fullTerms);if(checked.children.length)nodes.push(checks);
 const handoff=el('div','proposal-decision');
 const buttons=el('div','proposal-decision-buttons');
 const edit=el('button','secondary','Edit use');edit.type='button';edit.addEventListener('click',()=>{document.body.classList.remove('reviewing-proposal');const field=$(reviewEditField(review));field.focus({preventScroll:true});(field.closest('label')||field).scrollIntoView({behavior:'smooth',block:'center'});});
 if(quote.eligible){

  const b=el('button','primary',state.revisionOf?.pending?'Save replacement proposal':'Save proposal for creator');b.type='button';
  b.addEventListener('click',async()=>{
   if(state.review!==review||!sameRequest(review.request,formRequest())){invalidateChangedDraft();toast('Review the current scope before saving a proposal.');return;}
   b.disabled=true;
   try{
    const save=saveIntent('proposal',review,state.revisionOf?.id);await retainProposalSave(save);
    const data=await api('/api/requests',{...save.payload,saveKey:save.saveKey,...(save.payload.replaces?{buyerAccessToken:state.buyerAccess.get(save.payload.replaces)}:{})});
    clearTimeout(window.toastHandle);$('toast').hidden=true;clearSaveRetryFeedback(b);
    if(data.buyerAccessToken)await rememberBuyerAccess(data.license.id,data.buyerAccessToken);
    rememberLicense(data.license);
    if(data.license.replaces){const prior=state.vault.get(data.license.replaces.id)?.license;if(prior)rememberLicense({...prior,status:'superseded',replacedBy:data.license.id});}
    completeSaveIntent(save,data.license);
    if(state.review===review&&sameRequest(review.request,formRequest())){clearProposalRevision();window.markDraftSaved?.();state.license=data.license;state.certificate=null;state.restored=false;$('approval').hidden=true;$('result-section').hidden=true;displayLicense();}
    else toast('Your earlier proposal was saved in Your license records. The current draft was not changed.');
   }catch(e){if(!handleOfferChanged(e,review)&&!showSaveRetry(b,e,review))toast(e.message);}finally{b.disabled=false;}
  });buttons.append(b);
 }
 if(review.modelReview){const box=el('div','model-note');box.append(el('strong','','Local AI explanation · '+review.modelReview.model),el('span','',review.modelReview.summary));nodes.push(box);}

 buttons.append(edit);handoff.append(buttons);
 if(quote.eligible)handoff.append(el('p','proposal-next','Creator approval before payment.'));
 nodes.push(handoff);
 replace('review',nodes);$('approval').open=false;$('result-section').hidden=false;$('approval').hidden=!quote.eligible||!!state.revisionOf;window.scrollTo({top:0,behavior:'instant'});$('result-section').focus({preventScroll:true});
}
const checkoutPending=new Set();
const SAVED_LICENSE_KEY='licenselane:active-sandbox-license';
const VAULT_KEY='licenselane:saved-license-ids';
const RECORD_ARCHIVE_PREFIX='licenselane:archived-record:';
const RECORD_SUMMARY_PREFIX='licenselane:record-summary:';
function recordPeriod(value){
 if(!value||value.timeZone!=='UTC')return null;
 try{
  const startsOn=licenseScope.date(value.startsOn),endsBefore=licenseScope.date(value.endsBefore),endsOn=licenseScope.date(value.endsOn);
  if(endsBefore<=startsOn||new Date(new Date(endsOn+'T00:00:00Z').getTime()+86400000).toISOString().slice(0,10)!==endsBefore)return null;
  return {startsOn,endsBefore,endsOn,timeZone:'UTC'};
 }catch{return null;}
}
window.addEventListener('focus',()=>{if(state.config)drawVault();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.config)drawVault();});
function normalizeRecordSummary(value,id){
 if(value?.version!==1||value.id!==id||!/^[a-f0-9]{64}$/.test(id))return null;
 const fields=['project','assetTitle','licensee','medium','term','territory'];
 if(fields.some(key=>typeof value[key]!=='string'||value[key].length>500)||!value.project||!value.assetTitle)return null;
 if(!['website','social','print','merchandise'].includes(value.medium)||!Number.isSafeInteger(value.copies)||value.copies<0)return null;
 return {version:1,id,...Object.fromEntries(fields.map(key=>[key,value[key]])),copies:value.copies,...(recordPeriod(value.period)?{period:recordPeriod(value.period)}:{})};
}
function savedRecordSummary(id){
 try{const raw=localStorage.getItem(RECORD_SUMMARY_PREFIX+id);return raw&&raw.length<=8192?normalizeRecordSummary(JSON.parse(raw),id):null;}catch{return null;}
}
function cacheRecordSummary(license){
 const request=license?.request,quote=license?.quote;if(!request||!quote)return;
 const summary=normalizeRecordSummary({version:1,id:license.id,project:request.project,assetTitle:quote.assetTitle,licensee:request.licensee,medium:request.medium,copies:request.copies,term:quote.term||'',territory:quote.territory||'',period:quote.period},license.id);
 if(!summary)return;
 try{const key=RECORD_SUMMARY_PREFIX+license.id,value=JSON.stringify(summary);if(localStorage.getItem(key)!==value)localStorage.setItem(key,value);}catch{}
}

function recordArchived(id){try{return localStorage.getItem(RECORD_ARCHIVE_PREFIX+id)==='1';}catch{return false;}}
function setRecordArchived(id,archived){
 try{
  if(archived)localStorage.setItem(RECORD_ARCHIVE_PREFIX+id,'1');
  else localStorage.removeItem(RECORD_ARCHIVE_PREFIX+id);
  if(recordArchived(id)!==archived)throw Error('Archive preference was not retained');
 }catch{toast('Browser storage is unavailable. Your record has not been moved. Try again when storage is available.');return;}
 drawVault();$('records-filter').focus();
 toast(archived?'Moved to Archived in this browser. Private backups still include this record.':'Returned to Current in this browser.');
}
window.addEventListener('storage',event=>{if(event.key===null||event.key?.startsWith(RECORD_ARCHIVE_PREFIX))drawVault();});
const BUYER_ACCESS_KEY='licenselane:buyer-access';
const BUYER_ACCESS_PREFIX=BUYER_ACCESS_KEY+':';
function savedBuyerAccess(){
 const access=new Map(),valid=(id,token)=>/^[a-f0-9]{64}$/.test(id)&&typeof token==='string'&&/^[a-f0-9]{64}$/.test(token);
 // Keep older workspaces readable. Independent keys take precedence over that snapshot.
 try{for(const [id,token] of Object.entries(JSON.parse(localStorage.getItem(BUYER_ACCESS_KEY)||'{}')||{}))if(valid(id,token))access.set(id,token);}catch{}
 for(let index=0;index<localStorage.length;index++){
  const key=localStorage.key(index);if(!key?.startsWith(BUYER_ACCESS_PREFIX))continue;
  const id=key.slice(BUYER_ACCESS_PREFIX.length),token=localStorage.getItem(key);
  if(valid(id,token))access.set(id,token);
 }
 return access;
}
function loadBuyerAccess(){try{for(const [id,token] of savedBuyerAccess())state.buyerAccess.set(id,token);}catch{}}
window.addEventListener('storage',event=>{if(event.key===BUYER_ACCESS_KEY||event.key?.startsWith(BUYER_ACCESS_PREFIX))loadBuyerAccess();});
function rememberBuyerAccess(id,token){
 if(!/^[a-f0-9]{64}$/.test(id)||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('Buyer access was not returned correctly.');
 state.buyerAccess.set(id,token);
 try{
  // A tab can update this verified record without replacing another tab's authority.
  localStorage.setItem(BUYER_ACCESS_PREFIX+id,token);loadBuyerAccess();return true;
 }catch{toast('Buyer access is available in this tab only. Save your private buyer-access file before leaving.');return false;}
}
function recoveryAddress(){return state.config?.recoveryOnly?location.origin:state.config?.recoveryUrl||null;}
function downloadBuyerAccess(license){
 const token=state.buyerAccess.get(license.id);if(!token)return;
 const file={format:'licenselane-buyer-access',version:1,server:installationFileOrigin(),licenseId:license.id,buyerAccessToken:token,...(recoveryAddress()?{recoveryServer:recoveryAddress()}: {})};
 const blob=new Blob([JSON.stringify(file,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');
 a.href=url;a.download='LicenseLane-'+license.id.slice(0,12)+'-buyer-access.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
 toast('Private buyer-access file downloaded. Keep it yourself; share only the recovery reference with the creator.');
}
async function importBuyerAccess(file,options={}){
 const currentRead=beginRecordRead();
 if(!file||file.size>524288)throw Error('Choose a LicenseLane access or backup JSON file smaller than 512 KB.');
 let saved;try{saved=JSON.parse(await file.text());}catch{if(!currentRead())return;throw Error('This is not a readable buyer-access JSON file.');}
 // Choosing a file is the start of the restore, including its asynchronous disk read.
 // A later destination, edit or file selection must win before any record request.
 if(!currentRead())return;
 if(saved?.format==='licenselane-records-backup'){if(options.expectedLicenseId)throw Error('Choose the private buyer-access file for this proposal.');return importRecordsBackup(saved);}
 if(saved?.format!=='licenselane-buyer-access'||saved.version!==1||typeof saved.licenseId!=='string'||!/^[a-f0-9]{64}$/.test(saved.licenseId)||typeof saved.buyerAccessToken!=='string'||!/^[a-f0-9]{64}$/.test(saved.buyerAccessToken))throw Error('Choose the private buyer-access file, not the shared recovery reference.');
 if(options.expectedLicenseId&&saved.licenseId!==options.expectedLicenseId)throw Error('This file belongs to a different proposal. Choose the private buyer-access file for this draft.');
 const origins=[location.origin,state.config?.installationOrigin,state.config?.restoredOrigin,...(state.config?.recoveryOnly?[state.config.recoveryOrigin,state.config.primaryUrl]:[])].filter(value=>typeof value==='string'&&value);
 if(typeof saved.server!=='string'||!origins.includes(saved.server))throw Error('This buyer-access file belongs to a different LicenseLane address. Open the original server to restore it.');
 return restoreBuyerAccess(saved.licenseId,saved.buyerAccessToken,()=>true,options);
}
function installationFileOrigin(){return state.config?.installationOrigin||state.config?.restoredOrigin||(state.config?.recoveryOnly?state.config.recoveryOrigin:location.origin);}
function buyerFileOrigins(){
 return [location.origin,state.config?.installationOrigin,state.config?.restoredOrigin,...(state.config?.recoveryOnly?[state.config.recoveryOrigin,state.config.primaryUrl]:[])].filter(value=>typeof value==='string'&&value);
}
function downloadRecordsBackup(){
 loadBuyerAccess();
 const ids=[...new Set([...savedLicenseIds(),...state.vault.keys()])];
 if(!ids.length)return;
 if(ids.length>1000){toast('This browser has more than 1,000 records. Save individual buyer-access files for now.');return;}
 const records=ids.map(licenseId=>({licenseId,archived:recordArchived(licenseId),...(state.buyerAccess.has(licenseId)?{buyerAccessToken:state.buyerAccess.get(licenseId)}:{})}));
 const file={format:'licenselane-records-backup',version:1,server:installationFileOrigin(),createdAt:new Date().toISOString(),records};
 const url=URL.createObjectURL(new Blob([JSON.stringify(file,null,2)+'\n'],{type:'application/json'})),link=el('a');
 link.href=url;link.download='LicenseLane-private-records-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),500);
 toast('Private records backup saved. Keep it yourself: it includes your buyer access.');
}
let recordsImportBusy=false;
async function importRecordsBackup(saved){
 if(recordsImportBusy)throw Error('The current records import is still running.');
 const records=validateRecordsBackup(saved,buyerFileOrigins()),currentRead=beginRecordRead(),box=$('records-import-status');
 recordsImportBusy=true;box.hidden=false;box.replaceChildren();
 const heading=el('h2','','Restoring your records'),progress=el('p'),list=el('ul','records-import-failures');
 box.append(heading,progress,list);
 if(currentRead())location.hash='#vault';
 let failed=[],complete=0;
 async function restoreBatch(batch){
  recordsImportBusy=true;list.replaceChildren();failed=[];
  for(let start=0;start<batch.length;start+=4){
   await Promise.all(batch.slice(start,start+4).map(async entry=>{
    try{
     const data=await boundedRead('/api/licenses/'+entry.licenseId+(entry.buyerAccessToken?'/buyer-access':''),entry.buyerAccessToken?{buyerAccessToken:entry.buyerAccessToken}:undefined,'This record could not be checked. Try again.');
     if(data?.license?.id!==entry.licenseId)throw Error('The returned record did not match.');
     // A backup supplies organization only for a record new to this browser.
     // Existing current/archived choices take precedence, including another tab.
     const knownRecord=state.vault.has(entry.licenseId)||savedLicenseIds().includes(entry.licenseId)||localStorage.getItem(RECORD_ARCHIVE_PREFIX+entry.licenseId)!==null;
     if(!knownRecord&&entry.archived===true){
      localStorage.setItem(RECORD_ARCHIVE_PREFIX+entry.licenseId,'1');
      if(!recordArchived(entry.licenseId))throw Error('Archive organization could not be saved. Keep your backup and retry.');
     }
     if(entry.buyerAccessToken){
      await rememberBuyerAccess(entry.licenseId,entry.buyerAccessToken);
      if(savedBuyerAccess().get(entry.licenseId)!==entry.buyerAccessToken)throw Error('Private access is available in this tab only. Keep your backup and retry when browser storage is available.');
     }
     state.vault.set(entry.licenseId,{license:data.license});
     localStorage.setItem(VAULT_KEY,JSON.stringify([...new Set([...savedLicenseIds(),...state.vault.keys()])]));
     complete++;
    }catch(error){failed.push(entry);list.append(el('li','',entry.licenseId.slice(0,12)+'… — '+error.message));}
   }));
   progress.textContent=complete+' of '+records.length+' records restored'+(failed.length?' · '+failed.length+' need retry':'')+'.';
   drawVault();
  }
  recordsImportBusy=false;
  heading.textContent=failed.length?'Some records need another try':'Your records are restored';
  if(failed.length){
   const retry=el('button','secondary','Retry remaining records');retry.type='button';
   retry.addEventListener('click',async()=>{if(recordsImportBusy)return;retry.remove();await restoreBatch(failed.slice());});
   box.append(retry);
  }
 }
 await restoreBatch(records);
}
// Late reads must preserve the newer destination. Record restores also preserve new form input;
// policy review checks its submitted fields separately, so equivalent input stays valid.
let recordReadGeneration=0,destinationGeneration=0;
function invalidateRecordRead(destination=true){recordReadGeneration++;if(destination)destinationGeneration++;}
function beginDestinationRead(){
 invalidateRecordRead();const generation=destinationGeneration;
 return ()=>generation===destinationGeneration;
}
function beginRecordRead(){
 destinationGeneration++;
 const generation=++recordReadGeneration;
 return ()=>generation===recordReadGeneration;
}
document.addEventListener('click',event=>{
 if(event.target.closest?.('.work,.record-back,a[href^="#"],#request-form button'))invalidateRecordRead();
},true);
document.addEventListener('input',event=>{
 if(event.target.closest?.('#request-form'))invalidateRecordRead(false);
},true);
// The handoff router announces navigation before it starts the intended read.
window.addEventListener('licenselane:navigation',invalidateRecordRead);
async function restoreBuyerAccess(id,token,isCurrent=()=>true,{showRecord=true}={}){
 const currentRead=beginRecordRead();
 const saved={licenseId:id,buyerAccessToken:token};
 let data;
 try{data=await boundedRead('/api/licenses/'+saved.licenseId+'/buyer-access',{buyerAccessToken:saved.buyerAccessToken},'Buyer access could not be checked. Try your file again.');}
 catch(error){if(!isCurrent()||!currentRead())return false;throw error;}
 if(!isCurrent()||!currentRead())return false;
 if(data?.license?.id!==saved.licenseId)throw Error('The server returned a different record. Buyer access was not imported.');
 const accessSaved=await rememberBuyerAccess(saved.licenseId,saved.buyerAccessToken);
 if(!isCurrent()||!currentRead())return false;
 if(!showRecord){rememberLicense(data.license);return true;}
 clearTimeout(window.toastHandle);$('toast').hidden=true;
 state.creatorReviewRecordId=null;
 state.license=data.license;state.certificate=data.certificate||null;state.restored=true;state.review=null;
 // Saved agreement identity belongs to its record; preserve the current draft artwork.
 $('approval').hidden=true;$('result-section').hidden=true;rememberLicense(data.license);displayLicense();
 // Opening the restored record is the success state; keep its actions unobstructed.
 if(!accessSaved)toast('Buyer access restored in this tab only. Save your private buyer-access file before leaving.');
}

function savedLicenseIds(){
 try{
  const ids=JSON.parse(localStorage.getItem(VAULT_KEY)||'[]');
  const legacy=localStorage.getItem(SAVED_LICENSE_KEY);
  return [...new Set([...(Array.isArray(ids)?ids:[]),...savedBuyerAccess().keys(),legacy].filter(id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id)))];
 }catch{return [];}
}
function rememberLicense(license){
 if(!license?.id)return;
 state.vault.set(license.id,{license});
 try{
  localStorage.setItem(VAULT_KEY,JSON.stringify([...new Set([...savedLicenseIds(),license.id])]));
  localStorage.setItem(SAVED_LICENSE_KEY,license.id);
 }catch{toast('Browser storage is unavailable. Keep this license reference: '+license.id);}
 drawVault();
}
async function refreshRecordStatus(id){
 const previous=state.vault.get(id);
 try{
  const data=await readSavedLicense(id);
  if(data?.license?.id!==id)throw Error('Saved record mismatch.');
  if(state.vault.get(id)===previous)state.vault.set(id,{license:data.license});
  return true;
 }catch{
  if(state.vault.get(id)===previous)state.vault.set(id,{...previous,loading:false,refreshFailed:true});
  return false;
 }
}
let recordsRefreshBusy=false;
async function refreshRecords(){
 if(recordsRefreshBusy||!state.config)return;
 const ids=[...new Set([...savedLicenseIds(),...state.vault.keys()])];
 if(!ids.length)return;
 recordsRefreshBusy=true;
 const button=$('records-refresh'),message=$('records-refresh-status');
 button.disabled=true;message.hidden=false;message.classList.remove('records-refreshed');message.textContent='Checking saved statuses…';
 let failed=0;
 try{
  for(let start=0;start<ids.length;start+=4){
   await Promise.all(ids.slice(start,start+4).map(async id=>{
    if(!await refreshRecordStatus(id))failed++;
   }));
   drawVault();
  }
  message.textContent=failed?failed+' '+(failed===1?'record could':'records could')+' not be checked. Last known statuses are shown; refresh to retry.':'Saved statuses updated.';
  message.classList.toggle('records-refreshed',!failed);
 }finally{recordsRefreshBusy=false;button.disabled=false;}
}
function recordArchiveMenu(id,label,archived){
 const menu=el('details','buyer-record-menu'),summary=el('summary','','⋯');
 summary.setAttribute('aria-label','Options for '+label);summary.title='Record options';
 menu.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.open=false;summary.focus();event.stopPropagation();}});
 menu.addEventListener('toggle',()=>{if(menu.open)for(const other of document.querySelectorAll('.buyer-record-menu[open]'))if(other!==menu)other.open=false;});
 const archive=el('button','secondary',archived?'Restore to Current':'Archive record');archive.type='button';
 archive.addEventListener('click',()=>setRecordArchived(id,!archived));menu.append(summary,archive);return menu;
}
function recordStage(l,entry){
 if(!l||entry?.refreshFailed)return 'attention';
 if(l.paymentObservation||!['requested','issued','superseded','withdrawn'].includes(l.status))return 'attention';
 if(l.status==='issued'&&l.recovery?.state==='pending')return 'preparing';
 if(l.status==='requested')return 'waiting';
 if(l.status==='issued')return 'licensed';
 return 'past';
}
function recordScope(medium,copies,term,territory){
 const kind={website:'Website',social:'Social campaign',print:'Print',merchandise:'Merchandise'}[medium]||medium;
 return [kind,medium==='print'&&copies!=null&&copies!==''&&Number.isFinite(Number(copies))?Number(copies).toLocaleString()+' copies':null,term,territory].filter(Boolean).join(' · ');
}
function recordMatchesQuery(query,id,record){
 const normalize=value=>String(value??'').toLocaleLowerCase().replace(/(\d),(?=\d)/g,'$1');
 const request=record?.request||record||{},quote=record?.quote||record||{},period=recordPeriod(quote.period);
 const searchable=normalize([request.project,quote.assetTitle,request.licensee,recordScope(request.medium,request.copies,quote.term,quote.territory),...(period?[period.startsOn,period.endsOn,licenseScope.periodLabel(period)]:[])].filter(Boolean).join(' '));
 return normalize(query).trim().split(/\s+/).filter(Boolean).every(token=>searchable.includes(token)||/^[a-f0-9]{6,}$/.test(token)&&id.includes(token));
}
function drawVault(){
 drawSavedWorkRecords();
 const hasRecords=state.vault.size>0||savedLicenseIds().length>0;
 const firstUse=!hasRecords&&!state.config?.recoveryOnly;
 $('vault').classList.toggle('records-first-use',firstUse);
 const restoreSummary=$('vault').querySelector('.records-restore>summary');
 if(restoreSummary)restoreSummary.textContent=firstUse?'Have a record link? Open it here':'Open a reference or restore buyer access';
 if($('records-backup')){$('records-backup').disabled=!hasRecords;$('records-backup').hidden=!hasRecords;}
 document.querySelector('.records-filters').hidden=!hasRecords;
 document.querySelector('.records-overview').hidden=!hasRecords;
 if(!hasRecords)$('records-refresh-status').hidden=true;
 const rows=[],recordRows=[],exportItems=[];
 const query=($('records-search')?.value||'').trim().toLocaleLowerCase(),filter=$('records-filter')?.value||'all';
 const archivedCount=[...state.vault.keys()].filter(recordArchived).length;
 let matched=0;
 for(const saveKey of (state.config?.recoveryOnly?[]:pendingProposalKeys())){
  const row=el('div','vault-row pending-proposal-recovery'),description=el('div');
  description.append(el('strong','','Interrupted proposal save'),el('small','','Reconnect to find the original saved request.'));
  const button=el('button','secondary','Recover proposal');button.type='button';
  button.addEventListener('click',async()=>{button.disabled=true;try{const license=await recoverProposalSave(saveKey);await openLicense(license.id);}catch{toast('The original save is not available yet. Retry when this server is reachable; no new proposal was submitted.');}finally{button.disabled=false;}});
  row.append(description,button);rows.push(row);
 }
 for(const saveKey of (state.config?.recoveryOnly?[]:pendingApprovalKeys())){
  const row=el('div','vault-row pending-approval-recovery'),description=el('div');
  description.append(el('strong','','Interrupted creator approval'),el('small','','Restore the original agreement.'));
  const label=el('label','','Creator approval code'),input=el('input');input.type='password';input.autocomplete='off';label.append(input);
  const button=el('button','secondary','Recover approval');button.type='button';
  const feedback=el('p','model-note');feedback.setAttribute('role','status');
  button.addEventListener('click',async()=>{button.disabled=true;feedback.textContent='';try{const license=await recoverApprovalSave(saveKey,input.value);input.value='';await openLicense(license.id);}catch(e){feedback.textContent=e.message;}finally{button.disabled=false;}});
  row.append(description,label,button,feedback);rows.push(row);
 }
 for(const [id,entry] of [...state.vault].reverse()){
  const l=entry.license;if(l)cacheRecordSummary(l);
  const summary=l?null:savedRecordSummary(id),archived=recordArchived(id);
  const period=recordPeriod(l?.quote.period||summary?.period),useState=licenseScope.periodState(period);
  if(!state.config?.recoveryOnly&&(filter==='archived'?!archived:archived))continue;
  if(!recordMatchesQuery(query,id,l||summary))continue;
  if(filter==='issued'&&l?.status!=='issued')continue;
  if(filter==='preparing'&&recordStage(l,entry)!=='preparing')continue;
  if(['use-current','use-upcoming','use-ended'].includes(filter)&&(l?.status!=='issued'||l.paymentObservation||entry.refreshFailed||filter!=='use-'+useState))continue;
  if(filter==='waiting'&&l?.status!=='requested')continue;
  if(filter==='action'&&recordStage(l,entry)!=='attention')continue;
  matched++;
  if(l?.status==='issued'&&!l.paymentObservation&&!entry.refreshFailed&&l.recovery?.state!=='pending')exportItems.push({id:l.id,project:l.request.project,licensee:l.request.licensee,work:l.quote.assetTitle,medium:l.request.medium,copies:l.request.copies,term:l.quote.term,territory:l.quote.territory,period:l.quote.period,priceCents:l.quote.priceCents,createdAt:l.createdAt});
  const row=el('article','vault-row buyer-record-row'),title=el('div','buyer-record-info');row.dataset.recordId=id;
  if(l){
   const art=el('img','buyer-record-art');art.src='/api/licenses/'+id+'/preview';art.alt=l.quote.assetTitle+' — saved artwork';art.loading='lazy';
   art.addEventListener('error',()=>{art.hidden=true;row.classList.add('record-no-art');},{once:true});row.append(art);
   const status=entry.refreshFailed?'Status needs checking':l.recovery?.state==='pending'&&l.status==='issued'?'Payment received · files preparing':l.paymentObservation?'Payment previously confirmed':{withdrawn:'Withdrawn by buyer',superseded:'Replaced proposal',changes_requested:'Changes requested',requested:'Awaiting creator',approved:'Ready for checkout',awaiting_payment:'Checkout started',creating_order:'Checking order',order_unknown:'Order needs review',capture_unknown:'Payment needs review',issued:period?({upcoming:'Use starts '+period.startsOn,current:'Use through '+period.endsOn,ended:'Use period ended'}[useState]):'Licensed files'}[l.status]||l.status;
   const heading=el('div','buyer-record-heading');heading.append(el('span','buyer-record-status',status));
   if(!state.config?.recoveryOnly)heading.append(recordArchiveMenu(id,l.request.project,archived));
   title.append(heading,el('h2','',l.request.project),el('p','buyer-record-work',l.quote.assetTitle));
   title.append(el('p','buyer-record-scope',recordScope(l.request.medium,l.request.copies,l.quote.term,l.quote.territory)));
   if(period)title.append(el('p','buyer-record-period',licenseScope.periodLabel(period)));
   else if(l.status==='issued')title.append(el('p','buyer-record-period','Use dates not recorded'));
   if(l.request.licensee)title.append(el('p','buyer-record-licensee','For '+l.request.licensee));
   if(entry.refreshFailed)title.append(el('p','buyer-record-stale','Last known status · refresh to check'));
   row.append(title);
   const actions=el('div','buyer-record-action');actions.append(el('strong','buyer-record-price',money(l.quote.priceCents)));
   const label=entry.refreshFailed?'Retry status':l.recovery?.state==='pending'&&l.status==='issued'?'Check delivery':l.paymentObservation?'Review payment':state.config?.recoveryOnly?(l.status==='issued'?'Open files':'Open saved terms'):{issued:'Open files',changes_requested:'Review changes',approved:'Review checkout',awaiting_payment:'Continue checkout',order_unknown:'Review payment',capture_unknown:'Review payment'}[l.status]||'View request';
   const button=el('button','secondary',label);button.type='button';button.addEventListener('click',async()=>{
    button.disabled=true;
    try{
     if(entry.refreshFailed){
      const refreshed=await refreshRecordStatus(id);drawVault();
      if(!refreshed)toast('This record is still unavailable. Your last known details are retained.');
      else if(!recordsRefreshBusy){
       const failed=[...state.vault.values()].filter(item=>item.refreshFailed).length,message=$('records-refresh-status');
       message.hidden=false;message.classList.toggle('records-refreshed',!failed);
       message.textContent=failed?failed+' '+(failed===1?'record could':'records could')+' not be checked. Last known statuses are shown; refresh to retry.':'Saved status updated.';
      }
     }
     else await openLicense(id);
    }catch(e){toast(e.message);}finally{button.disabled=false;}
   });
   actions.append(button);row.append(actions);
  }else{
   row.classList.add('record-no-art');
   const heading=el('div','buyer-record-heading');
   heading.append(summary?el('span','buyer-record-status','Last known details'+(entry.loading?' · checking…':' · unavailable')):el('h2','','Saved record'));
   if(!state.config?.recoveryOnly)heading.append(recordArchiveMenu(id,summary?.project||'saved record '+id.slice(0,12),archived));
   title.append(heading);
   if(summary){
    title.append(el('h2','',summary.project),el('p','buyer-record-work',summary.assetTitle));
    title.append(el('p','buyer-record-scope',recordScope(summary.medium,summary.copies,summary.term,summary.territory)));
    if(period)title.append(el('p','buyer-record-period','Saved dates · '+licenseScope.periodLabel(period)));
    if(summary.licensee)title.append(el('p','buyer-record-licensee','For '+summary.licensee));
   }else title.append(el('p','buyer-record-scope',id.slice(0,12)+(entry.loading?'… · loading':'… · unavailable')));
   const button=el('button','secondary',entry.loading?'Loading record…':'Retry record');button.type='button';button.disabled=!!entry.loading;button.addEventListener('click',async()=>{button.disabled=true;try{await openLicense(id);}catch(e){toast(e.message);}finally{button.disabled=false;}});row.append(title,button);
  }
  recordRows.push({row,stage:recordStage(l,entry)});
 }
 if(filter==='all'){
  const priority={attention:0,preparing:1,waiting:2,licensed:3,past:4};
  recordRows.sort((a,b)=>priority[a.stage]-priority[b.stage]);
 }
 const labels={attention:'Needs your attention',preparing:'Files preparing',waiting:'Waiting on creator',licensed:'Files ready',past:'Past requests'};
 const showStages=filter==='all'&&!query&&new Set(recordRows.map(record=>record.stage)).size>1;
 let previousStage=null;
 for(const record of recordRows){
  if(showStages&&record.stage!==previousStage){
   rows.push(el('h3','records-stage-heading',labels[record.stage]));
   previousStage=record.stage;
  }
  rows.push(record.row);
 }
 if($('records-count'))$('records-count').textContent=matched+' '+(matched===1?'record':'records')+(query?' matching “'+$('records-search').value.trim()+'”':'');
 if(rows.length||state.config?.recoveryOnly&&!hasRecords)replace('vault-list',rows);
 else if(hasRecords){
  const empty=el('div','records-empty');
  empty.append(el('p','',filter==='archived'?'No archived records match.':archivedCount&&!query&&filter==='all'?'Your current workspace is clear.':'No records match. Try another project or status.'));
  if(archivedCount&&filter!=='archived'){
   const show=el('button','secondary','View archived records');show.type='button';
   show.addEventListener('click',()=>{$('records-search').value='';$('records-filter').value='archived';drawVault();$('records-filter').focus();});empty.append(show);
  }
  replace('vault-list',[empty]);
 }
 else{
  const empty=el('section','records-empty-state'),button=el('button','records-empty-restore','Restore from private file');
  button.type='button';button.id='records-empty-restore';
  button.addEventListener('click',()=>$('buyer-access-file').click());
  empty.append(el('h2','','Returning to a license?'),el('p','','Bring back buyer access with your private file or records backup.'),button);
  replace('vault-list',[empty]);
 }

 const exportButton=$('records-export');
 if(exportButton){
  exportButton.hidden=!hasRecords;exportButton.disabled=!exportItems.length;
  exportButton.textContent=exportItems.length?'Download '+exportItems.length+' '+(exportItems.length===1?'license':'licenses')+' (CSV)':'Download licenses (CSV)';
  exportButton.onclick=()=>{
   if(!exportItems.length)return;
   const url=URL.createObjectURL(new Blob([issuedRegisterCSV(exportItems)],{type:'text/csv;charset=utf-8'})),link=el('a');
   link.href=url;link.download='LicenseLane-purchased-licenses.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
   const status=$('records-refresh-status');status.hidden=false;status.textContent='Downloaded '+exportItems.length+' matching '+(exportItems.length===1?'license':'licenses')+'.';
  };
 }

}
// Only bounded, read-only queries use this helper; saved mutations keep their retained outcome path.
async function boundedRead(url,body,timeoutMessage='This is taking too long. Try again.'){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{return await api(url,body,{signal:controller.signal});}
 catch(error){if(controller.signal.aborted){const timeout=Error(timeoutMessage);timeout.code='READ_TIMEOUT';throw timeout;}throw error;}
 finally{clearTimeout(timer);}
}
function readSavedLicense(id){
 return boundedRead('/api/licenses/'+id,undefined,'This record is taking too long to open. Try again.').catch(error=>{
  if(error instanceof TypeError&&/fetch|network|load/i.test(error.message))throw Error('This saved record could not be reached. Check your connection and retry.');
  throw error;
 });
}
async function openLicense(id,scroll=true,context='buyer'){
 const currentRead=beginRecordRead();
 let data;
 try{data=await readSavedLicense(id);}
 catch(error){if(!currentRead())return false;throw error;}
 if(!currentRead())return false;
 if(!data?.license||data.license.id!==id)throw Error('Saved license mismatch');
 state.creatorReviewRecordId=context==='creator'?id:null;
 state.license=data.license;state.certificate=data.certificate||null;state.restored=true;
 // Saved agreement identity belongs to its record; preserve the current draft artwork.
 state.review=null;$('approval').hidden=true;$('result-section').hidden=true;
 rememberLicense(data.license);displayLicense(scroll);
}
async function restoreLicense(restoreActive=true){
 const ids=savedLicenseIds();
 let active;try{active=localStorage.getItem(SAVED_LICENSE_KEY);}catch{}
 const openActive=restoreActive&&active&&ids.includes(active);
 for(const id of ids)if(!state.vault.has(id))state.vault.set(id,{loading:true});
 drawVault();
 // Unrelated saved records must not hold the current purchase or form setup.
 for(const id of ids){
  if((openActive&&id===active)||state.vault.get(id)?.license)continue;
  const entry=state.vault.get(id);
  (async()=>{
   try{
    const data=await readSavedLicense(id);
    if(state.vault.get(id)===entry&&data.license?.id===id)state.vault.set(id,{license:data.license});
   }catch{}
   finally{if(state.vault.get(id)===entry)entry.loading=false;drawVault();}
  })();
 }
 if(openActive){
  try{await openLicense(active,false);}
  catch{}
  finally{const entry=state.vault.get(active);if(entry&&!entry.license)entry.loading=false;drawVault();}
 }
}

function displayLicense(scroll=true){
 if(location.hash==='#vault'||(scroll&&['#scope-section','#work-section'].includes(location.hash)))history.replaceState(null,'','#checkout-section');
 document.body.classList.remove('buyer-records-view');
 document.body.classList.remove('reviewing-proposal');
 const l=state.license;if(!l)return;
 // A work link selects a new draft only until the buyer moves into a saved
 // agreement. Keep it during silent startup restoration of another record.
 if(scroll&&new URLSearchParams(location.search).has('work')){
  const address=new URL(location.href);address.searchParams.delete('work');
  history.replaceState(history.state,'',address.pathname+address.search+address.hash);
 }
 if(state.config?.recoveryOnly&&l.status!=='issued'){displayRecoveryRecord(l,scroll);return;}const creatorView=state.creatorReviewRecordId===l.id;if(l.status==='issued'){displayPaidRecord(l,scroll);return;}document.body.classList.add('paid-record-view');$('checkout-section').hidden=false;const box=el('div','state-card'+(creatorView?' creator-entry':''));const heading={withdrawn:'Withdrawn by buyer',superseded:'Replaced proposal',changes_requested:'Changes requested',requested:'Awaiting creator approval',approved:'Terms approved',creating_order:'Opening PayPal order',order_unknown:'Order creation needs reconciliation',awaiting_payment:'Sandbox checkout ready',capture_unknown:'Payment confirmation needed',issued:'Verified license issued'}[l.status]||l.status;
 $('record-stage-title').textContent=['requested','changes_requested','superseded','withdrawn'].includes(l.status)?'Saved proposal':l.status==='issued'?'License and files':'Saved license';
 const navigation=el('div','record-toolbar');
 const browse=el('button','record-back',creatorView?'← Back to inbox':'← Browse works');browse.type='button';browse.addEventListener('click',()=>{
  if(!creatorView){leavePaidRecord();return;}
  document.body.classList.remove('paid-record-view');window.dispatchEvent(new Event('licenselane:viewchange'));
  const inbox=$('creator-inbox'),link=document.querySelector('a[href="#creator-inbox"]');
  if(link)link.click();else if(inbox){inbox.open=true;inbox.scrollIntoView({block:'start'});inbox.querySelector('summary')?.focus({preventScroll:true});}
  inbox?.querySelector('.inbox-form')?.requestSubmit();
 });
 const records=el('a','','Your records');records.href='#vault';records.addEventListener('click',()=>$('vault').open=true);navigation.append(browse,records);
 const stateRow=el('div','record-state-row');stateRow.append(el('p','record-state',heading));box.append(navigation,stateRow);
 const periodEnded=licenseScope.periodState(l.quote.period)==='ended';
 const staleProposal=l.status==='requested'&&l.edition?.isCurrentOffer===false;
 if(staleProposal)box.querySelector('.record-state').textContent='Offer changed since this proposal';
 const amount=el('div','record-amount');
 const amountLabel=['requested','changes_requested','superseded','withdrawn'].includes(l.status)?'Proposed amount':l.status==='issued'?'Verified Sandbox amount':'Approved amount';
 const scope=el('div','record-amount-scope'),project=el('h2','record-project-title',l.request.project);project.tabIndex=-1;scope.append(project,el('span','',l.request.licensee));
 const price=el('div','record-amount-price');price.append(el('span','',amountLabel),el('strong','',money(l.quote.priceCents)));
 amount.append(scope,price);box.append(amount);
 if(periodEnded)box.append(el('p','model-note','This agreed use period has ended. Request new dates before another checkout. Existing payments can still be inspected.'));
 const details=el('dl','license-summary');
 for(const [name,value] of [
  ['Creator',l.quote.creator],
  ['Use',l.request.medium+' · '+l.quote.term+' · '+l.quote.territory],
  ...(l.quote.period?[['Agreed dates',licenseScope.periodLabel(l.quote.period)]]:[]),
  ...(l.request.copies>0?[['Print copies',l.request.copies]]:[]),['Attribution','Credit '+l.quote.creator],['Rights','Nonexclusive; no AI training, resale or copyright transfer']
 ]){details.append(el('dt','',name),el('dd','',String(value)));}
 box.append(window.licenseEdition(l),details);
 const briefSection=requestBrief(l.request);if(briefSection)box.append(briefSection);
 box.append(el('p','muted','License record: '+l.id.slice(0,16)+'…'));
 if(l.status==='order_unknown'&&l.paypalCreateRequestId)box.append(el('p','muted','PayPal request reference for manual reconciliation: '+l.paypalCreateRequestId));
 if(l.lastError)box.append(el('p','muted','Last provider message: '+l.lastError));
 const buyerToken=state.buyerAccess.get(l.id);
 let creatorControls=null;
 if(!['issued','changes_requested','superseded','withdrawn'].includes(l.status)&&(l.status==='requested'||!buyerToken)){
  creatorControls=el('details','creator-controls');creatorControls.open=creatorView||(!buyerToken&&(l.status==='requested'||!l.buyerAccessEnabled));
  creatorControls.append(el('summary','',l.status==='requested'?(creatorView?'Creator decision':'Creator approval — creator only'):'Creator access — optional'));
  if(creatorView&&l.status==='requested'){
   const medium={website:'Website',social:'Social',print:'Print'}[l.request.medium]||l.request.medium;
   const scope=[medium,...(l.request.medium==='print'||l.request.copies>0?[Number(l.request.copies||0).toLocaleString('en-US')+' copies']:[]),l.quote.term,l.quote.territory];
   creatorControls.append(el('p','creator-decision-scope',scope.join(' · ')));
  }
  if(state.config.creatorCodeRequired){
   const label=el('label','','Creator approval code');label.htmlFor='checkout-code';
   const input=el('input');input.id='checkout-code';input.type='password';input.autocomplete='off';input.value=$('checkout-code')?.value??$('code').value;
   creatorControls.append(label,input);
  }
 }
 if(!creatorView&&!buyerToken&&l.buyerAccessEnabled&&!['requested','issued','changes_requested','superseded','withdrawn'].includes(l.status)){
  const restore=el('div','buyer-access-note');
  const b=el('button','primary','Restore buyer access');b.type='button';b.addEventListener('click',()=>$('buyer-access-file').click());restore.append(b);box.append(restore);
 }
 const busy=checkoutPending.has(l.id);
 if(busy){const pending=el('p','checkout-pending',l.status==='requested'?'Saving the creator decision for this proposal…':'Contacting PayPal…');pending.setAttribute('role','status');box.append(pending);}
 const actions=el('div','actions');function actionButton(label,fn,secondary=false){const b=el('button',secondary?'secondary':'',label);b.type='button';b.disabled=busy;b.addEventListener('click',fn);actions.append(b);return b;}
 if(l.status==='requested'){
  const approve=actionButton('Creator: approve saved terms',()=>licenseAction('approve'));approve.disabled=busy||staleProposal||periodEnded;creatorControls.append(approve);
  if(staleProposal&&!creatorView){
   const current=actionButton('Review current offer',async()=>{
    current.disabled=true;
    try{
     const catalog=await api('/api/catalog');
     if(state.license?.id!==l.id)return;
     if(!catalog.works.some(work=>work.id===l.request.assetId)){toast('This offer is unavailable. Choose another work.');return;}
     state.catalog=catalog;state.selected=l.request.assetId;state.review=null;state.license=null;state.certificate=null;state.restored=false;
     clearProposalRevision();$('draft-change').hidden=true;$('result-section').hidden=true;$('checkout-section').hidden=true;$('approval').hidden=true;drawWorks();
     $('request-form').scrollIntoView({behavior:'smooth',block:'start'});$('project').focus({preventScroll:true});
    }catch(error){toast(error.message);}finally{current.disabled=false;}
   });
  }
  actionButton('Refresh approval status',()=>openLicense(l.id,true,creatorView?'creator':'buyer'),staleProposal||creatorView);
 }
 const paymentStart=actions.children.length;
 if(l.status==='approved'&&!l.paymentObservation&&!periodEnded)actionButton(state.config.paypalConfigured?'Create PayPal Sandbox checkout':'PayPal Sandbox not configured',()=>licenseAction('order'),false).disabled=!state.config.paypalConfigured||busy;
 if(l.paymentObservation){box.querySelector('.record-state').textContent='Payment previously confirmed';box.append(el('p','model-note',l.paymentObservation.mismatch?'This saved record does not match the order this browser confirmed. Retry the original record before continuing.':'This browser received payment confirmation for this order. Check the existing payment to recover your files.'));if(l.paymentObservation.mismatch)actionButton('Retry saved record',()=>openLicense(l.id));else actionButton('Check existing payment',()=>licenseAction('reconcile'));}
 else if(l.restoration?.state==='inspection_required'){box.querySelector('.record-state').textContent='Check your existing payment';actionButton('Check existing payment',()=>licenseAction('reconcile'));}
 else if(l.status==='awaiting_payment'&&periodEnded){actionButton('Inspect existing order',()=>licenseAction('reconcile'),true);}
 else if(l.status==='awaiting_payment'){if(l.captureBlocked==='recovery_pending'){box.querySelector('.record-state').textContent='Payment not sent';const note=el('p','model-note','Recovery copy unavailable. Retry this saved order.');note.setAttribute('role','status');amount.after(note);}if(l.approvalUrl&&/^https:\/\/(www\.)?sandbox\.paypal\.com\//i.test(l.approvalUrl)){const link=el('a','','Open PayPal Sandbox ↗');link.href=l.approvalUrl;link.target='_blank';link.rel='noopener noreferrer';actions.append(link);}actionButton(l.captureBlocked==='recovery_pending'?'Review same payment':'Review Sandbox payment',()=>reviewSandboxPayment());actionButton('Inspect existing order',()=>licenseAction('reconcile'),true);}
 if(!l.paymentObservation&&l.restoration?.state!=='inspection_required'&&(l.status==='capture_unknown'||l.status==='order_unknown')){if(l.orderId)actionButton('Check payment status',()=>licenseAction('reconcile'),true);}
 if(l.buyerAccessEnabled&&!buyerToken&&l.status!=='requested'&&l.status!=='issued'&&creatorControls){
  const privateActions=el('div','actions');
  for(const control of [...actions.children].slice(paymentStart))privateActions.append(control);
  creatorControls.append(privateActions);
 }
 if(periodEnded&&['approved','awaiting_payment'].includes(l.status)){const fresh=actionButton('Request new dates',()=>beginProposalRevision(l,fresh,{separate:true}));}
 if(buyerToken)actionButton('Save buyer access',()=>downloadBuyerAccess(l),true);
 if(['order_unknown','creating_order'].includes(l.status)&&!l.orderId){
  const recovery=el('div','order-recovery');
  recovery.append(el('h5','','Reconnect order'));
  const label=el('label','','Existing PayPal Sandbox order ID');label.htmlFor='recover-order-id';
  const input=el('input');input.id='recover-order-id';input.autocomplete='off';input.placeholder='Order ID from Sandbox';input.maxLength=64;label.append(input);
  const button=el('button','secondary','Inspect and reconnect existing order');button.type='button';
  const feedback=el('p','muted');feedback.setAttribute('role','status');
  button.addEventListener('click',async()=>{
   button.disabled=true;feedback.textContent='Inspecting the existing order. No payment is being captured.';
   try{
    const data=await api('/api/licenses/'+l.id+'/recover-order',{orderId:input.value.trim(),...(buyerToken?{buyerAccessToken:buyerToken}:{creatorCode:$('checkout-code')?.value??$('code').value})});
    rememberLicense(data.license);
    if(state.license?.id===l.id){state.license=data.license;state.certificate=data.certificate||null;state.restored=false;displayLicense();}
    toast(data.license.status==='issued'?'Existing completed Sandbox payment verified; no new capture was made.':'Existing order reconnected. No payment was captured.');
   }catch(e){feedback.textContent=e.message;}finally{button.disabled=false;}
  });
  recovery.append(label,button,feedback);if(l.buyerAccessEnabled&&!buyerToken&&creatorControls)creatorControls.append(recovery);else box.append(recovery);
 }
 proposalRevisionControls(l,box,actions,busy);
 const changesControl=box.querySelector('.creator-changes');if(creatorControls&&changesControl)creatorControls.append(changesControl);
 actionButton('Save recovery reference',()=>{const blob=new Blob([l.id+'\n'],{type:'text/plain'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='LicenseLane-'+l.id.slice(0,12)+'-reference.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);},true);
 const files=el('section','record-files');files.setAttribute('aria-label','Saved terms and files');
 files.append(el('h5','','Files'));
 const fileActions=el('div','actions');
 const termsLink=el('a','secondary','Download exact terms');termsLink.href='/api/licenses/'+l.id+'/terms';termsLink.download='';fileActions.append(termsLink);
 if(l.status==='issued'){
  const certificateButton=el('button','secondary','Download certificate JSON');certificateButton.type='button';certificateButton.addEventListener('click',downloadCertificate);fileActions.append(certificateButton);
  if(l.assetDelivery){const assetLink=el('a','','Download '+l.assetDelivery.filename);assetLink.href='/api/licenses/'+l.id+'/asset';assetLink.download='';fileActions.prepend(assetLink);}
 }
 box.insertBefore(actions,details);
 if(!creatorView&&l.status!=='requested'){const contact=window.recordHandoff.contact(l);if(contact)box.insertBefore(contact,details);}
 if(creatorView){const decision=window.recordHandoff.decisionControls(l);if(decision)amount.after(decision);}
 const handoff=window.recordHandoff.controls(l);if(creatorView){handoff.querySelector('summary').textContent='Share this record';box.append(handoff);}else box.insertBefore(handoff,details);
 if(buyerToken)box.insertBefore(window.recordHandoff.buyerControls(l,buyerToken),details);
 files.append(fileActions);box.append(files);

 if(creatorControls){if(creatorView&&l.status==='requested'){if(staleProposal&&changesControl)changesControl.open=true;box.insertBefore(creatorControls,actions);}else box.append(creatorControls);}
 const nodes=[box];if(l.status==='issued'&&state.certificate)nodes.push(window.LicenseCertificate.create(state.certificate));
 replace('checkout',nodes);window.dispatchEvent(new Event('licenselane:viewchange'));if(scroll){$('checkout-section').scrollIntoView({block:'start'});project.focus({preventScroll:true});}
}
function reviewSandboxPayment(){
 const l=state.license;
 if(!l||l.status!=='awaiting_payment'||checkoutPending.has(l.id))return;
 if(licenseScope.periodState(l.quote.period)==='ended'){toast('The agreed period has ended. Request new dates before another payment.');displayLicense(false);return;}
 const id=l.id,dialog=el('dialog','capture-review');dialog.id='capture-review';dialog.setAttribute('aria-labelledby','capture-heading');
 const heading=el('h3','','Complete your purchase');heading.id='capture-heading';heading.tabIndex=-1;
 const top=el('div','payment-heading');top.append(heading,el('span','payment-sandbox','Sandbox'));
 const amount=el('p','payment-amount',money(l.quote.priceCents));
 const edition=window.licenseEdition(l);
 for(const item of edition.querySelectorAll('.saved-edition-label,.saved-edition-specs,.saved-edition-file,.saved-edition-fingerprint,.saved-offer-revision'))item.remove();
 const work=el('strong','payment-work',l.quote.assetTitle);
 edition.querySelector('.saved-edition-info').prepend(work);
 const details=el('dl','payment-scope');
 const use=l.request.medium==='print'?new Intl.NumberFormat('en-US').format(l.request.copies)+' printed copies':l.request.medium==='website'?'Website':l.request.medium==='social'?'Social media':l.request.medium;
 for(const [label,value] of [['Project',l.request.project],['Licensed to',l.request.licensee],['Use',use+' · '+l.quote.term],...(l.quote.period?[['Agreed dates',licenseScope.periodLabel(l.quote.period)]]:[])]){
  details.append(el('dt','',label),el('dd','',String(value)));
 }
 dialog.append(top,amount,edition,details);
 const actions=el('div','actions payment-actions'),cancel=el('button','secondary','Not now'),confirm=el('button','','Pay '+money(l.quote.priceCents));
 confirm.dataset.paymentAction='capture';
 cancel.type=confirm.type='button';cancel.addEventListener('click',()=>dialog.close());
 confirm.addEventListener('click',()=>{
  if(state.license?.id!==id||state.license.status!=='awaiting_payment'||licenseScope.periodState(state.license.quote.period)==='ended'){dialog.close();toast('The open record changed. Review its current payment details before continuing.');return;}
  confirm.disabled=true;dialog.close();licenseAction('capture',id);
 });
 actions.append(cancel,confirm);dialog.append(actions);
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();heading.focus({preventScroll:true});dialog.scrollTop=0;
}
async function licenseAction(action,expectedId=state.license?.id){
 if(!state.license||state.license.id!==expectedId||checkoutPending.has(expectedId))return;
 const id=expectedId,creatorCode=$('checkout-code')?.value??$('code').value;
 checkoutPending.add(id);displayLicense(false);
 try{
  const buyerAccessToken=state.buyerAccess.get(id);
  const credentials=action==='approve'?{creatorCode,creatorApproved:true}:buyerAccessToken?{buyerAccessToken}:{creatorCode};
  const data=await api('/api/licenses/'+id+'/'+action,credentials);
  rememberLicense(data.license);
  if(action==='approve')toast('Creator approved the saved terms. No payment was attempted.');
  if(state.license?.id===id){state.license=data.license;state.certificate=data.certificate||null;state.restored=false;displayLicense();}
  if(data.license.status==='order_unknown'||data.license.status==='capture_unknown')toast('The provider outcome is uncertain. Do not start a duplicate payment.');
 }catch(e){if(action==='capture'&&e.code==='RECOVERY_CHECKPOINT_PENDING'&&state.license?.id===id){state.license.captureBlocked='recovery_pending';}else toast(e.message);}
 finally{checkoutPending.delete(id);if(state.license?.id===id)displayLicense(false);}
}
function downloadCertificate(){if(!state.certificate)return;const blob=new Blob([JSON.stringify(state.certificate,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=el('a');a.href=url;a.download=state.certificate.certificateId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
function configureRecoveryDesk(){
 document.body.classList.add('recovery-desk');
 const status=$('records-filter');status.querySelector('option[value=archived]')?.remove();status.querySelector('option[value=all]').textContent='All records';if(status.value==='archived')status.value='all';
 $('connection').textContent='Recovery copy';$('connection').setAttribute('aria-label','Read-only recovery copy');
 $('desk-title').textContent='Your purchased artwork';$('desk-title').classList.remove('visually-hidden');
 const intro=el('p','recovery-intro','Open a saved license to download its original file and exact terms.');$('desk-title').after(intro);
 $('vault').open=true;$('vault').querySelector('summary').textContent='Open a saved license';document.querySelector('.records-restore').open=true;
 const input=$('license-reference');input.removeAttribute('pattern');input.placeholder='Paste a link or reference';
 input.parentElement.firstChild.textContent='License link or reference';
}
async function openSavedReference(value){
 let id=value,token=null;
 if(!/^[a-f0-9]{64}$/.test(value)){
  let url;try{url=new URL(value);}catch{throw Error('Paste your complete LicenseLane link or record reference.');}
  const origins=[location.origin,state.config?.installationOrigin,state.config?.restoredOrigin,state.config?.recoveryOrigin,state.config?.primaryUrl,state.config?.recoveryUrl].filter(origin=>typeof origin==='string'&&origin);
  if(!origins.includes(url.origin))throw Error('This link belongs to a different LicenseLane installation.');
  const match=url.hash.match(/^#(record|buyer)=([a-f0-9]{64})(?:\.([a-f0-9]{64}))?$/);
  if(!match||(match[1]==='buyer')!==!!match[3])throw Error('This license link is incomplete.');
  id=match[2];token=match[3]||null;
 }
 if(token)return restoreBuyerAccess(id,token);
 return openLicense(id);
}
function displayRecoveryRecord(l,scroll){
 document.body.classList.add('paid-record-view');$('checkout-section').hidden=false;$('vault').open=false;
 $('record-stage-title').textContent='Your saved request and terms';
 const box=el('article','paid-record recovery-record');box.setAttribute('aria-label','Saved licensing request');
 const nav=el('div','record-toolbar'),back=el('button','record-back','← Saved records');
 back.type='button';back.addEventListener('click',leavePaidRecord);nav.append(back);box.append(nav);
 const statuses={requested:'Awaiting creator approval',changes_requested:'Changes requested',approved:'Terms approved',creating_order:'Checkout started',order_unknown:'Checkout needs review',awaiting_payment:'Awaiting Sandbox payment',capture_unknown:'Payment needs review'};
 const top=el('header','paid-heading'),title=el('div');
 title.append(el('p','paid-status recovery-status',l.paymentObservation?'Payment previously confirmed':statuses[l.status]||'Saved request'),el('h2','paid-title',l.quote.assetTitle),el('p','paid-project',l.request.project));
 const amount=el('div','paid-amount recovery-quote');amount.append(el('strong','',money(l.quote.priceCents)),el('span','','Quoted in USD'));top.append(title,amount);box.append(top);
 const use={website:'Website',social:'Social media',print:'Print',merchandise:'Merchandise'}[l.request.medium]||l.request.medium;
 const scope=el('p','paid-scope recovery-scope',l.request.licensee+' · '+use+(l.request.copies?' · '+new Intl.NumberFormat('en-US').format(l.request.copies)+' copies':'')+' · '+l.quote.term+' · '+l.quote.territory);box.append(scope);
 const file=el('section','paid-file'),edition=window.licenseEdition(l),fingerprint=edition.querySelector('.saved-edition-fingerprint');
 if(fingerprint)fingerprint.remove();file.append(edition);
 const terms=el('a','paid-download','Download saved terms');terms.href='/api/licenses/'+l.id+'/terms';terms.download='';file.append(terms);box.append(file);
 if(!l.paymentObservation?.mismatch&&state.config.recoveryPaymentCheckConfigured&&l.orderId&&['awaiting_payment','capture_unknown'].includes(l.status)){
  const section=el('section','recovery-payment-check'),heading=el('h3','','Already paid?'),description=el('p','','Check PayPal for this saved order to recover your original file.');
  const button=el('button','paid-download','Check existing payment');button.type='button';
  button.addEventListener('click',async()=>{button.disabled=true;button.textContent='Checking payment…';try{const result=await api('/api/licenses/'+l.id+'/check-payment',{});state.license=result.license;state.certificate=result.certificate;rememberLicense(result.license);displayLicense(true);}catch(error){toast(error.message);button.disabled=false;button.textContent='Check existing payment';}});
  section.append(heading,description,button);box.append(section);
 }
 const details=el('details','paid-details');details.append(el('summary','','Request details'));
 const facts=el('dl','license-summary');for(const [name,value] of [['Creator',l.quote.creator],['Requested by',l.request.licensee],['Project',l.request.project],['Use',use+(l.request.copies?' · '+l.request.copies+' copies':'')],['Term',l.quote.term+' · '+l.quote.territory],['Record reference',l.id]])facts.append(el('dt','',name),el('dd','',value));
 details.append(facts);const briefSection=requestBrief(l.request);if(briefSection)details.append(briefSection);if(fingerprint)details.append(fingerprint);box.append(details);
 replace('checkout',[box]);window.dispatchEvent(new Event('licenselane:viewchange'));
 if(scroll){$('checkout-section').scrollIntoView({block:'start'});const heading=box.querySelector('.paid-title');heading.tabIndex=-1;heading.focus({preventScroll:true});}
}
function showConnectionRecovery(retry){
 let dialog=$('connection-recovery');
 if(showSavedRecovery()){
  if(dialog){dialog.close();dialog.remove();}
  const card=document.querySelector('.startup-recovery'),link=card.querySelector('a'),reference=window.recordHandoff.pendingReference();
  card.querySelector('p').textContent='Open your saved copy, or retry this connection.';
  if(reference)link.hash='record='+reference;
  const button=el('button','secondary','Retry connection');button.type='button';button.id='connection-retry';button.addEventListener('click',retry);card.append(button);button.focus();
  return;
 }
 if(dialog)return;
 dialog=el('dialog','capture-review connection-recovery');dialog.id='connection-recovery';dialog.setAttribute('aria-labelledby','connection-recovery-heading');
 const heading=el('h3','','Connection interrupted');heading.id='connection-recovery-heading';
 const message=el('p','','Try again to open your licenses.');
 const button=el('button','primary','Retry connection');button.type='button';button.id='connection-retry';button.addEventListener('click',retry);
 const actions=el('div','actions');actions.append(button);dialog.append(heading,message,actions);
 dialog.addEventListener('cancel',event=>event.preventDefault());document.body.append(dialog);dialog.showModal();button.focus();
}
async function initialize(){
 initializeRequestedScope();loadBuyerAccess();
 $('records-search').addEventListener('input',drawVault);$('records-filter').addEventListener('change',drawVault);
 $('records-backup').addEventListener('click',downloadRecordsBackup);
 $('records-refresh').addEventListener('click',refreshRecords);
 $('buyer-access-file').addEventListener('change',async e=>{const input=e.currentTarget,file=input.files?.[0];if(!file)return;input.disabled=true;const restore=$('records-empty-restore');if(restore){restore.disabled=true;restore.textContent='Restoring records…';}try{await importBuyerAccess(file);}catch(error){toast(error.message);}finally{input.value='';input.disabled=false;const remaining=$('records-empty-restore');if(remaining){remaining.disabled=false;remaining.textContent='Restore from private file';}}});
 let connecting=false,connected=false;
 async function connect(){
 if(connecting||connected)return;
 connecting=true;
 const retry=$('connection-retry');if(retry){retry.disabled=true;retry.textContent='Connecting…';}
 try{
 const [config,catalog]=await Promise.all([boundedRead('/api/config'),boundedRead('/api/catalog')]);state.config=config;state.catalog=catalog;rememberRecoveryAddress(config);clearSavedRecovery();
 window.dispatchEvent(new CustomEvent('licenselane:connected',{detail:config}));
 const linkedWork=new URLSearchParams(location.search).get('work');if(linkedWork)state.selected=catalog.works.some(work=>work.id===linkedWork)?linkedWork:null;else if(!catalog.works.some(work=>work.id===state.selected))state.selected=catalog.works[0]?.id||null;
 $('connection').textContent='Sandbox';$('connection').setAttribute('aria-label',config.paypalConfigured?'Sandbox configured':'Sandbox: PayPal setup needed');$('code-label').hidden=!config.creatorCodeRequired;
 drawWorks();drawPolicy();if(config.recoveryOnly)configureRecoveryDesk();else if(!$('local-draft'))initializeDraft();const recoveredSave=config.recoveryOnly?false:await recoverPendingProposalSaves();const hasRecordLink=await window.recordHandoff.restore();await restoreLicense(!hasRecordLink&&!linkedWork&&location.hash!=='#vault'&&(config.recoveryOnly||!['#work-section','#scope-section'].includes(location.hash)));
 if(!config.recoveryOnly&&linkedWork&&!hasRecordLink&&!recoveredSave)selectLinkedWork(linkedWork);
 if(!hasRecordLink&&!recoveredSave&&(pendingProposalKeys().length||pendingApprovalKeys().length)){$('vault').open=true;document.querySelector('.pending-proposal-recovery button,.pending-approval-recovery input')?.focus();$('vault').scrollIntoView({block:'start'});}
 connected=true;
 const recovery=$('connection-recovery');if(recovery){recovery.close();recovery.remove();}
 }catch(e){$('connection').textContent='Offline';showConnectionRecovery(connect);}
 finally{connecting=false;const button=$('connection-retry');if(button){button.disabled=false;button.textContent='Retry connection';}}
 }

 $('open-reference').addEventListener('submit',async e=>{
  e.preventDefault();const button=e.submitter,id=$('license-reference').value.trim();
  if(button)button.disabled=true;
  try{await openSavedReference(id);$('license-reference').value='';}
  catch(error){toast(error.message);}
  finally{if(button)button.disabled=false;}
 });
 $('request-form').addEventListener('input',invalidateChangedDraft);
 $('request-form').addEventListener('change',invalidateChangedDraft);
 let reviewAttempt=0;
 async function reviewRequest(useAI){
  if(window.confirmBriefArtwork&&!await window.confirmBriefArtwork())return;
  if(!state.catalog?.works.some(work=>work.id===state.selected)){showUnavailableOffer();return;}
  if(selectedOfferPaused()){showPausedOffer();return;}
  const currentDestination=beginDestinationRead(),attempt=++reviewAttempt,submitted=formRequest(),button=document.querySelector('#request-form button[type=submit]');
  button.disabled=true;$('review-pending').hidden=false;$('review-pending-text').textContent=useAI?'Asking your local model to explain the policy. You can continue with policy checks while it works.':'Checking the published policy…';
  $('review-rules').hidden=!useAI;
  state.review=null;$('approval').hidden=true;$('result-section').hidden=true;$('draft-change').hidden=true;
  try{
   const review=await (useAI?api('/api/review',{...submitted,useAI}):boundedRead('/api/review',{...submitted,useAI},'Price and terms could not be checked. Try again.'));
   if(attempt!==reviewAttempt||!currentDestination())return;
   refreshCatalogWork(review.work);
   if(!sameRequest(submitted,formRequest())||!sameRequest(review.request,formRequest())){
    $('draft-change').textContent='Request changed while review was running. Review the current scope before creator approval.';$('draft-change').hidden=false;return;
   }
   state.review=review;$('draft-change').hidden=true;state.license=null;state.certificate=null;$('checkout-section').hidden=true;drawReview();
  }catch(err){if(attempt===reviewAttempt&&currentDestination()){if(err.code==='READ_TIMEOUT'){$('draft-change').textContent=err.message;$('draft-change').hidden=false;}else if((err.code==='OFFER_CHANGED'||err.code==='OFFER_PAUSED')&&submitted.assetId===state.selected)handleOfferChanged(err,null);else toast(err.message);}}
  finally{if(attempt===reviewAttempt){$('review-pending').hidden=true;syncOfferAvailability();}}
 }
 $('request-form').addEventListener('submit',e=>{e.preventDefault();reviewRequest(false);});
 $('review-rules').addEventListener('click',()=>{if(!$('request-form').reportValidity())return;reviewRequest(false);});

 $('approve').addEventListener('click',async()=>{const button=$('approve');if(state.license){toast('This request is already approved. Continue with the existing license.');return;}if(!state.review||!sameRequest(state.review.request,formRequest())){invalidateChangedDraft();toast('Review the revised scope before approval.');return;}const review=state.review;button.disabled=true;try{const save=saveIntent('approved',review);await retainApprovalSave(save);const response=await api('/api/licenses',{...save.payload,saveKey:save.saveKey,creatorApproved:true,creatorCode:$('code').value});clearTimeout(window.toastHandle);$('toast').hidden=true;clearSaveRetryFeedback(button);state.license=response.license;state.certificate=null;state.restored=false;rememberLicense(state.license);finishApprovalRecovery(save.saveKey,state.license);completeSaveIntent(save);$('approval').hidden=true;displayLicense();}catch(e){if(!handleOfferChanged(e,review)&&!showSaveRetry(button,e,review))toast(e.message);}finally{if(button)button.disabled=false;}});
 await connect();
}
// Later deferred modules provide draft and navigation behavior used by connect.
// Start only once the browser has executed the complete deferred script list.
window.addEventListener('DOMContentLoaded',initialize,{once:true});
