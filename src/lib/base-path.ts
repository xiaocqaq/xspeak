/**
 * 子路径部署的前缀，单一真源。
 *
 * Next 会自动给这些东西加前缀：<Link>、router.push、/_next/* 静态资源、public/ 里的文件、
 * 还有 Route Handler 的实际访问路径。但它管不到我们手写的字符串 ——
 * fetch('/api/...')、new WebSocket(...)、Service Worker 注册路径，这些都得自己拼。
 *
 * 所以规矩是：凡是代码里写死的、要发到网络上的绝对路径，都过一遍 withBase()。
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

/** 给一个以 / 开头的站内路径加上部署前缀。 */
export function withBase(path: string): string {
  if (!BASE_PATH) return path;
  return path.startsWith('/') ? `${BASE_PATH}${path}` : `${BASE_PATH}/${path}`;
}
