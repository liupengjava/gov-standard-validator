import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

function safeFileName(value: string): string {
  return (value || "标准验证意见报告").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

export async function POST(req: NextRequest) {
  const workdir = join(tmpdir(), `gov-validator-report-${randomUUID()}`);
  try {
    const body = await req.json();
    const reportText = String(body.reportText || "").trim();
    const title = safeFileName(String(body.title || "标准验证意见报告"));
    if (!reportText) return NextResponse.json({ ok: false, error: "缺少报告正文" }, { status: 400 });

    await mkdir(workdir, { recursive: true });
    const payloadPath = join(workdir, "report.json");
    const outputPath = join(workdir, `${title}.docx`);
    await writeFile(payloadPath, JSON.stringify({ reportText }, null, 2), "utf-8");

    const script = resolve(findRepoRoot(), "services/parser-py/build_report_docx.py");
    await pexec(pythonBin(), [script, "--in", payloadPath, "--out", outputPath], {
      timeout: 300000,
      maxBuffer: 16 * 1024 * 1024,
    });

    const buffer = await readFile(outputPath);
    return new NextResponse(buffer, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${title}.docx`)}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  } finally {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }
}
