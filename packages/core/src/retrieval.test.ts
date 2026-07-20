import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTermExpansions, aggregateByParent, filterByMetadata } from './retrieval.ts';

const dict = [
  { canonical: '智能联络中心', aliases: ['AICC'] },
  { canonical: '语音机器人', aliases: ['VoiceAgent', '语音Agent'] },
];

test('buildTermExpansions 命中别名 → 补规范词', () => {
  const ex = buildTermExpansions('AICC 怎么部署', dict);
  assert.ok(ex.includes('智能联络中心'));
});

test('buildTermExpansions 命中规范词 → 补全部别名', () => {
  const ex = buildTermExpansions('语音机器人能干啥', dict);
  assert.ok(ex.includes('VoiceAgent'));
  assert.ok(ex.includes('语音Agent'));
});

test('buildTermExpansions 无命中 → 空；不返回已在 query 中的词', () => {
  assert.deepEqual(buildTermExpansions('今天天气如何', dict), []);
  const ex = buildTermExpansions('AICC', dict);
  assert.equal(ex.includes('AICC'), false); // 已在 query 中
  assert.ok(ex.includes('智能联络中心'));
});

test('aggregateByParent 同 parent 只留最高排名 child，保序取 top-k', () => {
  const h = (chunk_id: string, parent: string | null, unit: string) =>
    ({ chunk_id, parent_unit_id: parent, unit_id: unit } as any);
  const hits = [h('c1', 'p1', 'p1'), h('c2', 'p1', 'p1'), h('c3', 'p2', 'p2'), h('c4', 'p3', 'p3')];
  assert.deepEqual(aggregateByParent(hits, 2).map((x) => x.chunk_id), ['c1', 'c3']);
});

test('aggregateByParent parent 缺省回退 unit_id', () => {
  const hits = [
    { chunk_id: 'c1', parent_unit_id: null, unit_id: 'u1' },
    { chunk_id: 'c2', parent_unit_id: null, unit_id: 'u1' },
  ] as any;
  assert.deepEqual(aggregateByParent(hits, 5).map((x: any) => x.chunk_id), ['c1']);
});

test('filterByMetadata 按 industry 过滤；空过滤全留', () => {
  const hits = [
    { chunk_id: 'c1', industry: '金融' },
    { chunk_id: 'c2', industry: '运营商' },
    { chunk_id: 'c3', industry: null },
  ] as any;
  assert.deepEqual(filterByMetadata(hits, { industry: '金融' }).map((x: any) => x.chunk_id), ['c1']);
  assert.equal(filterByMetadata(hits, {}).length, 3);
  assert.equal(filterByMetadata(hits, undefined).length, 3);
});
