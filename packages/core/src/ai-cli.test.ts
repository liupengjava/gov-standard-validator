import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, repairJson } from './ai-cli.ts';

test('extractJson 解析正常 JSON', () => {
  assert.deepEqual(extractJson('{"a":1,"b":"x"}'), { a: 1, b: 'x' });
});

test('extractJson 去 ```json 围栏 + 取首个 {...}', () => {
  assert.deepEqual(extractJson('前言\n```json\n{"a":2}\n```\n尾'), { a: 2 });
});

test('extractJson 修复字符串值里未转义的内嵌 ASCII 引号（VLM 常见破坏）', () => {
  // 模型把中文里的强调引号直接用 ASCII " 且未转义
  const bad = '{"source_text":"确保"数据最小权限"。","name":"后台"}';
  const o = extractJson(bad);
  assert.equal(o.source_text, '确保"数据最小权限"。');
  assert.equal(o.name, '后台');
});

test('extractJson 修复字符串值里的字面换行', () => {
  const bad = '{"ocr":"第一行\n第二行","k":1}';
  const o = extractJson(bad);
  assert.equal(o.k, 1);
  assert.match(o.ocr, /第一行/);
  assert.match(o.ocr, /第二行/);
});

test('repairJson 不破坏数组与嵌套对象', () => {
  const bad = '{"arr":["a","b"],"nodes":[{"name":"X","note":"含"引号"测试"}]}';
  const o = JSON.parse(repairJson(bad));
  assert.deepEqual(o.arr, ['a', 'b']);
  assert.equal(o.nodes[0].name, 'X');
  assert.equal(o.nodes[0].note, '含"引号"测试');
});

test('extractJson 彻底无法解析时抛错（保持回退语义）', () => {
  assert.throws(() => extractJson('这根本不是 JSON'));
});
