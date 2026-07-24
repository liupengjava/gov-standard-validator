export type StandardConstraint = 'must' | 'should' | 'may' | 'prohibit' | 'unknown';
export type StandardDimension =
  | 'material'
  | 'process'
  | 'resource'
  | 'security'
  | 'evaluation'
  | 'archive'
  | 'definition'
  | 'other';
export type StandardSourceMethod = 'native' | 'ocr' | 'mixed';

export type StandardChunk = {
  id: string;
  text: string;
  chunkType: string;
  standardNo?: string;
  standardName?: string;
  clauseNo?: string;
  clauseTitle?: string;
  chapterNo?: string;
  chapterTitle?: string;
  hierarchy: string[];
  constraint: StandardConstraint;
  dimension: StandardDimension;
  pageStart?: number;
  pageEnd?: number;
  sourceMethod: StandardSourceMethod;
  confidence: number;
  needsReview: boolean;
  qualityNotes: string[];
};

type ParsedHeading = {
  no: string;
  title: string;
  level: number;
  chunkType: string;
};

const STANDARD_NO_RE = /(GB|GA|DB|DL|HJ|JR|JT|NY|QB|SB|SL|SN|T|YD|YY|WS)(?:\/?T)?\s*\d+(?:\.\d+)?[-—]\d{4}/i;
const DOT_LEADER_RE = /(?:\.{5,}|…{2,}|·{5,}|\. \. \.)/;
const PAGE_NO_RE = /^(?:第\s*)?\d+\s*(?:页)?$|^--\s*\d+\s+of\s+\d+\s*--$/i;

function normalizeStandardNo(raw: string): string | undefined {
  const compact = raw.replace(/\s+/g, '').replace(/[－–]/g, '-');
  const match = compact.match(STANDARD_NO_RE);
  if (!match) return undefined;
  return match[0]
    .replace(/—/g, '-')
    .replace(/^(GB|GA|DB|DL|HJ|JR|JT|NY|QB|SB|SL|SN|T|YD|YY|WS)T/i, '$1/T')
    .replace(/(\D)(\d)/, '$1 $2')
    .toUpperCase();
}

function normalizeText(text: string): string {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/(?<=[\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, '')
    .replace(/([A-Z])\s+([A-Z])\s*(?=\/)/gi, '$1$2')
    .replace(/\/\s+T/g, '/T')
    .replace(/(\d)\s+([—-])\s+(\d{4})/g, '$1$2$3');
}

function isCatalogLine(line: string): boolean {
  if (!DOT_LEADER_RE.test(line)) return false;
  if (/\d\s*$/.test(line)) return true;
  return /^(?:前言|引言|附录|参考文献|\d+(?:\.\d+)*\s+|[A-Z]\.\d+)/.test(line);
}

function splitInlineClauseHeadings(line: string): string[] {
  let working = line
    .replace(/([。；;])(?=\d+\.\d+(?:\.\d+)*\s+[\u4e00-\u9fffA-Za-z])/g, '$1\n')
    .replace(/\s+(?=\d+\.\d+(?:\.\d+)*\s+[\u4e00-\u9fffA-Za-z])/g, '\n')
    .replace(/^(\d+)\s+(.+?)\s+(?=\d+\.\d+(?:\.\d+)*\s+[\u4e00-\u9fffA-Za-z])/, '$1 $2\n');
  const parts = working
    .split('\n')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [line];
}

function buildLines(rawText: string): string[] {
  const normalized = normalizeText(rawText);
  const rawLines = normalized
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .flatMap(splitInlineClauseHeadings)
    .filter(Boolean);
  const counts = new Map<string, number>();
  rawLines.forEach((line) => counts.set(line, (counts.get(line) || 0) + 1));
  return rawLines.filter((line) => {
    if (PAGE_NO_RE.test(line)) return false;
    if (isCatalogLine(line)) return false;
    if ((counts.get(line) || 0) >= 3 && line.length <= 48) return false;
    return true;
  });
}

function inferStandardName(lines: string[], standardNo?: string, title?: string): string | undefined {
  const titleName = title?.replace(/\.[^.]+$/i, '').replace(/[_-]/g, ' ').trim();
  const titleMatch = titleName?.match(/[\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9（）()·\s]{5,}/);
  if (titleMatch) return titleMatch[0].trim();

  const noIndex = standardNo ? lines.findIndex((line) => normalizeStandardNo(line) === standardNo) : -1;
  const candidates = (noIndex >= 0 ? lines.slice(noIndex + 1, noIndex + 5) : lines.slice(0, 8))
    .filter((line) => /[\u4e00-\u9fff]/.test(line))
    .filter((line) => !parseHeading(line))
    .filter((line) => !/^(中华人民共和国|国家标准|行业标准|ICS|[A-Z]\s*\d+|发布|实施)/.test(line));
  return candidates[0];
}

function parseHeading(line: string): ParsedHeading | undefined {
  const appendix = line.match(/^附录\s*([A-ZＡ-Ｚ])(?:\s+(.+))?$/i);
  if (appendix) {
    const no = `附录${appendix[1].toUpperCase()}`;
    return { no, title: (appendix[2] || '').trim(), level: 1, chunkType: 'appendix' };
  }

  const appendixClause = line.match(/^([A-Z])\.(\d+(?:\.\d+)*)\s*(.*)$/i);
  if (appendixClause) {
    const no = `${appendixClause[1].toUpperCase()}.${appendixClause[2]}`;
    return { no, title: appendixClause[3].trim(), level: no.split('.').length, chunkType: 'appendix_clause' };
  }

  const numbered = line.match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
  if (!numbered) return undefined;
  const no = numbered[1];
  const title = numbered[2].trim();
  if (!/[\u4e00-\u9fffA-Za-z]/.test(title)) return undefined;
  const level = no.includes('.') ? no.split('.').length : 1;
  return { no, title, level, chunkType: chunkTypeForHeading(no, title) };
}

function chunkTypeForHeading(no: string, title: string): string {
  if (/范围/.test(title) && no === '1') return 'scope';
  if (/规范性引用文件|引用文件/.test(title)) return 'normative_reference';
  if (/术语|定义/.test(title)) return 'term_definition';
  if (/附录/.test(title)) return 'appendix';
  if (/表\d+|^表\s*\d+/.test(title)) return 'table';
  return no.includes('.') ? 'requirement_clause' : 'chapter';
}

function inferConstraint(text: string): StandardConstraint {
  if (/不得|禁止|严禁/.test(text)) return 'prohibit';
  if (/必须|应当|应/.test(text)) return 'must';
  if (/宜|建议/.test(text)) return 'should';
  if (/可以|可/.test(text)) return 'may';
  return 'unknown';
}

function inferDimension(text: string, chunkType: string): StandardDimension {
  if (chunkType === 'term_definition') return 'definition';
  if (/材料|补正|纸质|提交|申请/.test(text)) return 'material';
  if (/安全|敏感|脱敏|权限|保密|日志/.test(text)) return 'security';
  if (/评价|投诉|满意|反馈|回访|好差评/.test(text)) return 'evaluation';
  if (/归档|档案|记录|留痕/.test(text)) return 'archive';
  if (/流程|办理|受理|预审|渠道|网上|线下|窗口|进度|服务/.test(text)) return 'process';
  if (/目录|资源|数据|接口|字段|系统|平台|设备|终端/.test(text)) return 'resource';
  return 'other';
}

function qualityFor(text: string, sourceMethod: StandardSourceMethod, hasHeading: boolean): { confidence: number; needsReview: boolean; notes: string[] } {
  const notes: string[] = [];
  let confidence = sourceMethod === 'ocr' ? 0.82 : 0.96;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const replacement = (text.match(/[�□]/g) || []).length;
  if (text.length < 24 && !hasHeading) {
    confidence -= 0.25;
    notes.push('chunk_too_short');
  }
  if (replacement > 0 || (text.length > 20 && cjk / text.length < 0.15)) {
    confidence -= 0.25;
    notes.push('possible_ocr_noise');
  }
  confidence = Math.max(0.1, Math.min(1, Number(confidence.toFixed(2))));
  return { confidence, needsReview: confidence < 0.75 || notes.length > 0, notes };
}

function displayHeading(heading: ParsedHeading): string {
  return `${heading.no}${heading.title ? ` ${heading.title}` : ''}`.trim();
}

export function chunkStandardDocument(input: {
  text: string;
  title?: string;
  sourceMethod?: StandardSourceMethod;
}): StandardChunk[] {
  const lines = buildLines(input.text);
  if (!lines.length) return [];

  const standardNo = normalizeStandardNo(lines.join('\n'));
  const standardName = inferStandardName(lines, standardNo, input.title);
  const sourceMethod = input.sourceMethod || 'native';
  const chunks: StandardChunk[] = [];
  const stack: ParsedHeading[] = [];
  let current: { heading: ParsedHeading; body: string[]; hasChild: boolean } | undefined;

  const flush = () => {
    if (!current) return;
    const headingText = displayHeading(current.heading);
    const body = current.body.join('\n').trim();
    if (!body && current.hasChild && current.heading.level > 1) {
      current = undefined;
      return;
    }
    const hierarchy = stack.map(displayHeading);
    if (!hierarchy.some((item) => item.startsWith(current!.heading.no))) hierarchy.push(headingText);
    const fullText = [standardNo, standardName, ...hierarchy, body].filter(Boolean).join(' > ').replace(/\n >/g, '\n');
    const quality = qualityFor(fullText, sourceMethod, true);
    const chapter = stack.find((item) => item.level === 1) || current.heading;
    chunks.push({
      id: `STD-${String(chunks.length + 1).padStart(4, '0')}`,
      text: fullText,
      chunkType: current.heading.chunkType,
      standardNo,
      standardName,
      clauseNo: current.heading.no,
      clauseTitle: current.heading.title,
      chapterNo: chapter.no,
      chapterTitle: chapter.title,
      hierarchy,
      constraint: inferConstraint(fullText),
      dimension: inferDimension(fullText, current.heading.chunkType),
      sourceMethod,
      confidence: quality.confidence,
      needsReview: quality.needsReview,
      qualityNotes: quality.notes,
    });
    current = undefined;
  };

  for (const line of lines) {
    const heading = parseHeading(line);
    if (heading) {
      if (current && heading.level > current.heading.level) current.hasChild = true;
      flush();
      while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
      stack.push(heading);
      current = { heading, body: [], hasChild: false };
      continue;
    }
    if (!current) continue;
    current.body.push(line);
  }
  flush();

  return chunks;
}
