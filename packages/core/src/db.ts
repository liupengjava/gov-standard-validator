import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DB_PATH } from './config.ts';
import { autoClassifyAsset } from './industry-classify.ts';
import { classifyBusinessTypeFromGroupName } from './business-types.ts';

// 连接与 vec 状态挂在 globalThis 上，避免 Next/turbopack dev HMR 热重载本模块时
// 重置模块级单例、重开连接并重跑迁移，导致新旧连接抢 WAL 写锁把进程带进 500 坏态。
// HMR 复用同一连接、迁移只在进程首次启动跑一次；要应用新迁移干净重启 dev 即可。
type SpDbState = { db: DatabaseSync | null; vecEnabled: boolean };
const _state: SpDbState = ((globalThis as unknown as { __salespilotDb?: SpDbState }).__salespilotDb ??= { db: null, vecEnabled: false });
// 向量维度（bge-m3=1024）；vec0 表维度建表时固定，可经 SP_EMBED_DIM 覆盖
const VEC_DIM = Number(process.env.SP_EMBED_DIM || 1024);

/** 解析 sqlite-vec(vec0) 可加载扩展路径：SP_SQLITE_VEC > python sqlite_vec.loadable_path()。 */
function resolveVecPath(): string | null {
  if (process.env.SP_SQLITE_VEC) return process.env.SP_SQLITE_VEC;
  try {
    return execFileSync('python3', ['-c', 'import sqlite_vec;print(sqlite_vec.loadable_path())'], { encoding: 'utf-8' }).trim() || null;
  } catch { return null; }
}

/** 尝试加载 vec0 并建 vec_chunks 虚拟表；失败则保持 _vecEnabled=false（降级 JSON 余弦）。 */
function tryEnableVec(d: DatabaseSync) {
  const stem = resolveVecPath();
  if (!stem) return;
  try { d.enableLoadExtension(true); } catch { return; }
  let loaded = false;
  for (const p of [stem, `${stem}.dylib`, `${stem}.so`]) {
    try { d.loadExtension(p); loaded = true; break; } catch { /* 下一个 */ }
  }
  if (!loaded) return;
  try {
    d.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[${VEC_DIM}])`);
    _state.vecEnabled = true;
  } catch { /* vec0 不可用 */ }
}

/** 防御：把任意值规整为可绑定 SQLite 的文本（对象→JSON，空→null）。 */
function txt(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') { const t = (v as any).text; return t != null ? String(t) : JSON.stringify(v); }
  return String(v);
}

export function db(): DatabaseSync {
  if (_state.db) return _state.db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const d = new DatabaseSync(DB_PATH, { allowExtension: true });
  try {
    d.exec('PRAGMA journal_mode = WAL;');
    d.exec('PRAGMA foreign_keys = ON;');
    initSchema(d);
  } catch (e) {
    // 初始化/迁移失败：关掉这条连接、不缓存，让下次调用干净重试，避免缓存半初始化连接。
    try { d.close(); } catch { /* ignore */ }
    throw e;
  }
  _state.db = d; // 迁移成功后再挂上
  tryEnableVec(d);
  return d;
}

/** sqlite-vec 是否就绪（vec0 已加载 + vec_chunks 已建）。 */
export function vecAvailable(): boolean { db(); return _state.vecEnabled; }

/** 写入/覆盖某 chunk 的向量到 vec_chunks（vec0 不支持 upsert，先删后插）。 */
export function upsertVec(chunkId: string, embedding: number[]) {
  if (!vecAvailable()) return;
  const buf = new Uint8Array(new Float32Array(embedding).buffer);
  const d = db();
  try { d.prepare(`DELETE FROM vec_chunks WHERE chunk_id=?`).run(chunkId); } catch { /* 首次无行 */ }
  d.prepare(`INSERT INTO vec_chunks(chunk_id, embedding) VALUES (?,?)`).run(chunkId, buf);
}

/** KNN：返回最近的 k 个 chunk_id 及距离（距离越小越相似）。vec 不可用返回空。 */
export function vecSearch(queryVec: number[], k: number): { chunk_id: string; distance: number }[] {
  if (!vecAvailable()) return [];
  const buf = new Uint8Array(new Float32Array(queryVec).buffer);
  return db().prepare(
    `SELECT chunk_id, distance FROM vec_chunks WHERE embedding MATCH ? ORDER BY distance LIMIT ?`
  ).all(buf, k) as { chunk_id: string; distance: number }[];
}

/** vec_chunks 当前行数（迁移进度/是否已填充）。 */
export function vecCount(): number {
  if (!vecAvailable()) return 0;
  try { return (db().prepare(`SELECT COUNT(*) n FROM vec_chunks`).get() as any).n as number; }
  catch { return 0; }
}

function initSchema(d: DatabaseSync) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY, source_type TEXT, title TEXT, asset_type TEXT,
      industry TEXT, scenario TEXT, status TEXT DEFAULT 'draft',
      owner TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY, asset_id TEXT, version TEXT, checksum TEXT,
      raw_path TEXT, pages INTEGER, parse_status TEXT DEFAULT 'pending',
      error TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS units (
      id TEXT PRIMARY KEY, version_id TEXT, slide_no INTEGER,
      image_path TEXT, raw_text TEXT, visual_json TEXT,
      title TEXT, slide_type TEXT, conclusion TEXT, visual_summary TEXT,
      confidence REAL, needs_review INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY, unit_id TEXT, text TEXT, chunk_type TEXT,
      embedding TEXT, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      chunk_id UNINDEXED, text, tokenize='trigram'
    );
    CREATE INDEX IF NOT EXISTS idx_versions_asset ON versions(asset_id);
    CREATE INDEX IF NOT EXISTS idx_units_version ON units(version_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_unit ON chunks(unit_id);
    CREATE TABLE IF NOT EXISTS ingest_jobs (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      file_name TEXT,
      file_size INTEGER,
      mime_type TEXT,
      source_url TEXT,
      group_name TEXT,
      category TEXT,
      uploaded_by_open_id TEXT,
      uploaded_by_name TEXT,
      asset_id TEXT,
      version_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      stage TEXT NOT NULL DEFAULT 'queued',
      stage_label TEXT,
      progress INTEGER NOT NULL DEFAULT 0,
      current_page INTEGER,
      total_pages INTEGER,
      warnings INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ingest_job_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      stage TEXT,
      label TEXT,
      progress INTEGER,
      page_no INTEGER,
      total_pages INTEGER,
      message TEXT,
      payload TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ingest_jobs_status ON ingest_jobs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_ingest_jobs_asset ON ingest_jobs(asset_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ingest_job_events_job ON ingest_job_events(job_id, created_at);
    CREATE TABLE IF NOT EXISTS solution_owners (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS industries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      owner_id TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS industry_scenarios (
      id TEXT PRIMARY KEY,
      industry_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(industry_id, name)
    );
    CREATE TABLE IF NOT EXISTS business_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      submitter_name TEXT NOT NULL,
      submitter_open_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      images TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      admin_note TEXT,
      notified_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_submitter ON feedback(submitter_name, created_at);
    CREATE TABLE IF NOT EXISTS lark_user_cache (
      name TEXT PRIMARY KEY,
      open_id TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);
  // 增量列（多格式素材）：format / source_url / group_name / category。已存在则忽略。
  // chunk 溯源与质量列（PRD-0004）：source_method / confidence / needs_review / parent_unit_id。
  for (const stmt of [
    `ALTER TABLE assets ADD COLUMN format TEXT DEFAULT 'ppt'`,
    `ALTER TABLE assets ADD COLUMN source_url TEXT`,
    `ALTER TABLE assets ADD COLUMN group_name TEXT`,
    `ALTER TABLE assets ADD COLUMN category TEXT`,
    `ALTER TABLE assets ADD COLUMN industry_id TEXT`,
    `ALTER TABLE assets ADD COLUMN scenario_id TEXT`,
    `ALTER TABLE assets ADD COLUMN industry_confirmed INTEGER DEFAULT 0`,
    `ALTER TABLE assets ADD COLUMN business_type_id TEXT`,
    `ALTER TABLE assets ADD COLUMN sort_order INTEGER DEFAULT 0`,
    `ALTER TABLE assets ADD COLUMN note TEXT`,
    `ALTER TABLE chunks ADD COLUMN source_method TEXT`,
    `ALTER TABLE chunks ADD COLUMN confidence REAL`,
    `ALTER TABLE chunks ADD COLUMN needs_review INTEGER DEFAULT 0`,
    `ALTER TABLE chunks ADD COLUMN parent_unit_id TEXT`,
  ]) { try { d.exec(stmt); } catch { /* 列已存在 */ } }
  migrateScenariosToIndustryLevel(d);
  seedIndustriesIfEmpty(d);
  mergeLegacyIndustries(d);
  seedBusinessTypesIfEmpty(d);
  renameLegacyBusinessType(d);
  backfillMissingBusinessTypes(d);
  resetIndustriesSortOrderOnce(d);
}

/** 一次性迁移：取消「细分方向」层级，场景改成直接挂在行业下。
 *  只在还存在 industry_directions 表（旧库）时跑一次；同名场景在同一行业下去重，
 *  被去重掉的场景 id 迁移前先把引用它的素材 scenario_id 改指向保留的那条，避免产生悬空引用。 */
function migrateScenariosToIndustryLevel(d: DatabaseSync) {
  const hasDirections = d.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='industry_directions'`
  ).get();
  if (!hasDirections) return;

  const rows = d.prepare(
    `SELECT s.id AS scenario_id, s.name, s.sort_order, s.created_at, dir.industry_id AS industry_id
     FROM industry_scenarios s JOIN industry_directions dir ON dir.id = s.direction_id`
  ).all() as { scenario_id: string; name: string; sort_order: number; created_at: string; industry_id: string }[];

  d.exec(`
    CREATE TABLE industry_scenarios_new (
      id TEXT PRIMARY KEY,
      industry_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(industry_id, name)
    );
  `);

  const insertScenario = d.prepare(
    `INSERT INTO industry_scenarios_new (id, industry_id, name, sort_order, created_at) VALUES (?,?,?,?,?)`
  );
  const remapAssetScenario = d.prepare(`UPDATE assets SET scenario_id=? WHERE scenario_id=?`);

  const keptIdByKey = new Map<string, string>();
  for (const r of rows) {
    const key = `${r.industry_id}::${r.name}`;
    const keptId = keptIdByKey.get(key);
    if (keptId) {
      remapAssetScenario.run(keptId, r.scenario_id);
    } else {
      keptIdByKey.set(key, r.scenario_id);
      insertScenario.run(r.scenario_id, r.industry_id, r.name, r.sort_order, r.created_at);
    }
  }

  d.exec(`DROP TABLE industry_scenarios;`);
  d.exec(`ALTER TABLE industry_scenarios_new RENAME TO industry_scenarios;`);
  d.exec(`DROP TABLE industry_directions;`);
}

/** 首次启动时种入 18 个行业 + 「人力」示例场景；已有数据则跳过。 */
function seedIndustriesIfEmpty(d: DatabaseSync) {
  const row = d.prepare(`SELECT COUNT(*) n FROM industries`).get() as any;
  if (row.n > 0) return;

  const NAMES = ['人力', '企服', '会展', '供应链', '健康', '制造', '医疗', '家装', '房产', '教育', '文旅', '汽车', '法律', '生活', '营销', '金融', '零售', '餐饮'];
  const insertIndustry = d.prepare(`INSERT INTO industries (id, name, sort_order) VALUES (?,?,?)`);
  let hrId = '';
  NAMES.forEach((name, i) => {
    const id = randomUUID();
    insertIndustry.run(id, name, i);
    if (name === '人力') hrId = id;
  });

  const SCENARIOS = ['需求初筛', '候选人电话初面', '电话调研'];
  const insertScenario = d.prepare(`INSERT INTO industry_scenarios (id, industry_id, name, sort_order) VALUES (?,?,?,?)`);
  SCENARIOS.forEach((name, i) => insertScenario.run(randomUUID(), hrId, name, i));
}

/** 把现有素材实际在用、且不在 18 行业种子里的行业合并进 industries 表；按 name 唯一约束幂等，可重复调用。 */
function mergeLegacyIndustries(d: DatabaseSync) {
  const NAMES = ['运营商', '政企', '政务', '公安', '燃气', '海外', '通用行业'];
  const maxOrder = (d.prepare(`SELECT COALESCE(MAX(sort_order), -1) m FROM industries`).get() as any).m;
  const insertIndustry = d.prepare(`INSERT OR IGNORE INTO industries (id, name, sort_order) VALUES (?,?,?)`);
  NAMES.forEach((name, i) => insertIndustry.run(randomUUID(), name, maxOrder + 1 + i));

  const gongan = d.prepare(`SELECT id FROM industries WHERE name='公安'`).get() as any;
  if (gongan) {
    d.prepare(
      `INSERT OR IGNORE INTO industry_scenarios (id, industry_id, name, sort_order) VALUES (?,?,?,0)`
    ).run(randomUUID(), gongan.id, '公安反诈');
  }
}

/** 首次启动、且表为空时种入知识类型；已有任意数据则跳过。
 *  必须判空：否则每次重启都会把用户删掉的种子类型（如「产品方案」）重新塞回来。 */
function seedBusinessTypesIfEmpty(d: DatabaseSync) {
  const row = d.prepare(`SELECT COUNT(*) n FROM business_types`).get() as any;
  if (row.n > 0) return;
  const NAMES = ['公司介绍', '产品方案', '行业方案', '客户案例', '销售支持'];
  const insert = d.prepare(`INSERT OR IGNORE INTO business_types (id, name, sort_order) VALUES (?,?,?)`);
  NAMES.forEach((name, i) => insert.run(randomUUID(), name, i));
}

/** 一次性迁移：把旧种子名「业务方案」统一为「行业方案」，使知识类型与知识运营菜单口径一致。
 *  若两者并存（历史脏数据），把引用旧「业务方案」的素材改指「行业方案」后删掉旧记录。幂等。 */
function renameLegacyBusinessType(d: DatabaseSync) {
  const legacy = d.prepare(`SELECT id FROM business_types WHERE name='业务方案'`).get() as any;
  if (!legacy) return;
  const kept = d.prepare(`SELECT id FROM business_types WHERE name='行业方案'`).get() as any;
  if (!kept) {
    d.prepare(`UPDATE business_types SET name='行业方案' WHERE id=?`).run(legacy.id);
    return;
  }
  d.prepare(`UPDATE assets SET business_type_id=? WHERE business_type_id=?`).run(kept.id, legacy.id);
  d.prepare(`DELETE FROM business_types WHERE id=?`).run(legacy.id);
}

/** 存量素材回填 business_type_id：仅补 NULL（不覆盖人工分类），按 group_name→知识类型名映射/直配。 */
function backfillMissingBusinessTypes(d: DatabaseSync) {
  const rows = d.prepare(
    `SELECT id, group_name FROM assets WHERE business_type_id IS NULL AND group_name IS NOT NULL AND group_name<>''`
  ).all() as { id: string; group_name: string }[];
  if (rows.length === 0) return;
  const GROUP_TO_BT: Record<string, string> = {
    '公司': '公司介绍', '产品': '产品方案', '行业方案': '行业方案', '客户案例': '客户案例', '销售支持': '销售支持',
  };
  const findByName = d.prepare(`SELECT id FROM business_types WHERE name=?`);
  const setBt = d.prepare(`UPDATE assets SET business_type_id=? WHERE id=?`);
  for (const r of rows) {
    // 先按名字直配（新模型 group_name 即知识类型名），再回退旧分组代号映射。
    let bt = findByName.get(r.group_name) as any;
    if (!bt?.id) {
      const mapped = GROUP_TO_BT[r.group_name];
      if (mapped) bt = findByName.get(mapped) as any;
    }
    if (bt?.id) setBt.run(bt.id, r.id);
  }
}

/** 一次性重置（PRD-0029）：历史上 createIndustry 按创建序自增写 sort_order（max+1），并非人工排序；
 *  拖拽排序上线前统一归零，让「未手工排过」的行业在 listIndustries 里退化为知识量降序（与旧版前端排序一致），
 *  首次拖动才写入整组下标固化顺序。用 PRAGMA user_version 做标记，跑过即置 1，避免重启后覆盖人工顺序。 */
function resetIndustriesSortOrderOnce(d: DatabaseSync) {
  const v = Number((d.prepare(`PRAGMA user_version`).get() as any)?.user_version ?? 0);
  if (v >= 1) return;
  d.exec(`UPDATE industries SET sort_order=0`);
  d.exec(`PRAGMA user_version = 1`);
}

export type IngestJobStatus = 'queued' | 'uploading' | 'parsing' | 'vlm_running' | 'indexing' | 'done' | 'partial' | 'failed';

export type IngestJob = {
  id: string;
  source_type: string;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  source_url: string | null;
  group_name: string | null;
  category: string | null;
  uploaded_by_open_id: string | null;
  uploaded_by_name: string | null;
  asset_id: string | null;
  version_id: string | null;
  status: IngestJobStatus;
  stage: string;
  stage_label: string | null;
  progress: number;
  current_page: number | null;
  total_pages: number | null;
  warnings: number;
  error: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
};

export type IngestJobEvent = {
  id: string;
  job_id: string;
  event_type: string;
  stage: string | null;
  label: string | null;
  progress: number | null;
  page_no: number | null;
  total_pages: number | null;
  message: string | null;
  payload: string | null;
  created_at: string;
};

export function createIngestJob(input: {
  sourceType: string; fileName?: string; fileSize?: number; mimeType?: string; sourceUrl?: string;
  group?: string; category?: string; uploadedByOpenId?: string; uploadedByName?: string;
  status?: IngestJobStatus; stage?: string; stageLabel?: string; progress?: number; metadata?: unknown;
}): string {
  const id = randomUUID();
  db().prepare(
    `INSERT INTO ingest_jobs (
      id, source_type, file_name, file_size, mime_type, source_url, group_name, category,
      uploaded_by_open_id, uploaded_by_name, status, stage, stage_label, progress, metadata
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, input.sourceType, txt(input.fileName), input.fileSize ?? null, txt(input.mimeType), txt(input.sourceUrl),
    txt(input.group), txt(input.category), txt(input.uploadedByOpenId), txt(input.uploadedByName),
    input.status ?? 'queued', input.stage ?? 'queued', txt(input.stageLabel), input.progress ?? 0,
    input.metadata == null ? null : JSON.stringify(input.metadata),
  );
  return id;
}

export function updateIngestJob(id: string, patch: Partial<{
  assetId: string | null; versionId: string | null; status: IngestJobStatus; stage: string; stageLabel: string;
  progress: number; currentPage: number | null; totalPages: number | null; warnings: number; error: string | null;
  metadata: unknown; finished: boolean;
}>) {
  const fields: string[] = [];
  const values: any[] = [];
  const add = (col: string, value: any) => { fields.push(`${col}=?`); values.push(value); };
  if ('assetId' in patch) add('asset_id', patch.assetId ?? null);
  if ('versionId' in patch) add('version_id', patch.versionId ?? null);
  if (patch.status) add('status', patch.status);
  if (patch.stage) add('stage', patch.stage);
  if ('stageLabel' in patch) add('stage_label', txt(patch.stageLabel));
  if (typeof patch.progress === 'number') add('progress', Math.max(0, Math.min(100, Math.round(patch.progress))));
  if ('currentPage' in patch) add('current_page', patch.currentPage ?? null);
  if ('totalPages' in patch) add('total_pages', patch.totalPages ?? null);
  if (typeof patch.warnings === 'number') add('warnings', patch.warnings);
  if ('error' in patch) add('error', txt(patch.error));
  if ('metadata' in patch) add('metadata', patch.metadata == null ? null : JSON.stringify(patch.metadata));
  if (patch.finished) add('finished_at', new Date().toISOString());
  fields.push(`updated_at=datetime('now')`);
  values.push(id);
  db().prepare(`UPDATE ingest_jobs SET ${fields.join(', ')} WHERE id=?`).run(...values);
}

export function addIngestJobEvent(jobId: string, event: {
  eventType: string; stage?: string; label?: string; progress?: number; pageNo?: number; totalPages?: number;
  message?: string; payload?: unknown;
}) {
  db().prepare(
    `INSERT INTO ingest_job_events (
      id, job_id, event_type, stage, label, progress, page_no, total_pages, message, payload
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    randomUUID(), jobId, event.eventType, txt(event.stage), txt(event.label),
    typeof event.progress === 'number' ? Math.round(event.progress) : null,
    event.pageNo ?? null, event.totalPages ?? null, txt(event.message),
    event.payload == null ? null : JSON.stringify(event.payload),
  );
}

export function listIngestJobs(opts: { statuses?: string[]; assetId?: string; limit?: number } = {}): IngestJob[] {
  const where: string[] = [];
  const params: any[] = [];
  if (opts.assetId) { where.push('asset_id=?'); params.push(opts.assetId); }
  if (opts.statuses?.length) {
    where.push(`status IN (${opts.statuses.map(() => '?').join(',')})`);
    params.push(...opts.statuses);
  }
  params.push(Math.max(1, Math.min(opts.limit ?? 50, 200)));
  return db().prepare(
    `SELECT * FROM ingest_jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC, updated_at DESC LIMIT ?`
  ).all(...params) as IngestJob[];
}

export function getIngestJob(id: string): IngestJob | undefined {
  return db().prepare(`SELECT * FROM ingest_jobs WHERE id=?`).get(id) as IngestJob | undefined;
}

export function getIngestJobEvents(jobId: string, limit = 200): IngestJobEvent[] {
  return db().prepare(
    `SELECT * FROM ingest_job_events WHERE job_id=? ORDER BY created_at ASC LIMIT ?`
  ).all(jobId, Math.max(1, Math.min(limit, 500))) as IngestJobEvent[];
}

export function createAsset(a: {
  sourceType: string; title: string; assetType: string;
  industry?: string; scenario?: string; owner?: string;
  format?: string; sourceUrl?: string; group?: string; category?: string;
}): string {
  const id = randomUUID();
  db().prepare(
    `INSERT INTO assets (id, source_type, title, asset_type, industry, scenario, status, owner, format, source_url, group_name, category)
     VALUES (?,?,?,?,?,?, 'parsing', ?,?,?,?,?)`
  ).run(id, a.sourceType, txt(a.title), a.assetType, txt(a.industry), txt(a.scenario), txt(a.owner),
    a.format ?? 'ppt', txt(a.sourceUrl), txt(a.group), txt(a.category));
  autoClassifyAsset(id, a.title);
  const businessTypeId = classifyBusinessTypeFromGroupName(a.group);
  if (businessTypeId) {
    db().prepare(`UPDATE assets SET business_type_id=? WHERE id=?`).run(businessTypeId, id);
  }
  return id;
}

/** 人工在素材详情面板改行业/场景/业务类型时调用；不写 industry_confirmed（确认环节已取消）。 */
export function updateAssetTagging(assetId: string, patch: {
  industryId?: string | null; scenarioId?: string | null;
  businessTypeId?: string | null;
}): void {
  const fields: string[] = [];
  const values: any[] = [];
  if ('industryId' in patch) { fields.push('industry_id=?'); values.push(patch.industryId ?? null); }
  if ('scenarioId' in patch) { fields.push('scenario_id=?'); values.push(patch.scenarioId ?? null); }
  if ('businessTypeId' in patch) { fields.push('business_type_id=?'); values.push(patch.businessTypeId ?? null); }
  if (!fields.length) return;
  values.push(assetId);
  db().prepare(`UPDATE assets SET ${fields.join(', ')} WHERE id=?`).run(...values);
}

/** 人工重命名素材标题；title 由调用方 trim，空校验在 API 层。 */
export function renameAsset(assetId: string, title: string): void {
  db().prepare(`UPDATE assets SET title=? WHERE id=?`).run(txt(title), assetId);
}

/** 人工备注说明；note 由调用方 trim + 长度校验，空串存 NULL。 */
export function updateAssetNote(assetId: string, note: string | null | undefined): void {
  const v = note && note.trim() ? note.trim() : null;
  db().prepare(`UPDATE assets SET note=? WHERE id=?`).run(v, assetId);
}

/** 组内排序落库：按传入 id 顺序写 sort_order=下标（单事务）。
 * 调用方（前端）负责给出同一知识类型组按期望顺序排列的全部 id。返回实际更新条数。 */
export function setAssetsOrder(ids: string[]): { updated: number } {
  const d = db();
  d.exec('BEGIN');
  try {
    const upd = d.prepare(`UPDATE assets SET sort_order=? WHERE id=?`);
    let updated = 0;
    ids.forEach((id, i) => { updated += Number(upd.run(i, id).changes); });
    d.exec('COMMIT');
    return { updated };
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export function createVersion(v: {
  assetId: string; version: string; checksum: string; rawPath: string;
}): string {
  const id = randomUUID();
  db().prepare(
    `INSERT INTO versions (id, asset_id, version, checksum, raw_path, parse_status)
     VALUES (?,?,?,?,?, 'running')`
  ).run(id, v.assetId, v.version, v.checksum, v.rawPath);
  return id;
}

export function findVersionByChecksum(checksum: string): { id: string } | undefined {
  return db().prepare(`SELECT id FROM versions WHERE checksum = ? AND parse_status='done'`).get(checksum) as { id: string } | undefined;
}

export function setVersionStatus(versionId: string, status: string, pages?: number, error?: string) {
  db().prepare(`UPDATE versions SET parse_status=?, pages=COALESCE(?, pages), error=? WHERE id=?`)
    .run(status, pages ?? null, error ?? null, versionId);
}

export function setAssetStatus(assetId: string, status: string) {
  db().prepare(`UPDATE assets SET status=? WHERE id=?`).run(status, assetId);
}

export function createUnit(u: {
  versionId: string; slideNo: number; imagePath: string; rawText: string;
  visualJson: string; title?: string; slideType?: string; conclusion?: string;
  visualSummary?: string; confidence?: number; needsReview?: boolean;
}): string {
  const id = randomUUID();
  db().prepare(
    `INSERT INTO units (id, version_id, slide_no, image_path, raw_text, visual_json,
       title, slide_type, conclusion, visual_summary, confidence, needs_review)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, u.versionId, u.slideNo, txt(u.imagePath), txt(u.rawText), txt(u.visualJson),
    txt(u.title), txt(u.slideType), txt(u.conclusion), txt(u.visualSummary),
    typeof u.confidence === 'number' ? u.confidence : null, u.needsReview ? 1 : 0);
  return id;
}

export function createChunk(c: {
  unitId: string; text: string; chunkType: string; embedding?: number[];
  sourceMethod?: string; confidence?: number; needsReview?: boolean; parentUnitId?: string;
}): string {
  const id = randomUUID();
  db().prepare(
    `INSERT INTO chunks (id, unit_id, text, chunk_type, embedding, source_method, confidence, needs_review, parent_unit_id)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    id, c.unitId, c.text, c.chunkType, c.embedding ? JSON.stringify(c.embedding) : null,
    c.sourceMethod ?? null, typeof c.confidence === 'number' ? c.confidence : null,
    c.needsReview ? 1 : 0, c.parentUnitId ?? c.unitId,
  );
  db().prepare(`INSERT INTO chunks_fts (chunk_id, text) VALUES (?,?)`).run(id, c.text);
  return id;
}

export function setChunkEmbedding(chunkId: string, embedding: number[]) {
  db().prepare(`UPDATE chunks SET embedding=? WHERE id=?`).run(JSON.stringify(embedding), chunkId);
}

export type ChunkHit = {
  chunk_id: string; text: string; chunk_type: string;
  unit_id: string; slide_no: number; title: string | null; image_path: string;
  asset_id: string; asset_title: string; version: string; industry: string | null;
  source_method: string | null; confidence: number | null; needs_review: number | null;
  parent_unit_id: string | null;
  scenario: string | null; group_name: string | null; category: string | null; format: string | null; status: string | null;
  score?: number;
};

// chunk 溯源/质量字段 + 资产元数据（低置信标记 / small-to-big 聚合 / 元数据过滤）
const HIT_COLS = `c.source_method AS source_method, c.confidence AS confidence,
         c.needs_review AS needs_review, c.parent_unit_id AS parent_unit_id,
         a.scenario AS scenario, a.group_name AS group_name, a.category AS category,
         COALESCE(a.format,'ppt') AS format, a.status AS status`;

const HIT_SELECT = `
  SELECT c.id AS chunk_id, c.text AS text, c.chunk_type AS chunk_type,
         u.id AS unit_id, u.slide_no AS slide_no, u.title AS title, u.image_path AS image_path,
         a.id AS asset_id, a.title AS asset_title, v.version AS version, a.industry AS industry,
         ${HIT_COLS}
  FROM chunks c
  JOIN units u ON u.id = c.unit_id
  JOIN versions v ON v.id = u.version_id
  JOIN assets a ON a.id = v.asset_id`;

export function ftsSearch(matchQuery: string, k: number): ChunkHit[] {
  try {
    return db().prepare(
      `SELECT c.id AS chunk_id, c.text AS text, c.chunk_type AS chunk_type,
              u.id AS unit_id, u.slide_no AS slide_no, u.title AS title, u.image_path AS image_path,
              a.id AS asset_id, a.title AS asset_title, v.version AS version, a.industry AS industry,
              ${HIT_COLS},
              bm25(chunks_fts) AS score
       FROM chunks_fts
       JOIN chunks c ON c.id = chunks_fts.chunk_id
       JOIN units u ON u.id = c.unit_id
       JOIN versions v ON v.id = u.version_id
       JOIN assets a ON a.id = v.asset_id
       WHERE chunks_fts MATCH ?
       ORDER BY bm25(chunks_fts) LIMIT ?`
    ).all(matchQuery, k) as ChunkHit[];
  } catch {
    return [];
  }
}

export function allEmbeddedChunks(): { chunk_id: string; embedding: string }[] {
  return db().prepare(`SELECT id AS chunk_id, embedding FROM chunks WHERE embedding IS NOT NULL`).all() as any;
}

export function hydrateChunks(ids: string[]): ChunkHit[] {
  if (ids.length === 0) return [];
  const ph = ids.map(() => '?').join(',');
  return db().prepare(`${HIT_SELECT} WHERE c.id IN (${ph})`).all(...ids) as ChunkHit[];
}

export function chunksWithoutEmbedding(limit: number): { id: string; text: string }[] {
  return db().prepare(`SELECT id, text FROM chunks WHERE embedding IS NULL LIMIT ?`).all(limit) as any;
}

/** 由 version_id 反查所属 asset_id。 */
export function assetIdByVersion(versionId: string): string | undefined {
  const r = db().prepare(`SELECT asset_id FROM versions WHERE id=?`).get(versionId) as { asset_id?: string } | undefined;
  return r?.asset_id;
}

/** 取资产的分类元数据 + 最新版本原文件路径（reingest 重灌时保留分类用）。 */
export function getAssetMeta(assetId: string): {
  title: string; industry: string | null; scenario: string | null;
  group: string | null; category: string | null; sourceUrl: string | null;
  format: string; rawPath: string | null;
} | undefined {
  return db().prepare(
    `SELECT a.title AS title, a.industry AS industry, a.scenario AS scenario,
            a.group_name AS "group", a.category AS category, a.source_url AS sourceUrl,
            COALESCE(a.format,'ppt') AS format,
            (SELECT raw_path FROM versions WHERE asset_id=a.id ORDER BY created_at DESC LIMIT 1) AS rawPath
     FROM assets a WHERE a.id=?`
  ).get(assetId) as any;
}

/** 取某 version 的原文件绝对路径 + 资产标题 + 格式（下载用）。 */
export function versionFileInfo(versionId: string):
  { raw_path: string; title: string; format: string } | undefined {
  return db().prepare(
    `SELECT v.raw_path AS raw_path, a.title AS title, COALESCE(a.format,'ppt') AS format
     FROM versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=?`
  ).get(versionId) as any;
}

/**
 * 彻底删除一个资产：事务内删 chunks_fts → chunks → units → versions → assets。
 * FTS5 无触发器，需手动删。返回需删盘的原文件路径与渲染图目录（versionId），由调用方删盘。
 */
export function deleteAsset(assetId: string): { rawPaths: string[]; versionIds: string[] } {
  const d = db();
  const versions = d.prepare(`SELECT id, raw_path FROM versions WHERE asset_id=?`).all(assetId) as
    { id: string; raw_path: string }[];
  const versionIds = versions.map((v) => v.id);
  const rawPaths = versions.map((v) => v.raw_path).filter(Boolean);
  d.exec('BEGIN');
  try {
    for (const vid of versionIds) {
      // 该 version 下所有 chunk 的 id（用于删 FTS 与 sqlite-vec，二者无外键级联）
      const cids = (d.prepare(
        `SELECT c.id AS id FROM chunks c JOIN units u ON u.id=c.unit_id WHERE u.version_id=?`
      ).all(vid) as { id: string }[]).map((r) => r.id);
      if (_state.vecEnabled && cids.length) {
        const del = d.prepare(`DELETE FROM vec_chunks WHERE chunk_id=?`);
        for (const cid of cids) { try { del.run(cid); } catch { /* 该 chunk 无向量 */ } }
      }
      d.prepare(
        `DELETE FROM chunks_fts WHERE chunk_id IN (
           SELECT c.id FROM chunks c JOIN units u ON u.id=c.unit_id WHERE u.version_id=?)`
      ).run(vid);
      d.prepare(
        `DELETE FROM chunks WHERE unit_id IN (SELECT id FROM units WHERE version_id=?)`
      ).run(vid);
      d.prepare(`DELETE FROM units WHERE version_id=?`).run(vid);
    }
    d.prepare(`DELETE FROM versions WHERE asset_id=?`).run(assetId);
    d.prepare(`DELETE FROM assets WHERE id=?`).run(assetId);
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return { rawPaths, versionIds };
}

/** 取资产最新版本 id（按 created_at）。飞书图理解追加 unit 时用。 */
export function latestVersionId(assetId: string): string | undefined {
  const r = db().prepare(
    `SELECT id FROM versions WHERE asset_id=? ORDER BY created_at DESC LIMIT 1`
  ).get(assetId) as { id?: string } | undefined;
  return r?.id;
}

/** 幂等清理：删某 version 下指定 slide_type 的 units 及其 chunks（含 FTS / sqlite-vec）。
 *  返回删除的 unit 数。飞书图理解重跑前先清旧 image 单元，避免重复累积。 */
export function deleteUnitsByType(versionId: string, slideType: string): number {
  const d = db();
  const cids = (d.prepare(
    `SELECT c.id AS id FROM chunks c JOIN units u ON u.id=c.unit_id WHERE u.version_id=? AND u.slide_type=?`
  ).all(versionId, slideType) as { id: string }[]).map((r) => r.id);
  d.exec('BEGIN');
  try {
    if (_state.vecEnabled && cids.length) {
      const del = d.prepare(`DELETE FROM vec_chunks WHERE chunk_id=?`);
      for (const cid of cids) { try { del.run(cid); } catch { /* 无向量 */ } }
    }
    d.prepare(
      `DELETE FROM chunks_fts WHERE chunk_id IN (
         SELECT c.id FROM chunks c JOIN units u ON u.id=c.unit_id WHERE u.version_id=? AND u.slide_type=?)`
    ).run(versionId, slideType);
    d.prepare(
      `DELETE FROM chunks WHERE unit_id IN (SELECT id FROM units WHERE version_id=? AND slide_type=?)`
    ).run(versionId, slideType);
    const r = d.prepare(`DELETE FROM units WHERE version_id=? AND slide_type=?`).run(versionId, slideType);
    d.exec('COMMIT');
    return Number(r.changes || 0);
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export function stats() {
  const g = (q: string) => (db().prepare(q).get() as any).n as number;
  return {
    assets: g(`SELECT COUNT(*) n FROM assets`),
    versions: g(`SELECT COUNT(*) n FROM versions`),
    units: g(`SELECT COUNT(*) n FROM units`),
    chunks: g(`SELECT COUNT(*) n FROM chunks`),
    embedded: g(`SELECT COUNT(*) n FROM chunks WHERE embedding IS NOT NULL`),
    needsReview: g(`SELECT COUNT(*) n FROM units WHERE needs_review=1`),
  };
}

export interface LandingIndustry {
  id: string;
  name: string;
  count: number;
}

export interface LandingStats {
  assets: number;
  units: number;
  chunks: number;
  avgConfidence: number | null;
  industriesTotal: number;
  industriesWithAssets: number;
  catalog: LandingIndustry[];
}

// 免登录首页规模数字 + 行业目录（实时查库，一次成型）。
export function landingStats(): LandingStats {
  const g = (q: string) => (db().prepare(q).get() as any).n as number;
  const avg = (db()
    .prepare(`SELECT AVG(confidence) n FROM units WHERE confidence IS NOT NULL`)
    .get() as any).n as number | null;
  const catalog = db()
    .prepare(
      `SELECT ind.id AS id, ind.name AS name, COUNT(a.id) AS count
       FROM assets a JOIN industries ind ON ind.id = a.industry_id
       GROUP BY ind.id, ind.name
       ORDER BY count DESC, ind.name`
    )
    .all() as unknown as LandingIndustry[];
  return {
    assets: g(`SELECT COUNT(*) n FROM assets`),
    units: g(`SELECT COUNT(*) n FROM units`),
    chunks: g(`SELECT COUNT(*) n FROM chunks`),
    avgConfidence: avg,
    industriesTotal: g(`SELECT COUNT(*) n FROM industries`),
    industriesWithAssets: g(
      `SELECT COUNT(DISTINCT a.industry_id) n FROM assets a WHERE a.industry_id IS NOT NULL AND a.industry_id <> ''`
    ),
    catalog,
  };
}
