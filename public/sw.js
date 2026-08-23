/*
 * 手写 Service Worker，没用 next-pwa —— 依赖少一个，行为自己说得清。
 *
 * 策略分三类：
 *   1. /api/*        永远走网络。学习进度必须写到 SQLite，缓存住反而会丢数据。
 *                    只有 GET 失败时才回一个明确的离线 JSON，让前端能提示"断网了"。
 *   2. 导航请求       network-first，失败回 /offline。SPA 壳子不预缓存，避免版本错位。
 *   3. 静态资源       stale-while-revalidate。/_next/static 是内容哈希命名的，缓存很安全。
 *
 * 注意：只在生产注册（见 components/sw-register.tsx），否则会跟 dev HMR 打架。
 */

const VERSION = 'linxi-v1';
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = '/offline';

const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

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

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => offlineJson()));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest' ||
    /\.(?:css|js|woff2?|png|svg|jpg|jpeg|webp|ico)$/.test(url.pathname)
  ) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
