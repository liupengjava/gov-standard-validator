import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleUnitView } from './unit-view.ts';

const fullRow = {
  id: 'u1',
  slide_no: 1,
  image_path: '/x/1.png',
  title: '封面',
  slide_type: '封面',
  conclusion: '一句话结论',
  visual_summary: '版式描述',
  confidence: 0.9,
  needs_review: 0,
  raw_text: '原生文本',
  visual_json: JSON.stringify({
    title: '封面JSON',
    slide_type: '封面',
    one_sentence_conclusion: 'JSON结论',
    key_facts: ['事实1', '事实2'],
    numbers_with_units: [{ value: '95', unit: '%', metric: '准确率', context: '上下文' }],
    architecture_nodes: [{ name: '后台', role: '处理', source_text: '原图文字' }],
    ocr_text_exact: '逐字OCR\n第二行',
    image_understanding: '图片理解文本',
    visual_summary: 'JSON版式',
    confidence: 0.9,
    needs_review: false,
    review_reasons: ['原因1'],
  }),
};

test('assembleUnitView 解析完整 visual_json，展开 VLM 字段', () => {
  const v = assembleUnitView(fullRow);
  assert.equal(v.slide_no, 1);
  assert.equal(v.raw_text, '原生文本');
  assert.equal(v.ocr_text_exact, '逐字OCR\n第二行');
  assert.equal(v.image_understanding, '图片理解文本');
  assert.deepEqual(v.key_facts, ['事实1', '事实2']);
  assert.equal(v.numbers_with_units.length, 1);
  assert.equal(v.numbers_with_units[0].value, '95');
  assert.equal(v.numbers_with_units[0].metric, '准确率');
  assert.equal(v.architecture_nodes[0].name, '后台');
  assert.equal(v.architecture_nodes[0].source_text, '原图文字');
  assert.deepEqual(v.review_reasons, ['原因1']);
});

test('assembleUnitView 已有列字段优先于 visual_json', () => {
  const v = assembleUnitView(fullRow);
  assert.equal(v.title, '封面'); // 列值优先，而非 '封面JSON'
  assert.equal(v.conclusion, '一句话结论'); // 列值优先
  assert.equal(v.visual_summary, '版式描述');
});

test('assembleUnitView 列字段为空时回退到 visual_json', () => {
  const row = { ...fullRow, title: '', conclusion: '', visual_summary: '' };
  const v = assembleUnitView(row);
  assert.equal(v.title, '封面JSON');
  assert.equal(v.conclusion, 'JSON结论'); // 回退 one_sentence_conclusion
  assert.equal(v.visual_summary, 'JSON版式');
});

test('assembleUnitView visual_json 为 null 时兜底为空、不抛错', () => {
  const row = { ...fullRow, visual_json: null };
  const v = assembleUnitView(row);
  assert.equal(v.ocr_text_exact, '');
  assert.equal(v.image_understanding, '');
  assert.deepEqual(v.numbers_with_units, []);
  assert.deepEqual(v.architecture_nodes, []);
  assert.deepEqual(v.key_facts, []);
  assert.deepEqual(v.review_reasons, []);
  assert.equal(v.title, '封面'); // 基础列仍在
  assert.equal(v.raw_text, '原生文本');
});

test('assembleUnitView visual_json 是脏字符串时兜底、不抛错', () => {
  const row = { ...fullRow, visual_json: '这不是JSON{' };
  const v = assembleUnitView(row);
  assert.equal(v.ocr_text_exact, '');
  assert.deepEqual(v.numbers_with_units, []);
  assert.equal(v.title, '封面');
});

test('assembleUnitView 透传 speaker_notes', () => {
  const v = assembleUnitView(fullRow, '演讲者备注内容');
  assert.equal(v.speaker_notes, '演讲者备注内容');
});

test('assembleUnitView 缺 speaker_notes 时为空串', () => {
  const v = assembleUnitView(fullRow);
  assert.equal(v.speaker_notes, '');
});
