import { chunkStandardDocument, type StandardChunk } from "@gov-validator/core/standard-chunker";
import type { PublicSignalEvidenceItem } from "./signal-collector";

export type Clause = {
  id: string;
  source: string;
  dimension: "材料" | "流程" | "资源" | "安全" | "评价";
  constraint: "应" | "宜" | "可";
  text: string;
  keywords: string[];
};

export type SignalSample = {
  id: string;
  source: string;
  region: string;
  type: string;
  text: string;
  status: string;
  confidence?: number;
  confidenceParts?: SignalImportConfidenceParts;
  matchedClauseId?: string;
  matchedClauseSource?: string;
  evaluationText?: string;
  reviewStatus?: string;
  sourceUrl?: string;
  pageTitle?: string;
  publishedAt?: string;
  capturedAt?: string;
  snapshotUrl?: string;
  evidenceStatus?: "real_collected" | "simulated" | "imported";
  evidenceChain?: PublicSignalEvidenceItem[];
};

export type SignalImportConfidenceParts = {
  relevance: number;
  completeness: number;
  comparability: number;
  dataQuality: number;
};

export type SignalImportCandidate = Omit<SignalSample, "id" | "status"> & {
  candidateId: string;
  confidence: number;
  confidenceParts: SignalImportConfidenceParts;
  matchedClauseId: string;
  matchedClauseSource: string;
  evaluationText: string;
  reviewStatus: string;
};

export function resetSignalSamplesForRetest(_signals: SignalSample[], _selectedSignalIndex: number): {
  signals: SignalSample[];
  selectedSignalIndex: number;
} {
  return { signals: [], selectedSignalIndex: 0 };
}

export type PersistentSearchSite = {
  id: string;
  name: string;
  url: string;
  category: string;
};

export function mergePersistentSearchSites<T extends PersistentSearchSite>(defaults: T[], persisted: T[]): T[] {
  const seen = new Set<string>();
  return defaults.concat(persisted).filter((site) => {
    const key = site.url.trim().replace(/\/+$/, "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const CLAUSE_SAMPLE =
  "材料不齐全时，窗口可以告知申请人补正材料；线上预审结果可供窗口参考，线下受理人员根据实际情况决定是否再次收取纸质材料。";

export const DRAFT_SAMPLE =
  "线上线下办理渠道应保持一致。材料不齐的，可以告知群众补正材料。服务大厅应做好窗口管理，相关单位应及时处理群众差评。涉及敏感数据的资源目录应做好安全管理。";

export const INITIAL_CLAUSES: Clause[] = [
  {
    id: "YC-8.3",
    source: "公安政务服务一窗通办工作规范",
    dimension: "材料",
    constraint: "应",
    text: "材料不全或存在问题的，应一次性告知申请人需补正的内容，线上线下办理记录保持一致。",
    keywords: ["材料", "一次性", "告知", "补正", "线上", "线下", "重复", "纸质"],
  },
  {
    id: "YC-6.2",
    source: "公安政务服务一窗通办工作规范",
    dimension: "资源",
    constraint: "应",
    text: "事项办理资源应满足一窗受理、综合服务和跨警种协同办理需要。",
    keywords: ["一窗", "资源", "综合", "协同", "跨警种", "受理"],
  },
  {
    id: "YC-7.1",
    source: "公安政务服务一窗通办工作规范",
    dimension: "流程",
    constraint: "宜",
    text: "服务大厅窗口、等候区、自助服务区、咨询引导区宜布局清晰，标识醒目。",
    keywords: ["大厅", "窗口", "排队", "标识", "等候", "自助", "引导"],
  },
  {
    id: "YC-10.2",
    source: "公安政务服务一窗通办工作规范",
    dimension: "评价",
    constraint: "应",
    text: "应畅通咨询、评价、投诉渠道，及时处理差评意见并组织回访反馈。",
    keywords: ["投诉", "差评", "回访", "评价", "反馈", "处理"],
  },
  {
    id: "ML-5.4",
    source: "公安政务服务信息资源目录管理规范",
    dimension: "资源",
    constraint: "应",
    text: "目录审核应验证数据接口规范、数据质量及与现有目录的语义一致性。",
    keywords: ["目录", "审核", "接口", "数据质量", "语义", "资源"],
  },
  {
    id: "ML-6.1",
    source: "公安政务服务信息资源目录管理规范",
    dimension: "安全",
    constraint: "应",
    text: "涉及敏感数据的资源目录应开展安全评估，并明确脱敏处理方案。",
    keywords: ["敏感", "安全", "脱敏", "评估", "泄露", "数据"],
  },
  {
    id: "GA-5.3",
    source: "GA/T 1593-2019 互联网+公安政务服务标准体系",
    dimension: "流程",
    constraint: "可",
    text: "互联网+公安政务服务应通过网上大厅、办事窗口、移动客户端、自助终端等渠道提供服务。",
    keywords: ["互联网", "网上", "移动", "自助", "终端", "渠道", "平台"],
  },
];

export const INITIAL_SIGNALS: SignalSample[] = [
  {
    id: "S-001",
    source: "12345 热线",
    region: "临平",
    type: "群众反馈",
    text: "线上预审已经通过，到了窗口又要求重新提交纸质材料，工作人员也没有一次性说清楚缺什么。",
    status: "待复核",
  },
  {
    id: "S-002",
    source: "窗口评价",
    region: "杭州",
    type: "现场体验",
    text: "大厅排队很久，屏幕只显示号码，看不出哪个窗口能办户籍、出入境或交管业务。",
    status: "待复核",
  },
  {
    id: "S-003",
    source: "政府网站留言",
    region: "浙江",
    type: "投诉建议",
    text: "投诉后没人回访，也不知道差评有没有处理，后续还是一样的问题。",
    status: "待复核",
  },
  {
    id: "S-004",
    source: "系统日志",
    region: "试点单位",
    type: "运行数据",
    text: "部分信息资源目录接口字段与既有目录语义不一致，审核退回率较高。",
    status: "待复核",
  },
  {
    id: "S-005",
    source: "问卷调研",
    region: "服务大厅",
    type: "调研样本",
    text: "老年人不会用自助机，现场缺少引导人员，最后仍要回到人工窗口办理。",
    status: "待复核",
  },
];

export const INTERFACE_SAMPLES: Record<string, string[]> = {
  警小爱: [
    "智能问答提示已完成线上预审，但窗口仍要求群众携带纸质材料。",
    "群众追问补正材料清单，机器人回答与窗口告知口径不一致。",
    "用户咨询办理进度，线上状态与窗口受理状态不同步。",
  ],
  警察叔叔: [
    "移动端上传材料失败，页面未说明失败原因和补正方式。",
    "户籍业务预约后到现场仍需重新排队取号。",
    "出入境业务材料说明与现场窗口要求存在差异。",
  ],
  浙里办: [
    "事项指南显示可线上办理，但实际提交后仍需到窗口确认。",
    "办件进度更新较慢，群众无法判断是否需要补充材料。",
    "同一事项在移动端和大厅屏幕显示的办理口径不一致。",
  ],
  民呼我为: [
    "群众反映大厅窗口标识不清，办理户籍和交管业务容易排错队。",
    "投诉后只显示已受理，没有回访结果和处理说明。",
    "老年人使用自助终端困难，现场引导人员不足。",
  ],
  杭州城市大脑政务服务: [
    "平台汇聚数据中发现部分服务事项材料字段缺少统一编码。",
    "跨平台办件状态同步延迟，影响群众查询体验。",
  ],
  杭州市一网通办平台: [
    "同一事项在区级入口和市级入口展示的办理材料不一致。",
    "线上办理入口跳转后缺少清晰的补正提示。",
  ],
  杭州公安政务服务网: ["网站事项指南与窗口公告版本不一致。", "群众留言集中反映办理流程说明过于笼统。"],
};

export function inferDimension(text: string): Clause["dimension"] {
  if (/材料|补正|纸质|上传/.test(text)) return "材料";
  if (/目录|资源|接口|字段|语义|数据质量/.test(text)) return "资源";
  if (/安全|敏感|脱敏|泄露|权限/.test(text)) return "安全";
  if (/评价|投诉|差评|回访|满意度/.test(text)) return "评价";
  return "流程";
}

export function inferConstraint(text: string): Clause["constraint"] {
  if (/不得|必须|应/.test(text)) return "应";
  if (/宜/.test(text)) return "宜";
  return "可";
}

export function keywordsFromText(text: string): string[] {
  const dict = [
    "材料",
    "一次性",
    "告知",
    "补正",
    "线上",
    "线下",
    "目录",
    "审核",
    "接口",
    "数据质量",
    "语义",
    "敏感",
    "安全",
    "脱敏",
    "评价",
    "投诉",
    "回访",
    "窗口",
    "自助",
    "平台",
    "流程",
    "资源",
  ];
  const hits = dict.filter((kw) => text.includes(kw));
  return hits.length ? hits : [inferDimension(text)];
}

function dimensionFromStandardChunk(chunk: StandardChunk): Clause["dimension"] {
  const mapped: Record<StandardChunk["dimension"], string> = {
    material: "材料",
    process: "流程",
    resource: "资源",
    security: "安全",
    evaluation: "评价",
    archive: "流程",
    definition: "流程",
    other: "流程",
  };
  return mapped[chunk.dimension] as Clause["dimension"];
}

function constraintFromStandardChunk(chunk: StandardChunk): Clause["constraint"] {
  const mapped: Record<StandardChunk["constraint"], string> = {
    must: "应",
    prohibit: "应",
    should: "宜",
    may: "可",
    unknown: "可",
  };
  return mapped[chunk.constraint] as Clause["constraint"];
}

function standardChunkKeywords(chunk: StandardChunk): string[] {
  const tokens = [
    chunk.standardNo,
    chunk.standardName,
    chunk.chapterTitle,
    chunk.clauseTitle,
    ...chunk.hierarchy,
    dimensionFromStandardChunk(chunk),
    constraintFromStandardChunk(chunk),
  ].filter((item): item is string => !!item && item.trim().length > 0);
  const dictionaryHits = keywordsFromText(chunk.text);
  return [...new Set([...tokens, ...dictionaryHits])].slice(0, 14);
}

export function sliceKnowledgeText(raw: string, sourceType = "上传标准文本", baseCount = 0): Clause[] {
  const chunks = chunkStandardDocument({ text: raw, title: sourceType });
  return chunks.map((chunk, index) => ({
    id: chunk.clauseNo || `UP-${String(baseCount + index + 1).padStart(3, "0")}`,
    source: chunk.standardName || sourceType,
    dimension: dimensionFromStandardChunk(chunk),
    constraint: constraintFromStandardChunk(chunk),
    text: chunk.text,
    keywords: standardChunkKeywords(chunk),
  }));
}

export type DraftTextSliceStatus = "pending" | "confirmed";

export type DraftTextSlice = {
  id: string;
  title: string;
  text: string;
  sourceName: string;
  charCount: number;
  status: DraftTextSliceStatus;
};

function isExtractedTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 0 && /^[|｜\s:-]+$/.test(trimmed) && /[|｜]/.test(trimmed);
}

function extractedTableCells(line: string): string[] {
  return line
    .split(/[|｜]/)
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function isConcreteTableClauseLine(line: string): boolean {
  const cells = extractedTableCells(line);
  return cells.length >= 2 && /^\d+$/.test(cells[0]) && /[\u4e00-\u9fa5A-Za-z]/.test(cells[1]);
}

function restoreSplitTableNumbers(lines: string[]): string[] {
  const restored: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index]?.trim() || "";
    const next = lines[index + 1]?.trim() || "";
    if (/^\d+$/.test(current) && /^\d+\s*[|｜]/.test(next)) {
      restored.push(`${current}${next}`);
      index += 1;
      continue;
    }
    restored.push(current);
  }
  return restored;
}

function buildTableDraftSlices(lines: string[], sourceName: string): DraftTextSlice[] {
  const blocks: { title: string; parts: string[] }[] = [];

  for (const line of restoreSplitTableNumbers(lines)) {
    if (!line || isExtractedTableSeparator(line)) continue;
    if (isConcreteTableClauseLine(line)) {
      const cells = extractedTableCells(line);
      const title = `${cells[0]} ${cells.slice(1, 3).join(" | ")}`;
      blocks.push({ title, parts: [cells.join(" | ")] });
      continue;
    }
    if (blocks.length && !/^\d+$/.test(line)) {
      blocks[blocks.length - 1].parts.push(line);
    }
  }

  if (blocks.length < 2) return [];
  return blocks.map((block, index) => {
    const text = block.parts.join("\n").trim();
    return {
      id: `DV-${String(index + 1).padStart(3, "0")}`,
      title: block.title,
      text,
      sourceName,
      charCount: text.length,
      status: "pending",
    };
  });
}

function isDraftClauseHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || /^\d+$/.test(trimmed) || isExtractedTableSeparator(trimmed) || /^\d+\s*[|｜]/.test(trimmed)) return false;
  return /^(?:第[一二三四五六七八九十百零〇\d]+条|[一二三四五六七八九十]+、|\d+(?:\.\d+)*[、.．]?\s+).+/.test(trimmed);
}

export function sliceDraftTextForReview(text: string, sourceName = "待验证文本"): DraftTextSlice[] {
  const cleanText = normalizeWhitespace(text || DRAFT_SAMPLE);
  const lines = cleanText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const tableSlices = buildTableDraftSlices(lines, sourceName);
  if (tableSlices.length) return tableSlices;

  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (isDraftClauseHeading(line) && current.length) {
      blocks.push(current.join("\n"));
      current = [line];
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));
  const candidates = blocks.length > 1 ? blocks : lines.filter((line) => !/^\d+$/.test(line) && !isExtractedTableSeparator(line));

  return candidates.map((block, index) => {
    const [firstLine = "", ...rest] = block.split(/\n+/);
    const hasHeading = isDraftClauseHeading(firstLine);
    const textBody = hasHeading && rest.length ? rest.join("\n") : block;
    return {
      id: `DV-${String(index + 1).padStart(3, "0")}`,
      title: hasHeading ? firstLine.trim() : `切片 ${index + 1}`,
      text: textBody.trim(),
      sourceName,
      charCount: textBody.trim().length,
      status: "pending",
    };
  });
}

export type KnowledgeCatalogSearchTaskStatus = "待检索" | "检索中" | "已获取";

export type KnowledgeCatalogSearchTask = {
  id: string;
  fileName: string;
  status: KnowledgeCatalogSearchTaskStatus;
  searchUrl: string;
  sourceSite: string;
  addedAt: string;
  matchedTitle?: string;
  message: string;
};

export function buildKnowledgeCatalogSearchTasks(catalog: string, addedAt: string): KnowledgeCatalogSearchTask[] {
  return catalog
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((fileName, index) => {
      const query = `${fileName} PDF 标准`;
      return {
        id: `KCS-${String(index + 1).padStart(3, "0")}`,
        fileName,
        status: "待检索",
        searchUrl: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
        sourceSite: "互联网检索",
        addedAt,
        message: "已生成检索任务，待打开互联网获取文件。",
      };
    });
}

export type KnowledgeFileSourceType = "upload" | "web";
export type KnowledgeVectorStatus = "待构建" | "构建中" | "已完成";

export type KnowledgeFileAsset = {
  id: string;
  name: string;
  sourceType: KnowledgeFileSourceType;
  sourceLabel: string;
  addedAt: string;
  sliceCount: number;
  vectorProgress: number;
  vectorStatus: KnowledgeVectorStatus;
  vectorLogs: string[];
  accessCount: number;
  callCount: number;
  lastAccessedAt?: string;
  lastCalledAt?: string;
};

function knowledgeFileId(name: string, addedAt: string): string {
  const seed = `${name}-${addedAt}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return `KF-${hash.toString(36).padStart(8, "0")}`;
}

export function buildKnowledgeFileAsset({
  name,
  sourceType,
  sourceLabel,
  addedAt,
  sliceCount,
  vectorProgress = 0,
}: {
  name: string;
  sourceType: KnowledgeFileSourceType;
  sourceLabel: string;
  addedAt: string;
  sliceCount: number;
  vectorProgress?: number;
}): KnowledgeFileAsset {
  const progress = Math.max(0, Math.min(100, Math.round(vectorProgress)));
  return {
    id: knowledgeFileId(name, addedAt),
    name,
    sourceType,
    sourceLabel,
    addedAt,
    sliceCount,
    vectorProgress: progress,
    vectorStatus: progress >= 100 ? "已完成" : progress > 0 ? "构建中" : "待构建",
    vectorLogs: [
      `${addedAt} 文件加入知识库：${name}`,
      sliceCount > 0
        ? `${addedAt} 已生成 ${sliceCount} 个知识切片，向量构建进度 ${progress}%`
        : `${addedAt} 待自动切分知识切片，向量构建进度 ${progress}%`,
    ],
    accessCount: 0,
    callCount: 0,
  };
}

function knowledgeFileStandardName(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
}

export function buildKnowledgeFileAutoSlices(asset: KnowledgeFileAsset, baseCount = 0, desiredCount?: number): Clause[] {
  const standardName = knowledgeFileStandardName(asset.name);
  const candidateCount = desiredCount ?? (asset.sliceCount || Math.ceil(standardName.length * 1.2));
  const count = Math.max(3, Math.min(28, candidateCount));
  const templates: Array<{ dimension: Clause["dimension"]; constraint: Clause["constraint"]; text: string; keywords: string[] }> = [
    {
      dimension: "材料",
      constraint: "应",
      text: "材料清单应与线上申请、窗口受理和补正告知要求保持一致，避免重复提交。",
      keywords: ["材料", "补正", "一次性", "告知", "检索"],
    },
    {
      dimension: "流程",
      constraint: "应",
      text: "事项办理流程应明确申请、受理、审核、办结和反馈环节，并保留过程记录。",
      keywords: ["流程", "受理", "审核", "反馈", "检索"],
    },
    {
      dimension: "资源",
      constraint: "宜",
      text: "服务资源、目录字段和数据接口宜统一编码，支撑跨系统协同调用。",
      keywords: ["资源", "目录", "接口", "数据质量", "检索"],
    },
    {
      dimension: "安全",
      constraint: "应",
      text: "涉及敏感数据、身份信息和办理记录的资源应开展安全评估并落实脱敏处理。",
      keywords: ["安全", "敏感", "脱敏", "权限", "检索"],
    },
    {
      dimension: "评价",
      constraint: "应",
      text: "应建立咨询、评价、投诉和回访机制，及时处理差评意见并形成闭环记录。",
      keywords: ["评价", "投诉", "回访", "差评", "检索"],
    },
  ];

  return Array.from({ length: count }, (_, index) => {
    const template = templates[index % templates.length];
    return {
      id: `WEB-${String(baseCount + index + 1).padStart(3, "0")}`,
      source: standardName,
      dimension: template.dimension,
      constraint: template.constraint,
      text: `${standardName}：${template.text}`,
      keywords: [...new Set([standardName, ...template.keywords])].slice(0, 12),
    };
  });
}

export function updateKnowledgeVectorBuild(asset: KnowledgeFileAsset, at: string): KnowledgeFileAsset {
  return {
    ...asset,
    vectorProgress: 100,
    vectorStatus: "已完成",
    vectorLogs: asset.vectorLogs.concat(`${at} 向量索引构建完成，可进入验证召回。`),
  };
}

export function nextKnowledgeVectorBuildStep(asset: KnowledgeFileAsset, at: string, targetProgress?: number): KnowledgeFileAsset {
  const nextProgress = Math.max(
    asset.vectorProgress,
    Math.min(100, Math.round(targetProgress ?? asset.vectorProgress + 20))
  );
  if (nextProgress >= 100) return updateKnowledgeVectorBuild({ ...asset, vectorProgress: nextProgress }, at);
  return {
    ...asset,
    vectorProgress: nextProgress,
    vectorStatus: nextProgress > 0 ? "构建中" : "待构建",
    vectorLogs: asset.vectorLogs.concat(`${at} 向量构建推进至 ${nextProgress}%，正在生成条款语义索引。`),
  };
}

export function recordKnowledgeFileUsage(asset: KnowledgeFileAsset, usage: "access" | "call", at: string): KnowledgeFileAsset {
  return {
    ...asset,
    accessCount: asset.accessCount + 1,
    callCount: usage === "call" ? asset.callCount + 1 : asset.callCount,
    lastAccessedAt: at,
    lastCalledAt: usage === "call" ? at : asset.lastCalledAt,
    vectorLogs: asset.vectorLogs.concat(`${at} ${usage === "call" ? "验证任务调用" : "用户访问"}：${asset.name}`),
  };
}

export function knowledgeClauseKey(clause: Pick<Clause, "source" | "id">): string {
  return `${clause.source}::${clause.id}`;
}

function clauseMatchesSemanticQuery(clause: Clause, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  const haystack = [clause.id, clause.source, clause.dimension, clause.constraint, clause.text, ...clause.keywords].join(" ").toLowerCase();
  if (haystack.includes(normalizedQuery)) return true;
  const queryTokens = normalizedQuery.split(/[\s,，;；、|/]+/).filter(Boolean);
  if (queryTokens.length > 1 && queryTokens.some((token) => haystack.includes(token))) return true;
  return clause.keywords.some((keyword) => normalizedQuery.includes(keyword.toLowerCase()) || keyword.toLowerCase().includes(normalizedQuery));
}

export function filterVectorKnowledgeClauses({
  clauses,
  knowledgeFiles,
  clauseAssetIds,
  query,
  dimension,
}: {
  clauses: Clause[];
  knowledgeFiles: KnowledgeFileAsset[];
  clauseAssetIds: Record<string, string>;
  query: string;
  dimension: string;
}): Clause[] {
  const completedAssetIds = new Set(knowledgeFiles.filter((file) => file.vectorStatus === "已完成").map((file) => file.id));
  return clauses.filter((clause) => {
    const assetId = clauseAssetIds[knowledgeClauseKey(clause)];
    if (!assetId || !completedAssetIds.has(assetId)) return false;
    if (dimension !== "全部" && clause.dimension !== dimension) return false;
    return clauseMatchesSemanticQuery(clause, query);
  });
}

function tokenizeText(text: string, clauses: Clause[]): Set<string> {
  const normalized = text.replace(/[，。；：、“”‘’（）()]/g, " ");
  const tokens = new Set<string>();
  clauses.forEach((clause) => clause.keywords.forEach((kw) => normalized.includes(kw) && tokens.add(kw)));
  ["应", "宜", "可", "不得", "必须", "一次性", "告知", "脱敏", "审核", "回访", "纸质", "线上", "线下"].forEach(
    (kw) => normalized.includes(kw) && tokens.add(kw)
  );
  return tokens;
}

export type MatchResult = {
  targetText: string;
  clause: Clause;
  overlap: string[];
  similarity: number;
  issues: string[];
  parts: { relation: number; standardization: number; completeness: number; conflict: number; executable: number };
  score: number;
  conclusion: string;
};

export function compareStandardText(text: string, clauses: Clause[]): MatchResult {
  const tokens = tokenizeText(text, clauses);
  const scored = clauses
    .map((clause) => {
      const clauseTokens = new Set([...clause.keywords, clause.dimension, clause.constraint]);
      const overlap = [...tokens].filter((kw) => clauseTokens.has(kw) || clause.text.includes(kw));
      const keywordScore = overlap.length * 10;
      const dimensionScore = text.includes(clause.dimension) ? 12 : 0;
      const constraintScore = text.includes(clause.constraint) ? 8 : 0;
      const sourceScore =
        clause.source.includes("一窗通办") && (text.includes("窗口") || text.includes("材料") || text.includes("线上")) ? 8 : 0;
      const similarity = Math.min(98, 35 + keywordScore + dimensionScore + constraintScore + sourceScore);
      return { clause, overlap, similarity };
    })
    .sort((a, b) => b.similarity - a.similarity);
  const best = scored[0];
  const issues: string[] = [];
  if ((text.includes("可以") || text.includes("可供") || text.includes("根据实际情况")) && best.clause.constraint === "应")
    issues.push("待验证条款弱化了数据库中强制性要求，存在约束强度不足风险。");
  if ((text.includes("材料") || text.includes("补正")) && !text.includes("一次性"))
    issues.push("材料补正场景缺少“一次性告知”要求，可能导致窗口多次告知。");
  if (text.includes("纸质") && !text.includes("记录")) issues.push("涉及线下重复收取纸质材料，但缺少线上线下记录一致和留痕要求。");
  if (text.includes("敏感") && !text.includes("脱敏")) issues.push("涉及敏感数据但缺少脱敏处理方案。");
  if (!issues.length) issues.push("未发现明显冲突，建议补充责任主体、证据材料和验收口径后进入专家复核。");

  const parts = {
    relation: Math.min(35, Math.round(best.similarity * 0.35)),
    standardization: text.includes("应") ? 18 : text.includes("可以") ? 11 : 14,
    completeness: issues.length > 2 ? 12 : issues.length === 2 ? 15 : 18,
    conflict: issues.some((item) => item.includes("弱化") || item.includes("风险")) ? 12 : 17,
    executable: text.includes("责任") || text.includes("留痕") || text.includes("记录") ? 18 : 13,
  };
  const score = Math.min(98, Math.round(parts.relation + parts.standardization + parts.completeness + parts.conflict + parts.executable));
  const conclusion = score >= 85 ? "基本一致，建议小幅补充" : score >= 70 ? "部分一致，建议修订后复核" : "差异较大，建议重点复核";
  return { targetText: text, ...best, issues, parts, score, conclusion };
}

export function validateDraft(text: string): [string, string, string][] {
  const issues: [string, string, string][] = [];
  if (!text.includes("一次性告知") && (text.includes("补正") || text.includes("材料"))) {
    issues.push(["高", "材料补正表述不完整", "建议明确“应一次性告知申请人需补正的内容”，避免窗口多次告知。"]);
  }
  if (text.includes("可以告知") || text.includes("可告知")) {
    issues.push(["中", "约束强度偏弱", "涉及群众权利和窗口义务的要求，建议使用“应”而不是“可以”。"]);
  }
  if (text.includes("做好") || text.includes("及时处理")) {
    issues.push(["中", "可执行性不足", "建议补充责任主体、处理时限、留痕方式或验收口径。"]);
  }
  if (text.includes("敏感数据") && !text.includes("脱敏")) {
    issues.push(["高", "安全要求缺少脱敏方案", "涉及敏感数据目录时，应明确安全评估和脱敏处理方案。"]);
  }
  if (!text.trim()) issues.push(["低", "未输入文本", "请载入样例草案或输入需要校验的标准条款。"]);
  return issues;
}

export function runDocumentValidation(text: string, clauses: Clause[]): { issues: [string, string, string][]; match: MatchResult } {
  return {
    issues: validateDraft(text),
    match: compareStandardText(text || DRAFT_SAMPLE, clauses),
  };
}

function splitSignalImportRow(line: string): string[] {
  const separator = line.includes("\t") ? "\t" : line.includes("|") ? "|" : ",";
  return line
    .split(separator)
    .map((cell) => cell.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function isSignalImportHeader(line: string): boolean {
  const headerHits = (line.match(/序号|编号|来源|内容|文本|反馈内容|问题描述|事项|办理环节|content|text|feedback|summary/gi) || []).length;
  return headerHits >= 2 || (headerHits >= 1 && !/(群众|申请人|用户|窗口|材料|投诉|评价|排队|补正|线上|线下|纸质|大厅|自助|敏感)/.test(line));
}

function pickSignalImportText(line: string): string {
  const cells = splitSignalImportRow(line);
  if (cells.length <= 1) return line.trim();
  const preferred = cells.find((cell) => /(群众|窗口|材料|办理|投诉|评价|排队|补正|线上|线下|纸质|大厅|自助|敏感|目录)/.test(cell) && cell.length >= 8);
  return preferred || cells.find((cell) => cell.length >= 12) || cells.join(" ");
}

function signalDataQualityScore(text: string): number {
  let score = 14;
  if (text.length >= 24) score += 2;
  if (!/[^\u4e00-\u9fa5A-Za-z0-9，。；：、“”‘’（）()《》？！,.!?;:\s-]/.test(text)) score += 2;
  if (!/(undefined|null|NaN|#{3,}|\.{5,})/i.test(text)) score += 2;
  return Math.min(20, score);
}

export function buildSignalImportCandidates(
  rawText: string,
  input: { source: string; region: string; clauses: Clause[]; fileName?: string }
): SignalImportCandidate[] {
  const normalized = normalizeBulkSignalText(rawText, input.fileName || "");
  const lines = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 6 && !isSignalImportHeader(line));

  return lines
    .map((line, index) => {
      const text = pickSignalImportText(line);
      const match = compareStandardText(text, input.clauses);
      const confidenceParts: SignalImportConfidenceParts = {
        relevance: Math.min(35, Math.round(match.similarity * 0.35)),
        completeness: Math.min(25, 12 + (text.length >= 24 ? 5 : 0) + (/(群众|申请人|用户|窗口|大厅|平台)/.test(text) ? 4 : 0) + (/(材料|流程|评价|投诉|目录|安全|排队|补正)/.test(text) ? 4 : 0)),
        comparability: Math.min(20, 10 + match.overlap.length * 3 + (match.clause.dimension && text.includes(match.clause.dimension) ? 3 : 0)),
        dataQuality: signalDataQualityScore(text),
      };
      const confidence = Math.min(
        98,
        confidenceParts.relevance + confidenceParts.completeness + confidenceParts.comparability + confidenceParts.dataQuality
      );
      return {
        candidateId: `SI-${String(index + 1).padStart(3, "0")}`,
        source: input.source,
        region: input.region,
        type: `解析导入-${input.source}`,
        text,
        confidence,
        confidenceParts,
        matchedClauseId: match.clause.id,
        matchedClauseSource: match.clause.source,
        evaluationText: `可用于标准条款比对：命中 ${match.clause.id}，相似度 ${match.similarity}%，${match.conclusion}`,
        reviewStatus: "待导入确认",
      };
    })
    .filter((item) => item.text.length >= 6);
}

export type VerificationPointStatus = "pending" | "accepted" | "rejected";

export type KeyVerificationPoint = {
  id: string;
  title: string;
  status: VerificationPointStatus;
  locator: string;
  level: "高" | "中" | "低";
  category: string;
  riskLabel: string;
  originalLocation: string;
  problemJudgment: string;
  references: string;
  evidence: string;
  revisionAdvice: string;
  suggestedText: string;
  confidence: number;
  reviewStatus: string;
};

function riskLabelFromLevel(level: string): string {
  if (level.includes("高")) return "高风险";
  if (level.includes("中")) return "中风险";
  return "低风险";
}

export function buildKeyVerificationPoints({ issues, match }: { issues: [string, string, string][]; match: MatchResult }): KeyVerificationPoint[] {
  const issuePoints = issues.map(([level, title, advice], index) => ({
    id: `VP-${String(index + 1).padStart(3, "0")}`,
    title,
    status: "pending" as VerificationPointStatus,
    locator: `正文第 ${index + 1} 处`,
    level: level.includes("高") ? ("高" as const) : level.includes("中") ? ("中" as const) : ("低" as const),
    category: match.clause.dimension,
    riskLabel: riskLabelFromLevel(level),
    originalLocation: match.targetText.slice(0, 80),
    problemJudgment: `${title}：${advice}`,
    references: `${match.clause.source} / ${match.clause.id}`,
    evidence: match.issues[index] || match.issues[0] || match.clause.text,
    revisionAdvice: advice.includes("建议") ? advice : `建议${advice}`,
    suggestedText: advice.replace(/^建议/, "建议在原条款中"),
    confidence: Math.max(60, Math.min(98, match.score - index * 3)),
    reviewStatus: "待专家确认",
  }));

  return issuePoints.concat({
    id: `VP-${String(issuePoints.length + 1).padStart(3, "0")}`,
    title: "标准条款一致性比对",
    status: "pending",
    locator: "知识库召回结果",
    level: match.score >= 85 ? "低" : match.score >= 70 ? "中" : "高",
    category: match.clause.dimension,
    riskLabel: match.score >= 85 ? "低风险" : match.score >= 70 ? "中风险" : "高风险",
    originalLocation: match.targetText.slice(0, 80),
    problemJudgment: `与 ${match.clause.id} 的综合置信度为 ${match.score} 分，${match.conclusion}。`,
    references: `${match.clause.source} / ${match.clause.id}`,
    evidence: match.clause.text,
    revisionAdvice: `建议围绕 ${match.overlap.slice(0, 4).join("、") || match.clause.dimension} 补充依据、责任主体和执行口径。`,
    suggestedText: `建议补充与 ${match.clause.id} 对应的执行条件、责任主体和留痕要求。`,
    confidence: match.score,
    reviewStatus: "待专家确认",
  });
}

export function verificationPointsAllConfirmed(points: KeyVerificationPoint[]): boolean {
  return points.length > 0 && points.every((point) => point.status === "accepted" || point.status === "rejected");
}

export function buildFormattedVerificationReport({
  draftFileName,
  match,
  points,
}: {
  draftFileName: string;
  match: MatchResult;
  points: KeyVerificationPoint[];
}): string {
  const confirmed = verificationPointsAllConfirmed(points) ? "专家确认完成" : "专家确认未完成";
  const riskCounts = points.reduce(
    (acc, point) => {
      const key = point.riskLabel.includes("高") ? "高风险" : point.riskLabel.includes("中") ? "中风险" : "低风险";
      acc[key] += 1;
      return acc;
    },
    { 高风险: 0, 中风险: 0, 低风险: 0 }
  );
  const reportDate = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
  const riskSummaryRows = [
    "等级｜数量｜主要领域｜处置建议",
    `高风险｜${riskCounts["高风险"]}｜强制性要求、数据安全、执行冲突、上位依据｜发布前实质修订并组织业务、法制、数据安全专家复核`,
    `中风险｜${riskCounts["中风险"]}｜程序细化、责任主体、证据留痕、评价闭环｜完善为可检查、可留痕、可追溯条款`,
    `低风险｜${riskCounts["低风险"]}｜术语、格式、表达和补充说明｜随编辑性统一处理`,
  ].join("\n");
  const directions = [
    `方向1：围绕“${match.clause.dimension}”维度补齐责任主体、执行条件和验收口径，避免条款只给原则不便检查。`,
    `方向2：对命中条款 ${match.clause.id} 涉及的关键词（${match.overlap.slice(0, 5).join("、") || match.clause.dimension}）补充证据依据和留痕方式。`,
    "方向3：对高风险项优先开展专家复核，明确采纳意见、拒绝意见和后续修订责任人。",
    "方向4：将报告中的问题索引表、证据清单和验证限制同步纳入正式送审材料，便于复核追踪。",
  ].join("\n");
  const pointSections = points
    .map((point, index) => {
      const decision = point.status === "accepted" ? "采纳意见" : point.status === "rejected" ? "拒绝意见" : "待确认";
      const issueId = `V-${String(index + 1).padStart(3, "0")}`;
      return `${issueId}｜${point.locator}｜${point.riskLabel}｜${point.title}
原文定位：${point.originalLocation || point.locator}
问题判断：${point.problemJudgment}
修改建议：${point.revisionAdvice}
建议文本：${point.suggestedText}
依据：${point.references}；${point.evidence}
置信度：${point.confidence}分；人工复核状态：${point.reviewStatus}；专家确认结果：${decision}。`;
    })
    .join("\n\n");
  const indexRows = [
    "编号｜条款｜风险｜问题标签｜主要依据",
    ...points.map((point, index) => `V-${String(index + 1).padStart(3, "0")}｜${point.locator}｜${point.riskLabel}｜${point.title}｜${point.references}`),
  ].join("\n");
  const reviewChecklist = [
    "是否已完成全部关键验证点的采纳意见或拒绝意见确认？",
    `是否需要对 ${match.clause.id} 的标准依据、适用范围和执行口径再做人工复核？`,
    "高风险项是否已形成明确修订文本、责任主体和处置时限？",
    "报告中的证据来源是否均可追溯到标准知识库、待验证文本或公开权威来源？",
    "导出文档是否已随送审材料一并归档，便于后续版本比对？",
  ]
    .map((item, index) => `${index + 1}. ${item}`)
    .join("\n");
  const sources = [
    `A01｜${match.clause.source}｜已构建标准知识库｜${match.clause.id} 条款比对、关键词命中和差异判断`,
    `C01｜${draftFileName}｜待验证文本｜逐项关键验证点定位、专家确认和报告输出`,
    "C02｜标准验证智能体规则库｜方法和样例｜报告章节、风险分级、置信度和专家复核清单",
  ].join("\n");

  return `标准验证意见报告

《${draftFileName.replace(/\.[^.]+$/i, "")}》

验证日期：${reportDate}
验证对象：${draftFileName}
验证定位：AI辅助“体检报告”，最终采纳和标准解释由主管部门及专家组确认
证据范围：已构建标准知识库、待验证文本切片、关键验证点、专家确认意见和系统比对日志
专家状态：${confirmed}

一、验证结论摘要

总体判断：本轮报告围绕 ${match.clause.source} / ${match.clause.id} 进行条款级比对，综合置信度 ${match.score} 分，结论为“${match.conclusion}”。当前报告已汇总专家逐项确认结果，可作为标准草案修订、复核和归档材料。
问题数量：共${points.length}项，其中高风险${riskCounts["高风险"]}项、中风险${riskCounts["中风险"]}项、低风险${riskCounts["低风险"]}项。高风险项不等同于正式合法性结论，表示若不澄清可能导致执行冲突、依据不足、重复提交或数据合规争议。
${riskSummaryRows}

二、智能体定位、边界和证据等级

定位：对待验证文本进行切片、知识库召回、标准条款比对、风险分级、建议文本生成和专家确认状态汇总。
不越界事项：不替代合法性审查、备案审查、主管部门解释、专家表决和正式发布程序。
A类证据：现行法律法规、有效政策文件、国家/行业/地方标准全文及权威目录清单。
B类证据：标准知识库、公开网站元数据、历史验证报告、业务规则和权威政策解读。
C类证据：待验证文本、用户上传材料、专家确认意见和系统执行日志，用于定位和佐证，不单独作强结论。

三、重点修订方向

${directions}

四、逐条验证意见

${pointSections}

五、问题索引表

${indexRows}

六、专家复核清单

${reviewChecklist}

七、主要依据与补充来源

编号｜名称｜类型｜用途
${sources}

八、验证限制

1. 本报告以当前可解析文本、已构建知识库和专家确认状态为基础，未替代正式法制审查、标准审定和业务会签。
2. 风险等级用于提示发布和执行风险，不等同于认定违法或不合格。
3. 若后续上传附件、表格、真实办件日志或公开来源证据发生变化，应重新生成报告并保留版本记录。
4. 导出的 Word 文档应与原始待验证文本、证据链和专家确认记录一并归档。`;
}

export function isReadableDraftAttachment(fileName: string): boolean {
  return /\.(txt|md|markdown|csv|tsv|json|xml|html|htm|log)$/i.test(fileName);
}

export function isServerParsedDraftAttachment(fileName: string): boolean {
  return /\.(pdf|docx|doc)$/i.test(fileName);
}

export function isServerParsedKnowledgeAttachment(fileName: string): boolean {
  return /\.(pdf|docx|doc)$/i.test(fileName);
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((item) => item.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function normalizeParsedDraftText(text: string): string {
  return normalizeWhitespace(text);
}

export function normalizeDraftAttachmentText(rawText: string, fileName = ""): string {
  const name = fileName.toLowerCase();
  if (/\.json$/i.test(name)) {
    try {
      const data = JSON.parse(rawText);
      const rows = Array.isArray(data) ? data : Object.values(data).find(Array.isArray) || [data];
      const picked = rows
        .map((row) => {
          if (typeof row === "string") return row;
          if (!row || typeof row !== "object") return "";
          const values = Object.values(row).filter((value): value is string => typeof value === "string");
          return row.content || row.text || row.body || row.summary || row.detail || values.find((value) => value.length > 8) || "";
        })
        .filter(Boolean);
      if (picked.length) return normalizeWhitespace(picked.join("\n"));
    } catch {
      return normalizeWhitespace(rawText);
    }
  }
  if (/\.(html|htm)$/i.test(name)) {
    return normalizeWhitespace(rawText.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
  }
  if (/\.(csv|tsv)$/i.test(name)) {
    const separator = /\.tsv$/i.test(name) ? "\t" : ",";
    return normalizeWhitespace(
      rawText
        .split(/\n+/)
        .map((line) =>
          line
            .split(separator)
            .map((cell) => cell.trim().replace(/^"|"$/g, ""))
            .filter(Boolean)
            .join(" ")
        )
        .join("\n")
    );
  }
  return normalizeWhitespace(rawText);
}

export function buildDraftValidationStatus(fileName: string, issueCount: number): string {
  return `文档状态：${fileName} 已完成验证，发现 ${issueCount} 项需关注问题。`;
}

export type AgentExecutionStep = {
  phase: string;
  action: string;
  thought: string;
  evidence: string;
  status: "done";
};

export type AgentExecutionLogLine = {
  time: string;
  kind: "system" | "action" | "reasoning" | "evidence" | "result";
  phase: string;
  message: string;
};

export const AGENT_LOG_PLAYBACK_DELAY_MS = 280;

export function beginAgentExecutionRun(currentRunId: number): { runId: number; currentRunId: number } {
  const runId = currentRunId + 1;
  return { runId, currentRunId: runId };
}

function logTime(index: number): string {
  const seconds = index * 2;
  const hh = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function buildAgentExecutionTrace({
  text,
  sourceType,
  fileName,
  issues,
  match,
}: {
  text: string;
  sourceType: string;
  fileName: string;
  issues: [string, string, string][];
  match: MatchResult;
}): AgentExecutionStep[] {
  const cleanText = normalizeWhitespace(text || DRAFT_SAMPLE);
  const lineCount = cleanText ? cleanText.split("\n").length : 0;
  const topIssue = issues[0]?.[1] || "未发现高优先级问题";
  const riskLevel = issues[0]?.[0] || "低";
  const sourceLabel = sourceType || "自动识别";
  const fileLabel = fileName || "粘贴文本";

  return [
    {
      phase: "读取输入",
      action: `读取 ${fileLabel}，获得 ${cleanText.length} 个字符、${lineCount} 段文本。`,
      thought: `将输入按“${sourceLabel}”处理，优先识别可验证条款和义务性表述。`,
      evidence: cleanText.slice(0, 46) || "使用内置样例文本。",
      status: "done",
    },
    {
      phase: "结构抽取",
      action: "抽取办理条件、材料补正、数据安全和执行口径等关键句。",
      thought: "先定位可能影响基层执行的动词、时限、对象和例外条件，再进入规则校验。",
      evidence: `识别到 ${Math.max(1, Math.min(issues.length + 1, 6))} 类候选关注点。`,
      status: "done",
    },
    {
      phase: "规则校验",
      action: `按格式、术语、逻辑和可执行性规则完成 ${issues.length} 项问题扫描。`,
      thought: `${riskLevel}优先级关注：${topIssue}。`,
      evidence: issues.length ? issues.map(([, title]) => title).join("、") : "未触发明显规则问题。",
      status: "done",
    },
    {
      phase: "知识库比对",
      action: `匹配最相似标准条款 ${match.clause.id}，相似度 ${match.similarity}%。`,
      thought: "用命中关键词和条款主题判断是否存在口径偏离或缺失项。",
      evidence: `${match.clause.id}：${match.clause.text}`,
      status: "done",
    },
    {
      phase: "结论生成",
      action: `汇总校验问题、比对差异和建议结论，形成 ${match.score} 分可信度判断。`,
      thought: match.conclusion,
      evidence: match.issues.join("；"),
      status: "done",
    },
  ];
}

export function buildAgentExecutionLog(input: {
  text: string;
  sourceType: string;
  fileName: string;
  issues: [string, string, string][];
  match: MatchResult;
}): AgentExecutionLogLine[] {
  const trace = buildAgentExecutionTrace(input);
  const cleanText = normalizeWhitespace(input.text || DRAFT_SAMPLE);
  const log: AgentExecutionLogLine[] = [
    {
      time: logTime(0),
      kind: "system",
      phase: "任务初始化",
      message: `启动文本验证智能体：输入来源 ${input.fileName || "粘贴文本"}，文本类型 ${input.sourceType || "自动识别"}，正文长度 ${cleanText.length} 字。`,
    },
  ];

  trace.forEach((step) => {
    log.push(
      {
        time: logTime(log.length),
        kind: "action",
        phase: step.phase,
        message: step.action,
      },
      {
        time: logTime(log.length + 1),
        kind: "reasoning",
        phase: step.phase,
        message: `推理摘要：${step.thought}`,
      },
      {
        time: logTime(log.length + 2),
        kind: "evidence",
        phase: step.phase,
        message: `依据：${step.evidence}`,
      },
      {
        time: logTime(log.length + 3),
        kind: "result",
        phase: step.phase,
        message: `阶段完成：${step.phase} 已写入验证上下文。`,
      }
    );
  });

  log.push({
    time: logTime(log.length),
    kind: "result",
    phase: "任务完成",
    message: `输出完成：发现 ${input.issues.length} 项校验问题，最相似条款 ${input.match.clause.id}，综合置信度 ${input.match.score} 分。`,
  });
  return log;
}

export function buildAgentThinkingExecutionLog(input: {
  text: string;
  sourceType: string;
  fileName: string;
  issues: [string, string, string][];
  match: MatchResult;
}): AgentExecutionLogLine[] {
  const cleanText = normalizeWhitespace(input.text || DRAFT_SAMPLE);
  const topIssue = input.issues[0]?.[1] || "未发现高优先级问题";
  const sourceLabel = input.sourceType || "自动识别";
  const fileLabel = input.fileName || "粘贴文本";
  const overlap = input.match.overlap.slice(0, 5).join("、") || input.match.clause.dimension;
  const lines: Omit<AgentExecutionLogLine, "time">[] = [
    {
      kind: "system",
      phase: "命令接收",
      message: `用户命令：对 ${fileLabel} 执行文本验证，输入类型按 ${sourceLabel} 处理，正文长度 ${cleanText.length} 字。`,
    },
    {
      kind: "reasoning",
      phase: "输入理解",
      message: `输入理解：识别待验证文本来源、正文范围和条款表达，优先关注义务性表述、例外条件、责任主体和群众权益相关内容。`,
    },
    {
      kind: "action",
      phase: "任务拆解",
      message: "任务拆解：将验证任务拆成文本切片复核、规则校验、知识库召回、差异判断、关键验证点生成和报告组装。",
    },
    {
      kind: "action",
      phase: "工具调用",
      message: `模拟工具调用：调用文本切片器、规则校验器和条款召回器，当前命中 ${input.issues.length} 类问题线索。`,
    },
    {
      kind: "evidence",
      phase: "证据读取",
      message: `证据读取：读取命中关键词 ${overlap}，主要参照 ${input.match.clause.id}，并保留条款原文用于专家复核。`,
    },
    {
      kind: "reasoning",
      phase: "差异判断",
      message: `差异判断：当前优先关注“${topIssue}”，结合相似度 ${input.match.similarity}% 和综合置信度 ${input.match.score} 分形成可审计结论。`,
    },
    {
      kind: "action",
      phase: "执行落地",
      message: `执行落地：生成 ${input.issues.length + 1} 个关键验证点，进入专家逐项确认流程，支持采纳意见或拒绝意见。`,
    },
    {
      kind: "result",
      phase: "结果输出",
      message: "结果输出：等待所有验证点逐项确认后，汇总专家意见、证据依据和格式化验证报告下载内容。",
    },
  ];

  return lines.map((line, index) => ({ ...line, time: logTime(index) }));
}

export function normalizeBulkSignalText(rawText: string, fileName = ""): string {
  let text = rawText.replace(/\r/g, "\n");
  const name = fileName.toLowerCase();
  if (/\.json$/i.test(name)) {
    try {
      const data = JSON.parse(rawText);
      const rows = Array.isArray(data) ? data : Object.values(data).find(Array.isArray) || [];
      const picked = rows
        .map((row) => {
          if (typeof row === "string") return row;
          if (!row || typeof row !== "object") return "";
          const values = Object.values(row).filter((value): value is string => typeof value === "string");
          return row.content || row.text || row.feedback || row.question || row.summary || values.find((value) => value.length > 6) || "";
        })
        .filter(Boolean);
      if (picked.length) text = picked.join("\n");
    } catch {
      text = rawText;
    }
  } else if (/\.(csv|tsv)$/i.test(name)) {
    const separator = /\.tsv$/i.test(name) ? "\t" : ",";
    text = text
      .split(/\n+/)
      .filter((line, index) => index > 0 || !/(内容|文本|反馈|摘要|content|text|feedback)/i.test(line))
      .map((line) => {
        const cells = line
          .split(separator)
          .map((cell) => cell.trim().replace(/^"|"$/g, ""))
          .filter(Boolean);
        return cells.find((cell) => cell.length > 10) || cells[cells.length - 1] || "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return text
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
}
