import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDraftValidationStatus,
  buildAgentExecutionTrace,
  buildAgentExecutionLog,
  beginAgentExecutionRun,
  INITIAL_CLAUSES,
  isReadableDraftAttachment,
  isServerParsedDraftAttachment,
  isServerParsedKnowledgeAttachment,
  normalizeParsedDraftText,
  normalizeDraftAttachmentText,
  runDocumentValidation,
  sliceKnowledgeText,
} from "./validator-demo.ts";

test("beginAgentExecutionRun keeps the active run id valid for playback", () => {
  const run = beginAgentExecutionRun(7);
  assert.deepEqual(run, { runId: 8, currentRunId: 8 });
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

test("isServerParsedDraftAttachment routes Word attachments to parser service", () => {
  assert.equal(isServerParsedDraftAttachment("标准草案.docx"), true);
  assert.equal(isServerParsedDraftAttachment("标准草案.doc"), true);
  assert.equal(isServerParsedDraftAttachment("标准草案.txt"), false);
  assert.equal(isServerParsedDraftAttachment("标准草案.pdf"), false);
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

test("normalizeParsedDraftText cleans parser service output", () => {
  assert.equal(
    normalizeParsedDraftText("  第一条  应一次性告知补正内容。\n\n\n第二条\t涉及敏感数据应脱敏。 "),
    "第一条 应一次性告知补正内容。\n第二条 涉及敏感数据应脱敏。"
  );
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
  assert.equal(
    buildDraftValidationStatus("样例标准草案.txt", 4),
    "文档状态：样例标准草案.txt 已完成验证，发现 4 项需关注问题。"
  );
});

test("runDocumentValidation combines text checks and clause comparison", () => {
  const result = runDocumentValidation("材料不齐的，可以告知群众补正材料。", INITIAL_CLAUSES);
  assert.ok(result.issues.some(([, title]) => title === "材料补正表述不完整"));
  assert.equal(result.match.clause.id, "YC-8.3");
  assert.ok(result.match.score > 0);
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
