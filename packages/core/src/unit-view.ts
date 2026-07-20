// 把一行 units 记录（含 visual_json）+ 可选演讲者备注，组装成前端可直接渲染的单页视图。
// 纯函数：不触库、不触 fs，便于单测。解析失败/缺字段一律兜底，绝不抛错。

export interface NumberFact {
  value?: string;
  unit?: string;
  metric?: string;
  context?: string;
}

export interface ArchNode {
  name?: string;
  role?: string;
  source_text?: string;
}

// 一行 units 记录（SELECT 出来的形状，字段可能为 null）
export interface UnitRow {
  id?: string;
  slide_no: number;
  image_path: string;
  title?: string | null;
  slide_type?: string | null;
  conclusion?: string | null;
  visual_summary?: string | null;
  confidence?: number | null;
  needs_review?: number | null;
  raw_text?: string | null;
  visual_json?: string | null;
}

// 前端渲染用的干净视图
export interface UnitView {
  id: string;
  slide_no: number;
  image_path: string;
  title: string;
  slide_type: string;
  conclusion: string;
  visual_summary: string;
  confidence: number;
  needs_review: number;
  raw_text: string;
  ocr_text_exact: string;
  image_understanding: string;
  numbers_with_units: NumberFact[];
  architecture_nodes: ArchNode[];
  key_facts: string[];
  review_reasons: string[];
  speaker_notes: string;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function safeParse(visualJson: string | null | undefined): Record<string, any> {
  if (!visualJson) return {};
  try {
    const o = JSON.parse(visualJson);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

export function assembleUnitView(row: UnitRow, speakerNotes?: string | null): UnitView {
  const v = safeParse(row.visual_json);
  return {
    id: row.id || "",
    slide_no: row.slide_no,
    image_path: row.image_path,
    // 已有列优先，缺失回退 visual_json
    title: row.title || v.title || "",
    slide_type: row.slide_type || v.slide_type || "",
    conclusion: row.conclusion || v.one_sentence_conclusion || "",
    visual_summary: row.visual_summary || v.visual_summary || "",
    confidence: row.confidence ?? v.confidence ?? 0,
    needs_review: row.needs_review ?? 0,
    raw_text: row.raw_text || "",
    // 以下仅 visual_json 才有
    ocr_text_exact: v.ocr_text_exact || "",
    image_understanding: v.image_understanding || "",
    numbers_with_units: asArray<NumberFact>(v.numbers_with_units),
    architecture_nodes: asArray<ArchNode>(v.architecture_nodes),
    key_facts: asArray<string>(v.key_facts),
    review_reasons: asArray<string>(v.review_reasons),
    speaker_notes: speakerNotes || "",
  };
}
