import type { ToolErrorCode, ToolResultMetadata } from './types.js';

export class ToolFailure extends Error {
  readonly code: ToolErrorCode;
  readonly metadata: ToolResultMetadata;
  readonly output: string;

  constructor(
    code: ToolErrorCode,
    message: string,
    options: {
      metadata?: ToolResultMetadata;
      output?: string;
    } = {},
  ) {
    super(message);
    this.name = 'ToolFailure';
    this.code = code;
    this.metadata = options.metadata ?? {};
    this.output = options.output ?? '';
  }
}

export function isToolFailure(error: unknown): error is ToolFailure {
  return error instanceof ToolFailure;
}
