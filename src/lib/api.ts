import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOrCreateUser } from '@/lib/db';
import { AiError } from '@/lib/ai/client';
import type { UserProfile } from '@/lib/types';

export function ok<T>(data: T): NextResponse {
  return NextResponse.json({ ok: true, data });
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export function currentUser(): UserProfile {
  return getOrCreateUser();
}

/**
 * 统一包裹路由处理：把异常翻译成中文提示。
 * AI 调用失败是最常见的故障，单独给出可操作的提示。
 */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return ok(await fn());
  } catch (err) {
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
