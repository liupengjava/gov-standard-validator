// 特殊格式入库：Markdown 文本 / 单张图片 VLM。
// 复用现有原语，自带 checksum 去重（与 parseAndStore / ingestFeishuDoc 一致）。
// xlsx 请先转成 .md 再走 ingestMarkdownFile（转换在 ingest 脚本里用 python 完成）。
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createAsset, createVersion, createUnit, createChunk,
  findVersionByChecksum, setVersionStatus, setAssetStatus,
} from './db.ts';
import { splitSections } from './feishu.ts';
import { buildChunks } from './parsing.ts';
import { analyzeSlide } from './ai-cli.ts';
import { MODEL_PARSE } from './config.ts';

export type SpecialOpts = { group: string; category?: string; sourceUrl?: string; title: string };
export type SpecialResult = { assetId: string; versionId: string; skipped?: boolean; units?: number };

// Markdown / 纯文本文件 → doc chunk（无 VLM）。
export function ingestMarkdownFile(path: string, opts: SpecialOpts): SpecialResult {
  const raw = readFileSync(path);
  const checksum = createHash('sha256').update(raw).digest('hex');
  const existing = findVersionByChecksum(checksum);
  if (existing) return { assetId: '', versionId: existing.id, skipped: true };

  const md = raw.toString('utf-8');
  const assetId = createAsset({
    sourceType: 'upload', title: opts.title, assetType: 'doc', format: 'docx',
    sourceUrl: opts.sourceUrl, group: opts.group, category: opts.category,
  });
  const versionId = createVersion({ assetId, version: 'v1', checksum, rawPath: resolve(path) });
  try {
    const secs = splitSections(md);
    let n = 0;
    for (const s of secs) {
      const text = (s.heading ? s.heading + '。' : '') + s.text;
      if (!text.trim()) continue;
      const unitId = createUnit({
        versionId, slideNo: ++n, imagePath: '', rawText: text,
        visualJson: '', title: s.heading || undefined, slideType: 'section',
      });
      createChunk({ unitId, text, chunkType: 'doc' });
    }
    setVersionStatus(versionId, 'done', n);
    setAssetStatus(assetId, 'published');
    return { assetId, versionId, units: n };
  } catch (e) {
    setVersionStatus(versionId, 'failed', undefined, String(e));
    setAssetStatus(assetId, 'failed');
    throw e;
  }
}

// 单张图片 → 一次 VLM（image 单元 + chunks + caption）。
export async function ingestImageFile(path: string, opts: SpecialOpts): Promise<SpecialResult> {
  const raw = readFileSync(path);
  const checksum = createHash('sha256').update(raw).digest('hex');
  const existing = findVersionByChecksum(checksum);
  if (existing) return { assetId: '', versionId: existing.id, skipped: true };

  const assetId = createAsset({
    sourceType: 'upload', title: opts.title, assetType: 'image', format: 'image',
    sourceUrl: opts.sourceUrl, group: opts.group, category: opts.category,
  });
  const versionId = createVersion({ assetId, version: 'v1', checksum, rawPath: resolve(path) });
  try {
    let vj: any = null;
    for (let i = 0; i < 3 && !vj; i++) {
      try { vj = await analyzeSlide(path, '', 1, MODEL_PARSE); } catch { vj = null; }
    }
    const unitId = createUnit({
      versionId, slideNo: 1, imagePath: resolve(path), rawText: '',
      visualJson: vj ? JSON.stringify(vj) : '', title: vj?.title,
      slideType: 'image', confidence: vj?.confidence, needsReview: !vj || !!vj?.needs_review,
    });
    let n = 0;
    for (const ch of buildChunks(vj || {}, { text: '' })) {
      createChunk({ unitId, text: ch.text, chunkType: ch.chunkType, sourceMethod: ch.sourceMethod });
      n++;
    }
    setVersionStatus(versionId, 'done', 1);
    setAssetStatus(assetId, 'published');
    return { assetId, versionId, units: 1 };
  } catch (e) {
    setVersionStatus(versionId, 'failed', undefined, String(e));
    setAssetStatus(assetId, 'failed');
    throw e;
  }
}
