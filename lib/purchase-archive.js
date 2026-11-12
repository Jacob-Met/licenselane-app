'use strict';
const fs=require('node:fs'),path=require('node:path');
const {standalone}=require('../public/certificate');
const certificateStyle=fs.readFileSync(path.join(__dirname,'../public/certificate.css'),'utf8');

// A small, uncompressed ZIP keeps the retained original byte-for-byte, including
// originals that are already ZIPs. Fixed timestamps make primary and recovery
// downloads identical. No files are extracted or read through archive paths.
const crcTable=Uint32Array.from({length:256},(_,value)=>{
  for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);
  return value>>>0;
});
function crc32(bytes){
  let value=0xffffffff;
  for(const byte of bytes)value=(value>>>8)^crcTable[(value^byte)&255];
  return (value^0xffffffff)>>>0;
}
function storedZip(entries){
  const local=[],central=[],seen=new Set();let offset=0;
  if(!Array.isArray(entries)||entries.length<1||entries.length>65534)throw Error('Invalid archive entries.');
  for(const entry of entries){
    const name=String(entry.name),parts=name.split('/');
    if(!name||name.includes('\\')||/[\x00-\x1f\x7f:]/.test(name)||parts.some(part=>!part||part==='.'||part==='..')||seen.has(name))throw Error('Invalid archive filename.');
    seen.add(name);
    const encoded=Buffer.from(name,'utf8'),bytes=entry.bytes;
    if(!Buffer.isBuffer(bytes)||encoded.length>65535||bytes.length>0xffffffff)throw Error('Archive entry is too large.');
    const checksum=crc32(bytes),header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);
    header.writeUInt16LE(0x0800,6);header.writeUInt16LE(33,12);
    header.writeUInt32LE(checksum,14);header.writeUInt32LE(bytes.length,18);
    header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(encoded.length,26);
    const directory=Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);
    directory.writeUInt16LE(0x0800,8);directory.writeUInt16LE(33,14);
    directory.writeUInt32LE(checksum,16);directory.writeUInt32LE(bytes.length,20);
    directory.writeUInt32LE(bytes.length,24);directory.writeUInt16LE(encoded.length,28);
    directory.writeUInt32LE(offset,42);
    local.push(header,encoded,bytes);central.push(directory,encoded);
    offset+=header.length+encoded.length+bytes.length;
    if(offset>0xffffffff)throw Error('Archive is too large.');
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);
  end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);
  end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,end]);
}
function purchaseArchive({original,filename,terms,certificate}){
  return storedZip([
    {name:'original/'+filename,bytes:original},
    {name:terms.filename,bytes:terms.download},
    {name:certificate.certificateId+'.json',bytes:Buffer.from(JSON.stringify(certificate,null,2))},
    {name:certificate.certificateId+'-certificate.html',bytes:Buffer.from(standalone(certificate,certificateStyle))}
  ]);
}
module.exports={purchaseArchive};
