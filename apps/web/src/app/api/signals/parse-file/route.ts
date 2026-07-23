import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const pexec = promisify(execFile);
const RUNTIME_PYTHON = "C:\\Users\\12266\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe";

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

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export async function POST(req: NextRequest) {
  const workdir = join(tmpdir(), `gov-validator-signal-${randomUUID()}`);
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "缺少文件" }, { status: 400 });

    const ext = extname(file.name || "").toLowerCase();
    if (![".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".log", ".xls", ".xlsx"].includes(ext)) {
      return NextResponse.json({ ok: false, error: "当前样本解析接口支持文本、CSV、JSON、HTML、XLS/XLSX 文件" }, { status: 400 });
    }

    await mkdir(workdir, { recursive: true });
    const inputPath = join(workdir, `${randomUUID()}${ext}`);
    await writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

    if (![".xls", ".xlsx"].includes(ext)) {
      return NextResponse.json({
        ok: true,
        fileName: basename(file.name || "signals.txt"),
        text: normalizeText(await readFile(inputPath, "utf-8")),
        parser: "text",
      });
    }

    const script = resolve(findRepoRoot(), "services/parser-py/parse_sheet.py");
    const { stdout } = await pexec(pythonBin(), [script, "--in", inputPath, "--outdir", workdir], {
      timeout: 300000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const resultPath = stdout.trim().split(/\r?\n/).pop()?.trim();
    if (!resultPath) throw new Error("表格解析服务未返回结果路径");
    const data = JSON.parse(await readFile(resultPath, "utf-8"));
    if (!data.ok) return NextResponse.json({ ok: false, error: data.error || "表格解析失败" }, { status: 422 });
    return NextResponse.json({
      ok: true,
      fileName: basename(file.name || "signals.xlsx"),
      text: normalizeText(data.text || ""),
      sheets: data.sheets || 0,
      parser: data.parser || "sheet",
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}
