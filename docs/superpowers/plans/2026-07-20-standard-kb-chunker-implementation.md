# Standard KB Chunker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sentence-only knowledge slicing with a shared standard-document chunker that preserves clause structure and removes the 12-slice cap.

**Architecture:** Add a pure `standard-chunker` module in `packages/core`, export it for both server and web use, then adapt the existing web `Clause[]` preview to consume structured standard chunks. Keep database changes compatible by storing structured metadata in existing JSON/text fields first.

**Tech Stack:** TypeScript, Node test runner, Next.js app code, existing SQLite ingest primitives.

---

### Task 1: Core Standard Chunker

**Files:**
- Create: `packages/core/src/standard-chunker.ts`
- Create: `packages/core/src/standard-chunker.test.ts`
- Modify: `packages/core/package.json`

- [ ] Write failing tests for clause boundaries, OCR/catalog cleanup, constraints, dimensions, and no 12-item cap.
- [ ] Run `node --test packages/core/src/standard-chunker.test.ts` and verify the module is missing or behavior fails.
- [ ] Implement `chunkStandardDocument` as a pure TypeScript module.
- [ ] Export `./standard-chunker` from `packages/core/package.json`.
- [ ] Re-run the core chunker test and verify it passes.

### Task 2: Frontend Knowledge Preview Adapter

**Files:**
- Modify: `apps/web/src/lib/validator-demo.ts`
- Modify: `apps/web/src/lib/validator-demo.test.ts`

- [ ] Add failing tests showing `sliceKnowledgeText` returns more than 12 real clauses and skips catalog dot-leader rows.
- [ ] Run `node --test apps/web/src/lib/validator-demo.test.ts` and verify the new tests fail.
- [ ] Adapt `sliceKnowledgeText` to call `chunkStandardDocument` and map structured chunks into existing `Clause[]`.
- [ ] Re-run the web validator tests and verify they pass.

### Task 3: Real Ingest Hook

**Files:**
- Modify: `packages/core/src/parsing.ts`
- Modify: `packages/core/src/docx.ts`

- [ ] Add standard-document chunk storage helpers using existing `units` and `chunks`.
- [ ] Route PDF/DOC/DOCX standard files through `chunkStandardDocument` before falling back to page/VLM chunks.
- [ ] Preserve current PPT behavior.
- [ ] Run existing parsing/docx tests and TypeScript checks.

### Task 4: Verification

**Files:**
- No new production files unless verification exposes a defect.

- [ ] Run targeted tests: `node --test packages/core/src/standard-chunker.test.ts apps/web/src/lib/validator-demo.test.ts apps/web/src/lib/pdf-extract.test.ts packages/core/src/parsing.test.ts`.
- [ ] Run TypeScript: `pnpm --filter @gov-validator/web exec tsc --noEmit`.
- [ ] Restart or confirm the local dev server, then report the URL and behavior.
