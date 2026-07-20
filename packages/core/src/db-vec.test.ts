import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 临时库 + 小维度（4）便于构造测试向量；须在 import db 前设置
process.env.SP_DB = join(mkdtempSync(join(tmpdir(), 'sp-vec-')), 't.db');
process.env.SP_EMBED_DIM = '4';
const { vecAvailable, upsertVec, vecSearch } = await import('./db.ts');

test('sqlite-vec KNN：最近邻顺序正确（不可用则跳过）', () => {
  if (!vecAvailable()) { console.log('  (sqlite-vec 不可用，跳过)'); return; }
  upsertVec('a', [1, 0, 0, 0]);
  upsertVec('b', [0, 1, 0, 0]);
  upsertVec('c', [0.9, 0.1, 0, 0]);
  const r = vecSearch([1, 0, 0, 0], 2);
  assert.deepEqual(r.map((x) => x.chunk_id), ['a', 'c']);
  assert.ok(r[0].distance <= r[1].distance);
});

test('upsertVec 覆盖同 id 的向量', () => {
  if (!vecAvailable()) return;
  upsertVec('a', [0, 0, 0, 1]); // 把 a 移到远处
  const r = vecSearch([1, 0, 0, 0], 1);
  assert.notEqual(r[0].chunk_id, 'a'); // a 不再是最近邻
});
