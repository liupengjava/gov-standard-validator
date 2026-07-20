import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GPT55_HEALTH_EXPECTED, GPT55_HEALTH_PROMPT, isGpt55HealthReplyOk } from './gpt55-health.ts';

test('GPT-5.5 health check prompt asks for a deterministic token', () => {
  assert.match(GPT55_HEALTH_PROMPT, new RegExp(GPT55_HEALTH_EXPECTED));
});

test('isGpt55HealthReplyOk accepts only the expected token, ignoring whitespace', () => {
  assert.equal(isGpt55HealthReplyOk(`\n${GPT55_HEALTH_EXPECTED}\n`), true);
  assert.equal(isGpt55HealthReplyOk(`回答：${GPT55_HEALTH_EXPECTED}`), false);
  assert.equal(isGpt55HealthReplyOk('pong'), false);
});
