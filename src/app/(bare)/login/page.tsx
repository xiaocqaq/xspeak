import { Suspense } from 'react';
import { LoginForm } from '@/components/login-form';

export const metadata = { title: '登录' };

/*
 * 表单要读 ?next=，也就是 useSearchParams()，所以这页不能预渲染 ——
 * force-dynamic + Suspense 两样都留着：前者关掉静态化，
 * 后者是 useSearchParams 在客户端组件里的硬性要求。
 */
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
