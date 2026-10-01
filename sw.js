/* Same-origin app assets only. Never caches requests to external services. */
const CACHE='handschrift-studio-v3-20260930-2';
const ASSETS=['./','./index.html','./studio.css?v=2','./learning.js?v=2','./storage.js?v=2','./references.js?v=2','./studio.js?v=2','./vendor/pdf.min.mjs','./vendor/pdf.worker.min.mjs'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('handschrift-studio-v3-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url);if(event.request.method!=='GET'||u.origin!==self.location.origin)return;
  const known=ASSETS.map(p=>new URL(p,self.registration.scope).href);if(!known.includes(u.href))return;
  event.respondWith(caches.open(CACHE).then(async cache=>{const saved=await cache.match(event.request);return saved||fetch(event.request)}));
});
