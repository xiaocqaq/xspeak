import type { NextConfig } from 'next';

/**
 * 部署在子路径时用的前缀，比如挂到 test.xlingo.fun/xlearn 就设成 `/xlearn`。
 * 不设就是挂在域名根上，行为和以前完全一样。
 *
 * 这个值必须以 NEXT_PUBLIC_ 开头 —— 客户端代码拼 API 地址和 WebSocket 地址都要读它，
 * 只有 NEXT_PUBLIC_ 前缀的变量才会被 Next 注入到浏览器包里。
 * 单一真源在 src/lib/base-path.ts，那边负责把结尾多余的斜杠洗掉。
 */
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  // pg 会按运行环境动态 require（原生 pg-native / 纯 JS 实现），交给 Node 运行时解析
  serverExternalPackages: ['pg'],
  typedRoutes: false,
  // 不让 Next 自动往仓库里塞 AGENTS.md / CLAUDE.md
  agentRules: false,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  async headers() {
    return [
      {
        // 这里的 source 会被 Next 自动加上 basePath，所以写相对根的路径就行
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          // 作用域只给到自己这一段。挂在共享域名的子路径上时，
          // 声明 '/' 会让这个 SW 去接管同域下别人的站，那是真事故。
          { key: 'Service-Worker-Allowed', value: `${basePath}/` },
        ],
      },
    ];
  },
};

export default nextConfig;
