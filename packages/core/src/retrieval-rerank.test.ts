import { test } from 'node:test';
import assert from 'node:assert/strict';

// 在 import 前把 python 指向无效路径：rerank.py 调用立即 ENOENT 失败 → 走降级（不会下载模型）
process.env.SP_PYTHON = '/nonexistent/python-xyz';
const { rerankHits } = await import('./retrieval.ts');

test('rerankHits 降级：reranker 不可用时保持原序返回', async () => {
  const hits = [
    { chunk_id: 'c1', text: '甲', unit_id: 'u1' },
    { chunk_id: 'c2', text: '乙', unit_id: 'u2' },
    { chunk_id: 'c3', text: '丙', unit_id: 'u3' },
  ] as any;
  const out = await rerankHits('问题', hits);
  assert.deepEqual(out.map((h: any) => h.chunk_id), ['c1', 'c2', 'c3']);
});

test('rerankHits 守卫：空/单条直接返回', async () => {
  assert.equal((await rerankHits('q', [])).length, 0);
  const one = [{ chunk_id: 'c1', text: 'x' }] as any;
  assert.deepEqual(await rerankHits('q', one), one);
});
