/* Vivre Mieux · application installable : garde une copie de la page et des dernières données
   pour qu'elle s'ouvre même avec un mauvais réseau. Les données sont toujours prises en ligne d'abord. */
const CACHE = 'vm-v1';
const COQUILLE = ['./', 'index.html', 'manifest.json', 'logo-vm-rose.svg', 'logo-vm-vert.svg', 'icone-192.png',
  'polices/outfit-400.woff2', 'polices/outfit-500.woff2', 'polices/outfit-600.woff2', 'polices/outfit-700.woff2', 'polices/bebas-neue.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  // Réseau d'abord (données, page, scripts) ; en cas d'échec, la dernière copie gardée
  e.respondWith(
    fetch(r).then(rep => {
      if (rep.ok) { const copie = rep.clone(); caches.open(CACHE).then(c => c.put(r, copie)); }
      return rep;
    }).catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});
