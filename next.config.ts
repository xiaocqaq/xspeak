import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // better-sqlite3 是原生模块，不能被打包，必须留给 Node 运行时 require
  serverExternalPackages: ['better-sqlite3'],
  typedRoutes: false,
  // 不让 Next 自动往仓库里塞 AGENTS.md / CLAUDE.md
  agentRules: false,
  async headers() {
    return [
      {
        // Service Worker 必须以根作用域生效，且不能被缓存住旧版本
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
