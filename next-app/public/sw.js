const CACHE="etihad-traders-shell-v12";
const OFFLINE="/offline";
const SHELL=["/",OFFLINE,"/icon.svg","/brand-logo.svg","/receipt-logo.svg","/manifest.webmanifest"];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("etihad-traders-shell-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting();});
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(request.mode==="navigate"){
    event.respondWith(fetch(new Request(request,{cache:"no-store"})).then(response=>{
      if(response.ok&&response.type==="basic"){
        const copy=response.clone();
        void caches.open(CACHE).then(cache=>cache.put(request,copy));
      }
      return response;
    }).catch(async()=>{
      return await caches.match(request,{ignoreSearch:true})
        || await caches.match("/")
        || await caches.match(OFFLINE);
    }));
    return;
  }
  if(url.pathname.startsWith("/_next/static/")||["/icon.svg","/brand-logo.svg","/receipt-logo.svg","/manifest.webmanifest"].includes(url.pathname)){
    event.respondWith(fetch(new Request(request,{cache:"no-store"})).then(response=>{
      if(response.ok&&response.type==="basic"){
        const copy=response.clone();
        void caches.open(CACHE).then(cache=>cache.put(request,copy));
      }
      return response;
    }).catch(async()=>await caches.match(request,{ignoreSearch:true})||Response.error()));
  }
});
