import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve, extname } from 'node:path';
import { PYTHON, PARSER_DOC, STORAGE_RAW, STORAGE_DERIVED, RENDER_DPI, MODEL_PARSE, PARSE_CONCURRENCY } from './config.ts';
import { analyzeSlide, analyzeSlideCodex } from './ai-cli.ts';
import {
  createAsset, createVersion, createUnit, createChunk,
  findVersionByChecksum, setVersionStatus, setAssetStatus,
} from './db.ts';
import { classifyAssetContent } from './content-classify.ts';

const pexec = promisify(execFile);

// VLM 后端选择：默认走本地 codex exec（用 Codex/OpenAI 额度，绕开 claude 限流）；
// 显式设 SP_VLM_BACKEND=claude 才回退到 claude CLI。与 scripts/reingest-2026-07/revlm.ts 保持一致。
const VLM_BACKEND = (process.env.SP_VLM_BACKEND || 'codex').toLowerCase();
function analyzeVlm(imagePath: string, nativeText: string, slideNo: number, model: string): Promise<any> {
  return VLM_BACKEND === 'codex'
    ? analyzeSlideCodex(imagePath, nativeText, slideNo, process.env.SP_CODEX_MODEL)
    : analyzeSlide(imagePath, nativeText, slideNo, model);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function runParser(input: string, outdir: string): Promise<any> {
  const { stdout } = await pexec(
    PYTHON,
    [PARSER_DOC, '--in', input, '--outdir', outdir, '--dpi', String(RENDER_DPI)],
    { timeout: 900000, maxBuffer: 16 * 1024 * 1024 }
  );
  const resultPath = stdout.trim().split('\n').pop()!.trim();
  return JSON.parse(readFileSync(resultPath, 'utf-8'));
}

async function pool<T>(items: T[], n: number, fn: (it: T, i: number) => Promise<void>): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const my = idx++;
      await fn(items[my], my);
    }
  });
  await Promise.all(workers);
}

export type ParseResult = { assetId: string; versionId: string; pages: number; skipped?: boolean };
export type IngestProgressEvent = {
  eventType: string;
  stage: string;
  label: string;
  progress: number;
  pageNo?: number;
  totalPages?: number;
  message?: string;
  payload?: unknown;
};

const FMT_BY_EXT: Record<string, string> = { '.pptx': 'ppt', '.ppt': 'ppt', '.pdf': 'pdf', '.docx': 'docx', '.doc': 'docx' };

/** 二维表格 → Markdown（表头 + 分隔行 + 数据行）；换行转空格、竖线转义、按最宽列补齐。 */
export function tableToMarkdown(rows: string[][]): string {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const cell = (c: unknown) => String(c ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
  const ncol = Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 0)), 1);
  const norm = (r: string[]) => Array.from({ length: ncol }, (_, i) => cell(r?.[i] ?? ''));
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  const header = norm(rows[0]);
  const sep = Array.from({ length: ncol }, () => '---');
  const body = rows.slice(1).map(norm).map(line);
  return [line(header), line(sep), ...body].join('\n');
}

function diagramNodeText(n: any): string {
  if (typeof n === 'string') { const s = n.trim(); return s ? `节点：${s}` : ''; }
  const name = String(n?.name ?? '').trim();
  if (!name) return '';
  const role = String(n?.role ?? '').trim();
  const src = String(n?.source_text ?? '').trim();
  return `节点：${name}` + (role ? `｜说明：${role}` : '') + (src ? `｜原文：${src}` : '');
}

export type BuiltChunk = { text: string; chunkType: string; sourceMethod: string };

/** 把一页的 VLM 理解(vj) + 解析产物(slide) 归一成多类型 chunk（纯函数，便于测试）。
 * 类型：summary/raw/ocr_text/table_markdown/number_fact/diagram_node/speaker_notes。空值跳过。 */
export function buildChunks(
  vj: any,
  slide: { text?: string; tables?: string[][][]; notes?: string }
): BuiltChunk[] {
  const out: BuiltChunk[] = [];
  const push = (text: string, chunkType: string, sourceMethod: string) => {
    const t = String(text ?? '').trim();
    if (t) out.push({ text: t, chunkType, sourceMethod });
  };
  // summary（语义概括，vlm）
  const nodeNames = Array.isArray(vj?.architecture_nodes)
    ? vj.architecture_nodes.map((n: any) => (typeof n === 'string' ? n : n?.name ?? '')).filter(Boolean).join(' ')
    : '';
  const summary = [
    vj?.title, vj?.one_sentence_conclusion,
    Array.isArray(vj?.key_facts) ? vj.key_facts.join('；') : '',
    nodeNames, vj?.image_understanding, vj?.visual_summary,
  ].filter((x: any) => x && String(x).trim()).join('。');
  push(summary, 'summary', 'vlm');
  // raw（原生文本，native）
  const raw = String(slide?.text ?? '').trim();
  push(raw, 'raw', 'native');
  // ocr_text（图内文字忠实转写，vlm）—— 与 raw 完全相同则跳过，避免冗余
  const ocr = String(vj?.ocr_text_exact ?? '').trim();
  if (ocr && ocr !== raw) push(ocr, 'ocr_text', 'vlm');
  // table_markdown（table_parser）
  for (const tbl of (Array.isArray(slide?.tables) ? slide.tables : [])) {
    push(tableToMarkdown(tbl), 'table_markdown', 'table_parser');
  }
  // number_fact（vlm）—— 兼容旧 desc 字段
  for (const n of (Array.isArray(vj?.numbers_with_units) ? vj.numbers_with_units : [])) {
    const value = String(n?.value ?? '').trim();
    const metric = String(n?.metric ?? n?.desc ?? '').trim();
    if (!value && !metric) continue;
    const unit = String(n?.unit ?? '').trim();
    const ctx = String(n?.context ?? '').trim();
    push(`指标：${metric || '—'}｜数值：${value}${unit}` + (ctx ? `｜上下文：${ctx}` : ''), 'number_fact', 'vlm');
  }
  // diagram_node（vlm）—— 兼容旧纯字符串
  for (const node of (Array.isArray(vj?.architecture_nodes) ? vj.architecture_nodes : [])) {
    push(diagramNodeText(node), 'diagram_node', 'vlm');
  }
  // speaker_notes（备注，native）
  push(String(slide?.notes ?? '').trim(), 'speaker_notes', 'native');
  return out;
}

export async function parseAndStore(
  pptPath: string,
  opts: { industry?: string; scenario?: string; model?: string; concurrency?: number;
    group?: string; category?: string; sourceUrl?: string; title?: string;
    onProgress?: (done: number, total: number, slideNo: number) => void;
    onIngestEvent?: (event: IngestProgressEvent) => void } = {}
): Promise<ParseResult> {
  const emit = (event: IngestProgressEvent) => opts.onIngestEvent?.(event);
  const model = opts.model || MODEL_PARSE;
  const concurrency = opts.concurrency || PARSE_CONCURRENCY;
  const checksum = sha256(pptPath);

  const existing = findVersionByChecksum(checksum);
  if (existing) {
    emit({ eventType: 'skipped', stage: 'done', label: '文件已存在，跳过重复入库', progress: 100, message: existing.id });
    return { assetId: '', versionId: existing.id, pages: 0, skipped: true };
  }

  const ext = extname(pptPath).toLowerCase();
  const format = FMT_BY_EXT[ext] || 'ppt';
  mkdirSync(STORAGE_RAW, { recursive: true });
  const rawPath = resolve(STORAGE_RAW, `${checksum}${ext}`);
  copyFileSync(pptPath, rawPath);
  emit({ eventType: 'raw_saved', stage: 'saved', label: '文件已保存，准备文字识别', progress: 12 });

  const title = opts.title || basename(pptPath).replace(/\.[^.]+$/i, '');
  const assetId = createAsset({ sourceType: 'upload', title, assetType: format, format,
    industry: opts.industry, scenario: opts.scenario, group: opts.group, category: opts.category, sourceUrl: opts.sourceUrl });
  const versionId = createVersion({ assetId, version: 'v1', checksum, rawPath });
  const derived = resolve(STORAGE_DERIVED, versionId);
  mkdirSync(derived, { recursive: true });

  try {
    emit({ eventType: 'parser_started', stage: 'text_extracting', label: '正在提取原生文本和渲染页面', progress: 18 });
    const data = await runParser(rawPath, derived);
    if (!data.ok) throw new Error('parser failed: ' + data.error);
    const slides: any[] = data.slides;
    let done = 0;
    let warnings = 0;
    emit({
      eventType: 'parser_done',
      stage: 'vlm_running',
      label: `文字识别完成，开始 VLM 图文识别（共 ${slides.length} 页）`,
      progress: slides.length ? 30 : 70,
      totalPages: slides.length,
    });

    await pool(slides, concurrency, async (slide) => {
      let vj: any;
      try {
        emit({
          eventType: 'vlm_started',
          stage: 'vlm_running',
          label: `正在识别第 ${slide.slide_no} 页`,
          progress: 30 + (done / Math.max(slides.length, 1)) * 58,
          pageNo: slide.slide_no,
          totalPages: slides.length,
        });
        vj = await analyzeVlm(slide.image, slide.text, slide.slide_no, model);
      } catch {
        try {
          vj = await analyzeVlm(slide.image, slide.text, slide.slide_no, model);
        } catch (e2) {
          vj = { title: '', slide_type: '其他', needs_review: true, confidence: 0, _fallback: String(e2) };
          warnings++;
          emit({
            eventType: 'vlm_warning',
            stage: 'vlm_running',
            label: `第 ${slide.slide_no} 页 VLM 识别失败，已标记待复核`,
            progress: 30 + (done / Math.max(slides.length, 1)) * 58,
            pageNo: slide.slide_no,
            totalPages: slides.length,
            message: String(e2),
          });
        }
      }
      const unitId = createUnit({
        versionId, slideNo: slide.slide_no, imagePath: slide.image, rawText: slide.text || '',
        visualJson: JSON.stringify(vj), title: vj.title, slideType: vj.slide_type,
        conclusion: vj.one_sentence_conclusion, visualSummary: vj.visual_summary,
        confidence: typeof vj.confidence === 'number' ? vj.confidence : undefined,
        needsReview: !!vj.needs_review,
      });
      const conf = typeof vj.confidence === 'number' ? vj.confidence : undefined;
      const needs = !!vj.needs_review;
      for (const ch of buildChunks(vj, slide)) {
        createChunk({
          unitId, text: ch.text, chunkType: ch.chunkType,
          sourceMethod: ch.sourceMethod, confidence: conf, needsReview: needs, parentUnitId: unitId,
        });
      }
      done++;
      opts.onProgress?.(done, slides.length, slide.slide_no);
      emit({
        eventType: 'vlm_page_done',
        stage: 'vlm_running',
        label: `已完成第 ${slide.slide_no} 页图文识别`,
        progress: 30 + (done / Math.max(slides.length, 1)) * 58,
        pageNo: slide.slide_no,
        totalPages: slides.length,
      });
    });

    emit({ eventType: 'indexing_started', stage: 'indexing', label: '正在写入知识单元和索引', progress: 92, totalPages: slides.length, payload: { warnings } });
    setVersionStatus(versionId, 'done', slides.length);
    setAssetStatus(assetId, 'published'); // demo：解析完成即可检索
    // 异步触发基于内容的行业/业务类型分类，不阻塞解析流程本身；classifyAssetContent 内部已全程 try/catch，
    // 这里的 .catch(() => {}) 是双重保险，防止意料之外的同步抛错影响 parseAndStore。
    classifyAssetContent(assetId, title).catch(() => {});
    emit({ eventType: 'done', stage: 'done', label: warnings ? '入库完成，部分页面需复核' : '入库完成', progress: 100, totalPages: slides.length, payload: { warnings } });
    return { assetId, versionId, pages: slides.length };
  } catch (e) {
    setVersionStatus(versionId, 'failed', undefined, String(e));
    setAssetStatus(assetId, 'failed');
    emit({ eventType: 'failed', stage: 'failed', label: '识别失败', progress: 100, message: String(e) });
    throw e;
  }
}
