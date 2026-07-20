import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './config.ts';

// 管理员允许名单：按飞书花名（user_info.name）匹配，不用 open_id。
// 原因：open_id 按飞书「应用」隔离——登录用的 SalesPilot app（cli_aab7e0bce538dbc0）与
// 运维查询用的 lark-cli app（cli_a941fd0dc7795bb3）是两个应用，同一个人 open_id 不同、对不上；
// 花名跨应用一致，用它判定最省事（PRD-0018 决策修订，用户拍板「统一用花名」）。
// 每次读文件、不缓存：改 admins.json 即时生效。
const DATA_DIR = process.env.SP_DATA_DIR || resolve(ROOT, 'data');
const ADMINS_FILE = resolve(DATA_DIR, 'admins.json');

// admins.json 结构：{ "admins": ["花名", ...] }（兼容旧的 [{name,openId}] 结构）。
export function readAdminNames(): string[] {
  try {
    const parsed = JSON.parse(readFileSync(ADMINS_FILE, 'utf-8'));
    const list = Array.isArray(parsed?.admins) ? parsed.admins : [];
    return list
      .map((a: any) => (typeof a === 'string' ? a : a?.name))
      .filter(Boolean)
      .map((s: string) => String(s).trim());
  } catch {
    return [];
  }
}

export function isAdminName(name?: string | null): boolean {
  if (!name) return false;
  const n = String(name).trim();
  return !!n && readAdminNames().includes(n);
}
