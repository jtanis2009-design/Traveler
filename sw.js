// Caches the app itself so it opens instantly. Journey data is always fetched live.
const CACHE = "traveler-v6";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "map.js"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return; // API and fonts go straight to the network
  // Network first, and skip the browser's HTTP cache so a new version shows up right away
  // (GitHub Pages lets browsers keep files for 10 minutes). The cache is only used offline.
  e.respondWith(fetch(url.href, { cache: "no-cache", credentials: "same-origin" }).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request)));
});
