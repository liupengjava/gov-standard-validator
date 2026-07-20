import { existsSync } from 'node:fs';
import { db, type ChunkHit } from './db.ts';
import { search, type MetadataFilter } from './retrieval.ts';
import { assembleUnitView, type ArchNode, type NumberFact, type UnitView } from './unit-view.ts';
import { buildKnowledgeGraph, type KnowledgeGraph } from './knowledge-graph.ts';

export type AnswerMode = 'brief' | 'standard' | 'deep';
export type KnowledgeIntent = 'asset_list' | 'architecture' | 'metric' | 'case' | 'general';

export type AssetCard = {
  asset_id: string;
  title: string;
  business_type?: string | null;
  industry?: string | null;
  scenario?: string | null;
  category?: string | null;
  format?: string | null;
  source_url?: string | null;
  version_id?: string | null;
  version?: string | null;
  pages?: number | null;
  evidence_count: number;
  image_count: number;
  matched_slides: number[];
  score: number;
};

export type EvidenceCard = {
  evidence_id: string;
  asset_id: string;
  version_id: string;
  unit_id: string;
  chunk_id?: string;
  asset_title: string;
  business_type?: string | null;
  industry?: string | null;
  format?: string | null;
  version?: string | null;
  source_url?: string | null;
  slide_no: number;
  title: string;
  text: string;
  chunk_type?: string | null;
  source_method?: string | null;
  needs_review: boolean;
  image_path?: string | null;
  image_url?: string | null;
  image_markdown?: string | null;
  ocr_text_exact?: string;
  image_understanding?: string;
  numbers_with_units?: NumberFact[];
  architecture_nodes?: ArchNode[];
};

export type FactPack = {
  query: string;
  intent: KnowledgeIntent;
  mode: AnswerMode;
  summary: { direct_answer: string; confidence: 'low' | 'medium' | 'high'; coverage_note: string };
  assets: AssetCard[];
  evidence_cards: EvidenceCard[];
  graph: KnowledgeGraph;
  gaps: string[];
  debug: Record<string, unknown>;
};

export type FactPackOptions = {
  mode?: AnswerMode;
  limit?: number;
  include_images?: boolean;
  include_graph?: boolean;
  filter?: MetadataFilter;
  industry?: string;
  business_type?: string;
};

export type EvidenceRef = {
  unit_id?: string;
  asset_id?: string;
  slide_no?: number;
};

export type AssetRef = {
  asset_id?: string;
  title?: string;
  limit?: number;
};

export type MaterialPackOptions = {
  output_type?: 'word' | 'ppt' | 'web' | 'generic';
  sections?: string[];
  limit?: number;
  evidence_per_section?: number;
  include_images?: boolean;
  include_graph?: boolean;
};

type AssetRow = {
  asset_id: string;
  title: string;
  industry: string | null;
  industry_name: string | null;
  scenario: string | null;
  scenario_name: string | null;
  business_type_name: string | null;
  group_name: string | null;
  category: string | null;
  format: string | null;
  source_url: string | null;
  status: string | null;
  version_id: string | null;
  version: string | null;
  pages: number | null;
  created_at: string | null;
};

type UnitRow = {
  id: string;
  version_id: string;
  asset_id: string;
  asset_title: string;
  business_type_name: string | null;
  industry_name: string | null;
  industry: string | null;
  format: string | null;
  source_url: string | null;
  version: string | null;
  slide_no: number;
  image_path: string;
  title: string | null;
  slide_type: string | null;
  conclusion: string | null;
  visual_summary: string | null;
  confidence: number | null;
  needs_review: number | null;
  raw_text: string | null;
  visual_json: string | null;
};

const MODE_LIMITS: Record<AnswerMode, { assets: number; evidence: number; images: number; graphEdges: number }> = {
  brief: { assets: 5, evidence: 8, images: 1, graphEdges: 10 },
  standard: { assets: 10, evidence: 16, images: 3, graphEdges: 24 },
  deep: { assets: 20, evidence: 32, images: 6, graphEdges: 50 },
};

const GROUP_TO_BT: Record<string, string> = {
  '公司': '公司介绍',
  '产品': '产品方案',
  '业务方案': '行业方案',
  '行业方案': '行业方案',
  '客户案例': '客户案例',
  '销售支持': '销售支持',
};

function clampMode(mode: unknown): AnswerMode {
  return mode === 'brief' || mode === 'deep' || mode === 'standard' ? mode : 'standard';
}

export function detectIntent(query: string): KnowledgeIntent {
  const q = query || '';
  if (/架构|流程|部署|拓扑|链路|组件|节点/.test(q)) return 'architecture';
  if (/指标|数据|金额|比例|提升|降低|预算|坐席|并发|准确率|转化率/.test(q)) return 'metric';
  if (/案例|客户|标杆|拜访/.test(q)) return 'case';
  if (/有哪些|清单|列表|资料|素材|方案|可支撑|覆盖哪些/.test(q)) return 'asset_list';
  return 'general';
}

function textOf(v: unknown): string {
  return v == null ? '' : String(v);
}

function termsOf(query: string): string[] {
  const out = new Set<string>();
  for (const m of query.matchAll(/[A-Za-z0-9][A-Za-z0-9._-]{1,}/g)) out.add(m[0].toLowerCase());
  for (const m of query.matchAll(/[一-龥]{2,}/g)) {
    const s = m[0];
    if (s.length <= 4) out.add(s);
    else for (let i = 0; i + 2 <= s.length; i += 2) out.add(s.slice(i, Math.min(i + 4, s.length)));
  }
  return [...out].filter((t) => !/当前|哪些|什么|如何|以及|相关|总体|可以/.test(t));
}

function inferIndustry(query: string): string | undefined {
  const q = query || '';
  if (/运营商|移动|联通|电信|政企/.test(q)) return '运营商';
  if (/公安|警务|民警|反诈/.test(q)) return '公安';
  if (/金融|银行|证券|消金|消费金融|催收|不良资产|出海/.test(q)) return '金融';
  if (/政务|政府|政务热线/.test(q)) return '政务';
  if (/燃气|燃气公司/.test(q)) return '燃气';
  if (/海外|香港|出海/.test(q)) return '海外';
  return undefined;
}

function businessTypeOf(row: { business_type_name?: string | null; group_name?: string | null }): string | null {
  return row.business_type_name || (row.group_name ? GROUP_TO_BT[row.group_name] || row.group_name : null);
}

function industryOf(row: { industry_name?: string | null; industry?: string | null }): string | null {
  return row.industry_name || row.industry || null;
}

function imageUrl(imagePath: string | null | undefined): string | null {
  if (!imagePath) return null;
  return `/api/img?path=${encodeURIComponent(imagePath)}`;
}

function imageMarkdown(assetTitle: string, slideNo: number, imagePath: string | null | undefined): string | null {
  if (!imagePath) return null;
  return `![《${assetTitle}》第${slideNo}页](<${imagePath}>)`;
}

function latestAssets(): AssetRow[] {
  return db().prepare(`
    SELECT a.id AS asset_id, a.title, a.industry, ind.name AS industry_name,
           a.scenario, sc.name AS scenario_name, bt.name AS business_type_name,
           a.group_name, a.category, COALESCE(a.format,'ppt') AS format,
           a.source_url, a.status, a.created_at,
           v.id AS version_id, v.version, v.pages
    FROM assets a
    LEFT JOIN versions v ON v.id = (
      SELECT id FROM versions vv WHERE vv.asset_id=a.id ORDER BY vv.created_at DESC LIMIT 1
    )
    LEFT JOIN industries ind ON ind.id = a.industry_id
    LEFT JOIN industry_scenarios sc ON sc.id = a.scenario_id
    LEFT JOIN business_types bt ON bt.id = a.business_type_id
    ORDER BY a.created_at DESC
  `).all() as AssetRow[];
}

function unitById(unitId: string): UnitRow | undefined {
  return db().prepare(`
    SELECT u.id, u.version_id, a.id AS asset_id, a.title AS asset_title,
           bt.name AS business_type_name, ind.name AS industry_name, a.industry,
           COALESCE(a.format,'ppt') AS format, a.source_url, v.version,
           u.slide_no, u.image_path, u.title, u.slide_type, u.conclusion,
           u.visual_summary, u.confidence, u.needs_review, u.raw_text, u.visual_json
    FROM units u
    JOIN versions v ON v.id=u.version_id
    JOIN assets a ON a.id=v.asset_id
    LEFT JOIN industries ind ON ind.id = a.industry_id
    LEFT JOIN business_types bt ON bt.id = a.business_type_id
    WHERE u.id=?
  `).get(unitId) as UnitRow | undefined;
}

function unitByAssetSlide(assetId: string, slideNo: number): UnitRow | undefined {
  return db().prepare(`
    SELECT u.id, u.version_id, a.id AS asset_id, a.title AS asset_title,
           bt.name AS business_type_name, ind.name AS industry_name, a.industry,
           COALESCE(a.format,'ppt') AS format, a.source_url, v.version,
           u.slide_no, u.image_path, u.title, u.slide_type, u.conclusion,
           u.visual_summary, u.confidence, u.needs_review, u.raw_text, u.visual_json
    FROM units u
    JOIN versions v ON v.id=u.version_id
    JOIN assets a ON a.id=v.asset_id
    LEFT JOIN industries ind ON ind.id = a.industry_id
    LEFT JOIN business_types bt ON bt.id = a.business_type_id
    WHERE a.id=? AND u.slide_no=?
    ORDER BY v.created_at DESC LIMIT 1
  `).get(assetId, slideNo) as UnitRow | undefined;
}

function unitsByVersion(versionId: string, limit: number): UnitRow[] {
  return db().prepare(`
    SELECT u.id, u.version_id, a.id AS asset_id, a.title AS asset_title,
           bt.name AS business_type_name, ind.name AS industry_name, a.industry,
           COALESCE(a.format,'ppt') AS format, a.source_url, v.version,
           u.slide_no, u.image_path, u.title, u.slide_type, u.conclusion,
           u.visual_summary, u.confidence, u.needs_review, u.raw_text, u.visual_json
    FROM units u
    JOIN versions v ON v.id=u.version_id
    JOIN assets a ON a.id=v.asset_id
    LEFT JOIN industries ind ON ind.id = a.industry_id
    LEFT JOIN business_types bt ON bt.id = a.business_type_id
    WHERE u.version_id=?
    ORDER BY u.slide_no ASC LIMIT ?
  `).all(versionId, limit) as UnitRow[];
}

function unitsByAsset(assetId: string, limit: number): UnitRow[] {
  return db().prepare(`
    SELECT u.id, u.version_id, a.id AS asset_id, a.title AS asset_title,
           bt.name AS business_type_name, ind.name AS industry_name, a.industry,
           COALESCE(a.format,'ppt') AS format, a.source_url, v.version,
           u.slide_no, u.image_path, u.title, u.slide_type, u.conclusion,
           u.visual_summary, u.confidence, u.needs_review, u.raw_text, u.visual_json
    FROM units u
    JOIN versions v ON v.id=u.version_id
    JOIN assets a ON a.id=v.asset_id
    LEFT JOIN industries ind ON ind.id = a.industry_id
    LEFT JOIN business_types bt ON bt.id = a.business_type_id
    WHERE a.id=? AND v.id = (
      SELECT id FROM versions vv WHERE vv.asset_id=a.id ORDER BY vv.created_at DESC LIMIT 1
    )
    ORDER BY u.slide_no ASC LIMIT ?
  `).all(assetId, limit) as UnitRow[];
}

function speakerNotes(unitId: string): string {
  const rows = db().prepare(`SELECT text FROM chunks WHERE unit_id=? AND chunk_type='speaker_notes'`).all(unitId) as { text: string }[];
  return rows.map((r) => r.text).filter(Boolean).join('\n');
}

function assemble(row: UnitRow): UnitView {
  return assembleUnitView(row, speakerNotes(row.id));
}

// 空白/过渡/渲染缺失页对证据无价值（VLM 会在结论里自述），从证据中剔除；
// 封面页保留（对清单/方案类问题有用），故关键词不含「封面」。
const FILLER_PAGE_RE = /空白|过渡页|渲染缺失|占位|内容为空|无正文|完全空白|空页|无实质内容/;
function isFillerPage(view: UnitView): boolean {
  const blob = [view.conclusion, view.visual_summary, view.title, view.slide_type].map(textOf).join(' ');
  return FILLER_PAGE_RE.test(blob);
}

function evidenceText(hitText: string | null | undefined, view: UnitView): string {
  const parts: string[] = [];
  if (view.conclusion) parts.push(`页结论：${view.conclusion}`);
  if (hitText) parts.push(`命中片段：${hitText}`);
  if (view.key_facts?.length) parts.push(`关键事实：${view.key_facts.slice(0, 6).join('；')}`);
  if (view.numbers_with_units?.length) {
    parts.push(`关键数字：${view.numbers_with_units.slice(0, 6).map((n) => [n.metric, n.value, n.unit, n.context].filter(Boolean).join(' ')).join('；')}`);
  }
  if (view.architecture_nodes?.length) {
    parts.push(`架构节点：${view.architecture_nodes.slice(0, 8).map((n) => [n.name, n.role || n.source_text].filter(Boolean).join('-')).join('；')}`);
  }
  if (view.image_understanding) parts.push(`图片理解：${view.image_understanding}`);
  if (view.ocr_text_exact && !hitText?.includes(view.ocr_text_exact.slice(0, 30))) parts.push(`图中文字：${view.ocr_text_exact.slice(0, 1200)}`);
  if (view.raw_text && parts.join('\n').length < 500) parts.push(`原文：${view.raw_text.slice(0, 1200)}`);
  return parts.join('\n').slice(0, 2400);
}

function evidenceFromUnit(row: UnitRow, hit?: Partial<ChunkHit>, ordinal = 1): EvidenceCard {
  const view = assemble(row);
  const img = row.image_path && existsSync(row.image_path) ? row.image_path : row.image_path || null;
  return {
    evidence_id: `E${String(ordinal).padStart(2, '0')}`,
    asset_id: row.asset_id,
    version_id: row.version_id,
    unit_id: row.id,
    chunk_id: hit?.chunk_id,
    asset_title: row.asset_title,
    business_type: row.business_type_name,
    industry: industryOf(row),
    format: row.format,
    version: row.version,
    source_url: row.source_url,
    slide_no: row.slide_no,
    title: view.title || row.title || '',
    text: evidenceText(hit?.text, view),
    chunk_type: hit?.chunk_type || null,
    source_method: hit?.source_method || null,
    needs_review: !!(hit?.needs_review || row.needs_review),
    image_path: img,
    image_url: imageUrl(img),
    image_markdown: imageMarkdown(row.asset_title, row.slide_no, img),
    ocr_text_exact: view.ocr_text_exact,
    image_understanding: view.image_understanding,
    numbers_with_units: view.numbers_with_units,
    architecture_nodes: view.architecture_nodes,
  };
}

function rankUnitsForQuery(units: UnitRow[], query: string, intent: KnowledgeIntent): UnitRow[] {
  const terms = termsOf(query);
  return units.map((u) => {
    const view = assemble(u);
    const hay = [u.asset_title, view.title, view.conclusion, view.raw_text, view.ocr_text_exact, view.image_understanding, view.key_facts?.join(' ')].map(textOf).join(' ');
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score += 3;
    if (u.image_path) score += 2;
    if (view.conclusion || view.key_facts?.length) score += 3;
    if (intent === 'architecture' && view.architecture_nodes?.length) score += 12;
    if (intent === 'metric' && view.numbers_with_units?.length) score += 10;
    if (intent === 'case' && /案例|成效|项目|客户|移动|联通|电信/.test(hay)) score += 8;
    if (/封面|目录|章节|结尾/.test(view.slide_type)) score -= 4;
    if (isFillerPage(view)) score -= 40;
    return { u, score };
  }).sort((a, b) => b.score - a.score || a.u.slide_no - b.u.slide_no).map((x) => x.u);
}

function scoreAsset(row: AssetRow, query: string, terms: string[], hits: ChunkHit[]): number {
  const hay = [row.title, row.industry, row.industry_name, row.scenario, row.scenario_name, row.business_type_name, row.group_name, row.category, row.format].map(textOf).join(' ').toLowerCase();
  const title = textOf(row.title);
  const inferredIndustry = inferIndustry(query);
  const intent = detectIntent(query);
  const businessType = textOf(businessTypeOf(row));
  let score = 0;
  if (hay.includes(query.toLowerCase())) score += 10;
  for (const t of terms) if (hay.includes(t.toLowerCase())) score += 3;
  if (inferredIndustry && textOf(industryOf(row)).includes(inferredIndustry)) score += 16;
  if (/方案|解决方案|一页纸/.test(title)) score += 8;
  if (/客户案例|案例/.test(title)) score += 5;
  if (intent === 'case' && /客户案例|案例/.test(`${businessType} ${title}`)) score += 22;
  if (intent === 'case' && /方案|解决方案/.test(title) && !/案例/.test(`${businessType} ${title}`)) score -= 10;
  if (/报告|调查报告|标书标准|参考材料/.test(title) && /有哪些|清单|方案/.test(query)) score -= 8;
  score += Math.min(hits.length, 6) * 3;
  score += Math.min(hits.filter((h) => h.image_path).length, 3);
  return score;
}

export async function searchAssets(query: string, opts: { limit?: number; industry?: string; business_type?: string } = {}): Promise<AssetCard[]> {
  const limit = opts.limit ?? 10;
  const terms = termsOf(query);
  const { hits } = await search(query, Math.max(20, limit * 4));
  const hitsByAsset = new Map<string, ChunkHit[]>();
  for (const h of hits) {
    const list = hitsByAsset.get(h.asset_id) || [];
    list.push(h);
    hitsByAsset.set(h.asset_id, list);
  }

  const scoredCards = latestAssets().map((row) => {
    const assetHits = hitsByAsset.get(row.asset_id) || [];
    return { row, hits: assetHits, score: scoreAsset(row, query, terms, assetHits) };
  }).filter(({ row, score }) => {
    if (opts.industry) {
      const hay = [industryOf(row), row.title, row.category, row.scenario, row.scenario_name].map(textOf).join(' ');
      const alt = opts.industry === '运营商' && /移动|联通|电信|运营商|政企/.test(hay);
      if (!textOf(industryOf(row)).includes(opts.industry) && !alt) return false;
    }
    if (opts.business_type && !textOf(businessTypeOf(row)).includes(opts.business_type)) return false;
    return score > 0;
  }).sort((a, b) => b.score - a.score);

  const seenTitles = new Set<string>();
  const cards: typeof scoredCards = [];
  for (const c of scoredCards) {
    const titleKey = c.row.title.replace(/\s+/g, '').trim();
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    cards.push(c);
    if (cards.length >= limit) break;
  }

  return cards.map(({ row, hits: assetHits, score }) => ({
    asset_id: row.asset_id,
    title: row.title,
    business_type: businessTypeOf(row),
    industry: industryOf(row),
    scenario: row.scenario_name || row.scenario,
    category: row.category,
    format: row.format || 'ppt',
    source_url: row.source_url,
    version_id: row.version_id,
    version: row.version,
    pages: row.pages,
    evidence_count: assetHits.length,
    image_count: assetHits.filter((h) => h.image_path).length,
    matched_slides: [...new Set(assetHits.map((h) => h.slide_no))].sort((a, b) => a - b),
    score,
  }));
}

export function readAsset(assetIdOrTitle: string, opts: { include_units?: boolean; include_images?: boolean; limit?: number } = {}) {
  const key = assetIdOrTitle.trim();
  const asset = db().prepare(`
    SELECT a.id AS asset_id, a.title, a.industry, ind.name AS industry_name,
           a.scenario, sc.name AS scenario_name, bt.name AS business_type_name,
           a.group_name, a.category, COALESCE(a.format,'ppt') AS format,
           a.source_url, a.status, a.created_at,
           v.id AS version_id, v.version, v.pages
    FROM assets a
    LEFT JOIN versions v ON v.id = (
      SELECT id FROM versions vv WHERE vv.asset_id=a.id ORDER BY vv.created_at DESC LIMIT 1
    )
    LEFT JOIN industries ind ON ind.id = a.industry_id
    LEFT JOIN industry_scenarios sc ON sc.id = a.scenario_id
    LEFT JOIN business_types bt ON bt.id = a.business_type_id
    WHERE a.id=? OR a.title LIKE ?
    ORDER BY CASE WHEN a.id=? THEN 0 ELSE 1 END, a.created_at DESC LIMIT 1
  `).get(key, `%${key}%`, key) as AssetRow | undefined;
  if (!asset) return null;

  const units = opts.include_units && asset.version_id
    ? unitsByVersion(asset.version_id, opts.limit ?? 80).map((u, i) => evidenceFromUnit(u, undefined, i + 1))
    : [];
  const images = units.filter((u) => u.image_path).slice(0, opts.include_images === false ? 0 : 12);
  return {
    asset: {
      asset_id: asset.asset_id,
      title: asset.title,
      business_type: businessTypeOf(asset),
      industry: industryOf(asset),
      scenario: asset.scenario_name || asset.scenario,
      category: asset.category,
      format: asset.format || 'ppt',
      source_url: asset.source_url,
      version_id: asset.version_id,
      version: asset.version,
      pages: asset.pages,
      status: asset.status,
    },
    units,
    images,
  };
}

export function getUnitEvidence(input: { unit_id?: string; asset_id?: string; slide_no?: number }): EvidenceCard | null {
  const row = input.unit_id ? unitById(input.unit_id) : input.asset_id && input.slide_no ? unitByAssetSlide(input.asset_id, input.slide_no) : undefined;
  return row ? evidenceFromUnit(row, undefined, 1) : null;
}

function assetCardsFromEvidence(evidence: EvidenceCard[], searchedAssets: AssetCard[], maxAssets: number): AssetCard[] {
  const byId = new Map<string, AssetCard>();
  for (const a of searchedAssets) byId.set(a.asset_id, { ...a });
  for (const e of evidence) {
    const a = byId.get(e.asset_id) || {
      asset_id: e.asset_id,
      title: e.asset_title,
      business_type: e.business_type,
      industry: e.industry,
      format: e.format,
      source_url: e.source_url,
      version_id: e.version_id,
      version: e.version,
      pages: null,
      evidence_count: 0,
      image_count: 0,
      matched_slides: [],
      score: 0,
    };
    a.evidence_count += 1;
    if (e.image_path) a.image_count += 1;
    if (!a.matched_slides.includes(e.slide_no)) a.matched_slides.push(e.slide_no);
    a.score += 4;
    byId.set(e.asset_id, a);
  }
  return [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxAssets)
    .map((a) => ({ ...a, matched_slides: a.matched_slides.sort((x, y) => x - y) }));
}

function summaryFor(query: string, intent: KnowledgeIntent, assets: AssetCard[], evidence: EvidenceCard[]) {
  const confidence = evidence.length >= 8 ? 'high' : evidence.length >= 3 ? 'medium' : 'low';
  const topAssets = assets.slice(0, 5).map((a) => `《${a.title}》`).join('、');
  const direct = evidence.length === 0
    ? '当前知识库没有检索到足够证据，建议补充资料或换一个更具体的问题。'
    : intent === 'asset_list'
      ? `当前可优先参考 ${assets.length} 份资料：${topAssets}${assets.length > 5 ? '等' : ''}。`
      : intent === 'architecture'
        ? `当前检索到 ${evidence.length} 条架构/流程相关证据，主要来自 ${topAssets}。`
        : intent === 'case'
          ? `当前检索到 ${assets.length} 份可支撑案例或拜访准备的资料，主要包括 ${topAssets}。`
          : `当前问题可由 ${assets.length} 份资料、${evidence.length} 条页级证据支撑，核心来源为 ${topAssets}。`;
  return {
    direct_answer: direct,
    confidence: confidence as 'low' | 'medium' | 'high',
    coverage_note: `覆盖资产 ${assets.length} 份，页级证据 ${evidence.length} 条，图片证据 ${evidence.filter((e) => e.image_path).length} 条。`,
  };
}

function gapsFor(intent: KnowledgeIntent, evidence: EvidenceCard[]): string[] {
  const gaps: string[] = [];
  if (evidence.length === 0) gaps.push('未检索到可引用证据。');
  if (intent === 'architecture' && evidence.filter((e) => e.architecture_nodes?.length).length === 0) gaps.push('命中资料中暂未解析出明确架构节点，建议复核图片页或补充架构图资料。');
  if (intent === 'metric' && evidence.filter((e) => e.numbers_with_units?.length).length === 0) gaps.push('命中资料中暂未解析出结构化关键数字，回答时应避免编造指标。');
  if (evidence.some((e) => e.needs_review)) gaps.push('部分证据页标记为需人审，外发前建议运营或解决方案同事复核。');
  return gaps;
}

export async function buildFactPack(query: string, opts: FactPackOptions = {}): Promise<FactPack> {
  const t0 = Date.now();
  const mode = clampMode(opts.mode);
  const limits = MODE_LIMITS[mode];
  const intent = detectIntent(query);
  const inferredIndustry = opts.industry || inferIndustry(query);
  const filter = { ...(opts.filter || {}) } as MetadataFilter;
  if (opts.industry) filter.industry = opts.industry;
  if (opts.business_type) filter.group = opts.business_type;

  const searchedAssets = await searchAssets(query, { limit: opts.limit ?? limits.assets, industry: inferredIndustry, business_type: opts.business_type });
  const tAssets = Date.now();
  const { hits, debug } = await search(query, Math.max(limits.evidence, (opts.limit ?? limits.evidence)), filter);
  const tSearch = Date.now();
  const assetPriority = new Map(searchedAssets.map((a, i) => [a.asset_id, searchedAssets.length - i]));
  const orderedHits = [...hits].sort((a, b) => {
    const pa = assetPriority.get(a.asset_id) || 0;
    const pb = assetPriority.get(b.asset_id) || 0;
    if (pa !== pb) return pb - pa;
    if (intent === 'case') {
      const ca = /客户案例|案例/.test(`${a.group_name || ''} ${a.category || ''} ${a.asset_title || ''}`) ? 1 : 0;
      const cb = /客户案例|案例/.test(`${b.group_name || ''} ${b.category || ''} ${b.asset_title || ''}`) ? 1 : 0;
      if (ca !== cb) return cb - ca;
    }
    return (b.score || 0) - (a.score || 0);
  });
  const evidence: EvidenceCard[] = [];
  const seenUnit = new Set<string>();
  const primaryEvidenceLimit = intent === 'case'
    ? 0
    : intent === 'asset_list'
      ? Math.max(12, Math.floor(limits.evidence * 0.55))
    : limits.evidence;
  if (primaryEvidenceLimit > 0) {
    for (const h of orderedHits) {
      if (seenUnit.has(h.unit_id)) continue;
      const row = unitById(h.unit_id);
      if (!row) continue;
      seenUnit.add(h.unit_id);
      if (isFillerPage(assemble(row))) continue; // 跳过空白/过渡/渲染缺失页
      evidence.push(evidenceFromUnit(row, h, evidence.length + 1));
      if (evidence.length >= primaryEvidenceLimit) break;
    }
  }

  for (const a of searchedAssets.slice(0, Math.min(10, searchedAssets.length))) {
    if (evidence.length >= limits.evidence) break;
    const already = evidence.filter((e) => e.asset_id === a.asset_id).length;
    const targetPerAsset = intent === 'case' ? 2 : 1;
    if (already >= targetPerAsset) continue;
    const ranked = rankUnitsForQuery(unitsByAsset(a.asset_id, 80), query, intent);
    for (const u of ranked) {
      if (seenUnit.has(u.id)) continue;
      seenUnit.add(u.id);
      if (isFillerPage(assemble(u))) continue;
      evidence.push(evidenceFromUnit(u, undefined, evidence.length + 1));
      if (evidence.filter((e) => e.asset_id === a.asset_id).length >= targetPerAsset) break;
      if (evidence.length >= limits.evidence) break;
    }
  }

  if (evidence.length < limits.evidence) {
    for (const h of orderedHits) {
      if (seenUnit.has(h.unit_id)) continue;
      const row = unitById(h.unit_id);
      if (!row) continue;
      seenUnit.add(h.unit_id);
      if (isFillerPage(assemble(row))) continue;
      evidence.push(evidenceFromUnit(row, h, evidence.length + 1));
      if (evidence.length >= limits.evidence) break;
    }
  }
  const tEvidence = Date.now();

  const assets = assetCardsFromEvidence(evidence, searchedAssets, opts.limit ?? limits.assets);
  const imageLimit = opts.include_images === false ? 0 : limits.images;
  const imageEvidence = evidence.filter((e) => e.image_path).slice(0, imageLimit);
  const finalEvidence = opts.include_images === false ? evidence.map((e) => ({ ...e, image_markdown: null, image_url: null })) : evidence;
  const graph = opts.include_graph === false ? { nodes: [], edges: [] } : buildKnowledgeGraph({
    assets: assets.map((a) => ({ asset_id: a.asset_id, title: a.title, industry: a.industry, business_type: a.business_type, format: a.format })),
    evidence: finalEvidence.map((e) => ({
      evidence_id: e.evidence_id,
      asset_id: e.asset_id,
      unit_id: e.unit_id,
      slide_no: e.slide_no,
      title: e.title,
      image_path: e.image_path || undefined,
      numbers_with_units: e.numbers_with_units,
      architecture_nodes: e.architecture_nodes,
    })),
    maxEdges: limits.graphEdges,
  });
  const tGraph = Date.now();

  const summary = summaryFor(query, intent, assets, finalEvidence);
  return {
    query,
    intent,
    mode,
    summary,
    assets,
    evidence_cards: finalEvidence,
    graph,
    gaps: gapsFor(intent, finalEvidence),
    debug: {
      retrieval: debug,
      image_evidence_selected: imageEvidence.map((e) => e.evidence_id),
      searched_asset_count: searchedAssets.length,
      timings_ms: {
        search_assets: tAssets - t0,
        search: tSearch - tAssets,
        evidence: tEvidence - tSearch,
        graph: tGraph - tEvidence,
        total: tGraph - t0,
      },
    },
  };
}

export async function buildQuickFactPack(query: string, opts: FactPackOptions = {}): Promise<FactPack> {
  const t0 = Date.now();
  const mode = clampMode(opts.mode);
  const limits = MODE_LIMITS[mode === 'deep' ? 'standard' : mode];
  const intent = detectIntent(query);
  const filter = { ...(opts.filter || {}) } as MetadataFilter;
  if (opts.industry) filter.industry = opts.industry;
  if (opts.business_type) filter.group = opts.business_type;

  const { hits, debug } = await search(query, Math.max(limits.evidence, opts.limit ?? limits.evidence), filter, { rerank: false });
  const tSearch = Date.now();
  const evidence: EvidenceCard[] = [];
  const seenUnit = new Set<string>();
  for (const h of hits) {
    if (seenUnit.has(h.unit_id)) continue;
    const row = unitById(h.unit_id);
    if (!row) continue;
    seenUnit.add(h.unit_id);
    if (isFillerPage(assemble(row))) continue;
    evidence.push(evidenceFromUnit(row, h, evidence.length + 1));
    if (evidence.length >= limits.evidence) break;
  }
  const tEvidence = Date.now();

  const assets = assetCardsFromEvidence(evidence, [], opts.limit ?? limits.assets);
  const finalEvidence = opts.include_images === false
    ? evidence.map((e) => ({ ...e, image_markdown: null, image_url: null }))
    : evidence;
  const graph = opts.include_graph === false ? { nodes: [], edges: [] } : buildKnowledgeGraph({
    assets: assets.map((a) => ({ asset_id: a.asset_id, title: a.title, industry: a.industry, business_type: a.business_type, format: a.format })),
    evidence: finalEvidence.map((e) => ({
      evidence_id: e.evidence_id,
      asset_id: e.asset_id,
      unit_id: e.unit_id,
      slide_no: e.slide_no,
      title: e.title,
      image_path: e.image_path || undefined,
      numbers_with_units: e.numbers_with_units,
      architecture_nodes: e.architecture_nodes,
    })),
    maxEdges: limits.graphEdges,
  });
  const tGraph = Date.now();
  const summary = summaryFor(query, intent, assets, finalEvidence);
  return {
    query,
    intent,
    mode: mode === 'deep' ? 'standard' : mode,
    summary,
    assets,
    evidence_cards: finalEvidence,
    graph,
    gaps: gapsFor(intent, finalEvidence),
    debug: {
      retrieval: debug,
      quick: true,
      image_evidence_selected: [],
      searched_asset_count: 0,
      timings_ms: {
        search_assets: 0,
        search: tSearch - t0,
        evidence: tEvidence - tSearch,
        graph: tGraph - tEvidence,
        total: tGraph - t0,
      },
    },
  };
}

function clip(s: string, n: number): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}...` : t;
}

function compactEvidence(e: EvidenceCard, textLimit = 900, includeImages = true) {
  return {
    evidence_id: e.evidence_id,
    asset_id: e.asset_id,
    unit_id: e.unit_id,
    asset_title: e.asset_title,
    slide_no: e.slide_no,
    title: e.title,
    text: clip(e.text, textLimit),
    source: `《${e.asset_title}》第${e.slide_no}页${e.title ? ` · ${e.title}` : ''}`,
    image_path: includeImages ? e.image_path : null,
    image_url: includeImages ? e.image_url : null,
    image_markdown: includeImages ? e.image_markdown : null,
    numbers_with_units: e.numbers_with_units?.slice(0, 5),
    architecture_nodes: e.architecture_nodes?.slice(0, 6),
    needs_review: e.needs_review,
  };
}

function compactAssetReadResult(result: ReturnType<typeof readAsset>, textLimit: number, includeImages: boolean) {
  if (!result) return null;
  const units = result.units.map((u) => compactEvidence(u, textLimit, includeImages));
  return {
    asset: result.asset,
    units,
    images: includeImages
      ? result.images.slice(0, 6).map((u) => ({
        source: `《${u.asset_title}》第${u.slide_no}页${u.title ? ` · ${u.title}` : ''}`,
        image_path: u.image_path,
        image_markdown: u.image_markdown,
      }))
      : [],
    stats: {
      original_units: result.units.length,
      returned_units: units.length,
      compressed: true,
    },
  };
}

function defaultMaterialSections(outputType: MaterialPackOptions['output_type'], query: string): string[] {
  if (outputType === 'ppt') return ['客户痛点与项目背景', '建设目标与方案架构', '核心能力与实施路径', '量化成效与客户价值', '案例与来源'];
  if (outputType === 'web') return ['客户痛点', '解决方案', '应用场景', '实施路径', '量化成效', '客户价值'];
  if (outputType === 'word') return ['项目背景', '现状与痛点', '建设方案', '应用场景', '实施路径', '指标与成效', '风险与建议'];
  if (/书面|Word|word|文档|材料/.test(query)) return defaultMaterialSections('word', query);
  if (/网页|HTML|html|页面/.test(query)) return defaultMaterialSections('web', query);
  if (/PPT|ppt|汇报/.test(query)) return defaultMaterialSections('ppt', query);
  return ['背景', '痛点', '方案', '场景', '成效', '来源'];
}

function scoreEvidenceForSection(section: string, e: EvidenceCard): number {
  const hay = [e.asset_title, e.title, e.text, e.numbers_with_units?.map((n) => [n.metric, n.context].join(' ')).join(' ')].map(textOf).join(' ');
  const terms = termsOf(section);
  let score = 0;
  for (const t of terms) if (hay.includes(t)) score += 5;
  if (/痛点|问题|现状/.test(section) && /痛点|问题|现状|不足|挑战|需求/.test(hay)) score += 8;
  if (/方案|架构|建设/.test(section) && /方案|架构|能力|平台|流程|建设/.test(hay)) score += 8;
  if (/场景|应用/.test(section) && /场景|应用|业务|质检|外呼|反诈|客服/.test(hay)) score += 8;
  if (/路径|实施|落地/.test(section) && /实施|落地|路径|步骤|流程|阶段/.test(hay)) score += 8;
  if (/指标|成效|价值|量化/.test(section) && (e.numbers_with_units?.length || /提升|降低|准确率|效率|成本|满意度|成效|价值/.test(hay))) score += 10;
  if (/案例|来源/.test(section) && /案例|客户|项目|来源/.test(hay)) score += 8;
  if (e.image_path) score += 2;
  return score;
}

export function readEvidenceBatch(opts: {
  assets?: AssetRef[];
  units?: EvidenceRef[];
  include_units?: boolean;
  include_images?: boolean;
  asset_limit?: number;
  unit_limit?: number;
  text_limit?: number;
}) {
  const assetLimit = Math.max(0, Math.min(opts.asset_limit ?? 8, 20));
  const unitLimit = Math.max(0, Math.min(opts.unit_limit ?? 24, 80));
  const textLimit = Math.max(120, Math.min(opts.text_limit ?? 900, 2400));
  const includeImages = opts.include_images !== false;
  const assets = (opts.assets || []).slice(0, assetLimit).map((a) => {
    const key = String(a.asset_id || a.title || '').trim();
    if (!key) return null;
    const result = readAsset(key, {
      include_units: !!opts.include_units,
      include_images: includeImages,
      limit: Math.max(1, Math.min(a.limit ?? 12, 40)),
    });
    return compactAssetReadResult(result, textLimit, includeImages);
  }).filter(Boolean);

  const units = (opts.units || []).slice(0, unitLimit).map((u, i) => {
    const ev = getUnitEvidence({
      unit_id: u.unit_id,
      asset_id: u.asset_id,
      slide_no: u.slide_no,
    });
    return ev ? compactEvidence({ ...ev, evidence_id: `B${String(i + 1).padStart(2, '0')}` }, textLimit, includeImages) : null;
  }).filter(Boolean);

  return {
    assets,
    units,
    stats: {
      requested_assets: opts.assets?.length || 0,
      returned_assets: assets.length,
      requested_units: opts.units?.length || 0,
      returned_units: units.length,
      note: '批量读取结果已压缩，适合一次性补充多份资产/多页证据，避免循环调用 read_asset/get_unit。',
    },
  };
}

export async function buildMaterialPack(query: string, opts: MaterialPackOptions = {}) {
  const outputType = opts.output_type || 'generic';
  const evidencePerSection = Math.max(1, Math.min(opts.evidence_per_section ?? 4, 8));
  const pack = await buildFactPack(query, {
    mode: 'deep',
    include_images: opts.include_images !== false,
    include_graph: opts.include_graph ?? false,
    limit: Math.max(8, Math.min(opts.limit ?? 16, 32)),
  });
  const sectionTitles = (opts.sections?.length ? opts.sections : defaultMaterialSections(outputType, query)).slice(0, 10);
  const used = new Set<string>();
  const compactAll = pack.evidence_cards.map((e) => compactEvidence(e, 760));
  const sections = sectionTitles.map((title, idx) => {
    const ranked = pack.evidence_cards
      .map((e) => ({ e, score: scoreEvidenceForSection(title, e) }))
      .sort((a, b) => b.score - a.score || a.e.slide_no - b.e.slide_no);
    const picked: EvidenceCard[] = [];
    for (const r of ranked) {
      if (picked.length >= evidencePerSection) break;
      if (r.score <= 0 && picked.length > 0) continue;
      if (used.has(r.e.unit_id) && picked.length < Math.ceil(evidencePerSection / 2)) continue;
      picked.push(r.e);
      used.add(r.e.unit_id);
    }
    if (!picked.length && pack.evidence_cards[idx]) picked.push(pack.evidence_cards[idx]);
    const evidence = picked.map((e) => compactEvidence(e, 760));
    return {
      section_id: `S${String(idx + 1).padStart(2, '0')}`,
      title,
      writing_goal: `${title}：面向客户/项目材料直接成文，避免写成内部检索说明。`,
      key_points: evidence.flatMap((e) => [e.text]).slice(0, evidencePerSection),
      evidence,
      citations: evidence.map((e) => e.source),
      image_candidates: evidence.filter((e) => e.image_path).slice(0, 2).map((e) => ({
        source: e.source,
        image_path: e.image_path,
        image_markdown: e.image_markdown,
      })),
    };
  });
  return {
    query,
    output_type: outputType,
    usage_policy: [
      '本工具已经完成资料检索、资产读取和页级证据压缩；后续不要再重复调用 get_fact_pack/read_asset/get_unit，除非用户明确要求补某一页。',
      '生成 Word/PPT/网页时直接按 sections 写作，并在段落末尾引用 citations。',
      '不要把本工具返回的调试字段写给客户；只使用 key_points/evidence/citations/image_candidates。',
    ],
    summary: pack.summary,
    assets: pack.assets.slice(0, opts.limit ?? 16),
    sections,
    evidence_cards: compactAll,
    gaps: pack.gaps,
    debug: {
      source_pack: pack.debug,
      original_evidence_count: pack.evidence_cards.length,
      returned_sections: sections.length,
    },
  };
}

export function answerFromFactPack(pack: FactPack, opts: { include_images?: boolean; image_limit?: number } = {}): string {
  if (pack.evidence_cards.length === 0) return `${pack.summary.direct_answer}\n\n来源：无可用来源。`;
  const imageLimit = opts.include_images === false ? 0 : opts.image_limit ?? (pack.mode === 'deep' ? 3 : pack.mode === 'standard' ? 2 : 1);
  const images = pack.evidence_cards.filter((e) => e.image_markdown).slice(0, imageLimit);
  const lines: string[] = [];
  lines.push(`## 直接结论`);
  lines.push(pack.summary.direct_answer);
  lines.push('');
  lines.push(`## 资料与方案线索`);
  for (const [i, a] of pack.assets.slice(0, pack.mode === 'deep' ? 12 : 8).entries()) {
    const meta = [a.industry, a.business_type, a.category, a.format].filter(Boolean).join(' / ');
    const slides = a.matched_slides.length ? `，命中第 ${a.matched_slides.slice(0, 8).join('、')} 页` : '';
    lines.push(`${i + 1}. 《${a.title}》${meta ? `（${meta}）` : ''}${slides}。`);
  }
  lines.push('');
  lines.push(`## 关键证据`);
  for (const e of pack.evidence_cards.slice(0, pack.mode === 'deep' ? 12 : 8)) {
    lines.push(`- [${e.evidence_id}] 《${e.asset_title}》第${e.slide_no}页${e.title ? ` · ${e.title}` : ''}：${clip(e.text, 360)}`);
    if (e.numbers_with_units?.length) {
      lines.push(`  关键数字：${e.numbers_with_units.slice(0, 4).map((n) => [n.metric, n.value, n.unit, n.context].filter(Boolean).join(' ')).join('；')}`);
    }
    if (e.architecture_nodes?.length) {
      lines.push(`  架构节点：${e.architecture_nodes.slice(0, 5).map((n) => [n.name, n.role || n.source_text].filter(Boolean).join('-')).join('；')}`);
    }
  }
  if (images.length) {
    lines.push('');
    lines.push(`## 图片证据`);
    for (const e of images) {
      lines.push(`- [${e.evidence_id}] 《${e.asset_title}》第${e.slide_no}页${e.title ? ` · ${e.title}` : ''}`);
      lines.push(e.image_markdown!);
    }
  }
  if (pack.graph.edges.length) {
    lines.push('');
    lines.push(`## 知识图谱关系`);
    for (const edge of pack.graph.edges.slice(0, pack.mode === 'deep' ? 12 : 8)) {
      const source = pack.graph.nodes.find((n) => n.id === edge.source)?.label || edge.source;
      const target = pack.graph.nodes.find((n) => n.id === edge.target)?.label || edge.target;
      lines.push(`- ${source} --${edge.type}--> ${target}${edge.evidence_id ? `（${edge.evidence_id}）` : ''}`);
    }
  }
  if (pack.gaps.length) {
    lines.push('');
    lines.push(`## 缺口与风险`);
    for (const g of pack.gaps) lines.push(`- ${g}`);
  }
  lines.push('');
  lines.push(`## 来源`);
  for (const e of pack.evidence_cards.slice(0, 20)) {
    lines.push(`- [${e.evidence_id}] 《${e.asset_title}》第${e.slide_no}页${e.title ? ` · ${e.title}` : ''}${e.version ? ` · ${e.version}` : ''}`);
  }
  return lines.join('\n');
}

export const FACT_PACK_LIMITS = MODE_LIMITS;
