/* Public description only; original file authority stays in the server. */
(() => {
 'use strict';
 const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const size=bytes=>bytes<1024?bytes+' B':bytes<1048576?(bytes/1024).toLocaleString('en-US',{maximumFractionDigits:1})+' KB':(bytes/1048576).toLocaleString('en-US',{maximumFractionDigits:1})+' MB';
 window.deliveryDetails=delivery=>{
  const box=node('details','delivery-details');
  const entries=delivery.contents;
  box.append(node('summary','',entries?'Included files · '+entries.length:'Original file'));
  box.append(node('p','delivery-file',delivery.filename+' · '+size(delivery.bytes)));
  if(entries){
   const list=node('ul','delivery-file-list');let shown=0;
   const more=node('button','delivery-show-more','Show more files');more.type='button';
   const append=()=>{const end=Math.min(shown+50,entries.length);for(;shown<end;shown++){const entry=entries[shown],row=node('li');row.append(node('span','delivery-file-name',entry.name??('File '+(shown+1)+' · legacy filename encoding')),node('span','delivery-file-size',size(entry.bytes)));list.append(row);}more.hidden=shown===entries.length;more.textContent='Show more files ('+shown+' of '+entries.length+')';};
   append();more.addEventListener('click',append);box.append(list,more);
  }
  return box;
 };
})();
