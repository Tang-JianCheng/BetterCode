import type { LLMProvider, Message, TokenUsage } from '../provider/types.js';
import type { ToolCall, ToolResult } from '../tool/types.js';

export type AgentMode = 'act' | 'plan';

export type AgentStopReason =
  | 'completed'
  | 'max_iterations'
  | 'cancelled'
  | 'unknown_tool_limit'
  | 'stream_error';

export type AgentProgressStage =
  | 'requesting_model'
  | 'model_complete'
  | 'executing_tools'
  | 'tools_complete';

export type AgentEvent =
  | { type: 'text_delta'; iteration: number; content: string }
  | { type: 'thinking_delta'; iteration: number; content: string }
  | { type: 'tool_call'; iteration: number; call: ToolCall }
  | {
      type: 'tool_result';
      iteration: number;
      call: ToolCall;
      result: ToolResult;
    }
  | {
      type: 'usage';
      iteration: number;
      current: TokenUsage;
      cumulative: TokenUsage;
    }
  | {
      type: 'progress';
      iteration: number;
      maxIterations: number;
      stage: AgentProgressStage;
      toolName?: string;
      toolCallId?: string;
    }
  | { type: 'error'; iteration: number; message: string }
  | {
      type: 'stopped';
      reason: AgentStopReason;
      iterations: number;
      finalText: string;
    };

export interface AgentLoopOptions {
  maxIterations: number;
  unknownToolLimit: number;
}

export interface AgentLoopRequest {
  history: Message[];
  userMessage: string;
  mode: AgentMode;
  provider: LLMProvider;
  signal: AbortSignal;
}

export interface AgentOutcome {
  reason: AgentStopReason;
  iterations: number;
  finalText: string;
  history: Message[];
  usage: TokenUsage;
}

export interface SavedPlan {
  task: string;
  content: string;
}

export interface AgentRunOptions {
  mode?: AgentMode;
  signal?: AbortSignal;
}
