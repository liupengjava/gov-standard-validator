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
};

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

const SEARCH_SAMPLES = [
  "线上办理已经提示预审通过，窗口仍要求重新提交纸质复印件，群众认为线上线下口径不一致。",
  "公开留言反映办理进度查询不够透明，提交材料后不知道当前处于哪个审核环节。",
  "网页评论提到窗口排队时间较长，叫号屏只显示号码，无法判断具体办理窗口和业务类型。",
  "地方问政平台出现关于一次性告知不到位的反馈，申请人多次补交材料后仍被退回。",
  "公开咨询中多次出现老年人不会使用自助设备、现场缺少引导人员的问题。",
];

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

export function sliceKnowledgeText(raw: string, sourceType = "上传标准文本", baseCount = 0): Clause[] {
  const cleaned = raw.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!cleaned) return [];
  const chunks = cleaned
    .split(/\n+|(?<=[。；;])/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 10);
  const merged: string[] = [];
  chunks.forEach((chunk) => {
    if (chunk.length < 26 && merged.length) merged[merged.length - 1] = `${merged[merged.length - 1]}${chunk}`;
    else merged.push(chunk);
  });
  return merged.slice(0, 12).map((text, index) => ({
    id: `UP-${String(baseCount + index + 1).padStart(3, "0")}`,
    source: sourceType,
    dimension: inferDimension(text),
    constraint: inferConstraint(text),
    text,
    keywords: keywordsFromText(text),
  }));
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

export function runSearchSimulation(keyword: string): string[] {
  return SEARCH_SAMPLES.slice(0, 3).map((item) => `${keyword}｜${item}`);
}

