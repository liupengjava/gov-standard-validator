import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sp-btypes-'));
process.env.SP_DB = join(dir, 'test.db');
const { db, createAsset } = await import('./db.ts');
const {
  listBusinessTypes, createBusinessType, updateBusinessType, deleteBusinessType,
  classifyBusinessTypeFromGroupName, reclassifyAllAssetsBusinessType,
} = await import('./business-types.ts');

test('business_types CRUD：种子数据 + 新建/改名/删除', () => {
  const seeded = listBusinessTypes();
  assert.ok(seeded.some((b) => b.name === '产品方案'));

  const id = createBusinessType('测试类型');
  updateBusinessType(id, { name: '测试类型(改)' });
  const row = db().prepare(`SELECT name FROM business_types WHERE id=?`).get(id) as any;
  assert.equal(row.name, '测试类型(改)');

  deleteBusinessType(id);
  assert.equal(db().prepare(`SELECT id FROM business_types WHERE id=?`).get(id), undefined);
});

test('classifyBusinessTypeFromGroupName：知识类型名直配 + 旧分组代号映射', () => {
  // 直配：分组名即知识类型名
  const id = classifyBusinessTypeFromGroupName('行业方案');
  assert.ok(id);
  const row = db().prepare(`SELECT name FROM business_types WHERE id=?`).get(id) as any;
  assert.equal(row.name, '行业方案');

  // 兼容旧分组代号（公司 → 公司介绍）
  const id2 = classifyBusinessTypeFromGroupName('公司');
  assert.ok(id2);
  const row2 = db().prepare(`SELECT name FROM business_types WHERE id=?`).get(id2) as any;
  assert.equal(row2.name, '公司介绍');

  assert.equal(classifyBusinessTypeFromGroupName(null), null);
  assert.equal(classifyBusinessTypeFromGroupName('不存在的分组'), null);
});

test('reclassifyAllAssetsBusinessType：按 group_name 批量回填，group_name 为空的保持 null', () => {
  const a1 = createAsset({ sourceType: 'upload', title: '测试1', assetType: 'ppt', group: '客户案例' });
  const a2 = createAsset({ sourceType: 'upload', title: '测试2', assetType: 'ppt' }); // 无 group
  const changed = reclassifyAllAssetsBusinessType();
  assert.ok(changed >= 1);
  const row1 = db().prepare(`SELECT business_type_id FROM assets WHERE id=?`).get(a1) as any;
  assert.ok(row1.business_type_id);
  const row2 = db().prepare(`SELECT business_type_id FROM assets WHERE id=?`).get(a2) as any;
  assert.equal(row2.business_type_id, null);
});

test('删除的种子知识类型在重启后不复活（回归：seed 只在首次空表时种）', () => {
  // 前置：种子里存在「产品方案」，删掉它
  const target = listBusinessTypes().find((b) => b.name === '产品方案');
  assert.ok(target, '前置：种子应包含产品方案');
  deleteBusinessType(target!.id);
  assert.ok(!listBusinessTypes().some((b) => b.name === '产品方案'), '删除后应立即消失');

  // 模拟进程重启：丢弃挂在 globalThis 的连接单例，让 db() 重开同一文件并重跑 initSchema
  const st = (globalThis as any).__salespilotDb as { db: any };
  st.db.close();
  st.db = null;

  // 重开后不应把已删除的种子重新塞回来
  assert.ok(!listBusinessTypes().some((b) => b.name === '产品方案'), '重启后产品方案不应被重新种入');
});
