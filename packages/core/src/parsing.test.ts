import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableToMarkdown, buildChunks, buildStandardChunksForIngest } from './parsing.ts';

test('tableToMarkdown 生成表头 + 分隔行 + 数据行', () => {
  const md = tableToMarkdown([['指标', '数值'], ['接通率', '95%']]);
  assert.match(md, /\| 指标 \| 数值 \|/);
  assert.match(md, /\| --- \| --- \|/);
  assert.match(md, /\| 接通率 \| 95% \|/);
});

test('tableToMarkdown 换行/竖线转义、列对齐补齐', () => {
  const md = tableToMarkdown([['a\nb', 'c|d'], ['x']]);
  assert.match(md, /a b/);        // 换行→空格
  assert.match(md, /c\\\|d/);     // | 转义
  const rows = md.split('\n');
  assert.equal(rows.length, 3);   // 表头 + 分隔 + 1 数据行
});

const slide = {
  slide_no: 3, image: '/x.png', text: '原生标题文本',
  tables: [[['指标', '数值'], ['接通率', '95%']]], notes: '讲稿备注',
};
const vj = {
  title: '方案架构', one_sentence_conclusion: '多Agent协同', key_facts: ['事实A'],
  numbers_with_units: [{ value: '95', unit: '%', metric: '接通率', context: '某客户' }],
  architecture_nodes: [{ name: '策略Agent', role: '决定触达策略', source_text: '策略Agent' }],
  ocr_text_exact: '策略Agent 语音Agent 接通率95%',
  image_understanding: '架构表达多Agent协同', visual_summary: '蓝色科技风',
  confidence: 0.4, needs_review: true,
};

test('buildChunks 从 vj+slide 生成七类 chunk', () => {
  const chunks = buildChunks(vj, slide);
  const byType = (t: string) => chunks.filter((c) => c.chunkType === t);
  for (const t of ['summary', 'raw', 'ocr_text', 'table_markdown', 'number_fact', 'diagram_node', 'speaker_notes']) {
    assert.equal(byType(t).length, 1, `应有 1 个 ${t}`);
  }
  assert.match(byType('number_fact')[0].text, /指标：接通率/);
  assert.match(byType('number_fact')[0].text, /数值：95%/);
  assert.match(byType('diagram_node')[0].text, /节点：策略Agent/);
  assert.match(byType('diagram_node')[0].text, /原文：策略Agent/);
  assert.equal(byType('raw')[0].sourceMethod, 'native');
  assert.equal(byType('ocr_text')[0].sourceMethod, 'vlm');
  assert.equal(byType('table_markdown')[0].sourceMethod, 'table_parser');
});

test('buildChunks 空值跳过、ocr 与 raw 相同时跳过', () => {
  const empty = buildChunks(
    { title: '封面', one_sentence_conclusion: '', key_facts: [], numbers_with_units: [], architecture_nodes: [], ocr_text_exact: '', confidence: 0.9, needs_review: false },
    { slide_no: 1, image: '/x', text: '', tables: [], notes: '' },
  );
  const types = empty.map((c) => c.chunkType);
  assert.equal(types.includes('summary'), true);   // title 非空
  for (const t of ['raw', 'ocr_text', 'table_markdown', 'number_fact', 'diagram_node', 'speaker_notes']) {
    assert.equal(types.includes(t), false, `${t} 应被跳过`);
  }
  // ocr 与 raw 完全相同 → 跳过 ocr
  const dup = buildChunks(
    { title: 't', ocr_text_exact: '完全一样', numbers_with_units: [], architecture_nodes: [], confidence: 0.9, needs_review: false },
    { slide_no: 1, image: '/x', text: '完全一样', tables: [], notes: '' },
  );
  assert.equal(dup.filter((c) => c.chunkType === 'ocr_text').length, 0);
});

test('buildChunks 兼容旧版 architecture_nodes 纯字符串 / numbers desc', () => {
  const chunks = buildChunks(
    { title: 't', architecture_nodes: ['号码识别'], numbers_with_units: [{ value: '3', unit: '万', desc: '日呼量' }], confidence: 0.9, needs_review: false },
    { slide_no: 1, image: '/x', text: 'x', tables: [], notes: '' },
  );
  assert.match(chunks.find((c) => c.chunkType === 'diagram_node')!.text, /节点：号码识别/);
  assert.match(chunks.find((c) => c.chunkType === 'number_fact')!.text, /指标：日呼量/);
});

test('buildStandardChunksForIngest 为标准 PDF/DOCX 生成条款切片且不处理 PPT', () => {
  const slides = [
    {
      slide_no: 1,
      text: `GB/T 32168-2015
政务服务中心网上服务规范
1 范围
本标准规定了网上服务要求。
4 服务渠道
4.1 一次性告知
材料不齐全的，应一次性告知申请人需要补正的全部内容。`,
    },
  ];

  const pdfChunks = buildStandardChunksForIngest(slides, {
    title: 'GB/T 32168-2015 政务服务中心网上服务规范',
    format: 'pdf',
  });
  const pptChunks = buildStandardChunksForIngest(slides, {
    title: 'GB/T 32168-2015 政务服务中心网上服务规范',
    format: 'ppt',
  });

  assert.ok(pdfChunks.some((chunk) => chunk.clauseNo === '4.1'));
  assert.equal(pdfChunks.some((chunk) => /\.{5,}/.test(chunk.text)), false);
  assert.deepEqual(pptChunks, []);
});
