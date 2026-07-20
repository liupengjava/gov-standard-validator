import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPythonBin } from './config.ts';

test('selectPythonBin prefers SP_PYTHON when provided', () => {
  assert.equal(selectPythonBin({ SP_PYTHON: 'C:/Python/python.exe' }, () => false), 'C:/Python/python.exe');
});

test('selectPythonBin uses bundled runtime Python when available', () => {
  const actual = selectPythonBin({}, (path) => path.endsWith('codex-primary-runtime\\dependencies\\python\\python.exe'));
  assert.match(actual, /codex-primary-runtime\\dependencies\\python\\python\.exe$/);
});

test('selectPythonBin falls back to python on Windows-friendly systems', () => {
  assert.equal(selectPythonBin({}, () => false), 'python');
});
