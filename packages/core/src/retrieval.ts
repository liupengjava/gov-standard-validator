import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PYTHON, EMBED_PY, RERANK_PY, MODEL_ANSWER, ROOT } from './config.ts';
import { callClaude } from './ai-cli.ts';
import { ftsSearch, allEmbeddedChunks, hydrateChunks, vecAvailable, vecSearch } from './db.ts';
import type { ChunkHit } from './db.ts';

const pexec = promisify(execFile);

/** 把自然语言问题转成 trigram FTS MATCH 串。
 * trigram 对 2 字中文词/整句短语都匹配不到，这里改成：英文/数字按词，中文按 3 字滑窗，OR 连接，
 * 让无 embedding 时也能基于子串召回。 */
function buildFtsMatch(query: string, extraTerms: string[] = []): string {
  const terms = new Set<string>();
  const addZh = (s: string) => {
    if (s.length <= 3) { if (s.length >= 3) terms.add(s); return; }
    for (let i = 0; i + 3 <= s.length; i++) terms.add(s.slice(i, i + 3));
  };
  const harvest = (text: string) => {
    // 英文/数字词（产品名、BOTID、AI 等），>=2 即保留
    for (const m of text.matchAll(/[A-Za-z0-9][A-Za-z0-9._-]{1,}/g)) terms.add(m[0]);
    // 中文连续片段 -> 3 字滑窗
    for (const m of text.matchAll(/[一-龥]{2,}/g)) addZh(m[0]);
  };
  harvest(query);
  for (const t of extraTerms) harvest(t); // 术语词典扩展（同义词/缩写）
  const list = [...terms].slice(0, 60).map((t) => `"${t.replace(/"/g, '')}"`);
  return list.join(' OR ');
}

// ---- 术语词典与查询改写（PRD-0005 §7）----
export type TermDictEntry = { canonical: string; aliases?: string[] };

let _termDict: TermDictEntry[] | null = null;
function loadTermDict(): TermDictEntry[] {
  if (_termDict) return _termDict;
  // 优先级：SP_TERM_DICT 覆盖 > data/ 运行期可改副本 > 仓库内可跟踪默认
  const candidates = [
    process.env.SP_TERM_DICT,
    join(ROOT, 'data', 'term-dictionary.json'),
    join(ROOT, 'packages', 'core', 'term-dictionary.default.json'),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    try { if (existsSync(p)) { _termDict = JSON.parse(readFileSync(p, 'utf-8')); return _termDict!; } }
    catch { /* 下一个候选 */ }
  }
  _termDict = [];
  return _termDict;
}

/** 命中词典中任一规范词/别名时，补全同组其它写法（已在 query 中的不重复返回）。纯函数，便于测试。 */
export function buildTermExpansions(query: string, dict: TermDictEntry[]): string[] {
  const q = query || '';
  const extras = new Set<string>();
  for (const e of (dict || [])) {
    const group = [e.canonical, ...(e.aliases || [])].filter(Boolean);
    if (!group.some((t) => q.includes(t))) continue;
    for (const t of group) if (!q.includes(t)) extras.add(t);
  }
  return [...extras];
}

// ---- 元数据过滤（PRD-0005 §6.3）----
export type MetadataFilter = {
  industry?: string; group?: string; category?: string; format?: string; status?: string;
};

/** 按元数据维度过滤命中片段（空过滤=全留）。纯函数。 */
export function filterByMetadata(hits: ChunkHit[], filter?: MetadataFilter): ChunkHit[] {
  if (!filter || Object.keys(filter).length === 0) return hits;
  return hits.filter((h: any) =>
    (!filter.industry || h.industry === filter.industry) &&
    (!filter.group || h.group_name === filter.group || h.group === filter.group) &&
    (!filter.category || h.category === filter.category) &&
    (!filter.format || h.format === filter.format) &&
    (!filter.status || h.status === filter.status));
}

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  try {
    const dir = mkdtempSync(join(tmpdir(), 'sp-embed-'));
    const inFile = join(dir, 'in.json');
    const outFile = join(dir, 'out.json');
    writeFileSync(inFile, JSON.stringify(texts));
    // 超时可经 SP_EMBED_TIMEOUT 调大（批量迁移整库时一次喂全部文本，单次加载模型）
    const timeout = Number(process.env.SP_EMBED_TIMEOUT || 300000);
    await pexec(PYTHON, [EMBED_PY, '--infile', inFile, '--outfile', outFile], { timeout, maxBuffer: 256 * 1024 * 1024 });
    return JSON.parse(readFileSync(outFile, 'utf-8'));
  } catch {
    return null; // 无 embedding 环境时优雅降级为仅 FTS
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

/** sqlite-vec KNN 路径：命中则按距离升序返回；vec 表为空(未迁移)返回空，由调用方落 JSON 路径。 */
function vectorSearchVec(qv: number[], k: number): ChunkHit[] {
  const rows = vecSearch(qv, k);
  if (rows.length === 0) return [];
  const hits = hydrateChunks(rows.map((r) => r.chunk_id));
  const order = new Map(rows.map((r, i) => [r.chunk_id, i]));
  const distMap = new Map(rows.map((r) => [r.chunk_id, r.distance]));
  hits.forEach((h) => { h.score = -(distMap.get(h.chunk_id) ?? 0); }); // 距离越小越相似 → 负距离作分
  hits.sort((a, b) => (order.get(a.chunk_id)! - order.get(b.chunk_id)!));
  return hits;
}

async function vectorSearch(query: string, k: number): Promise<ChunkHit[]> {
  const qv = await embedTexts([query]);
  if (!qv || !qv[0]) return [];
  // 优先 sqlite-vec KNN；vec 表已填充时直接用，否则落回 JSON 暴力余弦（迁移过渡期）
  if (vecAvailable()) {
    const viaVec = vectorSearchVec(qv[0], k);
    if (viaVec.length > 0) return viaVec;
  }
  const dim = qv[0].length;
  const rows = allEmbeddedChunks();
  if (rows.length === 0) return [];
  // 换 embedding 模型（512→1024）后、全量重灌前：跳过维度不匹配的旧向量，避免 NaN 打分污染排序，
  // 自然降级到 FTS。重灌完成后所有向量同维，正常生效。
  const scored: { id: string; s: number }[] = [];
  for (const r of rows) {
    const v = JSON.parse(r.embedding) as number[];
    if (v.length !== dim) continue;
    scored.push({ id: r.chunk_id, s: cosine(qv[0], v) });
  }
  if (scored.length === 0) return [];
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, k);
  const hits = hydrateChunks(top.map((t) => t.id));
  const order = new Map(top.map((t, i) => [t.id, i]));
  const scoreMap = new Map(top.map((t) => [t.id, t.s]));
  hits.forEach((h) => { h.score = scoreMap.get(h.chunk_id); });
  hits.sort((a, b) => (order.get(a.chunk_id)! - order.get(b.chunk_id)!));
  return hits;
}

/** Reciprocal Rank Fusion 融合多路召回。 */
function rrf(lists: ChunkHit[][], k: number): ChunkHit[] {
  const C = 60;
  const score = new Map<string, number>();
  const byId = new Map<string, ChunkHit>();
  for (const list of lists) {
    list.forEach((h, rank) => {
      score.set(h.chunk_id, (score.get(h.chunk_id) || 0) + 1 / (C + rank));
      byId.set(h.chunk_id, h);
    });
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id, s]) => ({ ...byId.get(id)!, score: s }));
}

/** small-to-big 聚合：同一 parent(整页) 只保留排名最高的 child 片段，保证引用多样性。
 * parent_unit_id 缺省回退 unit_id。纯函数。 */
export function aggregateByParent(hits: ChunkHit[], k: number): ChunkHit[] {
  const seen = new Set<string>();
  const out: ChunkHit[] = [];
  for (const h of hits) {
    const key = (h as any).parent_unit_id || h.unit_id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= k) break;
  }
  return out;
}

export type AnswerResult = {
  refused: boolean;
  answer: string;
  citations: ChunkHit[];
  debug: { ftsMatch: string; ftsCount: number; vecCount: number; mergedCount: number };
};

// 召回候选池大小（重排前），可经 SP_RERANK_POOL 调（PRD-0005 §6.1）
const RECALL_POOL = Number(process.env.SP_RERANK_POOL || 60);

/** cross-encoder 重排：调 rerank.py 对候选打分并按分降序。reranker 不可用时原样返回（降级）。 */
export async function rerankHits(query: string, hits: ChunkHit[]): Promise<ChunkHit[]> {
  if (hits.length <= 1) return hits;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'sp-rerank-'));
    const inFile = join(dir, 'in.json');
    const outFile = join(dir, 'out.json');
    writeFileSync(inFile, JSON.stringify({ query, candidates: hits.map((h) => h.text) }));
    await pexec(PYTHON, [RERANK_PY, '--infile', inFile, '--outfile', outFile], { timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    const scores = JSON.parse(readFileSync(outFile, 'utf-8')) as number[];
    if (!Array.isArray(scores) || scores.length !== hits.length) return hits;
    return hits
      .map((h, i) => ({ ...h, score: scores[i] }))
      .sort((a, b) => (b.score! - a.score!));
  } catch {
    return hits; // 降级：reranker 不可用则保持融合排序
  }
}

/** 多路召回 + 术语扩展 + 融合 + 元数据过滤，返回候选池（未做 small-to-big 聚合）。 */
async function recall(query: string, filter?: MetadataFilter): Promise<{ ftsMatch: string; fts: ChunkHit[]; vec: ChunkHit[]; pool: ChunkHit[] }> {
  const expansions = buildTermExpansions(query, loadTermDict());
  const ftsMatch = buildFtsMatch(query, expansions);
  const half = Math.max(12, Math.ceil(RECALL_POOL / 2));
  const fts = ftsMatch ? ftsSearch(ftsMatch, half) : [];
  const vec = await vectorSearch(query, half);
  const pool = filterByMetadata(rrf([fts, vec], RECALL_POOL), filter);
  return { ftsMatch, fts, vec, pool };
}

export async function search(query: string, k = 10, filter?: MetadataFilter, opts: { rerank?: boolean } = {}): Promise<{ hits: ChunkHit[]; debug: any }> {
  const t0 = Date.now();
  const { ftsMatch, fts, vec, pool } = await recall(query, filter);
  const tRecall = Date.now();
  const reranked = opts.rerank === false ? pool : await rerankHits(query, pool);     // 不可用则原样
  const tRerank = Date.now();
  const hits = aggregateByParent(reranked, k);        // small-to-big 聚合到页
  const tDone = Date.now();
  return {
    hits,
    debug: {
      ftsMatch,
      ftsCount: fts.length,
      vecCount: vec.length,
      poolCount: pool.length,
      mergedCount: hits.length,
      rerankEnabled: opts.rerank !== false,
      timings_ms: {
        recall: tRecall - t0,
        rerank: tRerank - tRecall,
        aggregate: tDone - tRerank,
        total: tDone - t0,
      },
    },
  };
}

/** 检索调试：返回各路召回明细 + 融合结果 + 分数，供运营在控制台调效果。 */
export async function searchDebug(query: string, k = 10, filter?: MetadataFilter): Promise<{
  ftsMatch: string; fts: ChunkHit[]; vec: ChunkHit[]; merged: ChunkHit[]; embeddingActive: boolean;
}> {
  const { ftsMatch, fts, vec, pool } = await recall(query, filter);
  const reranked = await rerankHits(query, pool);
  const merged = aggregateByParent(reranked, k);
  return { ftsMatch, fts, vec, merged, embeddingActive: vec.length > 0 };
}

export async function answer(query: string, opts: { model?: string } = {}): Promise<AnswerResult> {
  const { hits, debug } = await search(query, 8);
  if (hits.length === 0) {
    return {
      refused: true,
      answer: '在当前知识库中没有检索到可支撑的依据，无法回答这个问题。建议补充相关资料或换个问法。',
      citations: [],
      debug,
    };
  }
  const ctx = hits
    .map((h, i) => `[${i + 1}] 《${h.asset_title}》第 ${h.slide_no} 页${h.title ? '·' + h.title : ''}\n${h.text}`)
    .join('\n\n');
  const prompt =
    `你是百应销售解决方案助理。只能依据下面给出的"资料片段"回答问题，不得编造、不得使用资料之外的常识性补充。` +
    `若资料不足以支撑结论，请明确说明无法确定。\n\n` +
    `问题：${query}\n\n资料片段：\n${ctx}\n\n` +
    `请用中文按如下结构回答：\n1) 直接结论\n2) 要点 / 方案 / 架构\n3) 说明：在每条关键信息后用 [序号] 标注其来源片段。\n` +
    `专业、简洁、准确。`;
  const r = await callClaude(prompt, { model: opts.model || MODEL_ANSWER });
  return { refused: false, answer: r.text, citations: hits, debug };
}
