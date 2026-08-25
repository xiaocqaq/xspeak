'use client';

import { useEffect } from 'react';
import { BASE_PATH, withBase } from '@/lib/base-path';

/**
 * 注册 Service Worker。只在生产构建里注册 —— 开发时 SW 缓存会和 Next 的 HMR 打架。
 */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const onLoad = () => {
      // 作用域跟着部署前缀走。挂在共享域名的子路径上时不能声明 '/' ——
      // 那会让这个 SW 去接管同域下别人的站。
      navigator.serviceWorker
        .register(withBase('/sw.js'), { scope: `${BASE_PATH}/` })
        .catch((err) => {
          console.warn('Service Worker 注册失败：', err);
        });
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);
  return null;
}
