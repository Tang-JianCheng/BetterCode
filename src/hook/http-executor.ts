import { stableStringifyJson } from '../tool/stable-json.js';
import type { CompiledHookRule, HookActionResult, HookEventContext } from './types.js';

const MAX_RESPONSE_BYTES = 64 * 1024;

async function readBounded(response: Response): Promise<{ output: string; truncated: boolean }> {
  if (!response.body) return { output: '', truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = MAX_RESPONSE_BYTES - total;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      if (value.byteLength > remaining) truncated = true;
      chunks.push(chunk);
      total += chunk.byteLength;
      if (total >= MAX_RESPONSE_BYTES) {
        truncated = true;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { output: new TextDecoder().decode(combined), truncated };
}

export async function executeHookHttp(input: {
  rule: CompiledHookRule & { action: Extract<CompiledHookRule['action'], { type: 'http' }> };
  context: HookEventContext;
  signal: AbortSignal;
}): Promise<HookActionResult> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), input.rule.timeoutMs);
  const signal = AbortSignal.any([input.signal, timeout.signal]);
  try {
    const url = input.rule.action.url.render(input.context);
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Hook HTTP 地址只支持 HTTP 或 HTTPS');
    }
    const headers = Object.fromEntries(Object.entries(input.rule.action.headers)
      .map(([name, template]) => [name, template.render(input.context)]));
    const permitsBody = input.rule.action.method !== 'GET' && input.rule.action.method !== 'HEAD';
    const bodyValue = input.rule.action.body?.render(input.context) ?? input.context;
    if (permitsBody && !Object.keys(headers).some(name => name.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(parsed, {
      method: input.rule.action.method,
      headers,
      ...(permitsBody ? { body: stableStringifyJson(bodyValue) } : {}),
      signal,
    });
    const output = await readBounded(response);
    if (!response.ok) {
      return { status: 'failed', code: 'HTTP_FAILED', message: `Hook HTTP 状态码为 ${response.status}` };
    }
    return { status: 'success', output: output.output, truncated: output.truncated };
  } catch (error) {
    if (input.signal.aborted) {
      return { status: 'failed', code: 'HTTP_CANCELLED', message: 'Hook HTTP 请求已取消' };
    }
    if (timeout.signal.aborted) {
      return { status: 'failed', code: 'HTTP_TIMEOUT', message: `Hook HTTP 请求超过 ${input.rule.timeoutMs}ms` };
    }
    return {
      status: 'failed',
      code: 'HTTP_FAILED',
      message: `Hook HTTP 请求失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
