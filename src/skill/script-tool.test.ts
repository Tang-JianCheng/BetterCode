import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SkillScriptTool } from './script-tool.js';

const schema = { type: 'object', additionalProperties: true };
const permission = { targetKind: 'arguments' as const, risk: 'read' as const };

function context(root: string, signal = new AbortController().signal) {
  return { rootDir: root, signal, maxOutputBytes: 64 * 1024 };
}

test('专属脚本通过 stdin 和 stdout 交换结构化结果', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-skill-script-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = path.join(root, 'tool.mjs');
  writeFileSync(script, `
let data = '';
for await (const chunk of process.stdin) data += chunk;
const input = JSON.parse(data);
process.stdout.write(JSON.stringify({ok: true, output: input.value, metadata: {cwd: process.cwd()}}));
`);
  const tool = new SkillScriptTool('sample', '示例', schema, 'read_only', permission, script);
  const result = await tool.execute({ value: '成功' }, context(root));
  assert.equal(result.ok, true);
  assert.equal(result.output, '成功');
  assert.equal(result.metadata.cwd, realpathSync(root));
});

test('专属脚本把非法输出、退出失败和取消转换为错误', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-skill-script-errors-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const invalid = path.join(root, 'invalid.mjs');
  const failed = path.join(root, 'failed.mjs');
  const waiting = path.join(root, 'waiting.mjs');
  writeFileSync(invalid, `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('no'));`);
  writeFileSync(failed, `process.stderr.write('失败'); process.exit(3);`);
  writeFileSync(waiting, `setInterval(() => {}, 1000);`);

  const invalidResult = await new SkillScriptTool('invalid', '非法', schema, 'read_only', permission, invalid)
    .execute({}, context(root));
  assert.equal(invalidResult.error?.code, 'EXECUTION_ERROR');
  const failedResult = await new SkillScriptTool('failed', '失败', schema, 'read_only', permission, failed)
    .execute({}, context(root));
  assert.match(failedResult.error?.message ?? '', /退出码 3.*失败/u);

  const controller = new AbortController();
  const pending = new SkillScriptTool('waiting', '等待', schema, 'read_only', permission, waiting)
    .execute({}, context(root, controller.signal));
  setTimeout(() => controller.abort(), 20);
  const cancelled = await pending;
  assert.equal(cancelled.error?.code, 'CANCELLED');
});
