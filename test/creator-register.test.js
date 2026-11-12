'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('issued register preserves approved amounts and quotes spreadsheet-active buyer text',()=>{
 const context={document:{addEventListener(){}}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../public/creator-inbox.js'),'utf8'),context);
 const csv=context.issuedRegisterCSV([{id:'abc',project:' =HYPERLINK("https://example.test")',licensee:'Museum, North',work:'Map\nEdition',medium:'print',copies:1200,priceCents:8500,createdAt:'2026-11-10T00:00:00Z'}]);
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\' =HYPERLINK(""https://example.test"")"'));assert.ok(csv.includes('"Museum, North"'));assert.ok(csv.includes('"Map\nEdition"'));assert.ok(csv.includes('"85.00"'));assert.ok(csv.includes('"Verified Sandbox"'));assert.ok(!csv.includes('buyerToken'));
});

test('issued register exports exact saved scope and leaves absent legacy scope blank',()=>{
 const context={document:{addEventListener(){}}};vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../public/creator-inbox.js'),'utf8'),context);
 const base={id:'original',project:'Guide',licensee:'Press',work:'Atlas',medium:'print',copies:390,priceCents:6100,createdAt:'2026-11-11T00:00:00Z'};
 const csv=context.issuedRegisterCSV([{...base,term:'6 months',territory:'France',period:{startsOn:'2090-01-31',endsOn:'2090-07-30'}}, {...base,id:'legacy'}]);
 const lines=csv.trim().split('\r\n');assert.ok(lines[0].includes('"Duration","Territory"'));assert.ok(lines[1].includes('"6 months","France"'));assert.ok(lines[2].includes('"print","390","","","61.00"'));assert.ok(!csv.includes('Worldwide'));assert.ok(lines[1].endsWith('"2090-01-31","2090-07-30"'));assert.ok(lines[2].endsWith('"Verified Sandbox","",""'));
});
