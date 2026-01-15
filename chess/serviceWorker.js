// Like HTML manifest, but also installable to mobile.
const assets = [
	"../lib/say.js",
	"../lib/sleep.js",
	"chess.css",
	"chess.js",
	"drop.js",
	"index.html",
	"rook.png",
	"think.png",
]
// Pre-cache
self.addEventListener("install", e => e.waitUntil(caches.open("chess").then(cache => cache.addAll(assets))))
// Replace old worker
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
// Use cache (overrides user reload)
// self.addEventListener("fetch", e => e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request))))
