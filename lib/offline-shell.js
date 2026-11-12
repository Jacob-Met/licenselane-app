const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
module.exports=function offlineShell(root){
 const publicRoot=path.join(root,'public'),html=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8');
 const paths=['/','/index.html',...new Set([...html.matchAll(/(?:src|href)="(\/[^"?#]+\.(?:js|css))"/g)].map(match=>match[1]))];
 // Retain the self-hosted fonts referenced by the retained styles, never artwork or API data.
 const fonts=new Set();
 for(const file of paths.filter(file=>file.endsWith('.css'))){
  const css=fs.readFileSync(path.join(publicRoot,file.slice(1)),'utf8');
  for(const match of css.matchAll(/url\(\s*['"]?(\/fonts\/[A-Za-z0-9_-]+\.(?:ttf|woff2?))['"]?\s*\)/g))fonts.add(match[1]);
 }
 paths.push(...fonts);
 const worker=fs.readFileSync(path.join(publicRoot,'offline-shell.js'),'utf8'),hash=crypto.createHash('sha256').update(worker),assets={};
 for(const file of paths){if(!/^\/(?:index\.html|[a-z0-9-]+\.(?:js|css)|fonts\/[A-Za-z0-9_-]+\.(?:ttf|woff2?))?$/.test(file))throw Error('Invalid offline shell path');const bytes=fs.readFileSync(path.join(publicRoot,file==='/'?'index.html':file.slice(1)));hash.update(file).update(bytes);assets[file]=crypto.createHash('sha256').update(bytes).digest('hex');}
 return 'const CACHE_NAME='+JSON.stringify('licenselane-shell-'+hash.digest('hex'))+';\nconst STATIC_ASSETS='+JSON.stringify(assets)+';\nconst STATIC_PATHS=Object.keys(STATIC_ASSETS);\n'+worker;
};
