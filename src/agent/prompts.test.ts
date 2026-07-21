import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExecutePlanRequest, buildPlanRequest } from './prompts.js';

test('plan prompt preserves the task and states the read-only intent', () => {
  const prompt = buildPlanRequest('inspect src and design a fix');
  assert.match(prompt, /Plan Mode/);
  assert.match(prompt, /只允许读取和搜索/);
  assert.match(prompt, /inspect src and design a fix/);
});

test('execution prompt includes the original task and complete latest plan', () => {
  const prompt = buildExecutePlanRequest({
    task: 'fix the parser',
    content: '1. Read parser.ts\n2. Update the parser',
  });
  assert.match(prompt, /fix the parser/);
  assert.match(prompt, /1\. Read parser\.ts\n2\. Update the parser/);
  assert.match(prompt, /请执行/);
});
