const test=require('node:test'),assert=require('node:assert/strict');
const {revisionComparison}=require('../public/revision-comparison');
test('compares saved scope and exact cents without using current catalogue or mutating records',()=>{
 const old={id:'old',request:{medium:'print',copies:1200,project:'Winter guide',attribution:true,exclusive:false,training:false},quote:{priceCents:8500,assetTitle:'Archived work',term:'12 months',territory:'World',policyVersion:'old-policy'},assetDelivery:{sha256:'retained-original'}};
 const current=JSON.parse(JSON.stringify(old));current.id='new';current.revisionOf={id:'old'};current.request.medium='website';current.request.copies=0;current.request.project='Winter website';current.quote.priceCents=4900;
 const before=JSON.stringify([old,current]),rows=revisionComparison(old,current);
 assert.deepEqual(rows.filter(r=>r.changed).map(r=>r.label),['Amount','Project','Medium','Physical copies']);
 assert.deepEqual(rows[0],{label:'Amount',before:'$85.00',after:'$49.00',changed:true});
 assert.equal(rows.find(r=>r.label==='Physical copies').after,'0');assert.equal(rows.find(r=>r.label==='Policy version').before,'old-policy');assert.equal(JSON.stringify([old,current]),before);
 assert.throws(()=>revisionComparison({...old,id:'wrong'},current),/verified/);
 current.quote.priceCents=8500;assert.equal(revisionComparison(old,current)[0].changed,false);
});
