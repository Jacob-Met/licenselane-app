'use strict';
// Display names never select a storage path: retained files remain content-addressed.
function originalFilename(value,fallback='original'){
 let name=String(value||'').split(/[\\/]/).pop()
  .replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*\uD800-\uDFFF]/gu,'_').trim().replace(/[ .]+$/,'');
 if(!name||name==='.'||name==='..')name=fallback;
 if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name;
 const chars=Array.from(name);
 if(chars.length>100){
  const match=name.match(/(\.[a-zA-Z0-9]{1,10})$/),extension=match?match[1]:'';
  name=chars.slice(0,100-extension.length).join('')+extension;
 }
 return name;
}
function contentDisposition(value,inline=false){
 const name=originalFilename(value,'download'),ascii=name.replace(/[^\x20-\x7e]/gu,'_');
 let header=(inline?'inline':'attachment')+'; filename="'+ascii+'"';
 if(ascii!==name)header+="; filename*=UTF-8''"+encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 return header;
}
module.exports={originalFilename,contentDisposition};
