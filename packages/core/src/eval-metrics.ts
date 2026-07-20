// 检索级评测指标（纯函数，PRD-0005 §8）。relevant 为该问题的相关条目集合。
// 条目标识可用 asset 标题关键词 / asset_id / unit 等，由调用方统一映射。

function relevantSet(relevant: Iterable<string>): Set<string> {
  return relevant instanceof Set ? relevant : new Set(relevant);
}

/** recall@k = |前 k 个命中 ∩ 相关集| / |相关集|；相关集为空返回 0（不除零）。 */
export function recallAtK(retrieved: string[], relevant: Iterable<string>, k: number): number {
  const rel = relevantSet(relevant);
  if (rel.size === 0) return 0;
  const topk = retrieved.slice(0, k);
  let hit = 0;
  for (const id of rel) if (topk.includes(id)) hit++;
  return hit / rel.size;
}

/** MRR 的单条贡献：1 / 首个相关项排名（1-based）；无命中为 0。 */
export function reciprocalRank(retrieved: string[], relevant: Iterable<string>): number {
  const rel = relevantSet(relevant);
  for (let i = 0; i < retrieved.length; i++) {
    if (rel.has(retrieved[i])) return 1 / (i + 1);
  }
  return 0;
}

/** nDCG@k（二元相关性）：DCG = Σ rel_i / log2(i+2)（i 从 0 起，对应排名 1..k）；IDCG 为理想排序。 */
export function ndcgAtK(retrieved: string[], relevant: Iterable<string>, k: number): number {
  const rel = relevantSet(relevant);
  if (rel.size === 0) return 0;
  let dcg = 0;
  const topk = retrieved.slice(0, k);
  for (let i = 0; i < topk.length; i++) {
    if (rel.has(topk[i])) dcg += 1 / Math.log2(i + 2);
  }
  const ideal = Math.min(rel.size, k);
  let idcg = 0;
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

/** 聚合一组单题指标为均值汇总。 */
export function aggregate(rows: { recall5: number; recall10: number; rr: number; ndcg10: number }[]): {
  n: number; recall5: number; recall10: number; mrr: number; ndcg10: number;
} {
  const n = rows.length || 1;
  const sum = (f: (r: any) => number) => rows.reduce((a, r) => a + f(r), 0) / n;
  return {
    n: rows.length,
    recall5: sum((r) => r.recall5), recall10: sum((r) => r.recall10),
    mrr: sum((r) => r.rr), ndcg10: sum((r) => r.ndcg10),
  };
}
