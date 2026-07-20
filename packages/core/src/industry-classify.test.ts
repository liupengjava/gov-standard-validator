import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sp-classify-'));
process.env.SP_DB = join(dir, 'test.db');
const { db } = await import('./db.ts');
const { classifyTitle, autoClassifyAsset, reclassifyAllAssetsIndustry } = await import('./industry-classify.ts');

test('classifyTitle 命中场景名，返回行业+场景二级 id', () => {
  const match = classifyTitle('人力资源候选人电话初面话术');
  assert.ok(match);
  const industry = db().prepare(`SELECT name FROM industries WHERE id=?`).get(match!.industryId) as any;
  assert.equal(industry.name, '人力');
  assert.ok(match!.scenarioId);
});

test('classifyTitle 只命中行业名时 scenarioId 为 null', () => {
  const match = classifyTitle('金融行业解决方案介绍');
  assert.ok(match);
  const industry = db().prepare(`SELECT name FROM industries WHERE id=?`).get(match!.industryId) as any;
  assert.equal(industry.name, '金融');
  assert.equal(match!.scenarioId, null);
});

test('classifyTitle 无命中返回 null', () => {
  assert.equal(classifyTitle('完全不相关的标题 XYZ'), null);
});

test('autoClassifyAsset 无条件覆盖（不再有 industry_confirmed 门槛）', () => {
  db().prepare(`INSERT INTO assets (id, source_type, title, asset_type) VALUES ('a2','upload','候选人电话初面','ppt')`).run();
  autoClassifyAsset('a2', '候选人电话初面');
  const row2 = db().prepare(`SELECT industry_id, scenario_id FROM assets WHERE id='a2'`).get() as any;
  assert.ok(row2.industry_id);
  assert.ok(row2.scenario_id);

  // 补充：即使素材已标记为 industry_confirmed=1，也应该被无条件覆盖
  db().prepare(`INSERT INTO assets (id, source_type, title, asset_type, industry_confirmed) VALUES ('a5','upload','候选人电话初面','ppt',1)`).run();
  autoClassifyAsset('a5', '候选人电话初面');
  const row5 = db().prepare(`SELECT industry_id FROM assets WHERE id='a5'`).get() as any;
  assert.ok(row5.industry_id); // 即使 industry_confirmed=1，也应该被覆盖写入
});

test('reclassifyAllAssetsIndustry 对全部素材重新跑标题匹配，返回命中数', () => {
  db().prepare(`INSERT INTO assets (id, source_type, title, asset_type) VALUES ('a3','upload','电话调研','ppt')`).run();
  db().prepare(`INSERT INTO assets (id, source_type, title, asset_type) VALUES ('a4','upload','无关标题','ppt')`).run();
  const changed = reclassifyAllAssetsIndustry();
  assert.ok(changed >= 1);
  const row = db().prepare(`SELECT industry_id FROM assets WHERE id='a3'`).get() as any;
  assert.ok(row.industry_id);
  const row2 = db().prepare(`SELECT industry_id FROM assets WHERE id='a4'`).get() as any;
  assert.equal(row2.industry_id, null);
});
