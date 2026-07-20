import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseImgBlocks, friendlyLarkError, baseCellToText } from './feishu.ts';

const SAMPLE_XML = `<title>样例文档</title>
<h1>一、项目背景</h1>
<p>正文一段。</p>
<img id="M6bOdNtc7opXIixP8oQcEEp2nsh" name="image.png" alt="图片展示了项目方案架构，左侧为流程，右侧为决策板块。" height="800" href="https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/authcode/?code=AAA" mime="image/png" scale="1.000000" src="GGCOb4GKmoJMXPx1MQPcuTEDnUg" width="1866"/>
<p>中间文字。</p>
<img src="JLvNdaac3opXSWx6z2dcRCy8nxg" alt="时间轴：2025年4月至9月，包含11个任务。" mime="image/png" name="image.png" id="abc123"/>
<whiteboard id="wb1" />
<img name="image.png" id="noSrc" alt="无 token 的图，应跳过" mime="image/png"/>`;

test('parseImgBlocks 解析出每个 <img> 的 id/alt/src/mime/name', () => {
  const imgs = parseImgBlocks(SAMPLE_XML);
  assert.equal(imgs.length, 2, '只取有 src(token) 的 img，noSrc 应跳过');
  assert.equal(imgs[0].src, 'GGCOb4GKmoJMXPx1MQPcuTEDnUg');
  assert.equal(imgs[0].id, 'M6bOdNtc7opXIixP8oQcEEp2nsh');
  assert.match(imgs[0].alt, /项目方案架构/);
  assert.equal(imgs[0].mime, 'image/png');
  assert.equal(imgs[0].name, 'image.png');
});

test('parseImgBlocks 属性顺序无关（src 在前也能解析）', () => {
  const imgs = parseImgBlocks(SAMPLE_XML);
  assert.equal(imgs[1].src, 'JLvNdaac3opXSWx6z2dcRCy8nxg');
  assert.match(imgs[1].alt, /时间轴/);
});

test('parseImgBlocks 无 img 返回空数组', () => {
  assert.deepEqual(parseImgBlocks('<p>纯文本，没有图。</p>'), []);
  assert.deepEqual(parseImgBlocks(''), []);
});

test('parseImgBlocks 解码 alt 中的 XML 实体', () => {
  const xml = `<img id="x" src="TOK" alt="A &amp; B &lt;c&gt; &quot;d&quot;" mime="image/png"/>`;
  const imgs = parseImgBlocks(xml);
  assert.equal(imgs[0].alt, 'A & B <c> "d"');
});

// ── friendlyLarkError：把 lark-cli 结构化错误翻成人话（尤其权限类 3380004）──
test('friendlyLarkError 把 3380004 映射成无权限提示', () => {
  const r = { ok: false, identity: 'user', error: { code: 3380004, message: 'No permission to operate on this document: the current user lacks view or edit access.' } };
  const msg = friendlyLarkError(r);
  assert.match(msg, /无权访问/);
  assert.doesNotMatch(msg, /Command failed|lark-cli|No permission/, '不应把原始命令/英文错误抛给用户');
});

test('friendlyLarkError 靠 message 文案也能识别无权限（code 缺失时）', () => {
  const r = { ok: false, error: { message: 'No permission to operate on this document: ...' } };
  assert.match(friendlyLarkError(r), /无权访问/);
});

test('friendlyLarkError 其它错误回落到原始 message', () => {
  const r = { ok: false, error: { code: 99999, message: 'some other api error' } };
  assert.equal(friendlyLarkError(r), 'some other api error');
});

test('friendlyLarkError 无 error 字段给通用兜底', () => {
  assert.match(friendlyLarkError({ ok: false }), /抓取失败/);
});

test('friendlyLarkError 把 bitable 91402/91403 映射成无权限提示', () => {
  assert.match(friendlyLarkError({ ok: false, error: { code: 91402, message: 'NOTEXIST' } }), /无权访问该多维表格/);
  assert.match(friendlyLarkError({ ok: false, error: { code: 91403, message: 'FORBIDDEN' } }), /无权访问该多维表格/);
});

// ── baseCellToText：Base 记录字段值 → 可读文本（PRD-0030）──
test('baseCellToText 空值/标量直转', () => {
  assert.equal(baseCellToText(null), '');
  assert.equal(baseCellToText(undefined), '');
  assert.equal(baseCellToText('  文本 '), '文本');
  assert.equal(baseCellToText(0), '0');
  assert.equal(baseCellToText(3.14), '3.14');
  assert.equal(baseCellToText(true), 'true');
});

test('baseCellToText 单选/多选字符串数组用「、」连接', () => {
  assert.equal(baseCellToText(['国企']), '国企');
  assert.equal(baseCellToText(['AICC', '外呼']), 'AICC、外呼');
  assert.equal(baseCellToText([]), '');
});

test('baseCellToText 附件数组降级为计数', () => {
  const v = [{ file_token: 'MuPKbx', name: '方案.pptx', size: 26318812 }, { file_token: 'HdjkbX', name: 'b.pdf', size: 1 }];
  assert.equal(baseCellToText(v), '[附件×2]');
});

test('baseCellToText 关联记录 id 数组降级为计数', () => {
  assert.equal(baseCellToText(['recTh5lipm', 'rec47ek1rL']), '[关联记录×2]');
});

test('baseCellToText 人员/带名称对象数组取 name', () => {
  assert.equal(baseCellToText([{ id: 'ou_x', name: '苏叶' }]), '苏叶');
  assert.equal(baseCellToText([{ id: 'ou_x', name: '苏叶' }, { id: 'ou_y', name: '长乐' }]), '苏叶、长乐');
});

test('baseCellToText 超链接对象转 text (link)', () => {
  assert.equal(baseCellToText({ text: '官网', link: 'https://a.cn' }), '官网 (https://a.cn)');
  assert.equal(baseCellToText({ link: 'https://a.cn' }), 'https://a.cn');
});

test('baseCellToText 未知对象 JSON 兜底并截断', () => {
  assert.equal(baseCellToText({ foo: 1 }), '{"foo":1}');
  const long = baseCellToText({ blob: 'x'.repeat(500) });
  assert.ok(long.length <= 201 && long.endsWith('…'), '超长 JSON 应截断加省略号');
});
