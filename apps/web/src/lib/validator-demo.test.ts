import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_LOG_PLAYBACK_DELAY_MS,
  INITIAL_CLAUSES,
  beginAgentExecutionRun,
  buildAgentExecutionLog,
  buildAgentExecutionTrace,
  buildAgentThinkingExecutionLog,
  buildDraftValidationStatus,
  buildFormattedVerificationReport,
  buildKeyVerificationPoints,
  buildKnowledgeCatalogSearchTasks,
  buildKnowledgeFileAsset,
  isReadableDraftAttachment,
  isServerParsedDraftAttachment,
  isServerParsedKnowledgeAttachment,
  normalizeDraftAttachmentText,
  normalizeParsedDraftText,
  recordKnowledgeFileUsage,
  runDocumentValidation,
  sliceDraftTextForReview,
  sliceKnowledgeText,
  updateKnowledgeVectorBuild,
  verificationPointsAllConfirmed,
} from "./validator-demo.ts";

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

test("knowledge file assets track vector progress, logs, access count, and call count", () => {
  const asset = buildKnowledgeFileAsset({
    name: "GBZ 24294.3-2017.pdf",
    sourceType: "upload",
    sourceLabel: "本地上传",
    addedAt: "2026-07-21 10:40",
    sliceCount: 28,
    vectorProgress: 65,
  });

  assert.equal(asset.vectorLogs.some((line) => line.includes("65%")), true);
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
  const report = buildFormattedVerificationReport({ draftFileName: "draft.docx", match: result.match, points });

  assert.ok(report.includes("格式化验证报告"));
  assert.ok(report.includes("采纳意见"));
  assert.ok(report.includes("拒绝意见"));
  assert.ok(report.includes("专家确认完成"));
});

test("buildAgentExecutionTrace summarizes the validation agent process", () => {
  const result = runDocumentValidation("材料不齐的，可以告知群众补正材料。", INITIAL_CLAUSES);
  const trace = buildAgentExecutionTrace({
    text: "材料不齐的，可以告知群众补正材料。",
    sourceType: "标准草案",
    fileName: "草案.txt",
    issues: result.issues,
    match: result.match,
  });

  assert.deepEqual(
    trace.map((step) => step.phase),
    ["读取输入", "结构抽取", "规则校验", "知识库比对", "结论生成"]
  );
  assert.ok(trace.every((step) => step.status === "done"));
  assert.ok(trace[0].action.includes("草案.txt"));
  assert.ok(trace[2].thought.includes("材料补正表述不完整"));
  assert.ok(trace[3].evidence.includes("YC-8.3"));
});

test("buildAgentExecutionLog expands trace into a scrollable audit log", () => {
  const result = runDocumentValidation("材料不齐的，可以告知群众补正材料。", INITIAL_CLAUSES);
  const log = buildAgentExecutionLog({
    text: "材料不齐的，可以告知群众补正材料。",
    sourceType: "标准草案",
    fileName: "草案.docx",
    issues: result.issues,
    match: result.match,
  });

  assert.ok(log.length >= 16);
  assert.deepEqual([...new Set(log.map((line) => line.kind))], ["system", "action", "reasoning", "evidence", "result"]);
  assert.ok(log.some((line) => line.message.includes("材料补正表述不完整")));
  assert.ok(log.some((line) => line.message.includes("YC-8.3")));
  assert.ok(log.every((line) => /^\d{2}:\d{2}:\d{2}$/.test(line.time)));
});

test("buildAgentThinkingExecutionLog exposes agent-like command execution steps", () => {
  const result = runDocumentValidation("材料不齐的，可以告知群众补正材料。", INITIAL_CLAUSES);
  const log = buildAgentThinkingExecutionLog({
    text: "材料不齐的，可以告知群众补正材料。",
    sourceType: "自动识别",
    fileName: "draft.docx",
    issues: result.issues,
    match: result.match,
  });

  assert.ok(log.length >= 8);
  assert.deepEqual(
    log.map((line) => line.phase),
    ["命令接收", "输入理解", "任务拆解", "工具调用", "证据读取", "差异判断", "执行落地", "结果输出"]
  );
  assert.ok(log.some((line) => line.message.includes("用户命令")));
  assert.ok(log.some((line) => line.message.includes("模拟工具调用")));
  assert.ok(log.some((line) => line.message.includes("逐项确认")));
  assert.equal(log.some((line) => line.message.includes("隐藏思维链")), false);
});
