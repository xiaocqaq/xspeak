import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // pg 会按运行环境动态 require（原生 pg-native / 纯 JS 实现），交给 Node 运行时解析
  serverExternalPackages: ['pg'],
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
