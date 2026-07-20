export function hasLowQualityPdfText(text: string): boolean {
  const compact = text.replace(/\s/g, "");
  if (compact.length < 20) return true;
  const withoutPageMarkers = text.replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "").replace(/[-\s]/g, "");
  if (withoutPageMarkers.length < Math.max(12, compact.length * 0.2)) return true;
  const replacementCount = (compact.match(/[?�]/g) || []).length;
  const cjkCount = (compact.match(/[\u4e00-\u9fff]/g) || []).length;
  if (replacementCount >= 6 && replacementCount / compact.length > 0.08) return true;
  if (replacementCount > cjkCount && replacementCount > 10) return true;
  return false;
}
