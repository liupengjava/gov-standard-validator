import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, MODEL_ANSWER } from './config.ts';
import { search } from './retrieval.ts';
import { callClaude, callCodexText, extractJson } from './ai-cli.ts';
import type { ChunkHit } from './db.ts';

export const ROUNDS_DIR = resolve(ROOT, 'evals/rounds');
const QUESTIONS = resolve(ROOT, 'evals/golden-questions.json');

export type EvalConfig = { answerModel: string; judgeModel: string; k: number; queryExpand: boolean; note: string; concurrency?: number };

async function pool<T>(items: T[], n: number, fn: (it: T, i: number) => Promise<void>) {
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) { const my = idx++; await fn(items[my], my); }
  }));
}

function buildAnswerPrompt(query: string, ctx: string): string {
  return `你是百应销售解决方案助理。只能依据下面"资料片段"回答，不得编造、不得用资料外常识补充；资料不足以支撑就明确说不确定。\n\n` +
    `问题：${query}\n\n资料片段：\n${ctx}\n\n` +
    `用中文按结构回答：1) 直接结论 2) 要点/方案/架构 3) 在关键信息后用 [序号] 标注来源片段。专业、简洁、面向销售可直接用。`;
}

/** 按模型名路由作答后端：gpt* 走 codex exec（indata responses），其余走 claude CLI。 */
function callAnswerModel(prompt: string, model: string) {
  return /^gpt/i.test(model) ? callCodexText(prompt, { model }) : callClaude(prompt, { model });
}

async function answerWithCapture(q: { q: string; industry?: string; capability?: string }, cfg: EvalConfig) {
  const query = cfg.queryExpand ? `${q.q}（${q.industry || ''} ${q.capability || ''}）` : q.q;
  const t0 = Date.now();
  const { hits, debug } = await search(query, cfg.k);
  const retrieval_ms = Date.now() - t0;
  if (!hits.length) {
    return { refused: true, answer: '在当前知识库中没有检索到可支撑的依据，无法回答。', citations: [] as ChunkHit[], ctx: '', prompt: '', debug, retrieval_ms, answer_ms: 0 };
  }
  const ctx = hits.map((h, i) => `[${i + 1}] 《${h.asset_title}》第${h.slide_no}页${h.title ? '·' + h.title : ''}\n${h.text}`).join('\n\n');
  const prompt = buildAnswerPrompt(q.q, ctx);
  const t1 = Date.now();
  const r = await callAnswerModel(prompt, cfg.answerModel);
  return { refused: false, answer: r.text, citations: hits, ctx, prompt, debug, usage: r.raw?.usage, retrieval_ms, answer_ms: Date.now() - t1 };
}

async function judge(query: string, answer: string, ctx: string, refused: boolean, model: string) {
  const jp = `你是严格的销售知识库评测官。依据"资料片段"判断"回答"对销售见客户的实用质量。\n` +
    `问题：${query}\n\n资料片段：\n${ctx || '（无召回）'}\n\n回答：\n${answer}\n\n` +
    `仅输出 JSON：{"score":整体可用性0-100,"faithful":资料是否支撑结论(true/false),"coverage":关键点覆盖0-100,"citation_ok":是否合理标注来源(true/false),"refuse_ok":若资料不足是否恰当拒答(true/false),"issues":["具体问题"],"missing":["缺失的关键要点"],"verdict":"一句话总评","suggestion":"对知识库或检索的改进建议"}。`;
  const r = await callClaude(jp, { model });
  let parsed: any = {};
  try { parsed = extractJson(r.text); } catch { parsed = { score: 0, verdict: '评分解析失败', _raw: r.text.slice(0, 200) }; }
  return { parsed, prompt: jp, raw: r.text };
}

function mean(xs: number[]) { return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0; }
function groupAvg(recs: any[], key: string) {
  const g: Record<string, number[]> = {};
  recs.forEach((r) => { (g[r[key]] = g[r[key]] || []).push(r.score); });
  return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { avg: mean(v), n: v.length }]));
}

export async function runQuestions(
  questions: any[], dir: string, cfg: EvalConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<any[]> {
  mkdirSync(dir, { recursive: true });
  const records: any[] = new Array(questions.length);
  let done = 0;
  await pool(questions, cfg.concurrency || 4, async (q, i) => {
    let rec: any;
    const tq0 = Date.now();
    try {
      const a = await answerWithCapture(q, cfg);
      const tj0 = Date.now();
      const j = await judge(q.q, a.answer, a.ctx, a.refused, cfg.judgeModel);
      rec = {
        ...q, score: Number(j.parsed?.score) || 0, refused: a.refused, answer: a.answer,
        citations: a.citations.map((c) => ({ asset: c.asset_title, slide: c.slide_no, title: c.title })),
        retrieval: a.debug, judge: j.parsed,
        timing: { retrieval_ms: a.retrieval_ms, answer_ms: a.answer_ms, judge_ms: Date.now() - tj0, total_ms: Date.now() - tq0 },
        dialogue: { answer_prompt: a.prompt, answer_reply: a.answer, judge_prompt: j.prompt, judge_reply: j.raw },
      };
    } catch (e) {
      rec = { ...q, score: 0, error: String(e), judge: { verdict: '本题执行出错', score: 0 }, timing: { total_ms: Date.now() - tq0 }, dialogue: {} };
    }
    records[i] = rec;
    try { writeFileSync(resolve(dir, q.id + '.json'), JSON.stringify(rec, null, 2)); } catch {}
    onProgress?.(++done, questions.length);
  });
  return records;
}

export async function runRound(roundNo: number, cfg: EvalConfig) {
  const questions = JSON.parse(readFileSync(QUESTIONS, 'utf-8')) as any[];
  const dir = resolve(ROUNDS_DIR, 'round-' + String(roundNo).padStart(3, '0'));
  const records = await runQuestions(questions, dir, cfg);
  const avg = mean(records.map((r) => r.score));
  const worst = [...records].sort((a, b) => a.score - b.score).slice(0, 10)
    .map((r) => ({ id: r.id, score: r.score, q: r.q, verdict: r.judge?.verdict, missing: r.judge?.missing }));
  const ms = (key: string) => records.map((r) => Number(r.timing?.[key]) || 0);
  const timing = {
    avg_answer_s: Math.round(mean(ms('answer_ms')) / 1000),
    max_answer_s: Math.round(Math.max(0, ...ms('answer_ms')) / 1000),
    avg_judge_s: Math.round(mean(ms('judge_ms')) / 1000),
    avg_total_s: Math.round(mean(ms('total_ms')) / 1000),
    max_total_s: Math.round(Math.max(0, ...ms('total_ms')) / 1000),
  };
  const summary = {
    round: roundNo, note: cfg.note, config: { k: cfg.k, queryExpand: cfg.queryExpand, answerModel: cfg.answerModel, judgeModel: cfg.judgeModel },
    avg, count: records.length, ts: new Date().toISOString(), timing,
    byIndustry: groupAvg(records, 'industry'), byCapability: groupAvg(records, 'capability'), worst,
  };
  writeFileSync(resolve(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(resolve(dir, 'report.md'), renderReport(summary, records));
  // index
  const idxFile = resolve(ROUNDS_DIR, 'index.json');
  const idx = existsSync(idxFile) ? JSON.parse(readFileSync(idxFile, 'utf-8')) : [];
  idx.push({ round: roundNo, avg, note: cfg.note, ts: summary.ts, config: summary.config });
  writeFileSync(idxFile, JSON.stringify(idx, null, 2));
  return { summary, records };
}

function renderReport(s: any, recs: any[]): string {
  const wl = s.worst.map((w: any) => `- **${w.id}** (${w.score}) ${w.q}\n  - ${w.verdict || ''}${w.missing?.length ? '；缺：' + w.missing.join('、') : ''}`).join('\n');
  const ind = Object.entries(s.byIndustry).map(([k, v]: any) => `${k} ${v.avg}(${v.n})`).join(' · ');
  const cap = Object.entries(s.byCapability).map(([k, v]: any) => `${k} ${v.avg}`).join(' · ');
  const tm = s.timing
    ? `- 耗时：作答均值 ${s.timing.avg_answer_s}s（最长 ${s.timing.max_answer_s}s）· 评分均值 ${s.timing.avg_judge_s}s · 单题全程均值 ${s.timing.avg_total_s}s（最长 ${s.timing.max_total_s}s）\n`
    : '';
  const sec = (v: any) => (Number(v) ? (Number(v) / 1000).toFixed(1) : '-');
  const perQ = recs.map((r) => `| ${r.id} | ${r.score} | ${sec(r.timing?.answer_ms)} | ${sec(r.timing?.judge_ms)} | ${sec(r.timing?.total_ms)} |`).join('\n');
  return `# 评测 Round ${s.round} — 均分 ${s.avg}\n\n` +
    `- 时间：${s.ts}\n- 改进点：${s.note}\n- 配置：k=${s.config.k} 扩展=${s.config.queryExpand} 答=${s.config.answerModel} 判=${s.config.judgeModel}\n${tm}\n` +
    `## 按行业\n${ind}\n\n## 按能力\n${cap}\n\n## 最弱 10 题\n${wl}\n\n` +
    `## 各题评分与耗时\n| 题 | 分 | 作答s | 评分s | 全程s |\n|---|---|---|---|---|\n${perQ}\n`;
}
