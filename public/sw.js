/*
 * 手写 Service Worker，没用 next-pwa —— 依赖少一个，行为自己说得清。
 *
 * 策略分三类：
 *   1. /api/*        永远走网络。学习进度必须写进数据库，缓存住反而会丢数据。
 *                    只有 GET 失败时才回一个明确的离线 JSON，让前端能提示"断网了"。
 *   2. 导航请求       network-first，失败回 /offline。SPA 壳子不预缓存，避免版本错位。
 *   3. 静态资源       stale-while-revalidate。/_next/static 是内容哈希命名的，缓存很安全。
 *
 * 注意：只在生产注册（见 components/sw-register.tsx），否则会跟 dev HMR 打架。
 */

/*
 * 换图标/换字标必须动这个版本号：图标是同名替换（icons/icon-192.png 等），
 * activate 里只删掉前缀不等于 VERSION 的缓存，版本不变的话装过的浏览器
 * 会一直从 STATIC_CACHE 里拿旧图。缓存键是内部标识，所以用小写 xspeak。
 */
const VERSION = 'xspeak-v3';
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

/*
 * 部署前缀。这个文件是 public/ 里的静态资源，不经过 Next 编译，读不到环境变量，
 * 所以从自己被请求的地址反推：挂在 /xlearn/sw.js 就得出 '/xlearn'，挂在根上就是 ''。
 * 这样同一份文件在根部署和子路径部署下都对，不用改。
 */
const BASE = self.location.pathname.replace(/\/sw\.js$/, '');

const OFFLINE_URL = `${BASE}/offline`;

const PRECACHE = [
  OFFLINE_URL,
  `${BASE}/manifest.webmanifest`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // 单个资源 404 不该让整个安装失败
      await Promise.allSettled(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

/** 前端约定：看到 offline:true 就提示断网，不要当成服务器错误。 */
function offlineJson() {
  return new Response(JSON.stringify({ ok: false, offline: true, error: '离线了，连不上本地服务。' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const fetching = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached ?? (await fetching) ?? Response.error();
}

async function handleNavigation(request) {
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const cache = await caches.open(PAGE_CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch {
    const cache = await caches.open(PAGE_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? new Response('离线了', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // POST/PATCH 一律直连，不碰
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 子路径部署时同域下还住着别人的站。SW 的作用域已经限死在 BASE 下面了，
  // 但这里再挡一道：不是自己这一段的请求一律放过，不缓存、不改写。
  if (BASE && !url.pathname.startsWith(`${BASE}/`) && url.pathname !== BASE) return;

  if (url.pathname.startsWith(`${BASE}/api/`)) {
    event.respondWith(fetch(request).catch(() => offlineJson()));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (
    url.pathname.startsWith(`${BASE}/_next/static/`) ||
    url.pathname.startsWith(`${BASE}/icons/`) ||
    url.pathname === `${BASE}/manifest.webmanifest` ||
    /\.(?:css|js|woff2?|png|svg|jpg|jpeg|webp|ico)$/.test(url.pathname)
  ) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
