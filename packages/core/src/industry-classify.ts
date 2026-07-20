import { db } from './db.ts';

export type ClassifyMatch = { industryId: string; scenarioId: string | null };

/**
 * 用当前 industries/industry_scenarios 里已录入的名称去匹配标题。
 * 命中优先级：场景名 > 行业名（越深层命中说明匹配越精确）。
 */
export function classifyTitle(title: string): ClassifyMatch | null {
  if (!title) return null;

  const scenarios = db().prepare(
    `SELECT id AS scenario_id, name AS scenario_name, industry_id FROM industry_scenarios`
  ).all() as { scenario_id: string; scenario_name: string; industry_id: string }[];
  for (const s of scenarios) {
    if (s.scenario_name && title.includes(s.scenario_name)) {
      return { industryId: s.industry_id, scenarioId: s.scenario_id };
    }
  }

  const industries = db().prepare(`SELECT id, name FROM industries`).all() as { id: string; name: string }[];
  for (const ind of industries) {
    if (ind.name && title.includes(ind.name)) {
      return { industryId: ind.id, scenarioId: null };
    }
  }

  return null;
}

/** 无条件覆盖写入（不再有 industry_confirmed 门槛——确认环节已取消）。 */
export function autoClassifyAsset(assetId: string, title: string): void {
  const match = classifyTitle(title);
  if (!match) return;
  db().prepare(
    `UPDATE assets SET industry_id=?, scenario_id=? WHERE id=?`
  ).run(match.industryId, match.scenarioId, assetId);
}

/** 对全部素材重新跑一遍标题关键词匹配；命中则覆盖（含之前人工改过的），未命中保持原值不变。 */
export function reclassifyAllAssetsIndustry(): number {
  const rows = db().prepare(`SELECT id, title FROM assets`).all() as { id: string; title: string }[];
  let changed = 0;
  for (const r of rows) {
    const match = classifyTitle(r.title || '');
    if (match) {
      db().prepare(
        `UPDATE assets SET industry_id=?, scenario_id=? WHERE id=?`
      ).run(match.industryId, match.scenarioId, r.id);
      changed++;
    }
  }
  return changed;
}
