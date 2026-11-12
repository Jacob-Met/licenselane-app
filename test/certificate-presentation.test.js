'use strict';const {test}=require('node:test');const assert=require('node:assert/strict');const {certificate}=require('../server');const {markup}=require('../public/certificate');
test('certificate presentation preserves authoritative fields and escapes recipient markup',()=>{const record={id:'a'.repeat(64),status:'issued',quote:{assetTitle:'Copper & Signal',creator:'North Studio',term:'One year',territory:'Worldwide',policyVersion:'2026-1'},request:{licensee:'<img src=x onerror=alert(1)>',project:'Visitor guide',medium:'print',copies:720},captureId:'CAPTURE',issuedAt:'2026-11-11T00:00:00Z',assetDelivery:{sha256:'b'.repeat(64)}};const c=certificate(record),before=JSON.stringify(c),html=markup(c);assert.ok(html.includes(c.integritySha256));assert.ok(html.includes(c.asset.sha256));assert.ok(html.includes('720'));assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('not a digital signature'));assert.equal(JSON.stringify(c),before);assert.throws(()=>markup(certificate({...record,status:'approved'})),/issued certificate/);});

test('offline certificate uses the same escaped document and retained current payment reference',()=>{
 const {standalone}=require('../public/certificate');
 const record={id:'c'.repeat(64),status:'issued',receiptVersion:2,quote:{assetTitle:'Coast <&> Field Guide',creator:'North Studio',term:'12 months',territory:'Worldwide',policyVersion:'1.0'},request:{licensee:'A & B Studio',project:'Museum guide',medium:'print',copies:720},orderId:'EXACTORDER',captureId:'EXACTCAPTURE',issuedAt:'2026-11-11T00:00:00Z'};
 const c=certificate(record),before=JSON.stringify(c),css=require('node:fs').readFileSync(require('node:path').join(__dirname,'../public/certificate.css'),'utf8');
 const html=standalone(c,css);
 assert.ok(html.startsWith('<!doctype html>'));
 assert.ok(html.includes(markup(c)));
 assert.ok(html.includes('PayPal order</dt><dd>EXACTORDER'));
 assert.ok(!html.includes('Issued</dt><dd></dd>'));
 assert.ok(html.includes('Coast &lt;&amp;&gt; Field Guide'));
 assert.ok(html.includes('Content-Security-Policy'));
 assert.ok(!/<script\b|(?:src|href)=["']https?:/i.test(html));
 assert.equal(JSON.stringify(c),before);
 assert.throws(()=>standalone(c,''),/stylesheet/);
});
