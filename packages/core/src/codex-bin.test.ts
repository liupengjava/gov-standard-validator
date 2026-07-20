import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCodexCommand } from './codex-bin.ts';

test('resolveCodexCommand uses SP_CODEX_BIN override when present', () => {
  const cmd = resolveCodexCommand(['--version'], { SP_CODEX_BIN: 'C:/tools/codex.exe' });
  assert.equal(cmd.command, 'C:/tools/codex.exe');
  assert.deepEqual(cmd.args, ['--version']);
});

test('resolveCodexCommand falls back to PATH codex when no override or local package is available', () => {
  const cmd = resolveCodexCommand(['--version'], {});
  assert.equal(cmd.command, 'codex');
  assert.deepEqual(cmd.args, ['--version']);
});
