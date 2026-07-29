import type { CommandParseResult } from './types.js';

export function parseCommandInput(input: string): CommandParseResult {
  const value = input.trim();
  if (!value) return { status: 'empty' };
  if (!value.startsWith('/')) return { status: 'not_command' };
  const separator = value.search(/\s/u);
  const token = separator < 0 ? value.slice(1) : value.slice(1, separator);
  const args = separator < 0 ? '' : value.slice(separator + 1).trim();
  return {
    status: 'command',
    command: {
      raw: value,
      name: token.toLowerCase(),
      args,
    },
  };
}
