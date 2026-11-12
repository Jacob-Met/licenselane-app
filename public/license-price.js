'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.licensePrice=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 function calculate(work,request){
  const printCents=request.medium==='print'?Math.ceil(request.copies/500)*1200:0;
  return {baseCents:work.priceCents,printCents,totalCents:work.priceCents+printCents};
 }
 return {calculate};
});
