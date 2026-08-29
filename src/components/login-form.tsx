'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { Button, Card, ErrorNote, Input } from '@/components/ui';
import { apiPost } from '@/lib/fetcher';

/**
 * 登录页。
 *
 * 身份由 ai.xlingo.fun 提供，所以这里不做注册、也不做找回密码 ——
 * 那些都在那边，重做一遍只会出现两套互不同步的账号状态。
 *
 * 两步：账号密码 → （如果开了 2FA）验证码。两步打同一个接口，
 * 第二步多带一个 challengeToken。
 */

type LoginResponse =
  | { twoFactorRequired: true; challengeToken: string | null; methods: string[] }
  | { twoFactorRequired: false; user: { name: string; onboarded: boolean } };

/**
 * 登录后往哪跳。
 *
 * 只接受站内相对路径：`//evil.example` 和 `https://…` 一律丢掉，
 * 否则 ?next= 就是个开放重定向，能拿我们的域名给钓鱼页做跳板。
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const twoFactor = Boolean(challengeToken);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 上游的规则（username ≥ 3、password ≥ 6）先在本地挡一遍，省一次白跑的往返
    if (!twoFactor) {
      if (username.trim().length < 3) return setError('账号至少 3 个字符。');
      if (password.length < 6) return setError('密码至少 6 位。');
    } else if (code.trim().length < 6) {
      return setError('验证码至少 6 位。');
    }

    setBusy(true);
    try {
      const res = await apiPost<LoginResponse>('/api/auth/login', {
        username: username.trim(),
        password,
        ...(twoFactor ? { challengeToken, code: code.trim() } : {}),
      });

      if (res.twoFactorRequired) {
        setChallengeToken(res.challengeToken);
        setBusy(false);
        return;
      }

      /*
       * 用 replace 而不是 push：登录页不该留在返回栈里，
       * 否则登录成功后按一下返回又是登录页，看着像没登上。
       * 没建过档的人先去引导。
       */
      router.replace(res.user.onboarded ? next : '/onboarding');
      // 不 setBusy(false)：跳转期间保持禁用，避免重复提交
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <div className="fade-up space-y-5">
        <header>
          {/*
            这里原来是 <p className="section-label">，但 section-label 带
            text-transform: uppercase，字标会被渲染成 XSPEAK，和小写 x 的写法冲突。
            section-label 全站都在用，不能为了这一处去掉大写，所以换成真标识。
          */}
          <p className="flex items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-brand-500 text-white">
              <BrandMark className="h-[19px] w-auto" />
            </span>
            <span className="font-serif text-[17px] font-bold tracking-[-0.02em] text-[var(--text-title)]">
              xSpeak
            </span>
          </p>
          <h1 className="mt-3 text-[26px] sm:text-[30px]">
            {twoFactor ? '两步验证' : '登录'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
            {twoFactor
              ? '打开你的验证器应用，输入当前的 6 位验证码。'
              : '用 ai.xlingo.fun 的账号登录，用户名或邮箱都行。'}
          </p>
        </header>

        <Card>
          <form onSubmit={submit} className="space-y-4">
            {twoFactor ? (
              <div className="space-y-2">
                <label htmlFor="code" className="text-sm font-semibold text-[var(--text-title)]">
                  验证码
                </label>
                <Input
                  id="code"
                  name="one-time-code"
                  /*
                   * inputMode + autoComplete 让手机弹数字键盘、并让系统能自动填充
                   * 短信/验证器里的码。type 仍是 text：number 会带上没用的加减按钮，
                   * 而且前导 0 会被吃掉。
                   */
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="6 位数字"
                />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <label
                    htmlFor="username"
                    className="text-sm font-semibold text-[var(--text-title)]"
                  >
                    账号
                  </label>
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="用户名或邮箱"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="password"
                    className="text-sm font-semibold text-[var(--text-title)]"
                  >
                    密码
                  </label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </>
            )}

            {error && <ErrorNote message={error} />}

            <Button type="submit" loading={busy} className="w-full">
              {twoFactor ? (
                <>
                  <ShieldCheck className="size-4" aria-hidden />
                  验证
                </>
              ) : (
                <>
                  登录
                  <ArrowRight className="size-4" aria-hidden />
                </>
              )}
            </Button>

            {twoFactor && (
              <button
                type="button"
                className="w-full text-center text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-title)]"
                onClick={() => {
                  setChallengeToken(null);
                  setCode('');
                  setError(null);
                }}
              >
                换个账号登录
              </button>
            )}
          </form>
        </Card>

        {!twoFactor && (
          <p className="text-center text-[13px] leading-relaxed text-[var(--text-faint)]">
            没有账号或忘了密码？去{' '}
            {/*
              指回上游而不是自己做注册/找回：账号体系只有一份，
              在这里再开一个入口就会出现两套互不同步的状态。
              rel 里带 noreferrer：别把 xSpeak 的地址泄给外部页面。
            */}
            <a
              href="https://ai.xlingo.fun"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand-600 hover:underline"
            >
              ai.xlingo.fun
            </a>{' '}
            处理。
          </p>
        )}
      </div>
    </div>
  );
}
