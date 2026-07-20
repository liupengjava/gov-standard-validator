import { test } from "node:test";
import assert from "node:assert/strict";
import { NAV_ITEMS } from "./navigation.ts";

test("navigation places text validation fourth after signals", () => {
  assert.deepEqual(
    NAV_ITEMS.map((item) => item.view),
    ["overview", "knowledge", "signals", "check", "report"]
  );
  assert.deepEqual(
    NAV_ITEMS.map((item) => item.title),
    ["总览驾驶舱", "标准知识库", "舆情与调研", "文本验证", "报告输出"]
  );
});
