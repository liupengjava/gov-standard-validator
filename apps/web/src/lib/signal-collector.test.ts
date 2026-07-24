import { test } from "node:test";
import assert from "node:assert/strict";
import { collectPublicSignalSamples } from "./signal-collector.ts";

test("collectPublicSignalSamples attaches source metadata, snapshot, and evidence chain", async () => {
  const html = `<!doctype html>
    <html>
      <head>
        <title>Public Service Feedback</title>
        <meta name="pubdate" content="2026-07-20 09:30" />
      </head>
      <body>
        <article>
          <time datetime="2026-07-20T09:30:00+08:00">2026-07-20</time>
          <p>The one-stop service still asks applicants to submit paper materials again.</p>
          <p>This public feedback should be captured as evidence for standard validation.</p>
        </article>
      </body>
    </html>`;

  const fetcher = async (url: string) =>
    new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-final-url": url,
      },
    });

  const samples = await collectPublicSignalSamples(
    {
      keyword: "one-stop service paper materials",
      region: "Hangzhou",
      scope: "public web",
      sites: [{ name: "Gov Feedback", url: "https://example.gov/feedback" }],
    },
    fetcher
  );

  assert.equal(samples.length, 1);
  assert.equal(samples[0].sourceUrl, "https://example.gov/feedback");
  assert.equal(samples[0].pageTitle, "Public Service Feedback");
  assert.equal(samples[0].publishedAt, "2026-07-20 09:30");
  assert.equal(samples[0].region, "Hangzhou");
  assert.equal(samples[0].evidenceStatus, "real_collected");
  assert.ok(samples[0].text.includes("paper materials"));
  assert.ok(samples[0].snapshotUrl.startsWith("data:text/html;charset=utf-8;base64,"));
  assert.deepEqual(
    samples[0].evidenceChain.map((item) => item.stage),
    ["fetch", "metadata", "content", "snapshot"]
  );
});

test("collectPublicSignalSamples follows matching search result links to detail pages", async () => {
  const searchHtml = `<!doctype html>
    <html>
      <head><title>Search Results</title></head>
      <body>
        <ul>
          <li><a href="/messages/detail-1">地铁办事群众留言记录</a></li>
        </ul>
      </body>
    </html>`;
  const detailHtml = `<!doctype html>
    <html>
      <head>
        <title>地铁办事群众留言记录</title>
        <meta name="pubdate" content="2026-07-21 15:20" />
      </head>
      <body>
        <article>
          <p>群众反映地铁相关政务服务事项办理时，需要重复提交材料，影响办事体验。</p>
          <p>建议窗口和线上系统共享材料状态，减少重复填报。</p>
        </article>
      </body>
    </html>`;

  const fetcher = async (url: string) =>
    new Response(url.endsWith("/messages/detail-1") ? detailHtml : searchHtml, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-final-url": url,
      },
    });

  const samples = await collectPublicSignalSamples(
    {
      keyword: "地铁 重复提交材料",
      region: "杭州市",
      scope: "全网公开信息",
      sites: [{ name: "人民网领导留言板-杭州", url: "https://luyan.people.com.cn/messageSearch?keywords=%E5%9C%B0%E9%93%81" }],
    },
    fetcher
  );

  assert.equal(samples.length, 1);
  assert.equal(samples[0].sourceUrl, "https://luyan.people.com.cn/messages/detail-1");
  assert.equal(samples[0].pageTitle, "地铁办事群众留言记录");
  assert.equal(samples[0].publishedAt, "2026-07-21 15:20");
  assert.ok(samples[0].text.includes("重复提交材料"));
  assert.deepEqual(
    samples[0].evidenceChain.map((item) => item.stage),
    ["fetch", "metadata", "content", "snapshot"]
  );
});
