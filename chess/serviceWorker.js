// Like html manifest, but also installable to mobile.
const assets = [
	"../lib/say.mjs",
	"../lib/sleep.mjs",
	"chess.css",
	"chess.mjs",
	"drop.js",
	"index.html",
	"rook.png",
	"think.png",
]

self.addEventListener("fetch", e => e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request))))
self.addEventListener("install", e => e.waitUntil(caches.open("chess").then(cache => cache.addAll(assets))))
