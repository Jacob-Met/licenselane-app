'use strict';
// Suggestions change only selected fields; complete requests use the normal price review.
(() => {
  const byId = id => document.getElementById(id);
  const panel = byId('brief-intake');
  if (!panel) return;
  const input = byId('project-brief');
  const button = byId('draft-brief');
  const status = byId('brief-status');
  const output = byId('brief-output');
  const apply = byId('apply-brief');
  const form = byId('request-form');
  const lengthHint = byId('brief-length');
  let configured=false;
  const fields = {
    medium: {label:'Where it appears', target:'medium', format:value=>({website:'Website / digital product',social:'Social campaign',print:'Printed publication',merchandise:'Merchandise'})[value], valid:value=>['website','social','print','merchandise'].includes(value)},
    copies: {label:'Physical copies', target:'copies', format:value=>value.toLocaleString(), valid:value=>Number.isSafeInteger(value)&&value>=0&&value<=1000000},
    training: {label:'Model training / data', target:'training', format:value=>value?'Training requested':'No training requested', valid:value=>typeof value==='boolean'},
    exclusive: {label:'Exclusive rights', target:'exclusive', format:value=>value?'Exclusive request':'Nonexclusive request', valid:value=>typeof value==='boolean'},
    attribution: {label:'Creator attribution', target:'attribution', format:value=>value?'Included':'Not included', valid:value=>typeof value==='boolean'},
    termMonths: {label:'Requested duration', target:'term-months', format:value=>licenseScope.label(value), valid:value=>Number.isInteger(value)&&value>=1&&value<=120},
    territory: {label:'Requested territory', target:'requested-territory', format:value=>value, valid:value=>typeof value==='string'&&value.length>=2&&value.length<=100&&(()=>{try{return licenseScope.territory(value)===value;}catch{return false;}})()}
  };
  fields.startsOn={label:'Project start date',target:'use-start-date',format:value=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')),valid:value=>{try{return licenseScope.date(value)===value;}catch{return false;}}};
  let activeRun=0, choices=[], unknownKeys=[], source='', mixedUse=null, pending=null, completionReady=false;
  let matchGroup,matchList,changeList,manualPanel;
  const evidenceGroups=new Map();
  const manuallyReviewed=new Set();
  window.wasBriefFieldEdited=key=>manuallyReviewed.has(key);
  const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const stop=node('button','brief-action','Stop waiting');
  stop.id='stop-brief';stop.type='button';stop.hidden=true;
  button.after(stop);
  // Keep the latest source-validated response in this tab; restoration never applies fields.
  const retainedKey='licenselane-brief-response-v1';
  let retained=null;
  try{const value=sessionStorage.getItem(retainedKey);if(value&&value.length<=32768){const saved=JSON.parse(value);if(typeof saved.brief==='string'&&saved.brief.length<=4000&&saved.data?.fields)retained=saved;}}catch{}
  const restore=node('button','brief-action brief-restore','Review previous suggestions');restore.type='button';restore.id='restore-brief';restore.hidden=true;button.before(restore);
  function updateRestore(){
    restore.hidden=!!pending||!retained||input.value.trim()!==retained.brief||(!completionReady&&(choices.length>0||unknownKeys.length>0));
    restore.textContent=completionReady?'Review remaining suggestions':'Review previous suggestions';
    button.classList.toggle('brief-secondary',!restore.hidden||choices.length>0||unknownKeys.length>0||byId('use-brief-scope')?.hidden===false);
  }
  window.addEventListener('requested-scope-choice',updateRestore);
  function persistResponse(){try{const value=JSON.stringify(retained);if(value.length<=32768)sessionStorage.setItem(retainedKey,value);}catch{}}
  function rememberResponse(data,brief){retained={data,brief};persistResponse();}
  function retainedContinuation(){
    const saved=retained?.continuation,r=saved?.resolution,q=saved?.request;
    if(!q||typeof q.brief!=='string'||q.brief.trim()!==retained.brief||!['print','digital'].includes(r?.choice))return null;
    if(!['website','social'].includes(r.medium?.value)||!fields.copies.valid(r.copies?.value)||r.copies.value<=0)return null;
    for(const key of ['medium','copies'])if(r[key].value!==retained.data.fields[key]?.value||r[key].evidence!==retained.data.fields[key]?.evidence)return null;
    return saved;
  }
  function forgetContinuation(){if(retained?.continuation){delete retained.continuation;persistResponse();}}
  restore.addEventListener('click',()=>{
    if(!retained||input.value.trim()!==retained.brief||pending)return;
    const selectedBefore=new Map(choices.filter(choice=>choice.checkbox.checked).map(choice=>[choice.key,JSON.stringify(choice.proposal)]));
    completionReady=false;showSuggestions(retained.data,retained.brief);
    for(const choice of choices)if(!choice.matches&&selectedBefore.get(choice.key)===JSON.stringify(choice.proposal))choice.checkbox.checked=true;
    updateApply();updateRestore();
  });
  for(const event of ['pointerdown','keydown','focusin','click','input','change'])output.addEventListener(event,()=>{if(pending?.hasPartial)pending.interacted=true;});
  function updateLength(){
    const length=input.value.length,modelLength=input.value.trim().length,tooLong=modelLength>4000,tooLongToShare=modelLength>0&&length>16000;
    lengthHint.textContent=length.toLocaleString()+(tooLongToShare?' characters — shorten to 16,000 to share.':tooLong?' characters — can be shared in full; suggestions need 4,000 or fewer.':' / 4,000 characters for suggestions');
    if(tooLongToShare)input.setAttribute('aria-invalid','true');else input.removeAttribute('aria-invalid');
    button.disabled=!configured||!!pending||tooLong;updateRestore();
  }
  // Results may arrive above the field the buyer is actively editing.
  // Preserve that visible field's position without taking focus or changing it.
  function preserveEditingPosition(render){
    const active=document.activeElement;
    const rect=active?.getBoundingClientRect();
    const keep=form.contains(active)&&active.matches('input,textarea,select')&&
      !output.contains(active)&&rect.top>=0&&rect.bottom<=innerHeight;
    const value=render();
    if(keep&&active.isConnected&&document.activeElement===active){
      const delta=active.getBoundingClientRect().top-rect.top;
      if(Math.abs(delta)>1)window.scrollBy({top:delta,left:0,behavior:'instant'});
    }
    return value;
  }
  function finishWaiting(){
    pending=null;button.disabled=false;button.textContent=choices.length||unknownKeys.length?'Suggest again':'Suggest scope fields';button.classList.toggle('brief-secondary',choices.length>0||unknownKeys.length>0);
    stop.hidden=true;panel.removeAttribute('aria-busy');updateLength();
  }
  function stopWaiting(message){
    if(!pending)return;
    const previous=pending;
    ++activeRun;clearTimeout(previous.timer);
    finishWaiting();previous.controller.abort();
    status.textContent=message;
  }
  stop.addEventListener('click',()=>{
    stopWaiting('Stopped waiting. Your entered fields are unchanged. Available suggestions can still be reviewed.');
    button.focus({preventScroll:true});
  });
  // Explicit policy review means the buyer is continuing with the entered scope.
  // Release an unused extraction through the same cancellation path as Stop waiting.
  const continueManually=()=>stopWaiting('Suggestions stopped. Using your entered scope.');
  form.addEventListener('submit',continueManually);
  byId('review-rules').addEventListener('click',()=>{if(form.checkValidity())continueManually();});
  // Leaving the buyer desk releases unused inference through the existing
  // cancellation path. Browsing Work and Your use keeps the same request alive.
  function stopForDestination(){
    if(document.body.classList.contains('paid-record-view')||['#vault','#creator-inbox'].includes(location.hash)){
      stopWaiting('Suggestions stopped while you opened another workspace. Your brief and entered scope are unchanged. Retry suggestions when you return.');
    }
  }
  window.addEventListener('hashchange',stopForDestination);
  window.addEventListener('licenselane:viewchange',stopForDestination);
  function clearManualHint(key){
    const target=byId(fields[key].target);
    delete target.dataset.briefUnresolved;
    byId('brief-manual-'+key)?.remove();
  }
  function markManual(key,preserveValue=false){
    if(manuallyReviewed.has(key))return;
    const field=fields[key],target=byId(field.target);
    target.dataset.briefUnresolved='true';
    if(!byId('brief-manual-'+key)){
      const hint=node('span','brief-manual-hint',key==='medium'?'Choose where this work will appear.':field.label+' was not inferred. Check it manually.');
      hint.id='brief-manual-'+key;
      const label=target.type==='checkbox'?target.nextElementSibling:target.closest('label');
      label.append(hint);
    }
    if(key==='medium'&&!preserveValue){
      if(!target.querySelector('option[value=""]')){
        const option=node('option','','Choose a usage');option.value='';option.disabled=true;target.prepend(option);
      }
      target.value='';target.required=true;
    }
    refreshRequestedPrice();
  }
  function remainingManualKeys(){
    return unknownKeys.filter(key=>!manuallyReviewed.has(key)&&!byId(fields[key].target).disabled&&
      !(['termMonths','territory'].includes(key)&&requestedScopeReviewed));
  }
  function targetIsBoolean(key){return byId(fields[key].target).type==='checkbox';}
  function updateManualChoices(){
    if(!manualPanel)return;
    const remaining=remainingManualKeys();
    manualPanel.replaceChildren();manualPanel.hidden=!remaining.length;
    if(!remaining.length)return;
    manualPanel.append(node('p','','Confirm the remaining choices:'));
    const links=node('div','brief-manual-links');
    for(const key of remaining){
      const link=node('button','brief-manual-link',fields[key].label);link.type='button';
      link.setAttribute('aria-label','Check '+fields[key].label.toLowerCase()+' in scope form');
      link.addEventListener('click',()=>{
        const target=byId(fields[key].target);if(target.disabled)return;
        markManual(key,true);target.scrollIntoView({block:'center'});target.focus({preventScroll:true});
      });
      if(targetIsBoolean(key)){
        const target=byId(fields[key].target),value=target.checked;
        const row=node('div','brief-manual-choice');
        const keep=node('button','brief-action brief-secondary brief-keep-choice','Keep: '+fields[key].format(value));
        keep.type='button';keep.id='brief-keep-'+key;
        keep.setAttribute('aria-label','Confirm '+fields[key].label.toLowerCase()+': '+fields[key].format(value));
        keep.addEventListener('click',()=>{
          if(target.disabled||target.checked!==value){updateManualChoices();return;}
          manuallyReviewed.add(key);clearManualHint(key);updateManualChoices();if(choices.length||unknownKeys.length)updateApply();
          const next=manualPanel.querySelector('.brief-keep-choice');
          if(next)next.focus({preventScroll:true});else if(!apply.hidden&&!apply.disabled)apply.focus({preventScroll:true});
        });
        row.append(link,keep);links.append(row);
      }else links.append(link);
    }
    manualPanel.append(links);
  }
  for(const [key,field] of Object.entries(fields)){
    const target=byId(field.target);
    for(const event of ['input','change'])target.addEventListener(event,()=>{
      if(pending?.hasPartial)pending.interacted=true;
      manuallyReviewed.add(key);clearManualHint(key);updateManualChoices();if(choices.length||unknownKeys.length)updateApply();
    });
  }
  function confirmedFieldValue(key){
    const target=byId(fields[key].target);
    return target.type==='checkbox'?target.checked:target.type==='number'?(target.value===''?null:Number(target.value)):target.value;
  }
  window.nextUnconfirmedBriefUseField=()=>{
    if(mixedUse&&!mixedUse.choice)return output.querySelector('input[name=brief-use-choice]');
    if(choices.some(choice=>choice.checkbox.checked&&confirmedFieldValue(choice.key)!==choice.proposal.value))return apply;
    for(const key of ['medium','copies','training','exclusive','attribution']){
      const value=confirmedFieldValue(key);
      if(manuallyReviewed.has(key)&&fields[key].valid(value))continue;
      if(key==='copies'&&value===0&&manuallyReviewed.has('medium')&&['website','social'].includes(confirmedFieldValue('medium')))continue;
      const choice=choices.find(item=>item.key===key);
      if(source===input.value.trim()&&choice&&!mixedUse&&choice.proposal.value===value)continue;
      const saved=retained?.brief===input.value.trim()?retained.data?.fields?.[key]:null;
      if(!mixedUse&&saved&&fields[key].valid(saved.value)&&saved.value===value&&typeof saved.evidence==='string'&&saved.evidence.trim()&&input.value.trim().includes(saved.evidence))continue;
      return key==='copies'&&byId('copies-field').hidden?byId('medium'):byId(fields[key].target);
    }
    return null;
  };
  window.captureDraftConfirmedFields=()=>{
    const confirmed={};
    for(const key of Object.keys(fields)){const value=confirmedFieldValue(key);if(manuallyReviewed.has(key)&&fields[key].valid(value))confirmed[key]=value;}
    return confirmed;
  };
  window.restoreDraftConfirmedFields=confirmed=>{
    manuallyReviewed.clear();
    if(confirmed&&typeof confirmed==='object'&&!Array.isArray(confirmed)){
      for(const key of Object.keys(fields)){
        if(Object.hasOwn(confirmed,key)&&fields[key].valid(confirmed[key])&&confirmedFieldValue(key)===confirmed[key]){
          manuallyReviewed.add(key);clearManualHint(key);
        }
      }
    }
    updateManualChoices();if(choices.length||unknownKeys.length)updateApply();
  };

  let appliedUndo=null;
  const undoApplied=node('button','brief-action brief-secondary','Undo applied suggestions');
  undoApplied.type='button';undoApplied.id='undo-brief-apply';undoApplied.hidden=true;status.after(undoApplied);
  function forgetAppliedUndo(){appliedUndo=null;undoApplied.hidden=true;}
  function captureAppliedFields(){
    return Object.fromEntries(Object.entries(fields).map(([key,field])=>{const target=byId(field.target);return [key,target.type==='checkbox'?target.checked:target.value];}));
  }
  undoApplied.addEventListener('click',()=>{
    const change=appliedUndo;
    if(!change||change.asset!==state.selected||change.brief!==input.value||
      JSON.stringify(captureAppliedFields())!==JSON.stringify(change.after)){forgetAppliedUndo();return;}
    forgetAppliedUndo();clearSuggestions();
    for(const [key,value] of Object.entries(change.before)){
      const target=byId(fields[key].target);
      if(target.type==='checkbox')target.checked=value;else target.value=value;
    }
    manuallyReviewed.clear();for(const key of change.reviewed)manuallyReviewed.add(key);
    requestedScopeReviewed=change.scope.reviewed;requestedScopeExplicit=change.scope.explicit;requestedScopeSource=change.scope.source;
    refreshScopeConfirmation();
    for(const key of Object.keys(fields))clearManualHint(key);
    for(const key of change.unresolved)markManual(key,true);
    byId('brief-remaining-use')?.remove();forgetContinuation();
    form.dispatchEvent(new Event('input',{bubbles:true}));
    status.textContent='Previous scope restored. Review the suggestions again or continue with your entered fields.';
    updateRestore();restore.focus({preventScroll:true});
  });
  form.addEventListener('input',forgetAppliedUndo);
  form.addEventListener('change',forgetAppliedUndo);

  const reviewButton=form.querySelector('button[type="submit"]');
  function readyForPriceReview(){
    return !reviewButton.disabled && (choices.length>0||unknownKeys.length>0) &&
      choices.every(choice=>choice.matches||choice.checkbox.checked) &&
      remainingManualKeys().length===0 && form.checkValidity();
  }
  for(const event of ['input','change'])form.addEventListener(event,e=>{
    if((choices.length||unknownKeys.length)&&(e.target===form||['licensee','project'].includes(e.target.id)))updateApply();
  });
  function selected(){return choices.filter(choice=>choice.checkbox.checked&&!choice.matches);}
  function updateApply(){
    refreshScopeConfirmation();
    if(!choices.length){
      if(!unknownKeys.length)return;
      const ready=readyForPriceReview();
      apply.hidden=!ready;apply.disabled=!ready;apply.textContent='Review price & terms';
      status.textContent=ready?'Your entered scope is ready to review.':'Complete the remaining scope choices below.';
      return;
    }
    for(const choice of choices){
      const target=byId(choice.field.target),coupled=mixedUse&&['medium','copies'].includes(choice.key);
      const current=target.type==='checkbox'?target.checked:['copies','termMonths'].includes(choice.key)&&target.value!==''?Number(target.value):target.value;
      choice.matches=!coupled&&current===choice.proposal.value;
      choice.matchLabel.hidden=!choice.matches;

      if(choice.matches){choice.checkbox.checked=false;choice.checkbox.disabled=true;}
      else choice.checkbox.disabled=!!(coupled&&mixedUse.choice);
    }
    placeEvidenceGroups();
    const count=selected().length,matched=choices.filter(choice=>choice.matches).length;
    if(matchGroup){matchGroup.hidden=matched===0;matchGroup.querySelector('summary').textContent=matched+' '+(matched===1?'suggestion already matches':'suggestions already match')+' your request';changeList.hidden=matched===choices.length;}
    status.textContent=matched===choices.length
      ? 'Your current fields match the suggestions.'+(remainingManualKeys().length?' Confirm the remaining choices below.':'')
      : choices.length+' suggestions — select changes to apply.'+(matched?' '+matched+' already '+(matched===1?'matches':'match')+' your request.':'');
    if(mixedUse&&!mixedUse.choice){apply.disabled=true;apply.textContent='Choose which use to review first';return;}
    const allMatch=matched===choices.length&&!mixedUse,reviewReady=readyForPriceReview();
    apply.hidden=allMatch&&!reviewReady;
    apply.disabled=count===0&&!(allMatch&&reviewReady);
    const scopeConfirmation=selected().some(choice=>['termMonths','territory'].includes(choice.key));
    if(count)apply.textContent=scopeConfirmation
      ? 'Apply '+count+' '+(count===1?'change':'changes')+' & confirm scope'
      : reviewReady?'Apply '+count+' '+(count===1?'change':'changes')+' & review price'
      : 'Apply '+count+' selected '+(count===1?'change':'changes');
    else apply.textContent=allMatch&&reviewReady?'Review price & terms':matched===choices.length?'Suggested fields already match':'Select changes to apply';
  }
  function placeEvidenceGroups(){
    const groups=new Map();
    for(const choice of choices){
      const {evidence,start,end}=choice.proposal;
      // Identical words at different positions are different evidence. Older
      // unpositioned responses also stay separate from positioned occurrences.
      const key=JSON.stringify([choice.matches,start??null,end??null,evidence]);
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push(choice);
    }
    for(const [key,members] of groups){
      let group=evidenceGroups.get(key);
      if(!group){
        const item=node('li','brief-source-group'),list=node('ul','brief-source-fields');
        const quote=node('blockquote','brief-evidence',members[0].proposal.evidence);
        const link=node('button','brief-source-link','Read in original brief');link.type='button';
        const select=node('button','brief-action brief-secondary brief-select-group');select.type='button';
        group={item,list,link,select,members};
        select.addEventListener('click',()=>{
          const available=group.members.filter(c=>!c.matches&&!c.checkbox.disabled);
          const checked=!available.every(c=>c.checkbox.checked);
          for(const c of available)c.checkbox.checked=checked;
          updateApply();
        });
        link.addEventListener('click',()=>inspectSource(group.members[0],source,link,group.members));
        item.append(select,list,quote,link);evidenceGroups.set(key,group);
      }
      group.members=members;
      const available=members.filter(c=>!c.matches&&!c.checkbox.disabled);
      const allSelected=available.length>0&&available.every(c=>c.checkbox.checked);
      group.select.hidden=available.length<2;
      group.select.textContent=allSelected?'Clear group selection':'Select all '+available.length+' changes';
      group.select.setAttribute('aria-pressed',String(allSelected));
      group.link.setAttribute('aria-label',members.length===1?'Read '+members[0].field.label.toLowerCase()+' in original brief':'Read shared source for '+members.map(c=>c.field.label.toLowerCase()).join(' and '));
      const destination=members[0].matches?matchList:changeList;
      if(group.item.parentNode!==destination)destination.append(group.item);
      for(const choice of members)if(choice.item.parentNode!==group.list)group.list.append(choice.item);
    }
    for(const [key,group] of evidenceGroups)if(!groups.has(key)){group.item.remove();evidenceGroups.delete(key);}
  }
  const sourceDialog=node('dialog','brief-source-dialog');
  sourceDialog.setAttribute('aria-labelledby','brief-source-title');
  const sourceTitle=node('h2','','Original brief');sourceTitle.id='brief-source-title';
  const sourceValue=node('p','brief-source-value');
  const sourceText=node('p','brief-source-text');
  sourceText.tabIndex=0;sourceText.setAttribute('role','region');sourceText.setAttribute('aria-label','Original brief text');
  const sourceClose=node('button','brief-action','Back to suggestions');sourceClose.type='button';
  sourceDialog.append(sourceTitle,sourceValue,sourceText,sourceClose);document.body.append(sourceDialog);
  sourceClose.addEventListener('click',()=>sourceDialog.close());
  let sourceTrigger=null;
  sourceDialog.addEventListener('close',()=>{if(sourceTrigger?.isConnected)sourceTrigger.focus({preventScroll:true});});
  function inspectSource(choice,brief,trigger,related=[choice]){
    sourceTrigger=trigger;
    sourceValue.textContent=related.map(item=>item.key==='medium'?item.field.format(item.proposal.value):item.key==='copies'?item.field.format(item.proposal.value)+' physical copies':item.field.label+': '+item.field.format(item.proposal.value)).join(' · ');
    sourceText.replaceChildren();
    const quote=choice.proposal.evidence;
    const {start,end}=choice.proposal;
    if(Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end<=brief.length&&end>start&&brief.slice(start,end)===quote){
      sourceText.append(document.createTextNode(brief.slice(0,start)),node('mark','',quote),document.createTextNode(brief.slice(end)));
    }else{
      // Older responses do not identify an occurrence. Preserve every match
      // rather than choosing source context that the response did not supply.
      let cursor=0,index;
      while((index=brief.indexOf(quote,cursor))!==-1){
        sourceText.append(document.createTextNode(brief.slice(cursor,index)),node('mark','',quote));
        cursor=index+quote.length;
      }
      sourceText.append(document.createTextNode(brief.slice(cursor)));
    }
    sourceDialog.showModal();
    sourceText.scrollTop=0;
    sourceText.querySelector('mark')?.scrollIntoView({block:'nearest'});
  }
  function clearSuggestions(){
    if(sourceDialog.open)sourceDialog.close();
    choices=[];unknownKeys=[];mixedUse=null;evidenceGroups.clear();matchGroup=matchList=changeList=manualPanel=null;output.replaceChildren();output.hidden=true;apply.hidden=true;apply.disabled=true;button.classList.remove('brief-secondary');button.textContent=pending?.hasPartial?'Checking remaining choices…':'Suggest scope fields';
  }
  function showSuggestions(data,brief){
    clearSuggestions();source=brief;
    if(data.earlySource===true)output.append(node('p','brief-source-only-note',
      'Ready from your words — confirm these choices now, or let the model check the rest.'));
    if(data.sourceOnly===true)output.append(node('p','brief-source-only-note',
      'The local model is unavailable. Only choices quoted from your brief are shown; confirm each one.'));
    const list=node('ul','brief-proposals');changeList=list;
    matchGroup=node('details','brief-matches');matchGroup.append(node('summary'));matchList=node('ul','brief-proposals');matchGroup.append(matchList);
    const unknown=[];
    for(const [key,field] of Object.entries(fields)){
      const proposal=data.fields?.[key];
      if(key==='startsOn'&&!proposal)continue;
      if(!proposal || !field.valid(proposal.value) || typeof proposal.evidence!=='string' || !proposal.evidence.trim() || !brief.includes(proposal.evidence)){
        unknown.push(field.label.toLowerCase());unknownKeys.push(key);continue;
      }
      const item=node('li','brief-proposal');
      const checkbox=node('input');checkbox.type='checkbox';checkbox.id='brief-confirm-'+key;
      checkbox.checked=false;checkbox.setAttribute('aria-label','Apply suggested '+field.label.toLowerCase());
      const label=node('label','brief-choice');label.htmlFor=checkbox.id;
      const matchLabel=node('span','brief-current','Already in your request');matchLabel.hidden=true;
      label.append(node('span','brief-field',field.label),node('strong','brief-value',field.format(proposal.value)),matchLabel);
      item.append(checkbox,label);
      choices.push({key,field,proposal,checkbox,matchLabel,item,matches:false});
      checkbox.addEventListener('change',updateApply);
    }
    manualPanel=node('section','brief-unknown');
    if(!choices.length){
      output.append(manualPanel);updateManualChoices();output.hidden=false;
      updateApply();
      return;
    }
    const medium=data.fields?.medium,copies=data.fields?.copies;
    if(['website','social'].includes(medium?.value)&&copies?.value>0&&choices.some(c=>c.key==='medium')&&choices.some(c=>c.key==='copies')){
      mixedUse={medium,copies,choice:null};
      const resolution=node('fieldset','scope-revision');
      resolution.append(node('legend','','Which use should this request cover?'),node('p','','These suggestions combine digital use and a print run. Each LicenseLane request covers one medium. Choose one to review first; the other will remain here for a separate request.'));
      for(const [value,label] of [['digital',fields.medium.format(medium.value)+' first — no physical copies in this request'],['print','Print first — '+copies.value.toLocaleString()+' physical copies']]){
        const row=node('label','brief-use-option'),radio=node('input');radio.type='radio';radio.name='brief-use-choice';radio.value=value;
        radio.addEventListener('change',()=>{mixedUse.choice=value;for(const c of choices)if(['medium','copies'].includes(c.key)){c.checkbox.checked=true;c.checkbox.disabled=true;}updateApply();});row.append(radio,node('span','',label));resolution.append(row);
      }
      output.append(resolution);
    }
    output.append(list,matchGroup);
    output.append(manualPanel);updateManualChoices();
    output.hidden=false;apply.hidden=false;updateApply();

  }
  let remainingUseRequest=null,remainingUseResolution=null;
  // An explicit draft keeps the buyer-confirmed other-use inputs, not model output.
  window.captureDraftRemainingUse=()=>{
    const r=remainingUseResolution;
    if(!r||!remainingUseRequest||!sameRequest(formRequest(),remainingUseRequest)||!byId('brief-remaining-use')?.querySelector('button'))return null;
    return r.choice==='print'?{medium:r.medium.value,copies:0}:{medium:'print',copies:r.copies.value};
  };
  window.restoreDraftRemainingUse=use=>{
    if(!use||!['website','social','print'].includes(use.medium)||!fields.copies.valid(use.copies))return;
    const request=formRequest(),print=use.medium==='print';
    if(print?(!['website','social'].includes(request.medium)||use.copies<=0):(request.medium!=='print'||use.copies!==0))return;
    const resolution={choice:print?'digital':'print',medium:{value:print?request.medium:use.medium,evidence:''},copies:{value:print?use.copies:request.copies,evidence:''}};
    showRemainingUse(resolution,request,false);
  };
  function placeRemainingUse(){
    let box=byId('brief-remaining-use');
    if(!box){
      const saved=retainedContinuation();
      if(saved&&((document.body.classList.contains('paid-record-view')&&state.license&&sameRequest(state.license.request,saved.request))||sameRequest(formRequest(),saved.request))){
        showRemainingUse(saved.resolution,saved.request);return;
      }
    }
    if(!box||!remainingUseRequest)return;
    const saved=document.body.classList.contains('paid-record-view')&&state.license&&sameRequest(state.license.request,remainingUseRequest);
    const reviewed=document.body.classList.contains('reviewing-proposal')&&state.review&&sameRequest(state.review.request,remainingUseRequest)&&!byId('result-section').hidden;
    const destination=saved?byId('checkout-section'):reviewed?byId('result-section'):panel;
    if(box.parentElement!==destination)destination.append(box);
    const guidance=box.querySelector('.remaining-use-guidance');
    if(guidance)guidance.textContent=saved?'This use is not included in the saved proposal.':'This use is not included in the current request. Save this proposal first if you want to keep it.';
  }
  const remainingUseObserver=new MutationObserver(placeRemainingUse);
  remainingUseObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
  for(const id of ['result-section','checkout-section'])remainingUseObserver.observe(byId(id),{attributes:true,attributeFilter:['hidden']});
  window.addEventListener('licenselane:viewchange',placeRemainingUse);
  function showRemainingUse(resolution,request=formRequest(),remember=true){
    byId('brief-remaining-use')?.remove();
    const box=node('section','scope-revision');box.id='brief-remaining-use';remainingUseRequest=request;remainingUseResolution=resolution;
    const originalBrief=request.brief?.trim()||'';
    if(remember&&retained?.brief===originalBrief){retained.continuation={resolution,request};persistResponse();}
    const next=resolution.choice==='print'?'digital':'print';
    const label=next==='print'?resolution.copies.value.toLocaleString()+' printed copies':fields.medium.format(resolution.medium.value);
    box.append(node('h4','','Still to review: '+label),node('p','remaining-use-guidance','This use is not included in the current request. Save this proposal first if you want to keep it.'));
    const evidence=next==='print'?resolution.copies.evidence:resolution.medium.evidence;if(evidence)box.append(node('blockquote','brief-evidence',evidence));
    const button=node('button','brief-action','Prepare '+label+' separately');button.type='button';
    button.addEventListener('click',async()=>{
      const fromSaved=document.body.classList.contains('paid-record-view')&&state.license&&sameRequest(state.license.request,request);
      if(!fromSaved&&input.value.trim()!==originalBrief){forgetContinuation();box.remove();status.textContent='Brief changed. Review its new wording before preparing another use.';return;}
      if(!window.confirm('Prepare the other use in the scope form? Any unsaved scope details will be replaced. Saved proposals and payments stay unchanged.'))return;
      if(fromSaved&&!sameRequest(formRequest(),request)){
        const currentRead=beginRecordRead();button.disabled=true;
        try{
          if(!state.catalog.works.some(work=>work.id===request.assetId)){
            const data=await boundedRead('/api/catalog/'+encodeURIComponent(request.assetId),undefined,'The original artwork is taking too long to reopen.');
            if(!currentRead())return;
            if(data.work?.id!==request.assetId)throw Error('Original artwork mismatch');
            if(!state.catalog.works.some(work=>work.id===data.work.id))state.catalog.works.push(data.work);
          }
          if(!currentRead())return;
          state.selected=request.assetId;drawWorks();
          for(const key of ['licensee','project','medium','copies'])byId(key).value=request[key];
          for(const key of ['attribution','exclusive','training'])byId(key).checked=request[key];
          input.value=request.brief||'';
          restoreRequestedScope(request,state.license?.quote);
        }catch{let feedback=box.querySelector('.remaining-use-feedback');if(!feedback){feedback=node('p','remaining-use-feedback');feedback.setAttribute('role','status');box.append(feedback);}feedback.textContent='The original artwork could not be reopened. Retry preparing this use; your current fields are unchanged.';return;}
        finally{button.disabled=false;}
      }
      // The buyer explicitly chose a separate use, not a correction of saved terms.
      forgetContinuation();
      clearProposalRevision();
      byId('medium').value=next==='print'?'print':resolution.medium.value;
      byId('copies').value=next==='print'?String(resolution.copies.value):'0';
      form.dispatchEvent(new Event('input',{bubbles:true}));
      box.replaceChildren(node('h4','','Separate '+label+' request prepared'),node('p','','Review and save this scope as a separate proposal.'));
      status.textContent='The other use is ready for its own review.';
      document.querySelector('.desk-nav a[href="#scope-section"]').click();panel.open=true;placeRemainingUse();
      byId('medium').focus({preventScroll:true});byId('medium').scrollIntoView({block:'center',behavior:'instant'});
    });
    box.append(button);panel.append(box);placeRemainingUse();
  }
  input.addEventListener('input',()=>{
    updateLength();
    for(const key of Object.keys(fields))clearManualHint(key);
    if(pending&&input.value.trim()!==pending.brief)stopWaiting('Brief changed. You can request suggestions for the new wording.');
    if(input.value.trim()!==retained?.brief){completionReady=false;forgetContinuation();}byId('brief-remaining-use')?.remove();
    if((choices.length||unknownKeys.length) && input.value.trim()!==source){
      clearSuggestions();
      status.textContent='Brief changed. Generate suggestions again for the new wording.';
    }
  });
  input.addEventListener('input',updateRestore);
  async function readBriefResponse(response,onPartial,onScope){
    if(!response.ok||!response.headers.get('content-type')?.includes('application/x-ndjson')){
      const data=await response.json();
      if(!response.ok)throw Error(data.error||'Brief suggestions are unavailable.');
      return data;
    }
    const reader=response.body.getReader(),decoder=new TextDecoder();
    let buffer='',total=0,scopeSeen=false,partialSeen=false,complete,ended=false;
    const record=line=>{
      if(!line.trim())return;
      if(complete!==undefined)throw Error('Brief response continued after completion.');
      const event=JSON.parse(line);
      if(event.type==='error')throw Error(event.data?.error||'The remaining suggestions could not be checked.');
      if(!event.data?.fields)throw Error('Brief response is incomplete.');
      if(event.type==='scope'&&!scopeSeen&&!partialSeen){scopeSeen=true;onScope?.(event.data);}
      else if(event.type==='partial'&&!partialSeen){partialSeen=true;onPartial(event.data);}
      else if(event.type==='complete')complete=event.data;
      else throw Error('Brief response order is invalid.');
    };
    try{
      while(true){
        const part=await reader.read();
        if(part.done){ended=true;buffer+=decoder.decode();break;}
        total+=part.value.byteLength;if(total>262144)throw Error('Brief response exceeds the allowed size.');
        buffer+=decoder.decode(part.value,{stream:true});
        let newline;while((newline=buffer.indexOf('\n'))!==-1){record(buffer.slice(0,newline));buffer=buffer.slice(newline+1);}
      }
      record(buffer);
      if(complete===undefined)throw Error('The remaining suggestions could not be checked.');
      return complete;
    }finally{
      if(!ended)try{await reader.cancel();}catch{}
      reader.releaseLock();
    }
  }
  button.addEventListener('click',async()=>{
    const brief=input.value.trim();
    if(brief.length<10 || brief.length>4000){
      status.textContent='Enter a brief between 10 and 4,000 characters.';input.focus();return;
    }
    if(window.confirmBriefArtwork&&!await window.confirmBriefArtwork())return;
    forgetAppliedUndo();
    const run=++activeRun;completionReady=false;
    for(const key of Object.keys(fields))clearManualHint(key);
    clearSuggestions();button.disabled=true;button.textContent='Reading your brief…';panel.setAttribute('aria-busy','true');
    status.textContent='Reading with your local model. You can keep filling out the scope form.';
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),310000);
    pending={brief,controller,timer};stop.hidden=false;updateRestore();
    try{
      const response=await fetch('/api/brief',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/x-ndjson'},body:JSON.stringify({brief}),signal:controller.signal});
      const data=await readBriefResponse(response,partial=>preserveEditingPosition(()=>{
        if(run!==activeRun||input.value.trim()!==brief)return;
        pending.hasPartial=true;pending.partialFields=partial.fields;pending.interacted=false;
        rememberResponse(partial,brief);showSuggestions(partial,brief);
        window.offerEarlyRequestedScope?.(brief,partial.fields);
        button.textContent='Checking remaining choices…';panel.removeAttribute('aria-busy');
      }),scope=>preserveEditingPosition(()=>{
        if(run!==activeRun||input.value.trim()!==brief)return;
        if(window.offerEarlyRequestedScope?.(brief,scope.fields))panel.removeAttribute('aria-busy');
      }));
      if(run!==activeRun)return;
      if(input.value.trim()!==brief){
        status.textContent='Brief changed while the model was reading. Generate again to use the new wording.';return;
      }
      preserveEditingPosition(()=>{
        rememberResponse(data,brief);
        if(pending.hasPartial&&pending.interacted){
          completionReady=Object.keys(fields).some(key=>!pending.partialFields[key]&&data.fields?.[key]);
          if(completionReady)status.textContent='Remaining suggestions are ready. Your selected choices and entered fields are unchanged.';
          else updateApply();
        }else showSuggestions(data,brief);
      });
    }catch(error){
      if(run===activeRun)status.textContent=pending?.hasPartial?'The remaining choices could not be checked. Use the available suggestions or complete the scope form.':(error.name==='AbortError'?'The model took too long.':error.message)+' Complete the scope form to continue. No fields were changed.';
    }finally{
      clearTimeout(timer);
      if(run===activeRun)preserveEditingPosition(finishWaiting);
    }
  });
  apply.addEventListener('click',()=>{
    if(pending?.hasPartial)pending.interacted=true;
    if(input.value.trim()!==source){clearSuggestions();status.textContent='Brief changed. Generate suggestions again.';return;}
    updateApply();
    const resolution=mixedUse;
    if(resolution&&!resolution.choice)return;
    const approved=selected(),reviewReady=readyForPriceReview();
    const suggestedScope=approved.some(choice=>['termMonths','territory'].includes(choice.key));
    if(!approved.length){
      if(reviewReady&&choices.every(choice=>choice.matches))form.requestSubmit(reviewButton);
      return;
    }
    const previousFields=captureAppliedFields();
    const previousReview=Array.from(manuallyReviewed);
    const previousUnresolved=Object.keys(fields).filter(key=>byId(fields[key].target).dataset.briefUnresolved==='true');
    const previousScope={reviewed:requestedScopeReviewed,explicit:requestedScopeExplicit,source:requestedScopeSource};
    const missing=remainingManualKeys();
    const unselected=choices.filter(choice=>!choice.checkbox.checked&&!choice.matches).map(choice=>choice.field.label.toLowerCase());
    for(const choice of approved){
      const target=byId(choice.field.target);
      let value=choice.proposal.value;
      if(resolution&&choice.key==='medium')value=resolution.choice==='print'?'print':resolution.medium.value;
      if(resolution&&choice.key==='copies')value=resolution.choice==='print'?resolution.copies.value:0;
      if(target.type==='checkbox')target.checked=value;
      else target.value=String(value);
      manuallyReviewed.add(choice.key);clearManualHint(choice.key);
    }
    for(const key of missing)markManual(key);
    // A model suggestion is never the buyer's confirmation of the exact rights.
    // Preserve every manually entered field and ask for an explicit scope decision.
    if(suggestedScope)invalidateSuggestedRequestedScope();
    form.dispatchEvent(new Event('input',{bubbles:true}));
    const count=approved.length;
    clearSuggestions();
    status.textContent=count+' selected '+(count===1?'field applied':'fields applied')+'. '+(missing.length?'Check '+missing.map(key=>fields[key].label.toLowerCase()).join(', ')+' manually. ':'')+(unselected.length?'Not applied: '+unselected.join(', ')+'. ':'')+(suggestedScope?'Confirm the exact duration and territory below before reviewing rights and price. ':reviewReady?'':'Review the full request below.');
    if(resolution)showRemainingUse(resolution);updateRestore();
    appliedUndo={before:previousFields,after:captureAppliedFields(),reviewed:previousReview,unresolved:previousUnresolved,scope:previousScope,asset:state.selected,brief:input.value};
    undoApplied.hidden=false;

    if(reviewReady&&!suggestedScope)form.requestSubmit(reviewButton);
    else{
      const incomplete=Array.from(form.elements).find(field=>field.willValidate&&!field.validity.valid);
      const target=suggestedScope?byId('confirm-requested-scope'):incomplete||byId(missing.length?fields[missing[0]].target:approved[0].field.target);
      if(incomplete&&!suggestedScope)status.textContent=count+' selected '+(count===1?'field applied':'fields applied')+'. Complete the highlighted required field to continue.';
      target.focus({preventScroll:true});(target.closest('label')||target).scrollIntoView({block:'center',behavior:'smooth'});
    }
  });
  updateLength();
  function applyConnection(config){
    configured=config.briefConfigured===true;updateLength();
    if(configured){status.textContent='Optional suggestions from your local model.';}
    else{button.disabled=true;status.textContent='Brief drafting is unavailable here. Complete the scope form to continue.';}
  }
  window.addEventListener('licenselane:connected',event=>applyConnection(event.detail));
  if(state.config)applyConnection(state.config);
})();
