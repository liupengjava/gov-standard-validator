import { randomUUID } from 'node:crypto';
import { db } from './db.ts';

export type SolutionOwner = { id: string; name: string; color: string | null; created_at: string };

export type IndustryScenarioRow = { id: string; name: string; sort_order: number; asset_count: number };
export type IndustryTreeRow = {
  id: string; name: string; sort_order: number; asset_count: number;
  owner_id: string | null; owner_name: string | null; owner_color: string | null;
  scenarios: IndustryScenarioRow[];
};

export function listSolutionOwners(): SolutionOwner[] {
  return db().prepare(`SELECT id, name, color, created_at FROM solution_owners ORDER BY created_at`).all() as SolutionOwner[];
}

export function createSolutionOwner(name: string, color?: string | null): string {
  const id = randomUUID();
  db().prepare(`INSERT INTO solution_owners (id, name, color) VALUES (?,?,?)`).run(id, name, color ?? null);
  return id;
}

export function updateSolutionOwner(id: string, patch: { name?: string; color?: string | null }): void {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.name !== undefined) { fields.push('name=?'); values.push(patch.name); }
  if (patch.color !== undefined) { fields.push('color=?'); values.push(patch.color); }
  if (!fields.length) return;
  values.push(id);
  db().prepare(`UPDATE solution_owners SET ${fields.join(', ')} WHERE id=?`).run(...values);
}

export function deleteSolutionOwner(id: string): void {
  db().prepare(`UPDATE industries SET owner_id=NULL WHERE owner_id=?`).run(id);
  db().prepare(`DELETE FROM solution_owners WHERE id=?`).run(id);
}

export function createIndustry(name: string): string {
  const id = randomUUID();
  const maxOrder = (db().prepare(`SELECT COALESCE(MAX(sort_order), -1) m FROM industries`).get() as any).m;
  db().prepare(`INSERT INTO industries (id, name, sort_order) VALUES (?,?,?)`).run(id, name, maxOrder + 1);
  return id;
}

export function updateIndustry(id: string, patch: { name?: string; ownerId?: string | null; sortOrder?: number }): void {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.name !== undefined) { fields.push('name=?'); values.push(patch.name); }
  if (patch.ownerId !== undefined) { fields.push('owner_id=?'); values.push(patch.ownerId); }
  if (patch.sortOrder !== undefined) { fields.push('sort_order=?'); values.push(patch.sortOrder); }
  if (!fields.length) return;
  fields.push(`updated_at=datetime('now')`);
  values.push(id);
  db().prepare(`UPDATE industries SET ${fields.join(', ')} WHERE id=?`).run(...values);
}

export function deleteIndustry(id: string): void {
  const n = (db().prepare(`SELECT COUNT(*) n FROM industry_scenarios WHERE industry_id=?`).get(id) as any).n;
  if (n > 0) throw new Error('行业下还有场景，无法删除');
  db().prepare(`DELETE FROM industries WHERE id=?`).run(id);
}

export function createScenario(industryId: string, name: string): string {
  const id = randomUUID();
  const maxOrder = (db().prepare(`SELECT COALESCE(MAX(sort_order), -1) m FROM industry_scenarios WHERE industry_id=?`).get(industryId) as any).m;
  db().prepare(`INSERT INTO industry_scenarios (id, industry_id, name, sort_order) VALUES (?,?,?,?)`).run(id, industryId, name, maxOrder + 1);
  return id;
}

export function updateScenario(id: string, patch: { name?: string; sortOrder?: number }): void {
  const fields: string[] = [];
  const values: any[] = [];
  if (patch.name !== undefined) { fields.push('name=?'); values.push(patch.name); }
  if (patch.sortOrder !== undefined) { fields.push('sort_order=?'); values.push(patch.sortOrder); }
  if (!fields.length) return;
  values.push(id);
  db().prepare(`UPDATE industry_scenarios SET ${fields.join(', ')} WHERE id=?`).run(...values);
}

export function deleteScenario(id: string): void {
  db().prepare(`DELETE FROM industry_scenarios WHERE id=?`).run(id);
}

/** 行业整组排序落库（PRD-0029）：照 db.ts setAssetsOrder 模式，单事务按传入 id 顺序写 sort_order=下标。
 * 调用方（前端）负责给出按期望顺序排列的全部行业 id。返回实际更新条数。 */
export function setIndustriesOrder(ids: string[]): { updated: number } {
  const d = db();
  d.exec('BEGIN');
  try {
    const upd = d.prepare(`UPDATE industries SET sort_order=? WHERE id=?`);
    let updated = 0;
    ids.forEach((id, i) => { updated += Number(upd.run(i, id).changes); });
    d.exec('COMMIT');
    return { updated };
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/** 同一行业下场景整组排序落库（PRD-0029）：industry_id 双重校验，避免误改其他行业的场景。 */
export function setScenariosOrder(industryId: string, ids: string[]): { updated: number } {
  const d = db();
  d.exec('BEGIN');
  try {
    const upd = d.prepare(`UPDATE industry_scenarios SET sort_order=? WHERE id=? AND industry_id=?`);
    let updated = 0;
    ids.forEach((id, i) => { updated += Number(upd.run(i, id, industryId).changes); });
    d.exec('COMMIT');
    return { updated };
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export function listIndustries(): IndustryTreeRow[] {
  const industries = db().prepare(
    `SELECT i.id, i.name, i.sort_order, i.owner_id,
            o.name AS owner_name, o.color AS owner_color
     FROM industries i LEFT JOIN solution_owners o ON o.id = i.owner_id
     ORDER BY i.sort_order`
  ).all() as any[];
  const scenarios = db().prepare(
    `SELECT id, industry_id, name, sort_order FROM industry_scenarios ORDER BY sort_order`
  ).all() as any[];
  // 每个场景下的知识数量（供分类管理的场景卡展示「N 条知识」）。
  const counts = db().prepare(
    `SELECT scenario_id, COUNT(*) n FROM assets WHERE scenario_id IS NOT NULL GROUP BY scenario_id`
  ).all() as any[];
  const countByScenario = new Map<string, number>(counts.map((c) => [c.scenario_id, c.n]));
  // 每个行业下的知识总数（供分类管理左栏按知识量排序 / 展示）。
  const indCounts = db().prepare(
    `SELECT industry_id, COUNT(*) n FROM assets WHERE industry_id IS NOT NULL GROUP BY industry_id`
  ).all() as any[];
  const countByIndustry = new Map<string, number>(indCounts.map((c) => [c.industry_id, c.n]));

  const rows: IndustryTreeRow[] = industries.map((ind) => ({
    id: ind.id, name: ind.name, sort_order: ind.sort_order, asset_count: countByIndustry.get(ind.id) ?? 0,
    owner_id: ind.owner_id, owner_name: ind.owner_name, owner_color: ind.owner_color,
    scenarios: scenarios
      .filter((s) => s.industry_id === ind.id)
      .map((s) => ({ id: s.id, name: s.name, sort_order: s.sort_order, asset_count: countByScenario.get(s.id) ?? 0 })),
  }));
  // 行业排序语义（PRD-0029）：sort_order 优先（手工拖拽固化的顺序），sort_order 相同时退化为知识量降序
  // （未手工排过时保持现状「知识最多的在上面」）。asset_count 在 JS 聚合，故排序也在此处做而非 SQL。
  rows.sort((a, b) => a.sort_order - b.sort_order || b.asset_count - a.asset_count);
  return rows;
}
