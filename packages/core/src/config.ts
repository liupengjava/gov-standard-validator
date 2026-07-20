import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// packages/core/src -> repo root
export const ROOT = resolve(here, '../../..');

export const STORAGE_RAW = process.env.SP_STORAGE_RAW || resolve(ROOT, 'storage/raw');
export const STORAGE_DERIVED = process.env.SP_STORAGE_DERIVED || resolve(ROOT, 'storage/derived');
export const DB_PATH = process.env.SP_DB || resolve(ROOT, 'data/gov-standard-validator.db');
export const PARSER_PY = resolve(ROOT, 'services/parser-py/parse_ppt.py');
export const PARSER_DOC = resolve(ROOT, 'services/parser-py/parse_doc.py');
export const EMBED_PY = resolve(ROOT, 'services/parser-py/embed.py');
export const RERANK_PY = resolve(ROOT, 'services/parser-py/rerank.py');
export const PYTHON = process.env.SP_PYTHON || 'python3';

// 模型：解析(视觉)用便宜快的 sonnet，问答/生成用 opus
export const MODEL_PARSE = process.env.SP_MODEL_PARSE || 'sonnet';
export const MODEL_ANSWER = process.env.SP_MODEL_ANSWER || 'opus';
export const PARSE_CONCURRENCY = Number(process.env.SP_PARSE_CONCURRENCY || 4);
// 渲染清晰度：130 → 200（密集流程图/截图小字可读，PRD-0004 决策④；体积过大可经 SP_RENDER_DPI 退 180）
export const RENDER_DPI = Number(process.env.SP_RENDER_DPI || 200);
