#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import re
import sys
import tempfile


def normalize_text(text: str) -> str:
    lines = []
    for line in text.replace("\r", "\n").split("\n"):
        cleaned = " ".join(line.split())
        if cleaned:
            lines.append(cleaned)
    return "\n".join(lines)


COMMON_CHINESE = set("的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经")
STANDARD_TERMS = ("标准", "服务", "要求", "范围", "规范", "条款", "部分", "目录", "实施", "发布", "术语", "定义", "引用", "文件", "规定", "适用", "管理", "平台", "政务", "信息", "数据", "安全", "编码")
MOJIBAKE_CHARS = set("鍚夋灄鐪噯姟鏉愭枡搴撴暟鎹鑼骞鏈鏃甯")
EMBEDDED_FONT_NOISE_CHARS = set("狂狞檬犭祌卅豺沛汸迋昊暇沅")


def has_low_quality_text(text: str) -> bool:
    compact = "".join(str(text or "").split())
    if len(compact) < 20:
        return True

    without_page_markers = re.sub(r"--\s*\d+\s+of\s+\d+\s*--", "", text, flags=re.I)
    without_page_markers = re.sub(r"[-\s]", "", without_page_markers)
    if len(without_page_markers) < max(12, int(len(compact) * 0.2)):
        return True

    replacement_count = len(re.findall(r"[?�锟]", compact))
    cjk_chars = re.findall(r"[\u4e00-\u9fff]", compact)
    cjk_count = len(cjk_chars)
    common_count = sum(1 for ch in cjk_chars if ch in COMMON_CHINESE)
    standard_term_count = sum(compact.count(term) for term in STANDARD_TERMS)
    mojibake_count = sum(1 for ch in cjk_chars if ch in MOJIBAKE_CHARS)
    embedded_noise_count = sum(1 for ch in cjk_chars if ch in EMBEDDED_FONT_NOISE_CHARS)
    embedded_glyph_count = len(re.findall(r"/G[0-9A-F]{2}\b", text, flags=re.I))
    cid_glyph_count = len(re.findall(r"\(cid:\d+\)", text, flags=re.I))

    if cid_glyph_count >= 2:
        return True
    if replacement_count >= 6 and replacement_count / len(compact) > 0.08:
        return True
    if replacement_count > cjk_count and replacement_count > 10:
        return True
    if embedded_glyph_count >= 4 and cjk_count >= 8 and common_count / cjk_count < 0.18:
        return True
    if cjk_count >= 24 and mojibake_count / cjk_count > 0.22 and standard_term_count == 0:
        return True
    if cjk_count >= 24 and embedded_noise_count / cjk_count > 0.12 and common_count / cjk_count < 0.08:
        return True
    if cjk_count >= 80 and common_count / cjk_count < 0.03 and standard_term_count == 0:
        return True
    return False


def normalize_ocr_text(text: str) -> str:
    text = normalize_text(text)
    # Windows OCR often inserts spaces between adjacent CJK characters.
    text = __import__("re").sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", text)
    text = text.replace("一 2019", "—2019").replace("一 2023", "—2023")
    return text


def extract_with_pypdf(path: str) -> str:
    from pypdf import PdfReader

    reader = PdfReader(path)
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def extract_with_pdfplumber(path: str) -> str:
    import pdfplumber

    with pdfplumber.open(path) as pdf:
        return "\n".join((page.extract_text() or "") for page in pdf.pages)


async def ocr_image_with_windows(image_path: str) -> str:
    from winsdk.windows.globalization import Language
    from winsdk.windows.graphics.imaging import BitmapDecoder
    from winsdk.windows.media.ocr import OcrEngine
    from winsdk.windows.storage import StorageFile

    file = await StorageFile.get_file_from_path_async(image_path)
    stream = await file.open_read_async()
    decoder = await BitmapDecoder.create_async(stream)
    bitmap = await decoder.get_software_bitmap_async()
    engine = OcrEngine.try_create_from_language(Language("zh-Hans-CN")) or OcrEngine.try_create_from_user_profile_languages()
    if engine is None:
        raise RuntimeError("Windows OCR engine is unavailable")
    result = await engine.recognize_async(bitmap)
    return result.text or ""


def extract_with_windows_ocr(path: str, max_pages: int) -> str:
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(path)
    page_count = min(len(doc), max_pages)
    texts = []
    with tempfile.TemporaryDirectory(prefix="gov_pdf_ocr_") as tmp:
        for index in range(page_count):
            image_path = os.path.join(tmp, f"page_{index + 1:03d}.png")
            image = doc[index].render(scale=2.4).to_pil()
            image.save(image_path)
            page_text = asyncio.run(ocr_image_with_windows(image_path))
            if page_text.strip():
                texts.append(f"第{index + 1}页\n{page_text}")
    return normalize_ocr_text("\n".join(texts))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--in", dest="inp", required=True)
    parser.add_argument("--outdir", required=True)
    parser.add_argument("--ocr-max-pages", type=int, default=int(os.environ.get("SP_PDF_OCR_MAX_PAGES", "40")))
    parser.add_argument("--force-ocr", action="store_true")
    args = parser.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    result_path = os.path.join(args.outdir, "pdf_text_result.json")

    parser_name = "pypdf"
    text = ""
    errors = []
    if not args.force_ocr:
        try:
            text = normalize_text(extract_with_pypdf(args.inp))
        except Exception as exc:
            errors.append(f"pypdf: {exc}")

    if not args.force_ocr and has_low_quality_text(text):
        try:
            text = normalize_text(extract_with_pdfplumber(args.inp))
            parser_name = "pdfplumber"
        except Exception as exc:
            errors.append(f"pdfplumber: {exc}")

    if has_low_quality_text(text):
        try:
            text = extract_with_windows_ocr(args.inp, args.ocr_max_pages)
            parser_name = "windows-ocr"
        except Exception as exc:
            errors.append(f"windows-ocr: {exc}")

    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "ok": bool(text),
                "text": text,
                "parser": parser_name,
                "errors": errors,
            },
            f,
            ensure_ascii=False,
        )
    print(result_path)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
