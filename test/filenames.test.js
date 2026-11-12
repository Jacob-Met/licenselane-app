'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {originalFilename,contentDisposition}=require('../lib/filenames');
test('retained display filenames remain portable and attachment headers stay valid',()=>{
 assert.equal(originalFilename('folder\\Study 2026.png'),'Study 2026.png');
 assert.equal(originalFilename('folder/Étude – 夜.png'),'Étude – 夜.png');
 assert.equal(originalFilename('CON.zip'),'_CON.zip');
 const long=originalFilename('夜'.repeat(150)+'.png');assert.equal(Array.from(long).length,100);assert.ok(long.endsWith('.png'));
 const header=contentDisposition('Study "one"\n.png');assert.ok(!header.includes('\n'));assert.ok(header.includes('Study _one__.png'));
 assert.equal(contentDisposition('Coastal-symbols.zip'),'attachment; filename="Coastal-symbols.zip"');
 assert.equal(originalFilename('\ud800.png'),'_.png');
});
