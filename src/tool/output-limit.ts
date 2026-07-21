import type { ToolResult } from './types.js';

export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

export function truncateUtf8(
  value: string,
  maxBytes: number,
): { value: string; truncated: boolean } {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
    return { value, truncated: false };
  }

  let result = Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8');
  while (Buffer.byteLength(result, 'utf8') > maxBytes) {
    result = result.slice(0, -1);
  }

  return { value: result, truncated: true };
}

export function limitToolResult(result: ToolResult, maxBytes: number): ToolResult {
  const limited = truncateUtf8(result.output, maxBytes);
  return {
    ...result,
    output: limited.value,
    metadata: {
      ...result.metadata,
      truncated: Boolean(result.metadata.truncated) || limited.truncated,
    },
  };
}

export function serializeToolResult(result: ToolResult): string {
  return JSON.stringify(result);
}
