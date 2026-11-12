'use strict';
(()=>{
 const group=document.getElementById('works'),tools=document.getElementById('catalog-tools'),search=document.getElementById('catalog-search'),count=document.getElementById('catalog-count'),clear=document.getElementById('catalog-clear');
 if(!group||!tools)return;
 const scope=document.getElementById('scope-section'),context=document.createElement('a');
 context.className='scope-work';context.href='#work-section';context.hidden=true;
 scope?.querySelector('.step-head')?.after(context);
 context.addEventListener('click',()=>document.getElementById('work-section').focus({preventScroll:true}));
 let contextKey='';
 function selectedContext(){
  const work=state.catalog?.works.find(item=>item.id===state.selected);
  if(!work){context.hidden=true;contextKey='';return;}
  const key=JSON.stringify([work.id,work.title,work.preview,work.priceCents,work.offerStatus]);
  if(key===contextKey)return;contextKey=key;
  const image=document.createElement('img');image.src=work.preview;image.alt='';
  const text=document.createElement('span'),title=document.createElement('strong'),price=document.createElement('small'),change=document.createElement('span');
  title.textContent=work.title;price.textContent=work.offerStatus==='paused'?'Offer paused':'From '+money(work.priceCents);text.append(title,price);
  change.className='scope-work-change';change.textContent='Change artwork';
  context.replaceChildren(image,text,change);context.setAttribute('aria-label','Change artwork, '+work.title+', '+price.textContent);context.hidden=false;
 }

 const briefInput=document.getElementById('project-brief');
 const workDialog=document.createElement('dialog');workDialog.className='brief-work-dialog';workDialog.id='brief-work-dialog';workDialog.setAttribute('aria-labelledby','brief-work-title');
 const heading=document.createElement('h2');heading.id='brief-work-title';heading.textContent='Choose the artwork';heading.tabIndex=-1;
 const workChoices=document.createElement('div');workChoices.className='brief-work-choices';
 const back=document.createElement('button');back.type='button';back.className='brief-work-back';back.textContent='Back to brief';
 workDialog.append(heading,workChoices,back);document.body.append(workDialog);
 back.addEventListener('click',()=>workDialog.close());
 const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu,' ').trim();
 const word=character=>!!character&&/[\p{L}\p{N}_]/u.test(character);
 function mentionsTitle(text,title){
  if(!title)return false;
  let start=text.indexOf(title);
  while(start!==-1){
   const end=start+title.length;
   if(!word(text[start-1])&&!word(text[end]))return true;
   start=text.indexOf(title,start+1);
  }
  return false;
 }
 function namedWorks(){
  const text=normalize(briefInput.value);
  return (state.catalog?.works||[]).filter(work=>mentionsTitle(text,normalize(work.title)));
 }
 function choiceKey(){
  return JSON.stringify([state.selected,briefInput.value,namedWorks().map(work=>[work.id,work.title,work.offerStatus])]);
 }
 let acknowledgedWork='';
 // A title mention is a reason to ask, never permission to choose an artwork.
 window.confirmBriefArtwork=async()=>{
  const current=state.catalog?.works.find(work=>work.id===state.selected);
  // A same-title catalog copy does not contradict the buyer's explicit selection.
  // Retain its exact ID; only a differently named artwork needs another choice.
  const named=namedWorks().filter(work=>work.id!==state.selected&&normalize(work.title)!==normalize(current?.title));
  if(!current||!named.length||choiceKey()===acknowledgedWork)return true;
  if(workDialog.open)return false;
  const originalWork=state.selected,originalBrief=briefInput.value;
  let accepted=false;
  workChoices.replaceChildren();
  for(const work of [current,...named]){
   const option=document.createElement('button');option.type='button';option.className='brief-work-option';option.dataset.workId=work.id;
   const image=document.createElement('img');image.src=work.preview;image.alt='';
   const words=document.createElement('span'),context=document.createElement('small'),title=document.createElement('strong'),creator=document.createElement('span');
   const selected=work.id===originalWork;
   context.textContent=work.offerStatus==='paused'?'Offer paused':selected?'Currently selected':'Named in your brief';
   title.textContent=(selected?'Keep ':'Use ')+work.title;creator.className='brief-work-creator';creator.textContent=work.creator;
   words.append(context,title,creator);option.append(image,words);
   option.disabled=work.offerStatus==='paused';
   option.addEventListener('click',()=>{
    if(state.selected!==originalWork||briefInput.value!==originalBrief){workDialog.close();return;}
    const index=state.catalog.works.findIndex(item=>item.id===work.id),live=state.catalog.works[index];
    if(!live||live.offerStatus==='paused'){workDialog.close();return;}
    if(work.id!==state.selected){
     const existing=group.children[index];
     if(!existing||existing.disabled){workDialog.close();return;}
     existing.click();
    }
    accepted=state.selected===work.id;
    if(accepted)acknowledgedWork=choiceKey();
    workDialog.close();
   });
   workChoices.append(option);
  }
  return new Promise(resolve=>{
   workDialog.addEventListener('close',()=>resolve(accepted),{once:true});
   workDialog.showModal();heading.focus({preventScroll:true});
  });
 };

 function filter(){
  selectedContext();
  const works=state.catalog?.works||[],query=search.value.trim().toLocaleLowerCase(),terms=query.split(/\s+/).filter(Boolean);
  tools.hidden=works.length<=3&&!query;
  let visible=0;
  [...group.children].forEach((button,index)=>{
   const work=works[index];if(!work)return;
   const text=[work.title,work.creator,work.kind,work.description,...(work.permitted||[])].join(' ').toLocaleLowerCase();
   const matches=terms.every(term=>text.includes(term));
   if(button.hidden===matches)button.hidden=!matches;
   if(matches)visible++;
  });
  count.textContent=query?(visible?`${visible} of ${works.length} works`:'No matching artwork'):`${works.length} works`;
  clear.hidden=!query;
  const selected=group.querySelector('.work[aria-checked="true"]:not([hidden])');
  if(selected){const item=selected.getBoundingClientRect(),box=group.getBoundingClientRect();if(item.left<box.left)group.scrollLeft-=box.left-item.left;else if(item.right>box.right)group.scrollLeft+=item.right-box.right;}

 }
 tools.addEventListener('toggle',()=>{if(tools.open)search.focus({preventScroll:true});});
 search.addEventListener('input',filter);
 clear.addEventListener('click',()=>{search.value='';filter();search.focus();});
 new MutationObserver(filter).observe(group,{childList:true});
 new ResizeObserver(filter).observe(group);
 filter();
})();
