import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, STORAGE_DERIVED, MODEL_PARSE, PARSE_CONCURRENCY } from './config.ts';
import { analyzeSlide, analyzeSlideCodex } from './ai-cli.ts';
import { buildChunks, tableToMarkdown } from './parsing.ts';
import {
  createAsset, createVersion, createUnit, createChunk,
  findVersionByChecksum, setVersionStatus, setAssetStatus,
} from './db.ts';

const pexec = promisify(execFile);
const MATERIALS = resolve(ROOT, 'materials/feishu');
// 屏蔽 lark-cli 更新/技能提示，保证 JSON 输出纯净
export const LARK_ENV = { ...process.env, LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1', LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1' };

export type LarkExecOpts = { maxBuffer?: number; timeout?: number; env?: NodeJS.ProcessEnv };

/** 把 lark-cli 的结构化错误翻成给终端用户看的人话（纯函数，便于测试）。
 *  最常见的入库失败是 3380004：当前身份对该文档无查看/编辑权限。 */
export function friendlyLarkError(r: any): string {
  const err = r?.error || {};
  const msg = String(err.message || '');
  if (err.code === 3380004 || /No permission to operate on this document/i.test(msg)) {
    return '无权访问该飞书文档：请让文档所有者把它分享给当前登录的飞书账号（或本应用机器人）后重试';
  }
  // 多维表格（bitable）的无权限/不存在：91402 NOTEXIST、91403 FORBIDDEN
  if (err.code === 91402 || err.code === 91403 || /^(NOTEXIST|FORBIDDEN)$/i.test(msg.trim())) {
    return '无权访问该多维表格（或链接不存在）：请让所有者把它分享给当前登录的飞书账号（或本应用机器人）后重试';
  }
  return msg || '飞书文档抓取失败，请稍后重试';
}

/** 运行 lark-cli 并解析其 JSON 输出。
 *  lark-cli 遇权限/校验错误会以非零码退出，且把结构化 JSON 写到 stderr（成功时在
 *  stdout）。execFile 因非零退出而 reject，JSON 挂在 e.stderr / e.stdout 上。这里
 *  两条流都兜回来解析，避免把「Command failed: lark-cli docs +fetch …」原样抛给用户。 */
export async function runLarkJson(args: string[], opts: LarkExecOpts): Promise<any> {
  let stdout = '', stderr = '';
  try {
    ({ stdout, stderr } = await pexec('lark-cli', args, opts));
  } catch (e: any) {
    stdout = typeof e?.stdout === 'string' ? e.stdout : '';
    stderr = typeof e?.stderr === 'string' ? e.stderr : '';
    if (!stdout.trim() && !stderr.trim()) throw e; // 真·执行失败（命令不存在/超时等），无 JSON 可解析
  }
  for (const raw of [stdout, stderr]) {
    const t = raw.trim();
    if (t) { try { return JSON.parse(t); } catch { /* 换下一条流再试 */ } }
  }
  throw new Error(friendlyLarkError(null)); // 拿不到结构化输出，给通用兜底
}

/** 按 URL 路径段判断飞书链接类型（docx 直链 / 电子表格 / 多维表格 / wiki 节点）。纯函数。 */
export function detectFeishuUrlType(url: string): 'docx' | 'sheet' | 'base' | 'wiki' | 'unknown' {
  if (/\/docx\//.test(url)) return 'docx';
  if (/\/sheets\//.test(url)) return 'sheet';
  if (/\/base\//.test(url)) return 'base';
  if (/\/wiki\//.test(url)) return 'wiki';
  return 'unknown';
}

async function fetchMarkdown(url: string): Promise<string> {
  const r = await runLarkJson(
    ['docs', '+fetch', '--doc', url, '--doc-format', 'markdown', '--format', 'json'],
    { maxBuffer: 32 * 1024 * 1024, timeout: 120000, env: LARK_ENV }
  );
  if (!r.ok && !r.data) throw new Error(friendlyLarkError(r));
  return r.data?.document?.content || '';
}

// 文档真实标题在正文里不一定有（不少文档首行就是「一、项目背景」等章节名）。
// XML 格式的 <title> 才是文档名，用它兜底。
export async function fetchDocTitle(url: string): Promise<string> {
  try {
    const { stdout } = await pexec(
      'lark-cli',
      ['docs', '+fetch', '--doc', url, '--doc-format', 'xml', '--format', 'json'],
      { maxBuffer: 32 * 1024 * 1024, timeout: 120000, env: LARK_ENV }
    );
    const r = JSON.parse(stdout);
    return (r.data?.document?.content || '').match(/<title>([^<]+)<\/title>/)?.[1]?.trim() || '';
  } catch { return ''; }
}

// 章节式标题（「一、xxx」「1. xxx」「项目背景/项目概览…」）不是合格的文档名。
function looksLikeSection(t: string): boolean {
  return /^[一二三四五六七八九十\d]+[、.．]/.test(t) || /^(项目背景|项目概览)/.test(t);
}

/** 把 markdown 按标题切成 section，长 section 再按长度二次切。 */
export function splitSections(md: string): { heading: string; text: string }[] {
  const lines = md.split('\n');
  const secs: { heading: string; text: string }[] = [];
  let cur = { heading: '', buf: [] as string[] };
  const flush = () => { const t = cur.buf.join('\n').trim(); if (t || cur.heading) secs.push({ heading: cur.heading, text: t }); };
  for (const ln of lines) {
    const m = ln.match(/^#{1,4}\s+(.*)/);
    if (m) { flush(); cur = { heading: m[1].trim(), buf: [] }; }
    else cur.buf.push(ln);
  }
  flush();
  // 长 section 二次切（~1200 字）
  const out: { heading: string; text: string }[] = [];
  for (const s of secs) {
    if (s.text.length <= 1400) { out.push(s); continue; }
    for (let i = 0; i < s.text.length; i += 1200) out.push({ heading: s.heading, text: s.text.slice(i, i + 1200) });
  }
  return out.filter((s) => (s.heading + s.text).trim().length > 0);
}

/** 解析正文里的 <sheet token="..." sheet-id="..."> 嵌入表格标签。纯函数。 */
export function parseSheetTags(content: string): { token: string; sheetId: string }[] {
  const out: { token: string; sheetId: string }[] = [];
  for (const tag of content.match(/<sheet\b[^>]*>/g) || []) {
    const token = tag.match(/token="([^"]+)"/)?.[1];
    const sheetId = tag.match(/sheet-id="([^"]+)"/)?.[1];
    if (token && sheetId) out.push({ token, sheetId });
  }
  return out;
}

/** sheets +table-get 的 {sheets:[{columns,data}]} → markdown 表格。纯函数。 */
export function sheetsJsonToMarkdown(data: any): string {
  const sheets = Array.isArray(data?.sheets) ? data.sheets : [];
  const parts: string[] = [];
  for (const s of sheets) {
    const cols = Array.isArray(s?.columns) ? s.columns.map((c: any) => String(c ?? '')) : [];
    const rows = Array.isArray(s?.data)
      ? s.data.map((r: any) => (Array.isArray(r) ? r.map((c: any) => String(c ?? '')) : []))
      : [];
    const all = cols.length ? [cols, ...rows] : rows;
    if (all.length) parts.push(tableToMarkdown(all));
  }
  return parts.join('\n\n');
}

/** 读取单个嵌入表格并转 markdown（失败返回空，不致命）。 */
async function fetchSheetMarkdown(token: string, sheetId: string): Promise<string> {
  try {
    const { stdout } = await pexec(
      'lark-cli',
      ['sheets', '+table-get', '--spreadsheet-token', token, '--sheet-id', sheetId, '--format', 'json'],
      { maxBuffer: 16 * 1024 * 1024, timeout: 60000, env: LARK_ENV }
    );
    const r = JSON.parse(stdout);
    return r.ok ? sheetsJsonToMarkdown(r.data) : '';
  } catch { return ''; }
}

/** 把正文里每个 <sheet> 嵌入表格的真实数据，作为 markdown 表格插到该标签后面。 */
async function enrichEmbeds(content: string): Promise<string> {
  const tags = parseSheetTags(content);
  if (!tags.length) return content;
  let out = content;
  for (const t of tags) {
    const md = await fetchSheetMarkdown(t.token, t.sheetId);
    if (!md) continue;
    const re = new RegExp(`(<sheet\\b[^>]*token="${t.token}"[^>]*>)`);
    out = out.replace(re, `$1\n\n${md}\n`);
  }
  return out;
}

export type FeishuIngestOpts = { title?: string; group?: string; category?: string; industry?: string };

/** 查 wiki 节点的真实对象类型（wiki 链接可能挂 docx/sheet/bitable 等任意对象）。
 *  lark-cli wiki +node-get 直接吃 URL，返回 obj_type/obj_token/title。 */
async function fetchWikiNode(url: string): Promise<{ objType: string; objToken: string; title: string }> {
  const r = await runLarkJson(
    ['wiki', '+node-get', '--node-token', url, '--format', 'json'],
    { maxBuffer: 4 * 1024 * 1024, timeout: 60000, env: LARK_ENV }
  );
  if (!r.ok || !r.data) throw new Error(friendlyLarkError(r));
  return {
    objType: String(r.data.obj_type || ''),
    objToken: String(r.data.obj_token || ''),
    title: String(r.data.title || '').trim(),
  };
}

/** 云空间文件名（drive +inspect 带 wiki 解包），拿不到返回空串由调用方兜底。 */
async function fetchDriveTitle(url: string): Promise<string> {
  try {
    const r = await runLarkJson(
      ['drive', '+inspect', '--url', url, '--format', 'json'],
      { maxBuffer: 4 * 1024 * 1024, timeout: 60000, env: LARK_ENV }
    );
    return String(r?.data?.title || '').trim();
  } catch { return ''; }
}

/** 把切好的 sections 逐个落成 unit + 文本 chunk（docx 与 sheet 入库共用）。 */
function storeSections(versionId: string, secs: { heading: string; text: string }[]): void {
  secs.forEach((s, i) => {
    const unitId = createUnit({
      versionId, slideNo: i + 1, imagePath: '', rawText: s.text,
      visualJson: '{}', title: s.heading || null as any, slideType: 'section',
    });
    const text = (s.heading ? s.heading + '。' : '') + s.text;
    if (text.trim()) createChunk({ unitId, text, chunkType: 'doc' });
  });
}

export async function ingestFeishuDoc(url: string, opts: FeishuIngestOpts = {}) {
  // 入口分流：sheet/base/wiki 各走各的，docx 及未知类型沿用原 docs +fetch 链路
  const kind = detectFeishuUrlType(url);
  if (kind === 'base') return ingestFeishuBase(url, opts);
  if (kind === 'sheet') return ingestFeishuSheet(url, opts);
  if (kind === 'wiki') {
    const node = await fetchWikiNode(url);
    if (node.objType === 'sheet') {
      // wiki 挂的是电子表格：用 obj_token 拼 sheets 直链走 sheet 分支；节点名即文件名
      return ingestFeishuSheet(`https://feishu.cn/sheets/${node.objToken}`, {
        ...opts, title: opts.title || node.title,
      });
    }
    if (node.objType === 'bitable') {
      // wiki 挂的是多维表格：obj_token 即 app_token，拼 base 直链走 base 分支
      return ingestFeishuBase(`https://feishu.cn/base/${node.objToken}`, {
        ...opts, title: opts.title || node.title,
      });
    }
    if (node.objType && node.objType !== 'docx' && node.objType !== 'doc') {
      throw new Error(`该 wiki 节点是「${node.objType}」类型，暂不支持入库；目前支持飞书文档、电子表格与多维表格`);
    }
    // docx/doc 节点 → 落到下方原文档链路（docs +fetch 本身支持 wiki 链接）
  }

  let md = await fetchMarkdown(url);
  if (!md.trim()) throw new Error('empty doc');
  md = await enrichEmbeds(md); // 嵌入表格的真实数据 → markdown 合并进正文
  const checksum = createHash('sha256').update(md).digest('hex');
  if (findVersionByChecksum(checksum)) return { skipped: true };

  mkdirSync(MATERIALS, { recursive: true });
  const rawPath = resolve(MATERIALS, `${checksum}.md`);
  writeFileSync(rawPath, md);

  let title = opts.title || (await fetchDocTitle(url));
  if (!title || looksLikeSection(title)) title = (md.match(/^#{1,2}\s+(.+)/m)?.[1]?.trim()) || url;
  const assetId = createAsset({
    sourceType: 'feishu_doc', title, assetType: 'doc', format: 'feishu_doc',
    sourceUrl: url, group: opts.group, category: opts.category, industry: opts.industry,
  });
  const versionId = createVersion({ assetId, version: 'v1', checksum, rawPath });

  try {
    const secs = splitSections(md);
    storeSections(versionId, secs);
    setVersionStatus(versionId, 'done', secs.length);
    setAssetStatus(assetId, 'published');
    return { assetId, versionId, sections: secs.length };
  } catch (e) {
    setVersionStatus(versionId, 'failed', undefined, String(e));
    setAssetStatus(assetId, 'failed');
    throw e;
  }
}

// ───────────────────────── 飞书电子表格入库（PRD-0027） ─────────────────────────

/** 单工作表最多收录的行数，防单元格洪灾撑爆 chunk。 */
const SHEET_MAX_ROWS = 2000;

/** 电子表格整本入库：+workbook-info 列工作表 → 逐表 +table-get → 每表一个 markdown section。
 *  与 ingestFeishuDoc 相同的 checksum 去重与状态流转；asset format 记 'sheet'。 */
export async function ingestFeishuSheet(url: string, opts: FeishuIngestOpts = {}) {
  const token = url.match(/\/sheets\/([^/?#]+)/)?.[1] || url;
  const info = await runLarkJson(
    ['sheets', '+workbook-info', '--spreadsheet-token', token, '--format', 'json'],
    { maxBuffer: 4 * 1024 * 1024, timeout: 60000, env: LARK_ENV }
  );
  if (!info.ok || !info.data) throw new Error(friendlyLarkError(info));
  // 混排表里的多维表格子表 grid 接口读不了（900015206），整本读会连带失败 → 先按 resource_type 过滤
  const worksheets = (Array.isArray(info.data.sheets) ? info.data.sheets : [])
    .filter((s: any) => s?.resource_type === 'sheet');
  if (!worksheets.length) throw new Error('该电子表格没有可入库的工作表（多维表格子表暂不支持）');

  const parts: string[] = [];
  for (const ws of worksheets) {
    const r = await runLarkJson(
      ['sheets', '+table-get', '--spreadsheet-token', token, '--sheet-id', String(ws.sheet_id), '--format', 'json'],
      { maxBuffer: 32 * 1024 * 1024, timeout: 120000, env: LARK_ENV }
    );
    const s = r?.ok ? r?.data?.sheets?.[0] : null;
    if (!s) { // 单表读取失败不致命（可能空表/受保护），跳过继续
      console.error(`工作表「${ws.sheet_name}」读取失败：${friendlyLarkError(r)}`);
      continue;
    }
    const rows: any[] = Array.isArray(s.data) ? s.data : [];
    const truncated = rows.length > SHEET_MAX_ROWS;
    if (truncated) s.data = rows.slice(0, SHEET_MAX_ROWS);
    const md = sheetsJsonToMarkdown({ sheets: [s] });
    if (!md.trim()) continue; // 空工作表
    const note = truncated ? `（仅收录前 ${SHEET_MAX_ROWS} 行，原表共 ${rows.length} 行）\n\n` : '';
    parts.push(`# ${String(ws.sheet_name || `工作表${parts.length + 1}`)}\n\n${note}${md}`);
  }
  if (!parts.length) throw new Error('未能读取到任何工作表内容（可能均为空表或无权限）');

  const md = parts.join('\n\n');
  const checksum = createHash('sha256').update(md).digest('hex');
  if (findVersionByChecksum(checksum)) return { skipped: true };

  mkdirSync(MATERIALS, { recursive: true });
  const rawPath = resolve(MATERIALS, `${checksum}.md`);
  writeFileSync(rawPath, md);

  // 标题优先级：调用方/wiki 节点名 > 云空间文件名 > 「飞书表格」+token 前缀兜底
  const title = opts.title || (await fetchDriveTitle(url)) || `飞书表格 ${token.slice(0, 6)}`;
  const assetId = createAsset({
    sourceType: 'feishu_sheet', title, assetType: 'doc', format: 'sheet',
    sourceUrl: url, group: opts.group, category: opts.category, industry: opts.industry,
  });
  const versionId = createVersion({ assetId, version: 'v1', checksum, rawPath });

  try {
    const secs = splitSections(md);
    storeSections(versionId, secs);
    setVersionStatus(versionId, 'done', secs.length);
    setAssetStatus(assetId, 'published');
    return { assetId, versionId, sections: secs.length };
  } catch (e) {
    setVersionStatus(versionId, 'failed', undefined, String(e));
    setAssetStatus(assetId, 'failed');
    throw e;
  }
}

// ───────────────────────── 飞书多维表格入库（PRD-0030） ─────────────────────────

/** Base 记录字段值 → 可读文本（纯函数，便于测试）。
 *  lark-cli base +record-list --format json 已把日期/公式/超链接类字段预渲染成字符串
 *  （日期如 "2024-11-30 00:00:00"、文档链接如 "[标题](url)"），这里兜住剩余结构化取值：
 *  - 空值(null/undefined) → ''；字符串/数字/布尔 → 直转
 *  - 附件数组（元素带 file_token）→ [附件×N]
 *  - 关联记录 id 数组（recXXX，取不到名称）→ [关联记录×N] 计数降级
 *  - 其余数组（单选/多选/人员/群/关联名称等）→ 元素逐个规整后用「、」连接
 *  - 对象：{name}(人员/群/附件/关联) → name；{text[,link]}(超链接) → text (link)；
 *    未知对象 JSON.stringify 截断兜底 */
export function baseCellToText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return '';
    if (v.every((x: any) => x && typeof x === 'object' && !Array.isArray(x) && x.file_token)) {
      return `[附件×${v.length}]`;
    }
    if (v.every((x: any) => typeof x === 'string' && /^rec[0-9A-Za-z]{7,}$/.test(x))) {
      return `[关联记录×${v.length}]`;
    }
    return v.map((x) => baseCellToText(x)).filter(Boolean).join('、');
  }
  const o = v as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (name) return name;
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  const link = typeof o.link === 'string' ? o.link.trim() : '';
  if (text || link) return text && link ? `${text} (${link})` : text || link;
  const s = JSON.stringify(o);
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}

/** 列出 base 内全部数据表（+table-list 分页 limit≤100，按 total 取尽）。 */
async function fetchBaseTables(baseToken: string): Promise<{ id: string; name: string }[]> {
  const tables: { id: string; name: string }[] = [];
  for (let offset = 0; ; ) {
    const r = await runLarkJson(
      ['base', '+table-list', '--base-token', baseToken, '--limit', '100', '--offset', String(offset), '--format', 'json'],
      { maxBuffer: 4 * 1024 * 1024, timeout: 60000, env: LARK_ENV }
    );
    if (!r.ok || !r.data) throw new Error(friendlyLarkError(r));
    const batch = Array.isArray(r.data.tables) ? r.data.tables : [];
    for (const t of batch) tables.push({ id: String(t?.id || ''), name: String(t?.name || '').trim() });
    offset += batch.length;
    const total = Number(r.data.total || 0);
    if (!batch.length || offset >= total) break;
  }
  return tables.filter((t) => t.id);
}

/** 逐页拉取单个数据表的记录（+record-list 行式返回：fields=字段名表头、data=行数组），
 *  至多 SHEET_MAX_ROWS 行，超限置 truncated。 */
async function fetchBaseTableRows(
  baseToken: string, tableId: string
): Promise<{ fields: string[]; rows: unknown[][]; truncated: boolean }> {
  const rows: unknown[][] = [];
  let fields: string[] = [];
  let truncated = false;
  for (let offset = 0; ; ) {
    const r = await runLarkJson(
      ['base', '+record-list', '--base-token', baseToken, '--table-id', tableId,
        '--limit', '200', '--offset', String(offset), '--format', 'json'],
      { maxBuffer: 32 * 1024 * 1024, timeout: 120000, env: LARK_ENV }
    );
    if (!r.ok || !r.data) throw new Error(friendlyLarkError(r));
    if (!fields.length && Array.isArray(r.data.fields)) {
      fields = r.data.fields.map((f: any) => String(f ?? ''));
    }
    const batch: unknown[][] = Array.isArray(r.data.data) ? r.data.data : [];
    rows.push(...batch);
    offset += batch.length;
    if (rows.length >= SHEET_MAX_ROWS) {
      truncated = rows.length > SHEET_MAX_ROWS || !!r.data.has_more;
      rows.length = SHEET_MAX_ROWS;
      break;
    }
    if (!r.data.has_more || !batch.length) break;
  }
  return { fields, rows, truncated };
}

/** 多维表格整本入库：+table-list 列数据表 → 逐表 +record-list 分页取记录 → 字段值规整
 *  → 每表一个 markdown section。checksum 去重与状态流转对齐 ingestFeishuSheet；
 *  asset sourceType 记 'feishu_base'、format 记 'base'。单表失败跳过续跑，全表失败才报错。 */
export async function ingestFeishuBase(url: string, opts: FeishuIngestOpts = {}) {
  const token = url.match(/\/base\/([^/?#]+)/)?.[1] || url;
  const tables = await fetchBaseTables(token);
  if (!tables.length) throw new Error('该多维表格没有可入库的数据表');

  const parts: string[] = [];
  for (const t of tables) {
    let got: { fields: string[]; rows: unknown[][]; truncated: boolean };
    try {
      got = await fetchBaseTableRows(token, t.id);
    } catch (e) { // 单表读取失败不致命（可能受高级权限保护），跳过继续
      console.error(`数据表「${t.name}」读取失败：${String(e instanceof Error ? e.message : e)}`);
      continue;
    }
    if (!got.fields.length || !got.rows.length) continue; // 空表
    const md = tableToMarkdown([
      got.fields,
      ...got.rows.map((r) => (Array.isArray(r) ? r : []).map(baseCellToText)),
    ]);
    if (!md.trim()) continue;
    const note = got.truncated ? `（仅收录前 ${SHEET_MAX_ROWS} 行，原表行数更多已截断）\n\n` : '';
    parts.push(`# ${t.name || `数据表${parts.length + 1}`}\n\n${note}${md}`);
  }
  if (!parts.length) throw new Error('未能读取到任何数据表内容（可能均为空表或无权限）');

  const md = parts.join('\n\n');
  const checksum = createHash('sha256').update(md).digest('hex');
  if (findVersionByChecksum(checksum)) return { skipped: true };

  mkdirSync(MATERIALS, { recursive: true });
  const rawPath = resolve(MATERIALS, `${checksum}.md`);
  writeFileSync(rawPath, md);

  // 标题优先级：调用方/wiki 节点名 > 云空间文件名 > 「飞书多维表格」+token 前缀兜底
  const title = opts.title || (await fetchDriveTitle(url)) || `飞书多维表格 ${token.slice(0, 6)}`;
  const assetId = createAsset({
    sourceType: 'feishu_base', title, assetType: 'doc', format: 'base',
    sourceUrl: url, group: opts.group, category: opts.category, industry: opts.industry,
  });
  const versionId = createVersion({ assetId, version: 'v1', checksum, rawPath });

  try {
    const secs = splitSections(md);
    storeSections(versionId, secs);
    setVersionStatus(versionId, 'done', secs.length);
    setAssetStatus(assetId, 'published');
    return { assetId, versionId, sections: secs.length };
  } catch (e) {
    setVersionStatus(versionId, 'failed', undefined, String(e));
    setAssetStatus(assetId, 'failed');
    throw e;
  }
}

// ───────────────────────── 飞书内嵌图理解（方式 B：下载图 + Claude 视觉） ─────────────────────────
// 见 docs/specs/2026-06-27-feishu-doc-image-understanding-spec.md

export type FeishuImg = { id: string; name: string; alt: string; src: string; mime: string };

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 纯函数：从飞书 XML 导出（--doc-format xml --detail with-ids）里解析每个 <img> 的属性。
 *  只返回带 src(file_token) 的图（media-download 需要它）。属性顺序无关，alt 做 XML 实体解码。 */
export function parseImgBlocks(xml: string): FeishuImg[] {
  if (!xml) return [];
  const out: FeishuImg[] = [];
  for (const tag of xml.match(/<img\b[^>]*\/?>/g) || []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) attrs[m[1]] = m[2];
    const src = (attrs.src || '').trim();
    if (!src) continue; // 无 token 无法下载，跳过
    out.push({
      id: attrs.id || '', name: attrs.name || '',
      alt: decodeXmlEntities(attrs.alt || '').trim(),
      src, mime: attrs.mime || '',
    });
  }
  return out;
}

async function fetchXml(url: string): Promise<string> {
  const r = await runLarkJson(
    ['docs', '+fetch', '--doc', url, '--doc-format', 'xml', '--detail', 'with-ids', '--format', 'json'],
    { maxBuffer: 32 * 1024 * 1024, timeout: 120000, env: LARK_ENV }
  );
  if (!r.ok && !r.data) throw new Error(friendlyLarkError(r));
  return r.data?.document?.content || '';
}

function extFromMime(mime: string): string {
  if (/jpe?g/i.test(mime)) return '.jpg';
  if (/gif/i.test(mime)) return '.gif';
  if (/webp/i.test(mime)) return '.webp';
  if (/svg/i.test(mime)) return '.svg';
  return '.png';
}

/** lark-cli docs +media-download 要求 --output 是 cwd 内相对路径 → cwd 设到目标目录、传裸文件名。 */
async function downloadMedia(token: string, destDir: string, fileName: string): Promise<string> {
  await pexec(
    'lark-cli',
    ['docs', '+media-download', '--token', token, '--type', 'media', '--output', `./${fileName}`, '--overwrite'],
    { cwd: destDir, maxBuffer: 8 * 1024 * 1024, timeout: 120000 }
  );
  return resolve(destDir, fileName);
}

async function imgPool<T>(items: T[], n: number, fn: (it: T, i: number) => Promise<void>): Promise<void> {
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) { const my = idx++; await fn(items[my], my); }
  }));
}

export type FeishuImagesResult = { assetId: string; versionId: string; images: number; chunks: number;
  failed: number; downloadFailed: number; vlmFailed: number; captionOnly: number };

/** 给已存在的 feishu_doc 资产/版本追加「内嵌图理解」单元与 chunk（不动其文本 chunk）。
 *  抓 XML → parseImgBlocks → 逐图 media-download → analyzeSlide → buildChunks + image_caption。 */
export async function ingestFeishuImages(
  url: string, assetId: string, versionId: string,
  opts: { model?: string; concurrency?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<FeishuImagesResult> {
  const model = opts.model || MODEL_PARSE;
  const concurrency = opts.concurrency || PARSE_CONCURRENCY;
  // VLM 后端：SP_VLM_BACKEND=codex 走 Codex/OpenAI 额度（避开 claude 限流）。
  const useCodex = (process.env.SP_VLM_BACKEND || '').toLowerCase() === 'codex';
  const analyzeVlm = (imgPath: string, alt: string, n: number) =>
    useCodex ? analyzeSlideCodex(imgPath, alt, n, process.env.SP_CODEX_MODEL) : analyzeSlide(imgPath, alt, n, model);
  const xml = await fetchXml(url);
  const imgs = parseImgBlocks(xml);
  const destDir = resolve(STORAGE_DERIVED, 'feishu', versionId);
  mkdirSync(destDir, { recursive: true });

  let done = 0, chunkCount = 0, vlmFailed = 0, downloadFailed = 0, captionOnly = 0;
  await imgPool(imgs, concurrency, async (img, i) => {
    const n = i + 1;
    // 跳过既无 alt 又无 token 的空图（无任何可入库信息）
    if (!img.alt.trim() && !img.src) { done++; opts.onProgress?.(done, imgs.length); return; }

    // 1) 下图（best-effort）：部分文档图受权限限制返回 403，下载失败不致命。
    let imgPath = '';
    try {
      imgPath = await downloadMedia(img.src, destDir, `img_${n}${extFromMime(img.mime)}`);
    } catch (e) {
      downloadFailed++;
      console.error(`\n  图 ${n} 下载失败(可能无权限/403)，仅以飞书 alt 入库：${String(e).slice(0, 100)}`);
    }

    // 2) 视觉理解（仅在下到图时）：VLM 偶发非法 JSON，重试至多 3 次，仍失败用 fallback vj。
    let vj: any = null;
    if (imgPath) {
      for (let attempt = 0; attempt < 3 && !vj; attempt++) {
        try { vj = await analyzeVlm(imgPath, img.alt, n); }
        catch { vj = null; }
      }
      if (!vj) { vlmFailed++; }
    }
    if (!vj) {
      // 无图或 VLM 失败：降级为 fallback vj，靠飞书 alt(image_caption/raw) 兜底，保证该图仍可检索。
      vj = { title: '', slide_type: 'image', needs_review: true, confidence: 0,
        _fallback: imgPath ? 'vlm_json_failed' : 'download_failed' };
      if (img.alt.trim()) captionOnly++;
    }

    // 3) 落库：每张图一个 unit + 多类型 chunk + 飞书 alt 的 image_caption。
    const conf = typeof vj.confidence === 'number' ? vj.confidence : undefined;
    const needs = !!vj.needs_review;
    const unitId = createUnit({
      versionId, slideNo: 1000 + n, imagePath: imgPath, rawText: img.alt,
      visualJson: JSON.stringify(vj), title: vj.title, slideType: 'image',
      conclusion: vj.one_sentence_conclusion, visualSummary: vj.visual_summary,
      confidence: conf, needsReview: needs,
    });
    for (const ch of buildChunks(vj, { text: img.alt, tables: [], notes: '' })) {
      createChunk({ unitId, text: ch.text, chunkType: ch.chunkType, sourceMethod: ch.sourceMethod,
        confidence: conf, needsReview: needs, parentUnitId: unitId });
      chunkCount++;
    }
    if (img.alt.trim()) {
      createChunk({ unitId, text: img.alt.trim(), chunkType: 'image_caption', sourceMethod: 'vlm',
        confidence: conf, needsReview: needs, parentUnitId: unitId });
      chunkCount++;
    }
    done++;
    opts.onProgress?.(done, imgs.length);
  });
  return { assetId, versionId, images: imgs.length, chunks: chunkCount,
    failed: vlmFailed + downloadFailed, downloadFailed, vlmFailed, captionOnly };
}
