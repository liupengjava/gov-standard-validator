import { randomUUID } from 'node:crypto';
import { db } from './db.ts';

export type BusinessType = { id: string; name: string; sort_order: number; created_at: string; asset_count: number };

export function listBusinessTypes(): BusinessType[] {
  const types = db().prepare(`SELECT id, name, sort_order, created_at FROM business_types ORDER BY sort_order`).all() as any[];
  // 每个知识类型被多少条素材引用（供分类管理展示「N 条引用」）。
  const counts = db().prepare(
    `SELECT business_type_id, COUNT(*) n FROM assets WHERE business_type_id IS NOT NULL GROUP BY business_type_id`
  ).all() as any[];
  const countByType = new Map<string, number>(counts.map((c) => [c.business_type_id, c.n]));
  return types.map((t) => ({ ...t, asset_count: countByType.get(t.id) ?? 0 }));
}

export function createBusinessType(name: string): string {
  const id = randomUUID();
  const maxOrder = (db().prepare(`SELECT COALESCE(MAX(sort_order), -1) m FROM business_types`).get() as any).m;
  db().prepare(`INSERT INTO business_types (id, name, sort_order) VALUES (?,?,?)`).run(id, name, maxOrder + 1);
  return id;
}

export function updateBusinessType(id: string, patch: { name?: string; sortOrder?: number }): void {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.name !== undefined) { fields.push('name=?'); values.push(patch.name); }
  if (patch.sortOrder !== undefined) { fields.push('sort_order=?'); values.push(patch.sortOrder); }
  if (!fields.length) return;
  values.push(id);
  db().prepare(`UPDATE business_types SET ${fields.join(', ')} WHERE id=?`).run(...values);
}

export function deleteBusinessType(id: string): void {
  db().prepare(`DELETE FROM business_types WHERE id=?`).run(id);
}

/** 知识类型整组排序落库（PRD-0029）：照 db.ts setAssetsOrder 模式，单事务按传入 id 顺序写 sort_order=下标。
 * 知识运营侧边菜单顺序即该 sort_order，改完自然联动。返回实际更新条数。 */
export function setBusinessTypesOrder(ids: string[]): { updated: number } {
  const d = db();
  d.exec('BEGIN');
  try {
    const upd = d.prepare(`UPDATE business_types SET sort_order=? WHERE id=?`);
    let updated = 0;
    ids.forEach((id, i) => { updated += Number(upd.run(i, id).changes); });
    d.exec('COMMIT');
    return { updated };
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

const GROUP_TO_BUSINESS_TYPE: Record<string, string> = {
  '公司': '公司介绍',
  '产品': '产品方案',
  '行业方案': '行业方案',
  '客户案例': '客户案例',
  '销售支持': '销售支持',
};

export function classifyBusinessTypeFromGroupName(groupName: string | null | undefined): string | null {
  if (!groupName) return null;
  // 新模型：菜单/分组名即知识类型名，先按知识类型名精确匹配。
  const direct = db().prepare(`SELECT id FROM business_types WHERE name=?`).get(groupName) as any;
  if (direct?.id) return direct.id;
  // 兼容旧分组代号（公司/产品/…）。
  const name = GROUP_TO_BUSINESS_TYPE[groupName];
  if (!name) return null;
  const row = db().prepare(`SELECT id FROM business_types WHERE name=?`).get(name) as any;
  return row?.id ?? null;
}

export function reclassifyAllAssetsBusinessType(): number {
  const rows = db().prepare(`SELECT id, group_name FROM assets`).all() as { id: string; group_name: string | null }[];
  let changed = 0;
  for (const r of rows) {
    const businessTypeId = classifyBusinessTypeFromGroupName(r.group_name);
    if (businessTypeId) {
      db().prepare(`UPDATE assets SET business_type_id=? WHERE id=?`).run(businessTypeId, r.id);
      changed++;
    }
  }
  return changed;
}
