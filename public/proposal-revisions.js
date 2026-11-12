'use strict';
function clearProposalRevision(){
 state.revisionOf=null;
 document.getElementById('revision-context')?.remove();
}
async function beginProposalRevision(license,button,{separate=false}={}){
 const ended=licenseScope.periodState(license.quote?.period)==='ended';
 if(separate?!(['issued','requested'].includes(license.status)||ended&&['approved','awaiting_payment'].includes(license.status))||state.config?.recoveryOnly:!['changes_requested','requested'].includes(license.status))return;
 if(license.status==='requested'&&!state.buyerAccess.has(license.id)){toast('Restore your private buyer access before correcting this proposal.');return;}
 if(!confirm(separate?(license.status==='requested'?'Use this saved proposal as a new request? This replaces unsaved form details. Your original proposal stays unchanged.':'Use this purchase as a new request? This replaces unsaved form details. Your purchased license stays unchanged.'):'Load this proposal into the request form? Any unsaved scope details currently in the form will be replaced.'))return;
 const currentRead=beginRecordRead();
 if(separate||!state.catalog.works.some(work=>work.id===license.request.assetId)){
  const label=button?.textContent;
  if(button){button.disabled=true;button.textContent='Opening artwork…';}
  try{
   const data=await boundedRead('/api/catalog/'+encodeURIComponent(license.request.assetId),undefined,'The original artwork is taking too long to reopen.');
   if(!currentRead())return;
   if(data.work?.id!==license.request.assetId)throw Error('Original artwork mismatch');
   if(separate&&data.work.offerStatus==='paused'){toast('The creator paused this offer. Your saved request and current draft are unchanged.');return;}
   const existing=state.catalog.works.findIndex(work=>work.id===data.work.id);
   if(existing<0)state.catalog.works.push(data.work);else if(separate)state.catalog.works[existing]=data.work;
  }catch(error){
   if(!currentRead())return;
   toast(error.status===404?'The original artwork is no longer available. Your saved request and current fields are unchanged.':'The original artwork could not be reopened. Retry opening the artwork; your current fields are unchanged.');
   return;
  }finally{if(button){button.disabled=false;button.textContent=label;}}
 }
 if(!currentRead())return;
 clearProposalRevision();
 state.selected=license.request.assetId;
 for(const key of ['licensee','project','medium','copies'])$(key).value=license.request[key];
 for(const key of ['attribution','exclusive','training'])$(key).checked=license.request[key];
 $('project-brief').value=license.request.brief||'';
 restoreRequestedScope(license.request,license.quote);
 if(separate&&ended){$('use-start-date').value='';refreshScopeConfirmation();}
 $('project-brief').dispatchEvent(new Event('input',{bubbles:true}));
 state.review=null;state.license=null;state.certificate=null;state.restored=false;
 $('approval').hidden=true;$('result-section').hidden=true;$('checkout-section').hidden=true;
 drawWorks();
 if(separate){history.replaceState(history.state,'','#scope-section');window.dispatchEvent(new Event('licenselane:viewchange'));}
 if(!separate)setProposalRevisionContext(license);
 else{const note=el('p','revision-note','New request from '+license.request.project+'. Review current terms before sending it to the creator.');note.id='revision-context';$('request-form').prepend(note);}
 $('draft-change').hidden=true;if(selectedOfferPaused())showPausedOffer();
 if(separate&&!$('use-start-date').value){const date=$('use-start-date');date.focus({preventScroll:true});date.closest('label').scrollIntoView({behavior:'smooth',block:'center'});}
 else{$('request-form').scrollIntoView({behavior:'smooth',block:'start'});$('project').focus();}
}
function setProposalRevisionContext(license){
 clearProposalRevision();
 state.revisionOf={id:license.id,project:license.request.project,reason:license.creatorDecision?.reason||'Replace the pending proposal with corrected terms.',pending:license.status==='requested'};
 const notice=el('div','revision-note');notice.id='revision-context';
 notice.append(el('strong','','Correcting '+license.request.project));
 if(!state.revisionOf.pending)notice.append(el('p','',state.revisionOf.reason));
 notice.append(el('p','',state.revisionOf.pending?'Saving replaces the pending proposal.':'Review these changes for a new creator decision.'));
 const cancel=el('button','secondary','Use this draft as a separate request');cancel.type='button';
 cancel.addEventListener('click',()=>{clearProposalRevision();state.review=null;$('result-section').hidden=true;$('approval').hidden=true;toast('The draft is now separate. Review it before saving.');});
 notice.append(cancel);$('request-form').prepend(notice);
}
function proposalRevisionControls(license,box,actions,busy){
 if(license.status==='withdrawn'){
  const note=el('div','revision-note');note.append(el('strong','','Proposal withdrawn'),el('p','','These saved terms are preserved. This proposal is closed to creator approval and checkout.'));
  box.insertBefore(note,box.querySelector('.license-summary'));
 }

 if(license.replacedBy||license.replaces){
  const note=el('div','revision-note'),retired=!!license.replacedBy;
  note.append(el('strong','',retired?'Replaced proposal':'Corrected proposal'),el('p','',retired?'These original terms are preserved. Approval and checkout are closed.':'This proposal replaces earlier terms and needs its own creator approval.'));
  const link=el('button','secondary',retired?'Open replacement proposal':'View original terms');link.type='button';
  link.addEventListener('click',async()=>{try{await openLicense(license.replacedBy||license.replaces.id);}catch(e){toast(e.message);}});
  note.append(link);if(!retired)appendRevisionComparison(license,note);box.insertBefore(note,box.querySelector('.license-summary'));
 }
 if(license.status==='requested'&&state.buyerAccess.has(license.id)&&state.creatorReviewRecordId!==license.id){
  const correct=el('button','secondary','Correct pending proposal');correct.type='button';correct.disabled=busy;
  correct.addEventListener('click',()=>beginProposalRevision(license,correct));actions.append(correct);
  const separate=el('button','secondary','Use as new request');separate.type='button';separate.disabled=busy;
  separate.addEventListener('click',()=>beginProposalRevision(license,separate,{separate:true}));actions.append(separate);
  const details=el('details','proposal-withdrawal');details.append(el('summary','','Withdraw this proposal'));
  const text=el('p','','No longer need this request? Withdraw it before creator approval. The saved terms stay in your records; this request cannot be approved or paid.');
  const label=el('label','consent'),check=el('input');check.type='checkbox';label.append(check,document.createTextNode('Withdraw '+license.request.project));
  const button=el('button','secondary','Confirm withdrawal');button.type='button';button.disabled=true;
  const status=el('p','muted');status.setAttribute('role','status');
  check.addEventListener('change',()=>{button.disabled=!check.checked||checkoutPending.has(license.id);});
  button.addEventListener('click',async()=>{
   if(!check.checked||checkoutPending.has(license.id))return;
   checkoutPending.add(license.id);button.disabled=true;status.textContent='Withdrawing proposal…';
   try{
    const data=await api('/api/licenses/'+license.id+'/withdraw',{buyerAccessToken:state.buyerAccess.get(license.id),buyerWithdrawn:true});
    checkoutPending.delete(license.id);rememberLicense(data.license);
    if(state.license?.id===license.id){state.license=data.license;displayLicense();}
    toast('Proposal withdrawn. The saved terms remain in your records.');
   }catch(e){status.textContent=e.message+' You can refresh the saved status before retrying.';}
   finally{checkoutPending.delete(license.id);button.disabled=!check.checked;}
  });
  details.append(text,label,button,status);box.append(details);

 }

 if(license.creatorDecision){
  const decision=el('section','creator-feedback');
  const creatorView=state.creatorReviewRecordId===license.id;
  decision.append(el('h5','',creatorView?'Changes requested':'What the creator needs changed'),el('p','feedback-reason',license.creatorDecision.reason),el('p','muted','Saved '+new Date(license.creatorDecision.decidedAt).toLocaleString()+' · the original scope below is unchanged.'));
  const revise=el('button','','Prepare corrected proposal');revise.type='button';revise.addEventListener('click',()=>beginProposalRevision(license,revise));
  if(!creatorView)decision.append(revise);box.insertBefore(decision,box.querySelector('.license-summary'));
 }
 if(license.revisionOf){
  const source=el('div','revision-note');
  source.append(el('strong','','Revised proposal'),el('p','',license.revisionOf.reason));
  const link=el('button','secondary','Open original proposal and decision');link.type='button';
  link.addEventListener('click',async()=>{try{await openLicense(license.revisionOf.id);}catch(e){toast(e.message);}});
  source.append(link);appendRevisionComparison(license,source);box.insertBefore(source,box.querySelector('.license-summary'));
 }
 if(license.status!=='requested')return;
 const details=el('details','creator-changes'),summary=el('summary','','Creator: request changes instead');
 const hint=el('p','','Explain what the buyer should change. Saving this decision closes this proposal to approval and checkout; a correction becomes a new request.');
 const label=el('label','','Changes needed'),reason=el('textarea');reason.id='creator-change-reason';reason.rows=4;reason.maxLength=1000;reason.minLength=10;reason.placeholder='For example: Please name the publication and reduce the print run to 800 copies.';
 label.htmlFor=reason.id;label.append(reason);
 const button=el('button','secondary','Save changes requested');button.type='button';button.disabled=busy;
 const feedback=el('p','muted');feedback.setAttribute('role','status');
 button.addEventListener('click',async()=>{
  if(checkoutPending.has(license.id))return;
  if(reason.value.trim().length<10){feedback.textContent='Explain the changes needed in at least 10 characters.';reason.focus();return;}
  const creatorCode=$('checkout-code')?.value??$('code').value;
  button.disabled=true;checkoutPending.add(license.id);feedback.textContent='Saving the creator decision…';
  try{
   const data=await api('/api/licenses/'+license.id+'/request-changes',{reason:reason.value,creatorConfirmed:true,creatorCode});
   rememberLicense(data.license);
   if(state.license?.id===license.id){state.license=data.license;state.certificate=null;state.restored=false;displayLicense();}
   toast('Changes requested. The original proposal cannot be paid; the buyer can prepare a correction.');
  }catch(e){feedback.textContent=e.message;}
  finally{checkoutPending.delete(license.id);button.disabled=false;}
 });
 details.append(summary,hint,label,button,feedback);box.append(details);
}
