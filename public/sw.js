/* Adventurer Ledger first-party offline worker. Build injects scoped paths, a content-derived version, and the asset list. */
const CACHE_VERSION="__CACHE_VERSION__";
const SHELL_PREFIX="__SHELL_CACHE_PREFIX__";
const SHELL_CACHE=`${SHELL_PREFIX}${CACHE_VERSION}`;
const PRECACHE=/*__PRECACHE_ASSETS__*/["__APP_ROOT__"];
const APP_ROOT="__APP_ROOT__";
const FALLBACK="__FALLBACK__";
const WORKER_PATH="__WORKER_PATH__";
self.addEventListener("install",event=>{event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(PRECACHE)))});
self.addEventListener("activate",event=>{event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>(key.startsWith(SHELL_PREFIX)&&key!==SHELL_CACHE)||(APP_ROOT==="/"&&key==="ledger-v1")).map(key=>caches.delete(key)))),self.clients.claim()]))});
self.addEventListener("message",event=>{if(event.data?.type==="SKIP_WAITING")self.skipWaiting();if(event.data?.type==="GET_OFFLINE_STATUS")event.waitUntil(caches.has(SHELL_CACHE).then(ready=>event.ports[0]?.postMessage({ready})))});
self.addEventListener("fetch",event=>{const request=event.request;if(request.method!=="GET")return;const url=new URL(request.url);if(url.origin!==self.location.origin||url.pathname===WORKER_PATH)return;event.respondWith(caches.open(SHELL_CACHE).then(async cache=>{if(request.mode==="navigate")return await cache.match(APP_ROOT)||await cache.match(FALLBACK)||Response.error();const cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);if(response.ok&&response.type==="basic")await cache.put(request,response.clone());return response}))});
