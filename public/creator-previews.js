'use strict';
window.creatorPreviews=(()=>{
 const get=id=>document.getElementById(id),input=get('additional-previews'),list=get('preview-gallery'),message=get('preview-gallery-status');
 let entries=[],urls=[],version=0,changed=false,pending=false;
 const changedEvent=()=>get('offer-form').dispatchEvent(new Event('input',{bubbles:true}));
 function dispose(){urls.forEach(URL.revokeObjectURL);urls=[];}
 function source(entry){if(entry.file){const url=URL.createObjectURL(entry.file);urls.push(url);return url;}return entry.url;}
 function render(){
  dispose();list.replaceChildren();
  entries.forEach((entry,index)=>{
   const row=document.createElement('li'),image=document.createElement('img');image.src=source(entry);image.alt='Additional preview '+(index+1);
   const name=document.createElement('span');name.textContent=entry.file?.name||'Published view '+entry.existingIndex;
   const actions=document.createElement('div');
   for(const [label,delta]of [['Move earlier',-1],['Move later',1],['Remove',0]]){
    const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=label;button.setAttribute('aria-label',label+' preview '+(index+1));button.disabled=delta!==0&&(index+delta<0||index+delta>=entries.length);
    button.addEventListener('click',()=>{if(delta)[entries[index],entries[index+delta]]=[entries[index+delta],entries[index]];else entries.splice(index,1);version++;changed=true;render();changedEvent();list.querySelectorAll('button')[Math.min(index,entries.length-1)*3]?.focus();});actions.append(button);
   }
   row.append(image,name,actions);list.append(row);
  });input.disabled=entries.length>=5||pending;
 }
 input.addEventListener('change',async()=>{
  const selected=[...input.files];input.value='';const started=++version;pending=true;render();message.textContent='Checking preview images…';
  try{
   if(entries.length+selected.length>5)throw Error('Choose up to five additional views.');
   let total=entries.reduce((n,e)=>n+(e.file?.size||0),0);
   for(const file of selected){
    if(!['image/png','image/jpeg'].includes(file.type)||file.size>2*1024*1024)throw Error('Each additional view must be a PNG or JPEG up to 2 MB.');
    total+=file.size;if(total>6*1024*1024)throw Error('Additional views must total 6 MB or less.');
    let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw Error('Could not open '+file.name+'. Choose another PNG or JPEG.');}finally{bitmap?.close();}
   }
   if(version!==started)return;
   entries.push(...selected.map(file=>({file})));changed=true;message.textContent='';changedEvent();
  }catch(error){if(version===started)message.textContent=error.message;}
  finally{if(version===started){pending=false;render();}}
 });
 function reset(work){version++;pending=false;changed=false;entries=(work?.previews||[]).slice(1).map((url,index)=>({url,existingIndex:index+1}));message.textContent='';render();}
 function restore(value){if(!value)return;version++;pending=false;entries=(value.entries||[]).map(entry=>({...entry}));changed=!!value.changed;render();}
 async function payload(){
  if(pending)throw Error('Wait for the selected previews to finish checking.');
  if(!changed)return undefined;
  return Promise.all(entries.map(async entry=>{
   if(!entry.file)return {existingIndex:entry.existingIndex};
   const buffer=new Uint8Array(await entry.file.arrayBuffer());let binary='';for(let n=0;n<buffer.length;n+=8192)binary+=String.fromCharCode(...buffer.subarray(n,n+8192));
   return {name:entry.file.name,data:btoa(binary)};
  }));
 }
 function review(){
  const box=get('review-gallery');box.replaceChildren();box.hidden=!entries.length;
  entries.forEach((entry,index)=>{const image=document.createElement('img');image.src=source(entry);image.alt='Additional buyer preview '+(index+1);box.append(image);});
 }
 return {reset,restore,capture:()=>({entries:entries.map(entry=>({...entry})),changed}),payload,changed:()=>changed,review,count:()=>entries.length};
})();
