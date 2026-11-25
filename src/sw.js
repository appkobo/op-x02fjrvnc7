/* one-pagerビューア：オフライン用の保存係 */
const STAMP = "__STAMP__";
const SHELL = __SHELL__;
const SHELL_CACHE = "op-shell-" + STAMP;
const PDF_CACHE = "op-pdf-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("op-shell-") && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function timeout(ms) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms));
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // PDFは一度取ったら端末の保存分を使う（版が変わるとアドレスの ?v= が変わる）
  if (url.pathname.includes("/pdf/")) {
    e.respondWith(
      caches.open(PDF_CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // 本体は「通信できれば新しい版、つながらない・2.5秒以上かかるときは保存した版」
  e.respondWith(
    caches.open(SHELL_CACHE).then(async (c) => {
      try {
        const res = await Promise.race([fetch(req, { cache: "no-cache" }), timeout(2500)]);   // ブラウザの一時保存を使わず、毎回サーバーに新しい版がないか確かめる
        if (res && res.ok) c.put(req, res.clone());
        return res;
      } catch (err) {
        const hit = (await c.match(req, { ignoreSearch: true })) || (req.mode === "navigate" ? await c.match("index.html") : null);
        if (hit) return hit;
        return fetch(req);
      }
    })
  );
});
