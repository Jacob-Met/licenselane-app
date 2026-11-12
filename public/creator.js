'use strict';
const $=id=>document.getElementById(id);
let reviewed=null,objectURL=null,revision=0,editing=null,works=[],dirty=false,saving=false,lifecyclePending=null;
let gallerySettings={includeDemoWorks:true,revision:1},galleryPending=null;
function showGallerySettings(){
 $('gallery-own-only').checked=!gallerySettings.includeDemoWorks;
 $('gallery-mode').textContent=gallerySettings.includeDemoWorks?'Your works + demonstration works':'Your works only';
}
$('gallery-own-only').addEventListener('change',()=>{galleryPending=null;$('gallery-settings-status').textContent='Unsaved gallery change';});
$('reload-gallery-settings').addEventListener('click',async()=>{
 try{const current=await api('/api/creator/catalog');gallerySettings=current.settings;galleryPending=null;showGallerySettings();$('reload-gallery-settings').hidden=true;$('gallery-code').value='';$('gallery-settings-status').textContent='Current setting loaded.';}catch(e){$('gallery-settings-status').textContent=e.message;}
});
$('gallery-settings-form').addEventListener('submit',async event=>{
 event.preventDefault();
 galleryPending||={requestId:crypto.randomUUID(),expectedRevision:gallerySettings.revision,includeDemoWorks:!$('gallery-own-only').checked,confirmed:true};
 $('gallery-settings-form').inert=true;
 try{const result=await api('/api/creator/catalog/settings',{...galleryPending,creatorCode:$('gallery-code').value});gallerySettings=(await api('/api/creator/catalog')).settings;galleryPending=null;showGallerySettings();$('gallery-settings-status').textContent=gallerySettings.revision!==result.settings.revision?'Another window changed the gallery after your save. The current setting is shown.':'Gallery saved. Buyers now see '+(gallerySettings.includeDemoWorks?'your works and demonstration works.':'only your own works.');}
 catch(e){$('reload-gallery-settings').hidden=e.status!==409;$('gallery-settings-status').textContent=e.status===409?'Your gallery changed in another window. Reload the current setting before saving.':e.message;}
 finally{$('gallery-code').value='';$('gallery-settings-form').inert=false;}
});
$('studio-backup-form').addEventListener('submit',async event=>{
 event.preventDefault();const button=$('studio-backup-button'),status=$('studio-backup-status');button.disabled=true;status.textContent='Preparing your saved artwork and agreements…';
 try{const value=await api('/api/creator/studio-backup',{creatorCode:$('studio-backup-code').value});
  const link=document.createElement('a');link.href=value.download;link.download='';document.body.append(link);link.click();link.remove();status.textContent='Your private studio backup is downloading. Keep its original filename for restoration.';
 }catch(error){status.textContent=error.message;}finally{$('studio-backup-code').value='';button.disabled=false;}
});
const editDrafts=new Map(),draftVersions=new Map(),draftConflicts=new Map();
const draftKey=()=>editing?'edit:'+editing.id:'new-work';
const draftToken=record=>record?(record.saveId||'legacy:'+record.requestId):null;
let previewCreating=false,previewBuild=0;
const fileChecks=new Map(),inspectedFiles=new WeakMap();
const filesBlocked=()=>[...fileChecks.values()].some(check=>check.pending||check.error);
let draftRecord=null,draftSequence=0,draftSaved=true,draftQueue=Promise.resolve(),draftDatabase;
function draftDB(){
 if(!draftDatabase)draftDatabase=new Promise((resolve,reject)=>{
  const request=indexedDB.open('licenselane-creator-draft',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
  request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Draft storage is busy.'));
  request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
 });
 return draftDatabase;
}
async function draftStore(action,value,key='new-work'){
 const db=await draftDB();
 return new Promise((resolve,reject)=>{
  const reading=['read','all','check'].includes(action),tx=db.transaction('drafts',reading?'readonly':'readwrite'),store=tx.objectStore('drafts');
  let result,conflict;
  const request=action==='all'?store.getAll():store.get(key);
  request.onsuccess=()=>{
   const current=request.result;
   if(reading&&action!=='check'){result=current;return;}
   if(draftToken(current)!==(draftVersions.get(key)||null)){
    conflict=Object.assign(Error('Another window saved this draft.'),{draftConflict:true,key,record:current||null});tx.abort();return;
   }
   if(action==='check'){result=current;return;}
   result=action==='clear'?null:{...value,saveId:crypto.randomUUID()};
   if(action==='clear')store.delete(key);else store.put(result,key);
  };
  tx.oncomplete=()=>{
   if(action==='all'){for(const record of result||[])draftVersions.set(record.work?.id?'edit:'+record.work.id:'new-work',draftToken(record));}
   else draftVersions.set(key,draftToken(result));
   resolve(result);
  };
  tx.onerror=()=>reject(conflict||tx.error);tx.onabort=()=>reject(conflict||tx.error||Error('Draft save interrupted.'));
 });
}
function draftFailure(error,key){
 const first=error?.draftConflict&&!draftConflicts.has(key);
 if(error?.draftConflict)draftConflicts.set(key,error.record);
 showDraft();if(first&&key===draftKey()&&['edit','review'].includes(document.body.dataset.stage))$('creator-draft-conflict').scrollIntoView({block:'nearest'});
}
function showDraft(){
 const stage=document.body.dataset.stage,key=draftKey(),conflicted=draftConflicts.has(key),other=draftConflicts.get(key);
 $('creator-draft-conflict').hidden=!conflicted||!['edit','review'].includes(stage);
 $('creator-draft-conflict-title').textContent=other?.fields?.title||'Untitled work';
 $('inspect-other-draft').hidden=!other;$('other-draft-description').textContent=other?.fields?.description||'No description entered';
 $('other-draft-files').textContent=[other?.fields?.price?'USD '+other.fields.price:'Price not entered',other?.preview?.name?'Preview: '+other.preview.name:'',other?.original?.name?'Original: '+other.original.name:''].filter(Boolean).join(' · ');
 $('load-other-draft').disabled=!other||saving;$('replace-other-draft').disabled=saving;
 $('creator-draft-conflict-message').textContent=other?'Your edits are still here. Load the saved version or replace it with these edits.':'Another window removed the saved draft. You can save these edits as the new draft.';
 $('review-offer').disabled=previewCreating||conflicted||filesBlocked();$('save').disabled=saving||conflicted;
 $('creator-draft-banner').hidden=!draftRecord||stage!=='catalog';
 $('creator-draft-title').textContent=draftRecord?.fields.title||'Untitled work';
 $('discard-active-draft').hidden=!(editing?editDrafts.get(editing.id):draftRecord)||stage!=='edit';
 $('creator-draft-status').hidden=!['edit','review'].includes(stage)||(!!editing&&!editDrafts.has(editing.id));
}
function captureDraft(){
 if(saving)return;
 const fields={};for(const id of ['title','creator','description','contact-email','price','copies','max-term-months','offer-territory'])fields[id]=$(id).value;
 const previous=editing?editDrafts.get(editing.id):draftRecord;
 const next={version:1,requestId:previous?.requestId||crypto.randomUUID(),fields,permitted:[...document.querySelectorAll('[name=medium]:checked')].map(x=>x.value),preview:$('preview').files[0]||null,previewGallery:creatorPreviews.capture(),original:$('original').files[0]||null};
 if(editing){next.work=editing;editDrafts.set(editing.id,next);}else draftRecord=next;
 const record=next,key=editing?'edit:'+editing.id:'new-work',sequence=++draftSequence;draftSaved=false;$('creator-draft-status').textContent='Saving draft on this device…';showDraft();
 draftQueue=draftQueue.catch(()=>{}).then(()=>draftStore('write',record,key)).then(()=>{
  draftConflicts.delete(key);if(sequence===draftSequence){draftSaved=true;$('creator-draft-status').textContent='Draft saved on this device';showDraft();}
 }).catch(error=>{draftFailure(error,key);if(sequence===draftSequence){draftSaved=false;$('creator-draft-status').textContent=error?.draftConflict?'Draft changed in another window. Your edits are still here.':'Draft could not be saved. Keep this page open.';}});
}
async function clearDraft(workId=null){
 const key=workId?'edit:'+workId:'new-work',record=workId?editDrafts.get(workId):draftRecord,sequence=++draftSequence;draftSaved=false;
 let cleared=false;
 draftQueue=draftQueue.catch(()=>{}).then(()=>draftStore('clear',undefined,key)).then(()=>{
  cleared=true;draftConflicts.delete(key);
  if(workId){if(editDrafts.get(workId)===record)editDrafts.delete(workId);}else if(draftRecord===record)draftRecord=null;
  if(sequence===draftSequence){draftSaved=true;$('creator-draft-status').textContent='';}
 }).catch(error=>{draftFailure(error,key);if(sequence===draftSequence){draftSaved=false;$('creator-draft-status').textContent=error?.draftConflict?'The newer saved draft was kept. Choose which version to use.':'Could not remove the saved draft on this device.';}});
 await draftQueue;showDraft();return cleared;
}
$('replace-other-draft').addEventListener('click',async()=>{
 const key=draftKey();if(saving||!draftConflicts.has(key))return;
 draftVersions.set(key,draftToken(draftConflicts.get(key)));draftConflicts.delete(key);if(document.body.dataset.stage==='review'){invalidate();setStage('edit');}captureDraft();await draftQueue;showDraft();
});
$('load-other-draft').addEventListener('click',async()=>{
 const key=draftKey();if(saving||!draftConflicts.has(key))return;
 await draftQueue;
 try{
  const record=await draftStore('read',undefined,key);
  if(!record){draftConflicts.set(key,null);showDraft();return;}
  draftConflicts.delete(key);if(record.work?.id){editDrafts.set(record.work.id,record);resumeEditDraft(record.work.id);}else{draftRecord=record;resumeDraft();}
 }catch(error){status('Could not open the saved draft. Your edits are still here.');}
});
function resumeDraft(){
 if(!draftRecord||saving)return;
 const record=draftRecord;dirty=false;
 chooseWork(null,true);
 restoreDraftFields(record);
 $('editor-title').textContent='Continue your work';$('title').focus();
}
function restoreDraftFields(record){
 creatorPreviews.restore(record.previewGallery);
 for(const id of ['title','creator','description','contact-email','price','copies'])$(id).value=String(record.fields[id]||'');
 $('max-term-months').value=record.fields['max-term-months']??record.work?.maxTermMonths??12;
 $('offer-territory').value=record.fields['offer-territory']??record.work?.territory??'Worldwide';
 for(const input of document.querySelectorAll('[name=medium]'))input.checked=record.permitted.includes(input.value);
 for(const id of ['preview','original'])if(record[id] instanceof Blob){
  const transfer=new DataTransfer();transfer.items.add(new File([record[id]],record[id].name||id,{type:record[id].type,lastModified:record[id].lastModified}));$(id).files=transfer.files;
 }
 $('original').dispatchEvent(new Event('change'));$('preview').dispatchEvent(new Event('change'));dirty=true;invalidate();draftSaved=true;setStage('edit');
 $('creator-draft-status').textContent='Draft restored from this device';
}
function resumeEditDraft(id){
 const record=editDrafts.get(id);if(!record||saving)return;
 dirty=false;chooseWork(record.work,true);restoreDraftFields(record);
 $('editor-title').textContent='Continue offer changes';
 const latest=works.find(work=>work.id===id);
 if(latest&&(latest.offerRevision||1)>(record.work.offerRevision||1)){
  $('editing-context').textContent+=' · A newer revision '+latest.offerRevision+' is published';$('reload-current').hidden=false;
 }
 $('title').focus();
}
async function discardDraft(){
 if(saving||!window.confirm(editing?'Discard these saved offer edits from this device?':'Discard this unfinished work and its selected files from this device?'))return;
 const work=editing&&works.find(w=>w.id===editing.id);if(!await clearDraft(editing?.id))return;dirty=false;chooseWork(work||null,true);
}
$('resume-creator-draft').addEventListener('click',resumeDraft);
$('discard-creator-draft').addEventListener('click',discardDraft);
$('discard-active-draft').addEventListener('click',discardDraft);
window.addEventListener('beforeunload',e=>{if(dirty&&!draftSaved){e.preventDefault();e.returnValue='';}});
function status(text){$('review-status').textContent=text;$('status').textContent=text;if(text){$('status').focus({preventScroll:true});$('status').scrollIntoView({block:'nearest'});}}
async function api(url,body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),body?30000:5000);
 try{
  const r=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:controller?.signal});
  const v=await r.json();if(!r.ok){const error=Error(v.error||'Could not save. Your fields are still here.');error.status=r.status;throw error;}return v;
 }catch(error){
  if(body&&(controller.signal.aborted||!error.status))throw Object.assign(Error('No confirmation arrived. This change may have saved. Retry to recover the same request.'),{saveUnconfirmed:true});
  if(controller.signal.aborted)throw Error('The catalog read took too long. Try again.');throw error;
 }
 finally{if(timer)clearTimeout(timer);}
}
const fileDescriptions=new WeakMap();
async function inspectFile(file,max,allowBundle=false){
 const field=allowBundle?'original':'preview',bundle=allowBundle&&file&&/\.zip$/i.test(file.name);
 const fail=message=>Object.assign(Error(message),{field});
 if(!file||(!['image/png','image/jpeg'].includes(file.type)&&!bundle)||file.size>max)throw fail(allowBundle?'Choose a PNG, JPEG or ZIP original up to 64 MB.':'Choose a PNG or JPEG preview up to 2 MB.');
 if(!inspectedFiles.has(file))inspectedFiles.set(file,(async()=>{
  if(bundle){
   try{fileDescriptions.set(file,{filename:file.name,mime:'application/zip',bytes:file.size,contents:window.readZipInventory(await file.arrayBuffer())});}
   catch{throw fail('This ZIP could not be read. Choose a complete archive containing your delivery files.');}
  }else{
   let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw fail('The '+(allowBundle?'original image':'buyer preview')+' could not be opened. Choose another PNG or JPEG.');}finally{bitmap?.close();}
   fileDescriptions.set(file,{filename:file.name,mime:file.type,bytes:file.size});
  }
 })());
 return inspectedFiles.get(file);
}
async function validateSelectedFile(id){
 const file=$(id).files[0],check={file,pending:!!file,error:false};
 fileChecks.set(id,check);$(id).removeAttribute('aria-invalid');
 $(id+'-file-error').textContent=file?'Checking chosen file…':'';
 refreshOriginalPreview();showDraft();
 if(!file)return;
 try{await inspectFile(file,(id==='original'?64:2)*1024*1024,id==='original');}
 catch(error){check.error=error.message;}
 check.pending=false;
 if(fileChecks.get(id)!==check||$(id).files[0]!==file)return;
 $(id+'-file-error').textContent=check.error||'';
 if(check.error)$(id).setAttribute('aria-invalid','true');else $(id).removeAttribute('aria-invalid');
 if(id==='preview'&&check.error)$('preview-image').hidden=true;
 refreshOriginalPreview();showDraft();
}
async function bytes(file,max,allowBundle=false){
 await inspectFile(file,max,allowBundle);
 return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({name:file.name,data:String(r.result).split(',')[1]});r.onerror=()=>reject(Error('Could not read the chosen image. Choose it again.'));r.readAsDataURL(file);});
}

function refreshOriginalPreview(){
 const file=$('original').files[0],available=!editing&&file&&['image/png','image/jpeg'].includes(file.type)&&file.size<=64*1024*1024;
 $('make-preview-group').hidden=!available;
 $('original-preparation-hint').hidden=!!editing||available;
 $('make-preview').disabled=previewCreating||!!fileChecks.get('original')?.pending||!!fileChecks.get('original')?.error;$('review-offer').disabled=previewCreating||draftConflicts.has(draftKey())||filesBlocked();
 $('make-preview').textContent=previewCreating?'Creating preview…':$('preview').files.length?'Replace preview from original':'Create preview from original';
}
$('original').addEventListener('change',()=>{$('original-file-error').textContent='';$('original').removeAttribute('aria-invalid');previewBuild++;previewCreating=false;$('preview-generation-status').textContent='';refreshOriginalPreview();});
$('original').addEventListener('change',()=>validateSelectedFile('original'));
$('preview').addEventListener('change',()=>validateSelectedFile('preview'));
$('make-preview').addEventListener('click',async()=>{
 const source=$('original').files[0];if(editing||previewCreating||!source||!['image/png','image/jpeg'].includes(source.type)||source.size>64*1024*1024)return;
 const build=++previewBuild;previewCreating=true;refreshOriginalPreview();$('preview-generation-status').textContent='Preparing your buyer preview…';
 let bitmap;
 try{
  bitmap=await createImageBitmap(source);
  const canvas=document.createElement('canvas'),scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));
  let width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale)),blob;
  for(let attempt=0;attempt<8;attempt++){
   canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(bitmap,0,0,width,height);
   blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Could not prepare this image.')),source.type,.88));
   if(blob.size<=2*1024*1024)break;
   width=Math.max(1,Math.floor(width*.8));height=Math.max(1,Math.floor(height*.8));
  }
  if(!blob||blob.size>2*1024*1024)throw Error('Choose a smaller preview image.');
  if(build!==previewBuild||$('original').files[0]!==source||editing||document.body.dataset.stage!=='edit')return;
  const extension=blob.type==='image/png'?'png':'jpg',name=source.name.replace(/\.[^.]*$/,'')+'-preview.'+extension,transfer=new DataTransfer();
  transfer.items.add(new File([blob],name,{type:blob.type,lastModified:Date.now()}));$('preview').files=transfer.files;
  $('preview').dispatchEvent(new Event('change',{bubbles:true}));$('preview').dispatchEvent(new Event('input',{bubbles:true}));
  $('preview-generation-status').textContent='Preview ready · '+width+' × '+height+' · '+Math.ceil(blob.size/1024).toLocaleString()+' KB';
  $('preview-image').scrollIntoView({block:'nearest'});
 }catch(error){if(build===previewBuild)$('preview-generation-status').textContent='Could not create a preview. Choose a PNG or JPEG preview instead.';}
 finally{bitmap?.close();if(build===previewBuild){previewCreating=false;refreshOriginalPreview();}}
});

function setStage(stage){
 document.body.dataset.stage=stage;showAvailability();
 if(stage!=='review')$('review-offer').before($('code-field'));
 const editingStage=stage==='edit',catalogStage=stage==='catalog';
 $('catalog-overview').hidden=!catalogStage;$('back-catalog').hidden=!editingStage||!works.length;
 $('add-catalog-work').hidden=!catalogStage;$('catalog-overview-count').hidden=!catalogStage;
 $('offer-form').hidden=!editingStage;document.querySelector('.intro').hidden=!catalogStage;
 $('catalog-switcher').hidden=!catalogStage||!works.length;$('editor-title').hidden=!editingStage;$('editing-context').hidden=!editingStage||!editing;
 $('review').hidden=stage!=='review';$('saved').hidden=stage!=='saved';
 showDraft();
 if(stage==='review')$('review-footer-actions').before($('reload-current'));else if(stage==='saved')$('saved').append($('reload-current'));else $('status').before($('reload-current'));
}
function invalidate(){revision++;reviewed=null;$('review').hidden=true;$('saved').hidden=true;$('confirm').checked=false;renderOffer();}
function drawCatalog(){
 const selected=editing?.id||$('existing-work').value;
 $('existing-work').replaceChildren();
 const empty=document.createElement('option');empty.value='';empty.textContent=works.length?'Choose one of your published works':'No published own works yet';$('existing-work').append(empty);
 for(const work of works){const option=document.createElement('option');option.value=work.id;option.textContent=work.title+(work.offerStatus==='paused'?' · Paused':'');$('existing-work').append(option);}
 $('existing-work').value=selected;
 $('catalog-switcher').hidden=document.body.dataset.stage!=='catalog'||!works.length;
 $('existing-work').disabled=!works.length;
 $('edit-existing').disabled=!$('existing-work').value;
 $('catalog-count').textContent=works.length+' '+(works.length===1?'work':'works');
 renderCatalog();
}

function buyerLinkControl(work){
 const wrap=document.createElement('div');wrap.className='buyer-link-control';
 const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Copy buyer link';button.setAttribute('aria-label','Copy buyer link for '+work.title);
 const feedback=document.createElement('span');feedback.className='buyer-link-feedback';feedback.setAttribute('role','status');
 const input=document.createElement('input');input.type='url';input.readOnly=true;input.hidden=true;input.setAttribute('aria-label','Buyer link for '+work.title);input.value=new URL('/?work='+encodeURIComponent(work.id),location.origin).href;
 button.addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(input.value);feedback.textContent='Link copied';input.hidden=true;}
  catch{input.hidden=false;input.focus();input.select();feedback.textContent='Copy the selected link';}
 });
 wrap.append(button,feedback,input);return wrap;
}
function renderCatalog(){
 const query=$('catalog-search').value.trim().toLocaleLowerCase(),filter=$('catalog-filter').value;
 const active=works.filter(w=>w.offerStatus!=='paused').length;
 $('catalog-overview-count').textContent=works.length+' '+(works.length===1?'work':'works')+' · '+active+' accepting requests';
 const shown=works.filter(w=>(filter==='all'||(w.offerStatus==='paused'?'paused':'active')===filter)&&(!query||[w.title,w.creator,w.description].join(' ').toLocaleLowerCase().includes(query)));
 const cards=shown.map(work=>{
  const card=document.createElement('article');card.className='catalog-card';card.dataset.workId=work.id;
  const open=document.createElement('button');open.type='button';open.className='catalog-art';open.setAttribute('aria-label','Edit '+work.title);open.addEventListener('click',()=>chooseWork(work));
  const img=document.createElement('img');img.src=work.preview;img.alt=work.title;img.loading='lazy';open.append(img);
  const info=document.createElement('div');info.className='catalog-card-info';
  const state=document.createElement('span');state.className='catalog-availability'+(work.offerStatus==='paused'?' is-paused':'');state.textContent=work.offerStatus==='paused'?'Paused':'Accepting requests';
  const title=document.createElement('h2');title.textContent=work.title;
  const creator=document.createElement('p');creator.className='catalog-credit';creator.textContent=work.creator;
  const price=document.createElement('p');price.className='catalog-price';price.textContent=usd(work.priceCents)+' base';
  const uses=document.createElement('p');uses.className='catalog-uses';uses.textContent=work.permitted.map(x=>({website:'Web',social:'Social',print:'Print'})[x]).join(' · ')+(work.permitted.includes('print')?' / up to '+work.maxCopies.toLocaleString('en-US')+' copies':'');
  const actions=document.createElement('div');actions.className='catalog-card-actions';
  const edit=document.createElement('button');edit.type='button';edit.className='secondary';edit.textContent=editDrafts.has(work.id)?'Continue changes':'Edit offer';edit.setAttribute('aria-label',(editDrafts.has(work.id)?'Continue changes for ':'Edit offer for ')+work.title);edit.addEventListener('click',()=>chooseWork(work));actions.append(edit);
  if(work.offerStatus!=='paused'){const view=document.createElement('a');view.href='/?work='+encodeURIComponent(work.id);view.textContent='Buyer view ↗';view.setAttribute('aria-label','Buyer view of '+work.title);actions.append(view);}
  if(editDrafts.has(work.id)){const pending=document.createElement('p');pending.className='catalog-credit';pending.textContent='Unpublished changes saved on this device';info.append(pending);}
  info.append(state,title,creator,price,uses,actions);if(work.offerStatus!=='paused')info.append(buyerLinkControl(work));card.append(open,info);return card;
 });
 $('catalog-grid').replaceChildren(...cards);$('catalog-no-results').hidden=shown.length>0;
}
async function openCatalog(){
 if(saving)return;
 if(dirty){await draftQueue;if(!draftSaved){status('Your draft has not been saved. Keep this page open or try again.');return;}}
 dirty=false;reviewed=null;$('confirm').checked=false;
 if(objectURL){URL.revokeObjectURL(objectURL);objectURL=null;}
 $('code').value='';$('status').textContent='';$('review-status').textContent='';
 setStage('catalog');drawCatalog();window.scrollTo(0,0);$('catalog-search').focus({preventScroll:true});
}
$('catalog-search').addEventListener('input',renderCatalog);
$('catalog-filter').addEventListener('change',renderCatalog);
$('add-catalog-work').addEventListener('click',()=>chooseWork(null));
$('back-catalog').addEventListener('click',openCatalog);
$('saved-catalog').addEventListener('click',openCatalog);

function showAvailability(){
 const paused=editing?.offerStatus==='paused';
 $('offer-availability').hidden=!editing||(document.body.dataset.stage&&document.body.dataset.stage!=='edit');
 $('offer-availability').classList.toggle('paused',paused);
 $('availability-label').textContent=paused?'Paused for new requests':'Accepting new requests';
 $('change-availability').textContent=lifecyclePending?'Retry '+(lifecyclePending.status==='paused'?'pause':'reopen'):paused?'Reopen offer':'Pause new requests';
 $('change-availability').disabled=saving;
}
function showMode(){
 showAvailability();
 const isEdit=!!editing;
 $('editor-title').textContent=isEdit?'Edit published offer':'Add a work';
 $('editing-context').hidden=!isEdit;
 $('editing-context').textContent=isEdit?editing.title+' · Revision '+(editing.offerRevision||1):'';
 $('original-field').hidden=isEdit;$('original').required=!isEdit;
 $('retained-original').hidden=!isEdit;
 $('retained-original').textContent=isEdit?'Delivery file · '+editing.specs:'';
 $('preview').required=!isEdit;
 $('preview-hint').textContent=isEdit?'Optional replacement · PNG or JPEG · up to 2 MB':'PNG or JPEG · up to 2 MB';
 $('review-offer').textContent=isEdit?'Review changes':'Review offer';
 $('save').textContent=isEdit?'Update this offer':'Add to catalog';
 $('review-title').textContent=isEdit?'Review changes':'Review offer';$('reload-current').textContent='Reload current offer';refreshOriginalPreview();
}
function chooseWork(work,resuming=false){
 if(saving)return;
 if(dirty&&!window.confirm('Replace your unsaved offer edits with '+(work?'the selected published work':'a new blank work')+'?'))return;
 if(work&&!resuming&&editDrafts.has(work.id)){resumeEditDraft(work.id);return;}
 if(!work&&!resuming&&draftRecord){if(!window.confirm('Replace the unfinished work saved on this device with a new blank work?'))return;const started=revision;clearDraft().then(cleared=>{if(cleared&&started===revision){dirty=false;chooseWork(null,true);}});return;}
 if(objectURL){URL.revokeObjectURL(objectURL);objectURL=null;}
 fileChecks.clear();previewBuild++;previewCreating=false;$('preview-generation-status').textContent='';$('offer-form').reset();$('preview-file-error').textContent='';$('preview').removeAttribute('aria-invalid');$('original-file-error').textContent='';$('original').removeAttribute('aria-invalid');$('code').value='';editing=work||null;lifecyclePending=null;creatorPreviews.reset(work);
 if(work){
  for(const id of ['title','creator','description'])$(id).value=work[id];
  $('contact-email').value=work.contactEmail||'';
  $('price').value=(work.priceCents/100).toFixed(2);
  for(const input of document.querySelectorAll('[name=medium]'))input.checked=work.permitted.includes(input.value);
  $('copies').value=work.maxCopies||'';
  const offered=licenseScope.offer(work);$('max-term-months').value=offered.maxTermMonths;$('offer-territory').value=offered.territory;
  $('preview-image').src=work.preview;$('preview-image').hidden=false;
 }else{$('preview-image').removeAttribute('src');$('preview-image').hidden=true;$('copies').value='';}
 $('reload-current').hidden=true;$('saved').hidden=true;dirty=false;invalidate();showMode();drawCatalog();setStage('edit');$(work||resuming?'title':'original').focus();
}
$('existing-work').addEventListener('change',()=>{$('edit-existing').disabled=!$('existing-work').value;});
$('edit-existing').addEventListener('click',()=>chooseWork(works.find(w=>w.id===$('existing-work').value)));
$('new-work').addEventListener('click',()=>chooseWork(null));
$('offer-form').addEventListener('input',e=>{if(!['example-copies','code'].includes(e.target.id)){dirty=true;invalidate();captureDraft();}});
$('preview').addEventListener('change',()=>{
 $('preview-file-error').textContent='';$('preview').removeAttribute('aria-invalid');previewBuild++;previewCreating=false;$('preview-generation-status').textContent='';refreshOriginalPreview();
 if(objectURL)URL.revokeObjectURL(objectURL);
 const file=$('preview').files[0];objectURL=file?URL.createObjectURL(file):null;
 const source=objectURL||editing?.preview;
 if(source){$('preview-image').src=source;$('preview-image').hidden=false;}else{$('preview-image').removeAttribute('src');$('preview-image').hidden=true;}
});
$('offer-form').addEventListener('submit',async e=>{
 e.preventDefault();status('');const started=revision,work=editing;try{
  await draftQueue;await draftStore('check',undefined,draftKey()).catch(error=>{if(error.draftConflict)throw error;});if(draftConflicts.has(draftKey()))throw Error('Choose which draft to keep before reviewing.');
  const permitted=[...document.querySelectorAll('[name=medium]:checked')].map(x=>x.value),maxCopies=permitted.includes('print')?Number($('copies').value):0;
  if(!permitted.length)throw Error('Choose at least one offered use.');
  if(permitted.includes('print')&&maxCopies<1)throw Error('Set a positive copy limit for Print.');
  const payload={requestId:(work?editDrafts.get(work.id)?.requestId:draftRecord?.requestId)||crypto.randomUUID(),title:$('title').value.trim(),creator:$('creator').value.trim(),description:$('description').value.trim(),contactEmail:$('contact-email').value.trim(),priceCents:Math.round(Number($('price').value)*100),permitted,maxCopies,...licenseScope.offer({maxTermMonths:$('max-term-months').value,territory:$('offer-territory').value})};
  if(work)payload.expectedOfferRevision=work.offerRevision||1;
  const previewGallery=await creatorPreviews.payload();if(previewGallery!==undefined)payload.previewGallery=previewGallery;
  if($('preview').files[0]||!work)payload.preview=await bytes($('preview').files[0],2*1024*1024);
  const originalFile=work?null:$('original').files[0];
  if(originalFile){await inspectFile(originalFile,64*1024*1024,true);const digest=await crypto.subtle.digest('SHA-256',await originalFile.arrayBuffer());payload.original={name:originalFile.name,uploadSha:[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')};}
  if(started!==revision)throw Error('Your offer changed while reading the files. Review it again.');
  const changed=work&&(['title','creator','description','priceCents','maxCopies','maxTermMonths','territory'].some(key=>payload[key]!==work[key])||[...permitted].sort().join(',')!==[...work.permitted].sort().join(',')||payload.contactEmail!==(work.contactEmail||'')||!!payload.preview||payload.previewGallery!==undefined);
  if(work&&!changed)throw Error('This offer matches the published version. Edit a field or choose a new preview before reviewing changes.');
  reviewed={payload,originalFile,workId:work?.id||null};$('save').textContent=work?'Update this offer':'Add to catalog';
  const dl=document.createElement('dl');
  const values=[['Work',payload.title],['Creator credit',payload.creator],['Description',payload.description],['Contact email',payload.contactEmail||'Not provided'],['Base price','USD '+(payload.priceCents/100).toFixed(2)],['Offered uses',permitted.map(x=>mediumNames[x]).join(', ')],['Print limit',permitted.includes('print')?maxCopies.toLocaleString('en-US')+' copies':'No physical distribution'],...(permitted.includes('print')?[['Price at print limit','USD '+((licensePrice.calculate(payload,{medium:'print',copies:maxCopies}).totalCents)/100).toFixed(2)]]:[]),['Visible preview',(payload.preview?.name||'Keep current published preview')+(creatorPreviews.count()?' · '+creatorPreviews.count()+' additional views':'')],['Private original',work?'Retain existing delivery file':payload.original.name]];
  if(work){
   const previous={'Work':work.title,'Creator credit':work.creator,'Description':work.description,'Contact email':work.contactEmail||'Not provided','Base price':'USD '+(work.priceCents/100).toFixed(2),'Offered uses':work.permitted.map(x=>mediumNames[x]).join(', '),'Print limit':work.permitted.includes('print')?work.maxCopies.toLocaleString('en-US')+' copies':'No physical distribution'};
   for(const row of values)if(previous[row[0]]!==undefined&&previous[row[0]]!==row[1])row[1]=previous[row[0]]+' → '+row[1];
   values.unshift(['Updating',work.title+' · revision '+(work.offerRevision||1)]);
  }
  const title=document.createElement('h3');title.textContent=payload.title;
  const credit=document.createElement('p');credit.className='review-credit';credit.textContent='By '+payload.creator;
  const price=document.createElement('p');price.className='review-price';price.textContent=usd(payload.priceCents)+' base';
  for(const [label,value]of values.filter(([label])=>['Contact email','Offered uses','Print limit','Price at print limit'].includes(label))){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;dl.append(dt,dd);}
  for(const [label,value]of [['License','One project · up to '+licenseScope.label(payload.maxTermMonths)+' · '+payload.territory],['Conditions','Credit required · nonexclusive · no model training']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;dl.append(dt,dd);}
  const details=document.createElement('details');details.className='review-details';const label=document.createElement('summary');label.textContent='Description and preview';
  const desc=document.createElement('p');desc.textContent=payload.description;
  const fileInfo=document.createElement('p');fileInfo.textContent='Public preview: '+(payload.preview?.name||'Keep current published preview');
  details.append(label,desc,fileInfo);
  const fullTerms=document.createElement('details');fullTerms.className='review-details';fullTerms.id='review-policy';
  const fullTitle=document.createElement('summary');fullTitle.textContent='Full license terms';
  const policy=$('policy').cloneNode(true);policy.removeAttribute('id');fullTerms.append(fullTitle,policy);
  const nodes=[title,credit,price];
  if(work){
   const revisionLabel=document.createElement('p');revisionLabel.className='review-credit';revisionLabel.textContent='Updating '+work.title+' · revision '+(work.offerRevision||1);nodes.push(revisionLabel);
   const changes=document.createElement('dl');changes.className='review-changes';
   for(const [label,key]of [['Work','title'],['Creator credit','creator'],['Description','description'],['Contact email','contactEmail'],['Base price','priceCents'],['Maximum months','maxTermMonths'],['Territory','territory']]){
    if(payload[key]===(key==='contactEmail'?(work[key]||''):work[key]))continue;
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label+' change';
    dd.textContent=key==='priceCents'?usd(work[key])+' → '+usd(payload[key]):(work[key]||'Not provided')+' → '+(payload[key]||'Not provided');changes.append(dt,dd);
   }
   if(changes.children.length)nodes.push(changes);
  }
  const delivery=work?.delivery||fileDescriptions.get($('original').files[0]);
  const inventory=delivery?window.deliveryDetails(delivery):null;
  if(inventory)inventory.open=true;
  $('summary').replaceChildren(...nodes,dl,...(inventory?[inventory]:[]),details,fullTerms);
  creatorPreviews.review();$('review-image').src=objectURL||work?.preview;$('review-image').alt=payload.title+' — buyer preview';
  $('review-delivery-file').textContent=work?work.specs:payload.original.name+' · '+(originalFile.size/1024/1024).toFixed(1)+' MB';
  setStage('review');document.querySelector('.review-content').scrollTop=0;$('confirm').checked=false;$('review-status').textContent='';window.scrollTo(0,0);$('review-title').focus({preventScroll:true});
 }catch(error){status(error.message);if(error.draftConflict)draftFailure(error,draftKey());if(error.field){$(error.field+'-file-error').textContent=error.message;$(error.field).setAttribute('aria-invalid','true');$(error.field).focus();if(error.field==='preview')$('preview-image').hidden=true;}}
});
$('edit').addEventListener('click',()=>{invalidate();setStage('edit');$('title').focus();});
async function retainOriginal(offer){
 if(!offer.originalFile)return;
 const ref=offer.payload.original,url='/api/creator/originals/'+ref.uploadSha,headers={'X-Creator-Code-Encoded':encodeURIComponent($('code').value)};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
 try{
  // Inspect the existing content address first: a missing response may already
  // have retained the exact file. Publication still uses its original request.
  const check=await fetch(url,{headers,signal:controller.signal});const current=await check.json();
  if(!check.ok)throw Object.assign(Error(current.error||'Could not check the original.'),{status:check.status});
  if(current.ready&&current.bytes===offer.originalFile.size)return;
  status('Uploading '+offer.originalFile.name+'…');
  const response=await fetch(url,{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream','X-Original-Name':encodeURIComponent(ref.name),'X-Original-Bytes':String(offer.originalFile.size)},body:offer.originalFile,signal:controller.signal});
  const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'Could not retain the original.'),{status:response.status});
  if(result.sha256!==ref.uploadSha||result.bytes!==offer.originalFile.size)throw Error('The original confirmation did not match your file.');
 }catch(error){
  if(!error.status)throw Object.assign(Error('Original upload confirmation did not arrive. Your reviewed offer is still here. Retry the same save to check its file first.'),{saveUnconfirmed:true});
  throw error;
 }finally{clearTimeout(timer);}
}

$('save').addEventListener('click',async()=>{
 try{await draftQueue;await draftStore('check',undefined,draftKey()).catch(error=>{if(error.draftConflict)throw error;});}catch(error){status(error.message);draftFailure(error,draftKey());return;}
 if(draftConflicts.has(draftKey()))return status('Choose which draft to keep before publishing.');
 if(!reviewed)return status('Review your current offer first.');
 if(!$('confirm').checked)return status('Confirm the terms and preview visibility before saving.');
 if(saving)return;saving=true;$('save').disabled=true;$('offer-form').inert=true;$('catalog-switcher').inert=true;$('edit').disabled=true;
 showAvailability();const offer=reviewed;let unconfirmed=false;$('save').textContent='Saving…';status('Saving your reviewed offer…');
 try{
  await retainOriginal(offer);
  const v=await api('/api/creator/catalog'+(offer.workId?'/'+encodeURIComponent(offer.workId):''),{...offer.payload,confirmed:true,creatorCode:$('code').value});
  let current=v.work,refreshFailed=false;
  try{
   const catalog=await api('/api/creator/catalog');works=catalog.works;
   const found=works.find(w=>w.id===v.work.id);if(found)current=found;else{refreshFailed=true;works.push(v.work);}
  }catch{refreshFailed=true;works=works.filter(w=>w.id!==v.work.id);works.push(v.work);}
  const newer=(current.offerRevision||1)>(v.work.offerRevision||1);
  await clearDraft(offer.workId);const otherDraftKept=draftConflicts.has(offer.workId?'edit:'+offer.workId:'new-work');
  saving=false;dirty=false;chooseWork(current);
  $('saved-title').textContent=current.offerStatus==='paused'?'Your offer is paused':'Your offer is in the catalog';
  $('saved-text').textContent=current.title+' · '+current.creator;
  $('open-work').href='/?work='+encodeURIComponent(current.id);$('open-work').hidden=current.offerStatus==='paused';$('saved-buyer-link').replaceChildren(...(current.offerStatus==='paused'?[]:[buyerLinkControl(current)]));setStage('saved');
  $('reload-current').hidden=!refreshFailed;
  status((refreshFailed?'Saved. Reload the current offer before making further changes.':newer?'Offer updated. Newer changes loaded.':offer.workId?'Offer updated.':'Saved.')+(otherDraftKept?' A newer unfinished draft was kept on this device.':''));
  $('saved').scrollIntoView({behavior:'smooth'});
 }catch(error){
  unconfirmed=!!error.saveUnconfirmed;
  if(error.status===409){$('reload-current').hidden=false;if(!offer.workId)$('reload-current').textContent='Open your catalog';}
  status(error.status===409?(offer.workId?'This offer changed in another window. Your edits are still here.':'This draft was already published with different details. Open your catalog before continuing.'):error.message);
  if(error.status===403){$('review-status').before($('code-field'));$('code-field').hidden=false;$('code').focus();$('code').select();}
 }finally{saving=false;$('save').disabled=false;$('save').textContent=unconfirmed?'Retry same save':offer.workId?'Update this offer':'Add to catalog';$('offer-form').inert=false;$('catalog-switcher').inert=false;$('edit').disabled=false;showAvailability();}
});
$('change-availability').addEventListener('click',async()=>{
 if(!editing||saving)return;
 const work=editing,target=work.offerStatus==='paused'?'active':'paused';
 if(!lifecyclePending){
  const question=target==='paused'?'Pause new requests for “'+work.title+'”? Existing approved agreements remain available.':'Reopen “'+work.title+'” for new requests with its currently published terms?';
  if(!window.confirm(question+(dirty?' Your unsaved field edits will stay here.':'')))return;
  lifecyclePending={requestId:crypto.randomUUID(),expectedOfferRevision:work.offerRevision||1,status:target};
 }
 const action=lifecyclePending;invalidate();
 saving=true;$('offer-form').inert=true;$('catalog-switcher').inert=true;$('review').inert=true;showAvailability();
 try{
  const result=await api('/api/creator/catalog/'+encodeURIComponent(work.id)+'/status',{...action,creatorCode:$('code').value,confirmed:true});
  let current=result.work,refreshFailed=false;
  try{const c=await api('/api/creator/catalog');works=c.works;const found=works.find(w=>w.id===work.id);if(found)current=found;else{refreshFailed=true;works.push(current);}}
  catch{refreshFailed=true;works=works.filter(w=>w.id!==work.id);works.push(current);}
  const kept=dirty;
  lifecyclePending=null;saving=false;
  if(kept){editing=result.work;invalidate();showMode();captureDraft();drawCatalog();}
  else chooseWork(current);
  const changedAgain=(current.offerRevision||1)>(result.work.offerRevision||1);
  $('reload-current').hidden=!(refreshFailed||changedAgain);
  if(kept&&changedAgain)$('editing-context').textContent+=' · A newer revision '+current.offerRevision+' is published';
  status((current.offerStatus==='paused'?'Offer paused.':'Offer reopened.')+(changedAgain?' A newer publication is available.':'')+(kept?' Unsaved field edits are still here.':'')+(refreshFailed?' Reload the current offer before making further changes.':''));
 }catch(error){
  if(error.status===409){lifecyclePending=null;$('reload-current').hidden=false;}
  status(error.status===409?'This offer changed in another window. Your edits are still here.':error.message);
 }finally{saving=false;$('offer-form').inert=false;$('catalog-switcher').inert=false;$('review').inert=false;showAvailability();}
});
$('reload-current').addEventListener('click',async()=>{
 if(saving)return;
 if(!editing){try{works=(await api('/api/creator/catalog')).works;await openCatalog();}catch(error){status(error.message);}return;}
 if(!window.confirm('Reload this published offer and replace your unsaved edits?'))return;
 try{
  const c=await api('/api/creator/catalog'),work=c.works.find(w=>w.id===editing.id);
  if(!work)throw Error('This work could not be reopened. Your edits are still here.');
  works=c.works.filter(w=>w.custom);await clearDraft(editing.id);dirty=false;chooseWork(work);status('Current offer loaded. Review your changes before updating.');
 }catch(error){status(error.message);}
});
let creatorStarting=false;
async function openCreatorStudio(){
 if(creatorStarting)return;
 const retrying=!$('creator-retry').hidden;
 creatorStarting=true;$('creator-retry').disabled=true;$('creator-startup-heading').hidden=true;
 $('creator-startup').dataset.failed=retrying?'true':'false';$('creator-loading').textContent='Loading your catalog…';status('');
 try{
  const [c,cfg,own,draft]=await Promise.all([api('/api/catalog'),api('/api/config'),api('/api/creator/catalog'),draftStore('all').catch(()=>[])]);
  draftRecord=null;editDrafts.clear();draftVersions.clear();
  for(const record of draft){
   if(record)draftVersions.set(record.work?.id?'edit:'+record.work.id:'new-work',draftToken(record));
   if(record?.version===1&&record.fields&&Array.isArray(record.permitted)){if(record.work?.id)editDrafts.set(record.work.id,record);else draftRecord=record;}
  }
  works=own.works;gallerySettings=own.settings;showGallerySettings();$('gallery-code-field').hidden=!cfg.creatorCodeRequired;$('studio-backup-code-field').hidden=!cfg.creatorCodeRequired;drawCatalog();
  $('policy').replaceChildren();
  for(const p of c.policy){const li=document.createElement('li');li.textContent=p.title+': '+p.text;$('policy').append(li);}
  $('code-field').hidden=!cfg.creatorCodeRequired;
  $('code-hint').textContent=cfg.creatorCodeRequired?'Required to save changes.':'';
  showMode();setStage(works.length?'catalog':'edit');$('creator-startup').hidden=true;$('offer-form').inert=false;$('add-catalog-work').disabled=false;
  if(!works.length&&draftRecord)resumeDraft();
  else if(retrying)$(works.length?'add-catalog-work':'original').focus({preventScroll:true});
 }catch(error){
  $('creator-startup').hidden=false;$('creator-startup').dataset.failed='true';$('creator-startup-heading').hidden=false;
  $('creator-loading').textContent='Check your connection, then try again. Saved drafts remain on this device.';
  $('creator-retry').hidden=false;$('review-offer').disabled=true;$('creator-retry').disabled=false;$('creator-retry').focus({preventScroll:true});
 }finally{creatorStarting=false;$('creator-retry').disabled=false;}
}
$('creator-retry').addEventListener('click',openCreatorStudio);
openCreatorStudio();
// A live price proof of this unsaved offer; approval remains the later explicit save.
const mediumNames={website:'Website / digital product',social:'Social campaign',print:'Printed publication'};
const usd=cents=>'USD '+(cents/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
function renderOffer(){
 try{const offered=licenseScope.offer({maxTermMonths:$('max-term-months').value,territory:$('offer-territory').value});$('proof-scope').textContent='Up to '+licenseScope.label(offered.maxTermMonths)+' · '+offered.territory;}catch{$('proof-scope').textContent='Enter the duration and territory you can offer.';}
 const print=$('print').checked,limit=Number($('copies').value),price=Number($('price').value),cents=Math.round(price*100);
 const validPrice=$('price').value!==''&&$('price').validity.valid;
 const validLimit=Number.isSafeInteger(limit)&&limit>0&&limit<=1000000;
 $('print-settings').hidden=!print;$('copies').required=print;$('copies').disabled=!print;
 $('print-calculator').hidden=!print;
 $('print-error').textContent=print&&!validLimit?'Enter the largest print run you permit before reviewing.':'';
 const selected=[...document.querySelectorAll('[name=medium]:checked')].map(x=>x.value);
 $('offer-proof-empty').hidden=validPrice&&selected.length>0;
 const rows=[];
 if(validPrice)for(const medium of selected){
  const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=mediumNames[medium];
  dd.textContent=medium==='print'?(validLimit?usd(licensePrice.calculate({priceCents:cents},{medium:'print',copies:1}).totalCents)+' for 1–'+Math.min(limit,500).toLocaleString('en-US')+' copies; '+usd(licensePrice.calculate({priceCents:cents},{medium:'print',copies:limit}).totalCents)+' at your '+limit.toLocaleString('en-US')+'-copy limit':'Set a copy limit'):usd(cents);
  rows.push(dt,dd);
 }
 $('offer-prices').replaceChildren(...rows);
 const copies=Number($('example-copies').value),validCopies=Number.isSafeInteger(copies)&&copies>0&&copies<=1000000;
 let result='Enter a base price and copy limit to inspect a print quote.';
 if(validPrice&&validLimit){
  result=!validCopies?'Enter a whole number of copies.':copies>limit?'Outside your offer: '+copies.toLocaleString('en-US')+' copies exceeds your '+limit.toLocaleString('en-US')+'-copy limit.':
   usd(licensePrice.calculate({priceCents:cents},{medium:'print',copies}).totalCents)+' total = '+usd(cents)+' base + '+usd(licensePrice.calculate({priceCents:cents},{medium:'print',copies}).printCents)+' print fee.';
 }
 $('example-price').textContent=result;
 $('example-price').classList.toggle('outside',validLimit&&validCopies&&copies>limit);
}
$('example-copies').addEventListener('input',renderOffer);
renderOffer();

$('edit-saved').addEventListener('click',()=>{dirty=false;chooseWork(editing);status('');});
$('new-offer').addEventListener('click',()=>{dirty=false;chooseWork(null);status('');});
