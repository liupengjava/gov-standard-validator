# Changelog

## [Unreleased]

### 新增
- 初始化 monorepo 项目骨架（`apps/web` + `packages/core`）。
- 新增政务服务标准验证控制台 V1（总览、知识库、文本校验、舆情与调研、比对验证、报告输出）。
- 新增向量能力 API：`/api/vector/ingest-file`、`/api/vector/embed-missing`、`/api/vector/search`。

### 技术迁移（来自 SalesPilot）
- 迁入 `packages/core/src/db.ts` 的 sqlite + FTS + sqlite-vec 核心逻辑。
- 迁入 `packages/core/src/parsing.ts` 的 VLM 文档解析编排逻辑。
- 迁入 `packages/core/src/retrieval.ts` 的混合检索与重排逻辑。
- 迁入 `services/parser-py/*` 的文档解析、embedding、rerank 脚本。

