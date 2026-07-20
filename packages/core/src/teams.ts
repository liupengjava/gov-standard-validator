import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { ROOT } from './config.ts';

export const DATA_DIR = process.env.SP_DATA_DIR || resolve(ROOT, 'data');
export const TEAMS_FILE = resolve(DATA_DIR, 'teams.json');
export const AVATAR_DIR = resolve(ROOT, 'storage/avatars');

export const SA_NAMES = ['临风', '思政', '苏叶', '星遥'];
export const EXCLUDE = ['天烬'];

// 「业务方向汇总」对外展示：SA 成员花名 → 所负责的业务方向；底层仍按花名从飞书同步以驱动问答评测。
export const SA_TEAM_LABEL = '业务方向汇总';
export const DIRECTION_BY_NAME: Record<string, string> = {
  临风: '金融方向',
  思政: '私域方向',
  苏叶: '公安&运营商内部方向',
  星遥: '运营商政企部方向',
};
const SALES_PARENT_QUERY = '政企部';
const SALES_DEPT_NAME = '销售部';
const ID_PARAMS = { department_id_type: 'open_department_id', user_id_type: 'open_id' };

export type Member = {
  openId: string; name: string; team: '销售团队' | '解决方案团队';
  title?: string; deptPath?: string; region?: string; joinTime?: number; avatar?: string;
};
export type TeamsData = { members: Member[]; syncedAt: string };

export function readTeams(): TeamsData {
  try { return JSON.parse(readFileSync(TEAMS_FILE, 'utf-8')); } catch { return { members: [], syncedAt: '' }; }
}

// 对外展示用：把解决方案团队成员改成「业务方向汇总」下的各业务方向（openId 不变，问答评测仍按人）。
export function readTeamsForDisplay(): TeamsData {
  const d = readTeams();
  return {
    ...d,
    members: d.members.map((m) =>
      m.team === '解决方案团队'
        ? { ...m, name: DIRECTION_BY_NAME[m.name] || m.name, team: SA_TEAM_LABEL as any }
        : m,
    ),
  };
}

export function regionFromPath(pathText: string): string | undefined {
  const m = (pathText || '').match(/[一-龥]{1,4}大区/);
  return m?.[0];
}

export function mapLarkUser(raw: any, team: Member['team']): Member {
  const avatar = raw.avatar as { avatar_240?: string; avatar_72?: string } | undefined;
  const pathArr = (raw.department_path as any[]) || [];
  const pathText = pathArr
    .map((p) => p?.department_path?.department_path_name?.name ?? p?.department_name?.name ?? '')
    .filter(Boolean).join(' | ');
  return {
    openId: String(raw.open_id || ''),
    name: String(raw.name || ''),
    team,
    title: raw.job_title ? String(raw.job_title) : undefined,
    deptPath: pathText || undefined,
    region: regionFromPath(pathText),
    joinTime: raw.join_time ? Number(raw.join_time) : undefined,
    avatar: avatar?.avatar_240 || avatar?.avatar_72 || undefined, // 临时存远程 URL，syncTeams 内会替换为本地路径
  };
}

export function dedupExclude(members: Member[], excludeNames: string[]): Member[] {
  const ex = new Set(excludeNames);
  const seen = new Set<string>();
  const out: Member[] = [];
  for (const m of members) {
    if (!m.openId || ex.has(m.name) || seen.has(m.openId)) continue;
    seen.add(m.openId); out.push(m);
  }
  return out;
}

function lark(method: string, path: string, params?: any, data?: any): Promise<any> {
  const args = ['api', method, path, '--as', 'user', '--json'];
  if (params) args.push('--params', JSON.stringify(params));
  if (data) args.push('--data', JSON.stringify(data));
  return new Promise((ok) => {
    execFile('lark-cli', args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return ok(null);
      try { const j = JSON.parse(stdout); ok(j?.code && j.code !== 0 ? null : (j?.data ?? null)); } catch { ok(null); }
    });
  });
}

async function searchDepts(query: string): Promise<any[]> {
  const d = await lark('POST', '/open-apis/contact/v3/departments/search', { ...ID_PARAMS, page_size: 50 }, { query });
  return d?.items || [];
}

// 公司里有多个同名「销售部」(政企部 / 商业一部 等)；只取 parent 为「政企部」的那个
async function findSalesDeptId(): Promise<string | null> {
  const zqb = (await searchDepts(SALES_PARENT_QUERY))[0]?.open_department_id;
  const candidates = await searchDepts(SALES_DEPT_NAME);
  if (zqb) {
    const direct = candidates.find((c: any) => c.parent_department_id === zqb);
    if (direct) return direct.open_department_id;
  }
  return candidates[0]?.open_department_id ?? null;
}

// 取某部门子树(含自身)的部门列表，带各部门主管 id（主管不在 find_by_department 直属里，需单独补）
async function subtreeDepts(rootId: string): Promise<{ id: string; leaderId?: string }[]> {
  const out: { id: string; leaderId?: string }[] = [{ id: rootId }];
  let token: string | undefined;
  do {
    const params: any = { ...ID_PARAMS, fetch_child: true, page_size: 50 };
    if (token) params.page_token = token;
    const d = await lark('GET', `/open-apis/contact/v3/departments/${rootId}/children`, params);
    if (!d) break;
    for (const dep of d.items || []) if (dep?.open_department_id) out.push({ id: dep.open_department_id, leaderId: dep.leader_user_id });
    token = d.has_more ? d.page_token : undefined;
  } while (token);
  return out;
}

async function userById(openId: string): Promise<any | null> {
  const d = await lark('GET', `/open-apis/contact/v3/users/${openId}`, { ...ID_PARAMS });
  return d?.user ?? null;
}

async function usersByDept(deptId: string): Promise<any[]> {
  const out: any[] = []; let token: string | undefined;
  do {
    const params: any = { ...ID_PARAMS, department_id: deptId, page_size: 50 };
    if (token) params.page_token = token;
    const d = await lark('GET', '/open-apis/contact/v3/users/find_by_department', params);
    if (!d) break;
    out.push(...(d.items || []));
    token = d.has_more ? d.page_token : undefined;
  } while (token);
  return out;
}

async function userByName(name: string): Promise<any | null> {
  const r: any = await new Promise((ok) => {
    execFile('lark-cli', ['contact', '+search-user', '--query', name], { timeout: 20000 }, (e, so) => {
      if (e) return ok(null); try { ok(JSON.parse(so)); } catch { ok(null); }
    });
  });
  const u = r?.data?.users?.find((x: any) => x.localized_name === name) ?? r?.data?.users?.[0];
  if (!u?.open_id) return null;
  const full = await lark('GET', `/open-apis/contact/v3/users/${u.open_id}`, { ...ID_PARAMS });
  return full?.user ?? { open_id: u.open_id, name };
}

async function downloadAvatar(url: string, openId: string): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!existsSync(AVATAR_DIR)) mkdirSync(AVATAR_DIR, { recursive: true });
    const rel = `storage/avatars/${openId}.jpg`;
    writeFileSync(resolve(ROOT, rel), buf);
    return rel;
  } catch { return undefined; }
}

export async function syncTeams(): Promise<TeamsData> {
  const sales: Member[] = [];
  const salesDept = await findSalesDeptId();
  if (salesDept) {
    // 销售部本身 + 其下各大区子部门：直属成员 + 各部门主管(主管不在直属列表里)
    for (const dep of await subtreeDepts(salesDept)) {
      for (const u of await usersByDept(dep.id)) sales.push(mapLarkUser(u, '销售团队'));
      if (dep.leaderId) { const lu = await userById(dep.leaderId); if (lu) sales.push(mapLarkUser(lu, '销售团队')); }
    }
  }

  const sa: Member[] = [];
  for (const name of SA_NAMES) { const u = await userByName(name); if (u) sa.push(mapLarkUser(u, '解决方案团队')); }

  let members = dedupExclude([...sales, ...sa], EXCLUDE);
  // 下载头像，把 avatar 从远程 URL 换成本地相对路径
  for (const m of members) m.avatar = await downloadAvatar(m.avatar || '', m.openId);

  const data: TeamsData = { members, syncedAt: new Date().toISOString() };
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TEAMS_FILE, JSON.stringify(data, null, 2));
  return data;
}
