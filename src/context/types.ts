import type {
  LLMProvider,
  Message,
  ProviderRequest,
} from '../provider/types.js';
import type { ToolDefinition } from '../tool/types.js';

export interface ContextManagerOptions {
  singleToolResultTokens: number;
  toolBatchTokens: number;
  toolPreviewTokens: number;
  recentHistoryTokens: number;
  recentHistoryMessages: number;
  automaticReserveTokens: number;
  manualReserveTokens: number;
  summaryMaxOutputTokens: number;
  summaryFailureLimit: number;
}

export type ContextTrigger = 'automatic' | 'manual';

export type ContextErrorCode =
  | 'CONTEXT_CAPACITY_EXCEEDED'
  | 'CONTEXT_NOTHING_TO_COMPACT'
  | 'CONTEXT_SUMMARY_FAILED'
  | 'CONTEXT_STORAGE_FAILED'
  | 'CONTEXT_CIRCUIT_OPEN'
  | 'CONTEXT_HISTORY_INVALID';

export interface ContextStatus {
  estimatedTokens?: number;
  consecutiveSummaryFailures: number;
  circuitOpen: boolean;
  offloadedResults: number;
}

export interface ContextUsageBreakdownInput {
  systemPrompt: string;
  systemTools: readonly ToolDefinition[];
  mcpTools: readonly ToolDefinition[];
  fullReminder: string;
  baseReminder: string;
  messages: readonly Message[];
}

export interface ContextUsageBreakdown {
  systemPromptTokens: number;
  systemToolsTokens: number;
  mcpToolsTokens: number;
  skillsTokens: number;
  messagesTokens: number;
  systemToolCount: number;
  mcpToolCount: number;
  mcpToolEntries: ReadonlyArray<{ name: string; tokens: number }>;
  usedTokens: number;
}

export interface ContextUsageSnapshot extends ContextUsageBreakdown {
  providerName: string;
  model: string;
  contextWindow: number;
}

export type ContextEvent =
  | {
      type: 'context_progress';
      iteration: number;
      trigger: ContextTrigger;
      stage: 'lightweight' | 'estimating' | 'summarizing' | 'validating';
      estimatedTokens?: number;
      contextWindow: number;
    }
  | {
      type: 'context_offloaded';
      iteration: number;
      trigger: ContextTrigger;
      count: number;
    }
  | {
      type: 'context_compacted';
      iteration: number;
      trigger: ContextTrigger;
      beforeTokens: number;
      afterTokens: number;
      summarizedMessages: number;
      offloadedResults: number;
      consecutiveFailures: number;
      circuitOpen: boolean;
    }
  | {
      type: 'context_failed';
      iteration: number;
      trigger: ContextTrigger;
      code: ContextErrorCode;
      message: string;
      consecutiveFailures: number;
      circuitOpen: boolean;
    };

export interface ContextManageInput {
  history: readonly Message[];
  runtimeMessages: readonly Message[];
  systemPrompt: string;
  tools: readonly ToolDefinition[];
  provider: LLMProvider;
  trigger: ContextTrigger;
  iteration: number;
  signal: AbortSignal;
  emit(event: ContextEvent): void;
}

interface ContextMetrics {
  history: Message[];
  offloadedResults: number;
}

export type ContextManageResult =
  | ContextMetrics & {
      status: 'ready';
      request: ProviderRequest;
      beforeTokens: number;
      afterTokens: number;
      summarizedMessages: number;
    }
  | ContextMetrics & {
      status: 'skipped';
      reason: 'nothing_to_compact';
      estimatedTokens: number;
    }
  | { status: 'cancelled'; history: Message[] }
  | {
      status: 'blocked';
      history: Message[];
      code: ContextErrorCode;
      message: string;
      estimatedTokens: number;
    };

export interface TokenEstimate {
  tokens: number;
  source: 'api_anchor' | 'full_estimate';
  commonMessagePrefix: number;
}

export interface ToolResultWriteInput {
  toolCallId: string;
  toolName: string;
  content: string;
}

export interface StoredToolResult {
  relativePath: string;
  originalBytes: number;
  sha256: string;
}

export interface LightweightResult {
  history: Message[];
  offloadedCount: number;
  failed?: string;
}

export interface HistoryUnit {
  start: number;
  endExclusive: number;
  messages: Message[];
  estimatedTokens: number;
  kind: 'single' | 'tool_batch';
}

export interface CompactionPlan {
  sourceMessages: Message[];
  preservedUserMessages: Message[];
  recentMessages: Message[];
  summarizedMessageCount: number;
}

export interface SummaryResult {
  summary: string;
  sourceMessageCount: number;
}
