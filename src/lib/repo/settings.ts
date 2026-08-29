import { all, one, run } from '@/lib/db';

/**
 * 全站运行时设置（app_settings 表）。
 *
 * 只放「装完之后还想在界面上改」的那几项，现在就是每个角色用哪个模型。
 * 地址和密钥不在这里 —— 那些留在 .env.local，见 src/lib/ai/config.mjs。
 *
 * 不缓存：读一次是一条主键查询，比它后面那次模型调用便宜几个数量级，
 * 换来的是设置页一改立刻生效，不用等缓存过期也不用重启。
 */

/** 取一项；没有返回 undefined。 */
export async function getSetting(key: string): Promise<string | undefined> {
  const row = await one<{ value: string }>('SELECT value FROM app_settings WHERE key = @key', {
    key,
  });
  return row?.value;
}

/** 一次取多项，返回 key → value。缺的键不会出现在结果里。 */
export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  if (!keys.length) return {};
  const rows = await all<{ key: string; value: string }>(
    'SELECT key, value FROM app_settings WHERE key = ANY(@keys)',
    { keys },
  );
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** 写一项。传 null 表示删掉这一项（回到配置文件里的默认值）。 */
export async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await run('DELETE FROM app_settings WHERE key = @key', { key });
    return;
  }
  await run(
    `INSERT INTO app_settings (key, value) VALUES (@key, @value)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
    { key, value },
  );
}
