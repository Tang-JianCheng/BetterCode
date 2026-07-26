import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExecutePlanRequest } from './prompts.js';

test('execution prompt includes the original task and complete latest plan', () => {
  const prompt = buildExecutePlanRequest({
    task: 'fix the parser',
    content: '1. Read parser.ts\n2. Update the parser',
  });
  assert.match(prompt, /fix the parser/);
  assert.match(prompt, /1\. Read parser\.ts\n2\. Update the parser/);
  assert.match(prompt, /请执行/);
});
