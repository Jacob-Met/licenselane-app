'use strict';
// Uses the maintained product snapshot v1 inventory: manifest.json + data/.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {Readable}=require('node:stream'),{pipeline}=require('node:stream/promises'),zlib=require('node:zlib');
const MAX_BYTES=8*1024**3,MAX_FILES=10000,RESTORED='.licenselane-restored.json';
const fail=message=>Object.assign(Error(message),{status:409});
const hash=async file=>{const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');};
function safeName(name){return typeof name==='string'&&name.length>0&&!name.includes('\\')&&!name.includes('\0')&&!path.posix.isAbsolute(name)&&name.split('/').every(p=>p&&p!=='.'&&p!=='..');}
async function inventory(root){
 const base=await fsp.lstat(root);if(!base.isDirectory()||base.isSymbolicLink())throw fail('Choose an ordinary studio data directory.');
 const files=Object.create(null);let total=0;
 async function walk(dir,prefix=''){
  for(const entry of (await fsp.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const name=prefix+entry.name,full=path.join(dir,entry.name);if(!safeName(name))throw fail('Unsupported studio filename.');
   const stat=await fsp.lstat(full);if(stat.isSymbolicLink())throw fail('Studio backups cannot include linked files.');
   if(stat.isDirectory())await walk(full,name+'/');
   else if(stat.isFile()){
    total+=stat.size;if(total>MAX_BYTES||Object.keys(files).length>=MAX_FILES)throw fail('Studio backup exceeds the 8 GB or 10,000-file limit.');
    files[name]=await hash(full);
   }else throw fail('Studio backups require ordinary files.');
  }
 }
 await walk(root);return files;
}
function header(name,size){
 const b=Buffer.alloc(512);let leaf=name,prefix='';
 if(Buffer.byteLength(name)>100){const cut=name.lastIndexOf('/');prefix=name.slice(0,cut);leaf=name.slice(cut+1);if(cut<0||Buffer.byteLength(prefix)>155||Buffer.byteLength(leaf)>100)throw fail('A studio filename is too long for this archive.');}
 b.write(leaf,0,100);b.write('0000600\0',100);b.write('0000000\0',108);b.write('0000000\0',116);b.write(size.toString(8).padStart(11,'0')+'\0',124);b.write('00000000000\0',136);b.fill(32,148,156);b[156]=48;b.write('ustar\0',257);b.write('00',263);b.write(prefix,345,155);
 const sum=b.reduce((a,v)=>a+v,0);b.write(sum.toString(8).padStart(6,'0')+'\0 ',148);return b;
}
async function* tarEntries(root,manifest){
 const json=Buffer.from(JSON.stringify(manifest)+'\n');yield header('manifest.json',json.length);yield json;if(json.length%512)yield Buffer.alloc(512-json.length%512);
 for(const name of Object.keys(manifest.files)){
  const file=path.join(root,name),size=(await fsp.stat(file)).size;yield header('data/'+name,size);for await(const chunk of fs.createReadStream(file))yield chunk;if(size%512)yield Buffer.alloc(512-size%512);
 }
 yield Buffer.alloc(1024);
}
function exactOrigin(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&u.origin===value;}catch{return false;}}
async function snapshot({dataFile,origin,commit}){
 if(!exactOrigin(origin)||!/^[a-f0-9]{40}$/.test(commit||''))throw fail('The studio needs its exact installation identity and source before backup.');
 const root=path.dirname(path.resolve(dataFile)),temporary=await fsp.mkdtemp(path.join(os.tmpdir(),'licenselane-studio-'));await fsp.chmod(temporary,0o700);
 try{
  const before=await inventory(root),data=path.join(temporary,'data');
  if(!Object.hasOwn(before,path.basename(dataFile)))throw fail('No saved studio data is available yet.');
  await fsp.cp(root,data,{recursive:true,dereference:false});
  const same=v=>JSON.stringify(v)===JSON.stringify(before);
  if(!same(await inventory(data))||!same(await inventory(root)))throw fail('The studio changed during backup. Try again after the current save finishes.');
  const manifest={version:1,product:'licenselane',commit,files:before,studio:{version:1,origin,dataFile:path.basename(dataFile)}};
  const archive=path.join(temporary,'studio.tar.gz');await pipeline(Readable.from(tarEntries(data,manifest)),zlib.createGzip(),fs.createWriteStream(archive,{mode:0o600,flags:'wx'}));
  const sha256=await hash(archive);return {archive,sha256,bytes:(await fsp.stat(archive)).size,files:Object.keys(before).length,cleanup:()=>fsp.rm(temporary,{recursive:true,force:true})};
 }catch(e){await fsp.rm(temporary,{recursive:true,force:true});throw e;}
}
class Reader{
 constructor(stream){this.iterator=stream[Symbol.asyncIterator]();this.pending=Buffer.alloc(0);this.done=false;this.read=0;}
 async take(n){const chunks=[];let left=n;while(left){if(!this.pending.length){const next=await this.iterator.next();if(next.done)throw fail('The studio archive is incomplete.');this.pending=next.value;}
 const size=Math.min(left,this.pending.length);chunks.push(this.pending.subarray(0,size));this.pending=this.pending.subarray(size);left-=size;this.read+=size;if(this.read>MAX_BYTES+32*1024**2)throw fail('Studio archive exceeds its size limit.');}return Buffer.concat(chunks,n);}
}
function tarInfo(b){
 const str=(start,length)=>b.subarray(start,start+length).toString('utf8').split('\0')[0];
 const number=(start,length)=>{const text=str(start,length).trim();if(!/^[0-7]+$/.test(text))throw fail('Invalid studio archive header.');return parseInt(text,8);};
 const expected=number(148,8),copy=Buffer.from(b);copy.fill(32,148,156);if(copy.reduce((a,v)=>a+v,0)!==expected)throw fail('Studio archive header is damaged.');
 const name=(str(345,155)?str(345,155)+'/':'')+str(0,100),size=number(124,12);
 if(!safeName(name)||![0,48].includes(b[156])||str(257,6)!=='ustar'||!Number.isSafeInteger(size)||size>MAX_BYTES)throw fail('Unsupported studio archive entry.');
 return {name,size};
}
async function restore({archive,sha256,destination}){
 if(!path.isAbsolute(destination))throw fail('Choose an absolute destination directory.');
 if(!/^[a-f0-9]{64}$/.test(sha256||'')||await hash(archive)!==sha256)throw fail('The studio backup checksum does not match.');
 try{await fsp.lstat(destination);throw fail('Restore needs a new destination. Your existing studio was not changed.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const parent=path.dirname(destination);await fsp.mkdir(parent,{recursive:true,mode:0o700});
 const temporary=await fsp.mkdtemp(path.join(parent,'.licenselane-restore-'));await fsp.chmod(temporary,0o700);
 const input=fs.createReadStream(archive),stream=zlib.createGunzip();input.on('error',error=>stream.destroy(error));input.pipe(stream);const reader=new Reader(stream);let manifest;
 try{
  const first=tarInfo(await reader.take(512));if(first.name!=='manifest.json'||first.size>4*1024**2)throw fail('Studio backup manifest is missing.');
  manifest=JSON.parse((await reader.take(first.size)).toString('utf8'));if(first.size%512)await reader.take(512-first.size%512);
  if(manifest.version!==1||manifest.product!=='licenselane'||!/^[a-f0-9]{40}$/.test(manifest.commit||'')||manifest.studio?.version!==1||!exactOrigin(manifest.studio.origin)||!safeName(manifest.studio.dataFile)||manifest.studio.dataFile.includes('/'))throw fail('This is not a supported complete studio backup.');
  if(!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))throw fail('Invalid studio inventory.');
  const names=Object.keys(manifest.files);if(names.length>MAX_FILES||!names.includes(manifest.studio.dataFile)||names.some(n=>!safeName(n)||!/^[a-f0-9]{64}$/.test(manifest.files[n])))throw fail('Invalid studio inventory.');
  const seen=new Set();
  for(;;){const block=await reader.take(512);if(block.every(v=>v===0)){if(!(await reader.take(512)).every(v=>v===0))throw fail('Invalid studio archive ending.');break;}
   const item=tarInfo(block),name=item.name.startsWith('data/')?item.name.slice(5):'';
   if(!Object.hasOwn(manifest.files,name)||seen.has(name))throw fail('Studio archive inventory differs.');seen.add(name);
   const target=path.join(temporary,name);await fsp.mkdir(path.dirname(target),{recursive:true,mode:0o700});const handle=await fsp.open(target,'wx',0o600),digest=crypto.createHash('sha256');
   try{let remaining=item.size;while(remaining){const chunk=await reader.take(Math.min(remaining,64*1024));digest.update(chunk);await handle.writeFile(chunk);remaining-=chunk.length;}}finally{await handle.close();}
   if(digest.digest('hex')!==manifest.files[name])throw fail('A restored studio file does not match its inventory.');if(item.size%512)await reader.take(512-item.size%512);
  }
  if(seen.size!==names.length)throw fail('Studio archive is missing files.');
  // Drain the gzip trailer too: a truncated or corrupt compressed stream is not a restore.
  if(reader.pending.some(v=>v!==0))throw fail('Unexpected data after studio archive.');
  let tail=reader.pending.length;for await(const chunk of { [Symbol.asyncIterator]:()=>reader.iterator }){tail+=chunk.length;if(tail>1024*1024||chunk.some(v=>v!==0))throw fail('Unexpected data after studio archive.');}
  await fsp.writeFile(path.join(temporary,RESTORED),JSON.stringify({version:1,origin:manifest.studio.origin,restorationId:sha256})+'\n',{mode:0o600});
  // mkdir claims the new destination without replacing an existing installation.
  await fsp.mkdir(destination,{mode:0o700});
  try{await fsp.rename(temporary,destination);}
  catch(e){try{await fsp.rmdir(destination);}catch{}throw e;}
  return {dataFile:path.join(destination,manifest.studio.dataFile),origin:manifest.studio.origin,files:names.length};
 }finally{input.destroy();stream.destroy();await fsp.rm(temporary,{recursive:true,force:true});}
}
function restoredIdentity(dataFile){const file=path.join(path.dirname(path.resolve(dataFile)),RESTORED);if(!fs.existsSync(file))return null;const v=JSON.parse(fs.readFileSync(file,'utf8'));if(v.version!==1||!exactOrigin(v.origin)||!/^[a-f0-9]{64}$/.test(v.restorationId||''))throw fail('The restored studio identity is invalid.');return v;}
function sourceCommit(root){
 for(const name of ['RELEASE.json','manifest.json']){try{const v=JSON.parse(fs.readFileSync(path.join(root,'..',name),'utf8')),commit=v.sourceCommit||v.commit;if(/^[a-f0-9]{40}$/.test(commit||''))return commit;}catch{}}
 try{const commit=require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();if(/^[a-f0-9]{40}$/.test(commit))return commit;}catch{}
 throw fail('The installed source identity is unavailable. Use the verified portable package to back up this studio.');
}
module.exports={snapshot,restore,restoredIdentity,inventory,hash,sourceCommit};
