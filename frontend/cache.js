let registration;
export async function configureCache(config) {
  if (!("serviceWorker" in navigator) || !("caches" in window)) throw new Error("Service-worker cache is unavailable in this browser.");
  registration ??= await navigator.serviceWorker.register("/cache-worker.js");
  await navigator.serviceWorker.ready;
  return cacheCommand({ action: "configure", config });
}

export async function cacheCommand(message) {
  const worker = registration?.active || navigator.serviceWorker.controller;
  if (!worker) throw new Error("The cache worker is not ready. Reload and try again.");
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error("The cache worker did not respond.")); }, 10000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.postMessage(message, [channel.port2]);
  });
}
