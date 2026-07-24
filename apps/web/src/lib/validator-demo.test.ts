import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_LOG_PLAYBACK_DELAY_MS,
  INITIAL_CLAUSES,
  INITIAL_SIGNALS,
  beginAgentExecutionRun,
  buildAgentExecutionLog,
  buildAgentExecutionStepCards,
  buildAgentExecutionTrace,
  buildAgentThinkingExecutionLog,
  buildDraftValidationStatus,
  buildFormattedVerificationReport,
  buildKeyVerificationPoints,
  buildPublicSentimentSupport,
  buildKnowledgeCatalogSearchTasks,
  buildFuzzyKnowledgeSearchTasks,
  buildKnowledgeFileAutoSlices,
  buildKnowledgeParseProgressMessage,
  buildKnowledgeFileAsset,
  buildRetrievedKnowledgeDocumentPreviewUrl,
  decodeRetrievedKnowledgeDocumentPreviewUrl,
  isRetrievedKnowledgeDocumentPreviewUrl,
  buildKnowledgeSliceProgressMessage,
  buildSignalImportCandidates,
  mergePersistentSearchSites,
  filterVectorKnowledgeClauses,
  paginatePublicSentimentVectorSamples,
  paginateVectorKnowledgeClauses,
  isReadableDraftAttachment,
  isServerParsedDraftAttachment,
  isServerParsedKnowledgeAttachment,
  knowledgeClauseKey,
  normalizeDraftAttachmentText,
  normalizeParsedDraftText,
  nextKnowledgeVectorBuildStep,
  recordKnowledgeFileUsage,
  removeDraftTextSlice,
  resetSignalSamplesForRetest,
  runDocumentValidation,
  sliceDraftTextForReview,
  sliceKnowledgeText,
  updateDraftTextSlice,
  updateKnowledgeVectorBuild,
  verificationPointsAllConfirmed,
} from "./validator-demo.ts";

test("resetSignalSamplesForRetest clears imported signal samples and selected index", () => {
  const reset = resetSignalSamplesForRetest(INITIAL_SIGNALS, 3);

  assert.deepEqual(reset, { signals: [], selectedSignalIndex: 0 });
});

test("mergePersistentSearchSites keeps maintained search sites across refresh without duplicates", () => {
  const defaults = [
    { id: "gov", name: "政府网站留言", url: "https://www.gov.cn/hudong/", category: "政府网站留言" },
    { id: "zj", name: "浙江政务服务网", url: "https://www.zjzwfw.gov.cn/", category: "政务服务公开页" },
  ];
  const persisted = [
    { id: "custom-1", name: "人民网留言板", url: "https://liuyan.people.com.cn/", category: "公开留言" },
    { id: "duplicate", name: "浙江政务服务网", url: "https://www.zjzwfw.gov.cn/", category: "重复项" },
  ];

  const merged = mergePersistentSearchSites(defaults, persisted);

  assert.deepEqual(merged.map((site) => site.url), [
    "https://www.gov.cn/hudong/",
    "https://www.zjzwfw.gov.cn/",
    "https://liuyan.people.com.cn/",
  ]);
  assert.equal(merged[2].name, "人民网留言板");
});

test("buildKnowledgeSliceProgressMessage reports upload slicing stages", () => {
  assert.equal(buildKnowledgeSliceProgressMessage(0), "等待自动切分");
  assert.equal(buildKnowledgeSliceProgressMessage(20), "正在准备待切分文本");
  assert.equal(buildKnowledgeSliceProgressMessage(55), "正在识别条款编号和层级结构");
  assert.equal(buildKnowledgeSliceProgressMessage(82), "正在生成条款级知识切片");
  assert.equal(buildKnowledgeSliceProgressMessage(100, 18), "切分完成，已生成 18 个条款切片");
});

test("buildKnowledgeParseProgressMessage reports knowledge file parsing stages", () => {
  assert.equal(buildKnowledgeParseProgressMessage(0), "等待解析文件");
  assert.equal(buildKnowledgeParseProgressMessage(12), "正在准备解析任务");
  assert.equal(buildKnowledgeParseProgressMessage(45), "正在抽取文档正文");
  assert.equal(buildKnowledgeParseProgressMessage(78), "正在清洗正文结构");
  assert.equal(buildKnowledgeParseProgressMessage(100), "解析完成，可自动切分");
});

test("buildSignalImportCandidates extracts comparable signal data with multi-part confidence", () => {
  const candidates = buildSignalImportCandidates(
    `序号,来源,反馈内容,办理环节
1,问卷,群众反映线上预审通过后窗口仍要求重复提交纸质材料，且没有一次性说清补正材料。,窗口受理
2,热线,大厅排队时间长，叫号屏无法判断办理窗口。,现场服务`,
    {
      source: "问卷调研",
      region: "杭州市",
      clauses: INITIAL_CLAUSES,
    }
  );

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].source, "问卷调研");
  assert.equal(candidates[0].region, "杭州市");
  assert.equal(candidates[0].type, "解析导入-问卷调研");
  assert.ok(candidates[0].text.includes("重复提交纸质材料"));
  assert.equal(candidates[0].matchedClauseId, "YC-8.3");
  assert.ok(candidates[0].confidence >= 80);
  assert.deepEqual(Object.keys(candidates[0].confidenceParts), ["relevance", "completeness", "comparability", "dataQuality"]);
  assert.ok(candidates[0].evaluationText.includes("可用于标准条款比对"));
  assert.equal(candidates[1].reviewStatus, "待导入确认");
});

test("beginAgentExecutionRun keeps the active run id valid for playback", () => {
  const run = beginAgentExecutionRun(7);
  assert.deepEqual(run, { runId: 8, currentRunId: 8 });
});

test("agent execution log playback runs at one quarter of the original speed", () => {
  assert.equal(AGENT_LOG_PLAYBACK_DELAY_MS, 280);
});

test("isReadableDraftAttachment accepts browser-readable text attachments", () => {
  assert.equal(isReadableDraftAttachment("标准草案.txt"), true);
  assert.equal(isReadableDraftAttachment("标准草案.md"), true);
  assert.equal(isReadableDraftAttachment("标准草案.csv"), true);
  assert.equal(isReadableDraftAttachment("标准草案.json"), true);
  assert.equal(isReadableDraftAttachment("标准草案.xml"), true);
  assert.equal(isReadableDraftAttachment("标准草案.docx"), false);
  assert.equal(isReadableDraftAttachment("标准草案.pdf"), false);
});

test("isServerParsedDraftAttachment routes PDF and Word attachments to parser service", () => {
  assert.equal(isServerParsedDraftAttachment("标准草案.docx"), true);
  assert.equal(isServerParsedDraftAttachment("标准草案.doc"), true);
  assert.equal(isServerParsedDraftAttachment("标准草案.pdf"), true);
  assert.equal(isServerParsedDraftAttachment("标准草案.txt"), false);
});

test("isServerParsedKnowledgeAttachment routes PDF and Word files to parser service", () => {
  assert.equal(isServerParsedKnowledgeAttachment("knowledge.pdf"), true);
  assert.equal(isServerParsedKnowledgeAttachment("knowledge.docx"), true);
  assert.equal(isServerParsedKnowledgeAttachment("knowledge.doc"), true);
  assert.equal(isServerParsedKnowledgeAttachment("knowledge.txt"), false);
});

test("sliceKnowledgeText keeps all standard clauses instead of capping at twelve", () => {
  const clauses = Array.from({ length: 16 }, (_, index) => {
    const no = `5.${index + 1}`;
    return `${no} 测试条款${index + 1}\n政务服务中心应记录第${index + 1}项办理过程。`;
  }).join("\n");

  const slices = sliceKnowledgeText(`GB/T 99999-2026\n测试标准\n5 测试章节\n${clauses}`, "测试标准", 0);

  assert.equal(slices.length, 17);
  assert.ok(slices.some((slice) => slice.id === "5.16"));
});

test("sliceKnowledgeText ignores catalog dot-leader rows and returns clause-level text", () => {
  const slices = sliceKnowledgeText(
    `GB/T 32168-2015
政务服务中心网上服务规范
前言 I ........................................................................
1 范围 1 ......................................................................
2 规范性引用文件 1 ............................................................

1 范围
本标准规定了政务服务中心网上服务的服务流程和评价要求。
4 服务渠道
4.1 一次性告知
材料不齐全或者不符合法定形式的，应一次性告知申请人需要补正的全部内容。`,
    "GB/T 32168-2015 政务服务中心网上服务规范",
    0
  );

  assert.equal(slices.some((slice) => /\.{5,}/.test(slice.text)), false);
  assert.ok(slices.some((slice) => slice.id === "4.1" && slice.text.includes("一次性告知")));
});

test("buildKnowledgeCatalogSearchTasks creates web search tasks from file-name catalog", () => {
  const tasks = buildKnowledgeCatalogSearchTasks("GBZ 24294.3-2017\nGB/T 39554.1-2020", "2026-07-21 10:30");

  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].fileName, "GBZ 24294.3-2017");
  assert.equal(tasks[0].status, "待检索");
  assert.ok(tasks[0].searchUrl.includes(encodeURIComponent("GBZ 24294.3-2017 PDF 标准")));
  assert.equal(tasks[1].addedAt, "2026-07-21 10:30");
});

test("buildFuzzyKnowledgeSearchTasks creates multiple candidates for missing knowledge search", () => {
  const tasks = buildFuzzyKnowledgeSearchTasks("地铁 政务服务 数据互通", "杭州市", "2026-07-23 16:20");

  assert.equal(tasks.length >= 4, true);
  assert.equal(tasks[0].status, "待检索");
  assert.equal(tasks[0].sourceSite, "缺失知识模糊检索");
  assert.ok(tasks[0].fileName.includes("地铁 政务服务 数据互通"));
  assert.ok(tasks.every((task) => task.searchUrl.includes(encodeURIComponent("地铁 政务服务 数据互通"))));
  assert.equal(new Set(tasks.map((task) => task.fileName)).size, tasks.length);
  assert.ok(tasks.some((task) => task.message.includes("国家标准")));
  assert.ok(tasks.some((task) => task.message.includes("办事指南")));
});

test("retrieved knowledge documents keep preview separate from search results", () => {
  const task = buildKnowledgeCatalogSearchTasks("GBZ 24294.3-2017", "2026-07-24 09:20")[0];
  const previewUrl = buildRetrievedKnowledgeDocumentPreviewUrl(task, "GBZ 24294.3-2017.pdf", "2026-07-24 09:22");
  const asset = buildKnowledgeFileAsset({
    name: "GBZ 24294.3-2017.pdf",
    sourceType: "web",
    sourceLabel: task.sourceSite,
    addedAt: "2026-07-24 09:23",
    sliceCount: 0,
    vectorProgress: 0,
    sourceUrl: previewUrl,
    searchUrl: task.searchUrl,
  });

  assert.ok(previewUrl.startsWith("data:text/html;charset=utf-8,"));
  assert.ok(decodeURIComponent(previewUrl).includes("已获取文档预览"));
  assert.equal(isRetrievedKnowledgeDocumentPreviewUrl(previewUrl), true);
  assert.ok(decodeRetrievedKnowledgeDocumentPreviewUrl(previewUrl).includes("GBZ 24294.3-2017.pdf"));
  assert.notEqual(asset.sourceUrl, task.searchUrl);
  assert.equal(asset.searchUrl, task.searchUrl);
});

test("retrieved knowledge documents show search result to official download chain", () => {
  const task = buildKnowledgeCatalogSearchTasks("GB/T 39554.1-2020", "2026-07-24 09:20")[0];
  const previewUrl = buildRetrievedKnowledgeDocumentPreviewUrl(task, "GB/T 39554.1-2020.pdf", "2026-07-24 09:22");
  const html = decodeRetrievedKnowledgeDocumentPreviewUrl(previewUrl);

  assert.ok(task.searchUrl.includes(encodeURIComponent("GB/T 39554.1-2020 PDF 标准")));
  assert.equal(
    task.searchResultUrl,
    "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=C72648A217E6E5E8E4EB074CB6EE0E9B"
  );
  assert.equal(task.downloadActionLabel, "下载标准");
  assert.ok(html.includes("打开百度搜索结果"));
  assert.ok(html.includes("进入国家标准全文公开系统详情页"));
  assert.ok(html.includes("点击“下载标准”获取原文"));
  assert.ok(html.includes(task.searchResultUrl || ""));
});

test("knowledge catalog uses the real official result link instead of a synthesized stdNo url", () => {
  const task = buildKnowledgeCatalogSearchTasks("GB/Z 24294.3-2017", "2026-07-24 11:12")[0];
  const previewUrl = buildRetrievedKnowledgeDocumentPreviewUrl(task, "GBZ 24294.3-2017.pdf", "2026-07-24 11:12");
  const html = decodeRetrievedKnowledgeDocumentPreviewUrl(previewUrl);

  assert.equal(
    task.searchResultUrl,
    "https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=58C700CFB8D4F0A5E0CC681D9D7453BD"
  );
  assert.equal(task.detailPageUrl, task.searchResultUrl);
  assert.equal(task.searchResultUrl.includes("stdNo="), false);
  assert.ok(html.includes("hcno=58C700CFB8D4F0A5E0CC681D9D7453BD"));
  assert.equal(html.includes("stdNo=GBZ"), false);
});

test("knowledge file assets track vector progress, logs, access count, and call count", () => {
  const asset = buildKnowledgeFileAsset({
    name: "GBZ 24294.3-2017.pdf",
    sourceType: "upload",
    sourceLabel: "本地上传",
    addedAt: "2026-07-21 10:40",
    sliceCount: 28,
    vectorProgress: 65,
    sourceUrl: "blob:http://127.0.0.1/source-pdf",
  });

  assert.equal(asset.vectorLogs.some((line) => line.includes("65%")), true);
  assert.equal(asset.sourceUrl, "blob:http://127.0.0.1/source-pdf");
  assert.equal(asset.accessCount, 0);
  assert.equal(asset.callCount, 0);

  const completed = updateKnowledgeVectorBuild(asset, "2026-07-21 10:45");
  assert.equal(completed.vectorProgress, 100);
  assert.equal(completed.vectorStatus, "已完成");
  assert.equal(completed.vectorLogs.at(-1)?.includes("向量索引构建完成"), true);

  const used = recordKnowledgeFileUsage(completed, "call", "2026-07-21 10:50");
  assert.equal(used.accessCount, 1);
  assert.equal(used.callCount, 1);
  assert.equal(used.lastCalledAt, "2026-07-21 10:50");
  assert.equal(used.sourceUrl, "blob:http://127.0.0.1/source-pdf");
});

test("nextKnowledgeVectorBuildStep advances in-progress knowledge files and records logs", () => {
  const asset = buildKnowledgeFileAsset({
    name: "GBZ 24294.3-2017.pdf",
    sourceType: "web",
    sourceLabel: "互联网检索",
    addedAt: "2026-07-22 17:36:57",
    sliceCount: 23,
    vectorProgress: 35,
  });

  const chunked = nextKnowledgeVectorBuildStep(asset, "2026-07-22 17:37:01");
  assert.equal(chunked.vectorProgress > asset.vectorProgress, true);
  assert.equal(chunked.vectorStatus, "构建中");
  assert.equal(chunked.vectorLogs.at(-1)?.includes(`${chunked.vectorProgress}%`), true);

  const completed = nextKnowledgeVectorBuildStep(chunked, "2026-07-22 17:37:05", 100);
  assert.equal(completed.vectorProgress, 100);
  assert.equal(completed.vectorStatus, "已完成");
  assert.equal(completed.vectorLogs.at(-1)?.includes("向量索引构建完成"), true);
});

test("filterVectorKnowledgeClauses only shows completed vector clauses and supports semantic and dimension filters", () => {
  const completedAsset = buildKnowledgeFileAsset({
    name: "completed.pdf",
    sourceType: "upload",
    sourceLabel: "初始化样例",
    addedAt: "2026-07-21 09:10",
    sliceCount: INITIAL_CLAUSES.length,
    vectorProgress: 100,
  });
  const buildingAsset = buildKnowledgeFileAsset({
    name: "building.pdf",
    sourceType: "web",
    sourceLabel: "互联网检索",
    addedAt: "2026-07-22 17:36:57",
    sliceCount: 1,
    vectorProgress: 55,
  });
  const buildingClause = {
    id: "TMP-1",
    source: "未完成标准",
    dimension: "安全" as const,
    constraint: "应" as const,
    text: "敏感数据应完成脱敏处理。",
    keywords: ["敏感", "安全", "脱敏"],
  };
  const clauseAssetIds = Object.fromEntries(INITIAL_CLAUSES.map((clause) => [knowledgeClauseKey(clause), completedAsset.id]));
  clauseAssetIds[knowledgeClauseKey(buildingClause)] = buildingAsset.id;

  const allCompleted = filterVectorKnowledgeClauses({
    clauses: INITIAL_CLAUSES.concat(buildingClause),
    knowledgeFiles: [completedAsset, buildingAsset],
    clauseAssetIds,
    query: "",
    dimension: "全部",
  });
  assert.equal(allCompleted.length, INITIAL_CLAUSES.length);

  const materialHits = filterVectorKnowledgeClauses({
    clauses: INITIAL_CLAUSES.concat(buildingClause),
    knowledgeFiles: [completedAsset, buildingAsset],
    clauseAssetIds,
    query: "材料补正一次性告知要求",
    dimension: "材料",
  });
  assert.deepEqual(materialHits.map((clause) => clause.id), ["YC-8.3"]);

  const unfinishedHits = filterVectorKnowledgeClauses({
    clauses: INITIAL_CLAUSES.concat(buildingClause),
    knowledgeFiles: [completedAsset, buildingAsset],
    clauseAssetIds,
    query: "未完成标准",
    dimension: "安全",
  });
  assert.equal(unfinishedHits.length, 0);
});

test("paginateVectorKnowledgeClauses returns fixed twenty-item pages and clamps page numbers", () => {
  const items = Array.from({ length: 57 }, (_, index) => ({ id: `C-${index + 1}` }));

  const firstPage = paginateVectorKnowledgeClauses(items, 1);
  assert.equal(firstPage.pageSize, 20);
  assert.equal(firstPage.pageCount, 3);
  assert.equal(firstPage.items.length, 20);
  assert.equal(firstPage.items[0].id, "C-1");
  assert.equal(firstPage.start, 1);
  assert.equal(firstPage.end, 20);

  const lastPage = paginateVectorKnowledgeClauses(items, 9);
  assert.equal(lastPage.page, 3);
  assert.equal(lastPage.items.length, 17);
  assert.equal(lastPage.items[0].id, "C-41");
  assert.equal(lastPage.end, 57);

  const emptyPage = paginateVectorKnowledgeClauses([], 1);
  assert.equal(emptyPage.page, 1);
  assert.equal(emptyPage.pageCount, 1);
  assert.equal(emptyPage.start, 0);
  assert.equal(emptyPage.end, 0);
});

test("buildKnowledgeFileAutoSlices creates clause slices for web-acquired knowledge files", () => {
  const asset = buildKnowledgeFileAsset({
    name: "GBT+25056-2018.pdf",
    sourceType: "web",
    sourceLabel: "互联网检索",
    addedAt: "2026-07-22 19:18:40",
    sliceCount: 0,
    vectorProgress: 0,
  });

  const slices = buildKnowledgeFileAutoSlices(asset, 20, 6);

  assert.equal(slices.length, 6);
  assert.equal(slices[0].source, "GBT+25056-2018");
  assert.equal(slices[0].id, "WEB-021");
  assert.ok(slices.every((slice) => slice.text.includes("GBT+25056-2018")));
  assert.equal(new Set(slices.map((slice) => knowledgeClauseKey(slice))).size, slices.length);
  assert.ok(slices.some((slice) => slice.dimension === "材料"));
  assert.ok(slices.some((slice) => slice.keywords.includes("检索")));
});

test("normalizeParsedDraftText cleans parser service output", () => {
  assert.equal(
    normalizeParsedDraftText("  第一条  应一次性告知补正内容。\n\n\n第二条\t涉及敏感数据应脱敏。 "),
    "第一条 应一次性告知补正内容。\n第二条 涉及敏感数据应脱敏。"
  );
});

test("sliceDraftTextForReview creates confirmable review slices from uploaded draft text", () => {
  const slices = sliceDraftTextForReview(
    `1 范围
本文件规定了政务服务事项办理要求。

2 材料补正
材料不齐全的，应一次性告知申请人需要补正的全部内容。

3 线上线下一致
线上线下办理记录应保持一致。`,
    "舟山公安政务服务工作规范.docx"
  );

  assert.equal(slices.length, 3);
  assert.equal(slices[0].id, "DV-001");
  assert.equal(slices[0].title, "1 范围");
  assert.equal(slices[1].status, "pending");
  assert.ok(slices[1].text.includes("一次性告知"));
  assert.ok(slices[2].charCount > 0);
});

test("sliceDraftTextForReview groups extracted table rows by concrete clause instead of every number", () => {
  const slices = sliceDraftTextForReview(
    `9 | 补换领行驶证 | 交警 |
|
1
0 | 机动车驾驶人联系方式及联系地址变更备案 | 交警 |
|
1
1 | 机动车驾驶证审验 | 交警 |
|`,
    "舟山公安政务服务工作规范.docx"
  );

  assert.deepEqual(
    slices.map((slice) => slice.title),
    ["9 补换领行驶证 | 交警", "10 机动车驾驶人联系方式及联系地址变更备案 | 交警", "11 机动车驾驶证审验 | 交警"]
  );
  assert.equal(slices.some((slice) => slice.text === "1" || slice.text === "2" || slice.text === "|"), false);
});

test("sliceDraftTextForReview ignores table-of-contents heading rows before real clauses", () => {
  const slices = sliceDraftTextForReview(
    `8 事项办理流程和要求 4
9 安全管理 5
10 评价与改进 5
8.1 事项办理流程应包括申请、受理、审查、决定和送达等环节，并明确每个环节的责任主体。
8.2 申请材料不齐全或者不符合法定形式的，应一次性告知申请人需要补正的全部内容。
9.1 系统应记录事项办理过程，并对涉及个人信息的数据采取访问控制和脱敏措施。`,
    "一窗通办工作规范.docx"
  );

  assert.equal(slices.some((slice) => slice.text === "8 事项办理流程和要求 4"), false);
  assert.equal(slices.some((slice) => slice.text === "9 安全管理 5"), false);
  assert.ok(slices.some((slice) => slice.text.includes("申请、受理、审查、决定和送达")));
  assert.ok(slices.some((slice) => slice.text.includes("访问控制和脱敏措施")));
});

test("updateDraftTextSlice edits a slice and clears its confirmation status", () => {
  const slices = sliceDraftTextForReview(
    `1 范围
政务服务事项应明确适用范围。
2 材料补正
窗口应一次性告知补正材料。`,
    "draft.pdf"
  );
  const result = updateDraftTextSlice(slices, { "DV-002": "confirmed" }, "DV-002", {
    title: "2 材料一次性补正",
    text: "窗口应一次性告知申请人需要补正的全部材料。",
  });

  assert.equal(result.slices[1].title, "2 材料一次性补正");
  assert.equal(result.slices[1].text, "窗口应一次性告知申请人需要补正的全部材料。");
  assert.equal(result.slices[1].charCount, "窗口应一次性告知申请人需要补正的全部材料。".length);
  assert.equal(result.slices[1].status, "pending");
  assert.deepEqual(result.statuses, {});
});

test("removeDraftTextSlice deletes a slice and removes its confirmation status", () => {
  const slices = sliceDraftTextForReview(
    `1 范围
政务服务事项应明确适用范围。
2 材料补正
窗口应一次性告知补正材料。`,
    "draft.pdf"
  );
  const result = removeDraftTextSlice(slices, { "DV-001": "confirmed", "DV-002": "confirmed" }, "DV-001");

  assert.deepEqual(result.slices.map((slice) => slice.id), ["DV-002"]);
  assert.deepEqual(result.statuses, { "DV-002": "confirmed" });
});

test("normalizeDraftAttachmentText extracts useful text from json rows", () => {
  const raw = JSON.stringify([{ title: "事项说明", content: "材料不齐的，应一次性告知申请人补正内容。" }]);
  assert.equal(normalizeDraftAttachmentText(raw, "draft.json"), "材料不齐的，应一次性告知申请人补正内容。");
});

test("normalizeDraftAttachmentText strips html tags and whitespace noise", () => {
  const raw = "<h1>标准草案</h1><p>涉及敏感数据的资源目录应开展安全评估。</p>";
  assert.equal(normalizeDraftAttachmentText(raw, "draft.html"), "标准草案 涉及敏感数据的资源目录应开展安全评估。");
});

test("buildDraftValidationStatus reports file validation result", () => {
  assert.equal(buildDraftValidationStatus("样例标准草案.txt", 4), "文档状态：样例标准草案.txt 已完成验证，发现 4 项需关注问题。");
});

test("runDocumentValidation combines text checks and clause comparison", () => {
  const result = runDocumentValidation("材料不齐的，可以告知群众补正材料。", INITIAL_CLAUSES);
  assert.ok(result.issues.some(([, title]) => title === "材料补正表述不完整"));
  assert.equal(result.match.clause.id, "YC-8.3");
  assert.ok(result.match.score > 0);
});

test("buildKeyVerificationPoints creates one expert-confirmable point per issue plus clause comparison", () => {
  const result = runDocumentValidation("材料不齐的，可以告知群众补正材料。", INITIAL_CLAUSES);
  const points = buildKeyVerificationPoints({ issues: result.issues, match: result.match });

  assert.equal(points.length, result.issues.length + 1);
  assert.ok(points[0].id.startsWith("VP-"));
  assert.equal(points[0].status, "pending");
  assert.equal(points[0].riskLabel, "高风险");
  assert.ok(points[0].originalLocation.includes("材料不齐"));
  assert.ok(points[0].problemJudgment.includes("材料补正表述不完整"));
  assert.ok(points[0].references.includes("YC-8.3"));
  assert.ok(points[0].revisionAdvice.includes("建议"));
});

test("verificationPointsAllConfirmed requires every point to be accepted or rejected", () => {
  const result = runDocumentValidation("材料不齐的，可以告知群众补正材料。", INITIAL_CLAUSES);
  const points = buildKeyVerificationPoints({ issues: result.issues, match: result.match });

  assert.equal(verificationPointsAllConfirmed(points), false);
  assert.equal(
    verificationPointsAllConfirmed(points.map((point) => ({ ...point, status: "accepted" }))),
    true
  );
});

test("buildFormattedVerificationReport includes expert decisions for every verification point", () => {
  const result = runDocumentValidation("材料不齐的，可以告知群众补正材料。", INITIAL_CLAUSES);
  const points = buildKeyVerificationPoints({ issues: result.issues, match: result.match }).map((point, index) => ({
    ...point,
    status: index % 2 === 0 ? ("accepted" as const) : ("rejected" as const),
  }));
  const report = buildFormattedVerificationReport({ draftFileName: "draft.docx", match: result.match, points, signals: INITIAL_SIGNALS });

  assert.ok(report.includes("标准验证意见报告"));
  assert.ok(report.includes("一、验证结论摘要"));
  assert.ok(report.includes("二、智能体定位、边界和证据等级"));
  assert.ok(report.includes("三、标准知识库比对主结论"));
  assert.ok(report.includes("四、群众感知佐证（辅助依据）"));
  assert.ok(report.includes("五、重点修订方向"));
  assert.ok(report.includes("六、逐条验证意见"));
  assert.ok(report.includes("七、问题索引表"));
  assert.ok(report.includes("八、专家复核清单"));
  assert.ok(report.includes("九、主要依据与补充来源"));
  assert.ok(report.includes("十、验证限制"));
  assert.ok(report.indexOf("三、标准知识库比对主结论") < report.indexOf("四、群众感知佐证（辅助依据）"));
  assert.ok(report.includes("不替代标准知识库比对结论"));
  assert.ok(report.includes("等级｜数量｜主要领域｜处置建议"));
  assert.ok(report.includes("编号｜条款｜风险｜问题标签｜主要依据"));
  assert.ok(report.includes("采纳意见"));
  assert.ok(report.includes("拒绝意见"));
  assert.ok(report.includes("专家确认完成"));
});

test("buildPublicSentimentSupport summarizes samples as auxiliary evidence", () => {
  const result = runDocumentValidation("线上预审通过后，窗口仍要求群众重复提交纸质材料。", INITIAL_CLAUSES);
  const support = buildPublicSentimentSupport({ match: result.match, signals: INITIAL_SIGNALS });

  assert.equal(support.sampleCount > 0, true);
  assert.equal(support.evidenceLevel, "辅助依据");
  assert.ok(support.relatedSources.length > 0);
  assert.ok(support.issueTags.length > 0);
  assert.ok(support.boundaryNote.includes("不替代标准知识库比对结论"));
});

test("paginatePublicSentimentVectorSamples returns twenty samples per page", () => {
  const samples = Array.from({ length: 41 }, (_, index) => ({ ...INITIAL_SIGNALS[index % INITIAL_SIGNALS.length], id: `s-${index}` }));
  const page = paginatePublicSentimentVectorSamples(samples, 3, 20);

  assert.equal(page.totalPages, 3);
  assert.equal(page.items.length, 1);
  assert.equal(page.startIndex, 40);
  assert.equal(page.endIndex, 40);
});

test("buildAgentExecutionTrace summarizes the validation agent process", () => {
  const result = runDocumentValidation("材料不齐的，可以告知群众补正材料。", INITIAL_CLAUSES);
  const trace = buildAgentExecutionTrace({
    text: "材料不齐的，可以告知群众补正材料。",
    sourceType: "标准草案",
    fileName: "草案.txt",
    issues: result.issues,
    match: result.match,
    signals: INITIAL_SIGNALS,
  });

  assert.deepEqual(
    trace.map((step) => step.phase),
    ["读取输入", "结构抽取", "规则校验", "知识库比对", "舆情感知比对", "结论生成"]
  );
  assert.ok(trace.every((step) => step.status === "done"));
  assert.ok(trace[0].action.includes("草案.txt"));
  assert.ok(trace[2].thought.includes("材料补正表述不完整"));
  assert.ok(trace[3].evidence.includes("YC-8.3"));
  assert.ok(trace[4].thought.includes("辅助依据"));
});

test("buildAgentExecutionLog expands trace into a scrollable audit log", () => {
  const result = runDocumentValidation("材料不齐的，可以告知群众补正材料。", INITIAL_CLAUSES);
  const log = buildAgentExecutionLog({
    text: "材料不齐的，可以告知群众补正材料。",
    sourceType: "标准草案",
    fileName: "草案.docx",
    issues: result.issues,
    match: result.match,
    signals: INITIAL_SIGNALS,
  });

  assert.ok(log.length >= 20);
  assert.deepEqual([...new Set(log.map((line) => line.kind))], ["system", "action", "reasoning", "evidence", "result"]);
  assert.ok(log.some((line) => line.message.includes("材料补正表述不完整")));
  assert.ok(log.some((line) => line.message.includes("YC-8.3")));
  assert.ok(log.some((line) => line.phase === "舆情感知比对"));
  assert.ok(log.every((line) => /^\d{2}:\d{2}:\d{2}$/.test(line.time)));
});

test("buildAgentExecutionStepCards maps audit logs into validation step cards", () => {
  const log = [
    { time: "00:00:00", kind: "system" as const, phase: "Init", message: "Task created" },
    { time: "00:00:02", kind: "action" as const, phase: "Read", message: "Read input" },
    { time: "00:00:04", kind: "result" as const, phase: "Read", message: "Read complete" },
    { time: "00:00:06", kind: "action" as const, phase: "Check", message: "Checking rules" },
  ];

  const pendingSteps = buildAgentExecutionStepCards(log, {
    started: false,
    running: false,
    expectedPhases: ["Read", "Check", "Report"],
  });
  assert.deepEqual(pendingSteps.map((step) => step.status), ["pending", "pending", "pending"]);
  assert.equal(pendingSteps[0].subActions.length, 2);

  const runningSteps = buildAgentExecutionStepCards(log, {
    started: true,
    running: true,
    expectedPhases: ["Read", "Check", "Report"],
  });
  assert.deepEqual(runningSteps.map((step) => step.status), ["done", "running", "pending"]);
  assert.equal(runningSteps[1].summary, "Checking rules");

  const completedSteps = buildAgentExecutionStepCards(log, {
    started: true,
    running: false,
    expectedPhases: ["Read", "Check", "Report"],
  });
  assert.deepEqual(completedSteps.map((step) => step.status), ["done", "done", "pending"]);
});

test("buildAgentThinkingExecutionLog exposes agent-like command execution steps", () => {
  const result = runDocumentValidation("材料不齐的，可以告知群众补正材料。", INITIAL_CLAUSES);
  const log = buildAgentThinkingExecutionLog({
    text: "材料不齐的，可以告知群众补正材料。",
    sourceType: "自动识别",
    fileName: "draft.docx",
    issues: result.issues,
    match: result.match,
    signals: INITIAL_SIGNALS,
  });

  assert.ok(log.length >= 8);
  assert.deepEqual(
    log.map((line) => line.phase),
    ["命令接收", "输入理解", "任务拆解", "工具调用", "证据读取", "差异判断", "执行落地", "结果输出"]
  );
  assert.ok(log.some((line) => line.message.includes("用户命令")));
  assert.ok(log.some((line) => line.message.includes("模拟工具调用")));
  assert.ok(log.some((line) => line.message.includes("舆情感知")));
  assert.ok(log.some((line) => line.message.includes("逐项确认")));
  assert.equal(log.some((line) => line.message.includes("隐藏思维链")), false);
});
