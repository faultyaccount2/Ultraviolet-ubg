importScripts("/vendor/controller.sw.js");

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (self.$scramjetController.shouldRoute(event)) event.respondWith(self.$scramjetController.route(event));
});
