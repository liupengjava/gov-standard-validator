import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetTags, sheetsJsonToMarkdown } from './feishu.ts';

test('parseSheetTags 解析 token 与 sheet-id', () => {
  const c = '正文\n<sheet sheet-id="IJkpwL" token="BbdOsWgC3huhJ8tsswHcqpFinlb"></sheet>\n末尾';
  const r = parseSheetTags(c);
  assert.equal(r.length, 1);
  assert.equal(r[0].token, 'BbdOsWgC3huhJ8tsswHcqpFinlb');
  assert.equal(r[0].sheetId, 'IJkpwL');
});

test('parseSheetTags 无标签返回空', () => {
  assert.deepEqual(parseSheetTags('纯文本无表格'), []);
});

test('sheetsJsonToMarkdown 列+数据转 markdown 表格', () => {
  const md = sheetsJsonToMarkdown({ sheets: [{ columns: ['序号', '场景'], data: [[1, '质检'], [2, '邀约']] }] });
  assert.match(md, /序号/);
  assert.match(md, /场景/);
  assert.match(md, /质检/);
  assert.match(md, /---/); // 分隔行
});

test('sheetsJsonToMarkdown 空数据返回空串', () => {
  assert.equal(sheetsJsonToMarkdown({ sheets: [] }), '');
  assert.equal(sheetsJsonToMarkdown({}), '');
});
