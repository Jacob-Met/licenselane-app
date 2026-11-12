'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateRecordsBackup}=require('../public/records-backup');
test('workspace backup validates installation and every capability before restoration',()=>{
 const server='https://original.example',id='a'.repeat(64),token='b'.repeat(64);
 const file={format:'licenselane-records-backup',version:1,server,records:[{licenseId:id,buyerAccessToken:token},{licenseId:'c'.repeat(64)}]};
 const original=JSON.stringify(file),result=validateRecordsBackup(file,[server,'https://private.example']);
 assert.deepEqual(result,file.records);assert.equal(JSON.stringify(file),original);
 assert.throws(()=>validateRecordsBackup(file,['https://wrong.example']),/another/);
 assert.throws(()=>validateRecordsBackup({...file,records:[]},[server]),/records/);
 assert.throws(()=>validateRecordsBackup({...file,records:[file.records[0],file.records[0]]},[server]),/repeated/);
 assert.throws(()=>validateRecordsBackup({...file,records:[{licenseId:id,buyerAccessToken:'bad'}]},[server]),/invalid/);
 assert.throws(()=>validateRecordsBackup({...file,records:Array(1001).fill(file.records[0])},[server]),/1,000/);
 assert.throws(()=>validateRecordsBackup({...file,version:2},[server]),/backup/);
 assert.deepEqual(validateRecordsBackup({...file,records:[{licenseId:id,buyerAccessToken:token,creatorCode:'ignored',status:'issued'}]},[server]),[{licenseId:id,buyerAccessToken:token}]);
});

test('records backups preserve optional archive choices without accepting status or coercion',()=>{
 const server='https://original.example',id='a'.repeat(64);
 const file={format:'licenselane-records-backup',version:1,server,records:[{licenseId:id}]};
 for(const archived of [true,false]){
  assert.deepEqual(validateRecordsBackup({...file,records:[{licenseId:id,archived,status:'issued'}]},[server]),[{licenseId:id,archived}]);
 }
 assert.deepEqual(validateRecordsBackup(file,[server]),[{licenseId:id}]);
 for(const archived of ['true','false',0,1,null,{},[]]){
  assert.throws(()=>validateRecordsBackup({...file,records:[{licenseId:id,archived}]},[server]),/invalid/);
 }
});
