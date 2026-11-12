'use strict';
// Observe only the buyer's currently open, still-waiting proposal. Decisions
// never create checkout, accept revised terms, or reclaim an abandoned view.
(() => {
 const interval=5000,maxBackoff=30000;
 let watch=null,timer=null,controller=null,failures=0;
 function waiting(){return state.license?.status==='requested'&&!state.creatorReviewRecordId&&!state.config?.recoveryOnly&&document.body.classList.contains('paid-record-view')&&!state.revisionOf;}
 function current(value){return watch===value&&waiting()&&state.license===value.license&&recordReadGeneration===value.generation;}
 function available(value){return current(value)&&!document.hidden&&navigator.onLine!==false;}
 function visible(value){return available(value)&&!checkoutPending.has(value.license.id)&&!document.querySelector('.creator-controls[open],dialog[open]');}
 function cancel(){clearTimeout(timer);timer=null;if(controller){controller.abort();controller=null;}}
 function notice(message){
  let node=document.getElementById('buyer-decision-connection');
  if(!message){node?.remove();return;}
  if(!node){node=el('p','muted');node.id='buyer-decision-connection';node.setAttribute('role','status');document.querySelector('#checkout .record-state-row')?.after(node);}
  node.textContent=message;
 }
 function schedule(delay=interval){clearTimeout(timer);timer=null;if(watch&&available(watch)&&!controller)timer=setTimeout(read,delay);}
 function applyDecision(data){
  const active=document.activeElement,checkout=document.getElementById('checkout');
  const selected=active?.matches('input[readonly],textarea[readonly]')&&checkout.contains(active)?{label:active.getAttribute('aria-label'),value:active.value,start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection,top:active.getBoundingClientRect().top}:null;
  const generation=recordReadGeneration;
  state.license=data.license;state.certificate=data.certificate||null;state.restored=true;
  rememberLicense(data.license);displayLicense(false);
  if(!selected?.label)return;
  const target=[...checkout.querySelectorAll('input[readonly],textarea[readonly]')].find(field=>field.getAttribute('aria-label')===selected.label);
  if(!target)return;let restored=false;
  function restore(){
   if(restored||state.license!==data.license||recordReadGeneration!==generation||!target.isConnected||target.value!==selected.value||![document.body,target].includes(document.activeElement))return;
   restored=true;target.focus({preventScroll:true});target.setSelectionRange(selected.start,selected.end,selected.direction);
   window.scrollBy({top:target.getBoundingClientRect().top-selected.top,behavior:'instant'});
  }
  const disclosure=target.closest('details');
  if(disclosure&&!disclosure.open){disclosure.addEventListener('toggle',restore,{once:true});disclosure.open=true;}
  restore();
 }
 async function read(){
  timer=null;const observed=watch;if(!observed||!available(observed)||controller)return;
  // A preview or an in-flight action pauses reads, not the waiting record.
  if(!visible(observed)){schedule();return;}
  const request=new AbortController();controller=request;let timedOut=false;
  const timeout=setTimeout(()=>{timedOut=true;request.abort();},8000);
  try{
   const summary=await api('/api/licenses/'+observed.license.id+'/status',undefined,{signal:request.signal});
   if(!visible(observed))return;
   if(summary?.id!==observed.license.id||typeof summary.status!=='string')throw Error('Saved proposal mismatch');
   if(summary.status!==observed.license.status){
    const data=await api('/api/licenses/'+observed.license.id,undefined,{signal:request.signal});
    if(!visible(observed))return;
    if(data?.license?.id!==observed.license.id)throw Error('Saved proposal mismatch');
    failures=0;notice('');
    if(data.license.status===observed.license.status)return;
    applyDecision(data);
   }else{failures=0;notice('');}
  }catch(error){
   if(visible(observed)&&(!request.signal.aborted||timedOut)){failures++;notice('Connection unavailable · retrying the creator decision');}
  }finally{
   clearTimeout(timeout);if(controller===request)controller=null;
   if(current(observed))schedule(Math.min(maxBackoff,interval*2**Math.min(failures,3)));
  }
 }
 function arm(){
  if(!waiting()){cancel();watch=null;failures=0;return;}
  if(!watch||watch.license!==state.license||watch.generation!==recordReadGeneration){cancel();watch={license:state.license,generation:recordReadGeneration};failures=0;}
  sync();
 }
 function sync(immediate=false){
  if(!watch)return;
  if(!current(watch)){cancel();watch=null;return;}
  if(!available(watch)){cancel();return;}
  if(!visible(watch)){cancel();schedule();return;}
  if(immediate&&!controller)schedule(0);else if(!timer&&!controller)schedule();
 }
 window.addEventListener('licenselane:viewchange',arm);
 window.addEventListener('hashchange',()=>sync());
 window.addEventListener('online',()=>sync(true));
 window.addEventListener('offline',()=>sync());
 document.addEventListener('visibilitychange',()=>sync(!document.hidden));
 document.addEventListener('close',()=>sync(true),true);
 document.getElementById('checkout').addEventListener('toggle',()=>sync(),true);
 new MutationObserver(()=>sync()).observe(document.body,{attributes:true,attributeFilter:['class']});
 // Navigation/read generations are captured only when a record is displayed;
 // visibility or network recovery cannot revive an obsolete destination.
 arm();
})();
