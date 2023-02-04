const assets = [
	"index.html",
]

self.addEventListener("fetch", fetchEvent => {
	fetchEvent.respondWith(
		caches.match(fetchEvent.request).then(res => {
			return res || fetch(fetchEvent.request)
		})
	)
})

self.addEventListener("install", installEvent => {
	installEvent.waitUntil(
		caches.open("chess").then(cache => {
			cache.addAll(assets)
		})
	)
})