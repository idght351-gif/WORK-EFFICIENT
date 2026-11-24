// 항상 서버에서 최신 파일을 먼저 받아오고(브라우저 저장본도 건너뜀), 오프라인일 때만 마지막으로 본 화면을 보여줍니다.
// 같은 주소(github.io)를 쓰는 항공권 가격 추적 앱의 저장본은 건드리지 않고, 이 앱(award-tracker-*) 것만 정리해요.
const CACHE = "award-tracker-v3";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("award-tracker-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim())
));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  const key = req.url.split("?")[0];
  // GitHub Pages 는 파일을 10분간 브라우저에 저장해 두게 해서, 새 버전이 늦게 보이지 않도록 매번 서버에 확인합니다.
  const fresh = req.mode === "navigate" ? fetch(req.url, { cache: "no-cache" }) : fetch(new Request(req, { cache: "no-cache" }));
  e.respondWith(
    fresh.then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key))
  );
});
