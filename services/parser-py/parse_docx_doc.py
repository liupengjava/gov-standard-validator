#!/usr/bin/env python3
"""docx 文档式解析：python-docx 直接读段落文字+表格 → markdown，并提取嵌入图片。
不渲染页图、不每页 VLM（文档型内容文字为主，图片才交给 VLM）。

用法:
  python3 parse_docx_doc.py --in /path/a.docx --outdir /path/derived/<id>
输出: stdout 最后一行打印 result.json 路径；json 含 {ok, markdown, images:[path], title}
"""
import sys, os, json, argparse


def _heading_level(style_name: str) -> int:
    s = (style_name or "").lower()
    if s.startswith("title"):
        return 1
    if s.startswith("heading"):
        digits = "".join(ch for ch in s if ch.isdigit())
        return min(int(digits), 4) if digits else 2
    return 0


def _table_md(table) -> str:
    rows = [[(c.text or "").strip().replace("\n", " ").replace("|", "\\|") for c in r.cells] for r in table.rows]
    rows = [r for r in rows if any(r)]
    if not rows:
        return ""
    ncol = max(len(r) for r in rows)
    norm = lambda r: r + [""] * (ncol - len(r))
    out = ["| " + " | ".join(norm(rows[0])) + " |", "|" + " --- |" * ncol]
    for r in rows[1:]:
        out.append("| " + " | ".join(norm(r)) + " |")
    return "\n".join(out)


def extract(path: str, outdir: str) -> dict:
    from docx import Document
    from docx.document import Document as _Doc
    from docx.oxml.table import CT_Tbl
    from docx.oxml.text.paragraph import CT_P
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    os.makedirs(outdir, exist_ok=True)
    doc = Document(path)

    # 按文档顺序遍历段落与表格（保持正文顺序）
    parts = []
    body = doc.element.body
    for child in body.iterchildren():
        if isinstance(child, CT_P):
            p = Paragraph(child, doc)
            txt = (p.text or "").strip()
            if not txt:
                continue
            lvl = _heading_level(p.style.name if p.style else "")
            parts.append("#" * lvl + " " + txt if lvl else txt)
        elif isinstance(child, CT_Tbl):
            md = _table_md(Table(child, doc))
            if md:
                parts.append(md)
    markdown = "\n\n".join(parts)

    # 文档标题：core properties title 优先，否则首个 heading/首行
    title = ""
    try:
        title = (doc.core_properties.title or "").strip()
    except Exception:
        title = ""

    # 提取嵌入图片（去重，按关系顺序）
    images = []
    seen = set()
    idx = 0
    for rel in doc.part.rels.values():
        if "image" not in rel.reltype:
            continue
        try:
            blob = rel.target_part.blob
        except Exception:
            continue
        h = hash(blob[:2048])
        if h in seen:
            continue
        seen.add(h)
        idx += 1
        ext = os.path.splitext(rel.target_ref)[1] or ".png"
        fn = os.path.join(outdir, f"docimg_{idx}{ext}")
        with open(fn, "wb") as f:
            f.write(blob)
        images.append(fn)

    return {"ok": True, "markdown": markdown, "images": images, "title": title}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--outdir", required=True)
    args = ap.parse_args()
    try:
        out = extract(args.inp, args.outdir)
    except Exception as e:
        out = {"ok": False, "error": str(e), "markdown": "", "images": [], "title": ""}
    rp = os.path.join(args.outdir, "docx_result.json")
    with open(rp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(rp)


if __name__ == "__main__":
    main()
