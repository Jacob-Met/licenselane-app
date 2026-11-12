'use strict';
// Compare persisted agreements, never the mutable request form or today's catalog.
function revisionComparison(previous,current){
 if(!previous?.request||!previous?.quote||!current?.request||!current?.quote||previous.id!==(current.revisionOf?.id||current.replaces?.id))throw Error('The original proposal could not be verified.');
 const formatAmount=q=>Number.isSafeInteger(q.priceCents)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(q.priceCents/100):'Not recorded';
 const yes=v=>v===true?'Requested':v===false?'Not requested':'Not recorded';
 const rows=[
  ['Amount',formatAmount(previous.quote),formatAmount(current.quote)],
  ['Work',previous.quote.assetTitle,current.quote.assetTitle],
  ['Creator',previous.quote.creator,current.quote.creator],
  ['Licensee',previous.request.licensee,current.request.licensee],
  ['Project',previous.request.project,current.request.project],
  ...(previous.request.brief||current.request.brief?[['Buyer brief',previous.request.brief||'Not supplied',current.request.brief||'Not supplied']]:[]),
  ['Medium',previous.request.medium,current.request.medium],
  ['Physical copies',previous.request.copies,current.request.copies],
  ['Term',previous.quote.term,current.quote.term],
  ...(previous.quote.period||current.quote.period?[['Start date',previous.quote.period?.startsOn,current.quote.period?.startsOn],['Last included date',previous.quote.period?.endsOn,current.quote.period?.endsOn]]:[]),
  ['Territory',previous.quote.territory,current.quote.territory],
  ['Attribution',yes(previous.request.attribution),yes(current.request.attribution)],
  ['Exclusivity',yes(previous.request.exclusive),yes(current.request.exclusive)],
  ['AI training',yes(previous.request.training),yes(current.request.training)],
  ['Policy version',previous.quote.policyVersion,current.quote.policyVersion],
  ['Retained file SHA-256',previous.assetDelivery?.sha256,current.assetDelivery?.sha256]
 ];
 return rows.map(([label,before,after])=>({label,before:String(before??'Not recorded'),after:String(after??'Not recorded'),changed:before!==after}));
}
function appendRevisionComparison(current,container){
 const section=el('section','revision-comparison');section.setAttribute('aria-label','Changes from the original proposal');
 const heading=el('h5','','What changed from the original');
 const content=el('div'),status=el('p','muted','Loading the saved original for comparison…');status.setAttribute('role','status');
 section.append(heading,content,status);container.append(section);
 const renderRows=rows=>{const list=el('dl','comparison-rows');for(const row of rows){const group=el('div',row.changed?'comparison-row changed':'comparison-row');if(row.label==='Buyer brief')group.classList.add('comparison-brief');group.append(el('dt','',row.label));for(const [label,value] of [['Previous',row.before],['Revised',row.after]]){const entry=el('dd');entry.append(el('span','comparison-label',label),Object.assign(el('span','comparison-value',value),row.label==='Buyer brief'?{tabIndex:0}:{}));group.append(entry);}list.append(group);}return list;};
 async function load(){
  status.textContent='Loading the saved original for comparison…';content.replaceChildren();
  try{
   const data=await api('/api/licenses/'+(current.revisionOf?.id||current.replaces?.id));
   if(!section.isConnected||state.license?.id!==current.id)return;
   const rows=revisionComparison(data.license,current),changed=rows.filter(r=>r.changed),same=rows.filter(r=>!r.changed);
   content.append(el('p','comparison-intro',changed.length+' recorded '+(changed.length===1?'term changed':'terms changed')+'. The original remains unchanged. This comparison does not approve a proposal or activate rights.'));
   // Keep the amount visible even when a wording/scope correction has the same price.
   content.append(renderRows(rows.filter(r=>r.changed||r.label==='Amount')));
   const remaining=same.filter(r=>r.label!=='Amount');
   if(remaining.length){const details=el('details','comparison-unchanged');details.append(el('summary','',remaining.length+' unchanged terms'),renderRows(remaining));content.append(details);}
   status.textContent='Compared the two saved records. Current decision: '+current.status.replaceAll('_',' ')+'.';
  }catch(error){
   if(!section.isConnected||state.license?.id!==current.id)return;
   status.textContent='Comparison unavailable. The original record could not be loaded or verified; the revised terms below remain available.';
   const retry=el('button','secondary','Retry comparison');retry.type='button';retry.addEventListener('click',load);content.append(retry);
  }
 }
 load();
}
if(typeof module!=='undefined')module.exports={revisionComparison};
