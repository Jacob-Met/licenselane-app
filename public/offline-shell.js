// Only this build's public interface is cached. API, original artwork and payment traffic pass through.
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(CACHE_NAME);
 const outcomes=await Promise.allSettled(STATIC_PATHS.map(async p=>{
  const response=await fetch(new Request(p,{cache:'reload',credentials:'omit'}));if(!response.ok)throw Error('Interface file unavailable');
  const digest=await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer()),hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  if(hex!==STATIC_ASSETS[p])throw Error('Interface changed during installation');await cache.put(p,response);
 }));
 if(outcomes.some(result=>result.status==='rejected')){await caches.delete(CACHE_NAME);throw Error('Complete matching interface could not be retained');}
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('licenselane-shell-')&&name!==CACHE_NAME)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||url.search||!STATIC_PATHS.includes(url.pathname))return;
 if(request.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/index.html')){
  event.respondWith(fetch(request).then(response=>{if(!response.ok)throw Error('Primary unavailable');return response;}).catch(async()=>{const cache=await caches.open(CACHE_NAME);return cache.match('/');}));return;
 }
 event.respondWith(fetch(request).then(response=>{if(!response.ok)throw Error('Primary unavailable');return response;}).catch(async()=>{const cache=await caches.open(CACHE_NAME);return cache.match(url.pathname);}));
});
