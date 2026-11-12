const scope=require('./public/license-scope');
const price=require('./public/license-price');
const {contentDisposition}=require('./lib/filenames');
const {createCatalog}=require('./lib/creator-catalog');
const {makeBriefExtractor}=require('./lib/brief');
const {checkpointBarrier}=require('./lib/checkpoint');
const studioBackup=require('./lib/studio-backup');
const {purchaseArchive}=require('./lib/purchase-archive');
const {recoveryReceipts}=require('./lib/recovery-receipts');
const {requestChanges,revisionLink}=require('./lib/proposal-revisions');
'use strict';
const {creatorInbox}=require('./lib/creator-inbox');
const foundUses=require('./lib/found');

// LicenseLane: real creator review -> sandbox payment -> evidence-bound certificate.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_FILE = process.env.LICENSELANE_DATA || path.join(ROOT, '.data', 'licenses.json');
const LEGACY_CATALOG = Object.freeze([
  { id: 'lantern-atlas', title: 'Lantern Atlas', edition: 'Suspended terraces', kind: 'Editorial illustration', creator: 'Atelier Meridian (fictional demo)', description: 'Three suspended city terraces joined by bridges around a lantern observatory.', preview: '/assets/lantern-atlas.svg', download: '/assets/lantern-atlas.svg', specs: 'SVG · 1600 × 1000 · editable vectors', priceCents: 4900, permitted: ['website','social','print'], maxCopies: 2000, policyVersion: '1.0' },
  { id: 'blue-hour', title: 'Blue Hour', edition: 'Six-note chime', kind: 'Original sound cue', creator: 'Atelier Meridian (fictional demo)', description: 'A six-note synthesized chime, with a soft decay and quiet landing.', preview: '/assets/blue-hour.svg', download: '/assets/blue-hour.wav', audio: '/assets/blue-hour.wav', specs: 'WAV · 8 seconds · mono · 22.05 kHz / 16-bit', priceCents: 6900, permitted: ['website','social'], maxCopies: 0, policyVersion: '1.0' },
  { id: 'copper-signal', title: 'Copper Signal', edition: 'Twelve navigation symbols', kind: 'Icon collection', creator: 'Atelier Meridian (fictional demo)', description: 'Twelve editable navigation symbols: routes, harbours, tides and waypoints.', preview: '/assets/copper-signal.svg', download: '/assets/copper-signal.zip', specs: '12 SVG files · 48 × 48 viewBox · 2-unit strokes', priceCents: 3900, permitted: ['website','social','print'], maxCopies: 5000, policyVersion: '1.0' }
]);
// The ordinary gallery uses the same authored collection as the hosted studio.
// Earlier bundled works remain addressable for saved drafts, links and purchases.
const bundledCollection=require('./public/assets/between-water-and-sky/collection.json');
const AUTHORED_CATALOG=Object.freeze(bundledCollection.works.map((work,index)=>({
  id:work.slug,title:work.title,edition:bundledCollection.title+' · Plate '+(index+1),kind:'Editorial illustration',
  creator:work.creator,description:work.description,
  preview:'/assets/between-water-and-sky/'+work.preview,previewMime:'image/png',
  download:'/assets/between-water-and-sky/'+work.original,
  specs:'ZIP · editable SVG · 3,600 × 2,400 PNG · README',
  priceCents:work.priceCents,permitted:work.permitted,maxCopies:work.maxCopies,policyVersion:'1.0'
})));
const CATALOG=Object.freeze([...AUTHORED_CATALOG,...LEGACY_CATALOG]);
const listedBundledWorks=new Set(AUTHORED_CATALOG.map(work=>work.id));
const LEGACY_POLICY = Object.freeze([
  {id:'P1',title:'Permitted medium',text:'Only the explicitly listed media are offered as instant licenses. Merchandise, resale and embedding in standalone asset packs require individual negotiation.'},
  {id:'P2',title:'Nonexclusive use',text:'Instant licenses are nonexclusive. Neither ownership nor copyright transfers to the buyer.'},
  {id:'P3',title:'Source and attribution',text:'Attribution to the named creator is required. Material edits must not falsely imply the creator endorsed the resulting work.'},
  {id:'P4',title:'No model training',text:'Training, fine-tuning or building machine-learning datasets using the licensed asset is prohibited.'},
  {id:'P5',title:'Scope and term',text:'One named project, one year, worldwide, with the declared distribution volume and medium. Later scope expansions require a new license.'},
  {id:'P6',title:'Activation',text:'Terms become effective only after the PayPal Sandbox demonstration checkout is captured and verified. Sandbox transactions have no real-money legal effect.'}
]);
const POLICY=Object.freeze(LEGACY_POLICY.map(rule=>rule.id==='P5'?Object.freeze({...rule,text:'One named project, for the duration and territory shown in the agreement, within the creator’s offered scope. Later scope expansions require a new license.'}):rule));
const PERIOD_POLICY=Object.freeze(POLICY.map(rule=>rule.id==='P5'?Object.freeze({...rule,text:rule.text+' When dated, permission applies only after verified payment and within the agreed calendar period in UTC. The period ends the day before the matching day number in the ending month, or on that month’s last day if there is no matching day. The next midnight is excluded.'}):rule));
const policyFor=request=>request.startsOn!==undefined?PERIOD_POLICY:scope.specified(request)?POLICY:LEGACY_POLICY;
function assetDelivery(id,content){
 const item=catalogById(id),filename=path.basename(item.download);
 const bytes=content||fs.readFileSync(path.join(ROOT,'public',item.download));
 const mime=filename.endsWith('.svg')?'image/svg+xml':filename.endsWith('.png')?'image/png':filename.endsWith('.wav')?'audio/wav':'application/zip';
 return {filename,mime,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const canonical = x => JSON.stringify(x);
function catalogById(id){ return CATALOG.find(x=>x.id===id); }
function normalize(input,works=CATALOG){
  if(!input || typeof input!=='object' || Array.isArray(input)) throw bad('Expected a licensing request.');
  const asset = works.find(w=>w.id===input.assetId);
  if(!asset) throw bad('Choose a listed work.');
  const project = String(input.project||'').trim();
  const licensee = String(input.licensee||'').trim();
  if(project.length<1||project.length>100) throw bad('Project name must be 1–100 characters.');
  if(licensee.length<1||licensee.length>100) throw bad('Licensee name must be 1–100 characters.');
  const medium = String(input.medium||'');
  if(!['website','social','print','merchandise'].includes(medium)) throw bad('Choose a valid medium.');
  const copies = Number(input.copies);
  if(!Number.isSafeInteger(copies)||copies<0||copies>1000000) throw bad('Copies must be a whole number between 0 and 1,000,000.');
  if(input.brief!==undefined&&(typeof input.brief!=='string'||input.brief.length>16000))throw bad('Project brief must be text of at most 16,000 characters.');
  const brief=typeof input.brief==='string'&&input.brief.trim()?input.brief:null;
  let requestedScope,startsOn;try{requestedScope=scope.requested(input,asset);if(input.startsOn!==undefined)startsOn=scope.date(input.startsOn);}catch(error){throw bad(error.message);}
  return {assetId:asset.id,project,licensee,medium,copies,exclusive:input.exclusive===true,training:input.training===true,attribution:input.attribution===true,...(scope.specified(input)||requestedScope.termMonths!==12||requestedScope.territory!=='Worldwide'?requestedScope:{}),...(brief?{brief}:{}),...(startsOn!==undefined?{startsOn}:{})};
}
function quote(request,works=CATALOG){
  const asset = works.find(w=>w.id===request.assetId);
  if(!asset)throw bad('This work is no longer available for a new request.',409);
  const findings = [];
  function f(ok,policyId,text){findings.push({ok,policyId,text});}
  f(asset.permitted.includes(request.medium),'P1',asset.permitted.includes(request.medium)?'This medium is listed for this work.':'This medium requires an individual license.');
  f(!request.exclusive,'P2',request.exclusive?'Exclusive rights are not offered by instant checkout.':'Nonexclusive permission only; copyright remains with its creator.');
  f(request.attribution,'P3',request.attribution?'Creator attribution is included.':'Attribution is required.');
  f(!request.training,'P4',request.training?'Training use is excluded from instant licenses.':'No training or dataset rights are granted.');
  const copiesMatchMedium=request.copies===0||request.medium==='print';
  f(copiesMatchMedium&&request.copies<=asset.maxCopies,'P5',
    !copiesMatchMedium?'Physical copies require a print license. Choose Print or request zero physical copies.':
    asset.maxCopies===0?(request.copies===0?'No physical distribution requested.':'This work does not include physical copies.'):
    request.copies<=asset.maxCopies?'Requested '+request.copies.toLocaleString('en-US')+' copies; this work permits up to '+asset.maxCopies.toLocaleString('en-US')+'.':
    'Requested '+request.copies.toLocaleString('en-US')+' copies exceeds this work’s '+asset.maxCopies.toLocaleString('en-US')+'-copy limit. A larger print run requires individual permission.');
  const explicitScope=scope.specified(request),offered=scope.offer(asset),requested=explicitScope?scope.requested(request,asset):{termMonths:12,territory:'Worldwide'};
  if(explicitScope){const covered=scope.covered(request,asset);f(covered.duration,'P5',covered.duration?'Requested '+scope.label(requested.termMonths)+'; offered up to '+scope.label(offered.maxTermMonths)+'.':'Requested duration exceeds the offered '+scope.label(offered.maxTermMonths)+'. Ask the creator for a different offer.');f(covered.territory,'P5',covered.territory?'Requested territory: '+requested.territory+'.':'This offer covers '+offered.territory+'. A different territory needs a different offer; regions are not inferred.');}
  const period=scope.period(request.startsOn,requested.termMonths);
  if(period)f(scope.periodState(period)!=='ended','P5',scope.periodState(period)==='ended'?'This use period has ended. Choose new dates before requesting permission.':'Agreed period: '+scope.periodLabel(period)+'. Permission also requires verified payment.');
  const eligible = findings.every(x=>x.ok);
  const cents = price.calculate(asset,request).totalCents;
  return {eligible,findings,limits:{media:asset.permitted,physicalCopies:asset.maxCopies,...(explicitScope?offered:{})},priceCents:cents,currency:'USD',term:scope.label(requested.termMonths),territory:requested.territory,licenseType:'Nonexclusive',policyVersion:period?'1.2':explicitScope?'1.1':asset.policyVersion,assetTitle:asset.title,creator:asset.creator,...(asset.contactEmail?{creatorContactEmail:asset.contactEmail}:{}),...(period?{period}:{}),...(asset.custom?{offerRevision:asset.offerRevision||1}:{})};
}
function offerChanged(work){
 const error=bad('The creator changed this offer. Review the current work and price before saving or approving it.',409);
 error.code='OFFER_CHANGED';error.work=work;throw error;
}
function requireOfferActive(work){
 if(work?.custom&&work.offerStatus==='paused'){
  const error=bad('The creator paused this offer. Choose another work for a new request.',409);
  error.code='OFFER_PAUSED';error.work=work;throw error;
 }
}
function requireOfferRevision(work,expected){
 requireOfferActive(work);
 if(work.custom&&((expected!==undefined&&expected!==work.offerRevision)||(expected===undefined&&work.offerRevision>1)))offerChanged(work);
}
function bad(message,status=400){const e=new Error(message);e.status=status;return e;}
function ensureDir(p){fs.mkdirSync(path.dirname(p),{recursive:true});}
function loadData(file=DATA_FILE){
  try {const data=JSON.parse(fs.readFileSync(file,'utf8'));return data&&typeof data==='object'&&data.licenses?data:{licenses:{}};}
  catch(e){if(e.code==='ENOENT')return {licenses:{}};throw e;}
}
function saveData(data,file=DATA_FILE){
  ensureDir(file);
  const temp=file+'.'+process.pid+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(data,null,2),{mode:0o600});
  fs.renameSync(temp,file);
}
function matchingOrder(order,license){
  const units=order?.purchase_units;
  const unit=Array.isArray(units)&&units.length===1?units[0]:null;
  return !!(license.orderId&&order?.id===license.orderId&&order.intent==='CAPTURE'
    &&unit?.custom_id===license.id&&unit.amount?.currency_code==='USD'
    &&unit.amount?.value===(license.quote.priceCents/100).toFixed(2));
}
function matchingCapture(order,license){
  if(!matchingOrder(order,license))return null;
  if(order?.status!=='COMPLETED')return null;
  const amount=(license.quote.priceCents/100).toFixed(2);
  for(const unit of order.purchase_units||[]){
    if(unit.custom_id!==license.id)continue;
    for(const capture of unit.payments?.captures||[]){
      if(capture.status==='COMPLETED'&&typeof capture.id==='string'&&capture.id.length>0
         &&capture.amount?.currency_code==='USD'&&capture.amount?.value===amount)return capture;
    }
  }
  return null;
}
function verifyPayment(order,license){return matchingCapture(order,license)!==null;}
function certificate(license){
  if(license.status!=='issued')return null;
  const body={certificateId:'LL-'+license.id.slice(0,12).toUpperCase(),licenseId:license.id,work:license.quote.assetTitle,licensor:license.quote.creator,licensee:license.request.licensee,project:license.request.project,medium:license.request.medium,copies:license.request.copies,term:license.quote.term,territory:license.quote.territory,rights:'Nonexclusive, attribution required; no AI training, resale or copyright transfer',paypalCaptureId:license.captureId,verifiedAt:license.issuedAt,policyVersion:license.quote.policyVersion,sandboxOnly:true};
  if(license.receiptVersion===2){delete body.verifiedAt;body.receiptVersion=2;body.paypalOrderId=license.orderId;}
  if(license.quote.period)body.period=license.quote.period;
  if(license.assetDelivery)body.asset=license.assetDelivery;
  if(license.policySnapshot)body.policy=license.policySnapshot;
  return {...body,integritySha256:sha(canonical(body))};
}
function makePayPal(env=process.env,network=fetch){
  const base='https://api-m.sandbox.paypal.com'; // Live money endpoints are forbidden in this demo.
  const configured=!!(env.PAYPAL_CLIENT_ID&&env.PAYPAL_CLIENT_SECRET);
  async function accessToken(){
    if(!configured)throw bad('PayPal Sandbox credentials are not configured.',503);
    const token=Buffer.from(env.PAYPAL_CLIENT_ID+':'+env.PAYPAL_CLIENT_SECRET).toString('base64');
    const r=await network(base+'/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+token,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw bad('PayPal Sandbox authentication failed ('+r.status+').',502);
    const d=await r.json();if(!d.access_token)throw bad('PayPal returned no access token.',502);return d.access_token;
  }
  async function api(endpoint,method,body,requestId){
    let token;
    try{token=await accessToken();}catch(e){e.paypalRequestNotSent=true;throw e;}
    const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
    if(requestId)headers['PayPal-Request-Id']=requestId;
    const r=await network(base+endpoint,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(18000)});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw bad('PayPal Sandbox '+method+' returned '+r.status+': '+(d.message||'request rejected'),502);
    return d;
  }
  return {
    configured,
    create:async l=>api('/v2/checkout/orders','POST',{intent:'CAPTURE',purchase_units:[{reference_id:'licenselane',custom_id:l.id,description:'LicenseLane demonstration: '+l.quote.assetTitle,amount:{currency_code:'USD',value:(l.quote.priceCents/100).toFixed(2)}}],application_context:{user_action:'PAY_NOW'}},'ll-create-'+l.id.slice(0,24)),
    capture:async l=>api('/v2/checkout/orders/'+encodeURIComponent(l.orderId)+'/capture','POST',null,'ll-capture-'+l.id.slice(0,24)),
    inspect:async l=>api('/v2/checkout/orders/'+encodeURIComponent(l.orderId),'GET')
  };
}
function makeAI(env=process.env,network=fetch){
  let endpoint=null;
  if(env.OLLAMA_URL){
    try{
      const candidate=new URL(env.OLLAMA_URL);
      if(['http:','https:'].includes(candidate.protocol)
         &&['localhost','127.0.0.1','[::1]'].includes(candidate.hostname)
         &&!candidate.username&&!candidate.password){
        endpoint=candidate.origin;
      }
    }catch{/* Invalid and nonlocal model URLs are not admitted. */}
  }
  const requestedTimeout=Number(env.OLLAMA_TIMEOUT_MS||120000);
  const timeoutMs=Number.isFinite(requestedTimeout)?Math.min(300000,Math.max(1000,requestedTimeout)):120000;
  return {configured:!!endpoint,async review(request,quoteResult){
    if(!endpoint)throw bad('Local AI is unavailable; rule review remains usable.',503);
    const rules=POLICY.map(p=>p.id+': '+p.text).join('\n');
    const prompt='You explain a license review. You cannot grant rights or overrule the rules. Return a short precise explanation under 100 words and identify the source policy clauses. Never claim payment or license issuance. RULES:\n'+rules+'\nREQUEST:\n'+JSON.stringify(request)+'\nDETERMINISTIC FINDINGS:\n'+JSON.stringify(quoteResult.findings);
    let response;
    try { response=await network(endpoint+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:env.OLLAMA_MODEL||'llama3.2',prompt,stream:false,options:{temperature:0,num_predict:96,num_thread:2,num_ctx:2048}}),signal:AbortSignal.timeout(timeoutMs),redirect:'error'});
    } catch { throw bad('Local AI did not respond in time or could not be reached. Retry when the model is ready, or turn off AI explanation to continue with the policy review.',503); }
    if(!response.ok)throw bad('The local model could not complete review ('+response.status+').',503);
    const data=await response.json();if(data.done_reason==='length')throw bad('The local model explanation was cut short. Policy review remains authoritative; try a model that can answer concisely.',503);const summary=String(data.response||'').slice(0,1200).trim();
    if(!summary)throw bad('The local model returned no explanation.',503);
    return {summary,model:env.OLLAMA_MODEL||'llama3.2',advisoryOnly:true};
  }};
}
function creationAttempt(body,kind,request){
 if(body.saveKey===undefined)return null;
 if(typeof body.saveKey!=='string'||! /^[a-f0-9]{64}$/.test(body.saveKey))throw bad('Review the request again before saving.');
 return {keyHash:sha(body.saveKey),payloadHash:sha(canonical({kind,request,expectedOfferRevision:body.expectedOfferRevision??null,revises:body.revises??null,...(body.replaces!==undefined?{replaces:body.replaces}:{})})),kind};
}
function savedBuyerAccess(saveKey,id){
 return crypto.createHmac('sha256',Buffer.from(saveKey,'hex')).update('licenselane-buyer-save-v1:'+id).digest('hex');
}
function createApp(options={}){
  const restoredStudio=studioBackup.restoredIdentity(options.dataFile||DATA_FILE);
  let studioPending=null,studioPreparing=false;
  const recoveryOnly=options.recoveryOnly??(process.env.LICENSELANE_RECOVERY_ONLY==='1');
  const recoveryOrigin=options.recoveryOrigin??process.env.LICENSELANE_RECOVERY_ORIGIN;
  const primaryUrl=options.primaryUrl??process.env.LICENSELANE_PRIMARY_URL;
  if(primaryUrl){
    let url;try{url=new URL(primaryUrl);}catch{throw Error('Recovery primary address requires one exact HTTP(S) origin.');}
    if(!recoveryOnly||!['https:','http:'].includes(url.protocol)||url.origin!==primaryUrl)throw Error('Recovery primary address requires recovery mode and one exact HTTP(S) origin.');
  }
  const installationOrigin=options.installationOrigin??process.env.LICENSELANE_INSTALLATION_ORIGIN??restoredStudio?.origin;
  if(restoredStudio&&installationOrigin!==restoredStudio.origin)throw Error('The restored studio must keep its original installation identity.');
  if(installationOrigin){
    let origin;try{origin=new URL(installationOrigin);}catch{throw Error('Installation identity requires one exact origin.');}
    if(!['https:','http:'].includes(origin.protocol)||origin.origin!==installationOrigin)throw Error('Installation identity requires one exact HTTP(S) origin.');
  }

  const restoredOrigin=(recoveryOnly?undefined:restoredStudio?.origin)??options.restoredOrigin??process.env.LICENSELANE_RESTORED_ORIGIN;
  const restorationId=(recoveryOnly?undefined:restoredStudio?.restorationId)??options.restorationId??process.env.LICENSELANE_RESTORATION_ID;
  if(restoredOrigin||restorationId){
    let origin;try{origin=new URL(restoredOrigin);}catch{throw Error('Restored primary requires its original origin.');}
    if(recoveryOnly||!['https:','http:'].includes(origin.protocol)||origin.origin!==restoredOrigin||!/^[a-f0-9]{64}$/.test(restorationId||''))throw Error('Restored primary requires one exact original origin and restoration identity.');
  }
  const requiresRestoredInspection=license=>!!restorationId&&!!license.orderId&&license.status!=='issued'&&license.restorationChecked!==restorationId;

  const recoveryUrl=options.recoveryUrl??process.env.LICENSELANE_RECOVERY_URL;
  if(recoveryUrl){
    let url;try{url=new URL(recoveryUrl);}catch{throw Error('Recovery address requires an exact HTTPS origin.');}
    if(url.protocol!=='https:'||url.origin!==recoveryUrl)throw Error('Recovery address requires an exact HTTPS origin.');
  }
  if(recoveryOnly){
    let origin;try{origin=new URL(recoveryOrigin);}catch{throw Error('Recovery requires the original installation origin.');}
    if(!['https:','http:'].includes(origin.protocol)||origin.origin!==recoveryOrigin)throw Error('Recovery requires an exact original HTTP(S) origin.');
  }
  const file=options.dataFile||DATA_FILE, paypal=recoveryOnly?{configured:false}:(options.paypal||makePayPal()), ai=recoveryOnly?{configured:false}:(options.ai||makeAI());
  let recoveryInspector=options.recoveryInspector;
  const verifierFile=process.env.LICENSELANE_RECOVERY_VERIFIER_CONFIG;
  if(recoveryOnly&&!recoveryInspector&&verifierFile){
    const stat=fs.statSync(verifierFile);if(!stat.isFile()||(stat.mode&0o077))throw Error('Recovery verifier configuration must be a private file.');
    const config=JSON.parse(fs.readFileSync(verifierFile,'utf8'));
    const provider=makePayPal({PAYPAL_CLIENT_ID:config.clientId,PAYPAL_CLIENT_SECRET:config.clientSecret});
    if(!provider.configured)throw Error('Recovery verifier configuration is incomplete.');
    recoveryInspector={inspect:provider.inspect};
  }
  const receiptDirectory=options.recoveryReceiptsDirectory||process.env.LICENSELANE_RECOVERY_RECEIPTS;
  if(recoveryOnly&&recoveryInspector&&receiptDirectory){const relative=path.relative(path.dirname(path.resolve(file)),path.resolve(receiptDirectory));if(!relative.startsWith('..'+path.sep)&&relative!=='..')throw Error('Recovery receipts must be outside the replaceable checkpoint data directory.');}
  const receipts=recoveryOnly&&recoveryInspector?recoveryReceipts({directory:receiptDirectory,inspect:recoveryInspector.inspect,matchingCapture}):null;
  const briefExtractor=recoveryOnly?{configured:false}:(options.briefExtractor||makeBriefExtractor());
  const checkpoint=recoveryOnly?null:(options.checkpoint??checkpointBarrier(options.checkpointOptions));
  function requireUnexpiredPeriod(current){if(scope.periodState(current.quote.period,(options.calendarDate||scope.today)())==='ended')throw bad('The agreed use period has ended. Request new dates before starting or completing checkout. No payment was sent.',409);}
  function savePayment(current){
    if(checkpoint)current.recoveryVersion=crypto.randomBytes(24).toString('hex');
    saveData({...loadData(file),licenses:{...loadData(file).licenses,[current.id]:current}},file);
  }
  async function retainBeforeCapture(current){
    if(!checkpoint)return;
    if(!current.recoveryVersion)savePayment(current);
    if(!await checkpoint.wait(current)){const error=bad('Recovery copy is still updating. Payment was not sent. Try again shortly using this same saved order.',503);error.code='RECOVERY_CHECKPOINT_PENDING';throw error;}
  }
  async function retainPaymentResult(current){if(checkpoint)await checkpoint.wait(current);}
  function requireRetainedDelivery(current){
    if(current.status==='issued'&&checkpoint&&!checkpoint.acknowledged(current))throw bad('Payment received. Your files are still being saved for recovery. Check this license again shortly.',503);
  }
  const creatorCatalog=createCatalog(file);
  const found=foundUses.create({dataFile:file});
  const allWorks=()=>[...CATALOG,...creatorCatalog.works()];
  // Original bytes live with the persistent license data, not the changing application catalog.
  const originalDir=path.join(path.dirname(file),'approved-assets');
  function storeOriginal(manifest,bytes){
    fs.mkdirSync(originalDir,{recursive:true,mode:0o700});
    const destination=path.join(originalDir,manifest.sha256);
    try{fs.writeFileSync(destination,bytes,{flag:'wx',mode:0o600});}
    catch(e){if(e.code!=='EEXIST')throw e;}
    const stored=fs.readFileSync(destination);
    if(sha(stored)!==manifest.sha256)throw bad('The retained original is damaged. Restore it from the license-data backup; no replacement file was delivered.',409);
  }
  function retainNewAsset(id){
    if(id.startsWith('creator-')){const original=creatorCatalog.original(id);const {content,...manifest}=original;storeOriginal(manifest,content);return manifest;}
    const bytes=fs.readFileSync(path.join(ROOT,'public',catalogById(id).download));
    const manifest=assetDelivery(id,bytes);storeOriginal(manifest,bytes);return manifest;
  }
  function originalBytes(license){
    const manifest=license.assetDelivery;
    if(!manifest||! /^[a-f0-9]{64}$/.test(manifest.sha256||''))throw bad('This older record has no valid approved asset fingerprint. Its certificate remains available.',409);
    try{
      const stored=fs.readFileSync(path.join(originalDir,manifest.sha256));
      if(sha(stored)!==manifest.sha256)throw bad('The retained original is damaged. Restore it from the license-data backup; no replacement file was delivered.',409);
      return stored;
    }catch(e){if(e.code!=='ENOENT')throw e;}
    // Bundled past catalogue editions let older installations skip intermediate
    // migrations without losing the exact file the creator approved.
    let bundled;
    try{bundled=fs.readFileSync(path.join(ROOT,'assets','versions',manifest.sha256));}
    catch(e){if(e.code!=='ENOENT')throw e;}
    if(bundled){
      if(sha(bundled)!==manifest.sha256)throw bad('The bundled original is damaged. Restore the application from its release; no replacement file was delivered.',409);
      if(!recoveryOnly)storeOriginal(manifest,bundled);return bundled;
    }
    // Other legacy records can migrate only while matching bytes remain available.
    let current;
    try{current=fs.readFileSync(path.join(ROOT,'public',catalogById(license.request.assetId).download));}
    catch{throw bad('The approved original is unavailable. Restore its file from backup; no replacement was delivered.',409);}
    if(sha(current)!==manifest.sha256)throw bad('The approved original was not retained before the catalog changed. Restore its file from backup; no replacement was delivered.',409);
    if(!recoveryOnly)storeOriginal(manifest,current);return current;
  }
  function termsDownload(l){
    const lines=['LICENSELANE — SANDBOX DEMONSTRATION', 'No real-money rights or enforceable license created.', '', 'Status: '+l.status, 'Work: '+l.quote.assetTitle, 'Creator: '+l.quote.creator, 'Licensee: '+l.request.licensee, 'Project: '+l.request.project, 'Medium: '+l.request.medium, 'Physical copies: '+l.request.copies, 'Term: '+l.quote.term, 'Territory: '+l.quote.territory, 'Price: USD '+(l.quote.priceCents/100).toFixed(2), 'Policy version: '+l.quote.policyVersion, 'License reference: '+l.id, '', ...(l.policySnapshot||LEGACY_POLICY).map(p=>p.id+' — '+p.title+'\n'+p.text)];
    if(l.quote.period)lines.push('', 'Agreed period: '+scope.periodLabel(l.quote.period),'Start date: '+l.quote.period.startsOn,'Last included date: '+l.quote.period.endsOn,'End boundary (excluded): '+l.quote.period.endsBefore+' 00:00 UTC','Permission applies only after verified payment and within this period.');
    if(l.request.brief)lines.push('', 'BUYER PROJECT BRIEF', l.request.brief);
    if(Number.isSafeInteger(l.assetEdition?.offerRevision))lines.push('', 'Saved offer revision: '+l.assetEdition.offerRevision);
    if(l.status==='withdrawn')lines.push('', 'WITHDRAWN BY BUYER: this proposal cannot be approved or paid.', 'Withdrawn at: '+l.withdrawnAt);
    if(l.replacedBy)lines.push('', 'REPLACED: this proposal cannot be approved or paid.', 'Replacement record: '+l.replacedBy);
    if(l.replaces)lines.push('', 'Replaces proposal: '+l.replaces.id);
    if(l.creatorDecision)lines.push('', 'Creator requested changes at: '+l.creatorDecision.decidedAt, 'Changes needed: '+l.creatorDecision.reason);
    if(l.revisionOf)lines.push('', 'Revises proposal: '+l.revisionOf.id, 'Earlier creator feedback: '+l.revisionOf.reason);
    if(!l.policySnapshot)lines.push('', 'Legacy record: policy wording shown is the current demo policy; no approval-time wording was stored.');
    if(l.assetDelivery){const edition=editionInfo(l);lines.push('', (['requested','changes_requested','superseded','withdrawn'].includes(l.status)?'Proposed edition: ':'Approved edition: ')+edition.label, (['requested','changes_requested','superseded','withdrawn'].includes(l.status)?'Proposed file: ':'Approved file: ')+l.assetDelivery.filename, 'File size: '+l.assetDelivery.bytes+' bytes', 'SHA-256: '+l.assetDelivery.sha256);if(l.assetDelivery.contents)lines.push('Included files:',...l.assetDelivery.contents.map((entry,index)=>(entry.name===null?'File '+(index+1)+' (legacy filename encoding)':JSON.stringify(entry.name))+' — '+entry.bytes+' bytes')); }
    if(l.status==='issued')lines.push('', 'Verified Sandbox capture: '+l.captureId,...(l.receiptVersion===2?['PayPal order: '+l.orderId]:['Verified at: '+l.issuedAt]));
    else lines.push('', 'NOT ISSUED: approval is not evidence of payment or permission to use.');
    return {download:Buffer.from(lines.join('\n')+'\n'),mime:'text/plain; charset=utf-8',filename:'LicenseLane-'+l.id.slice(0,12)+'-terms.txt'};
  }
  // A receipt shows the edition that was saved, even after the catalogue changes.
  // Preview snapshots share the existing content-addressed persistent asset store.
  const originalAtlas='649d0daee02bb0822ada72200856db8d149348648f91523418ac04d29bfb3e17';
  function retainEdition(id){
    if(id.startsWith('creator-')){
      const item=allWorks().find(w=>w.id===id);
      const previews=(item.previews||[item.preview]).map((_,index)=>{const image=creatorCatalog.preview(id,item.offerRevision,index),manifest={filename:'preview-'+index,mime:image.mime,bytes:image.bytes.length,sha256:sha(image.bytes)};storeOriginal(manifest,image.bytes);return manifest;});
      return {label:item.title,specs:item.specs,preview:previews[0],previews,offerRevision:item.offerRevision||1};
    }
    const item=catalogById(id),bytes=fs.readFileSync(path.join(ROOT,'public',item.preview));
    const preview={filename:path.basename(item.preview),mime:item.previewMime||'image/svg+xml',bytes:bytes.length,sha256:sha(bytes)};
    storeOriginal(preview,bytes);
    return {label:item.edition,specs:item.specs,preview};
  }
  function editionInfo(license){
    const manifest=license.assetDelivery;
    let item,isCurrent=null;
    if(!manifest)return {label:'Edition not recorded',previewUrl:null,isCurrent:null};
    // Comparing against today's catalog must not block access to retained paid files.
    // An unavailable catalog means the comparison is unknown, not a changed edition.
    try{
      item=allWorks().find(w=>w.id===license.request.assetId);
      isCurrent=!!item&&manifest.sha256===(item.custom?creatorCatalog.original(item.id).sha256:assetDelivery(item.id).sha256);
    }catch{/* The saved edition and its independently verified bytes remain authoritative. */}
    const historic=manifest.sha256===originalAtlas;
    const snapshot=license.assetEdition||(historic?{label:'Harbour city',specs:'SVG · 1440 × 960 · editable vectors'}:
      isCurrent?{label:item.edition,specs:item.specs}:null);
    const canPreview=!!license.assetEdition?.preview||historic||isCurrent;
    const savedOfferRevision=license.assetEdition?.offerRevision;
    const currentOfferRevision=Number.isSafeInteger(item?.offerRevision)?item.offerRevision:null;
    const isCurrentOffer=Number.isSafeInteger(savedOfferRevision)&&currentOfferRevision!==null?savedOfferRevision===currentOfferRevision:null;
    return {label:snapshot?.label||'Saved edition',specs:snapshot?.specs||null,
      filename:manifest.filename,bytes:manifest.bytes,sha256:manifest.sha256,...(manifest.contents?{contents:manifest.contents}:{}),isCurrent,isCurrentOffer,currentOfferRevision,
      previewUrl:canPreview?'/api/licenses/'+license.id+'/preview':null,
      previewUrls:canPreview?(license.assetEdition?.previews||[license.assetEdition?.preview]).map((_,index)=>'/api/licenses/'+license.id+'/preview?image='+index):[]};
  }
  function editionPreview(license,imageIndex=0){
    const previews=license.assetEdition?.previews||[license.assetEdition?.preview];
    if(!Number.isSafeInteger(imageIndex)||imageIndex<0||imageIndex>=previews.length)throw bad('This saved preview is unavailable.',404);
    const manifest=previews[imageIndex];
    if(manifest){
      let bytes;
      try{bytes=fs.readFileSync(path.join(originalDir,manifest.sha256));}
      catch(e){
        if(e.code!=='ENOENT')throw e;
        const candidate=license.request.assetId.startsWith('creator-')?creatorCatalog.preview(license.request.assetId,license.assetEdition?.offerRevision,imageIndex).bytes:fs.readFileSync(path.join(ROOT,'public',catalogById(license.request.assetId).preview));
        if(sha(candidate)!==manifest.sha256)throw bad('The saved edition preview is unavailable. The approved file details remain below.',409);
        if(!recoveryOnly)storeOriginal(manifest,candidate);bytes=candidate;
      }
      if(sha(bytes)!==manifest.sha256)throw bad('The saved edition preview is damaged. The approved file details remain below.',409);
      return {preview:bytes,mime:manifest.mime};
    }
    // The known original Atlas was already a free MIT sample, not a gated original.
    if(license.assetDelivery?.sha256===originalAtlas)return {preview:originalBytes(license),mime:'image/svg+xml'};
    if(editionInfo(license).isCurrent){const item=catalogById(license.request.assetId);return {preview:fs.readFileSync(path.join(ROOT,'public',item.preview)),mime:item.previewMime||'image/svg+xml'};}
    throw bad('No preview was retained for this earlier edition. Use its saved file details.',409);
  }
  for(const license of Object.values(loadData(file).licenses)){
    if(license.assetDelivery){try{originalBytes(license);}catch{/* Missing legacy originals remain explicitly unavailable; other records can still open. */}}
  }
  const pending=new Map();
  const creatorCode=options.creatorCode===undefined?process.env.CREATOR_PASSCODE:options.creatorCode;
  function authorize(req,body){
    if(creatorCode){
      const a=Buffer.from(String(body.creatorCode||''));const b=Buffer.from(String(creatorCode));
      if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw bad('Creator approval code is incorrect.',403);
    } else if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)){
      throw bad('Creator changes require CREATOR_PASSCODE outside local use.',403);
    }
  }
  function validBuyerAccess(license,token){
    if(!license.buyerTokenHash||typeof token!=='string'||! /^[a-f0-9]{64}$/.test(token))return false;
    const actual=Buffer.from(sha(token),'hex'),expected=Buffer.from(license.buyerTokenHash,'hex');
    return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);
  }
  function authorizeCheckout(req,body,license){
    if(validBuyerAccess(license,body.buyerAccessToken)){
      if(['requested','changes_requested'].includes(license.status))throw bad('The creator must approve the saved terms before buyer checkout.',409);
      return;
    }
    // Existing creator-operated demonstrations remain compatible.
    // Supplying an invalid buyer capability must never fall through to local demo authorization.
    if(body.buyerAccessToken!==undefined)throw bad('Buyer access is invalid for this record.',403);
    if(license.buyerTokenHash&&!creatorCode)throw bad('Use the private buyer access for this record.',403);
    authorize(req,body);
  }
  function locked(key,fn){
    if(pending.has(key))return pending.get(key);
    const p=Promise.resolve().then(fn).finally(()=>pending.delete(key));pending.set(key,p);return p;
  }
  async function readBody(req){
    const catalogPath=new URL(req.url,'http://localhost').pathname;
    const limit=/^\/api\/creator\/catalog(?:\/creator-[a-f0-9-]+)?$/.test(catalogPath)?12*1024*1024:catalogPath==='/api/found/analyze'?4*1024*1024:16384;
    let chunks=[],bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>limit)throw bad('Request exceeds the allowed size.',413);chunks.push(chunk);}
    try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw bad('Malformed JSON.');}
  }
  async function action(req,method,pathname,body,briefSignal,onBriefProgress,onBriefScope){
    if(recoveryOnly&&method!=='GET'&&!(method==='POST'&&/^\/api\/licenses\/[a-f0-9]{64}\/(buyer-access|check-payment)$/.test(pathname)))throw bad('This recovery copy can open saved licenses and files, but cannot change agreements or payments.',423);
    const data=loadData(file);
    if(pathname.startsWith('/api/found/')){
      const listed=()=>{const {includeDemoWorks}=creatorCatalog.settings();return allWorks().filter(w=>w.offerStatus!=='paused'&&(w.custom||(includeDemoWorks&&listedBundledWorks.has(w.id))));};
      return found.handle({method,pathname,body,data,req,authorize,works:listed,inspectOrder:license=>paypal.inspect(license)});
    }
    if(method==='GET'&&pathname==='/api/config')return {paypalConfigured:paypal.configured,aiConfigured:ai.configured,briefConfigured:briefExtractor.configured,creatorCodeRequired:!!creatorCode,sandboxOnly:true,...(recoveryUrl?{recoveryUrl}:{}),...(restoredOrigin?{restoredOrigin}:{}),...(installationOrigin?{installationOrigin}:{}),...(recoveryOnly?{recoveryOnly:true,recoveryOrigin,...(primaryUrl?{primaryUrl}:{}),recoveryPaymentCheckConfigured:!!receipts}:{})};
    if(method==='GET'&&pathname==='/api/catalog'){
      try{const {includeDemoWorks}=creatorCatalog.settings();return {works:allWorks().filter(w=>w.offerStatus!=='paused'&&(w.custom||(includeDemoWorks&&listedBundledWorks.has(w.id)))),policy:PERIOD_POLICY};}
      catch(error){
        if(!recoveryOnly)throw error;
        // Recovery opens retained records; a damaged live offer index must not block it.
        return {works:AUTHORED_CATALOG,policy:PERIOD_POLICY};
      }
    }
    if(method==='GET'&&pathname==='/api/creator/catalog')return {works:creatorCatalog.works(),settings:creatorCatalog.settings()};
    const catalogWorkMatch=pathname.match(/^\/api\/catalog\/([a-z0-9-]+)$/);
    if(method==='GET'&&catalogWorkMatch){
      const work=allWorks().find(w=>w.id===catalogWorkMatch[1]);
      if(!work)throw bad('This work is no longer available. Choose another work.',404);
      return {work};
    }
    const previewMatch=pathname.match(/^\/api\/catalog\/(creator-[a-f0-9-]+)\/preview$/);
    if(method==='GET'&&previewMatch){
      const offered=new URL(req.url,'http://localhost').searchParams.get('offer');
      if(offered!==null&&!/^[1-9][0-9]*$/.test(offered))throw bad('Invalid offer preview revision.');
      const imageIndex=new URL(req.url,'http://localhost').searchParams.get('image');
      if(imageIndex!==null&&!/^[0-5]$/.test(imageIndex))throw bad('Invalid preview image.');
      const im=creatorCatalog.preview(previewMatch[1],offered===null?undefined:Number(offered),imageIndex===null?0:Number(imageIndex));
      return {download:im.bytes,mime:im.mime,filename:'preview',inline:true};
    }
    const catalogUpdate=pathname.match(/^\/api\/creator\/catalog\/(creator-[a-f0-9-]+)(?:\/(status))?$/);
    if(method==='POST'&&(pathname==='/api/creator/catalog'||pathname==='/api/creator/catalog/settings'||catalogUpdate)){
      if(!String(req.headers['content-type']||'').startsWith('application/json'))throw bad('Catalog changes require a JSON request.',415);
      if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host&&req.headers.origin!=='https://'+req.headers.host)throw bad('Open the creator desk on this installation before saving.',403);
      authorize(req,body);if(pathname==='/api/creator/catalog/settings')return {settings:creatorCatalog.setSettings(body)};return {work:catalogUpdate?(catalogUpdate[2]?creatorCatalog.setStatus(catalogUpdate[1],body):creatorCatalog.update(catalogUpdate[1],body)):creatorCatalog.add(body)};}
    if(method==='POST'&&pathname==='/api/creator/inbox'){authorize(req,body);return creatorInbox(data.licenses,body);}
    if(method==='POST'&&pathname==='/api/brief'){
      if(typeof body.brief!=='string'||body.brief.trim().length<10||body.brief.length>4000)throw bad('Enter a buyer brief between 10 and 4000 characters.');
      try{return await briefExtractor.extract(body.brief,{signal:briefSignal,onProgress:onBriefProgress,onScope:onBriefScope});}catch(e){if(e.code==='BRIEF_BUSY')throw bad('The local model is already reading another brief. Try suggestions again shortly.',503);const unavailable=bad('Buyer brief suggestions are unavailable. Fill in the request manually; no fields or rights were changed.',503);if(e.modelCosts)unavailable.modelCosts=e.modelCosts;throw unavailable;}
    }
    if(method==='POST'&&pathname==='/api/review'){
      const works=allWorks(),request=normalize(body,works),work=works.find(w=>w.id===request.assetId);
      requireOfferActive(work);const result=quote(request,works);
      let commentary=null,modelWarning=null;
      if(body.useAI===true){
        try{commentary=await ai.review(request,result);}
        catch{modelWarning='The local AI explanation is unavailable. The published policy checks are shown below. No AI explanation was generated. Check that Ollama is running and the configured model is installed, then review again to retry.';}
      }
      const current=allWorks().find(w=>w.id===request.assetId);
      requireOfferActive(current);
      if(work.custom&&current?.offerRevision!==result.offerRevision)offerChanged(current);
      return {request,quote:result,work,modelReview:commentary,modelWarning,reviewType:commentary?'real-local-model-plus-rules':'deterministic-policy-rules'};
    }
    if(method==='POST'&&pathname==='/api/licenses/recover'){
      authorize(req,body);
      if(typeof body.saveKey!=='string'||!/^[a-f0-9]{64}$/.test(body.saveKey))throw bad('Use the private recovery handle for this approval.');
      const keyHash=sha(body.saveKey),license=Object.values(data.licenses).find(saved=>saved.saveAttempt?.kind==='approval'&&saved.saveAttempt.keyHash===keyHash);
      if(!license)throw bad('The original approval save is not available yet. No new approval was submitted.',404);
      return {license};
    }
    if(method==='POST'&&pathname==='/api/requests/recover'){
      if(typeof body.saveKey!=='string'||!/^[a-f0-9]{64}$/.test(body.saveKey))throw bad('Use the private recovery handle for this proposal.');
      const keyHash=sha(body.saveKey),license=Object.values(data.licenses).find(saved=>saved.saveAttempt?.kind==='proposal'&&saved.saveAttempt.keyHash===keyHash);
      if(!license)throw bad('The original proposal save is not available yet. No new proposal was submitted.',404);
      const buyerAccessToken=savedBuyerAccess(body.saveKey,license.id);
      if(sha(buyerAccessToken)!==license.buyerTokenHash)throw bad('The saved request could not restore its private access.',409);
      return {license,buyerAccessToken};
    }
    if(method==='POST'&&(pathname==='/api/licenses'||pathname==='/api/requests')){
      const proposed=pathname==='/api/requests';
      if(!proposed){authorize(req,body);if(body.creatorApproved!==true)throw bad('Creator must explicitly approve the exact terms.');}
      const works=allWorks(),request=normalize(body.request,works),work=works.find(w=>w.id===request.assetId);
      let replaced=null;
      if(body.replaces!==undefined){
        if(!proposed||body.revises!==undefined||typeof body.replaces!=='string'||! /^[a-f0-9]{64}$/.test(body.replaces))throw bad('Choose one pending buyer proposal to replace.',400);
        replaced=data.licenses[body.replaces];
        if(!replaced||!validBuyerAccess(replaced,body.buyerAccessToken))throw bad('Restore private buyer access to replace this proposal.',403);
        if(!body.saveKey)throw bad('Review this correction again before saving.',400);
      }
      const saveAttempt=creationAttempt(body,proposed?'proposal':'approval',request);
      const previous=saveAttempt&&Object.values(data.licenses).find(saved=>saved.saveAttempt?.keyHash===saveAttempt.keyHash);
      if(previous){
        if(previous.saveAttempt.payloadHash!==saveAttempt.payloadHash)throw bad('These terms differ from the earlier save attempt. Review the request again before saving.',409);
        const buyerAccessToken=proposed?savedBuyerAccess(body.saveKey,previous.id):null;
        if(proposed&&sha(buyerAccessToken)!==previous.buyerTokenHash)throw bad('The saved request could not restore its private access. Keep your existing recovery file.',409);
        return {license:previous,...(buyerAccessToken?{buyerAccessToken}:{}),replayed:true};
      }
      if(replaced){
        if(pending.has(replaced.id)||replaced.status!=='requested')throw bad('This proposal has already changed. Refresh its saved terms before correcting it.',409);
        if(canonical(replaced.request)===canonical(request))throw bad('Change the scope before replacing the proposal.',409);
      }
      requireOfferRevision(work,body.expectedOfferRevision);
      const q=quote(request,works);if(!q.eligible)throw bad('Creator cannot approve terms outside the published instant policy.',409);
      let revisionOf;
      if(body.revises!==undefined){
        if(!proposed)throw bad('A revised proposal must be saved for a new creator decision.',409);
        if(typeof body.revises!=='string'||! /^[a-f0-9]{64}$/.test(body.revises))throw bad('Invalid original proposal reference.');
        revisionOf=revisionLink(data.licenses[body.revises],request);
      }
      const id=sha(canonical({request,policyVersion:q.policyVersion,quoteCents:q.priceCents,nonce:crypto.randomUUID()}));
      const buyerAccessToken=proposed?(saveAttempt?savedBuyerAccess(body.saveKey,id):crypto.randomBytes(32).toString('hex')):null;
      const l={id,request,quote:q,status:proposed?'requested':'approved',createdAt:new Date().toISOString(),orderId:null,captureId:null,assetDelivery:retainNewAsset(request.assetId),assetEdition:retainEdition(request.assetId),policySnapshot:policyFor(request).map(p=>({...p})),paypalCreateRequestId:'ll-create-'+id.slice(0,24)};
      if(revisionOf)l.revisionOf=revisionOf;
      if(buyerAccessToken)l.buyerTokenHash=sha(buyerAccessToken);
      if(saveAttempt)l.saveAttempt=saveAttempt;
      if(replaced){l.replaces={id:replaced.id};data.licenses[replaced.id]={...replaced,status:'superseded',replacedBy:id,supersededAt:l.createdAt};}
      data.licenses[id]=l;saveData(data,file);return {license:l,...(buyerAccessToken?{buyerAccessToken}:{})};
    }
    const match=pathname.match(/^\/api\/licenses\/([a-f0-9]{64})(?:\/(status|buyer-access|check-payment|approve|withdraw|request-changes|order|capture|reconcile|recover-order|certificate|asset|terms|purchase|preview))?$/);
    if(!match)throw bad('No such route.',404);
    const [,id,operation]=match;const l=receipts?receipts.resolve(data.licenses[id]):data.licenses[id];
    if(!l)throw bad('No such license.',404);
    if(method==='POST'&&operation==='check-payment'){
      if(!receipts)throw bad('Independent payment inspection is unavailable.',503);
      return locked(id,async()=>{const license=await receipts.check(loadData(file).licenses[id]);return {license,certificate:certificate(license)};});
    }
    if(method==='GET'&&operation==='status')return {id:l.id,status:l.status};
    if(method==='GET'&&!operation)return {license:l,certificate:certificate(l)};
    if(method==='GET'&&operation==='preview'){const imageIndex=new URL(req.url,'http://localhost').searchParams.get('image');if(imageIndex!==null&&!/^[0-5]$/.test(imageIndex))throw bad('Invalid preview image.');return editionPreview(l,imageIndex===null?0:Number(imageIndex));}
    if(method==='GET'&&operation==='asset'){
      if(l.status!=='issued')throw bad('No asset download before verified payment.',409);
      requireRetainedDelivery(l);
      if(!l.assetDelivery)throw bad('This older record has no approved asset fingerprint. Its certificate remains available.',409);
      return {download:originalBytes(l),mime:l.assetDelivery.mime,filename:l.assetDelivery.filename};
    }
    if(method==='GET'&&operation==='terms'){requireRetainedDelivery(l);return termsDownload(l);}
    if(method==='GET'&&operation==='purchase'){
      if(l.status!=='issued')throw bad('No purchase download before verified payment.',409);
      requireRetainedDelivery(l);
      const original=originalBytes(l),terms=termsDownload(l);
      return {download:purchaseArchive({original,filename:l.assetDelivery.filename,terms,certificate:certificate(l)}),mime:'application/zip',filename:'LicenseLane-'+id.slice(0,12)+'-purchase.zip'};
    }
    if(method==='GET'&&operation==='certificate'){if(l.status!=='issued')throw bad('No certificate before verified payment.',409);requireRetainedDelivery(l);return {certificate:certificate(l),policy:l.policySnapshot||LEGACY_POLICY};}
    if(method!=='POST')throw bad('Method not allowed.',405);
    if(operation==='buyer-access'){
      if(!validBuyerAccess(l,body.buyerAccessToken))throw bad('Buyer access is invalid for this record.',403);
      return {license:l,certificate:certificate(l)};
    }
    if(operation==='withdraw'){
      if(!validBuyerAccess(l,body.buyerAccessToken))throw bad('Restore private buyer access to withdraw this proposal.',403);
      if(body.buyerWithdrawn!==true)throw bad('Confirm withdrawal of these saved terms.',400);
      if(l.status==='withdrawn')return {license:l,certificate:null};
      if(pending.has(id)||l.status!=='requested')throw bad('This proposal has already changed. Refresh its saved terms before withdrawing it.',409);
      const withdrawn={...l,status:'withdrawn',withdrawnAt:new Date().toISOString()};
      data.licenses[id]=withdrawn;saveData(data,file);return {license:withdrawn,certificate:null};
    }
    if(['order','capture','reconcile','recover-order'].includes(operation))authorizeCheckout(req,body,l);
    else authorize(req,body);
    if(operation==='request-changes')return locked(id,async()=>{
      const latest=loadData(file),current=latest.licenses[id];
      const updated=requestChanges(current,body.reason,body.creatorConfirmed);
      latest.licenses[id]=updated;saveData(latest,file);
      return {license:updated,certificate:null};
    });
    if(operation==='approve')return locked(id,async()=>{
      const current=loadData(file).licenses[id];
      if(current.status==='approved')return {license:current};
      if(current.status!=='requested')throw bad('Only a pending proposal can be approved.',409);
      if(body.creatorApproved!==true)throw bad('Creator must explicitly approve these saved terms.');
      const currentWorks=allWorks();requireOfferActive(currentWorks.find(w=>w.id===current.request.assetId));
      const fresh=quote(current.request,currentWorks),comparable={...fresh};
      // Pre-revision records can still be approved while their unchanged first offer remains current.
      if(current.quote.offerRevision===undefined&&fresh.offerRevision===1)delete comparable.offerRevision;
      if(!fresh.eligible||canonical(comparable)!==canonical(current.quote)||canonical(policyFor(current.request))!==canonical(current.policySnapshot))throw bad('The published terms changed. Ask the buyer to review and save a new proposal.',409);
      current.status='approved';current.approvedAt=new Date().toISOString();
      saveData({...loadData(file),licenses:{...loadData(file).licenses,[id]:current}},file);
      return {license:current};
    });
    if(operation==='order')return locked(id,async()=>{
      const current=loadData(file).licenses[id];
      if(current.status==='issued'||current.status==='awaiting_payment')return {license:current};
      if(current.status!=='approved')throw bad('Checkout was started earlier and needs manual reconciliation, not a new order.',409);
      requireUnexpiredPeriod(current);
      current.status='creating_order';savePayment(current);
      try{
        const order=await paypal.create(current);
        if(!/^[A-Za-z0-9]+$/.test(order.id||''))throw bad('PayPal returned no valid order ID.',502);
        const approve=(order.links||[]).find(x=>x.rel==='approve'||x.rel==='payer-action');
        current.orderId=order.id;current.approvalUrl=approve?.href||null;current.status='awaiting_payment';delete current.lastError;
      }catch(e){current.status=e.paypalRequestNotSent===true?'approved':'order_unknown';current.lastError=e.message;}
      savePayment(current);
      return {license:current};
    });
    if(operation==='recover-order')return locked(id,async()=>{
      const current=loadData(file).licenses[id];
      if(current.orderId||!['order_unknown','creating_order'].includes(current.status))throw bad('Only an unresolved order creation can be recovered here. Inspect the saved order instead.',409);
      const candidate=String(body.orderId||'').trim();
      if(!/^[A-Za-z0-9]{6,64}$/.test(candidate))throw bad('Enter the existing PayPal Sandbox order ID, not a request reference or URL.');
      // Read-only provider inspection: never create another order or capture payment here.
      const order=await paypal.inspect({...current,orderId:candidate});
      const units=order?.purchase_units;
      const unit=Array.isArray(units)&&units.length===1?units[0]:null;
      if(order?.id!==candidate||order.intent!=='CAPTURE'||unit?.custom_id!==current.id||unit.amount?.currency_code!=='USD'||unit.amount?.value!==(current.quote.priceCents/100).toFixed(2))throw bad('This order does not match the saved license reference and exact approved amount. Nothing was changed.',409);
      if(!['CREATED','APPROVED','PAYER_ACTION_REQUIRED','COMPLETED'].includes(order.status))throw bad('This order cannot continue checkout in its current PayPal state. Nothing was changed.',409);
      if(order.status==='COMPLETED'&&!verifyPayment(order,{...current,orderId:candidate}))throw bad('The completed order has no matching verified capture. Nothing was changed.',409);
      current.orderId=candidate;
      current.approvalUrl=(order.links||[]).find(link=>['approve','payer-action'].includes(link.rel))?.href||null;
      current.status='awaiting_payment';
      current.orderRecoveredAt=new Date().toISOString();
      delete current.lastError;
      if(order.status==='COMPLETED'){
        current.captureId=matchingCapture(order,current).id;
        current.status='issued';current.receiptVersion=2;current.issuedAt=new Date().toISOString();
      }
      savePayment(current);
      await retainPaymentResult(current);
      return {license:current,certificate:certificate(current)};
    });
    if(operation==='capture')return locked(id,async()=>{
      const current=loadData(file).licenses[id];
      if(current.status==='issued')return {license:current,certificate:certificate(current)};
      if(current.status!=='awaiting_payment'||!current.orderId)throw bad('A known PayPal order must be approved before capture.',409);
      if(requiresRestoredInspection(current))throw bad('Inspect the existing order before continuing this restored payment. No payment was sent.',409);
      requireUnexpiredPeriod(current);
      delete current.captureBlocked;current.status='capture_unknown';savePayment(current);
      try{await retainBeforeCapture(current);}
      catch(error){
        // No provider request has been sent; preserve the same approved order for an explicit retry.
        current.status='awaiting_payment';current.captureBlocked='recovery_pending';savePayment(current);
        throw error;
      }
      try{requireUnexpiredPeriod(current);}catch(error){current.status='awaiting_payment';savePayment(current);throw error;}
      try{await paypal.capture(current);}catch(e){current.lastError=e.message;}
      try{
        const order=await paypal.inspect(current);
        if(verifyPayment(order,current)){
          current.captureId=matchingCapture(order,current)?.id||null;
          if(!current.captureId)throw bad('Completed capture lacked a receipt ID.',502);
          current.status='issued';current.receiptVersion=2;current.issuedAt=new Date().toISOString();delete current.lastError;
        }
      }catch(e){current.lastError=e.message;}
      savePayment(current);
      await retainPaymentResult(current);
      return {license:current,certificate:certificate(current)};
    });
    if(operation==='reconcile')return locked(id,async()=>{
      const current=loadData(file).licenses[id];
      if(current.status==='issued')return {license:current,certificate:certificate(current)};
      if(!current.orderId)throw bad('Order ID is unknown; do not repeat creation without PayPal reconciliation.',409);
      const order=await paypal.inspect(current);
      if(requiresRestoredInspection(current)){
        if(!matchingOrder(order,current)||!['APPROVED','COMPLETED'].includes(order.status)||(order.status==='COMPLETED'&&!verifyPayment(order,current)))throw bad('The existing order could not be verified. No payment was sent.',409);
        current.restorationChecked=restorationId;
      }
      if(verifyPayment(order,current)){
        const capture=matchingCapture(order,current);
        current.captureId=capture?.id;
        if(current.captureId){current.status='issued';current.receiptVersion=2;current.issuedAt=new Date().toISOString();delete current.lastError;}
      }else if(matchingOrder(order,current)&&current.status==='capture_unknown'&&order.status==='APPROVED'){current.status='awaiting_payment';}
      savePayment(current);
      await retainPaymentResult(current);
      return {license:current,certificate:certificate(current)};
    });
    throw bad('No such route.',404);
  }
  return http.createServer(async(req,res)=>{
    let briefCancellation,writeBrief;
    const abandonBrief=()=>{if(!res.writableEnded)briefCancellation?.abort();};
    try{
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(req.method==='POST'&&pathname==='/api/brief'){briefCancellation=new AbortController();res.once('close',abandonBrief);}
      if(req.method==='GET'&&pathname==='/offline-shell.js'){const script=require('./lib/offline-shell')(ROOT);res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-cache','Service-Worker-Allowed':'/','X-Content-Type-Options':'nosniff'});res.end(script);return;}
      if(!pathname.startsWith('/api/')){
        const filename=pathname==='/'?'index.html':pathname.slice(1);
        if(recoveryOnly&&filename==='creator.html'){res.writeHead(302,{Location:'/'});res.end();return;}
        const assetFiles=['lantern-atlas.svg','blue-hour.svg','blue-hour.wav','copper-signal.svg','copper-signal.zip','ASSETS.md',...AUTHORED_CATALOG.flatMap(work=>[work.preview.slice('/assets/'.length),work.download.slice('/assets/'.length)])];
        if(!['buyer-decision.js','license-price.js','license-scope.js','request-scope.js','proposal-handoff.css','proposal-handoff.js','delivery-details.js','delivery-details.css','zip-inventory.js','gallery.css','certificate.css','certificate.js','fonts/InstrumentSans.ttf','fonts/OFL-InstrumentSans.txt','buyer-catalog.js','paid-record.js','paid-record.css','desk-navigation.js','creator.html','creator.js','found.html','found.js','found.css','found-offer.js','creator-previews.js','creator.css','index.html','asset-inspector.js','asset-inspector.css','app.js','records-backup.js','record-handoff.js','brief.js','brief-selection.js','edition.js','revision-comparison.js','creator-inbox.js','proposal-revisions.js','draft.js','style.css'].includes(filename)&&!assetFiles.some(name=>filename==='assets/'+name))throw bad('Not found.',404);
        const type=filename.endsWith('.ttf')?'font/ttf':filename.endsWith('.txt')?'text/plain; charset=utf-8':filename.endsWith('.svg')?'image/svg+xml':filename.endsWith('.png')?'image/png':filename.endsWith('.wav')?'audio/wav':filename.endsWith('.zip')?'application/zip':filename.endsWith('.md')?'text/markdown':filename.endsWith('.css')?'text/css':filename.endsWith('.js')?'application/javascript':'text/html';
        const payload=fs.readFileSync(path.join(ROOT,'public',filename));
        res.writeHead(200,{'Content-Type':type,'Content-Length':payload.length,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'"});res.end(payload);return;
      }
      if(pathname==='/api/creator/studio-backup'&&req.method==='POST'){
        if(recoveryOnly)throw bad('Back up the primary studio installation.',423);
        if(!String(req.headers['content-type']||'').startsWith('application/json'))throw bad('Studio backup requires a JSON request.',415);
        if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host&&req.headers.origin!=='https://'+req.headers.host)throw bad('Open the creator desk on this installation first.',403);
        authorize(req,await readBody(req));
        if(studioPreparing)throw bad('A studio backup is already being prepared.',409);
        studioPreparing=true;
        try{
          if(studioPending){clearTimeout(studioPending.timer);await studioPending.backup.cleanup();studioPending=null;}
          const origin=installationOrigin||restoredOrigin||(req.socket.encrypted?'https://':'http://')+req.headers.host;
          const backup=await studioBackup.snapshot({dataFile:file,origin,commit:options.sourceCommit||studioBackup.sourceCommit(ROOT)});
          const token=crypto.randomBytes(32).toString('hex');
          const entry={token,backup,timer:setTimeout(()=>{if(studioPending===entry)studioPending=null;backup.cleanup().catch(()=>{});},120000)};entry.timer.unref();studioPending=entry;
          res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({download:'/api/creator/studio-backup/'+token,files:backup.files,bytes:backup.bytes}));return;
        }finally{studioPreparing=false;}
      }
      const studioDownload=pathname.match(/^\/api\/creator\/studio-backup\/([a-f0-9]{64})$/);
      if(studioDownload&&req.method==='GET'){
        const entry=studioPending;if(!entry||entry.token!==studioDownload[1])throw bad('This download expired. Prepare another studio backup.',404);
        studioPending=null;clearTimeout(entry.timer);
        try{res.writeHead(200,{'Content-Type':'application/gzip','Content-Length':entry.backup.bytes,'Content-Disposition':contentDisposition('LicenseLane-studio-'+entry.backup.sha256+'.tar.gz'),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});await require('node:stream/promises').pipeline(fs.createReadStream(entry.backup.archive),res);}
        finally{await entry.backup.cleanup();}return;
      }
      const originalUpload=pathname.match(/^\/api\/creator\/originals\/([a-f0-9]{64})$/);
      if(originalUpload&&['GET','PUT'].includes(req.method)){
        if(recoveryOnly)throw bad('Original uploads are unavailable on the recovery copy.',423);
        if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host&&req.headers.origin!=='https://'+req.headers.host)throw bad('Open the creator desk on this installation before saving.',403);
        let uploadCode=req.headers['x-creator-code'];
        if(req.headers['x-creator-code-encoded']!==undefined){
          try{uploadCode=decodeURIComponent(req.headers['x-creator-code-encoded']);}
          catch{throw bad('Creator approval code is incorrect.',403);}
        }
        authorize(req,{creatorCode:uploadCode});
        let value;
        if(req.method==='GET')value=creatorCatalog.uploads.status(originalUpload[1]);
        else{
          if(req.headers['content-type']!=='application/octet-stream')throw bad('Original uploads require file bytes.',415);
          let name;try{name=decodeURIComponent(req.headers['x-original-name']||'');}catch{throw bad('Invalid original filename.');}
          value=await creatorCatalog.uploads.receive(req,originalUpload[1],name,Number(req.headers['x-original-bytes']??req.headers['content-length']));
        }
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));return;
      }
      const method=req.method,body=method==='POST'?await readBody(req):{};
      if(briefCancellation&&String(req.headers.accept||'').split(',').some(type=>type.trim().split(';')[0]==='application/x-ndjson')){
        writeBrief=(type,data)=>{
          if(res.destroyed)return;
          if(!res.headersSent)res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Accel-Buffering':'no'});
          res.write(JSON.stringify({type,data})+'\n');
        };
      }
      const value=await action(req,method,pathname,body,briefCancellation?.signal,writeBrief?data=>writeBrief('partial',data):undefined,writeBrief?data=>writeBrief('scope',data):undefined);
      if(res.destroyed)return;
      if(writeBrief){writeBrief('complete',value);res.end();return;}
      if(value.preview){res.writeHead(200,{'Content-Type':value.mime,'Content-Length':value.preview.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(value.preview);return;}
      if(value.license){
        value.license={...value.license,...(requiresRestoredInspection(value.license)?{restoration:{state:'inspection_required'}}:{}),edition:editionInfo(value.license),...(checkpoint&&value.license.recoveryVersion?{recovery:{state:checkpoint.acknowledged(value.license)?'ready':'pending'}}:{})};
        if(value.license.status==='issued'&&value.license.recovery?.state==='pending')value.certificate=null;
      }
      if(value.download){res.writeHead(200,{'Content-Type':value.mime,'Content-Disposition':contentDisposition(value.filename,value.inline),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(value.download);return;}
      if(value.license)value.license={...value.license,buyerAccessEnabled:!!value.license.buyerTokenHash};
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value,(key,item)=>['buyerTokenHash','saveAttempt','recoveryVersion','restorationChecked'].includes(key)?undefined:item));
    }catch(e){
      if(res.destroyed)return;
      const status=e.status||500,error={error:status>=500&&status!==502&&status!==503?'Server error.':e.message,...(briefCancellation&&e.modelCosts?{modelCosts:e.modelCosts}:{}),...(['OFFER_CHANGED','OFFER_PAUSED','RECOVERY_CHECKPOINT_PENDING'].includes(e.code)?{code:e.code,...(e.work?{work:e.work}:{})}:{})};
      if(writeBrief&&res.headersSent){writeBrief('error',error);res.end();return;}
      res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(error));
    }
    finally{if(briefCancellation)res.off('close',abandonBrief);}
  });
}
if(require.main===module){
  const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||8787);
  if(host!=='127.0.0.1'&&host!=='::1'&&!process.env.CREATOR_PASSCODE){console.error('CREATOR_PASSCODE required on non-loopback hosts.');process.exit(2);}
  createApp().listen(port,host,()=>console.log('LicenseLane listening on http://'+host+':'+port+' (PayPal Sandbox only)'));
}
module.exports={createApp,normalize,quote,verifyPayment,certificate,makePayPal,makeAI,CATALOG,POLICY};
