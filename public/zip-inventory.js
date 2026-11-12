/* Archive inventory shared by creator review and authoritative publication.
 * Reads directory metadata only; never extracts or executes archive members. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory();
 else root.readZipInventory=factory();
})(typeof globalThis!=='undefined'?globalThis:this,()=> {
 'use strict';
 return function readZipInventory(input){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
 const invalid=()=>Error('Choose a complete ZIP containing at least one file.');
 if(bytes.length<22)throw invalid();
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const u16=at=>view.getUint16(at,true),u32=at=>view.getUint32(at,true);
 // The end record and central directory establish that the selected file is one
 // complete archive, rather than a renamed file or interrupted upload.
 let end=-1;
 for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--){
  if(u32(at)===0x06054b50&&at+22+u16(at+20)===bytes.length){end=at;break;}
 }
 if(end<0||u16(end+4)!==0||u16(end+6)!==0)throw invalid();
 const entries=u16(end+10),size=u32(end+12),start=u32(end+16);
 if(!entries||entries===65535||entries!==u16(end+8)||start+size!==end)throw invalid();
 let at=start,files=0,contents=[];
 for(let i=0;i<entries;i++){
  if(at+46>end||u32(at)!==0x02014b50)throw invalid();
  const nameLength=u16(at+28),extraLength=u16(at+30),commentLength=u16(at+32);
  const next=at+46+nameLength+extraLength+commentLength,local=u32(at+42),compressed=u32(at+20);
  if(!nameLength||next>end||u16(at+34)!==0||local+30>start||u32(local)!==0x04034b50)throw invalid();
  const localNameLength=u16(local+26),localExtraLength=u16(local+28);
  const payload=local+30+localNameLength+localExtraLength;
  if(payload+compressed>start||localNameLength!==nameLength||!bytes.subarray(local+30,local+30+localNameLength).every((value,index)=>value===bytes[at+46+index]))throw invalid();
  const last=bytes[at+46+nameLength-1];if(last!==47&&last!==92){
   files++;
   const raw=bytes.subarray(at+46,at+46+nameLength),utf8=!!(u16(at+8)&0x800);
   // ASCII and explicitly UTF-8 ZIP names are unambiguous. Do not invent a
   // Unicode filename for a legacy archive whose encoding is not declared.
   let name=null;
   if(utf8){try{name=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{}}
   else if(raw.every(b=>b<128))name=new TextDecoder('ascii').decode(raw);
   contents.push({name,bytes:u32(at+24)});
  }
  at=next;
 }
 if(at!==end||!files)throw invalid();
 return contents;
 };
});
