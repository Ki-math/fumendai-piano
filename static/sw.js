/* =====================================================================
 *  Service Worker — 一度開いたら、オフラインでも起動できるようにする
 *   ・アプリ本体：キャッシュを優先し、裏で新しい版を取りに行く
 *   ・フォントとライブラリ（外部）：取れたらキャッシュし、取れなければキャッシュを使う
 *  CACHE_VERSION は build.py がビルドのたびに書き換える。
 * ===================================================================== */
const CACHE_VERSION = "__BUILD_HASH__";
const CACHE_NAME = `fumendai-piano-${CACHE_VERSION}`;
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("fumendai-piano-") && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;
  // 画面本体（index.html）はネットにつながっていれば常に最新を使う。オフラインのときだけキャッシュ
  if (req.mode === "navigate") { event.respondWith(networkFirst(req, "./index.html")); return; }
  event.respondWith(sameOrigin ? staleWhileRevalidate(req) : networkFirst(req));
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return cached || (await fresh) || (await cache.match("./index.html")) || Response.error();
}

async function networkFirst(req, fallbackUrl = null) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res.ok || res.type === "opaque") cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || (fallbackUrl && (await cache.match(fallbackUrl))) || Response.error();
  }
}
