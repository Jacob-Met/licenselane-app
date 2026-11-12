'use strict';
function issuedRegisterCSV(items){
 const cell=value=>{let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const header=['License reference','Project','Licensee','Work','Use','Physical copies','Duration','Territory','Approved amount USD','Proposal created','Payment status','Start date (UTC)','Last included date (UTC)'];
 const rows=items.map(item=>[item.id,item.project,item.licensee,item.work,item.medium,item.copies,item.term,item.territory,(item.priceCents/100).toFixed(2),item.createdAt,'Verified Sandbox',item.period?.startsOn,item.period?.endsOn]);
 return '\uFEFF'+[header,...rows].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
function initializeCreatorInbox(){
 const box=el('details','vault creator-inbox');box.id='creator-inbox';
 const summary=el('summary','','Creator review inbox');
 const destination=el('header','inbox-destination-header'),destinationTitle=el('h1','','Creator inbox');destinationTitle.id='creator-inbox-title';
 const destinationNav=el('nav');destinationNav.setAttribute('aria-label','Creator workspace');
 const catalogLink=el('a','','Catalog');catalogLink.href='/creator.html';const buyerLink=el('a','','Buyer desk');buyerLink.href='#work-section';destinationNav.append(catalogLink,buyerLink);destination.append(destinationTitle,destinationNav);
 const defaultTitle=document.title;
 function syncDestination(){
  const atInbox=location.hash==='#creator-inbox';
  // An explicit inbox URL wins over automatic restoration of a buyer record.
  if(atInbox&&document.body.classList.contains('paid-record-view')&&!state.creatorReviewRecordId)document.body.classList.remove('paid-record-view');
  const active=atInbox&&!document.body.classList.contains('paid-record-view');
  document.body.classList.toggle('creator-inbox-view',active);
  $('desk').setAttribute('aria-labelledby',active?'creator-inbox-title':'desk-title');
  document.title=active?'Creator inbox — LicenseLane':defaultTitle;
 }
 window.addEventListener('licenselane:viewchange',syncDestination);
 box.addEventListener('toggle',()=>{if(box.open&&!document.body.classList.contains('paid-record-view')&&location.hash!=='#creator-inbox')location.hash='#creator-inbox';});
 const form=el('form','inbox-form'),codeLabel=el('label','','Creator code'),code=el('input');code.type='password';code.autocomplete='off';code.id='inbox-code';codeLabel.htmlFor=code.id;codeLabel.append(code);
 const access=el('details','inbox-access');access.open=true;const accessTitle=el('summary','','Creator access');access.append(accessTitle,codeLabel);
 const searchLabel=el('label','','Search requests'),search=el('input');search.type='search';search.placeholder='Project, buyer, work or scope';search.maxLength=100;search.id='inbox-search';searchLabel.htmlFor=search.id;searchLabel.append(search);
 const filterLabel=el('label','','Show'),filter=el('select');filter.id='inbox-filter';filterLabel.htmlFor=filter.id;
 for(const [value,text] of [['requested','Needs creator decision'],['changes_requested','Waiting for buyer correction'],['approved','Approved, not yet checked out'],['awaiting_payment','Waiting for buyer payment'],['payment_attention','Payment needs review'],['issued','Issued licenses'],['all','All saved records']]){const option=el('option','',text);option.value=value;filter.append(option);}filterLabel.append(filter);
 const actions=el('div','actions inbox-toolbar'),refresh=el('button','secondary','Refresh inbox'),clear=el('button','secondary','Clear inbox and code');refresh.type='submit';clear.type='button';const exportIssued=el('button','secondary','Export issued matches (CSV)');exportIssued.type='button';actions.append(refresh);access.append(clear);exportIssued.hidden=true;
 const status=el('p','muted','No server records have been loaded.'),rows=el('div','inbox-list'),more=el('button','secondary','Load more');status.setAttribute('role','status');more.type='button';more.hidden=true;
 const filters=el('div','inbox-filters');filters.append(searchLabel,filterLabel,actions);form.append(access,filters);box.append(summary,destination,form,status,rows,more,exportIssued);$('vault').after(box);
 let version=0,cursor=null,loaded=0,busy=false;
 exportIssued.addEventListener('click',async()=>{
  if(busy)return;busy=true;refresh.disabled=true;more.disabled=true;exportIssued.disabled=true;
  const expected=++version,creatorCode=code.value,query=search.value;status.textContent='Preparing issued-license register…';
  try{
   const items=[];let next=null;
   do{const data=await api('/api/creator/inbox',{creatorCode,query,status:'issued',...(next?{cursor:next}:{})});if(expected!==version)return;items.push(...data.items);next=data.nextCursor;}while(next);
   if(!items.length){status.textContent='No issued licenses match this search. No CSV was created.';return;}
   const url=URL.createObjectURL(new Blob([issuedRegisterCSV(items)],{type:'text/csv;charset=utf-8'})),link=el('a');link.href=url;link.download='LicenseLane-issued-licenses.csv';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
   status.textContent='Exported '+items.length+' issued Sandbox licenses'+(query.trim()?' matching “'+query.trim()+'”':'')+'. The CSV contains saved terms, not a payout or tax statement.';
  }catch(e){if(expected===version)status.textContent='Register not exported: '+e.message;}finally{busy=false;refresh.disabled=false;more.disabled=false;exportIssued.disabled=false;}
 });
 function openFromLink(){syncDestination();if(location.hash==='#creator-inbox'){box.open=true;box.scrollIntoView({block:'start'});(access.open?code:search).focus({preventScroll:true});}}
 window.addEventListener('hashchange',openFromLink);openFromLink();
 function invalidate(){version++;more.hidden=true;status.textContent='Filters changed. Refresh the inbox to apply them.';}
 search.addEventListener('input',invalidate);filter.addEventListener('change',()=>{invalidate();exportIssued.hidden=filter.value!=='issued';});code.addEventListener('input',()=>{accessTitle.textContent='Creator access';invalidate();});
 clear.addEventListener('click',()=>{version++;access.open=true;accessTitle.textContent='Creator access';code.value='';search.value='';rows.replaceChildren();more.hidden=true;cursor=null;loaded=0;status.textContent='Inbox and creator code cleared from this page.';});
 function render(item){
  const row=el('article','inbox-row'),art=el('img','inbox-art');art.src='/api/licenses/'+item.id+'/preview';art.alt=item.work+' — saved preview';art.loading='lazy';art.addEventListener('error',()=>{art.hidden=true;row.classList.add('inbox-no-preview');},{once:true});
  const content=el('div','inbox-request'),heading=el('div','inbox-request-heading');heading.append(el('h3','',item.project),el('strong','inbox-price',money(item.priceCents)));
  const identity=el('p','inbox-identity',item.licensee+' · '+item.work);
  const medium={website:'Website / digital product',social:'Social campaign',print:'Printed publication'}[item.medium]||item.medium;
  const scope=el('p','inbox-scope',[medium,...(item.medium==='print'?[Number(item.copies).toLocaleString()+' copies']:[]),item.term||'Duration not recorded',item.territory||'Territory not recorded'].join(' · '));
  const labels={withdrawn:'Withdrawn by buyer',superseded:'Replaced by buyer',requested:'Needs decision',changes_requested:'Buyer correction requested',approved:'Approved · awaiting checkout',awaiting_payment:'Awaiting payment',creating_order:'Order in progress',order_unknown:'Order needs review',capture_unknown:'Payment needs review',issued:'Issued'};
  const metadata=el('div','inbox-meta');metadata.append(el('span','inbox-state',labels[item.status]||item.status.replaceAll('_',' ')),el('span','',new Date(item.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})+((item.revisionOf||item.replaces)?' · Corrected proposal':'')));
  const open=el('button',item.status==='requested'?'':'secondary',item.status==='requested'?'Review request':item.status==='issued'?'View license':'Open saved record');open.type='button';
  open.addEventListener('click',async()=>{open.disabled=true;try{await openLicense(item.id,true,'creator');}catch(e){status.textContent=e.message;}finally{open.disabled=false;}});
  content.append(heading,identity,scope,metadata);
  if(['creating_order','order_unknown','capture_unknown'].includes(item.status))content.append(el('p','inbox-attention','Inspect the existing payment before retrying.'));
  content.append(open);row.append(art,content);return row;
 }
 async function load(append){
  if(busy)return;busy=true;refresh.disabled=true;more.disabled=true;const expected=++version;
  if(!append){rows.replaceChildren();loaded=0;cursor=null;}more.hidden=true;status.textContent='Loading creator records…';
  try{const data=await api('/api/creator/inbox',{creatorCode:code.value,query:search.value,status:filter.value,...(append?{cursor}:{})});if(expected!==version)return;
   access.open=false;accessTitle.textContent='Creator access · connected';
   for(const item of data.items)rows.append(render(item));loaded+=data.items.length;cursor=data.nextCursor;more.hidden=!data.hasMore;
   status.textContent=loaded?'Showing '+loaded+' of '+data.total+' saved records'+(data.query?' matching “'+data.query+'”':'')+'.':'No matching saved records. New proposals appear after Refresh inbox.';
  if(!append)box.scrollIntoView({block:'start',behavior:'instant'});
  }catch(e){if(expected===version){access.open=true;accessTitle.textContent='Creator access';status.textContent='Inbox not loaded: '+e.message;}}finally{busy=false;refresh.disabled=false;more.disabled=false;}
 }
 form.addEventListener('submit',e=>{e.preventDefault();load(false);});more.addEventListener('click',()=>load(true));
}
document.addEventListener('DOMContentLoaded',initializeCreatorInbox);
