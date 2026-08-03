/* Adventurer Ledger first-party offline worker. Build injects a content-derived version and asset list. */
const CACHE_VERSION="__CACHE_VERSION__";
const SHELL_CACHE=`adventurer-ledger-shell-${CACHE_VERSION}`;
const PRECACHE=/*__PRECACHE_ASSETS__*/["/"];
const FALLBACK="/index.html";
self.addEventListener("install",event=>{event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(PRECACHE)))});
self.addEventListener("activate",event=>{event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key==="ledger-v1"||(key.startsWith("adventurer-ledger-shell-")&&key!==SHELL_CACHE)).map(key=>caches.delete(key)))),self.clients.claim()]))});
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting()});
self.addEventListener("fetch",event=>{const request=event.request;if(request.method!=="GET")return;const url=new URL(request.url);if(url.origin!==self.location.origin||url.pathname==="/sw.js")return;if(request.mode==="navigate"){event.respondWith(fetch(request).then(response=>{if(response.ok)caches.open(SHELL_CACHE).then(cache=>cache.put(FALLBACK,response.clone()));return response}).catch(async()=>await caches.match(FALLBACK)||await caches.match("/")));return}event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok&&response.type==="basic")caches.open(SHELL_CACHE).then(cache=>cache.put(request,response.clone()));return response})))});
