'use strict';
// Bring the existing read-only creator handoff forward for the buyer who saved it.
(()=>{
 const checkout=document.getElementById('checkout');
 if(!checkout)return;
 function arrange(){
  const license=state.license,box=checkout.querySelector('.state-card');
  if(!box||license?.status!=='requested'||state.creatorReviewRecordId===license.id||!state.buyerAccess.has(license.id))return;
  const share=box.querySelector('.record-handoff:not(.buyer-continuation)');
  if(!share||share.dataset.promoted)return;
  share.dataset.promoted='true';share.open=true;share.classList.add('proposal-handoff');
  share.querySelector('summary+p')?.remove();
  const summary=share.querySelector('summary');summary.textContent='Send your request to the creator';
  const copy=share.querySelector('button');if(copy){copy.textContent='Copy link for creator';copy.classList.remove('secondary');copy.classList.add('primary');}
  const contact=window.recordHandoff.contact(license);
  if(contact){
   share.querySelector('summary').after(contact);
   if(copy){
    copy.classList.remove('primary');copy.classList.add('secondary');
    const fallback=document.createElement('details');fallback.className='creator-contact-fallback';
    const heading=document.createElement('summary');heading.textContent='Copy request link instead';fallback.append(heading);
    const label=share.querySelector('label'),feedback=share.querySelector('[role=status]');
    fallback.append(label,copy);if(feedback)fallback.append(feedback);contact.after(fallback);
   }
  }
  const amount=box.querySelector('.record-amount');if(amount)amount.after(share);
  for(const button of box.querySelectorAll('.actions>button'))if(button.textContent==='Refresh approval status')button.classList.add('secondary');
 }
 new MutationObserver(arrange).observe(checkout,{childList:true,subtree:true});
 arrange();
})();
