'use strict';
const {buildBriefRequest,decodeBriefResponse,sourcePassages,FIELD_TOPICS}=require('./brief-request');
const FIELDS=['medium','copies','training','exclusive','attribution','termMonths','territory'];
const licenseScope=require('../public/license-scope');
const {readBriefCost}=require('./brief-cost');

function retiredPlanLabel(text){
 const labels=/\b(?:previous|earlier|old|withdrawn|cancelled|canceled|superseded|rejected|abandoned|discarded|scrapped)\s+(?:(?:print|physical|digital|website|web|social(?:\s+media)?)\s+)?(?:plan|draft|order|request|scope|version)\b/gi;
 for(const match of text.matchAll(labels)){
  // "Not abandoned" keeps the plan current; its quantity still conflicts.
  if(/\b(?:not|never)\s+$|n['’]t\s+$/i.test(text.slice(0,match.index)))continue;
  return match;
 }
 return null;
}

function tentativePlanLabel(text){
 return /\b(?:proposed|provisional|tentative|unconfirmed)\s+(?:(?:print|physical|digital|website|web|social(?:\s+media)?)\s+)?(?:use|plan|draft|order|request|scope|version)\b/i.exec(text);
}

// Inspect the clause containing the quoted field, including words the model
// clipped from the quote. This only withholds unsupported suggestions; it never
// fills a missing field or changes a model's value.
function sourceClause(brief,evidence,topic,position){
 const quoteStart=Number.isInteger(position)?position:brief.indexOf(evidence), match=topic.exec(evidence);
 const anchor=quoteStart+(match?match.index:0);
 const boundaries=/[.!?;\n,]|\b(?:and|but|however|whereas)\b/gi;
 let start=0,end=brief.length,separator;
 while((separator=boundaries.exec(brief))){
  if([',','.'].includes(separator[0])&&/\d/.test(brief[separator.index-1]||'')&&/\d/.test(brief[separator.index+1]||''))continue;
  if(separator.index+separator[0].length<=anchor)start=separator.index+separator[0].length;
  else if(separator.index>anchor){end=separator.index;break;}
 }
 let clause=brief.slice(start,end);
 // A leading condition can precede a comma: "If sales improve, print 850".
 const sentenceStart=Math.max(brief.lastIndexOf('.',anchor-1),brief.lastIndexOf('!',anchor-1),brief.lastIndexOf('?',anchor-1),brief.lastIndexOf(';',anchor-1),brief.lastIndexOf('\n',anchor-1))+1;
 const prefix=brief.slice(sentenceStart,start).trim();
 if(/^(?:if|unless)\b/i.test(prefix)&&!/\b(?:but|however|whereas)\b/i.test(prefix))clause=prefix+' '+clause;
 // A retired or tentative plan also governs its following clauses. A comma
 // cannot turn an unconfirmed plan's copy count into a current request.
 const plan=retiredPlanLabel(prefix)||tentativePlanLabel(prefix);
 if(plan&&/^(?:(?:the|our)\s+)?$/i.test(prefix.slice(0,plan.index))&&!/\b(?:but|however|whereas)\b/i.test(prefix))clause=prefix+' '+clause;
 // A trailing condition can follow it: "Print 850, if sales improve".
 const tail=brief.slice(end).match(/^,\s*((?:if|unless)\b[^.!?;\n]*)/i);
 if(tail)clause+=' '+tail[1];
 return clause;
}

// Keep the complete named scope and validate its explicit source context.

const numberWords={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const numberPhrase='(?:\\d+(?:\\.\\d+)?|one[ -]hundred(?:[ -](?:and[ -])?(?:twenty|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)))?|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)';
const escapePattern=value=>value.replace(/[.*+?^$}{()|[\]\\]/g,'\\$&');
function explicitDurationCandidates(text){
 const pattern=new RegExp('(?<![\\p{L}\\p{N}.,/])('+numberPhrase+')[ -]+(months?|years?)\\b','giu'),result=[];
 for(const match of text.matchAll(pattern)){
  const before=text.slice(0,match.index);
  if(/(?:\d|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:[-–—/]|or|to)\s*$/i.test(before))continue;
  let number;
  if(/^\d/.test(match[1]))number=Number(match[1]);
  else{
   const words=match[1].toLowerCase().split(/[ -]+/).filter(word=>word!=='and');
   number=0;for(const word of words){if(word==='hundred')number*=100;else number+=numberWords[word]??NaN;}
  }
  const value=number*(/^year/i.test(match[2])?12:1);
  try{licenseScope.months(value);}catch{continue;}
  result.push({value,text:match[0],index:match.index});
 }
 return result;
}
function confirmedScopeClause(clause){
 return !/\b(?:old|former)\s+(?:plan|draft|order|request|scope|version)\b|\?|\b(?:if|unless|undecided|unsure|uncertain|unresolved|unconfirmed|maybe|perhaps|might|proposed|provisional|pending|awaiting|withdrawn|cancelled|canceled|rejected|superseded|earlier|previous|either|between|or)\b|\b(?:not\s+(?:yet\s+)?(?:agreed|decided|approved|confirmed)|(?:haven['’]t|hasn['’]t)\s+(?:agreed|decided)|to\s+be\s+decided)\b/i.test(clause);
}
function supportsDuration(brief,item){
 for(const candidate of explicitDurationCandidates(item.evidence)){
  if(candidate.value!==item.value)continue;
  const topic=new RegExp(escapePattern(candidate.text),'i');let clause=sourceClause(brief,item.evidence,topic,item.start);
  // A conjunction inside a named territory must not detach the following
  // duration from its license. Keep separate actions and schedules separate.
  if(!/\b(?:licen[cs](?:e|ed|ing)|term|duration)\b|\b(?:use|display|publish|distribution)\b.*\bfor\b/i.test(clause)){
   const preceding=item.evidence.slice(0,candidate.index),region=preceding.match(/\b(?:in|within|across)\s+(.+?)\s+for\s*$/i)?.[1];
   if(region&&/\band\b|,/.test(region)&&/^[\p{L}][\p{L}\p{M}\s.,'’()-]*$/u.test(region)
    &&!/\b(?:we|our|they|their|he|she|it|will|was|were|has|have|had|is|are|be|months?|years?)\b/i.test(region)
    &&supportsTerritory(brief,{...item,value:region}))clause=item.evidence;
  }
  if(!/\b(?:licen[cs](?:e|ed|ing)|term|duration)\b|\b(?:use|display|publish|distribution)\b.*\bfor\b/i.test(clause))continue;
  if(!confirmedScopeClause(clause))continue;
  const match=topic.exec(clause),before=match?clause.slice(0,match.index):'';
  if(/\b(?:start|begin|commence|open|launch|deliver|expire)\w*\b[^.!?;]*\b(?:in|after)\s*$/i.test(before))continue;
  if(/\b(?:not|no|never|without)\s+(?:(?:a|an|the)\s+)?$/i.test(before))continue;
  return true;
 }
 return false;
}
function supportsTerritory(brief,item){
 let normalized;try{normalized=licenseScope.territory(item.value);}catch{return false;}
 if(normalized!==item.value)return false;
 const topic=item.value==='Worldwide'?/\b(?:worldwide|globally)\b/i:new RegExp(escapePattern(item.value).replace(/ +/g,' +'));
 const match=topic.exec(item.evidence);if(!match)return false;
 const before=item.evidence.slice(0,match.index),after=item.evidence.slice(match.index+match[0].length);
 const labelled=/\b(?:territor(?:y|ies)|regions?)\s*(?:(?:is|are|will\s+be)\s*)?(?::|=)?\s*$/i.test(before);
 // A venue, print run or publication channel says where the artwork appears,
 // not the geographic rights boundary. Keep explicit named territory labels.
 if(!labelled&&/\b(?:gallery|exhibit(?:ion)?|museum|festival|venue|event|workshop|studio|office|theat(?:er|re)|store|shop|print(?:ed|ing)?|physical|digital|online|website|social\s+media|copies|posters?|flyers?|invitations?|brochures?|booklets?|catalog(?:ue)?s?|editions?)\b/i.test(item.value))return false;
 const licensedPlace=/\b(?:licen[cs](?:e|ed|ing)|use|usage|distribution|distribute|display|publish)\b[\s\S]*\b(?:in|within|across)\s*$/i.test(before);
 const worldwide=item.value==='Worldwide'&&/\b(?:licen[cs](?:e|ed|ing)|term|territor(?:y|ies))\b/i.test(before);
 if(!labelled&&!licensedPlace&&!worldwide)return false;
 // A substring cannot silently discard another country or an exclusion.
 if(/^\s*(?:,\s*)?(?:and|or|except|excluding|but\s+not|outside)\b/i.test(after))return false;
 if(after&&!/^\s*(?:[.!?;]|$|only\b|for\b|with\b)/i.test(after))return false;
 const clause=sourceClause(brief,item.evidence,topic,item.start);
 if(!confirmedScopeClause(clause))return false;
 if(/\b(?:not|no|never|without|except|excluding)\s*$/i.test(before))return false;
 return true;
}

function supportsIntention(brief,field,item,topic){
 // Indexed source passages can contain an allowed and a refused choice.
 // Inspect the proposed medium/count, rather than the first generic topic.
 let intentionTopic=topic;
 if(field==='medium')intentionTopic={website:/website|web\b/i,social:/social/i,print:/print|poster|flyer/i}[item.value]||topic;
 if(field==='medium'&&!intentionTopic.test(item.evidence))return false;
 if(field==='termMonths')return supportsDuration(brief,item);
 if(field==='territory')return supportsTerritory(brief,item);
 if(field==='copies'){
  // A verbatim quotation does not by itself ground the proposed number.
  // Only compare explicit numeric physical quantities; never infer a new one.
  const quantities=[...item.evidence.matchAll(/(?<![\w.,])(\d{1,3}(?:,\d{3})+|\d+)[ \t]+(?:(?:physical|printed)[ \t]+)?(?:copies|posters|flyers|cards|brochures|invitations|covers|books|prints)\b/gi)]
   .filter(match=>!/\d[ \t]+$|\d[\d,]*[ \t]*[-–—][ \t]*$/.test(item.evidence.slice(0,match.index)))
   .map(match=>Number(match[1].replaceAll(',','')));
  if(quantities.length&&!quantities.includes(item.value))return false;
  const count=new RegExp('\\b(?:'+item.value+'|'+Number(item.value).toLocaleString('en-US')+')\\b(?:\\s+(?:physical\\s+)?(?:copies|posters|flyers|cards|brochures|invitations))?','i');
  if(count.test(item.evidence))intentionTopic=count;
 }
 const clause=sourceClause(brief,item.evidence,intentionTopic,item.start);
 if(field==='medium'||(field==='copies'&&item.value>0)){
  const mention=intentionTopic.exec(clause);
  const before=mention?clause.slice(0,mention.index).replace(/\bnot\s+(?:only|just|merely)\b/gi,''):'';
  const after=mention?clause.slice(mention.index+mention[0].length):'';
  const refusedAction=/\b(?:do(?:es)?\s+not|did\s+not|must\s+not|will\s+not|should\s+not|cannot|can['’]t|don['’]t|doesn['’]t|didn['’]t|won['’]t|never)\s+(?:use|publish|post|print|include|distribute|reproduce|produce|make|order|request|require|display|feature|share|show|host|place|put|upload)\b/i;
  const refusedChoice=/\b(?:not|no|never|without)\s+(?:(?:on|in|for)\s+)?(?:(?:a|an|any|the|our|their|my|your|its)\s+)?$/i;
  const prohibited=/^\s*(?:use\s+)?(?:(?:is|are|was|were)\s+)?(?:explicitly\s+)?(?:prohibited|forbidden|disallowed|excluded|denied|refused|cancelled|canceled|withdrawn|not\s+(?:allowed|requested|included|permitted))\b/i;
  if(refusedAction.test(before)||refusedChoice.test(before)||prohibited.test(after))return false;
  if(field==='copies'&&/\b(?:is|are|was|were)\s+not\s+(?:required|requested|needed|confirmed|approved)\b/i.test(after))return false;
 }
 // An explicitly superseded plan is not the current request, even when
 // the quotation itself omits the surrounding plan label.
 if(retiredPlanLabel(clause)||tentativePlanLabel(clause)||/\b(?:plan|draft|order|request|scope|version)\s+(?:was\s+)?(?:withdrawn|cancelled|canceled|superseded)\b/i.test(clause))return false;
 const uncertainty=/\b(?:undecided|unsure|uncertain|unresolved|unconfirmed|maybe|perhaps|might|whether)\b|\b(?:not\s+(?:yet\s+)?decided|(?:haven['’]t|hasn['’]t)\s+decided|still\s+deciding|to\s+be\s+decided)\b|\b(?:if|unless)\b|\b(?:may|could)\s+(?:be\s+)?(?:use|print|post|request|need|want|include|give|add|credit|train|sell|publish|ask|seek|allow|omit|appear|put)\b/i;
 if(uncertainty.test(clause.replace(/\beven\s+if\b/gi,'')))return false;
 // Pending approval must refer directly to this field. An unrelated delivery
 // or schedule approval later in the clause does not undo an explicit choice.
 const mention=topic.exec(clause);
 const afterTopic=mention?clause.slice(mention.index+mention[0].length):'';
 const pendingApproval=/^\w*\s+(?:(?:permission|rights?|use|inclusion)\s+)?(?:(?:is|are|remain|remains)\s+)?(?:still\s+)?(?:awaiting|pending)\s+(?:[a-z-]+\s+){0,3}(?:approval|confirmation|decision)\b/i;
 if(pendingApproval.test(afterTopic))return false;
 // A single choice cannot represent two expressly requested digital uses,
 // even when the buyer describes them in separate sentences.
 if(field==='medium'){
  const excluded=/\b(?:no|not|never|cannot|without|forbid(?:den)?|prohibit(?:ed)?|excluded|disallowed|denied|refused|cancelled|canceled|withdrawn|earlier|previous(?:ly)?|formerly)\b|n['’]t\b/i;
  const digital=[/website|web\b/i,/social/i].map(medium=>sourcePassages(brief).some(passage=>{
   if(!medium.test(passage.text)||passage.text.includes('?'))return false;
   const source=sourceClause(brief,passage.text,medium,passage.start);
   return !uncertainty.test(source.replace(/\beven\s+if\b/gi,''))&&!excluded.test(source);
  }));
  if(digital.every(Boolean))return false;
 }
 if(['training','exclusive','attribution'].includes(field)){
  let polarityClause=clause.replace(/\bnot\s+only\b/gi,'');
  // Refusing to omit credit is an explicit inclusion, not a refusal of credit.
  // Normalize only that named permission; other negatives remain visible.
  if(field==='attribution')polarityClause=polarityClause.replace(/\b(?:(?:do|must|should)\s+not|(?:don|mustn|shouldn)['’]t)\s+(?:omit|exclude|remove|drop)\s+(?:(?:the|a|an|any)\s+)?(?:(?:creator|artist|illustrator|photographer)(?:['’]s)?\s+)?(?:credit|attribution)\b/gi,'creator credit');
  // A single shared prohibition governs both coordinated permissions, not
  // merely the noun nearest the negative word. Reject conditional/retired
  // statements instead of promoting them to current license choices.
  const pairedProhibition=/\b(?:prohibit|forbid|exclude|deny|disallow)\s+(?:AI\s+|model\s+)*training\s+and\s+(?:exclusive\s+rights?|exclusivity)\b|\b(?:AI\s+|model\s+)*training\s+and\s+(?:exclusive\s+rights?|exclusivity)\s+(?:are|is)\s+(?:(?:strictly|expressly|explicitly)\s+)?(?:prohibited|forbidden|disallowed|not\s+allowed)\b/i.test(item.evidence);
  if(pairedProhibition&&/\b(?:if|unless|maybe|might|could|proposed|earlier|previous|withdrawn|cancelled|canceled|pending|future)\b/i.test(item.evidence))return false;
  const explicitNegative=/\b(?:no|not|never|cannot|without|forbid(?:den)?|prohibit(?:ed)?|deny|denied|disallow(?:ed)?|omit(?:ted)?|exclud(?:e[ds]?|ing))\b|n['’]t\b/i.test(polarityClause)
   ||(field==='exclusive'&&/\bnon[\s-]?exclusiv/i.test(polarityClause))
   ||pairedProhibition;
  if(item.value===explicitNegative)return false;
 }
 return true;
}


// A model may end a quoted clause with sentence punctuation even when the
// source continues after a comma. Recover only one unchanged, whole-word
// source substring; never rewrite words, case, whitespace, or internal marks.
function exactSourceEvidence(brief,evidence){
 if(typeof evidence!=='string'||!evidence.trim())return null;
 if(brief.includes(evidence))return evidence;
 const phrase=evidence.replace(/[.!?,;:]+$/u,'');
 if(phrase===evidence||!phrase||phrase.trim()!==phrase)return null;
 const start=brief.indexOf(phrase);
 if(start<0||brief.indexOf(phrase,start+1)!==-1)return null;
 const word=/[\p{L}\p{N}_]/u;
 if(start>0&&word.test(brief[start-1])&&word.test(phrase[0]))return null;
 const end=start+phrase.length;
 if(end<brief.length&&word.test(brief[end])&&word.test(phrase.at(-1)))return null;
 return brief.slice(start,end);
}


function explicitCurrentZeroCopies(brief){
 // Zero is recoverable only when a current, quoted passage actually says so.
 // A digital-only use does not imply a physical quantity.
 const zero=/\b(?:no|zero|0)\s+(?:(?:printed|physical|paper|print)\s+)?(?:copies|prints|posters|flyers|brochures|invitations|books|cards)\b|\b(?:no|zero)\s+(?:physical\s+)?print\s+run\b|\b(?:physical|printed|paper)\s+copies\s*[:=]\s*0\b/iu;
 const positive=/(?:\b(?:print|printing|order|ordering|make|produce)\s+(?:exactly\s+)?(\d[\d,]*)\s+(?:(?:printed|physical)\s+)?(?:copies|prints|posters|flyers|brochures|invitations|books|cards|covers)\b|\b(\d[\d,]*)\s+(?:(?:printed|physical)\s+)?(?:copies|prints|posters|flyers|brochures|invitations|books|cards|covers)\b|\b(\d[\d,]*)[- ]copy\s+print\s+run\b)/giu;
 const passages=sourcePassages(brief),candidates=[];
 for(const passage of passages){
  const hit=zero.exec(passage.text);
  if(!hit)continue;
  const before=passage.text.slice(0,hit.index),after=passage.text.slice(hit.index+hit[0].length);
  // A source passage can mention the words of a zero-print sentence without
  // selecting that quantity (headlines, quotations and questions).
  if(/\?\s*['"”’]?\s*$/.test(passage.text))continue;
  if(/\b(?:headlines?|titles?|phrases?|wording|sentences?|examples?|samples?|quotations?|hypotheticals?)\b|\bnot\s+an?\s+(?:approved|confirmed)\s+(?:decision|choice)\b/i.test(passage.text))continue;
  if(/(?:^|[\s([{])["'“‘][^"'“”‘’]*$/.test(before)&&/^[^"'“”‘’]*["'”’]/.test(after))continue;
  const context=sourceClause(brief,passage.text,FIELD_TOPICS.copies,passage.start);
  if(/\b(?:former|historical|last\s+year|in\s+the\s+past)\b/i.test(context))continue;
  const item={value:0,evidence:passage.text,start:passage.start};
  if(supportsIntention(brief,'copies',item,FIELD_TOPICS.copies))candidates.push(item);
 }
 if(!candidates.length)return null;
 // Opposing current print quantities require the buyer to resolve the scope.
 // Ignore only demonstrably withdrawn or conditional quantities.
 for(const passage of passages){
  const context=sourceClause(brief,passage.text,FIELD_TOPICS.copies,passage.start);
  if(/\b(?:earlier|previously|originally|formerly)\s+(?:had\s+)?(?:planned|intended|wanted|ordered|requested)\b|\b(?:historical|last\s+year|in\s+the\s+past)\b/i.test(context))continue;
  const numericPrintVerb=/\b(?:print|printing|produce|order)\s+(\d[\d,]*)\b/giu;
  for(const match of [...passage.text.matchAll(positive),...passage.text.matchAll(numericPrintVerb)]){
   const count=Number((match[1]||match[2]||match[3]).replaceAll(',',''));
   if(count>0&&Number.isSafeInteger(count)&&supportsIntention(brief,'copies',{value:count,evidence:passage.text,start:passage.start},FIELD_TOPICS.copies))return null;
  }
 }
 const item=candidates.at(-1);
 return {...item,end:item.start+item.evidence.length};
}

function validateProposal(brief,raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Model returned no structured proposal.');
 const proposals={},invalid=[];
 const invalidField=message=>{throw Object.assign(Error(message),{code:'BRIEF_FIELD_INVALID'});};
 for(const field of FIELDS){
  try{
  let item=raw[field];
  if(item===null||item===undefined){proposals[field]=field==='copies'?explicitCurrentZeroCopies(brief):null;continue;}
  if(!item||typeof item!=='object')invalidField('Model evidence does not occur verbatim in the buyer brief.');
  const evidence=exactSourceEvidence(brief,item.evidence);
  if(evidence===null)invalidField('Model evidence does not occur verbatim in the buyer brief.');
  const start=Number.isInteger(item.start)?item.start:brief.indexOf(evidence);
  if(start<0||brief.slice(start,start+evidence.length)!==evidence)invalidField('Model source position does not match the buyer brief.');
  item={...item,evidence,start};
  const value=item.value;
  if(!FIELD_TOPICS[field].test(item.evidence))invalidField('Quoted evidence does not identify the proposed field.');
  if(field==='medium'&&!['website','social','print'].includes(value))invalidField('Unsupported proposed medium.');
  if(field==='copies'&&(!Number.isInteger(value)||value<0||value>1000000))invalidField('Invalid proposed copy count.');
  if(['training','exclusive','attribution'].includes(field)&&typeof value!=='boolean')invalidField('Invalid proposed permission flag.');
  if(field==='termMonths'&&(!Number.isInteger(value)||value<1||value>120))invalidField('Invalid proposed duration.');
  if(field==='territory'){
   try{if(licenseScope.territory(value)!==value)invalidField('Proposed territory must retain source wording.');}
   catch(error){if(error.code==='BRIEF_FIELD_INVALID')throw error;invalidField('Invalid proposed territory.');}
  }
  if(!supportsIntention(brief,field,item,FIELD_TOPICS[field])){proposals[field]=field==='copies'?explicitCurrentZeroCopies(brief):null;continue;}
  if(field==='copies'&&value===0){
   // A model-proposed zero is not independent authority. Apply the same
   // source assertion/contradiction checks used for an omitted model count.
   const confirmed=explicitCurrentZeroCopies(brief);
   if(!confirmed||item.start>=confirmed.end||item.start+item.evidence.length<=confirmed.start){
    proposals[field]=null;continue;
   }
  }
  proposals[field]={value,evidence:item.evidence,start:item.start,end:item.start+item.evidence.length};
  }catch(error){
   if(error.code!=='BRIEF_FIELD_INVALID')throw error;
   proposals[field]=null;invalid.push({field,error});
  }
 }
 // One invalid field cannot erase independently grounded choices. No value is
 // repaired or inferred, and a wholly invalid response still fails as before.
 if(invalid.length&&!Object.values(proposals).some(Boolean))throw invalid[0].error;

 return {fields:proposals,...(invalid.length?{withheldFields:invalid.map(item=>item.field)}:{}),requiresHumanConfirmation:true,applied:false,warning:'Model suggestions may misunderstand negation or future plans. Compare every value with its quoted evidence. Omitted terms are unknown. No rights review or approval has occurred.'};
}

function explicitStartDate(text){
 // A named project/license start or an imperative start date is explicit.
 // Event dates, deadlines, numeric locale dates and relative dates stay manual.
 const namedMonth='January|February|March|April|May|June|July|August|September|October|November|December';
 const written='(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2} (?:'+namedMonth+') \\d{4}|(?:'+namedMonth+') \\d{1,2},? \\d{4})';
 const lead='(?:(?:Please )?(?:Begin|Start|Commence)(?: (?:the|our) (?:project|license|use))? on |(?:(?:The|Our|Requested|Agreed|Confirmed) )?(?:project|license|use) (?:starts?|begins?|commences?) on |(?:(?:Requested|Agreed|Confirmed|Project|License) )?start date(?: is)?\\s*[:=]?\\s*)';
 const match=text.match(new RegExp('^'+lead+'('+written+')(?: UTC)?[.!]?$', 'i'));
 if(!match||!confirmedScopeClause(text)||retiredPlanLabel(text))return null;
 let value=match[1];
 if(!/^\d{4}-/.test(value)){
  const words=value.replace(',','').split(' '),names=namedMonth.toLowerCase().split('|');
  const firstMonth=names.indexOf(words[0].toLowerCase()),month=firstMonth>=0?firstMonth:names.indexOf(words[1].toLowerCase());
  const day=firstMonth>=0?words[1]:words[0];
  value=words[2]+'-'+String(month+1).padStart(2,'0')+'-'+day.padStart(2,'0');
 }
 try{return licenseScope.date(value);}catch{return null;}
}

function explicitRequestedScope(brief){
 const candidates={termMonths:[],territory:[],startsOn:[]},unsettledAt={termMonths:-1,territory:-1,startsOn:-1},passages=sourcePassages(brief);
 const unsettled=text=>/\b(?:undecided|unsure|uncertain|unresolved|unconfirmed|unknown|proposed|provisional|pending|awaiting|either)\b|\bsubject\s+to\s+(?:[a-z-]+\s+){0,3}(?:approval|confirmation|agreement)\b|\bnot\s+(?:(?:yet|been)\s+)*(?:agreed|decided|approved|confirmed|chosen|settled)\b|\bno\b[^.!?;]*\b(?:agreed|confirmed|decided)\b/i.test(text);
 for(const passage of passages){
  if(!retiredPlanLabel(passage.text)&&/\b(?:start(?:ing)?|begin(?:ning)?|commenc(?:e|ing))\b/i.test(passage.text)&&/\b(?:no|not|never|cancelled|canceled|withdrawn|rejected|superseded)\b/i.test(passage.text))unsettledAt.startsOn=passage.start;
  if(unsettled(passage.text)&&!/\b(?:if|unless|earlier|previous|old|withdrawn|rejected|cancelled|canceled)\b/i.test(passage.text)){
   if(/\b(?:duration|term|scope)\b/i.test(passage.text))unsettledAt.termMonths=passage.start;
   if(/\b(?:territor(?:y|ies)|regions?|scope)\b/i.test(passage.text))unsettledAt.territory=passage.start;
   if(/\b(?:start(?:ing)?(?: date)?|begin(?:ning)?|commenc(?:e|ing))\b/i.test(passage.text))unsettledAt.startsOn=passage.start;
  }
 }
 for(const [index,passage]of passages.entries()){
  const following=passages[index+1]?.text||'';
  if(/\?\s*["'”’]?\s*$/.test(passage.text)||/\b(?:titles?|headlines?|phrases?|wording|sentences?|examples?|samples?|quotations?|hypotheticals?)\b/i.test(passage.text)||unsettled(passage.text))continue;
  if(/^(?:this|that|it)\b/i.test(following)&&unsettled(following))continue;
  const item={evidence:passage.text,start:passage.start,end:passage.end};
  const startsOn=explicitStartDate(passage.text),previous=passages[index-1]?.text||'';
  const dateRetracted=/^(?:this|that|it|the (?:start )?date)\b/i.test(following)&&/\b(?:cancelled|canceled|withdrawn|rejected|superseded|abandoned|example|sample|quotation|hypothetical|not)\b/i.test(following);
  if(startsOn&&!dateRetracted&&(!retiredPlanLabel(previous)||/^(?:Confirmed|Agreed|Requested) start date/i.test(passage.text)))candidates.startsOn.push({...item,value:startsOn});
  for(const duration of explicitDurationCandidates(passage.text)){
   const proposal={...item,value:duration.value};
   if(supportsDuration(brief,proposal))candidates.termMonths.push(proposal);
  }
  const places=[];
  const label=passage.text.match(/\b(?:territor(?:y|ies)|regions?)\s*(?:(?:is|are|will\s+be)\s*)?(?::|=)?\s+(.+?)(?=\s+(?:for|with|only)\b|[.!?;]|$)/i);
  if(label)places.push(label[1]);
  for(const match of passage.text.matchAll(/\b(?:in|within|across)\s+(.+?)(?=\s+(?:for|with|only)\b|[.!?;]|$)/gi))places.push(match[1]);
  if(/\b(?:worldwide|globally)\b/i.test(passage.text))places.push('Worldwide');
  for(const place of places){
   let value;try{value=licenseScope.territory(place.trim());}catch{continue;}
   if(!/^\p{L}/u.test(value)||/^(?:not|no|never|without|except|excluding|unknown|undecided|unconfirmed)\b|\b(?:months?|years?)\b/i.test(value))continue;
   const proposal={...item,value};
   if(supportsTerritory(brief,proposal))candidates.territory.push(proposal);
  }
 }
 // An earlier unknown does not veto a later explicit final decision.
 // A later unknown still takes precedence; resolution must be explicit.
 const choose=field=>{
  const lastUnknown=unsettledAt[field];
  const items=lastUnknown<0?candidates[field]:candidates[field].filter(item=>
   item.start>lastUnknown&&/\b(?:final|approved|confirmed|agreed|settled)\b/i.test(item.evidence));
  return items.length&&new Set(items.map(item=>item.value)).size===1?items.at(-1):null;
 };
 const startsOn=choose('startsOn');
 return {termMonths:choose('termMonths'),territory:choose('territory'),...(startsOn?{startsOn}:{})};
}

function missingExplicitModelFields(brief,fields,request){
 const passages=sourcePassages(brief),missing=[];
 for(const field of ['medium','copies','training','exclusive','attribution']){
  if(fields[field]!==null)continue;
  const proposal=request.format.properties[field]?.anyOf?.find(item=>item.type==='object');
  const indices=proposal?.properties?.s?.enum||[],supported=new Set();
  for(const index of indices){
   const passage=passages[index];
   if(!passage||/\?\s*["'”’]?\s*$|\b(?:titles?|headlines?|phrases?|wording|sentences?|examples?|samples?|quotations?|hypotheticals?)\b/i.test(passage.text))continue;
   // Candidate source ranges are intentionally broad. A null beside a retired
   // or unsettled plan is correct; it must not buy another model pass. Inspect
   // the complete passage so a shared trailing qualifier governs both fields.
   if(/\b(?:undecided|unsure|uncertain|unresolved|unconfirmed|maybe|perhaps|might|whether|pending|awaiting|cancelled|canceled|withdrawn|rejected|superseded|future)\b|\bnot\s+(?:(?:yet|been)\s+)*(?:approved|confirmed|decided|agreed)\b/i.test(passage.text))continue;
   // The primary schema allows broad topic substrings. A name such as Quail
   // is not an explicit AI permission and must not trigger reference inference.
   if(field==='training'&&!/\b(?:AI|train(?:ing|ed)?|machine\s+learning)\b/i.test(passage.text))continue;
   const candidates=field==='medium'?['website','social','print']:field==='copies'
    ?[...passage.text.matchAll(/(?<![\w.,])(\d{1,3}(?:,\d{3})+|\d+)[ \t]+(?:(?:physical|printed)[ \t]+)?(?:copies|posters|flyers|cards|brochures|invitations|covers|books|prints)\b/gi)]
      .filter(match=>!/\d[ \t]+$|\d[\d,]*[ \t]*[-–—][ \t]*$/.test(passage.text.slice(0,match.index))).map(match=>Number(match[1].replaceAll(',','')))
    :[false,true];
   for(const value of candidates){
    try{
     const checked=validateProposal(brief,{[field]:{value,evidence:passage.text,start:passage.start,end:passage.end}});
     if(checked.fields[field])supported.add(JSON.stringify(checked.fields[field].value));
    }catch(error){if(error.code!=='BRIEF_FIELD_INVALID')throw error;}
   }
  }
  // This only decides whether another model pass can be useful. It never
  // supplies a value, resolves conflicting intentions or changes a known field.
  if(supported.size===1)missing.push(field);
 }
 return missing;
}

// Recover literal, unambiguous current choices omitted by the local model.
// Every suggestion remains a verbatim quotation the buyer must select.
// Unfamiliar and uncertain wording stays unknown or uses the reference.
function literalBriefRecovery(brief,primary){
 const options={medium:[],copies:[],training:[],exclusive:[],attribution:[]};
 const passages=sourcePassages(brief);
 // A print quantity does not establish that print is the use to review first.
 // If the source also supports digital use, keep the quantity but leave an
 // unrecognized medium for the buyer instead of promoting print by itself.
 const currentDigital=primary.medium===null&&passages.some(passage=>['website','social'].some(value=>{
  if(/\?|\b(?:example|hypothetical|quotation|quoted|headline|title|option|scenario|alternative|proposal|proposed|previously|earlier|withdrawn|cancelled|canceled|rejected|superseded|no\s+longer|might|maybe|perhaps|could|may)\b/i.test(passage.text))return false;
  try{return !!validateProposal(brief,{medium:{value,evidence:passage.text,start:passage.start}}).fields.medium;}
  catch(error){if(error.code!=='BRIEF_FIELD_INVALID')throw error;return false;}
 }));
 const add=(field,value,passage)=>{
  if(primary[field]!==null)return;
  try{
   const checked=validateProposal(brief,{[field]:{value,evidence:passage.text,start:passage.start}});
   if(checked.fields[field])options[field].push(checked.fields[field]);
  }catch(error){if(error.code!=='BRIEF_FIELD_INVALID')throw error;}
 };
 for(const passage of passages){
  const text=passage.text;
  // A speculative later use must not erase an earlier confirmed one in the
  // same sentence. Each recovered value is also checked against its own
  // source clause, which rejects conditional and uncertain wording.
  if(/\?|\b(?:example|hypothetical|quotation|quoted|headline|title|option|scenario|alternative|proposal|proposed|previously|earlier|withdrawn|cancelled|canceled|rejected|superseded|no\s+longer)\b|\b(?:has|have|is|are)\s+(?:not\s+)?(?:been\s+)?(?:decided|agreed|settled|confirmed|approved)\b/i.test(text))continue;
  const physicals=[
   ...text.matchAll(/\b(?:use|print|produce|order|make|license|licence|reproduce|require|requires|required)\b[^.!?;]{0,100}?\b(\d{1,3}(?:,\d{3})*|\d+)\s+(?:printed|physical)\s+(copies|prints|posters|flyers|cards|brochures|invitations|books)\b/gi),
   // "Print 240 posters" and "Order 175 flyers" already identify a physical
   // run: requiring the adjective "printed" made the ordinary wording vanish.
   ...text.matchAll(/\b(?:print|printing|order|produce|make|reproduce)\b[^.!?;]{0,100}?\b(\d{1,3}(?:,\d{3})*|\d+)\s+(?:(?:printed|physical)\s+)?(copies|prints|posters|flyers|cards|brochures|invitations|books)\b/gi)
  ];
  if(physicals.length){
   // A second numbered item can follow "or/and" without repeating "print".
   // Keep the supported medium but never choose a quantity from alternatives.
   const allCounts=[...text.matchAll(/(?<![\w.,])(\d{1,3}(?:,\d{3})*|\d+)\s+(?:(?:printed|physical)\s+)?(?:copies|prints|posters|flyers|cards|brochures|invitations|books)\b/gi)]
    .map(match=>Number(match[1].replaceAll(',','')));
   if(new Set([...physicals.map(match=>Number(match[1].replaceAll(',',''))),...allCounts]).size===1){
    const copies=Number(physicals[0][1].replaceAll(',',''));
    // An explicit zero print run does not establish a second physical use.
    if(copies>0)add('medium','print',passage);
    add('copies',copies,passage);
   }
  }
  if(/\b(?:please\s+)?(?:use|publish|post|place|put|display|feature|show)\b[^.!?;]{0,90}\b(?:on|to|in)\s+(?:our|the|their)(?:\s+[A-Za-z-]+){0,3}\s+website\b|\b(?:our|the|their)\s+website\s+(?:will|must)\s+(?:feature|display|show|publish|host)\b|\bcurrent\s+request\s+uses\b[^.!?;]{0,90}\bwebsite\b|\b(?:confirmed|current|agreed)\s+use\s+is\s+(?:(?:our|the|their)\s+)?(?:[A-Za-z-]+\s+){0,3}website\b/i.test(text))add('medium','website',passage);
  if(/\bsocial\s+(?:media\s+)?(?:post|use)\s+(?:is|was)\s+requested\b|\b(?:post|publish|share|feature|display|place|put|use)\b[^.!?;]{0,90}\b(?:on|to|in)\s+(?:(?:our|the|their)\s+)?(?:social\s+media(?:\s+(?:feeds?|pages?|channels?|accounts?))?|social\s+(?:feeds?|pages?|channels?|accounts?))\b/i.test(text))add('medium','social',passage);
  if(/\bnon[\s-]?exclusive\s+rights?\b|\b(?:does|do|did)\s+not\s+(?:request|seek|need|want|require)\s+exclusiv(?:e|ity)\b|\bexclusive\s+(?:use|rights)\s+is\s+not\s+(?:needed|required|requested)\b|\b(?:exclusive\s+rights?|exclusivity)\s+(?:is|are)\s+(?:(?:strictly|expressly|explicitly)\s+)?(?:prohibited|forbidden|disallowed|not\s+allowed)\b|\b(?:prohibit|forbid|disallow)\s+(?:AI\s+|model\s+)*training\s+and\s+(?:exclusive\s+rights?|exclusivity)\b/i.test(text))add('exclusive',false,passage);
  else if(/\b(?:we\s+)?(?:request|seek|need)\s+exclusive\s+rights?\b/i.test(text))add('exclusive',true,passage);
  if(/\b(?:no|without)\s+(?:AI\s+)?(?:model\s+)?training\b|\b(?:do|does|must)\s+not\s+(?:allow|permit|use|request)\s+(?:AI\s+)?(?:model\s+)?training\b|\b(?:AI\s+|model\s+)*training\s+(?:is|are)\s+(?:(?:strictly|expressly|explicitly)\s+)?(?:prohibited|forbidden|disallowed|not\s+allowed)\b|\b(?:AI\s+|model\s+)*training\s+and\s+(?:exclusive\s+rights?|exclusivity)\s+(?:are|is)\s+(?:(?:strictly|expressly|explicitly)\s+)?(?:prohibited|forbidden|disallowed|not\s+allowed)\b|^\s*(?:prohibit|forbid|disallow)\s+(?:AI\s+|model\s+)*training\s+and\s+(?:exclusive\s+rights?|exclusivity)\b/i.test(text))add('training',false,passage);
  else if(/\b(?:we\s+)?(?:request|allow|authorize)\s+(?:AI\s+)?(?:model\s+)?training\b/i.test(text))add('training',true,passage);
  if(/\b(?:creator|artist)\s+credit\s+(?:is\s+included|must\s+be\s+included)\b|\b(?:creator|artist|illustrator|photographer)\s+(?:must|will|should)\s+be\s+credited\b|\b(?:credit|name|acknowledge)\s+(?:the\s+)?(?:artist|creator|illustrator|photographer)\b/i.test(text))add('attribution',true,passage);
  else if(/\b(?:creator|artist)\s+credit\s+is\s+(?:not\s+included|excluded|omitted)\b/i.test(text))add('attribution',false,passage);
 }
 const recovered={};
 for(const [field,items] of Object.entries(options)){
  if(!items.length)continue;
  if(new Set(items.map(item=>JSON.stringify(item.value))).size===1)recovered[field]=items.at(-1);
 }
 // Preserve the existing choice when two recognized uses conflict; only
 // remove a lone print recovery when digital use is also supported.
 if(recovered.medium?.value==='print'&&currentDigital)delete recovered.medium;
 return recovered;
}

function referenceBriefRequest(request){
 return {model:'local-reference',messages:request.messages,stream:false,max_tokens:request.options.num_predict,temperature:0,repeat_penalty:1,frequency_penalty:0,presence_penalty:0,top_k:40,top_p:0.9,min_p:0,chat_template_kwargs:{enable_thinking:false},response_format:{type:'json_schema',json_schema:{name:'license_fields',strict:true,schema:request.format}}};
}

function loopbackModelOrigin(value){
 try{const u=new URL(value);if(['http:','https:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&!u.username&&!u.password)return u.origin;}catch{}
 return null;
}


// A provider can deliver several JSON tokens per transport chunk. Only parse
// complete top-level entries; a half-written value is never a suggestion.
function completedPrimaryProposal(text){
 let depth=0,quoted=false,escaped=false,end=0;
 if(!text.trimStart().startsWith('{'))return null;
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
  if(char==='"'){quoted=true;continue;}
  if(char==='{'||char==='[')depth++;
  else if(char==='}'||char===']'){
   depth--;if(depth===1)end=i+1;
   if(depth===0){try{return JSON.parse(text.slice(0,i+1));}catch{return null;}}
   if(depth<0)return null;
  }else if(char===','&&depth===1)end=i;
 }
 if(!end)return null;
 try{return JSON.parse(text.slice(0,end)+'}');}catch{return null;}
}

async function readPrimaryResponse(response,{signal,onFields,onCost}){
 if(!response.headers?.get('content-type')?.includes('application/x-ndjson'))return response.json();
 if(!response.body?.getReader)throw Error('Local model response was incomplete.');
 const reader=response.body.getReader(),decoder=new TextDecoder();
 let buffer='',content='',bytes=0,final,ended=false;
 const cancel=()=>{reader.cancel(signal.reason).catch(()=>{});};
 signal.addEventListener('abort',cancel,{once:true});
 const record=line=>{
  if(!line.trim())return;
  if(final)throw Error('Local model response continued after completion.');
  const part=JSON.parse(line);
  if(!part||typeof part!=='object'||Array.isArray(part))throw Error('Local model could not finish the buyer brief.');
  // Terminal work is measurable even when the answer itself is rejected.
  if(part.done===true)onCost(part);
  if(part.error)throw Error('Local model could not finish the buyer brief.');
  const delta=part.message?.content??part.response??'';
  if(typeof delta!=='string')throw Error('Local model response was invalid.');
  content+=delta;
  if(content.length>65536)throw Error('Local model response exceeds the allowed size.');
  if(part.done===true){
   final={...part,message:{...part.message,content}};
  }else if(part.done===false){
   if(delta)onFields(completedPrimaryProposal(content));
  }else throw Error('Local model response was incomplete.');
 };
 try{
  signal.throwIfAborted();
  while(true){
   const chunk=await reader.read();signal.throwIfAborted();
   if(chunk.done){ended=true;buffer+=decoder.decode();break;}
   bytes+=chunk.value.byteLength;if(bytes>262144)throw Error('Local model response exceeds the allowed size.');
   buffer+=decoder.decode(chunk.value,{stream:true});
   let newline;while((newline=buffer.indexOf('\n'))!==-1){record(buffer.slice(0,newline));buffer=buffer.slice(newline+1);}
  }
  record(buffer);
  if(!final)throw Error('Local model response was incomplete.');
  return final;
 }finally{
  signal.removeEventListener('abort',cancel);
  if(!ended)try{await reader.cancel();}catch{}
  reader.releaseLock();
 }
}

function makeBriefExtractor(env=process.env,network=fetch){
 const endpoint=loopbackModelOrigin(env.OLLAMA_BRIEF_URL||env.OLLAMA_URL),referenceEndpoint=loopbackModelOrigin(env.BRIEF_REFERENCE_URL);
 let active=false;
 return {configured:!!endpoint,async extract(brief,options={}){
  if(typeof brief!=='string'||brief.trim().length<10||brief.length>4000)throw Error('Enter a buyer brief between 10 and 4000 characters.');
  if(!endpoint)throw Error('Local model is not configured.');
  const request=buildBriefRequest(brief,env.OLLAMA_BRIEF_MODEL||env.OLLAMA_MODEL||'qwen3.5:4b',{includeScope:false});
  const timeout=AbortSignal.timeout(300000),signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
  signal.throwIfAborted();
  if(active)throw Object.assign(Error('The local model is already reading another brief.'),{code:'BRIEF_BUSY'});
  active=true;
  const modelCosts={primary:null,reference:null};
  try{
   const requestedScope=explicitRequestedScope(brief);
   if(Object.values(requestedScope).some(Boolean)&&typeof options.onScope==='function'){
    options.onScope({fields:requestedScope,scopeExtraction:'explicit-source',requiresHumanConfirmation:true,applied:false});
   }
   // Send one early set of unchanged, buyer-confirmable quotations while the
   // model is still starting. The UI can use them now and cancel unused work.
   // If nothing is directly supported, the existing primary/reference progress
   // remains the first record. A single partial avoids reordering live edits.
   let progressSent=false;
   const progress=typeof options.onProgress==='function'?value=>{
    if(!progressSent){progressSent=true;options.onProgress(value);}
   }:null;
   if(progress){
    const empty=validateProposal(brief,{}).fields;
    const directlyQuoted=literalBriefRecovery(brief,empty);
    if(Object.keys(directlyQuoted).length){
     progress({fields:{...empty,...directlyQuoted,...requestedScope},earlySource:true,model:null,
      modelCosts:{...modelCosts},scopeExtraction:'explicit-source',
      requiresHumanConfirmation:true,applied:false,
      warning:'These exact quotations can be checked now. The local model may suggest additional choices.'});
    }
   }
   signal.throwIfAborted();
   modelCosts.primary=readBriefCost('ollama',null);
   const model=env.OLLAMA_BRIEF_MODEL||env.OLLAMA_MODEL||'qwen3.5:4b';
   let res;
   try{res=await network(endpoint+'/api/chat',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(progress?{...request,stream:true}:request),signal});}
   catch(error){
    signal.throwIfAborted();
    // Fetch transport failures are recoverable; an arbitrary adapter/program
    // error is not proof that the model service is offline.
    if(error instanceof TypeError||['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(error?.code)||['ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(error?.cause?.code)){
     throw Object.assign(Error('Local model could not extract the buyer brief.'),{code:'BRIEF_PROVIDER_UNAVAILABLE'});
    }
    throw error;
   }
   if(!res.ok)throw Object.assign(Error('Local model could not extract the buyer brief.'),{code:'BRIEF_PROVIDER_UNAVAILABLE'});
   const data=await readPrimaryResponse(res,{signal,onCost:value=>{modelCosts.primary=readBriefCost('ollama',value);},onFields:raw=>{
    if(!progress||progressSent||!raw||Object.keys(raw).length>=5)return;
    // Give the buyer the core use together. Unknowns and literal recovery wait
    // for the full answer; this event contains only completed model fields.
    if(!raw.medium||!raw.copies)return;
    let checked;try{checked=validateProposal(brief,decodeBriefResponse(brief,raw));}catch{return;}
    if(!checked.fields.medium||!checked.fields.copies)return;
    const early=Object.fromEntries(FIELDS.map(field=>[field,Object.hasOwn(raw,field)?checked.fields[field]:null]));
    progress({...checked,fields:{...early,...requestedScope},modelCosts:{...modelCosts},scopeExtraction:'explicit-source',model});
   }});
   modelCosts.primary=readBriefCost('ollama',data);if(data.done_reason==='length')throw Error('Local model response was incomplete; no proposal was applied.');
   const result=validateProposal(brief,decodeBriefResponse(brief,JSON.parse(data.message?.content??data.response)));
   const fields={...result.fields,...literalBriefRecovery(brief,result.fields),...requestedScope};
   let reference;
   if(referenceEndpoint){
    const missingFields=missingExplicitModelFields(brief,fields,request);
    if(missingFields.length&&request.options.num_ctx<=8192){
     const referenceSignal=AbortSignal.any([signal,AbortSignal.timeout(60000)]);
     reference={attempted:true,model:'local-reference',missingFields,usedFields:[],status:'no_improvement'};
     try{
      if(progress)progress({...result,fields:{...fields},modelCosts:{...modelCosts},scopeExtraction:'explicit-source',model,reference:{...reference,missingFields:[...missingFields],usedFields:[],status:'pending'}});
      referenceSignal.throwIfAborted();
      modelCosts.reference=readBriefCost('reference',null);
      const response=await network(referenceEndpoint+'/v1/chat/completions',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(referenceBriefRequest(request)),signal:referenceSignal});
      if(!response.ok)throw Object.assign(Error('Reference model unavailable'),{referenceStatus:'unavailable'});
      const body=await response.json();modelCosts.reference=readBriefCost('reference',body);
      const choice=body.choices?.[0];
      if(body.choices?.length!==1||choice?.finish_reason!=='stop')throw Object.assign(Error('Reference response incomplete'),{referenceStatus:'incomplete'});
      const checked=validateProposal(brief,decodeBriefResponse(brief,JSON.parse(choice.message?.content)));
      signal.throwIfAborted();
      for(const field of missingFields){
       if(fields[field]===null&&checked.fields[field]){
        fields[field]=checked.fields[field];reference.usedFields.push(field);
       }
      }
      if(reference.usedFields.length)reference.status='used';
     }catch(error){
      signal.throwIfAborted();
      reference.status=referenceSignal.aborted?'timeout':error.referenceStatus||'invalid_response';
     }
    }else if(missingFields.length){
     reference={attempted:false,model:'local-reference',missingFields,usedFields:[],status:'context_limit'};
    }
   }
   const withheld=result.withheldFields?.filter(field=>fields[field]===null);
   const returned={...result,fields,modelCosts:{...modelCosts},scopeExtraction:'explicit-source',model:env.OLLAMA_BRIEF_MODEL||env.OLLAMA_MODEL||'qwen3.5:4b',...(reference?{reference}:{})};
   if(result.withheldFields){if(withheld.length)returned.withheldFields=withheld;else delete returned.withheldFields;}
   return returned;
  }catch(error){
   // A failed model must not make directly stated licensing choices disappear.
   // Do not turn a cancellation into suggestions: the buyer explicitly stopped.
   if(signal.aborted){
    const reason=signal.reason;
    error=reason&&typeof reason==='object'?reason:Object.assign(Error('Buyer brief was cancelled.'),{name:'AbortError',cause:reason});
   }
   if(!signal.aborted&&error.code==='BRIEF_PROVIDER_UNAVAILABLE'){
    const direct=validateProposal(brief,{});
    const fields={...direct.fields,...literalBriefRecovery(brief,direct.fields),...explicitRequestedScope(brief)};
    if(Object.values(fields).some(Boolean)){
     return {fields,sourceOnly:true,model:null,modelCosts:{...modelCosts},
      scopeExtraction:'explicit-source',requiresHumanConfirmation:true,applied:false,
      warning:'The local model was unavailable. These are only quoted choices from the buyer brief; confirm them before use.'};
    }
   }
   // Preserve measured work even when answer validation rejects the response.
   if(Object.values(modelCosts).some(Boolean)){try{error.modelCosts={...modelCosts};}catch{}}
   throw error;
  }finally{active=false;}
 }};
}
module.exports={validateProposal,makeBriefExtractor};
