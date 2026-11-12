'use strict';
function validateRecordsBackup(saved,origins){
 const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 if(saved?.format!=='licenselane-records-backup'||saved.version!==1||!Array.isArray(saved.records)||!saved.records.length||saved.records.length>1000)throw Error('Choose a LicenseLane records backup with 1 to 1,000 records.');
 if(typeof saved.server!=='string'||!origins.includes(saved.server))throw Error('This records backup belongs to another LicenseLane installation.');
 const ids=new Set(),records=[];
 for(const entry of saved.records){
  if(!entry||!hex(entry.licenseId)||(entry.buyerAccessToken!==undefined&&!hex(entry.buyerAccessToken))||ids.has(entry.licenseId)||(entry.archived!==undefined&&typeof entry.archived!=='boolean'))throw Error('This records backup contains an invalid or repeated record.');
  ids.add(entry.licenseId);records.push({licenseId:entry.licenseId,...(entry.archived!==undefined?{archived:entry.archived}:{}),...(entry.buyerAccessToken?{buyerAccessToken:entry.buyerAccessToken}:{})});
 }
 return records;
}
if(typeof module!=='undefined')module.exports={validateRecordsBackup};
