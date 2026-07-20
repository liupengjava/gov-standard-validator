import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ROOT } from './config.ts';
import { callCodexText } from './ai-cli.ts';

export const GPT55_HEALTH_EXPECTED = 'PONG_GPT55_OK';
export const GPT55_HEALTH_PROMPT = `这是一次 GPT-5.5 本地连通性自检。请只输出 ${GPT55_HEALTH_EXPECTED}，不要输出其它任何字符。`;

export function isGpt55HealthReplyOk(text: string): boolean {
  return text.trim() === GPT55_HEALTH_EXPECTED;
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf-8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    if (process.env[key]) continue;
    process.env[key] = unquoteEnvValue(trimmed.slice(index + 1));
  }
}

export function loadGpt55LocalEnv() {
  loadEnvFile(resolve(ROOT, '.env.local'));
  loadEnvFile(resolve(ROOT, 'apps/web/.env.local'));
}

export async function runGpt55HealthCheck(): Promise<{ ok: boolean; text: string; error?: string }> {
  loadGpt55LocalEnv();
  if (!process.env.INDATA_API_KEY) {
    return { ok: false, text: '', error: '缺少 INDATA_API_KEY，请配置 apps/web/.env.local' };
  }
  try {
    const result = await callCodexText(GPT55_HEALTH_PROMPT, { model: 'gpt-5.5', timeoutMs: 120000 });
    const text = result.text.trim();
    return { ok: isGpt55HealthReplyOk(text), text };
  } catch (error) {
    return { ok: false, text: '', error: String(error) };
  }
}

async function main() {
  const result = await runGpt55HealthCheck();
  if (result.ok) {
    console.log('GPT-5.5 health check passed.');
    return;
  }
  console.error('GPT-5.5 health check failed.');
  if (result.error) console.error(result.error);
  else console.error(`Unexpected reply: ${JSON.stringify(result.text)}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
