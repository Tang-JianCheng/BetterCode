import { createHash } from 'node:crypto';

export const MAX_LOCAL_TOOL_NAME_LENGTH = 64;
const HASH_LENGTH = 8;
const MCP_NAME_PATTERN = /^mcp_[a-z0-9_]+_[0-9a-f]{8}$/u;

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '') || 'x';
}

export function createMcpToolName(serverName: string, remoteToolName: string): string {
  const hash = createHash('sha256')
    .update(serverName)
    .update('\0')
    .update(remoteToolName)
    .digest('hex')
    .slice(0, HASH_LENGTH);
  const suffix = `_${hash}`;
  const prefix = `mcp_${slug(serverName)}_${slug(remoteToolName)}`;
  const available = MAX_LOCAL_TOOL_NAME_LENGTH - suffix.length;
  const truncated = prefix.slice(0, available).replace(/_+$/gu, '') || 'mcp_x';
  return `${truncated}${suffix}`;
}

export function isMcpToolName(name: string): boolean {
  return name.length <= MAX_LOCAL_TOOL_NAME_LENGTH && MCP_NAME_PATTERN.test(name);
}
