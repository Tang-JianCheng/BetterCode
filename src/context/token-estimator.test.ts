import assert from 'node:assert/strict';
import test from 'node:test';
import type { Message, ProviderRequest } from '../provider/types.js';
import { TokenEstimator } from './token-estimator.js';

function request(messages: Message[], systemPrompt = '稳定提示'): ProviderRequest {
  return {
    systemPrompt,
    messages,
    tools: [{ name: 'read_file', description: '读取文件', inputSchema: { type: 'object' } }],
  };
}

test('字符估算对中文和混合代码保持保守且稳定', () => {
  const estimator = new TokenEstimator();
  assert.equal(estimator.estimateText('abcd'), 2);
  assert.ok(estimator.estimateText('中文中文') > estimator.estimateText('abcd'));
  assert.equal(estimator.estimateText('const 名称 = "值";'), estimator.estimateText('const 名称 = "值";'));
});

test('完整估算忽略消息内部元数据', () => {
  const estimator = new TokenEstimator();
  const plain: Message = {
    role: 'tool',
    toolCallId: 'call-1',
    toolName: 'read_file',
    content: '结果',
    isError: false,
  };
  const internal: Message = {
    ...plain,
    contextReference: {
      kind: 'offloaded_tool_result',
      relativePath: '.bettercode/context/result.json',
      originalBytes: 100,
      estimatedTokens: 50,
      sha256: 'a'.repeat(64),
    },
  };

  assert.equal(estimator.estimateMessage(plain), estimator.estimateMessage(internal));
});

test('usage 锚点按消息后缀增量估算', () => {
  const estimator = new TokenEstimator();
  const first = request([{ role: 'user', content: '第一轮' }]);
  estimator.recordUsage(first, 1_000);

  const appended = request([
    { role: 'user', content: '第一轮' },
    { role: 'assistant', content: '回答' },
  ]);
  const estimate = estimator.estimateRequest(appended);
  assert.equal(estimate.source, 'api_anchor');
  assert.equal(estimate.commonMessagePrefix, 1);
  assert.ok(estimate.tokens > 1_000);
});

test('稳定字段变化、无效 usage 和重置回退完整估算', () => {
  const estimator = new TokenEstimator();
  const original = request([{ role: 'user', content: '消息' }]);
  estimator.recordUsage(original, 0);
  assert.equal(estimator.estimateRequest(original).source, 'full_estimate');

  estimator.recordUsage(original, 500);
  assert.equal(estimator.estimateRequest(request(original.messages, '另一提示')).source, 'full_estimate');
  estimator.reset();
  assert.equal(estimator.estimateRequest(original).source, 'full_estimate');
});
