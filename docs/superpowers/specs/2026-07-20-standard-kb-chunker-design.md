# 标准知识库切片与构建设计

## 背景

技术方案要求系统把标准文件转成“可检索、可引用、可验证”的知识单元，而不是简单保存 Word、PDF 或 OCR 文本。当前实现存在两条割裂链路：

- 前端“标准知识库”页面使用 `sliceKnowledgeText` 按换行和句号粗切，并只保留前 12 条。
- 真实向量入库使用 `parseAndStore` 按页、原文、摘要、表格等内容入库，缺少标准条款编号、父子关系和业务元数据。

这会导致扫描 PDF 即使 OCR 正确，后续仍会出现条款被切碎、目录和正文混杂、无法按条款追溯、检索命中不稳定等问题。

## 目标

本阶段采用方案 B：建设一个共享的标准文档切片引擎，前端预览和真实知识库入库统一使用同一套逻辑。

目标包括：

- 按标准文档结构识别目录、章节、条款、附录、表格、规范性引用文件和术语定义。
- 以条款为主要 chunk 单元，保留上级标题和上下文，避免孤立短句。
- 为每个 chunk 生成标准号、标准名称、章节路径、条款编号、条款类型、约束强度、业务维度、来源页码、质量分等元数据。
- 前端预览可只展示部分切片，但真实入库必须完整保留。
- 对扫描版 PDF/OCR 文本做噪声清洗和质量门禁，低质量片段标记为需复核。

## 非目标

本阶段不完整实现知识图谱、证据库、跨标准替代关系推理和人工复核后台。这些属于后续阶段，但本阶段输出的元数据需要为后续扩展保留接口。

## 核心模型

新增标准切片模块，建议放在 `packages/core/src/standard-chunker.ts`，并暴露纯函数：

```ts
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
  constraint: "must" | "should" | "may" | "prohibit" | "unknown";
  dimension: "material" | "process" | "resource" | "security" | "evaluation" | "archive" | "definition" | "other";
  pageStart?: number;
  pageEnd?: number;
  sourceMethod: "native" | "ocr" | "mixed";
  confidence: number;
  needsReview: boolean;
  qualityNotes: string[];
};

export function chunkStandardDocument(input: {
  text: string;
  title?: string;
  sourceMethod?: "native" | "ocr" | "mixed";
}): StandardChunk[];
```

## 切片规则

文本清洗：

- 合并 OCR 造成的中文字符间空格。
- 删除重复页眉、页脚、页码行和 `第 N 页` 类噪声。
- 识别并弱化目录行，例如只含标题和页码的行。
- 保留表格 Markdown 和列表结构，不把表格行随意拼入前后条款。

结构识别：

- 标准名称优先从文件名、首页标题和 `GB/T`、`GA/T`、`DB` 等标准号模式提取。
- 章节标题识别 `1 范围`、`2 规范性引用文件`、`3 术语和定义`、`4 xxx`。
- 条款边界优先识别 `4.1`、`4.1.1`、`A.1`、`附录A`、`表1` 等编号。
- 对无编号但位于已识别章节下的短段落，归并到最近条款或作为 `paragraph` 低置信 chunk。

语义标注：

- `必须`、`应`、`不得` 标记为强约束或禁止约束。
- `宜` 标记为推荐约束。
- `可`、`可以` 标记为允许约束。
- 根据关键词标注业务维度：材料、流程、资源、系统、设备、安全、评价、归档、术语定义等。
- `范围`、`规范性引用文件`、`术语和定义`、`附录` 使用专门 chunk 类型。

质量门禁：

- 过短且无上级上下文的 chunk 标记 `needsReview=true`。
- OCR 文本中乱码比例、非中文符号比例、编号断裂明显时降低 `confidence`。
- 标准条款编号不连续时记录 `qualityNotes`，但不中断入库。

## 入库设计

短期兼容当前数据库，不做破坏性迁移：

- `units` 表继续作为父级结构单元，一条标准条款对应一个 unit。
- `chunks` 表继续保存可检索正文。
- 结构化元数据先写入 `chunks.source_method`、`confidence`、`needs_review`、`parent_unit_id` 和 `units.visual_json`。
- chunk 文本前缀带最小可读上下文，例如：`GA/T 1593-2019 > 4 标准体系结构 > 4.1 总体要求\n正文...`。

后续可选迁移：

- 新增 `chunk_metadata` 或扩展 `chunks.metadata` JSON 字段，避免把结构化信息长期塞进 `visual_json`。

## 集成点

前端知识库预览：

- `apps/web/src/lib/validator-demo.ts` 的 `sliceKnowledgeText` 改为调用标准切片逻辑的轻量版本或共享输出适配器。
- 预览按章节分组展示，默认显示前若干条，但入库数量提示应展示总切片数。

真实文件入库：

- `apps/web/src/app/api/vector/ingest-file/route.ts` 仍接收上传文件。
- PDF/DOC/DOCX 解析完成后调用 `chunkStandardDocument`。
- `packages/core/src/parsing.ts` 在处理标准类文档时走条款切片；PPT 类材料继续保留现有 VLM 页级入库。
- 入库后继续调用 `embedMissingChunks` 生成向量。

OCR 链路：

- `services/parser-py/extract_pdf_text.py` 输出 parser 名称后，调用方根据 `windows-ocr` 标记 `sourceMethod="ocr"`。
- 低置信 OCR chunk 不阻断检索，但在 UI 和元数据中标记“需复核”。

## 测试计划

新增核心测试：

- 能把包含 `1 范围`、`2 规范性引用文件`、`3 术语和定义`、`4.1`、`4.1.1` 的文本切成条款 chunk。
- 能识别强制、推荐、允许和禁止约束。
- 能识别材料、流程、安全、评价、资源等业务维度。
- 能清理 OCR 中文空格、页码和重复页眉页脚。
- 不再限制为前 12 条。
- 前端 `sliceKnowledgeText` 适配后仍返回页面所需的 `Clause[]`。

回归测试：

- `apps/web/src/lib/validator-demo.test.ts`
- `apps/web/src/lib/pdf-extract.test.ts`
- `packages/core/src/parsing.test.ts`
- TypeScript `tsc --noEmit`

## 验收标准

- 上传中文扫描版 PDF 后，切片预览不再是乱码或页级混合文本。
- 切片结果能看到条款编号、上级章节和条款正文。
- 同一个标准文件的真实入库 chunk 数量不被截断为 12。
- 文本验证时可以引用到更准确的条款内容。
- 低质量 OCR 内容不会静默当作高质量标准条款。

