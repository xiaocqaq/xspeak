import { NextResponse, type NextRequest } from 'next/server';

/**
 * 页面级的登录门卫。
 *
 * 文件名是 proxy.ts 而不是 middleware.ts：Next 16 起后者已废弃，
 * 构建时会警告，行为完全一样（导出 default 而不是具名 middleware）。
 *
 * 只做一件事：**没有会话 cookie 的人访问页面时，直接跳登录页**。
 *
 * 三个刻意的限制：
 *
 * 1. 这里不校验令牌真伪，只看 cookie 在不在。这一层跑在 Edge 运行时，
 *    没法用 node:crypto、也不该为每个页面请求（包括每张图、每个 RSC 分片）
 *    去打一次上游 /me。真正的校验在 currentUser() 里 —— 那才是安全边界，
 *    这里只负责「别让人对着一个注定加载失败的空壳界面发呆」。
 *
 * 2. 因此**不放 /api**。API 的拒绝要是结构化的 401 JSON（带 code 让客户端
 *    决定续期还是跳登录），这一层给不了这个语义，而且一个假 cookie 就能骗过它。
 *    /api 一律由 currentUser() 挡。
 *
 * 3. 判断不了「令牌有效但已过期」——那种情况用户会看到页面正常打开、
 *    然后接口报 401 触发前端跳转。多一次跳转，但不会漏放。
 *
 * 没配 AUTH_UPSTREAM_URL 时整个 proxy 是空操作（单人模式）。
 */

/** cookie 名要和 src/lib/auth/config.mjs 里拼的一致。 */
function sessionCookieName(): string {
  const prefix = (process.env.AUTH_COOKIE_PREFIX ?? '').trim() || 'xspeak';
  return `${prefix}_session`;
}

/** 不需要登录就能看的页面。 */
const PUBLIC_PAGES = ['/login', '/offline'];

export default function proxy(req: NextRequest) {
  // 没配上游 = 单人模式，不拦
  if (!(process.env.AUTH_UPSTREAM_URL ?? '').trim()) return NextResponse.next();

  // req.nextUrl.pathname 已经被 Next 剥掉了 basePath，所以这里按相对根匹配
  const path = req.nextUrl.pathname;
  if (PUBLIC_PAGES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (req.cookies.get(sessionCookieName())?.value) return NextResponse.next();

  /*
   * 登录后跳回原地。next 只存 pathname + search，不存完整 URL ——
   * 存完整 URL 就成了开放重定向（?next=https://evil.example 会把人送出站）。
   * 登录页那边也只按相对路径用。
   */
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  const from = `${path}${req.nextUrl.search}`;
  if (from && from !== '/') url.searchParams.set('next', from);
  // NextResponse.redirect 会自动补 basePath（nextUrl 带着它），不用手动拼
  return NextResponse.redirect(url);
}

export const config = {
  /*
   * 排除掉的都是「拦了只会坏事」的：
   * - api：见上面第 2 点，由 currentUser() 挡
   * - _next：框架自己的产物，拦了整站没样式
   * - sw.js / manifest / icons / 静态文件：PWA 要在没登录时也能装得上、
   *   离线页要打得开，拦了会让 Service Worker 注册失败
   */
  matcher: [
    '/((?!api|_next/static|_next/image|sw\\.js|manifest\\.webmanifest|icons/|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|mp3|json)$).*)',
  ],
};
