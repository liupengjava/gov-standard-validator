import { db, updateAssetTagging } from './db.ts';
import { callClaude, extractJson } from './ai-cli.ts';
import { classifyTitle } from './industry-classify.ts';
import { classifyBusinessTypeFromGroupName } from './business-types.ts';

/** 拼接某素材最新版本下所有 units 的 conclusion + visual_summary（按 slide_no 排序），超过 maxChars 截断。
 *  无内容（素材不存在/无 version/无 unit）返回空字符串，不抛错。 */
export function buildContentSummary(assetId: string, maxChars = 3000): string {
  const version = db().prepare(
    `SELECT id FROM versions WHERE asset_id=? ORDER BY created_at DESC LIMIT 1`
  ).get(assetId) as { id: string } | undefined;
  if (!version) return '';

  const units = db().prepare(
    `SELECT slide_no, conclusion, visual_summary FROM units WHERE version_id=? ORDER BY slide_no ASC`
  ).all(version.id) as { slide_no: number; conclusion: string | null; visual_summary: string | null }[];
  if (!units.length) return '';

  const parts = units
    .map((u) => [u.conclusion, u.visual_summary].filter(Boolean).join('\n'))
    .filter(Boolean);
  const summary = parts.join('\n\n');
  return summary.length > maxChars ? summary.slice(0, maxChars) : summary;
}

/** 把当前 industries + industry_scenarios 渲染成一段给 AI 看的候选行业文本。
 *  无场景的行业只显示行业名，不显示空括号。 */
export function buildIndustryCandidatesText(): string {
  const industries = db().prepare(
    `SELECT id, name FROM industries ORDER BY sort_order ASC`
  ).all() as { id: string; name: string }[];
  const scenarios = db().prepare(
    `SELECT industry_id, name FROM industry_scenarios ORDER BY sort_order ASC`
  ).all() as { industry_id: string; name: string }[];

  const scenariosByIndustry = new Map<string, string[]>();
  for (const s of scenarios) {
    const list = scenariosByIndustry.get(s.industry_id) ?? [];
    list.push(s.name);
    scenariosByIndustry.set(s.industry_id, list);
  }

  return industries
    .map((ind) => {
      const scenarioNames = scenariosByIndustry.get(ind.id);
      return scenarioNames?.length ? `- ${ind.name}（场景：${scenarioNames.join('、')}）` : `- ${ind.name}`;
    })
    .join('\n');
}

/** 把 business_types 表渲染成候选业务类型文本（按 sort_order，逗号分隔的一行）。 */
export function buildBusinessTypeCandidatesText(): string {
  const rows = db().prepare(
    `SELECT name FROM business_types ORDER BY sort_order ASC`
  ).all() as { name: string }[];
  return rows.map((r) => r.name).join('、');
}

export type ContentClassifyDecision = {
  industryId?: string; scenarioId?: string; businessTypeId?: string;
};

/** 解析 AI 返回的原始文本（可能带 ```json 围栏），把行业/场景/业务类型名按名字查表转成 id。
 *  查不到的字段、字段值不是字符串（对象/数组/布尔值等）整个 key 都不出现在返回对象里；
 *  JSON 损坏或解析失败返回 {}，不抛错。 */
export function parseClassifyResponse(rawText: string): ContentClassifyDecision {
  let parsed: any;
  try {
    parsed = extractJson(rawText);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};

  const decision: ContentClassifyDecision = {};

  if (typeof parsed.industry === 'string') {
    const row = db().prepare(`SELECT id FROM industries WHERE name=?`).get(parsed.industry) as { id: string } | undefined;
    if (row) decision.industryId = row.id;
  }
  if (typeof parsed.scenario === 'string') {
    const row = db().prepare(`SELECT id FROM industry_scenarios WHERE name=?`).get(parsed.scenario) as { id: string } | undefined;
    if (row) decision.scenarioId = row.id;
  }
  if (typeof parsed.businessType === 'string') {
    const row = db().prepare(`SELECT id FROM business_types WHERE name=?`).get(parsed.businessType) as { id: string } | undefined;
    if (row) decision.businessTypeId = row.id;
  }

  return decision;
}

/** 解析完成后编排一次基于内容的行业/业务类型分类。
 *
 * 成本优化：先用免费的标题匹配（classifyTitle）和分组映射（classifyBusinessTypeFromGroupName）判断，
 * 只有命中到场景层级才算行业"明确"（只命中行业名容易被无关标题里的子串误判，不能作为跳过依据）；
 * 业务类型只要 group_name 能映射上就算"明确"。两项都明确时直接返回，不读内容、不调 AI。
 * 否则才读内容摘要 + 调 AI，且已明确的字段要从 AI 返回结果中删除，不能被覆盖。
 * 全程 try/catch：AI 调用失败/JSON 解析失败只打警告，不抛错，不影响调用方（解析流程）。 */
export async function classifyAssetContent(assetId: string, title: string): Promise<void> {
  try {
    // 1. 先用免费的标题/分组信号判断，能明确判断的就不读内容、不调 AI。
    const titleMatch = classifyTitle(title);
    const industryConfident = !!(titleMatch && titleMatch.scenarioId); // 只命中到行业这一层不算明确
    const row = db().prepare(`SELECT group_name FROM assets WHERE id=?`).get(assetId) as { group_name: string | null } | undefined;
    const businessTypeIdFromGroup = classifyBusinessTypeFromGroupName(row?.group_name ?? null);
    const businessTypeConfident = !!businessTypeIdFromGroup;

    if (industryConfident && businessTypeConfident) return; // 两项都已明确，不需要再判断

    const content = buildContentSummary(assetId);
    if (!content) return; // 没内容也判断不了

    const prompt = `你是销售知识库的行业/业务类型分类助手。根据素材标题和内容摘要，从候选列表中选出最匹配的行业、场景、业务类型；判断不出来的字段填 null，不要勉强凑一个。

素材标题：${title}

内容摘要：
${content}

候选行业（部分行业下面列出了已有的场景，选场景前必须先选对应的行业；没有合适的场景就只填行业，scenario 填 null）：
${buildIndustryCandidatesText()}

候选业务类型：
${buildBusinessTypeCandidatesText()}

仅输出 JSON，不要任何其他文字：{"industry":"行业名或null","scenario":"场景名或null","businessType":"业务类型名或null"}`;

    const r = await callClaude(prompt, { model: 'sonnet' });
    const decision = parseClassifyResponse(r.text);

    // 2. 已经明确判断过的字段，不能被 AI 的独立判断覆盖。
    if (industryConfident) { delete decision.industryId; delete decision.scenarioId; }
    if (businessTypeConfident) { delete decision.businessTypeId; }

    if (Object.keys(decision).length === 0) return;
    updateAssetTagging(assetId, decision);
  } catch (e) {
    console.warn('[content-classify] 分类失败，跳过：', assetId, String(e).slice(0, 200));
  }
}
