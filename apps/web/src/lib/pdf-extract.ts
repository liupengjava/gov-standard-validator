const COMMON_CHINESE_RE = /[的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经]/g;
const STANDARD_TERMS_RE = /标准|服务|要求|范围|规范|条款|部分|目录|实施|发布|术语|定义|引用|文件|规定|适用|管理|平台|政务|信息|数据|安全|编码/g;
const MOJIBAKE_RE = /[鍚夋灄鐪噯姟鏉愭枡搴撴暟鎹鑼骞鏈鏃甯]/g;
const EMBEDDED_FONT_NOISE_RE = /[狂狞檬犭祌卅豺沛汸迋昊暇沅]/g;
const EMBEDDED_FONT_GLYPH_RE = /\/G[0-9A-F]{2}\b/gi;
const CID_FONT_GLYPH_RE = /\(cid:\d+\)/gi;
const LOW_QUALITY_PDF_TEXT_ERROR = "PDF 文本层疑似乱码，系统将自动尝试 OCR 识别；如 OCR 仍失败，请使用更清晰的扫描件或可复制正文的 PDF。";

export function hasPdfEncodingArtifacts(text: string): boolean {
  const compact = text.replace(/\s/g, "");
  if (!compact) return false;

  const replacementCount = (compact.match(/[?�锟]/g) || []).length;
  const cjkCount = (compact.match(/[\u4e00-\u9fff]/g) || []).length;
  const commonChineseCount = (compact.match(COMMON_CHINESE_RE) || []).length;
  const standardTermCount = (compact.match(STANDARD_TERMS_RE) || []).length;
  const mojibakeCount = (compact.match(MOJIBAKE_RE) || []).length;
  const embeddedFontNoiseCount = (compact.match(EMBEDDED_FONT_NOISE_RE) || []).length;
  const embeddedFontGlyphCount = (text.match(EMBEDDED_FONT_GLYPH_RE) || []).length;
  const cidFontGlyphCount = (text.match(CID_FONT_GLYPH_RE) || []).length;

  if (cidFontGlyphCount >= 2) return true;
  if (replacementCount >= 6 && replacementCount / compact.length > 0.08) return true;
  if (replacementCount > cjkCount && replacementCount > 10) return true;
  if (embeddedFontGlyphCount >= 4 && cjkCount >= 8 && commonChineseCount / cjkCount < 0.18) return true;
  if (cjkCount >= 24 && mojibakeCount / cjkCount > 0.22 && standardTermCount === 0) return true;
  if (cjkCount >= 24 && embeddedFontNoiseCount / cjkCount > 0.12 && commonChineseCount / cjkCount < 0.08) return true;
  if (cjkCount >= 80 && commonChineseCount / cjkCount < 0.03 && standardTermCount === 0) return true;

  return false;
}

export function hasLowQualityPdfText(text: string): boolean {
  const compact = text.replace(/\s/g, "");
  if (compact.length < 20) return true;

  const withoutPageMarkers = text.replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "").replace(/[-\s]/g, "");
  if (withoutPageMarkers.length < Math.max(12, compact.length * 0.2)) return true;

  if (hasPdfEncodingArtifacts(text)) return true;

  return false;
}

export function getPdfTextQualityError(text: string): string | null {
  return hasLowQualityPdfText(text) ? LOW_QUALITY_PDF_TEXT_ERROR : null;
}
