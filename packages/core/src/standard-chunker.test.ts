import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkStandardDocument } from './standard-chunker.ts';

const SAMPLE_STANDARD = `
ICS01.040.03
A 12
中华人民共和国国家标准
GB/T 32168-2015
政务服务中心网上服务规范
The specification for online service of administrative service centre
2015-10-12发布 2016-05-01实施
前言 I ........................................................................
1 范围 1 ......................................................................
2 规范性引用文件 1 ............................................................
3 术语和定义 1 ................................................................

1 范围
本标准规定了政务服务中心网上服务的术语和定义、服务渠道、服务流程、服务评价等内容。

2 规范性引用文件
下列文件对于本文件的应用是必不可少的。

3 术语和定义
3.1 网上服务
通过互联网提供事项咨询、申报、受理、查询和评价的服务活动。

4 服务渠道
4.1 总体要求
政务服务中心应通过网上大厅、移动客户端、自助终端等渠道提供服务。
4.1.1 一次性告知
材料不齐全或者不符合法定形式的，应一次性告知申请人需要补正的全部内容。
4.1.2 线上线下一致
线上预审结果应与窗口受理记录保持一致，不得重复要求提交纸质材料。
4.2 推荐服务
政务服务中心宜提供办理进度提醒服务。
4.3 可选服务
服务对象可以通过评价渠道反馈意见。
`;

test('chunkStandardDocument removes catalog dot-leader rows and keeps real clauses', () => {
  const chunks = chunkStandardDocument({ text: SAMPLE_STANDARD, title: 'GB_T 32168-2015 政务服务中心网上服务规范.pdf' });

  assert.ok(chunks.length >= 8);
  assert.equal(chunks.some((chunk) => /前言 I \.{5,}/.test(chunk.text)), false);
  assert.equal(chunks.some((chunk) => /1 范围 1 \.{5,}/.test(chunk.text)), false);
  assert.ok(chunks.some((chunk) => chunk.clauseNo === '4.1.1' && chunk.text.includes('一次性告知')));
  assert.ok(chunks.some((chunk) => chunk.clauseNo === '4.1.2' && chunk.constraint === 'prohibit'));
});

test('chunkStandardDocument extracts standard metadata, hierarchy, dimensions, and constraints', () => {
  const chunks = chunkStandardDocument({ text: SAMPLE_STANDARD, sourceMethod: 'native' });
  const material = chunks.find((chunk) => chunk.clauseNo === '4.1.1');
  const process = chunks.find((chunk) => chunk.clauseNo === '4.1');
  const evaluation = chunks.find((chunk) => chunk.clauseNo === '4.3');

  assert.equal(material?.standardNo, 'GB/T 32168-2015');
  assert.equal(material?.standardName, '政务服务中心网上服务规范');
  assert.equal(material?.chapterNo, '4');
  assert.equal(material?.chapterTitle, '服务渠道');
  assert.deepEqual(material?.hierarchy, ['4 服务渠道', '4.1 总体要求', '4.1.1 一次性告知']);
  assert.equal(material?.dimension, 'material');
  assert.equal(material?.constraint, 'must');
  assert.equal(process?.dimension, 'process');
  assert.equal(evaluation?.dimension, 'evaluation');
});

test('chunkStandardDocument does not cap output at twelve chunks', () => {
  const clauses = Array.from({ length: 16 }, (_, index) => {
    const no = `5.${index + 1}`;
    return `${no} 测试条款${index + 1}\n政务服务中心应记录第${index + 1}项办理过程。`;
  }).join('\n');

  const chunks = chunkStandardDocument({ text: `GB/T 99999-2026\n测试标准\n5 测试章节\n${clauses}` });

  assert.equal(chunks.filter((chunk) => /^5\.\d+$/.test(chunk.clauseNo || '')).length, 16);
});

test('chunkStandardDocument normalizes OCR spaces and marks OCR chunks', () => {
  const chunks = chunkStandardDocument({
    text: `G B / T 32168—2015\n政 务 服 务 中 心 网 上 服 务 规 范\n1 范 围\n本 标 准 规 定 了 网 上 服 务 要 求。`,
    sourceMethod: 'ocr',
  });

  assert.equal(chunks[0].sourceMethod, 'ocr');
  assert.ok(chunks[0].text.includes('本标准规定了网上服务要求'));
  assert.ok(chunks[0].confidence < 1);
});
