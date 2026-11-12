'use strict';
(() => {
 const input=document.getElementById('project-brief'),form=document.getElementById('request-form');
 if(!input||!form)return;
 const box=document.createElement('div');box.className='brief-name-selection';box.hidden=true;
 const value=document.createElement('strong');value.className='brief-selected-name';
 const actions=document.createElement('div');actions.className='brief-name-actions';
 const message=document.createElement('p');message.className='brief-status';message.setAttribute('role','status');message.hidden=true;
 const hint=document.createElement('p');hint.id='brief-selection-help';hint.className='brief-status';hint.textContent='Select text in your brief to use it in the scope form.';
 input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),hint.id].filter(Boolean).join(' '));
 box.append(value,actions);input.after(hint,box,message);
 const nameButtons=[];
 const copyButton=document.createElement('button');copyButton.type='button';copyButton.className='brief-action brief-secondary';copyButton.id='brief-selection-copies';copyButton.textContent='Use as print copies';copyButton.hidden=true;
 const durationButton=document.createElement('button');durationButton.type='button';durationButton.className='brief-action brief-secondary';durationButton.id='brief-selection-duration';durationButton.textContent='Use as duration';durationButton.hidden=true;
 const territoryButton=document.createElement('button');territoryButton.type='button';territoryButton.className='brief-action brief-secondary';territoryButton.id='brief-selection-territory';territoryButton.textContent='Use as territory';territoryButton.hidden=true;
 const mediumButton=document.createElement('button');mediumButton.type='button';mediumButton.className='brief-action brief-secondary';mediumButton.id='brief-selection-medium';mediumButton.hidden=true;
 const printButton=document.createElement('button');printButton.type='button';printButton.className='brief-action brief-secondary';printButton.id='brief-selection-print';printButton.hidden=true;
 let selection=null,undo=null;
 const undoButton=document.createElement('button');undoButton.type='button';undoButton.id='brief-selection-undo';undoButton.className='brief-action brief-secondary';undoButton.textContent='Undo';undoButton.hidden=true;
 function fieldValue(field){return field.type==='checkbox'?field.checked:field.value;}
 function writeField(field,next){if(field.type==='checkbox')field.checked=next;else field.value=String(next);}
 function setField(field,next,label){
  const before=fieldValue(field),confirmed=field.type==='checkbox'?window.captureDraftConfirmedFields?.():null;
  writeField(field,next);field.dispatchEvent(new Event('input',{bubbles:true}));
  const confirmationChanged=confirmed&&!Object.hasOwn(confirmed,field.id);
  undo=before===fieldValue(field)&&!confirmationChanged?null:{field,before,after:fieldValue(field),label,confirmation:confirmed?{key:field.id,had:Object.hasOwn(confirmed,field.id)}:null};
  undoButton.hidden=!undo;
  undoButton.setAttribute('aria-label','Undo '+label.toLowerCase()+' change');
 }
 undoButton.addEventListener('click',()=>{
  const change=undo;undo=null;undoButton.hidden=true;
  if(change?.fields){
   if(change.fields.some(item=>item.field.disabled||fieldValue(item.field)!==item.after))return;
   for(const item of change.fields){writeField(item.field,item.before);item.field.dispatchEvent(new Event('input',{bubbles:true}));}
   if(window.restoreDraftConfirmedFields){const confirmed=window.captureDraftConfirmedFields();for(const item of change.fields){if(Object.hasOwn(change.confirmed,item.field.id))confirmed[item.field.id]=change.confirmed[item.field.id];else delete confirmed[item.field.id];}window.restoreDraftConfirmedFields(confirmed);}
   message.textContent='Usage and print copies restored.';message.hidden=false;input.focus({preventScroll:true});return;
  }
  if(!change||change.field.disabled||fieldValue(change.field)!==change.after)return;
  writeField(change.field,change.before);change.field.dispatchEvent(new Event('input',{bubbles:true}));
  if(change.confirmation&&window.restoreDraftConfirmedFields){const confirmed=window.captureDraftConfirmedFields();if(change.confirmation.had)confirmed[change.confirmation.key]=change.before;else delete confirmed[change.confirmation.key];window.restoreDraftConfirmedFields(confirmed);}
  message.textContent=change.label+(change.confirmation&&!change.confirmation.had?' confirmation undone.':' restored.');message.hidden=false;
  input.focus({preventScroll:true});
 });
 for(const type of ['input','change'])form.addEventListener(type,event=>{if(undo&&(event.target===undo.field||undo.fields?.some(item=>item.field===event.target))){undo=null;undoButton.hidden=true;}});


 const permissionChoices=[
  {key:'training',value:false,label:'Use no training',message:'No model training requested.',phrases:['no ai training','no model training','no training','do not use for ai training','do not use for model training']},
  {key:'training',value:true,label:'Request training',message:'Model training requested.',phrases:['request ai training','request model training','ai training requested','model training requested']},
  {key:'exclusive',value:false,label:'Use nonexclusive rights',message:'Nonexclusive rights selected.',phrases:['nonexclusive rights','non-exclusive rights','nonexclusive license','non-exclusive license','no exclusive rights']},
  {key:'exclusive',value:true,label:'Request exclusive rights',message:'Exclusive rights requested.',phrases:['request exclusive rights','exclusive rights requested']},
  {key:'attribution',value:true,label:'Include creator credit',message:'Creator credit included.',phrases:['creator credit is included','creator credit included','credit the creator','credit the artist','include creator credit','credit included']},
  {key:'attribution',value:false,label:'Omit creator credit',message:'Creator credit omitted.',phrases:['no creator credit','no credit','creator credit is not included','credit not included','omit creator credit']}
 ];
 function selectedPermission(text){
  const phrase=text.trim().toLowerCase().replace(/\s+/g,' ').replace(/\.$/,'');
  return permissionChoices.find(choice=>choice.phrases.includes(phrase))||null;
 }
 function permissionLanguage(text){
  return /\b(?:training|non[- ]?exclusive|exclusive (?:rights|use|license)|creator credit|credit (?:the|is|included|not|if)|attribution)\b|(?:^|\s)credit[.!?]?$/i.test(text);
 }
 const permissionButtons=new Map();
 for(const key of ['training','exclusive','attribution']){
  const button=document.createElement('button');button.type='button';button.id='brief-selection-'+key;button.className='brief-action brief-secondary';button.hidden=true;
  button.addEventListener('click',()=>{
   const selected=selection,choice=selected?.permission,field=document.getElementById(key);
   if(!current(selected)||!choice||choice.key!==key||field.disabled){sync();return;}
   setField(field,choice.value,key==='training'?'Model training':key==='exclusive'?'Exclusive rights':'Creator credit');
   finish(selected,choice.message);
  });permissionButtons.set(key,button);actions.append(button);
 }

 function selectedInteger(text){
  if(/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(text)){
   const value=Number(text.replaceAll(',',''));
   return Number.isSafeInteger(value)&&value<=1000000?value:null;
  }
  const normalized=text.toLowerCase().replace(/\s+/g,' ').trim();
  if(!/^[a-z]+(?:[ -][a-z]+)*$/.test(normalized))return null;
  const words=normalized.replaceAll('-',' ');
  const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  function underHundred(value){
   const direct=small.indexOf(value);if(direct>=0)return direct;
   const parts=value.split(' '),ten=tens.indexOf(parts[0]),one=small.indexOf(parts[1]);
   return ten>=2&&(parts.length===1||parts.length===2&&one>=1&&one<=9)?ten*10+(parts.length===2?one:0):null;
  }
  function underThousand(value){
   const match=/^([a-z]+) hundred(?: (?:and )?(.+))?$/.exec(value);
   if(!match)return underHundred(value);
   const hundreds=small.indexOf(match[1]),rest=match[2]?underHundred(match[2]):0;
   return hundreds>=1&&hundreds<=9&&rest!==null&&(!match[2]||rest>0)?hundreds*100+rest:null;
  }
  if(words==='one million')return 1000000;
  const thousands=/^(.+) thousand(?: (?:and )?(.+))?$/.exec(words);
  if(!thousands)return underThousand(words);
  const first=underThousand(thousands[1]),rest=thousands[2]?underThousand(thousands[2]):0;
  return first!==null&&first>0&&rest!==null&&(!thousands[2]||rest>0)?first*1000+rest:null;
 }
 function selectedDuration(text){
  const match=/^(.+?)\s+(months?|years?)$/i.exec(text);
  if(!window.licenseScope||!match&&!/^[1-9]\d{0,2}$/.test(text))return null;
  const count=selectedInteger(match?match[1]:text);
  if(count===null)return null;
  try{return licenseScope.months(count*(match&&/^years?$/i.test(match[2])?12:1));}catch{return null;}
 }
 function selectedMedium(text){
  const normal=value=>value.trim().replace(/\s+/g,' ').toLowerCase();
  const selected=normal(text),field=document.getElementById('medium');
  if(!selected||!field)return null;
  const option=Array.from(field.options).find(option=>option.value&&!option.disabled&&(normal(option.value)===selected||normal(option.textContent)===selected));
  return option?{value:option.value,label:option.textContent.trim()}:null;
 }
 function selectedTerritory(text){
  if(!window.licenseScope||!/\p{L}/u.test(text))return null;
  try{return licenseScope.territory(text);}catch{return null;}
 }
 function copyCount(text){
  const phrase=/^(.+?)\s+(?:(?:printed|physical)\s+)?cop(?:y|ies)$/i.exec(text);
  if(!phrase&&!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)$/.test(text))return null;
  return selectedInteger(phrase?phrase[1]:text);
 }
 function sync(){
  const text=input.value.slice(input.selectionStart,input.selectionEnd).trim();
  const nameValid=text.length>=1&&text.length<=100&&!/[\r\n]/.test(text),copies=copyCount(text);
  const duration=selectedDuration(text),medium=selectedMedium(text),permission=selectedPermission(text),territory=!/\b(?:cop(?:y|ies)|months?|years?)\.?$/i.test(text)&&duration===null&&copies===null&&!medium&&!permission&&!permissionLanguage(text)?selectedTerritory(text):null;
  const print=copies!==null&&/^(.+?)\s+printed\s+cop(?:y|ies)$/i.test(text);
  printButton.hidden=!print;printButton.disabled=document.getElementById('medium').disabled||document.getElementById('copies').disabled;
  printButton.textContent=print?'Use print · '+copies.toLocaleString()+' '+(copies===1?'copy':'copies'):'Use print and copies';
  selection=nameValid||copies!==null||duration!==null||territory!==null||medium?{brief:input.value,start:input.selectionStart,end:input.selectionEnd,text,copies,duration,territory,medium,permission,print}:null;
  box.hidden=!selection;value.textContent=selection?.text||'';
  for(const [key,button] of permissionButtons){button.hidden=permission?.key!==key;button.disabled=document.getElementById(key).disabled;if(permission?.key===key)button.textContent=permission.label;}
  for(const button of nameButtons)button.hidden=!nameValid;
  copyButton.hidden=copies===null||print;copyButton.disabled=document.getElementById('copies').disabled;
  copyButton.textContent=copies===null?'Use as print copies':'Use '+copies.toLocaleString()+' '+(copies===1?'copy':'copies');
  durationButton.hidden=duration===null||!document.getElementById('term-months');
  durationButton.textContent=duration===null?'Use as duration':'Use '+licenseScope.label(duration);
  territoryButton.hidden=territory===null||!document.getElementById('requested-territory');
  mediumButton.hidden=!medium;mediumButton.textContent=medium?'Use '+medium.label.replace(/\s*(?:\/|\().*$/,'').trim():'Use as usage';
 }
 function current(selected){return selected&&input.value===selected.brief&&input.value.slice(selected.start,selected.end).trim()===selected.text;}
 function finish(selected,text){
  message.textContent=text;message.hidden=false;if(undo)message.append(' ',undoButton);
  input.focus({preventScroll:true});input.setSelectionRange(selected.end,selected.end);sync();
 }
 for(const [target,label] of [['licensee','Use as buyer'],['project','Use as project']]){
  const button=document.createElement('button');button.type='button';button.className='brief-action brief-secondary';button.id='brief-selection-'+target;button.textContent=label;
  button.addEventListener('click',()=>{
   const selected=selection;
   if(!current(selected)){sync();return;}
   const field=document.getElementById(target);setField(field,selected.text,target==='licensee'?'Buyer':'Project');
   finish(selected,(target==='licensee'?'Buyer':'Project')+' set to '+selected.text+'.');
  });nameButtons.push(button);actions.append(button);
 }
 copyButton.addEventListener('click',()=>{
  const selected=selection,field=document.getElementById('copies');
  if(!current(selected)||selected.copies===null||field.disabled){sync();return;}
  setField(field,selected.copies,'Print copies');
  finish(selected,'Print copies set to '+selected.copies.toLocaleString()+'.');
 });
 for(const [button,key,target,label]of [[durationButton,'duration','term-months','Duration'],[territoryButton,'territory','requested-territory','Territory']]){
  button.addEventListener('click',()=>{
   const selected=selection,field=document.getElementById(target);
   if(!current(selected)||selected[key]===null||!field||field.disabled){sync();return;}
   setField(field,selected[key],label);
   finish(selected,label+' set to '+(key==='duration'?licenseScope.label(selected[key]):selected[key])+'.');
  });
 }
 mediumButton.addEventListener('click',()=>{
  const selected=selection,field=document.getElementById('medium');
  if(!current(selected)||!selected.medium||!field||field.disabled||selectedMedium(selected.text)?.value!==selected.medium.value){sync();return;}
  setField(field,selected.medium.value,'Usage');
  finish(selected,'Usage set to '+selected.medium.label+'.');
 });
 printButton.addEventListener('click',()=>{
  const selected=selection,medium=document.getElementById('medium'),copies=document.getElementById('copies');
  if(!current(selected)||!selected.print||medium.disabled||copies.disabled){sync();return;}
  const confirmed=window.captureDraftConfirmedFields?.()||{};
  const fields=[{field:medium,before:fieldValue(medium),after:'print'},{field:copies,before:fieldValue(copies),after:String(selected.copies)}];
  for(const item of fields){writeField(item.field,item.after);item.field.dispatchEvent(new Event('input',{bubbles:true}));}
  undo={fields,confirmed};undoButton.hidden=false;undoButton.setAttribute('aria-label','Undo usage and print copies change');
  finish(selected,'Printed publication set to '+selected.copies.toLocaleString()+' '+(selected.copies===1?'copy.':'copies.'));
 });
 actions.append(printButton,copyButton,durationButton,territoryButton,mediumButton);
 input.addEventListener('select',sync);input.addEventListener('keyup',sync);input.addEventListener('pointerup',sync);
 input.addEventListener('input',()=>{undo=null;undoButton.hidden=true;message.hidden=true;sync();});
})();
