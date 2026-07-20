import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveCodexCommand } from './codex-bin.ts';

export type ClaudeResult = { text: string; raw: any };

/** 跑一次 claude CLI；stdin 设为 ignore（避免 -p 模式干等 stdin 3s），捕获 stderr 便于诊断。 */
function runClaudeOnce(args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ch = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const to = setTimeout(() => { ch.kill('SIGKILL'); reject(new Error('claude timeout')); }, timeoutMs);
    ch.stdout.on('data', (d) => { out += d; });
    ch.stderr.on('data', (d) => { err += d; });
    ch.on('error', (e) => { clearTimeout(to); reject(e); });
    ch.on('close', (code) => { clearTimeout(to); code === 0 ? resolve(out) : reject(new Error(`claude exit ${code}: ${err.slice(0, 300)}`)); });
  });
}

/** 调本机 Claude Code CLI（headless，JSON 输出）。所有 AI 调用统一走这里（ADR-0005）。带 3 次重试，抗瞬时限流。 */
export async function callClaude(
  prompt: string,
  opts: { model?: string; allowReadTool?: boolean; timeoutMs?: number } = {}
): Promise<ClaudeResult> {
  // --no-session-persistence：headless 一次性调用无需保存/恢复会话，
  // 否则每页 PPT 分析都会在 ~/.claude/projects/<项目> 落一份 transcript，淹没真实开发会话。
  const args = ['-p', prompt, '--output-format', 'json', '--no-session-persistence'];
  if (opts.model) args.push('--model', opts.model);
  if (opts.allowReadTool) args.push('--allowedTools', 'Read');
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const stdout = await runClaudeOnce(args, opts.timeoutMs ?? 180000);
      const env = JSON.parse(stdout);
      if (env.is_error) throw new Error('claude error: ' + (env.result || env.subtype));
      return { text: String(env.result ?? ''), raw: env };
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** 修复 LLM 常见的非法 JSON：字符串值里未转义的内嵌 ASCII 引号、字面换行/制表符。
 * 单遍扫描：在字符串内遇到 `"`，向后看跳过空白，若下一个非空白字符是结构符(:,}])或结尾，
 * 视为合法收尾引号；否则判定为正文里的内嵌引号并转义为 \"。同时把字面换行/Tab 转义。
 * 这是启发式（无法 100% 覆盖"内嵌引号正好后接逗号"的歧义），失败时由 extractJson 抛错回退。 */
export function repairJson(src: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (!inStr) {
      out += c;
      if (c === '"') inStr = true;
      continue;
    }
    if (c === '\\') { // 已有转义，原样复制两字符
      out += c + (i + 1 < src.length ? src[i + 1] : '');
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      const nxt = j < src.length ? src[j] : '';
      if (nxt === '' || nxt === ':' || nxt === ',' || nxt === '}' || nxt === ']') {
        out += '"'; inStr = false; // 合法收尾
      } else {
        out += '\\"'; // 正文内嵌引号，转义
      }
      continue;
    }
    if (c === '\n') { out += '\\n'; continue; }
    if (c === '\r') { out += '\\r'; continue; }
    if (c === '\t') { out += '\\t'; continue; }
    out += c;
  }
  return out;
}

/** 从模型输出里抽出 JSON 对象（去掉 ```json 围栏，取第一个 {...}）。
 * 严格解析失败时，用 repairJson 修复 LLM 常见非法 JSON 后再试一次；仍失败则抛错（调用方回退）。 */
export function extractJson(text: string): any {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  try {
    return JSON.parse(t);
  } catch {
    return JSON.parse(repairJson(t)); // 修复内嵌引号/换行后重试
  }
}

/** 逐页视觉理解：读渲染图 + 原生文本 → 固定 JSON schema。 */
export async function analyzeSlide(
  imagePath: string,
  nativeText: string,
  slideNo: number,
  model: string
): Promise<any> {
  const prompt =
    `读取图片 ${imagePath}，这是一份销售解决方案 PPT 的第 ${slideNo} 页渲染图。` +
    `结合该页原生抽取文本：\n"""\n${(nativeText || '').slice(0, 1500)}\n"""\n` +
    `请深入理解这一页（包括文字、图片、图表、架构图的内在逻辑），仅输出一个 JSON 对象，字段：\n` +
    `{"title":"页标题","slide_type":"封面|目录|痛点|方案|技术架构|产品功能|案例|数据成效|公司介绍|资质|结尾|其他",` +
    `"one_sentence_conclusion":"这页要表达的一句话结论","key_facts":["关键事实或数据点"],` +
    `"numbers_with_units":[{"value":"","unit":"","metric":"指标名","context":"该数字的上下文"}],` +
    `"architecture_nodes":[{"name":"节点/组件名","role":"作用","source_text":"图中该节点的原文"}],` +
    `"ocr_text_exact":"逐字转写本页所有可见文字(尤其图片/截图/流程图节点/界面里的小字),保持原文,不改写/不翻译/不补全/不解释",` +
    `"image_understanding":"对本页图片/图表/架构图逻辑的理解(可改写,语义解释)",` +
    `"visual_summary":"版式与视觉风格描述","confidence":0.0,"needs_review":false,"review_reasons":["低置信或需复核的原因"]}\n` +
    `铁律：ocr_text_exact 与 architecture_nodes[].source_text 必须忠实原文，不得改写；image_understanding 才可做语义解释。\n` +
    `architecture_nodes 仅在本页为架构图/流程图时填写,否则空数组。confidence 为你对理解准确度的自评(0-1)；` +
    `含关键数字、政策、客户敏感或低置信度时 needs_review 置 true 并在 review_reasons 写明。` +
    `只输出 JSON，不要任何额外文字。`;
  const r = await callClaude(prompt, { model, allowReadTool: true, timeoutMs: 240000 });
  return extractJson(r.text);
}

/** 跑一次 codex exec 视觉分析（用 Codex/OpenAI 额度，绕开 claude 限流）。
 * 图片作为附件传入（-i），最终消息写到临时文件（--output-last-message）再读回，输出干净。 */
function runCodexOnce(prompt: string, imagePath: string, model: string | undefined, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const outFile = join(tmpdir(), `sp-codex-vlm-${randomUUID()}.txt`);
    const args = ['exec', '-i', imagePath, '--output-last-message', outFile,
      '--skip-git-repo-check', '--ephemeral', '--dangerously-bypass-approvals-and-sandbox'];
    if (model) args.push('-m', model);
    args.push(prompt);
    const cmd = resolveCodexCommand(args);
    const ch = spawn(cmd.command, cmd.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    const to = setTimeout(() => { ch.kill('SIGKILL'); reject(new Error('codex timeout')); }, timeoutMs);
    ch.stdout.on('data', () => {}); // 忽略进度输出
    ch.stderr.on('data', (d) => { err += d; });
    ch.on('error', (e) => { clearTimeout(to); reject(e); });
    ch.on('close', (code) => {
      clearTimeout(to);
      if (code !== 0) { reject(new Error(`codex exit ${code}: ${err.slice(0, 300)}`)); return; }
      try { const t = readFileSync(outFile, 'utf-8'); try { unlinkSync(outFile); } catch {} resolve(t); }
      catch (e) { reject(e); }
    });
  });
}

// GPT-5.5 文本调用走与聊天后端（codex-appserver.ts）同源的 indata provider 配置：responses 协议 + INDATA_API_KEY。
const INDATA_BASE_URL = process.env.INDATA_BASE_URL || 'https://model.indata.cc/v1';

/** 跑一次 codex exec 纯文本调用（GPT-5.5 via indata，无图片、无工具）。 */
function runCodexTextOnce(prompt: string, model: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const outFile = join(tmpdir(), `sp-codex-text-${randomUUID()}.txt`);
    const args = ['exec', '--output-last-message', outFile,
      '--skip-git-repo-check', '--ephemeral', '--dangerously-bypass-approvals-and-sandbox',
      '-c', `model="${model}"`,
      '-c', `model_provider="indata"`,
      '-c', `model_providers.indata.name="Indata"`,
      '-c', `model_providers.indata.base_url="${INDATA_BASE_URL}"`,
      '-c', `model_providers.indata.wire_api="responses"`,
      '-c', `model_providers.indata.env_key="INDATA_API_KEY"`,
      '-c', `model_providers.indata.requires_openai_auth=false`,
      '-c', `disable_response_storage=true`,
      prompt];
    const cmd = resolveCodexCommand(args);
    const ch = spawn(cmd.command, cmd.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    const to = setTimeout(() => { ch.kill('SIGKILL'); reject(new Error('codex timeout')); }, timeoutMs);
    ch.stdout.on('data', () => {});
    ch.stderr.on('data', (d) => { err += d; });
    ch.on('error', (e) => { clearTimeout(to); reject(e); });
    ch.on('close', (code) => {
      clearTimeout(to);
      if (code !== 0) { reject(new Error(`codex exit ${code}: ${err.slice(0, 300)}`)); return; }
      try { const t = readFileSync(outFile, 'utf-8'); try { unlinkSync(outFile); } catch {} resolve(t); }
      catch (e) { reject(e); }
    });
  });
}

/** GPT 文本调用（与 callClaude 同形返回，供评测等场景按模型名切后端）。带 3 次重试。 */
export async function callCodexText(
  prompt: string,
  opts: { model?: string; timeoutMs?: number } = {}
): Promise<ClaudeResult> {
  if (!process.env.INDATA_API_KEY) throw new Error('缺少 INDATA_API_KEY（GPT-5.5 上游 key），见 apps/web/.env.local');
  const model = opts.model || 'gpt-5.5';
  const p = prompt + '\n\n（直接输出回答文本，不要执行任何命令或使用工具。）';
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = await runCodexTextOnce(p, model, opts.timeoutMs ?? 300000);
      return { text: text.trim(), raw: null };
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** 逐页视觉理解（Codex 后端）：与 analyzeSlide 同一 schema，但用 codex exec + 图片附件。 */
export async function analyzeSlideCodex(
  imagePath: string,
  nativeText: string,
  slideNo: number,
  model?: string
): Promise<any> {
  const prompt =
    `附件是一份销售解决方案 PPT 的第 ${slideNo} 页渲染图。` +
    `结合该页原生抽取文本：\n"""\n${(nativeText || '').slice(0, 1500)}\n"""\n` +
    `请深入理解这一页（包括文字、图片、图表、架构图的内在逻辑），仅输出一个 JSON 对象，字段：\n` +
    `{"title":"页标题","slide_type":"封面|目录|痛点|方案|技术架构|产品功能|案例|数据成效|公司介绍|资质|结尾|其他",` +
    `"one_sentence_conclusion":"这页要表达的一句话结论","key_facts":["关键事实或数据点"],` +
    `"numbers_with_units":[{"value":"","unit":"","metric":"指标名","context":"该数字的上下文"}],` +
    `"architecture_nodes":[{"name":"节点/组件名","role":"作用","source_text":"图中该节点的原文"}],` +
    `"ocr_text_exact":"逐字转写本页所有可见文字(尤其图片/截图/流程图节点/界面里的小字),保持原文,不改写/不翻译/不补全/不解释",` +
    `"image_understanding":"对本页图片/图表/架构图逻辑的理解(可改写,语义解释)",` +
    `"visual_summary":"版式与视觉风格描述","confidence":0.0,"needs_review":false,"review_reasons":["低置信或需复核的原因"]}\n` +
    `铁律：ocr_text_exact 与 architecture_nodes[].source_text 必须忠实原文，不得改写；image_understanding 才可做语义解释。\n` +
    `architecture_nodes 仅在本页为架构图/流程图时填写,否则空数组。confidence 为你对理解准确度的自评(0-1)；` +
    `含关键数字、政策、客户敏感或低置信度时 needs_review 置 true 并在 review_reasons 写明。` +
    `只输出 JSON，不要任何额外文字，不要执行任何命令或使用工具。`;
  const text = await runCodexOnce(prompt, imagePath, model, 240000);
  return extractJson(text);
}
