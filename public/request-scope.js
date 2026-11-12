'use strict';
let requestedScopeReviewed=false,requestedScopeExplicit=false,requestedScopeSource='',earlyRequestedScope=null,earlyPartialRequestedScope=null;
function readRequestedScope(){
 let territory=$('requested-territory').value.trim();try{territory=licenseScope.territory(territory);}catch{}
 return {termMonths:Number($('term-months').value),territory,startsOn:$('use-start-date').value};
}
function currentOfferedScope(){return licenseScope.offer(state.catalog?.works.find(work=>work.id===state.selected)||{});}
function earlyRequestedScopeChoice(){
 if(!earlyRequestedScope||earlyRequestedScope.brief!==$('project-brief').value.trim()||requestedScopeExplicit||requestedScopeReviewed||$('term-months').value!==''||$('requested-territory').value.trim()!=='')return null;
 const values={...earlyRequestedScope.values};
 if($('use-start-date').value!==''||window.wasBriefFieldEdited?.('startsOn'))delete values.startsOn;
 return {...earlyRequestedScope,values};
}
function earlyPartialScopeChoice(){
 const offered=earlyPartialRequestedScope||(!earlyRequestedScopeChoice()?earlyRequestedScope:null);
 if(!offered||offered.brief!==$('project-brief').value.trim())return null;
 const targets={termMonths:'term-months',territory:'requested-territory',startsOn:'use-start-date'},values={};
 for(const [key,value]of Object.entries(offered.values)){
  if($(targets[key]).value.trim()===''&&!window.wasBriefFieldEdited?.(key))values[key]=value;
 }
 return Object.keys(values).length?{brief:offered.brief,values}:null;
}
window.offerEarlyRequestedScope=function(brief,fields){
 if(typeof brief!=='string'||brief!==$('project-brief').value.trim())return false;
 earlyRequestedScope=null;earlyPartialRequestedScope=null;
 const values={};
 for(const key of ['termMonths','territory','startsOn']){
  const item=fields?.[key];
  if(!item||!Number.isInteger(item.start)||!Number.isInteger(item.end)||item.start<0||item.end<=item.start||item.end>brief.length||brief.slice(item.start,item.end)!==item.evidence)continue;
  try{
   if(key==='termMonths'){if(!Number.isInteger(item.value))continue;values.termMonths=licenseScope.requested({termMonths:item.value,territory:'Worldwide'}).termMonths;}
   if(key==='territory'){if(typeof item.value!=='string')continue;values.territory=licenseScope.territory(item.value);}
   if(key==='startsOn')values.startsOn=licenseScope.date(item.value);
  }catch{}
 }
 if(values.termMonths&&values.territory)earlyRequestedScope={brief,values};
 else if(Object.keys(values).length)earlyPartialRequestedScope={brief,values};
 refreshScopeConfirmation();
 return !!earlyRequestedScopeChoice()||!!earlyPartialScopeChoice();
};
function canReviewConfirmedScope(values=readRequestedScope(),usingEarly=false){
 const form=$('request-form'),review=form.querySelector('button[type="submit"]');
 if(review.disabled||form.querySelector('[data-brief-unresolved="true"]'))return false;
 if($('project-brief').value.trim()&&(typeof window.nextUnconfirmedBriefUseField!=='function'||window.nextUnconfirmedBriefUseField()))return false;
 try{licenseScope.requested(values);if(!usingEarly&&$('term-months').value==='')return false;}catch{return false;}
 // The explicit confirmation clears only the duration field's scope-decision
 // validity message. Every other required field must already be valid.
 let sourceDateReady=false;
 if(usingEarly&&values.startsOn){try{sourceDateReady=licenseScope.periodState(licenseScope.period(values.startsOn,values.termMonths))!=='ended';}catch{}}
 return Array.from(form.elements).every(field=>field===$('term-months')||usingEarly&&field===$('requested-territory')||sourceDateReady&&field===$('use-start-date')||!field.willValidate||field.validity.valid);
}
function refreshRequestedPrice(){
 const box=$('request-price'),work=state.catalog?.works.find(item=>item.id===state.selected),copies=$('copies'),medium=$('medium').value;
 // A digital-only zero-copy request has no print decision to make. Keep
 // nonzero/empty counts visible even with digital use so contradictions can
 // be corrected, rather than silently erasing the buyer's explicit count.
 $('copies-field').hidden=['website','social'].includes(medium) && copies.value!=='' && Number(copies.value)===0 && copies.dataset.briefUnresolved!=='true';
 if(!box)return;
 box.hidden=!work||work.offerStatus==='paused'||copies.value===''||!copies.validity.valid;
 if(box.hidden)return;
 const count=Number(copies.value),outside=!work.permitted.includes(medium)||count>work.maxCopies||count>0&&medium!=='print';
 $('request-price-label').textContent=outside?'Requested use':'Estimated price';
 $('request-price-total').textContent=outside?'Custom permission':money(licensePrice.calculate(work,{medium,copies:count}).totalCents);
 if(outside){$('request-price-detail').textContent=count>0&&medium!=='print'?'Choose print for physical copies.':'This use is outside the listed offer.';return;}
 const amount=licensePrice.calculate(work,{medium,copies:count});
 $('request-price-detail').textContent=amount.printCents?money(amount.baseCents)+' base + '+money(amount.printCents)+' for '+count.toLocaleString()+' print '+(count===1?'copy':'copies'):money(amount.baseCents)+' base price';
}
function refreshScopeConfirmation(){
 refreshRequestedPrice();
 const date=$('use-start-date'),description=$('requested-period');let ended=false;
 date.setCustomValidity('');
 try{
  const period=licenseScope.period(date.value,Number($('term-months').value));ended=licenseScope.periodState(period)==='ended';
  description.textContent=(ended?'This period has ended: ':'Requested period: ')+licenseScope.periodLabel(period)+(ended?'. Choose new dates.':'');
  if(ended)date.setCustomValidity('This use period has ended. Choose a new start date or duration.');
 }catch{description.textContent='Choose a start date and duration to see the complete period.';}
 description.classList.toggle('scope-period-ended',ended);
 const needs=!!$('project-brief').value.trim()&&!requestedScopeReviewed;
 $('term-months').setCustomValidity(needs?'Choose or confirm the requested duration and territory.':'');
 $('scope-confirmation').hidden=!needs;
 const early=earlyRequestedScopeChoice(),values=early?.values||readRequestedScope();let valid=false;try{licenseScope.requested(values);valid=!!early||$('term-months').value!=='';}catch{}
 $('confirm-requested-scope').disabled=!valid;
 const reviewReady=needs&&valid&&canReviewConfirmedScope(values,!!early);
 $('request-form').querySelector('button[type="submit"]').hidden=reviewReady;
 $('confirm-requested-scope').classList.toggle('primary',reviewReady);
 $('confirm-requested-scope').classList.toggle('secondary',!reviewReady);
 $('confirm-requested-scope').dataset.reviewReady=String(reviewReady);
 const startLabel=early?.values.startsOn?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(values.startsOn+'T00:00:00Z'))+' · ':'';
 $('confirm-requested-scope').textContent=valid?'Use '+startLabel+licenseScope.label(values.termMonths)+' · '+values.territory+(reviewReady?' & review price':''):'Confirm requested scope';
 const immediate=$('use-brief-scope');
 const partial=earlyPartialScopeChoice();
 if(immediate){
  immediate.hidden=(!early||!needs)&&!partial;
  const labels=partial?Object.entries(partial.values).map(([key,value])=>key==='termMonths'?licenseScope.label(value):key==='startsOn'?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')):value):[];
  immediate.textContent=partial?'Use '+labels.join(' · ')+' & finish scope':$('confirm-requested-scope').textContent;
 }
 $('stop-brief')?.classList.toggle('brief-secondary',!!early&&needs||!!partial);
 window.dispatchEvent(new Event('requested-scope-choice'));
}
function confirmRequestedScope(){
 requestedScopeReviewed=true;requestedScopeExplicit=true;requestedScopeSource=$('project-brief').value.trim();refreshScopeConfirmation();$('request-form').dispatchEvent(new Event('input',{bubbles:true}));
}
function invalidateSuggestedRequestedScope(){
 requestedScopeReviewed=false;requestedScopeExplicit=true;
 requestedScopeSource=$('project-brief').value.trim();
 refreshScopeConfirmation();
}
function syncRequestedScopeOffer(){
 const offer=currentOfferedScope();$('offered-scope').textContent='Creator offers up to '+licenseScope.label(offer.maxTermMonths)+' · '+offer.territory;
 $('use-offered-scope').textContent='Use offered '+licenseScope.label(offer.maxTermMonths)+' · '+offer.territory;
 if(!requestedScopeExplicit&&!requestedScopeReviewed&&!$('project-brief').value.trim()){$('term-months').value=offer.maxTermMonths;$('requested-territory').value=offer.territory;}
 refreshScopeConfirmation();
}
function restoreRequestedScope(request,quote,reviewed,explicit){
 $('use-start-date').value=request.startsOn??'';
 $('term-months').value=request.termMonths??(quote?parseInt(quote.term,10):12);
 $('requested-territory').value=request.territory??quote?.territory??'Worldwide';
 requestedScopeReviewed=reviewed??(!!quote||licenseScope.specified(request)||!$('project-brief').value.trim());
 requestedScopeExplicit=explicit??(!!quote||licenseScope.specified(request));
 requestedScopeSource=$('project-brief').value.trim();refreshScopeConfirmation();
}
function initializeRequestedScope(){
 $('start-use-today').addEventListener('click',()=>{$('use-start-date').value=licenseScope.today();$('use-start-date').dispatchEvent(new Event('input',{bubbles:true}));});
 $('use-start-date').addEventListener('input',()=>{$('request-form').dispatchEvent(new Event('input',{bubbles:true}));});
 const immediate=document.createElement('button');immediate.id='use-brief-scope';immediate.type='button';immediate.className='brief-action';immediate.hidden=true;
 $('brief-status').before(immediate);
 immediate.addEventListener('click',()=>{
  const partial=earlyPartialScopeChoice();
  if(partial){
   const targets={termMonths:'term-months',territory:'requested-territory',startsOn:'use-start-date'};
   // This explicit choice applies only supported empty fields. It cannot
   // confirm an absent duration/territory or submit a default request.
   for(const [key,value]of Object.entries(partial.values))$(targets[key]).value=String(value);
   earlyPartialRequestedScope=null;
   for(const key of Object.keys(partial.values))$(targets[key]).dispatchEvent(new Event('input',{bubbles:true}));
   requestedScopeReviewed=false;requestedScopeExplicit=true;requestedScopeSource=$('project-brief').value.trim();refreshScopeConfirmation();
   const next=['term-months','requested-territory','use-start-date','licensee','project'].map($).find(field=>{
    // Duration's confirmation message is separate from its entered value.
    // Keep invalid or deliberately cleared input for the buyer to correct.
    try{
     if(field.id==='term-months'){licenseScope.requested({termMonths:Number(field.value),territory:'Worldwide'});return false;}
     if(field.id==='requested-territory'){licenseScope.territory(field.value);return false;}
    }catch{return true;}
    return !field.validity.valid;
   })||window.nextUnconfirmedBriefUseField?.()||$('confirm-requested-scope');
   if(next){next.focus({preventScroll:true});next.scrollIntoView({block:'center',behavior:'instant'});}
   return;
  }
  if(!earlyRequestedScopeChoice())return;
  $('confirm-requested-scope').click();
 });
 requestedScopeSource=$('project-brief').value.trim();
 for(const field of [$('term-months'),$('requested-territory')])field.addEventListener('input',()=>{requestedScopeReviewed=true;requestedScopeExplicit=true;requestedScopeSource=$('project-brief').value.trim();refreshScopeConfirmation();$('request-form').dispatchEvent(new Event('input',{bubbles:true}));});
 $('use-offered-scope').addEventListener('click',()=>{const offered=currentOfferedScope();$('term-months').value=offered.maxTermMonths;$('requested-territory').value=offered.territory;confirmRequestedScope();});
 $('confirm-requested-scope').addEventListener('click',()=>{
  const reviewPromised=$('confirm-requested-scope').dataset.reviewReady==='true';
  const early=earlyRequestedScopeChoice(),values=early?.values||readRequestedScope();
  const reviewReady=reviewPromised&&canReviewConfirmedScope(values,!!early);
  if(early){
   $('term-months').value=String(values.termMonths);$('requested-territory').value=values.territory;
   if(values.startsOn){$('use-start-date').value=values.startsOn;$('use-start-date').dispatchEvent(new Event('input',{bubbles:true}));}
  }
  confirmRequestedScope();
  const form=$('request-form'),review=form.querySelector('button[type="submit"]');
  if(reviewReady&&!review.disabled&&form.checkValidity())form.requestSubmit(review);
  else{
   const next=Array.from(form.elements).find(field=>field.willValidate&&!field.validity.valid)||window.nextUnconfirmedBriefUseField?.();
   if(next){next.focus({preventScroll:true});next.scrollIntoView({block:'center',behavior:'instant'});}
  }
 });
 $('request-form').addEventListener('input',refreshScopeConfirmation);
 $('request-form').addEventListener('change',refreshScopeConfirmation);
 $('project-brief').addEventListener('input',()=>{
  const source=$('project-brief').value.trim();if(source===requestedScopeSource)return;earlyRequestedScope=null;earlyPartialRequestedScope=null;
  if(!requestedScopeExplicit&&source){$('term-months').value='';$('requested-territory').value='';}
  requestedScopeSource=source;requestedScopeReviewed=false;syncRequestedScopeOffer();
  $('request-form').dispatchEvent(new Event('input',{bubbles:true}));
 });
}
