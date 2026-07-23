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
