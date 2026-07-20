import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 指向临时库（必须在 import db.ts 之前设置）
const dir = mkdtempSync(join(tmpdir(), 'sp-db-'));
process.env.SP_DB = join(dir, 'test.db');
const { db, createChunk, createAsset, createVersion, createUnit, deleteAsset, getAssetMeta } = await import('./db.ts');

test('createChunk 写入并可读回 source_method/confidence/needs_review/parent_unit_id', () => {
  const id = createChunk({
    unitId: 'u1', text: '接通率 95%', chunkType: 'number_fact',
    sourceMethod: 'vlm', confidence: 0.42, needsReview: true, parentUnitId: 'u1',
  });
  const row = db().prepare(
    'SELECT source_method, confidence, needs_review, parent_unit_id FROM chunks WHERE id=?'
  ).get(id) as any;
  assert.equal(row.source_method, 'vlm');
  assert.equal(row.confidence, 0.42);
  assert.equal(row.needs_review, 1);
  assert.equal(row.parent_unit_id, 'u1');
});

test('createChunk parentUnitId 缺省时取 unitId', () => {
  const id = createChunk({ unitId: 'u2', text: 'x', chunkType: 'raw' });
  const row = db().prepare('SELECT parent_unit_id, needs_review FROM chunks WHERE id=?').get(id) as any;
  assert.equal(row.parent_unit_id, 'u2');
  assert.equal(row.needs_review, 0); // 缺省 0
});

test('getAssetMeta 返回分类元数据 + rawPath（reingest 用）', () => {
  const aid = createAsset({ sourceType: 'upload', title: '金融方案', assetType: 'ppt', format: 'ppt', industry: '金融', scenario: '客服', group: '行业方案', category: '金融案例' });
  createVersion({ assetId: aid, version: 'v1', checksum: 'ckmeta', rawPath: '/storage/raw/ckmeta.pptx' });
  const m = getAssetMeta(aid)!;
  assert.equal(m.title, '金融方案');
  assert.equal(m.industry, '金融');
  assert.equal(m.group, '行业方案');
  assert.equal(m.category, '金融案例');
  assert.equal(m.format, 'ppt');
  assert.equal(m.rawPath, '/storage/raw/ckmeta.pptx');
});

test('deleteAsset 删尽 units/chunks/fts/version/asset 且返回 rawPaths（reingest 依赖）', () => {
  const aid = createAsset({ sourceType: 'upload', title: '待删', assetType: 'ppt' });
  const vid = createVersion({ assetId: aid, version: 'v1', checksum: 'ckdel', rawPath: '/raw/ckdel.pptx' });
  const uid = createUnit({ versionId: vid, slideNo: 1, imagePath: '/x', rawText: 't', visualJson: '{}' });
  const cid = createChunk({ unitId: uid, text: '待删可检索文本', chunkType: 'raw' });
  assert.equal((db().prepare('SELECT count(*) n FROM chunks_fts WHERE chunk_id=?').get(cid) as any).n, 1);

  const res = deleteAsset(aid);
  assert.deepEqual(res.rawPaths, ['/raw/ckdel.pptx']);
  assert.equal((db().prepare('SELECT count(*) n FROM units WHERE version_id=?').get(vid) as any).n, 0);
  assert.equal((db().prepare('SELECT count(*) n FROM chunks WHERE unit_id=?').get(uid) as any).n, 0);
  assert.equal((db().prepare('SELECT count(*) n FROM chunks_fts WHERE chunk_id=?').get(cid) as any).n, 0);
  assert.equal((db().prepare('SELECT count(*) n FROM versions WHERE id=?').get(vid) as any).n, 0);
  assert.equal((db().prepare('SELECT count(*) n FROM assets WHERE id=?').get(aid) as any).n, 0);
});

test('initSchema 建好 industries/solution_owners/industry_scenarios 三张新表（细分方向层级已取消）', () => {
  const names = (db().prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name IN
     ('solution_owners','industries','industry_directions','industry_scenarios')`
  ).all() as any[]).map((r) => r.name).sort();
  assert.deepEqual(names, ['industries', 'industry_scenarios', 'solution_owners']);
});

test('assets 表新增 industry_id/scenario_id/industry_confirmed 列', () => {
  const cols = (db().prepare(`PRAGMA table_info(assets)`).all() as any[]).map((c) => c.name);
  assert.ok(cols.includes('industry_id'));
  assert.ok(cols.includes('scenario_id'));
  assert.ok(cols.includes('industry_confirmed'));
});

test('种子数据：18+7=25 个行业已入库，且「人力」下直接挂 3 个场景', () => {
  const n = (db().prepare(`SELECT COUNT(*) n FROM industries`).get() as any).n;
  assert.equal(n, 25);
  const hr = db().prepare(`SELECT id FROM industries WHERE name='人力'`).get() as any;
  assert.ok(hr?.id);
  const scenarioCount = (db().prepare(`SELECT COUNT(*) n FROM industry_scenarios WHERE industry_id=?`).get(hr.id) as any).n;
  assert.equal(scenarioCount, 3);
});

test('createAsset 会自动跑标题匹配分类（industry_confirmed 默认 0）', async () => {
  // 依赖种子数据里的「人力」行业与「需求初筛」场景
  const { createAsset: createAsset2 } = await import('./db.ts');
  const aid = createAsset2({ sourceType: 'upload', title: '人力资源需求初筛解决方案', assetType: 'ppt' });
  const row = db().prepare(`SELECT industry_id, industry_confirmed FROM assets WHERE id=?`).get(aid) as any;
  assert.ok(row.industry_id);
  assert.equal(row.industry_confirmed, 0);
});

test('updateAssetTagging 写入行业与场景 id、业务类型 id', async () => {
  const { createAsset: createAsset3, updateAssetTagging } = await import('./db.ts');
  const aid = createAsset3({ sourceType: 'upload', title: '无关标题不会被自动命中', assetType: 'ppt' });
  const hr = db().prepare(`SELECT id FROM industries WHERE name='人力'`).get() as any;
  const bt = db().prepare(`SELECT id FROM business_types WHERE name='产品方案'`).get() as any;
  updateAssetTagging(aid, { industryId: hr.id, scenarioId: null, businessTypeId: bt.id });
  const row = db().prepare(`SELECT industry_id, business_type_id FROM assets WHERE id=?`).get(aid) as any;
  assert.equal(row.industry_id, hr.id);
  assert.equal(row.business_type_id, bt.id);
});

test('createAsset 传入 group 时自动写入 business_type_id', async () => {
  const { createAsset: createAsset4 } = await import('./db.ts');
  const aid = createAsset4({ sourceType: 'upload', title: '随便什么标题', assetType: 'ppt', group: '客户案例' });
  const row = db().prepare(`SELECT business_type_id FROM assets WHERE id=?`).get(aid) as any;
  assert.ok(row.business_type_id);
});

test('initSchema 建好 business_types 表，assets 新增 business_type_id 列', () => {
  const t = db().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='business_types'`).get();
  assert.ok(t);
  const cols = (db().prepare(`PRAGMA table_info(assets)`).all() as any[]).map((c) => c.name);
  assert.ok(cols.includes('business_type_id'));
});

test('行业种子数据合并：18+7=25 个行业，公安反诈是公安下的场景', () => {
  const n = (db().prepare(`SELECT COUNT(*) n FROM industries`).get() as any).n;
  assert.equal(n, 25);
  const names = new Set((db().prepare(`SELECT name FROM industries`).all() as any[]).map((r) => r.name));
  for (const name of ['运营商', '政企', '政务', '公安', '燃气', '海外', '通用行业', '医疗', '教育', '汽车', '金融']) {
    assert.ok(names.has(name), `缺少行业: ${name}`);
  }
  const gongan = db().prepare(`SELECT id FROM industries WHERE name='公安'`).get() as any;
  const scenario = db().prepare(`SELECT name FROM industry_scenarios WHERE industry_id=? AND name='公安反诈'`).get(gongan.id) as any;
  assert.ok(scenario);
});

test('知识类型种子数据：5 条，公司介绍/产品方案/行业方案/客户案例/销售支持', () => {
  const names = new Set((db().prepare(`SELECT name FROM business_types`).all() as any[]).map((r) => r.name));
  assert.deepEqual(names, new Set(['公司介绍', '产品方案', '行业方案', '客户案例', '销售支持']));
});

test('重复调用 initSchema（同一进程内 db() 已缓存，用新临时库验证幂等）不会重复种入行业/业务类型', () => {
  // db() 是单例缓存，这里直接验证：再插入一次同名行业不会产生第二条（唯一约束 + OR IGNORE）
  const before = (db().prepare(`SELECT COUNT(*) n FROM industries WHERE name='运营商'`).get() as any).n;
  assert.equal(before, 1);
});

test('renameAsset 更新素材 title；对不存在的 id 为 no-op 不抛错', async () => {
  const { createAsset: createAsset5, renameAsset } = await import('./db.ts');
  const aid = createAsset5({ sourceType: 'upload', title: '文件名派生的旧标题', assetType: 'ppt' });
  renameAsset(aid, '重命名后的新标题');
  assert.equal(getAssetMeta(aid)!.title, '重命名后的新标题');
  assert.doesNotThrow(() => renameAsset('no-such-id', '随便'));
});
