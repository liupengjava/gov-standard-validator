import { test } from "node:test";
import assert from "node:assert/strict";
import { hasLowQualityPdfText } from "./pdf-extract.ts";

test("hasLowQualityPdfText detects replacement-heavy Chinese PDF extraction", () => {
  assert.equal(hasLowQualityPdfText("DB22/T 3585?2023\n???????????\n2023 - 09 - 28 ?? 2023 - 11 - 16 ??"), true);
  assert.equal(hasLowQualityPdfText("-- 1 of 28 --\n-- 2 of 28 --\n-- 3 of 28 --\n-- 4 of 28 --"), true);
  assert.equal(hasLowQualityPdfText("ICS 35.240.01\n吉林省 地方标准\n政务服务材料库数据规范\n2023 年 09 月 28 日发布"), false);
});
