#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import sys
import tempfile


def normalize_text(text: str) -> str:
    lines = []
    for line in text.replace("\r", "\n").split("\n"):
        cleaned = " ".join(line.split())
        if cleaned:
            lines.append(cleaned)
    return "\n".join(lines)


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
    args = parser.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    result_path = os.path.join(args.outdir, "pdf_text_result.json")

    parser_name = "pypdf"
    text = ""
    errors = []
    try:
        text = normalize_text(extract_with_pypdf(args.inp))
    except Exception as exc:
        errors.append(f"pypdf: {exc}")

    if len(text) < 20:
        try:
            text = normalize_text(extract_with_pdfplumber(args.inp))
            parser_name = "pdfplumber"
        except Exception as exc:
            errors.append(f"pdfplumber: {exc}")

    if len(text) < 20:
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
