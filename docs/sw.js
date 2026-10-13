/* Yaoki Reader offline copy.
 * The page and its code (the engine's scripts included) are fetched fresh when there is a connection and
 * kept for when there is none, so a change reaches phones without any version to bump. The dictionary
 * (engine/dict/ and engine/jm-*.txt, about 36 MB) is kept the first time it is fetched and served from the
 * phone from then on. If the dictionary's files are ever replaced, change ENGINE below so phones fetch them again. */
const HOME = new URL('./', self.location.href).pathname;
const PREFIX = 'yaoki-reader:' + HOME + ':';
const SHELL = PREFIX + 'page';
/* the name dates from when the engine's scripts were kept here too; kept so phones keep the dictionary they have */
const ENGINE = PREFIX + 'engine-4';
const FILES = [
  './',
  './aozora/aozora.js',
  './manifest.webmanifest',
  './licenses.txt',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== SHELL && k !== ENGINE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* the network, but no longer than `wait` ms when a kept copy can stand in */
function fresh(request, cache, wait) {
  const net = fetch(request).then((r) => {
    if (r.ok) cache.put(request, r.clone()).catch(() => {});
    return r;
  });
  return cache.match(request, { ignoreSearch: true }).then((kept) => {
    if (!kept) return net;
    const late = new Promise((res) => setTimeout(() => res(kept), wait));
    return Promise.race([net.catch(() => kept), late]);
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(HOME)) return;
  const rest = url.pathname.slice(HOME.length);
  if (rest.startsWith('engine/dict/') || /^engine\/jm-\d+\.txt$/.test(rest)) {
    event.respondWith(caches.open(ENGINE).then(async (cache) => {
      const kept = await cache.match(request, { ignoreSearch: true });
      if (kept) return kept;
      const r = await fetch(request);
      if (r.ok) cache.put(request, r.clone()).catch(() => {});
      return r;
    }).catch(() => fetch(request)));
    return;
  }
  /* opening the reader by any address in its folder gets its one page */
  const target = request.mode === 'navigate' && !rest.includes('/') ? new Request('./', { cache: 'no-cache' }) : request;
  event.respondWith(caches.open(SHELL).then((cache) => fresh(target, cache, 4000)).catch(() => fetch(request)));
});
