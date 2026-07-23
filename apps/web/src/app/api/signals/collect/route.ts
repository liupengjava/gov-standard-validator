import { NextRequest, NextResponse } from "next/server";
import { collectPublicSignalSamples } from "@/lib/signal-collector";

export const runtime = "nodejs";

type CollectionSitePayload = {
  name?: unknown;
  url?: unknown;
  category?: unknown;
};

function normalizeSites(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((site: CollectionSitePayload) => ({
      name: String(site?.name || "").trim(),
      url: String(site?.url || "").trim(),
      category: String(site?.category || "").trim(),
    }))
    .filter((site) => site.name && /^https?:\/\//i.test(site.url));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const keyword = String(body.keyword || "").trim();
    const region = String(body.region || "").trim() || "未标注区域";
    const scope = String(body.scope || "").trim() || "公开网络";
    const sites = normalizeSites(body.sites);

    if (!keyword) return NextResponse.json({ ok: false, error: "缺少检索主题" }, { status: 400 });
    if (!sites.length) return NextResponse.json({ ok: false, error: "缺少可采集的来源 URL" }, { status: 400 });

    const samples = await collectPublicSignalSamples({ keyword, region, scope, sites });
    return NextResponse.json({
      ok: true,
      samples,
      logs: [
        `真实采集完成：请求 ${sites.length} 个来源 URL`,
        `证据固化完成：生成 ${samples.length} 条样本，包含来源 URL、页面标题、发布时间、采集时间和 HTML 快照。`,
      ],
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
