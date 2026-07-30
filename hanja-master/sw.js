// 서비스워커 - 오프라인 캐시
// data.js / app.js 등을 수정하면 반드시 이 버전을 올릴 것.
// 캐시 우선(cache-first) 전략이라 버전을 안 올리면 옛 파일이 계속 제공됨.
const CACHE = "hanja-master-v42";
const ASSETS = [
  "index.html",
  "styles.css",
  "app.js",
  "data.js",
  // index.html 이 ?v= 를 붙여 부르므로 그 주소 그대로 담아 둡니다.
  // (캐시 조회는 쿼리까지 비교하므로 "manifest.json" 만 담으면 빗나갑니다)
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
  // hanzi-writer CDN 및 한자 데이터는 네트워크 우선(있으면 캐시)
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
  // 그 외 앱 자원은 캐시 우선
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});
