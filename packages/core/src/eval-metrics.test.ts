import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recallAtK, reciprocalRank, ndcgAtK } from './eval-metrics.ts';

const approx = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('recallAtK = |top-k ∩ relevant| / |relevant|', () => {
  approx(recallAtK(['a', 'b', 'c'], ['b', 'x'], 2), 0.5); // top2={a,b}∩{b,x}={b}, /2
  approx(recallAtK(['a', 'b', 'c'], ['a', 'b'], 3), 1);
  approx(recallAtK(['a', 'b', 'c'], ['z'], 3), 0);
  approx(recallAtK(['a'], [], 3), 0); // 无相关项 → 0（不除零）
});

test('reciprocalRank = 1 / 首个相关项排名', () => {
  approx(reciprocalRank(['a', 'b', 'c'], ['b']), 0.5); // 第2位
  approx(reciprocalRank(['b', 'a'], ['b']), 1);
  approx(reciprocalRank(['a', 'b'], ['z']), 0); // 无命中
});

test('ndcgAtK 二元相关性', () => {
  approx(ndcgAtK(['b', 'a'], ['b'], 2), 1);            // 相关项在第1位 = 理想
  approx(ndcgAtK(['a', 'b'], ['b'], 2), 1 / Math.log2(3)); // 第2位: DCG=1/log2(3), IDCG=1
  approx(ndcgAtK(['a', 'b'], ['z'], 2), 0);            // 无命中
});
