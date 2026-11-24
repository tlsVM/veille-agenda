/* Vivre Mieux · application installable : garde une copie de la page et des dernières données
   pour qu'elle s'ouvre même avec un mauvais réseau. Les données sont toujours prises en ligne d'abord. */
const CACHE = 'vm-v2';
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

// ---------- Notifications envoyées par Hugo ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { texte: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titre || 'Vivre Mieux', {
    body: d.texte || '', icon: 'icone-192.png', badge: 'icone-192.png', tag: d.tag || undefined,
    data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if (c.url.indexOf(self.registration.scope) === 0 && 'navigate' in c) { return c.navigate(url).then(w => (w || c).focus()); } }
    return self.clients.openWindow(url);
  }));
});
