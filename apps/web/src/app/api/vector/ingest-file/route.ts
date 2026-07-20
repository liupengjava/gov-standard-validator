import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseAndStore } from "@gov-validator/core/parsing";
import { embedMissingChunks } from "@gov-validator/core/vector-index";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "缺少文件" }, { status: 400 });

    const suffix = (() => {
      const name = file.name || "";
      const index = name.lastIndexOf(".");
      return index >= 0 ? name.slice(index).toLowerCase() : ".tmp";
    })();
    const tempPath = join(tmpdir(), `gov-validator-${randomUUID()}${suffix}`);
    const arr = await file.arrayBuffer();
    await fs.writeFile(tempPath, Buffer.from(arr));

    const progressEvents: { stage: string; label: string; progress: number; pageNo?: number; totalPages?: number }[] = [];
    const parsed = await parseAndStore(tempPath, {
      title: String(form.get("title") || file.name || "未命名标准文件"),
      group: "标准验证",
      category: "政务服务",
      onIngestEvent(event) {
        progressEvents.push({
          stage: event.stage,
          label: event.label,
          progress: Math.round(Number(event.progress || 0)),
          pageNo: event.pageNo,
          totalPages: event.totalPages,
        });
      },
    });

    const embed = await embedMissingChunks();

    await fs.unlink(tempPath).catch(() => {});
    return NextResponse.json({
      ok: true,
      parsed,
      embed,
      progressEvents,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

