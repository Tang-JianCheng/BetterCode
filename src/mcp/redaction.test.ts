import assert from 'node:assert/strict';
import test from 'node:test';
import { expandMcpTemplate, redactMcpMessage } from './redaction.js';

test('MCP template expands repeated and multiple environment variables', () => {
  const result = expandMcpTemplate(
    'Bearer ${TOKEN}:${USER}:${TOKEN}',
    { TOKEN: 's-token', USER: 'alice' },
  );
  assert.equal(result.value, 'Bearer s-token:alice:s-token');
  assert.deepEqual(result.missing, []);
  assert.equal(result.secretValues.includes('s-token'), true);
  assert.equal(result.secretValues.includes('alice'), true);
  assert.equal(result.secretValues.includes(result.value), true);
});

test('MCP template reports missing variables without retaining placeholders', () => {
  const result = expandMcpTemplate('x-${MISSING}-${PRESENT}', { PRESENT: 'ok' });
  assert.equal(result.value, 'x--ok');
  assert.deepEqual(result.missing, ['MISSING']);
  assert.equal(result.value.includes('${MISSING}'), false);
});

test('MCP redaction handles prefixes, controls and bounded messages', () => {
  const message = `long-secret and long\nsecret\t${'x'.repeat(100)}`;
  const redacted = redactMcpMessage(message, ['secret', 'long-secret'], 60);
  assert.equal(redacted.includes('secret'), false);
  assert.equal(redacted.includes('\n'), false);
  assert.equal(redacted.includes('\t'), false);
  assert.equal(redacted.length, 60);
  assert.match(redacted, /\.\.\.$/u);
});
