// ?쒕퉬?ㅼ썙而?- ?ㅽ봽?쇱씤 罹먯떆
// data.js / app.js ?깆쓣 ?섏젙?섎㈃ 諛섎뱶????踰꾩쟾???щ┫ 寃?
// 罹먯떆 ?곗꽑(cache-first) ?꾨왂?대씪 踰꾩쟾?????щ━硫????뚯씪??怨꾩냽 ?쒓났??
const CACHE = "hanja-master-v55";
const ASSETS = [
  "index.html",
  "styles.css",
  "app.js",
  "data.js",
  "examples.js",
  "examples-lv1.js",
  "origin.js",
  // index.html ???v= 瑜?遺숈뿬 遺瑜대?濡?洹?二쇱냼 洹몃?濡??댁븘 ?〓땲??
  // (罹먯떆 議고쉶??荑쇰━源뚯? 鍮꾧탳?섎?濡?"manifest.json" 留??댁쑝硫?鍮쀫굹媛묐땲??
  "manifest.json?v=2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = e.request.url;
  // hanzi-writer CDN 諛??쒖옄 ?곗씠?곕뒗 ?ㅽ듃?뚰겕 ?곗꽑(?덉쑝硫?罹먯떆)
  if (url.includes("cdn.jsdelivr.net")) {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }
  // 洹??????먯썝? 罹먯떆 ?곗꽑
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});
