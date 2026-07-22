import { test } from "node:test";
import assert from "node:assert/strict";
import { getPdfTextQualityError, hasPdfEncodingArtifacts, hasLowQualityPdfText } from "./pdf-extract.ts";

test("hasPdfEncodingArtifacts detects cid embedded-font PDF noise", () => {
  const text = "%%t‰(cid:176)\n[3]、10“+”\nok}EW~u(cid:148)o(cid:137)(cid:148)(cid:149)Gvn WJ(cid:157)";
  assert.equal(hasPdfEncodingArtifacts(text), true);
  assert.equal(hasLowQualityPdfText(text), true);
});

test("hasLowQualityPdfText detects replacement-heavy Chinese PDF extraction", () => {
  assert.equal(hasLowQualityPdfText("DB22/T 3585?2023\n???????????\n2023 - 09 - 28 ?? 2023 - 11 - 16 ??"), true);
  assert.equal(hasLowQualityPdfText("-- 1 of 28 --\n-- 2 of 28 --\n-- 3 of 28 --\n-- 4 of 28 --"), true);
});

test("hasLowQualityPdfText detects mojibake and embedded-font gibberish", () => {
  assert.equal(hasLowQualityPdfText("ICS 35.240.01\n鍚夋灄鐪 鍦版柟鏍囧噯\n鏀垮姟鏈嶅姟鏉愭枡搴撴暟鎹鑼\n2023 骞 09 鏈 28 鏃ュ彂甯"), true);
  assert.equal(
    hasLowQualityPdfText(
      "/G37/G38/G39/G3A/G3B/G3C/G3D/G3E/G3F\n祥状为狂狂狞檬汸卅狂状昊豺发迋狂沛标泥豺发沅状狂状狂犭泥\n暇狂沛犭狂狞沛犭祌状犭祌状标檬沛犭狂状犭狂狂料状沅豺状材状"
    ),
    true
  );
});

test("hasLowQualityPdfText keeps readable Chinese standard text", () => {
  assert.equal(
    hasLowQualityPdfText("GB/T 39554.1—2020 全国一体化政务服务平台 政务服务事项基本目录及实施清单\n5.1.1 编码要求\n事项编码应唯一、稳定，并与实施清单保持一致。"),
    false
  );
});

test("getPdfTextQualityError returns a user-facing warning for gibberish PDF text", () => {
  const text =
    "GBZ+24294.3-2017.pdf\n/G37/G38/G39/G3A/G3B/G3C/G3D/G3E/G3F\n祥状为狂狂狞檬汸卅狂状昊豺发迋狂沛标泥豺发沅状";

  assert.match(getPdfTextQualityError(text) || "", /自动尝试 OCR/);
  assert.equal(getPdfTextQualityError("5.1.1 事项编码应唯一、稳定，并与实施清单保持一致。"), null);
});

test("hasPdfEncodingArtifacts detects visible PDF encoding noise without rejecting short text", () => {
  assert.equal(hasPdfEncodingArtifacts("/G37/G38/G39/G3A/G3B/G3C/G3D/G3E/G3F\n祥状为狂狂狞檬汸"), true);
  assert.equal(hasPdfEncodingArtifacts("5.1.1 事项编码应唯一。"), false);
});
