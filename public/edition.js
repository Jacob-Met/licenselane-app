'use strict';
// One rendering for the saved record and the final payment decision.
window.licenseEdition=function(license){
 const edition=license.edition,proposed=['requested','changes_requested'].includes(license.status);
 const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const row=node('section','saved-edition');row.setAttribute('aria-label',proposed?'Proposed edition':'Approved edition');
 const info=node('div','saved-edition-info');
 info.append(node('span','saved-edition-label',license.status==='issued'?'Licensed artwork':'Saved artwork'));
 info.append(node('strong','saved-edition-name',edition?.label||'Edition not recorded'));
 if(edition?.previewUrl){
  const image=node('img','saved-edition-preview');image.src=edition.previewUrl;image.dataset.previewUrls=JSON.stringify(edition.previewUrls||[edition.previewUrl]);image.alt=license.quote.assetTitle+' — '+edition.label;
  const inspect=node('button','saved-preview-open');inspect.type='button';inspect.setAttribute('aria-label','Inspect saved preview of '+license.quote.assetTitle);inspect.append(image,node('span','',edition.previewUrls?.length>1?'Inspect '+edition.previewUrls.length+' saved views':'Inspect saved preview'));
  image.addEventListener('error',()=>{inspect.remove();row.classList.add('without-preview');info.append(node('p','saved-edition-unavailable','Preview unavailable.'));},{once:true});
  row.append(inspect);
 }else row.classList.add('without-preview');
 const savedRevision=license.assetEdition?.offerRevision;
 if(Number.isSafeInteger(savedRevision)&&savedRevision>0)info.append(node('p','saved-offer-revision','Saved offer · revision '+savedRevision));
 if(edition?.specs&&!(edition.filename&&edition.specs.startsWith(edition.filename+' · ')))info.append(node('p','saved-edition-specs',edition.specs));
 if(edition?.filename){
  info.append(node('p','saved-edition-file',edition.filename+' · '+new Intl.NumberFormat('en-US').format(edition.bytes)+' bytes'));
  if(edition.contents)info.append(window.deliveryDetails(edition));
  const fingerprint=node('details','saved-edition-fingerprint');fingerprint.append(node('summary','','File fingerprint'),node('code','',edition.sha256));info.append(fingerprint);
 }
 if(edition?.isCurrent===false)info.append(node('p','saved-edition-notice','Earlier original file'));
 if(edition?.isCurrentOffer===false){
  const current=edition.currentOfferRevision;
  const changed=Number.isSafeInteger(current)&&current>0?'Current offer · revision '+current:'Offer updated';
  info.append(node('p','saved-edition-notice saved-offer-notice',changed));
 }
 row.append(info);return row;
};
