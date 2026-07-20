import { db, ftsSearch } from './db.ts';

// 顶部全局搜索（PRD-0028）：轻量、同步、无 embed/rerank——
// 素材走标题 LIKE，知识片段优先 trigram FTS（中文 3 字滑窗），
// 短词（2 字中文是 trigram 盲区）降级 chunks.text LIKE 直查。

export type GlobalAssetHit = {
  id: string;
  title: string;
  format: string | null;
  business_type_name: string | null;
  industry_name: string | null;
};

export type GlobalChunkHit = {
  asset_id: string;
  asset_title: string;
  slide_no: number;
  business_type_name: string | null;
  snippet: string;
};

/** 中文 3 字滑窗 + 英文/数字整词，构造 FTS MATCH 串（轻量版，无术语扩展）。 */
function buildMatch(q: string): string {
  const terms: string[] = [];
  for (const m of q.match(/[A-Za-z0-9][A-Za-z0-9._-]{1,}/g) || []) terms.push(`"${m}"`);
  for (const run of q.match(/[一-龥]{3,}/g) || []) {
    for (let i = 0; i + 3 <= run.length; i++) terms.push(`"${run.slice(i, i + 3)}"`);
  }
  return terms.slice(0, 30).join(' OR ');
}

/** 命中词前后各 ~50 字的片段；找不到命中位置就取开头。 */
function makeSnippet(text: string, q: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const key = q.trim();
  let at = t.indexOf(key);
  if (at < 0 && key.length >= 3) {
    for (let i = 0; i + 3 <= key.length && at < 0; i++) at = t.indexOf(key.slice(i, i + 3));
  }
  if (at < 0) return t.slice(0, 100) + (t.length > 100 ? '…' : '');
  const start = Math.max(0, at - 50);
  const end = Math.min(t.length, at + key.length + 50);
  return (start > 0 ? '…' : '') + t.slice(start, end) + (end < t.length ? '…' : '');
}

export function globalSearch(q: string): { assets: GlobalAssetHit[]; chunks: GlobalChunkHit[] } {
  const key = q.trim();
  if (key.length < 2) return { assets: [], chunks: [] };
  const like = `%${key}%`;

  // 素材：标题模糊；bt 名缺失（存量未归类）兜底 group_name，供前端跳分类用
  const assets = db().prepare(`
    SELECT a.id, a.title, a.format,
           COALESCE(bt.name, a.group_name) AS business_type_name,
           i.name AS industry_name
    FROM assets a
    LEFT JOIN business_types bt ON bt.id = a.business_type_id
    LEFT JOIN industries i ON i.id = a.industry_id
    WHERE a.title LIKE ?
    ORDER BY a.sort_order ASC, a.created_at DESC
    LIMIT 20
  `).all(like) as unknown as GlobalAssetHit[];

  // 知识片段：FTS 优先，无结果（短词/盲区）降级 LIKE 直查
  const match = buildMatch(key);
  let rawHits: { asset_id: string; asset_title: string; slide_no: number; text: string }[] =
    match ? (ftsSearch(match, 12) as any[]) : [];
  if (!rawHits.length) {
    rawHits = db().prepare(`
      SELECT a.id AS asset_id, a.title AS asset_title, u.slide_no AS slide_no, c.text AS text
      FROM chunks c
      JOIN units u ON u.id = c.unit_id
      JOIN versions v ON v.id = u.version_id
      JOIN assets a ON a.id = v.asset_id
      WHERE c.text LIKE ?
      LIMIT 10
    `).all(like) as unknown as typeof rawHits;
  }

  // 按 素材+页 去重，并补每个命中素材的知识类型名（跳转需要）
  const ids = [...new Set(rawHits.map((h) => h.asset_id))];
  const btMap = new Map<string, string | null>();
  if (ids.length) {
    const rows = db().prepare(`
      SELECT a.id, COALESCE(bt.name, a.group_name) AS bt
      FROM assets a LEFT JOIN business_types bt ON bt.id = a.business_type_id
      WHERE a.id IN (${ids.map(() => '?').join(',')})
    `).all(...ids) as unknown as { id: string; bt: string | null }[];
    for (const r of rows) btMap.set(r.id, r.bt);
  }
  const seen = new Set<string>();
  const chunks: GlobalChunkHit[] = [];
  for (const h of rawHits) {
    const k = `${h.asset_id}#${h.slide_no}`;
    if (seen.has(k)) continue;
    seen.add(k);
    chunks.push({
      asset_id: h.asset_id,
      asset_title: h.asset_title,
      slide_no: h.slide_no,
      business_type_name: btMap.get(h.asset_id) ?? null,
      snippet: makeSnippet(h.text, key),
    });
  }
  return { assets, chunks };
}
