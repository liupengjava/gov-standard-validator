# Public Sentiment Three Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public sentiment comparison as a supporting validation capability while keeping standard knowledge base comparison as the report's primary basis.

**Architecture:** Extend existing demo-domain helpers in `apps/web/src/lib/validator-demo.ts` so execution phases, report text, and signal vector pagination are testable outside React. Then wire those helpers into `apps/web/src/components/validator-console.tsx` with restrained UI changes, excluding the top three-stage roadmap/banner from the page.

**Tech Stack:** Next.js, React, TypeScript, Node test runner, existing UI components and Tailwind utility classes.

---

### Task 1: Update PRD Constraint

**Files:**
- Modify: `docs/superpowers/specs/2026-07-23-public-sentiment-three-stage-prd.md`

- [ ] **Step 1: Remove page-level three-stage roadmap requirement**

Delete the UI requirement that asks for a lightweight three-stage explanation on the page. Replace the pending UI placement decisions with the approved defaults:

```markdown
4. 不在正式页面展示顶部“三阶段说明/群众感知比对进入验证链路”区域，三阶段只保留在 PRD 和内部建设规划中。
```

- [ ] **Step 2: Verify PRD no longer requests the removed page section**

Run: `Select-String -Encoding UTF8 -LiteralPath "docs\superpowers\specs\2026-07-23-public-sentiment-three-stage-prd.md" -Pattern "三阶段说明|群众感知比对进入验证链路"`

Expected: no active UI requirement asks for that section to appear in the application page.

### Task 2: Add Testable Public Sentiment Helpers

**Files:**
- Modify: `apps/web/src/lib/validator-demo.test.ts`
- Modify: `apps/web/src/lib/validator-demo.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving:

```typescript
test("agent execution phases include public sentiment comparison before conclusion", () => {
  const result = runDocumentValidation("材料不齐的，可以告知群众补正材料。", INITIAL_CLAUSES);
  assert.deepEqual(
    buildAgentExecutionStepCards(buildAgentExecutionLog({
      text: "材料不齐的，可以告知群众补正材料。",
      sourceType: "规范性文件",
      fileName: "测试文件.docx",
      issues: result.issues,
      match: result.match,
      confirmedSlices: 1,
      totalSlices: 1,
      signals: INITIAL_SIGNALS,
    }), { started: true, running: false }).map((step) => step.phase),
    ["读取输入", "结构抽取", "规则校验", "知识库比对", "舆情感知比对", "结论生成"]
  );
});

test("public sentiment support summarizes samples as auxiliary evidence", () => {
  const result = runDocumentValidation("线上预审通过后，窗口仍要求群众重复提交纸质材料。", INITIAL_CLAUSES);
  const support = buildPublicSentimentSupport({ match: result.match, signals: INITIAL_SIGNALS });
  assert.equal(support.sampleCount > 0, true);
  assert.equal(support.evidenceLevel, "辅助依据");
  assert.ok(support.boundaryNote.includes("不替代标准知识库比对结论"));
});

test("formatted report keeps knowledge base conclusion primary and adds public sentiment support", () => {
  const result = runDocumentValidation("材料不齐的，可以告知群众补正材料。", INITIAL_CLAUSES);
  const report = buildFormattedVerificationReport({
    match: result.match,
    issues: result.issues,
    points: buildKeyVerificationPoints(result),
    sourceType: "规范性文件",
    draftFileName: "测试文件.docx",
    signals: INITIAL_SIGNALS,
  });
  assert.ok(report.includes("三、标准知识库比对主结论"));
  assert.ok(report.includes("四、群众感知佐证（辅助依据）"));
  assert.ok(report.indexOf("三、标准知识库比对主结论") < report.indexOf("四、群众感知佐证（辅助依据）"));
});

test("public sentiment vectors paginate twenty samples per page", () => {
  const items = Array.from({ length: 41 }, (_, index) => ({ ...INITIAL_SIGNALS[index % INITIAL_SIGNALS.length], id: `s-${index}` }));
  const page = paginatePublicSentimentVectorSamples(items, 3, 20);
  assert.equal(page.totalPages, 3);
  assert.equal(page.items.length, 1);
  assert.equal(page.startIndex, 40);
});
```

- [ ] **Step 2: Run tests to verify RED**

Run: `node --test apps\web\src\lib\validator-demo.test.ts`

Expected: FAIL because new helpers/report behavior do not exist yet.

- [ ] **Step 3: Implement minimal helpers**

In `validator-demo.ts`, add:

```typescript
export type PublicSentimentSupport = {
  sampleCount: number;
  evidenceLevel: "辅助依据";
  relatedSources: string[];
  relatedTypes: string[];
  issueTags: string[];
  summaries: string[];
  boundaryNote: string;
};
```

Implement `buildPublicSentimentSupport` and `paginatePublicSentimentVectorSamples`, update default execution phases/log entries, and extend `buildFormattedVerificationReport` to accept optional `signals`.

- [ ] **Step 4: Run tests to verify GREEN**

Run: `node --test apps\web\src\lib\validator-demo.test.ts`

Expected: all validator demo tests pass.

### Task 3: Wire Helpers Into UI Without Top Roadmap

**Files:**
- Modify: `apps/web/src/components/validator-console.tsx`

- [ ] **Step 1: Add UI state and imports**

Import `buildPublicSentimentSupport` and `paginatePublicSentimentVectorSamples`. Add page state for public sentiment vector pagination.

- [ ] **Step 2: Pass signals into validation/report builders**

Add `signals` to the agent execution inputs and formatted report generation call. Keep standard knowledge base match as the primary report text.

- [ ] **Step 3: Add focused UI sections only**

Add these UI elements:

```text
1. Current execution step detail for “舆情感知比对”.
2. Report preview support block showing “群众感知佐证（辅助依据）”.
3. Signal vector pagination area in the existing “舆情与调研” page.
```

Do not add the removed top area:

```text
群众感知比对进入验证链路
阶段一 / 阶段二 / 阶段三 cards
```

- [ ] **Step 4: Build**

Run: `pnpm --filter @gov-validator/web build`

Expected: build exits 0. Existing Turbopack/NFT warnings may appear but must not fail the build.

### Task 4: Final Verification

**Files:**
- Verify: `apps/web/src/lib/validator-demo.test.ts`
- Verify: `apps/web/src/components/validator-console.tsx`
- Verify: `docs/superpowers/specs/2026-07-23-public-sentiment-three-stage-prd.md`

- [ ] **Step 1: Run full targeted tests**

Run: `node --test apps\web\src\lib\validator-demo.test.ts`

Expected: all tests pass.

- [ ] **Step 2: Run production build**

Run: `pnpm --filter @gov-validator/web build`

Expected: build exits 0.

- [ ] **Step 3: Check removed UI text is not in application code**

Run: `rg -n "群众感知比对进入验证链路|阶段一|阶段二|阶段三" apps/web/src`

Expected: no application page code contains the removed top roadmap text.
