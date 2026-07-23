import { Buffer } from "node:buffer";

export type PublicSignalEvidenceStage = "fetch" | "metadata" | "content" | "snapshot";

export type PublicSignalEvidenceItem = {
  stage: PublicSignalEvidenceStage;
  label: string;
  detail: string;
  at: string;
};

export type PublicSignalCollectionSite = {
  name: string;
  url: string;
  category?: string;
};

export type PublicSignalCollectionInput = {
  keyword: string;
  region: string;
  scope: string;
  sites: PublicSignalCollectionSite[];
};

export type PublicSignalCollectedSample = {
  source: string;
  region: string;
  type: string;
  text: string;
  status: string;
  sourceUrl: string;
  pageTitle: string;
  publishedAt: string;
  capturedAt: string;
  snapshotUrl: string;
  evidenceStatus: "real_collected";
  evidenceChain: PublicSignalEvidenceItem[];
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

function nowText(): string {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function parseTagAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*["']([^"']*)["']/g)) {
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[2].trim());
  }
  return attrs;
}

export function extractPageTitle(html: string, fallback: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return (title ? decodeHtmlEntities(title).replace(/\s+/g, " ").trim() : "") || fallback;
}

export function extractPublishedAt(html: string): string {
  const metaNames = new Set(["pubdate", "publishdate", "date", "datepublished", "article:published_time", "og:published_time"]);
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseTagAttrs(match[0]);
    const name = (attrs.name || attrs.property || attrs.itemprop || "").toLowerCase();
    if (metaNames.has(name) && attrs.content) return attrs.content;
  }
  const timeTag = html.match(/<time\b[^>]*>/i)?.[0];
  if (timeTag) {
    const attrs = parseTagAttrs(timeTag);
    if (attrs.datetime) return attrs.datetime;
  }
  const labelMatch = decodeHtmlEntities(html).match(/(?:发布时间|发布日期|发表时间|更新时间)\s*[:：]?\s*([0-9]{4}[-/.年][0-9]{1,2}[-/.月][0-9]{1,2}(?:日)?(?:\s+[0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)?)/);
  return labelMatch?.[1]?.trim() || "";
}

function htmlToLines(html: string): string[] {
  const text = decodeHtmlEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, "\n")
      .replace(/<style\b[\s\S]*?<\/style>/gi, "\n")
      .replace(/<!--[\s\S]*?-->/g, "\n")
      .replace(/<\/(p|li|div|section|article|tr|h[1-6])>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
  return text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 12);
}

function keywordTokens(keyword: string): string[] {
  return keyword
    .toLowerCase()
    .split(/[\s,，;；|/]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function selectEvidenceText(lines: string[], keyword: string): string {
  const tokens = keywordTokens(keyword);
  const scored = lines
    .map((line, index) => ({
      line,
      index,
      score: tokens.reduce((sum, token) => sum + (line.toLowerCase().includes(token) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = (scored[0]?.score ? scored.filter((item) => item.score > 0).slice(0, 2) : scored.slice(0, 2)).map((item) => item.line);
  return selected.join("\n").slice(0, 620);
}

function buildSnapshotUrl(html: string, sourceUrl: string): string {
  const snapshot = `<!doctype html><html><head><meta charset="utf-8"><base href="${sourceUrl}"></head><body>${html}</body></html>`;
  return `data:text/html;charset=utf-8;base64,${Buffer.from(snapshot, "utf-8").toString("base64")}`;
}

export async function collectPublicSignalSamples(
  input: PublicSignalCollectionInput,
  fetcher: Fetcher = fetch
): Promise<PublicSignalCollectedSample[]> {
  const sites = input.sites.filter((site) => /^https?:\/\//i.test(site.url)).slice(0, 5);
  const results: PublicSignalCollectedSample[] = [];

  for (const site of sites) {
    const capturedAt = nowText();
    const response = await fetcher(site.url, {
      headers: {
        "user-agent": "GovStandardValidator/0.1 public-signal-collector",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`${site.name} 采集失败：HTTP ${response.status}`);

    const html = await response.text();
    const finalUrl = response.headers.get("x-final-url") || response.url || site.url;
    const pageTitle = extractPageTitle(html, site.name);
    const publishedAt = extractPublishedAt(html);
    const lines = htmlToLines(html);
    const text = selectEvidenceText(lines, input.keyword);
    if (!text) continue;

    results.push({
      source: site.name,
      region: input.region,
      type: `公开网络-${input.scope}`,
      text,
      status: "待复核",
      sourceUrl: finalUrl,
      pageTitle,
      publishedAt,
      capturedAt,
      snapshotUrl: buildSnapshotUrl(html, finalUrl),
      evidenceStatus: "real_collected",
      evidenceChain: [
        { stage: "fetch", label: "来源 URL 请求", detail: `${site.name} ${finalUrl}`, at: capturedAt },
        { stage: "metadata", label: "页面元数据解析", detail: `${pageTitle}${publishedAt ? ` / ${publishedAt}` : ""}`, at: capturedAt },
        { stage: "content", label: "正文证据抽取", detail: `按主题“${input.keyword}”抽取 ${text.length} 字`, at: capturedAt },
        { stage: "snapshot", label: "页面快照固化", detail: "已生成 HTML 快照，可用于复核来源页面当时内容。", at: capturedAt },
      ],
    });
  }

  return results;
}
