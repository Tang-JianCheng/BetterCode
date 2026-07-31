import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JsonlHookLogger } from './logger.js';

test('Hook JSONL 日志保持有界并脱敏环境值', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-hook-log-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logger = new JsonlHookLogger(root, ['top-secret']);
  logger.write({
    timestamp: '2026-07-31T00:00:00.000Z',
    level: 'error',
    source: {
      layer: 'project',
      file: path.join(root, '.bettercode', 'hooks.yaml'),
      index: 0,
      id: 'project:0',
    },
    event: 'pre_tool_use',
    actionType: 'http',
    code: 'HTTP_FAILED',
    message: `top-secret\n${'x'.repeat(5000)}`,
  });
  await logger.close();
  const line = readFileSync(path.join(root, '.bettercode', 'logs', 'hooks.jsonl'), 'utf8');
  assert.doesNotMatch(line, /top-secret/);
  assert.match(line, /\[REDACTED\]/);
  assert.ok(Buffer.byteLength(line, 'utf8') <= 2048);
  assert.doesNotThrow(() => JSON.parse(line));
});
