// docx 文档式入库：段落文字直接入库(doc chunk)，嵌入图交给 VLM（image 单元）。
// 不渲染页图、不每页 VLM——文档型内容文字为主，图片才需要视觉理解。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, resolve, extname } from 'node:path';
import { ROOT, PYTHON, STORAGE_RAW, STORAGE_DERIVED, MODEL_PARSE, PARSE_CONCURRENCY } from './config.ts';
import { analyzeSlide } from './ai-cli.ts';
import { buildChunks } from './parsing.ts';
import { splitSections } from './feishu.ts';
import {
  createAsset, createVersion, createUnit, createChunk,
  findVersionByChecksum, setVersionStatus, setAssetStatus,
} from './db.ts';

const pexec = promisify(execFile);
const PARSER_DOCX = resolve(ROOT, 'services/parser-py/parse_docx_doc.py');

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function pool<T>(items: T[], n: number, fn: (it: T, i: number) => Promise<void>): Promise<void> {
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, n), items.length || 1) }, async () => {
    while (idx < items.length) { const my = idx++; await fn(items[my], my); }
  }));
}

async function parseDocx(path: string, outdir: string): Promise<any> {
  const { stdout } = await pexec(PYTHON, [PARSER_DOCX, '--in', path, '--outdir', outdir], { maxBuffer: 16 * 1024 * 1024, timeout: 300000 });
  const rp = stdout.trim().split('\n').pop()!.trim();
  return JSON.parse(readFileSync(rp, 'utf-8'));
}

export type DocxIngestOpts = {
  title?: string; group?: string; category?: string; industry?: string;
  model?: string; concurrency?: number; withImages?: boolean;
  onProgress?: (done: number, total: number) => void;
};

export async function ingestDocxDoc(docxPath: string, opts: DocxIngestOpts = {}) {
  const model = opts.model || MODEL_PARSE;
  const concurrency = opts.concurrency || PARSE_CONCURRENCY;
  const withImages = opts.withImages !== false;
  const checksum = sha256(docxPath);
  if (findVersionByChecksum(checksum)) return { skipped: true };

  mkdirSync(STORAGE_RAW, { recursive: true });
  const ext = extname(docxPath).toLowerCase();
  const rawPath = resolve(STORAGE_RAW, `${checksum}${ext}`);
  if (resolve(docxPath) !== rawPath) copyFileSync(docxPath, rawPath);

  const title = opts.title || basename(docxPath).replace(/\.[^.]+$/i, '');
  const assetId = createAsset({ sourceType: 'upload', title, assetType: 'docx', format: 'docx', industry: opts.industry, group: opts.group, category: opts.category });
  const versionId = createVersion({ assetId, version: 'v1', checksum, rawPath });
  const derived = resolve(STORAGE_DERIVED, versionId);
  mkdirSync(derived, { recursive: true });

  try {
    const data = await parseDocx(docxPath, derived);
    if (!data.ok) throw new Error('parse_docx failed: ' + (data.error || ''));

    // 1) 文字段（doc chunk，直接入库、不 VLM）
    const secs = splitSections(data.markdown || '');
    secs.forEach((s, i) => {
      const unitId = createUnit({ versionId, slideNo: i + 1, imagePath: '', rawText: s.text, visualJson: '{}', title: s.heading || (null as any), slideType: 'section' });
      const text = (s.heading ? s.heading + '。' : '') + s.text;
      if (text.trim()) createChunk({ unitId, text, chunkType: 'doc' });
    });

    // 2) 嵌入图 VLM（image 单元，slide_no 从 1000 起，区别于文字段）
    const imgs: string[] = withImages && Array.isArray(data.images) ? data.images : [];
    let done = 0;
    await pool(imgs, concurrency, async (imgPath, i) => {
      const n = i + 1;
      let vj: any = null;
      if (existsSync(imgPath)) {
        for (let a = 0; a < 3 && !vj; a++) { try { vj = await analyzeSlide(imgPath, '', n, model); } catch { vj = null; } }
      }
      if (!vj) vj = { title: '', slide_type: 'image', needs_review: true, confidence: 0, _fallback: 'vlm_json_failed' };
      const conf = typeof vj.confidence === 'number' ? vj.confidence : undefined;
      const needs = !!vj.needs_review;
      const unitId = createUnit({ versionId, slideNo: 1000 + n, imagePath: imgPath, rawText: '', visualJson: JSON.stringify(vj), title: vj.title, slideType: 'image', conclusion: vj.one_sentence_conclusion, visualSummary: vj.visual_summary, confidence: conf, needsReview: needs });
      for (const ch of buildChunks(vj, { text: '', tables: [], notes: '' })) {
        createChunk({ unitId, text: ch.text, chunkType: ch.chunkType, sourceMethod: ch.sourceMethod, confidence: conf, needsReview: needs, parentUnitId: unitId });
      }
      done++;
      opts.onProgress?.(done, imgs.length);
    });

    setVersionStatus(versionId, 'done', secs.length);
    setAssetStatus(assetId, 'published');
    return { assetId, versionId, sections: secs.length, images: imgs.length };
  } catch (e) {
    setVersionStatus(versionId, 'failed', undefined, String(e));
    setAssetStatus(assetId, 'failed');
    throw e;
  }
}
