'use strict';
const FILTERS=new Set(['requested','changes_requested','approved','awaiting_payment','payment_attention','issued','all']);
function creatorInbox(licenses,options={}){
 const filter=options.status??'requested',query=String(options.query??'').trim();
 if(!FILTERS.has(filter)||query.length>100)throw Object.assign(Error('Choose a valid inbox filter and search of at most 100 characters.'),{status:400});
 if(options.cursor!==undefined&&options.cursor!==null&&!/^[a-f0-9]{64}$/.test(options.cursor))throw Object.assign(Error('Invalid inbox page. Refresh the list.'),{status:400});
 const needle=query.toLocaleLowerCase();
 const matches=Object.values(licenses).filter(l=>(filter==='all'||(filter==='payment_attention'?['creating_order','order_unknown','capture_unknown'].includes(l.status):l.status===filter))&&[l.request.project,l.request.licensee,l.quote.assetTitle,l.quote.term,l.quote.territory,l.id].some(x=>String(x??'').toLocaleLowerCase().includes(needle))).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||b.id.localeCompare(a.id));
 let start=0;if(options.cursor){const i=matches.findIndex(l=>l.id===options.cursor);if(i<0)throw Object.assign(Error('The inbox changed. Refresh the list before loading more.'),{status:409});start=i+1;}
 const page=matches.slice(start,start+40),hasMore=start+page.length<matches.length;
 // Deliberately construct a summary: never return approval codes, buyer tokens/hashes, provider receipts or private URLs.
 return {items:page.map(l=>({id:l.id,createdAt:l.createdAt,status:l.status,project:l.request.project,licensee:l.request.licensee,work:l.quote.assetTitle,medium:l.request.medium,copies:l.request.copies,term:l.quote.term??null,territory:l.quote.territory??null,...(l.quote.period?{period:l.quote.period}:{}),priceCents:l.quote.priceCents,revisionOf:l.revisionOf?.id||null,replaces:l.replaces?.id||null})),total:matches.length,hasMore,nextCursor:hasMore?page.at(-1).id:null,query,status:filter};
}
module.exports={creatorInbox};
