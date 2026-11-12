'use strict';
const {originalFilename}=require('./filenames');
const {createOriginalUploads}=require('./original-upload');
const readZipInventory=require('../public/zip-inventory');
const scope=require('../public/license-scope');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const previewFiles=work=>work.previewFiles||[work.previewFile];
const revision=work=>Number.isSafeInteger(work.offerRevision)&&work.offerRevision>0?work.offerRevision:1;
function image(input,label,max){
 if(!input||typeof input.name!=='string'||typeof input.data!=='string')throw fail('Choose a '+label+' PNG or JPEG image.');
 if(!/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)||input.data.length>Math.ceil(max/3)*4+4)throw fail(label+' is too large or invalid.');
 const bytes=Buffer.from(input.data,'base64');
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!bytes.length||bytes.length>max||(!png&&!jpg))throw fail('Choose a real PNG or JPEG for '+label+'.');
 return {bytes,mime:png?'image/png':'image/jpeg',filename:originalFilename(input.name,'work.'+(png?'png':'jpg')),sha256:hash(bytes)};
}
// Originals are retained and downloaded verbatim. ZIP members are never extracted
// or served individually; the public preview remains a separate PNG/JPEG image.
function deliveryFile(input){
 if(!input||typeof input.name!=='string'||! /\.zip$/i.test(input.name))return image(input,'original',6*1024*1024);
 const invalid=()=>fail('Choose a complete ZIP containing at least one file.');
 const max=6*1024*1024;
 if(typeof input.data!=='string'||! /^[A-Za-z0-9+/]*={0,2}$/.test(input.data)||input.data.length>Math.ceil(max/3)*4+4)throw invalid();
 const bytes=Buffer.from(input.data,'base64');
 if(bytes.length<22||bytes.length>max)throw invalid();
 let contents;try{contents=readZipInventory(bytes);}catch{throw invalid();}const files=contents.length;
 return {bytes,mime:'application/zip',filename:originalFilename(input.name,'original.zip'),sha256:hash(bytes),files,contents};
}
function offerFields(body,current={}){
 const field=(key,min,max)=>{const value=String(body[key]||'').trim();if(value.length<min||value.length>max)throw fail(key+' must be '+min+'–'+max+' characters.');return value;};
 if(body.confirmed!==true)throw fail('Confirm that you may offer the work under the displayed terms.');
 const title=field('title',3,100),creator=field('creator',3,100),description=field('description',10,500);
 const contactEmail=body.contactEmail===undefined?(current.contactEmail||''):body.contactEmail;
 if(typeof contactEmail!=='string'||contactEmail.length>254||(contactEmail!==''&&!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(contactEmail)))throw fail('Enter one contact email address, or leave it blank.');
 const priceCents=body.priceCents,maxCopies=body.maxCopies,permitted=body.permitted;
 if(!Number.isSafeInteger(priceCents)||priceCents<100||priceCents>1000000)throw fail('Base price must be USD 1–10,000.');
 if(!Array.isArray(permitted)||!permitted.length||new Set(permitted).size!==permitted.length||permitted.some(x=>!['website','social','print'].includes(x)))throw fail('Choose at least one offered medium.');
 if(!Number.isSafeInteger(maxCopies)||maxCopies<0||maxCopies>1000000||(!permitted.includes('print')&&maxCopies!==0)||(permitted.includes('print')&&maxCopies===0))throw fail('Set a positive print limit when Print is offered; otherwise use zero.');
 let offered;try{offered=scope.offer({maxTermMonths:body.maxTermMonths===undefined?current.maxTermMonths:body.maxTermMonths,territory:body.territory===undefined?current.territory:body.territory});}catch(error){throw fail(error.message);}
 return {title,creator,description,...(contactEmail?{contactEmail}:current.contactEmail?{contactEmail:''}:{}),priceCents,permitted,maxCopies,...offered};
}
function requestDigest(body){
 if(typeof body.requestId!=='string'||! /^[a-f0-9-]{36}$/.test(body.requestId))throw fail('Review the offer again before saving.');
 const {creatorCode,...payload}=body;return hash(JSON.stringify(payload));
}
function createCatalog(file){
 const root=path.join(path.dirname(file),'creator-catalog'),index=path.join(root,'catalog.json');
 const uploads=createOriginalUploads(root);
 function document(){try{const d=JSON.parse(fs.readFileSync(index));if(d.version!==1||!Array.isArray(d.works))throw Error('Invalid creator catalog');return d;}catch(e){if(e.code==='ENOENT')return {version:1,works:[]};throw e;}}
 function load(){return document().works;}
 const settings=d=>({includeDemoWorks:d.settings?.includeDemoWorks!==false,revision:d.settings?.revision||1});
 const inventoryCache=new Map();
 function description(original){
  let contents=original.contents;
  if(!contents&&original.mime==='application/zip'){
   if(inventoryCache.has(original.sha256))contents=inventoryCache.get(original.sha256);
   else try{const bytes=read(original.sha256);if(hash(bytes)!==original.sha256)throw Error('Damaged original');contents=deliveryFile({name:original.filename,data:bytes.toString('base64')}).contents;inventoryCache.set(original.sha256,contents);}catch{contents=null;}
  }
  return {filename:original.filename,mime:original.mime,bytes:original.bytes,...(contents?{contents}: {})};
 }
 function publicWork(w){
  const {original,previewFile,previewFiles:privatePreviews,requestId,requestDigest,offerUpdates,previewHistory,...v}=w;
  return {...v,...scope.offer(v),delivery:description(original),offerRevision:revision(w),offerStatus:w.offerStatus==='paused'?'paused':'active',preview:'/api/catalog/'+w.id+'/preview?offer='+revision(w),previews:previewFiles(w).map((_,i)=>'/api/catalog/'+w.id+'/preview?offer='+revision(w)+'&image='+i)};
 }
 function read(sha){if(!/^[a-f0-9]{64}$/.test(sha))throw fail('Unknown image.',404);return fs.readFileSync(path.join(root,sha));}
 function save(works,extra={}){fs.mkdirSync(root,{recursive:true,mode:0o700});const temp=index+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify({...document(),...extra,version:1,works},null,2),{mode:0o600});fs.renameSync(temp,index);}
 function store(im){fs.mkdirSync(root,{recursive:true,mode:0o700});try{fs.writeFileSync(path.join(root,im.sha256),im.bytes,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}}
 function galleryImages(input,current){
  if(input===undefined)return undefined;
  if(!Array.isArray(input)||input.length>5)throw fail('Choose up to five additional preview images.');
  let total=0;
  return input.map(value=>{
   if(value&&Object.prototype.hasOwnProperty.call(value,'existingIndex')){
    const index=value.existingIndex;
    if(!current||!Number.isSafeInteger(index)||index<1||index>=previewFiles(current).length)throw fail('Reload the current preview images before reviewing.');
    const manifest=previewFiles(current)[index];total+=read(manifest.sha256).length;
    if(total>6*1024*1024)throw fail('Additional previews must total 6 MB or less.');
    return manifest;
   }
   const im=image(value,'additional preview',2*1024*1024);total+=im.bytes.length;
   if(total>6*1024*1024)throw fail('Additional previews must total 6 MB or less.');
   return im;
  });
 }
 function mutate(id,body,transform){
  const digest=requestDigest(body),works=load(),at=works.findIndex(w=>w.id===id);
  if(at<0)throw fail('Choose an existing creator work to update.',404);
  const current=works[at],receipt=(current.offerUpdates||[]).find(u=>u.requestId===body.requestId);
  if(receipt){if(receipt.requestDigest!==digest)throw fail('This reviewed update changed. Review it again.',409);return receipt.work;}
  if(works.some(w=>w.requestId===body.requestId||(w.id!==id&&(w.offerUpdates||[]).some(u=>u.requestId===body.requestId))))throw fail('Use a new review reference for this update.',409);
  if(body.expectedOfferRevision!==revision(current))throw fail('This offer changed in another window. Load the current offer before updating it.',409);
  const {fields,preview,gallery}=transform(current),previewFile=preview?{mime:preview.mime,sha256:preview.sha256}:current.previewFile;
  const files=[previewFile,...(gallery===undefined?previewFiles(current).slice(1):gallery.map(im=>({mime:im.mime,sha256:im.sha256})))];
  const changed=Object.keys(fields).some(key=>JSON.stringify(fields[key])!==JSON.stringify(key==='offerStatus'?(current.offerStatus||'active'):['maxTermMonths','territory'].includes(key)?scope.offer(current)[key]:current[key]))||JSON.stringify(files)!==JSON.stringify(previewFiles(current));
  const updated=changed?{...current,...fields,offerRevision:revision(current)+1,previewFile,previewFiles:files,updatedAt:new Date().toISOString(),previewHistory:[...(current.previewHistory||[]),{offerRevision:revision(current),previewFile:current.previewFile,previewFiles:previewFiles(current)}]}:{...current};
  const result=publicWork(updated);
  updated.offerUpdates=[...(current.offerUpdates||[]),{requestId:body.requestId,requestDigest:digest,work:result}];
  if(preview)store(preview);for(const im of gallery||[])if(im.bytes)store(im);works[at]=updated;save(works);return result;
 }
 return {
  uploads,
  works:()=>load().map(publicWork),
  settings:()=>settings(document()),
  setSettings(body){
   const digest=requestDigest(body),d=document(),current=settings(d);
   const receipt=(d.settingsUpdates||[]).find(r=>r.requestId===body.requestId);
   if(receipt){if(receipt.requestDigest!==digest)throw fail('This gallery change was edited. Review it again.',409);return receipt.settings;}
   if(typeof body.includeDemoWorks!=='boolean'||body.confirmed!==true)throw fail('Choose and confirm what buyers will see.');
   if(body.expectedRevision!==current.revision)throw fail('Your gallery changed in another window. Reload its current setting.',409);
   if(!body.includeDemoWorks&&!d.works.some(w=>w.offerStatus!=='paused'))throw fail('Publish an available work before showing only your own catalog.');
   const next={includeDemoWorks:body.includeDemoWorks,revision:current.revision+1};
   save(d.works,{settings:next,settingsUpdates:[...(d.settingsUpdates||[]),{requestId:body.requestId,requestDigest:digest,settings:next}]});
   return next;
  },
  original(id){const w=load().find(w=>w.id===id);if(!w)throw fail('Unknown creator work.',404);const bytes=read(w.original.sha256);if(hash(bytes)!==w.original.sha256)throw fail('The creator original is damaged. Restore your catalog backup.',409);return {...w.original,...description(w.original),content:bytes};},
  preview(id,offerRevision,imageIndex=0){
   const w=load().find(w=>w.id===id);if(!w)throw fail('Unknown preview.',404);
   const edition=offerRevision===undefined||offerRevision===revision(w)?w:(w.previewHistory||[]).find(p=>p.offerRevision===offerRevision);
   if(!Number.isSafeInteger(imageIndex)||imageIndex<0)throw fail('Invalid preview image.',400);
   const manifest=edition&&previewFiles(edition)[imageIndex];
   if(!manifest)throw fail('This offer preview is not available.',404);
   const bytes=read(manifest.sha256);if(hash(bytes)!==manifest.sha256)throw fail('The creator preview is damaged. Restore your catalog backup.',409);
   return {bytes,mime:manifest.mime};
  },
  add(body){
   const digest=requestDigest(body),works=load(),existing=works.find(w=>w.requestId===body.requestId);
   if(existing){if(existing.requestDigest!==digest)throw fail('This reviewed offer changed. Review it again.',409);return publicWork(existing);}
   if(works.some(w=>(w.offerUpdates||[]).some(u=>u.requestId===body.requestId)))throw fail('Use a new review reference for a new work.',409);
   const fields=offerFields(body),original=body.original?.uploadSha?uploads.resolve(body.original):deliveryFile(body.original),preview=image(body.preview,'preview',2*1024*1024),gallery=galleryImages(body.previewGallery)||[];
   const id='creator-'+crypto.randomUUID();
   const w={id,requestId:body.requestId,requestDigest:digest,...fields,kind:original.mime==='application/zip'?'Creator bundle':'Creator artwork',specs:original.filename+' · '+(original.files?original.files+' '+(original.files===1?'file':'files')+' · ':'')+original.bytes.length.toLocaleString('en-US')+' bytes',policyVersion:'1.0',custom:true,offerRevision:1,preview:'/api/catalog/'+id+'/preview',original:{filename:original.filename,mime:original.mime,bytes:original.bytes.length,sha256:original.sha256,...(original.contents?{contents:original.contents}:{})},previewFile:{mime:preview.mime,sha256:preview.sha256},previewFiles:[preview,...gallery].map(im=>({mime:im.mime,sha256:im.sha256})),createdAt:new Date().toISOString()};
   store(original);store(preview);gallery.forEach(store);save([...works,w]);return publicWork(w);
  },
  update(id,body){
   return mutate(id,body,current=>{
    if(Object.prototype.hasOwnProperty.call(body,'original'))throw fail('An offer correction keeps the original file. Only its public preview and terms can change.');
    return {fields:offerFields(body,current),preview:body.preview===undefined?null:image(body.preview,'preview',2*1024*1024),gallery:galleryImages(body.previewGallery,current)};
   });
  },
  setStatus(id,body){
   return mutate(id,body,()=>{
    if(body.confirmed!==true)throw fail('Confirm the availability change before saving.');
    if(!['active','paused'].includes(body.status))throw fail('Choose active or paused availability.');
    return {fields:{offerStatus:body.status},preview:null};
   });
  }
 };
}
module.exports={createCatalog};
