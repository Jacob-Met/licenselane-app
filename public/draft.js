'use strict';
// Explicit browser-local drafts contain inputs only, never authority or model output.
function initializeDraft(){
 const key='licenselane:unfinished-draft:v1',form=$('request-form');
 const box=el('div','local-draft'),status=el('p','muted'),actions=el('div','actions');
 const label=el('strong','draft-label'),footer=el('div','local-draft-save'),saveActions=el('div','actions');
 box.id='local-draft';status.id='local-draft-status';status.setAttribute('role','status');
 const save=el('button','secondary','Save draft'),restore=el('button','secondary','Restore saved draft'),discard=el('button','secondary','Discard saved draft');
 save.type=restore.type=discard.type='button';save.id='save-draft';restore.id='restore-draft';discard.id='discard-draft';
 actions.append(restore,discard);box.append(label,actions);form.prepend(box);
 saveActions.append(save,el('span','muted','On this browser only'));
 const conflict=el('div','local-draft-conflict'),conflictText=el('p','muted'),conflictActions=el('div','actions');
 const restoreLatest=el('button','secondary','Restore saved draft'),replaceSaved=el('button','secondary','Replace saved draft with these fields');
 conflict.id='draft-conflict';conflict.hidden=true;conflictText.setAttribute('role','status');
 restoreLatest.type=replaceSaved.type='button';restoreLatest.id='restore-newer-draft';replaceSaved.id='replace-newer-draft';
 conflictActions.append(restoreLatest,replaceSaved);conflict.append(conflictText,conflictActions);
 footer.append(saveActions,status,conflict);form.append(footer);
 const access=el('button','secondary','Restore buyer access for this draft'),buyerFile=el('input'),independent=el('button','secondary','Use draft as a new request');
 access.id='draft-restore-access';access.type='button';access.hidden=true;
 buyerFile.id='draft-buyer-file';buyerFile.type='file';buyerFile.accept='.json,application/json';buyerFile.hidden=true;
 independent.id='draft-use-independent';independent.type='button';independent.hidden=true;
 const retryOriginal=el('button','secondary','Retry original proposal');retryOriginal.id='draft-retry-original';retryOriginal.type='button';retryOriginal.hidden=true;
 const accessActions=el('div','actions');accessActions.append(access,retryOriginal,independent);footer.append(accessActions,buyerFile);
 retryOriginal.addEventListener('click',async()=>{retryOriginal.disabled=true;try{await restoreSavedDraft();}finally{retryOriginal.disabled=false;}});
 let accessDraft=null,independentDraft=null,independentRaw=null;
 independent.addEventListener('click',async()=>{
  if(!independentDraft)return;independent.disabled=true;
  try{await restoreSavedDraft({mode:'independent',raw:independentRaw});}
  finally{independent.disabled=false;}
 });
 access.addEventListener('click',()=>buyerFile.click());
 buyerFile.addEventListener('change',async()=>{
  const file=buyerFile.files[0],draft=accessDraft;buyerFile.value='';if(!file||!draft)return;
  access.disabled=true;
  try{
   const restored=await importBuyerAccess(file,{expectedLicenseId:draft.revisionId,showRecord:false});
   if(!restored||saved!==draft||accessDraft!==draft)return;
   render('Buyer access restored. Choose Restore saved draft to continue your correction.');restore.focus();
  }catch(error){if(saved===draft&&accessDraft===draft)render(error.message);}
  finally{access.disabled=false;}
 });
 const decisionBox=el('div','local-draft-decision'),decisionFeedback=el('p','feedback-reason'),decisionActions=el('div','actions');
 const openOriginal=el('button','secondary','Open original proposal'),continueDecision=el('button','secondary');
 decisionBox.id='draft-decision-actions';decisionBox.hidden=true;openOriginal.type=continueDecision.type='button';
 openOriginal.id='draft-open-original';continueDecision.id='draft-continue-decision';
 decisionActions.append(openOriginal,continueDecision);decisionBox.append(decisionFeedback,decisionActions);footer.append(decisionBox);
 let decisionContext=null;
 openOriginal.addEventListener('click',async()=>{
  const context=decisionContext;if(!context)return;openOriginal.disabled=true;
  try{await openLicense(context.license.id);}catch(error){if(decisionContext===context)render(error.message);}
  finally{openOriginal.disabled=false;}
 });
 continueDecision.addEventListener('click',async()=>{
  const context=decisionContext;if(!context)return;continueDecision.disabled=true;
  try{await restoreSavedDraft({mode:context.mode,status:context.license.status,raw:context.raw});}
  finally{continueDecision.disabled=false;}
 });
 function offerChangedDecision(draft,raw,license){
  const feedback=license.status==='changes_requested';
  decisionContext={draft,raw,license,mode:feedback?'feedback':'new'};
  decisionFeedback.textContent=feedback?license.creatorDecision?.reason||'':'';decisionFeedback.hidden=!decisionFeedback.textContent;
  continueDecision.textContent=feedback?'Continue with creator feedback':'Use draft as a new request';
  decisionBox.hidden=false;
  render(feedback?'The creator requested changes while this draft was saved. Continue with that feedback and your saved edits.':license.status==='approved'?'The creator approved the original proposal. These saved edits need a new request and a separate creator decision.':license.status==='issued'?'The original license has been issued. These saved edits need a new request and a separate creator decision.':'The original proposal has changed. Open its saved terms, or use these edits for a new request.');
  continueDecision.focus({preventScroll:true});decisionBox.scrollIntoView({block:'center',behavior:'smooth'});
 }
 let saved=null,seenRaw=null,conflictRaw=null;
 function inputState(){
  return {request:{assetId:state.selected||state.linkedWorkId,licensee:$('licensee').value,project:$('project').value,medium:$('medium').value,copies:$('copies').value,termMonths:$('term-months').value,territory:$('requested-territory').value,startsOn:$('use-start-date').value,attribution:$('attribution').checked,exclusive:$('exclusive').checked,training:$('training').checked},brief:$('project-brief').value,scopeReviewed:requestedScopeReviewed,scopeExplicit:requestedScopeExplicit,revisionId:state.revisionOf?.id||null,replacement:!!state.revisionOf?.pending};
 }
 const signature=d=>JSON.stringify({request:d.request,brief:d.brief,scopeReviewed:d.scopeReviewed,scopeExplicit:d.scopeExplicit,revisionId:d.revisionId||null,replacement:!!d.replacement});
 const withoutArtwork=d=>({...d,request:{...d.request,assetId:null}});
 const initial=signature(withoutArtwork(inputState()));let submitted=null,leaving=false;
 window.markDraftSaved=()=>{submitted=signature(inputState());};
 function unsaved(){
  const current=signature(inputState());
  if(signature(withoutArtwork(inputState()))===initial||current===submitted)return false;
  try{const retained=parsed(localStorage.getItem(key));if(retained&&signature(retained)===current)return false;}catch{}
  return true;
 }
 window.addEventListener('beforeunload',event=>{if(!leaving&&unsaved()){event.preventDefault();event.returnValue='';}});
 const leave=el('dialog','draft-leave-dialog');leave.id='draft-leave-dialog';
 const heading=el('h2','','Keep your unfinished request?');heading.id='draft-leave-title';leave.setAttribute('aria-labelledby',heading.id);
 const explanation=el('p','','Your latest changes have not been saved. Save a draft on this browser before leaving, or keep editing.');
 const leaveStatus=el('p','muted');leaveStatus.setAttribute('role','status');leaveStatus.hidden=true;
 const leaveActions=el('div','draft-leave-actions'),keep=el('button','secondary','Keep editing'),saveLeave=el('button','primary','Save draft & leave'),without=el('button','secondary','Leave without saving');
 keep.type=saveLeave.type=without.type='button';keep.autofocus=true;
 leaveActions.append(saveLeave,keep,without);leave.append(heading,explanation,leaveStatus,leaveActions);document.body.append(leave);
 let destination=null,opener=null,leaveVersion=0;
 const closeLeave=()=>{leaveVersion++;destination=null;leave.close();opener?.focus({preventScroll:true});};
 keep.addEventListener('click',closeLeave);
 leave.addEventListener('cancel',()=>{leaveVersion++;destination=null;});
 function depart(){leaving=true;location.assign(destination);}
 without.addEventListener('click',depart);
 saveLeave.addEventListener('click',async()=>{
  const version=leaveVersion;saveLeave.disabled=without.disabled=true;
  try{
   await saveFields();
   if(!leave.open||version!==leaveVersion)return;
   if(!unsaved()){depart();return;}
   leaveStatus.textContent=status.textContent||conflictText.textContent||'The draft was not saved. Keep editing to resolve it before leaving.';
   if(!conflict.hidden)leaveStatus.textContent='Another tab changed the saved draft. Keep editing to choose which version to retain.';
   leaveStatus.hidden=false;
  }finally{saveLeave.disabled=without.disabled=false;}
 });
 document.addEventListener('click',event=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const link=event.target.closest('a[href]');if(!link||link.hasAttribute('download')||(link.target&&link.target!=='_self'))return;
  const url=new URL(link.href,location.href);
  if(!['http:','https:'].includes(url.protocol)||(url.origin===location.origin&&url.pathname===location.pathname&&url.search===location.search))return;
  if(!unsaved())return;
  event.preventDefault();leaveVersion++;destination=url.href;opener=link;leaveStatus.hidden=true;leave.showModal();
 });

 const locked=fn=>navigator.locks?navigator.locks.request(key,fn):Promise.resolve().then(fn);
 function parsed(raw){try{const d=JSON.parse(raw);return valid(d)?d:null;}catch{return null;}}
 function changed(raw,scroll=false){
  conflictRaw=raw;saved=parsed(raw);
  conflictText.textContent=saved?'A newer draft was saved in another tab: '+(saved.request.project||'Untitled project')+'. Your current fields are unchanged.':raw===null?'The saved draft was removed in another tab. Your current fields are unchanged.':'The saved draft changed in another tab and cannot be read. Your current fields are unchanged.';
  restoreLatest.hidden=!saved;replaceSaved.textContent=raw===null?'Save these fields as a new draft':'Replace saved draft with these fields';
  conflict.hidden=false;saveActions.hidden=true;render();if(scroll)conflict.scrollIntoView({block:'nearest',behavior:'smooth'});
 }
 function settled(raw){seenRaw=raw;conflictRaw=null;conflict.hidden=true;saveActions.hidden=false;}
 window.addEventListener('storage',event=>{
  if(event.key!==key&&event.key!==null)return;
  try{const raw=localStorage.getItem(key);if(raw!==seenRaw)changed(raw);}catch{render('Browser storage is unavailable. Your current fields are unchanged.');}
 });
 // Local drafts retain source text; the model's input budget is enforced when requesting suggestions.
 function valid(d){
  return (d?.revisionId==null||(typeof d.revisionId==='string'&&/^[a-f0-9]{64}$/.test(d.revisionId)))&&d?.version===1&&typeof d.savedAt==='string'&&typeof d.brief==='string'
   &&d.request&&typeof d.request.assetId==='string'&&/^[a-z0-9-]{1,128}$/.test(d.request.assetId)
   &&['licensee','project','copies'].every(k=>typeof d.request[k]==='string')
   &&d.request.licensee.length<=100&&d.request.project.length<=100&&d.request.copies.length<=20
   &&['','website','social','print','merchandise'].includes(d.request.medium)
   &&(d.request.termMonths===undefined||(typeof d.request.termMonths==='string'&&d.request.termMonths.length<=10))
   &&(d.request.startsOn===undefined||(typeof d.request.startsOn==='string'&&d.request.startsOn.length<=10))
   &&(d.request.territory===undefined||(typeof d.request.territory==='string'&&d.request.territory.length<=100))
   &&(d.scopeReviewed===undefined||typeof d.scopeReviewed==='boolean')
   &&(d.scopeExplicit===undefined||typeof d.scopeExplicit==='boolean')
   &&['attribution','exclusive','training'].every(k=>typeof d.request[k]==='boolean');
 }
 function render(message){
  if(decisionContext?.draft!==saved){decisionContext=null;decisionBox.hidden=true;}
  if(accessDraft!==saved||state.buyerAccess.has(accessDraft?.revisionId)){accessDraft=null;access.hidden=true;}
  if(independentDraft!==saved){independentDraft=null;independentRaw=null;independent.hidden=retryOriginal.hidden=true;}
  if(saved)$('scope-section').hidden=false;
  restore.hidden=discard.hidden=box.hidden=!saved;
  label.textContent=saved?'Saved draft: '+(saved.request.project||'Untitled project'):'';
  status.textContent=message||'';status.hidden=!message;
 }
 let initialMessage;
 try{const raw=localStorage.getItem(key);seenRaw=raw;if(raw){const d=JSON.parse(raw);if(valid(d))saved=d;else initialMessage='The saved draft could not be read. Save a new draft to replace it.';}}catch{initialMessage='Browser storage is unavailable or its saved draft is unreadable. Keep your brief elsewhere before leaving.';}
 render(initialMessage);
 async function saveFields(replace=false){
  beginRecordRead();
  const d={version:1,savedAt:new Date().toISOString(),...inputState()};
  const confirmedFields=window.captureDraftConfirmedFields?.();if(confirmedFields)d.confirmedFields=confirmedFields;
  const remainingUse=window.captureDraftRemainingUse?.();if(remainingUse)d.remainingUse=remainingUse;
  if(typeof d.request.assetId!=='string'||!/^[a-z0-9-]{1,128}$/.test(d.request.assetId)){render('Choose an artwork before saving this draft.');return;}
  if(!valid(d)){render('This draft could not be saved. Check the field lengths.');return;}
  const expected=replace?conflictRaw:seenRaw;save.disabled=replaceSaved.disabled=true;
  try{await locked(()=>{
   const raw=localStorage.getItem(key);
   if(raw!==expected){changed(raw,true);return;}
   const next=JSON.stringify(d);localStorage.setItem(key,next);saved=d;settled(next);
   render('Draft saved on this browser.');
  });}catch{render('Browser storage is unavailable. This draft was not saved; keep your brief elsewhere.');}
  finally{save.disabled=replaceSaved.disabled=false;}
 }

 // Draft files carry unfinished inputs only. Saved proposals and checkout access use their existing separate files.
 const transfer=el('details','draft-transfer'),transferTitle=el('summary','','Continue in another browser'),transferActions=el('div','actions');
 const download=el('button','secondary','Download draft file'),openFile=el('button','secondary','Open draft file'),fileInput=el('input');
 download.type=openFile.type='button';download.id='download-draft';openFile.id='open-draft-file';fileInput.id='draft-file';fileInput.type='file';fileInput.accept='.json,application/json';fileInput.hidden=true;
 transferActions.append(download,openFile,fileInput);transfer.append(transferTitle,transferActions);footer.append(transfer);
 const importDialog=el('dialog','draft-leave-dialog'),importTitle=el('h2','','Keep this unfinished draft?'),importSummary=el('p'),importScope=el('p'),importNotice=el('p'),importStatus=el('p','muted'),importActions=el('div','draft-leave-actions'),keepImport=el('button','primary','Keep imported draft'),cancelImport=el('button','secondary','Cancel');
 importDialog.id='draft-import-dialog';importTitle.id='draft-import-title';importDialog.setAttribute('aria-labelledby',importTitle.id);keepImport.type=cancelImport.type='button';keepImport.id='keep-imported-draft';cancelImport.id='cancel-draft-import';cancelImport.autofocus=true;importStatus.setAttribute('role','status');importActions.append(keepImport,cancelImport);importDialog.append(importTitle,importSummary,importScope,importNotice,importStatus,importActions);document.body.append(importDialog);
 let candidate=null,importExpected=null;
 const portable=d=>({version:1,savedAt:d.savedAt,request:Object.fromEntries(['assetId','licensee','project','medium','copies','termMonths','territory','startsOn','attribution','exclusive','training'].filter(k=>d.request[k]!==undefined).map(k=>[k,d.request[k]])),brief:d.brief,...(typeof d.scopeReviewed==='boolean'?{scopeReviewed:d.scopeReviewed}:{}),...(typeof d.scopeExplicit==='boolean'?{scopeExplicit:d.scopeExplicit}:{}),revisionId:d.revisionId||null,replacement:!!d.replacement});
 download.addEventListener('click',()=>{
  const d={version:1,savedAt:new Date().toISOString(),...inputState()};
  if(!valid(d)){render('Choose an artwork and check the field lengths before downloading this draft.');return;}
  const data=JSON.stringify({format:'licenselane-unfinished-draft',version:1,server:installationFileOrigin(),draft:portable(d)},null,2);
  if(new Blob([data]).size>524288){render('This draft file is too large. Keep the source notes separately or shorten them before downloading.');return;}
  const url=URL.createObjectURL(new Blob([data],{type:'application/json'})),a=el('a');a.href=url;a.download='LicenseLane-draft-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);render('Draft file downloaded. It contains your fields and source notes. Open it on this LicenseLane installation in another browser.');
 });
 openFile.addEventListener('click',()=>fileInput.click());
 cancelImport.addEventListener('click',()=>{candidate=null;importDialog.close();openFile.focus();});
 importDialog.addEventListener('cancel',()=>{candidate=null;});
 fileInput.addEventListener('change',async()=>{
  const file=fileInput.files[0];fileInput.value='';if(!file)return;
  try{
   if(file.size>524288)throw Error('Choose a draft file smaller than 512 KB.');
   const data=JSON.parse(await file.text());
   if(data?.format!=='licenselane-unfinished-draft'||data.version!==1)throw Error('Choose a LicenseLane unfinished draft file. Saved records use the Records import.');
   if(!buyerFileOrigins().includes(data.server))throw Error('This draft belongs to another LicenseLane installation. Open the original installation to continue it.');
   if(!valid(data.draft))throw Error('This unfinished draft could not be read. Your current fields and saved draft are unchanged.');
   candidate=portable(data.draft);importExpected=localStorage.getItem(key);const retained=parsed(importExpected);
   importSummary.textContent=(candidate.request.project||'Untitled project')+' — '+(candidate.request.licensee||'Buyer not entered')+' · '+(candidate.request.medium||'Usage not chosen')+' · '+(candidate.request.copies||'0')+' copies';
   const artwork=state.catalog.works.find(work=>work.id===candidate.request.assetId);
   importScope.textContent=(artwork?.title||candidate.request.assetId)+' · '+(candidate.request.termMonths||'Unspecified')+' months · '+(candidate.request.territory||'Territory not chosen')+(candidate.request.startsOn?' · Starts '+candidate.request.startsOn:'');
   importNotice.textContent=(retained?'This replaces your saved draft “'+(retained.request.project||'Untitled project')+'”. ':'')+'Your current fields stay unchanged. Choose Restore saved draft afterward to continue these fields and source notes.';
   importStatus.textContent='';importDialog.showModal();
  }catch(error){candidate=null;render(error instanceof SyntaxError?'This draft file is not readable JSON. Your current fields and saved draft are unchanged.':error.message);}
 });
 keepImport.addEventListener('click',async()=>{
  if(!candidate)return;keepImport.disabled=true;
  try{await locked(()=>{
   const raw=localStorage.getItem(key);if(raw!==importExpected){importStatus.textContent='The saved draft changed while this file was open. Cancel and open the file again to choose which draft to keep.';return;}
   const next=JSON.stringify(candidate);localStorage.setItem(key,next);saved=candidate;settled(next);candidate=null;importDialog.close();render('Draft imported. Choose Restore saved draft to continue it; your current fields are unchanged.');restore.focus();box.scrollIntoView({block:'center',behavior:'smooth'});
  });}catch{importStatus.textContent='Browser storage is unavailable. The imported draft was not saved.';}finally{keepImport.disabled=false;}
 });

 save.addEventListener('click',()=>saveFields());
 replaceSaved.addEventListener('click',()=>saveFields(true));
 restoreLatest.addEventListener('click',()=>restore.click());
 async function restoreSavedDraft(continuation=null){
  let raw;
  try{raw=localStorage.getItem(key);saved=parsed(raw);}catch{render('Browser storage is unavailable. Your current fields are unchanged.');return;}
  if(!saved){if(raw!==seenRaw)changed(raw,true);return;}
  if(continuation&&continuation.raw!==raw){changed(raw,true);return;}
  if(unsaved()&&!window.confirm('Restore saved draft “'+(saved.request.project||'Untitled project')+'”? Your current unsaved fields and source notes will be replaced. Cancel to keep editing.'))return;
  const sourceDraft=saved,currentRead=beginRecordRead();let draft=sourceDraft;
  if(continuation?.mode==='independent')draft={...draft,revisionId:null,replacement:false,savedAt:new Date().toISOString()};
  let original=null,linkedWork=null;
  // A direct-link or paused offer can be absent from the default catalog.
  // Keep a structurally valid draft and reopen that exact work before applying it.
  if(!state.catalog.works.some(work=>work.id===draft.request.assetId)){
   restore.disabled=true;
   try{
    const data=await boundedRead('/api/catalog/'+encodeURIComponent(draft.request.assetId),undefined,'The saved artwork is taking too long to reopen.');
    if(data.work?.id!==draft.request.assetId)throw Error('Saved artwork mismatch');
    linkedWork=data.work;
   }catch(error){
    if(!currentRead()||saved!==sourceDraft)return;
    if(error.status!==404){render('The saved artwork could not be reopened. Retry restoring this draft; your current fields are unchanged.');return;}
   }finally{restore.disabled=false;}
  }
  if(draft.revisionId&&draft.replacement&&!state.buyerAccess.has(draft.revisionId)){
   if(!currentRead()||saved!==sourceDraft)return;
   accessDraft=independentDraft=draft;independentRaw=raw;access.hidden=independent.hidden=false;retryOriginal.hidden=true;
   render('To replace the original proposal, restore its private buyer-access file. Or use these saved edits as a new request with a separate creator decision.');
   access.focus({preventScroll:true});access.scrollIntoView({block:'center',behavior:'smooth'});return;
  }
  if(draft.revisionId){
   restore.disabled=true;
   try{
    const data=await readSavedLicense(draft.revisionId);
    if(!currentRead()||saved!==sourceDraft)return;
    const license=data.license;
    if(license?.id!==draft.revisionId)throw Error('Original decision unavailable');
    if(continuation){
     if(license.status!==continuation.status){offerChangedDecision(sourceDraft,raw,license);return;}
     if(continuation.mode==='feedback'&&license.status==='changes_requested'){draft={...draft,replacement:false,savedAt:new Date().toISOString()};original=license;}
     else if(continuation.mode==='new'){draft={...draft,revisionId:null,replacement:false,savedAt:new Date().toISOString()};}
     else throw Error('Original decision unavailable');
    }else if(license.status!==(draft.replacement?'requested':'changes_requested')){
     offerChangedDecision(sourceDraft,raw,license);return;
    }else original=license;
   }catch{if(!currentRead()||saved!==sourceDraft)return;independentDraft=sourceDraft;independentRaw=raw;independent.hidden=retryOriginal.hidden=false;render('The original proposal could not be reopened. Retry restoring this correction, or use its saved edits as a new request with a separate creator decision. Your current fields are unchanged.');retryOriginal.focus({preventScroll:true});accessActions.scrollIntoView({block:'center',behavior:'smooth'});return;}
   finally{restore.disabled=false;}
  }
  if(!currentRead()||saved!==sourceDraft)return;
  try{const latest=localStorage.getItem(key);if(latest!==raw){changed(latest,true);return;}}catch{render('Browser storage is unavailable. Your current fields are unchanged.');return;}
  if(continuation){
   let committed=false;
   try{await locked(()=>{
    if(!currentRead()||saved!==sourceDraft)return;
    const latest=localStorage.getItem(key);if(latest!==raw){changed(latest,true);return;}
    const next=JSON.stringify(draft);localStorage.setItem(key,next);saved=draft;settled(next);committed=true;
   });}catch{render('Browser storage is unavailable. Your saved correction and current fields are unchanged.');return;}
   if(!committed||!currentRead()||saved!==draft)return;
   state.license=null;state.certificate=null;state.restored=false;state.creatorReviewRecordId=null;
   $('checkout-section').hidden=true;document.body.classList.remove('paid-record-view');
  }else settled(raw);
  clearProposalRevision();
  if(linkedWork&&!state.catalog.works.some(work=>work.id===linkedWork.id))state.catalog.works.push(linkedWork);
  state.selected=draft.request.assetId;drawWorks();
  const needsMedium=draft.request.medium==='';
  if(needsMedium){
   const medium=$('medium');
   if(!medium.querySelector('option[value=""]')){const option=el('option','','Choose a usage');option.value='';option.disabled=true;medium.prepend(option);}
   medium.required=true;
  }
  for(const k of ['licensee','project','medium','copies'])$(k).value=draft.request[k];
  for(const k of ['attribution','exclusive','training'])$(k).checked=draft.request[k];
  $('project-brief').value=draft.brief;
  restoreRequestedScope(draft.request,null,draft.scopeReviewed,draft.scopeExplicit);
  $('project-brief').dispatchEvent(new Event('input',{bubbles:true}));
  state.review=null;$('result-section').hidden=true;$('approval').hidden=true;
  $('draft-change').textContent=needsMedium?'Draft restored. Choose a usage.':'Draft restored. Review price & terms to continue.';$('draft-change').hidden=false;
  if(original)setProposalRevisionContext(original);
  if(!state.catalog.works.some(work=>work.id===draft.request.assetId))showUnavailableOffer('The saved artwork is no longer available. Your draft fields were restored.');
  else if(selectedOfferPaused())showPausedOffer();
  form.dispatchEvent(new Event('input',{bubbles:true}));
  window.restoreDraftConfirmedFields?.(draft.confirmedFields);
  window.restoreDraftRemainingUse?.(draft.remainingUse);
  history.replaceState(history.state,'','#scope-section');
  if(continuation)window.dispatchEvent(new Event('licenselane:viewchange'));
  render(needsMedium?'Draft restored. Choose a usage.':'Draft restored.');
  if(needsMedium){const next=$('medium');next.focus({preventScroll:true});next.closest('label').scrollIntoView({block:'center',behavior:'smooth'});}
  else{
   const next=Array.from(form.elements).find(field=>field.willValidate&&!field.validity.valid)||$('licensee');
   next.focus({preventScroll:true});(next.closest('label')||next).scrollIntoView({block:'center',behavior:'smooth'});
  }

 }
 restore.addEventListener('click',()=>restoreSavedDraft());
 discard.addEventListener('click',async()=>{
  beginRecordRead();
  const expected=seenRaw;discard.disabled=true;
  try{await locked(()=>{
   const raw=localStorage.getItem(key);if(raw!==expected){changed(raw,true);return;}
   localStorage.removeItem(key);saved=null;settled(null);render('Saved draft discarded from this browser. Fields currently on screen and saved license records are unchanged.');
  });}catch{render('The stored draft could not be removed. Browser storage is unavailable.');}
  finally{discard.disabled=false;}
 });
}
