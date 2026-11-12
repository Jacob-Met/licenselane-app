'use strict';
// Keep the long, artwork-led desk navigable without changing the buyer's draft.
(() => {
 const nav=document.querySelector('.desk-nav');
 const links=[...nav.querySelectorAll('a')];
 const destinations=links.map(link=>document.querySelector(link.getAttribute('href')));
 function sync(){
  document.body.classList.toggle('has-current-review',!document.getElementById('result-section').hidden);
  links.forEach((link,i)=>{link.hidden=destinations[i].hidden;});
  const visible=destinations.filter(section=>!section.hidden&&section.getClientRects().length);
  // The gallery navigation scrolls out of view; its negative bottom must not
  // move the section threshold above the viewport.
  const threshold=Math.max(0,nav.getBoundingClientRect().bottom)+24;
  const focused=document.activeElement,focusRect=focused?.getBoundingClientRect();
  const focusedSection=focusRect&&focusRect.bottom>0&&focusRect.top<innerHeight
   ?visible.find(section=>section.contains(focused)):null;
  const current=focusedSection||[...visible].reverse().find(section=>section.getBoundingClientRect().top<=threshold)||visible[0];
  links.forEach((link,i)=>{if(destinations[i]===current)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
 }
 const observer=new MutationObserver(sync);
 destinations.forEach(section=>observer.observe(section,{attributes:true,attributeFilter:['hidden']}));
 links.forEach((link,i)=>link.addEventListener('click',()=>{if(destinations[i].id==='result-section')document.body.classList.add('reviewing-proposal');else document.body.classList.remove('reviewing-proposal');if(destinations[i].id!=='checkout-section')document.body.classList.remove('paid-record-view');else if(state.license)document.body.classList.add('paid-record-view');destinations[i].focus({preventScroll:true});}));
 let scheduled=false;
 window.addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;sync();});}},{passive:true});
 document.addEventListener('focusin',()=>requestAnimationFrame(sync));
 window.addEventListener('resize',sync);
 window.addEventListener('licenselane:viewchange',sync);
 sync();
})();

document.querySelectorAll('.desk-tools a[href^="#"]').forEach(link=>link.addEventListener('click',()=>{const target=document.querySelector(link.getAttribute('href'));if(target){target.open=true;target.querySelector('summary')?.focus({preventScroll:true});}}));

// The catalog is one radio group, including works added by the creator.
(() => {
 const group=document.getElementById('works');
 if(!group)return;
 const radios=()=>[...group.querySelectorAll('.work[role="radio"]')].filter(button=>!button.disabled&&!button.hidden);
 function syncTabStop(){
  const items=radios(),selected=items.find(button=>button.getAttribute('aria-checked')==='true')||items[0];
  for(const button of group.querySelectorAll('.work[role="radio"]'))button.tabIndex=button===selected?0:-1;
 }
 group.addEventListener('keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey)return;
  const current=event.target.closest('.work[role="radio"]'),items=radios(),index=items.indexOf(current);
  if(index<0)return;
  let next;
  switch(event.key){
   case 'ArrowRight':case 'ArrowDown':next=(index+1)%items.length;break;
   case 'ArrowLeft':case 'ArrowUp':next=(index+items.length-1)%items.length;break;
   case 'Home':next=0;break;
   case 'End':next=items.length-1;break;
   default:return;
  }
  event.preventDefault();
  // Use the normal selection path so stale review/checkout is invalidated exactly once.
  // That handler redraws every radio and restores focus to the new selected button.
  if(items[next]!==current)items[next].click();
  else current.focus();
  syncTabStop();
 });
 new MutationObserver(syncTabStop).observe(group,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-checked','disabled','hidden']});
 syncTabStop();
})();

// Records are a destination; opening one still uses the normal read-only resume path.
(() => {
 const vault=document.getElementById('vault');
 function syncRecords(){
  const active=location.hash==='#vault'&&!document.body.classList.contains('recovery-desk');
  const wasActive=document.body.classList.contains('buyer-records-view');
  document.body.classList.toggle('buyer-records-view',active);
  if(active){
   document.body.classList.remove('paid-record-view','reviewing-proposal','creator-inbox-view');
   vault.open=true;
   if(!wasActive&&typeof refreshRecords==='function')refreshRecords();
   requestAnimationFrame(()=>vault.scrollIntoView({block:'start'}));
  }
 }
 window.addEventListener('hashchange',syncRecords);
 window.addEventListener('licenselane:viewchange',syncRecords);
 vault.addEventListener('toggle',()=>{if(vault.open&&!document.body.classList.contains('recovery-desk')&&location.hash!=='#vault'&&!document.body.classList.contains('paid-record-view')&&!document.body.classList.contains('creator-inbox-view'))location.hash='#vault';});
 syncRecords();
})();
