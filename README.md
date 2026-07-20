# 政务服务标准验证智能体（V1 初始化）

本项目已按 `SalesPilot` 技术骨架初始化，并已迁入核心底层能力：

- `VLM 解析链路`：`packages/core/src/parsing.ts` + `services/parser-py/parse_doc.py`
- `向量检索链路`：`packages/core/src/db.ts`（sqlite-vec）+ `packages/core/src/retrieval.ts`
- `向量补全`：`packages/core/src/vector-index.ts`

同时实现了 Demo 对齐的 6 个业务视图：

- 总览驾驶舱
- 标准知识库
- 文本校验
- 舆情与调研
- 比对验证
- 报告输出

## 1. 安装依赖

```bash
pnpm install
```

Python 依赖（建议 Python 3.9+）：

```bash
python3 -m pip install --user pymupdf python-pptx sentence-transformers fastembed FlagEmbedding
```

> 如需完整 VLM 文档解析，请确保本机可用 `soffice`（LibreOffice）以及 `codex` 或 `claude` CLI。

### 新机器一键初始化（推荐）

```bash
./scripts/bootstrap_new_machine.sh
```

如需初始化后直接构建并启动：

```bash
./scripts/bootstrap_new_machine.sh --start
```

## 2. 启动

```bash
pnpm dev
```

访问：

- [http://127.0.0.1:5186/app](http://127.0.0.1:5186/app)

> 端口固定为 `5186`，避免与 `SalesPilot`（`5174`）冲突。

## 3. 核心 API

- `POST /api/vector/ingest-file`：文档 VLM 解析入库
- `POST /api/vector/embed-missing`：补全缺失向量
- `POST /api/vector/search`：语义检索

## 4. 目录

```text
apps/web/              Next.js 前端与 API
packages/core/         核心引擎（已迁入 SalesPilot 核心逻辑）
services/parser-py/    文档解析、向量、重排脚本
data/                  SQLite 数据库
storage/               原始文件与解析产物
```
