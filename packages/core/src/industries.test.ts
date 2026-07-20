import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sp-industries-'));
process.env.SP_DB = join(dir, 'test.db');
const { db } = await import('./db.ts');
const {
  listSolutionOwners, createSolutionOwner, updateSolutionOwner, deleteSolutionOwner,
  createIndustry, updateIndustry, deleteIndustry,
  createScenario, updateScenario, deleteScenario,
  listIndustries,
} = await import('./industries.ts');

test('solution_owners CRUD：创建、列表、改名改色、删除后引用置空', () => {
  const id = createSolutionOwner('苏叶', '#2563eb');
  let owners = listSolutionOwners();
  assert.ok(owners.some((o) => o.id === id && o.name === '苏叶' && o.color === '#2563eb'));

  updateSolutionOwner(id, { name: '苏叶(改)', color: '#16a34a' });
  owners = listSolutionOwners();
  const updated = owners.find((o) => o.id === id)!;
  assert.equal(updated.name, '苏叶(改)');
  assert.equal(updated.color, '#16a34a');

  const hr = db().prepare(`SELECT id FROM industries WHERE name='人力'`).get() as any;
  db().prepare(`UPDATE industries SET owner_id=? WHERE id=?`).run(id, hr.id);

  deleteSolutionOwner(id);
  owners = listSolutionOwners();
  assert.ok(!owners.some((o) => o.id === id));
  const hrAfter = db().prepare(`SELECT owner_id FROM industries WHERE id=?`).get(hr.id) as any;
  assert.equal(hrAfter.owner_id, null);
});

test('industries CRUD：创建、改名/绑定负责人、有场景时禁止删除', () => {
  const id = createIndustry('测试行业');
  const ownerId = createSolutionOwner('张三');
  updateIndustry(id, { name: '测试行业(改)', ownerId });
  const row = db().prepare(`SELECT name, owner_id FROM industries WHERE id=?`).get(id) as any;
  assert.equal(row.name, '测试行业(改)');
  assert.equal(row.owner_id, ownerId);

  db().prepare(`INSERT INTO industry_scenarios (id, industry_id, name) VALUES ('s-guard', ?, '占位场景')`).run(id);
  assert.throws(() => deleteIndustry(id));

  db().prepare(`DELETE FROM industry_scenarios WHERE id='s-guard'`).run();
  deleteIndustry(id); // 无场景后可删除
  const gone = db().prepare(`SELECT id FROM industries WHERE id=?`).get(id);
  assert.equal(gone, undefined);
});

test('scenarios CRUD：创建、改名、删除', () => {
  const industryId = createIndustry('场景测试行业');
  const scenarioId = createScenario(industryId, '测试场景');
  updateScenario(scenarioId, { name: '测试场景(改)' });
  const row = db().prepare(`SELECT name, industry_id FROM industry_scenarios WHERE id=?`).get(scenarioId) as any;
  assert.equal(row.name, '测试场景(改)');
  assert.equal(row.industry_id, industryId);

  deleteScenario(scenarioId);
  const gone = db().prepare(`SELECT id FROM industry_scenarios WHERE id=?`).get(scenarioId);
  assert.equal(gone, undefined);
});

test('listIndustries 返回按 sort_order 排序的嵌套树，含负责人信息', () => {
  const tree = listIndustries();
  assert.ok(tree.length >= 18);
  const hr = tree.find((i) => i.name === '人力')!;
  assert.ok(hr);
  assert.ok(hr.scenarios.some((s) => s.name === '需求初筛'));

  const ownerId = createSolutionOwner('负责人A', '#111111');
  updateIndustry(hr.id, { ownerId });
  const tree2 = listIndustries();
  const hr2 = tree2.find((i) => i.id === hr.id)!;
  assert.equal(hr2.owner_name, '负责人A');
  assert.equal(hr2.owner_color, '#111111');
});
