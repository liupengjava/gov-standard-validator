import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sp-content-classify-'));
process.env.SP_DB = join(dir, 'test.db');
const { db, createAsset, createVersion, createUnit } = await import('./db.ts');
const { buildContentSummary, buildIndustryCandidatesText, buildBusinessTypeCandidatesText, parseClassifyResponse } = await import('./content-classify.ts');

test('buildContentSummary 拼接 units 的 conclusion+visual_summary，按 slide_no 排序，超长截断', () => {
  const aid = createAsset({ sourceType: 'upload', title: '测试素材', assetType: 'ppt' });
  const vid = createVersion({ assetId: aid, version: 'v1', checksum: 'ck1', rawPath: '/x' });
  createUnit({ versionId: vid, slideNo: 2, imagePath: '/x', rawText: '', visualJson: '{}', conclusion: '第二页结论', visualSummary: '第二页视觉' });
  createUnit({ versionId: vid, slideNo: 1, imagePath: '/x', rawText: '', visualJson: '{}', conclusion: '第一页结论', visualSummary: '第一页视觉' });
  const summary = buildContentSummary(aid);
  assert.ok(summary.indexOf('第一页结论') < summary.indexOf('第二页结论')); // 按 slide_no 排序，不是插入顺序
  assert.ok(summary.includes('第一页视觉'));

  const truncated = buildContentSummary(aid, 5);
  assert.ok(truncated.length <= 5);
});

test('buildContentSummary 素材无内容时返回空字符串，不抛错', () => {
  const aid = createAsset({ sourceType: 'upload', title: '无内容素材', assetType: 'ppt' });
  assert.equal(buildContentSummary(aid), '');
});

test('buildIndustryCandidatesText 渲染行业+场景，无场景的行业不显示空括号', () => {
  const text = buildIndustryCandidatesText();
  assert.ok(text.includes('人力（场景：需求初筛'));
  assert.ok(text.includes('公安（场景：公安反诈'));
  assert.ok(/- 教育\n|- 教育$/.test(text) || text.includes('- 教育\n') || text.includes('- 教育（'));
  assert.ok(!text.includes('教育（场景：）'));
});

test('buildBusinessTypeCandidatesText 按 sort_order 列出全部业务类型', () => {
  const text = buildBusinessTypeCandidatesText();
  assert.ok(text.includes('公司介绍'));
  assert.ok(text.includes('产品方案'));
  assert.ok(text.includes('行业方案'));
  assert.ok(text.includes('客户案例'));
  assert.ok(text.includes('销售支持'));
});

test('parseClassifyResponse 把 AI 返回的名字映射成 id，查不到的字段整个 key 不存在', () => {
  const decision = parseClassifyResponse('```json\n{"industry":"人力","scenario":"需求初筛","businessType":"产品方案"}\n```');
  const hr = db().prepare(`SELECT id FROM industries WHERE name='人力'`).get() as any;
  assert.equal(decision.industryId, hr.id);
  assert.ok(decision.scenarioId);
  assert.ok(decision.businessTypeId);
});

test('parseClassifyResponse 对不存在的名字/null 值，对应 key 完全不出现', () => {
  const decision = parseClassifyResponse('{"industry":"人力","scenario":null,"businessType":"不存在的类型"}');
  assert.ok('industryId' in decision);
  assert.ok(!('scenarioId' in decision));
  assert.ok(!('businessTypeId' in decision));
});

test('parseClassifyResponse JSON 损坏时返回空对象，不抛错', () => {
  const decision = parseClassifyResponse('这不是 JSON');
  assert.deepEqual(decision, {});
});

test('parseClassifyResponse 字段值是嵌套对象时安全兜底，不抛错、不含对应 key', () => {
  let decision: any;
  assert.doesNotThrow(() => {
    decision = parseClassifyResponse('{"industry":{"a":1}}');
  });
  assert.ok(!('industryId' in decision));
});

test('parseClassifyResponse 字段值是数组时安全兜底，不抛错、不含对应 key', () => {
  let decision: any;
  assert.doesNotThrow(() => {
    decision = parseClassifyResponse('{"industry":["人力"]}');
  });
  assert.ok(!('industryId' in decision));
});

test('parseClassifyResponse 字段值是布尔值时安全兜底，不抛错、不含对应 key', () => {
  let decision: any;
  assert.doesNotThrow(() => {
    decision = parseClassifyResponse('{"industry":true}');
  });
  assert.ok(!('industryId' in decision));
});
