import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOrCreateUser, getOrCreateExternalUser } from '@/lib/db';
import { AiError } from '@/lib/ai/client';
import { authConfig, currentIdentity } from '@/lib/auth';
import type { UserProfile } from '@/lib/types';

export function ok<T>(data: T): NextResponse {
  return NextResponse.json({ ok: true, data });
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

/**
 * 自带状态码的错误。
 *
 * handle() 默认把异常当 500，但有些失败不是服务器故障：密码错是 401，
 * 上游连不上是 502。这两种如果都报 500，用户会以为是我们的 bug。
 */
export class HttpError extends Error {
  status: number;
  /** 机器可读的原因，客户端据此决定是跳登录页还是静默重试 */
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/**
 * 没登录。
 *
 * 单独一个类型而不是直接 fail(401)，是为了让 currentUser() 能在任何深度直接抛 ——
 * 二十多个路由都是 `const user = await currentUser()` 开头，逐个改成检查返回值
 * 既啰嗦又容易漏一个（漏掉的那个就是数据泄露）。抛异常的默认行为是拒绝，更安全。
 */
export class UnauthorizedError extends HttpError {
  constructor(message = '请先登录。') {
    super(message, 401, 'unauthenticated');
    this.name = 'UnauthorizedError';
  }
}

/**
 * 当前请求的用户档案。
 *
 * 两种模式：
 * - 配了 AUTH_UPSTREAM_URL：按 cookie 里的令牌问上游要身份，一人一份档案。
 *   没登录直接抛 UnauthorizedError，由 handle() 翻成 401。
 * - 没配：单人模式，固定 id=1。本地开发和冒烟测试用。
 */
export async function currentUser(): Promise<UserProfile> {
  const cfg = authConfig();
  if (!cfg.enabled) return getOrCreateUser();

  const identity = await currentIdentity();
  if (!identity) throw new UnauthorizedError();
  return getOrCreateExternalUser(identity, cfg.adoptUserId);
}

/**
 * 统一包裹路由处理：把异常翻译成中文提示。
 * AI 调用失败是最常见的故障，单独给出可操作的提示。
 */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof HttpError) {
      /*
       * UnauthorizedError 会带上 code: 'unauthenticated' —— 客户端拿 401 是分不清
       * 「没登录」和「令牌刚过期」的，前者该跳登录页，后者该先静默续期再重试一次。
       * 见 src/lib/fetcher.ts。
       */
      return fail(err.message, err.status, err.code ? { code: err.code } : undefined);
    }
    if (err instanceof AiError) {
      return fail(`AI 生成失败：${err.message}`, 502);
    }
    if (err instanceof z.ZodError) {
      return fail(`参数不对：${err.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`, 422);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[linxi api]', err);
    return fail(msg || '服务器出错了', 500);
  }
}

/** 解析并校验请求体。 */
export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new z.ZodError([
      { code: 'custom', message: '请求体不是合法 JSON', path: [], input: undefined },
    ]);
  }
  return schema.parse(raw);
}
