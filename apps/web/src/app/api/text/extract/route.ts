import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";
import { getPdfTextQualityError, hasLowQualityPdfText } from "@/lib/pdf-extract";

export const runtime = "nodejs";

const pexec = promisify(execFile);
const require = createRequire(import.meta.url);
const RUNTIME_PYTHON = "C:\\Users\\12266\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";
const PDF_PARSE_WORKER = pathToFileURL(resolve(process.cwd(), "node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs")).href;

function findRepoRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml")) && existsSync(resolve(current, "services/parser-py"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return resolve(process.cwd(), "../..");
}

function pythonBin(): string {
  return process.env.SP_PYTHON || (existsSync(RUNTIME_PYTHON) ? RUNTIME_PYTHON : "python");
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function parseJsonAt(path: string): Promise<any> {
  return readFile(path, "utf-8").then((text) => JSON.parse(text));
}

async function extractDocx(inputPath: string, outdir: string, repoRoot: string) {
  const script = resolve(repoRoot, "services/parser-py/parse_docx_doc.py");
  const { stdout } = await pexec(pythonBin(), [script, "--in", inputPath, "--outdir", outdir], {
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const resultPath = stdout.trim().split(/\r?\n/).pop()?.trim();
  if (!resultPath) throw new Error("DOCX 解析未返回结果路径");
  const data = await parseJsonAt(resultPath);
  if (!data.ok) throw new Error(data.error || "DOCX 解析失败");
  return {
    text: normalizeExtractedText(data.markdown || ""),
    title: data.title || "",
    parser: "python-docx",
  };
}

async function extractDoc(inputPath: string, outdir: string, repoRoot: string) {
  const script = resolve(repoRoot, "services/parser-py/parse_doc.py");
  const { stdout } = await pexec(pythonBin(), [script, "--in", inputPath, "--outdir", outdir], {
    timeout: 300000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const resultPath = stdout.trim().split(/\r?\n/).pop()?.trim();
  if (!resultPath) throw new Error("DOC 解析未返回结果路径");
  const data = await parseJsonAt(resultPath);
  if (!data.ok) throw new Error(data.error || "DOC 解析失败");
  const text = (data.slides || [])
    .flatMap((page: any) => [page.text, page.notes, ...(page.tables || []).flat(2)])
    .filter(Boolean)
    .join("\n");
  return {
    text: normalizeExtractedText(text),
    title: "",
    parser: "libreoffice-pymupdf",
  };
}

async function extractDocWithWordExtractor(inputPath: string) {
  const WordExtractor = require("word-extractor");
  const extractor = new WordExtractor();
  const document = await extractor.extract(inputPath);
  const text = [
    document.getBody?.(),
    document.getHeaders?.(),
    document.getFooters?.(),
    document.getFootnotes?.(),
    document.getEndnotes?.(),
    document.getAnnotations?.(),
    document.getTextboxes?.(),
  ]
    .filter(Boolean)
    .join("\n");
  return {
    text: normalizeExtractedText(text),
    title: "",
    parser: "word-extractor",
  };
}

async function extractPdfWithPython(inputPath: string, outdir: string, repoRoot: string, options: { forceOcr?: boolean } = {}) {
  const script = resolve(repoRoot, "services/parser-py/extract_pdf_text.py");
  const args = [script, "--in", inputPath, "--outdir", outdir];
  if (options.forceOcr) args.push("--force-ocr");
  const { stdout } = await pexec(pythonBin(), args, {
    timeout: 300000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const resultPath = stdout.trim().split(/\r?\n/).pop()?.trim();
  if (!resultPath) throw new Error("PDF parser did not return a result path");
  const data = await parseJsonAt(resultPath);
  if (!data.ok) throw new Error(data.error || (data.errors || []).join("; ") || "PDF text extraction failed");
  return {
    text: normalizeExtractedText(data.text || ""),
    title: "",
    parser: data.parser || "pypdf",
  };
}

async function extractPdfWithPdfParse(inputPath: string) {
  const buffer = await readFile(inputPath);
  PDFParse.setWorker(PDF_PARSE_WORKER);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return {
      text: normalizeExtractedText(result.text || ""),
      title: "",
      parser: "pdf-parse",
    };
  } finally {
    await parser.destroy();
  }
}

async function extractPdf(inputPath: string, outdir: string, repoRoot: string) {
  let nativeResult: Awaited<ReturnType<typeof extractPdfWithPython>> | null = null;
  try {
    const result = await extractPdfWithPython(inputPath, outdir, repoRoot);
    nativeResult = result;
    if (!hasLowQualityPdfText(result.text)) return result;
  } catch {
    // Fall through to pdf.js extraction.
  }
  try {
    const fallback = await extractPdfWithPdfParse(inputPath);
    if (!hasLowQualityPdfText(fallback.text)) return fallback;
  } catch {
    // Fall through to OCR extraction.
  }
  try {
    const ocrResult = await extractPdfWithPython(inputPath, outdir, repoRoot, { forceOcr: true });
    if (!hasLowQualityPdfText(ocrResult.text)) return { ...ocrResult, parser: ocrResult.parser || "windows-ocr" };
    const qualityError = getPdfTextQualityError(ocrResult.text);
    if (qualityError) throw new Error(qualityError);
    return ocrResult;
  } catch (error) {
    if (nativeResult?.text && !hasLowQualityPdfText(nativeResult.text)) return nativeResult;
    throw error;
  }
}

async function extractLegacyDocFallback(inputPath: string) {
  const buffer = await readFile(inputPath);
  const utf16 = normalizeExtractedText(buffer.toString("utf16le").replace(/[^\u4e00-\u9fa5A-Za-z0-9，。；：、（）《》“”！？\s.-]/g, " "));
  const utf8 = normalizeExtractedText(buffer.toString("utf8").replace(/[^\u4e00-\u9fa5A-Za-z0-9，。；：、（）《》“”！？\s.-]/g, " "));
  const text = utf16.length >= utf8.length ? utf16 : utf8;
  return text.length >= 20 ? text : "";
}

export async function POST(req: NextRequest) {
  const workdir = join(tmpdir(), `gov-validator-text-${randomUUID()}`);
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "缺少文件" }, { status: 400 });

    const ext = extname(file.name || "").toLowerCase();
    if (![".doc", ".docx", ".pdf"].includes(ext)) {
      return NextResponse.json({ ok: false, error: "当前接口仅支持 PDF/DOC/DOCX 文件" }, { status: 400 });
    }

    await mkdir(workdir, { recursive: true });
    const inputPath = join(workdir, `${randomUUID()}${ext}`);
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

    const repoRoot = findRepoRoot();
    let result;
    try {
      if (ext === ".pdf") result = await extractPdf(inputPath, workdir, repoRoot);
      else result = ext === ".docx" ? await extractDocx(inputPath, workdir, repoRoot) : await extractDocWithWordExtractor(inputPath);
    } catch (error) {
      if (ext !== ".doc") throw error;
      let fallback = "";
      try {
        result = await extractDoc(inputPath, workdir, repoRoot);
      } catch {
        fallback = await extractLegacyDocFallback(inputPath);
      }
      if (result) {
        // Parsed through LibreOffice fallback.
      } else if (!fallback) {
        return NextResponse.json(
          {
            ok: false,
            error: "DOC 二进制解析失败。请安装 LibreOffice 后重试，或先另存为 DOCX 再上传。",
          },
          { status: 422 }
        );
      } else {
        result = { text: fallback, title: "", parser: "legacy-doc-fallback" };
      }
    }

    if (!result.text.trim()) {
      return NextResponse.json({ ok: false, error: "No extractable text was found in this file." }, { status: 422 });
    }
    return NextResponse.json({
      ok: true,
      fileName: basename(file.name || "word.docx"),
      text: result.text,
      title: result.title,
      parser: result.parser,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}
