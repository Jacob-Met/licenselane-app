'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ll-launcher-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bundle=path.join(root,'new version');
 fs.mkdirSync(path.join(bundle,'app'),{recursive:true});fs.mkdirSync(path.join(bundle,'runtime'));
 fs.copyFileSync(path.resolve(__dirname,'../scripts/launch-linux.sh'),path.join(bundle,'launch.sh'));
 fs.chmodSync(path.join(bundle,'launch.sh'),0o755);
 fs.writeFileSync(path.join(bundle,'runtime/node'),'#!/bin/sh\nprintf "SERVER_DATA=%s\\n" "$LICENSELANE_DATA"\n',{mode:0o755});
 return {root,run:settings=>spawnSync(path.join(bundle,'launch.sh'),[],{cwd:root,env:{...process.env,LICENSELANE_DATA:'',XDG_STATE_HOME:path.join(root,'state'),...settings},encoding:'utf8'})};
}
const platform={skip:process.platform!=='linux'||process.arch!=='x64'};
test('package refuses a relative custom data path before starting a new server',platform,t=>{
 const f=fixture(t),r=f.run({LICENSELANE_DATA:'custom-data/licenses.json'});
 assert.equal(r.status,1);assert.match(r.stderr,/absolute LICENSELANE_DATA/);assert.match(r.stderr,/Older packages/);assert.doesNotMatch(r.stdout,/SERVER_DATA=/);assert.equal(fs.existsSync(path.join(f.root,'custom-data')),false);
});
test('package refuses a relative default state directory',platform,t=>{
 const f=fixture(t),r=f.run({XDG_STATE_HOME:'relative-state'});
 assert.equal(r.status,1);assert.match(r.stderr,/absolute XDG_STATE_HOME/);assert.doesNotMatch(r.stdout,/SERVER_DATA=/);
});
test('package preserves absolute custom and default state paths across its directory change',platform,t=>{
 const f=fixture(t),custom=path.join(f.root,'older version','app','custom-data','licenses.json');
 const r=f.run({LICENSELANE_DATA:custom});assert.equal(r.status,0);assert.ok(r.stdout.includes('SERVER_DATA='+custom+'\n'));
 const d=f.run({});assert.equal(d.status,0);assert.ok(d.stdout.includes('SERVER_DATA='+path.join(f.root,'state','licenselane','licenses.json')+'\n'));
});
