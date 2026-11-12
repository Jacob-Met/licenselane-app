'use strict';
// Shared, explicit scope rules. Named regions are compared, never inferred.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.licenseScope=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const DEFAULT_MONTHS=12,DEFAULT_TERRITORY='Worldwide';
 function months(value,label='Duration'){
  if(!['number','string'].includes(typeof value))throw Error(label+' must be a whole number of months from 1 to 120.');
  if(typeof value==='string'&&!/^\d+$/.test(value.trim()))throw Error(label+' must be a whole number of months from 1 to 120.');
  const count=Number(value);
  if(!Number.isSafeInteger(count)||count<1||count>120)throw Error(label+' must be a whole number of months from 1 to 120.');
  return count;
 }
 function territory(value){
  if(typeof value!=='string')throw Error('Enter the named territory for this use.');
  const text=value.trim().replace(/ +/g,' ');
  if(text.length<2||text.length>100||! /^[\p{L}\p{N}][\p{L}\p{N}\p{M} .,()'’/&-]+$/u.test(text))throw Error('Territory must be 2–100 characters naming the place or region.');
  return text.toLocaleLowerCase('en-US')==='worldwide'?DEFAULT_TERRITORY:text;
 }
 function offer(work={}){return {maxTermMonths:months((work.maxTermMonths===undefined?DEFAULT_MONTHS:work.maxTermMonths),'Offered maximum duration'),territory:territory((work.territory===undefined?DEFAULT_TERRITORY:work.territory))};}
 function requested(input={},work={}){const offered=offer(work);return {termMonths:months((input.termMonths===undefined?offered.maxTermMonths:input.termMonths)),territory:territory((input.territory===undefined?offered.territory:input.territory))};}
 function specified(request){return Object.prototype.hasOwnProperty.call(request,'termMonths')||Object.prototype.hasOwnProperty.call(request,'territory');}
 function covered(request,work){const wanted=requested(request,work),offered=offer(work);return {duration:wanted.termMonths<=offered.maxTermMonths,territory:offered.territory===DEFAULT_TERRITORY||wanted.territory.toLocaleLowerCase('en-US')===offered.territory.toLocaleLowerCase('en-US')};}
 function date(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Choose a project start date.');
  const [year,month,day]=value.split('-').map(Number),time=new Date(Date.UTC(year,month-1,day));
  if(year<1970||year>9989||time.toISOString().slice(0,10)!==value)throw Error('Choose a valid calendar date.');
  return value;
 }
 function period(startsOn,termMonths){
  if(startsOn===undefined)return null;
  const start=date(startsOn),count=months(termMonths),[year,month,day]=start.split('-').map(Number),target=year*12+month-1+count,y=Math.floor(target/12),m=target%12;
  const last=new Date(Date.UTC(y,m+1,0)).getUTCDate(),end=day<=last?new Date(Date.UTC(y,m,day)):new Date(Date.UTC(y,m+1,1));
  return {startsOn:start,endsBefore:end.toISOString().slice(0,10),endsOn:new Date(end.getTime()-86400000).toISOString().slice(0,10),timeZone:'UTC'};
 }
 const today=()=>new Date().toISOString().slice(0,10);
 function periodLabel(value){if(!value)return 'Start date not recorded';const fmt=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});return fmt.format(new Date(value.startsOn+'T00:00:00Z'))+' – '+fmt.format(new Date(value.endsOn+'T00:00:00Z'))+' · UTC';}
 function periodState(value,day=today()){if(!value)return 'undated';return day<value.startsOn?'upcoming':day>=value.endsBefore?'ended':'current';}
 const label=value=>value+' '+(value===1?'month':'months');
 return {DEFAULT_MONTHS,DEFAULT_TERRITORY,months,territory,offer,requested,specified,covered,label,date,period,today,periodLabel,periodState};
});
