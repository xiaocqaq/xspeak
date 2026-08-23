/**
 * 清库重来。会把 data/linxi.db 备份成 .bak 再删掉，下次启动自动重建 + 重新播种。
 *
 * 用法：
 *   npm run db:reset            # 备份后删除
 *   npm run db:reset -- --hard  # 直接删，不备份
 */

import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const file = process.env.LINXI_DB_PATH?.trim()
  ? path.resolve(process.env.LINXI_DB_PATH.trim())
  : path.resolve(process.cwd(), 'data', 'linxi.db');

const hard = process.argv.includes('--hard');

if (!existsSync(file)) {
  console.log(`没有找到 ${file}，不用清。下次启动会自动建库。`);
  process.exit(0);
}

if (!hard) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(path.dirname(file), 'backup');
  mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, `${path.basename(file)}.${stamp}.bak`);
  copyFileSync(file, backup);
  console.log(`已备份 → ${backup}`);
}

// WAL 模式下还有两个附属文件，一起清掉才干净
for (const suffix of ['', '-wal', '-shm']) {
  const f = file + suffix;
  if (existsSync(f)) {
    rmSync(f);
    console.log(`已删除 ${f}`);
  }
}
console.log('清完了。下次启动会重建表结构并重新播种内置词表和语法点。');
