import React from 'react';
import { Box, Text } from 'ink';
import type { AgentMode } from '../agent/types.js';
import type { PermissionMode } from '../permission/types.js';
import type { TokenUsage } from '../provider/types.js';
import type { PresentationTone } from '../presentation/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { displayWidth, truncateDisplay } from './capabilities.js';
import { BETTERCODE_THEME, toneColor } from './theme.js';

export interface StatusBarState {
  providerName: string;
  model: string;
  agentMode: AgentMode;
  permissionMode: PermissionMode;
  usage?: TokenUsage;
  contextWindow?: number;
  sessionId: string;
  activeSkills: readonly string[];
  backgroundTasks: number;
  team?: {
    name: string;
    coordinator: boolean;
    pendingApprovals: number;
    unreadMessages: number;
  };
}

export interface StatusPiece {
  id: string;
  text: string;
  tone?: PresentationTone;
  required?: boolean;
}

export type StatusLines = readonly (readonly StatusPiece[])[];

const SEPARATOR = '  ·  ';
const ASCII_SEPARATOR = ' | ';

function modeText(mode: AgentMode): string {
  return mode === 'plan' ? 'PLAN' : 'DEFAULT';
}

function permissionTone(mode: PermissionMode): PresentationTone {
  return mode === 'strict' ? 'danger' : mode === 'allow' ? 'success' : 'warning';
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

function totalLineWidth(pieces: readonly StatusPiece[], separator: string): number {
  return pieces.reduce((total, piece) => total + displayWidth(piece.text), 0)
    + Math.max(0, pieces.length - 1) * displayWidth(separator);
}

function fitOptionalPieces(
  pieces: readonly StatusPiece[],
  columns: number,
  separator: string,
): StatusPiece[] {
  const result = [...pieces];
  while (result.length > 1 && totalLineWidth(result, separator) > columns) {
    let removable = -1;
    for (let index = result.length - 1; index >= 0; index -= 1) {
      if (!result[index].required) {
        removable = index;
        break;
      }
    }
    if (removable < 0) break;
    result.splice(removable, 1);
  }
  if (totalLineWidth(result, separator) <= columns) return result;
  const last = result.at(-1);
  if (!last) return result;
  const others = result.slice(0, -1);
  const available = Math.max(
    1,
    columns - totalLineWidth(others, separator) - (others.length ? displayWidth(separator) : 0),
  );
  result[result.length - 1] = { ...last, text: truncateDisplay(last.text, available) };
  return result;
}

export function buildStatusLines(
  state: StatusBarState,
  capabilities: TerminalCapabilities,
): StatusLines {
  const separator = capabilities.unicode ? SEPARATOR : ASCII_SEPARATOR;
  const modelBudget = capabilities.density === 'full' ? 42 : capabilities.density === 'compact' ? 28 : capabilities.columns;
  const modelLabel = capabilities.density === 'full' ? 'MODEL' : 'M';
  const modelValue = `${state.providerName}/${state.model}`;
  const model: StatusPiece = {
    id: 'model',
    text: truncateDisplay(`${modelLabel} ${modelValue}`, modelBudget, capabilities.unicode ? '…' : '...'),
    tone: 'info',
    required: true,
  };
  const mode: StatusPiece = {
    id: 'mode',
    text: `${capabilities.density === 'full' ? 'MODE' : 'MD'} ${modeText(state.agentMode)}`,
    tone: state.agentMode === 'plan' ? 'info' : 'success',
    required: true,
  };
  const permission: StatusPiece = {
    id: 'permission',
    text: `${capabilities.density === 'full' ? 'PERMISSION' : 'PM'} ${state.permissionMode.toUpperCase()}`,
    tone: permissionTone(state.permissionMode),
    required: true,
  };
  const team = state.team ? {
    id: 'team',
    text: `${state.team.coordinator ? 'LEAD' : 'TEAM'} ${state.team.name}`,
    tone: 'info' as const,
  } : undefined;

  if (capabilities.density === 'narrow') {
    return [
      [{ ...model, text: truncateDisplay(model.text, capabilities.columns, capabilities.unicode ? '…' : '...') }],
      fitOptionalPieces([mode, permission], capabilities.columns, separator),
    ];
  }

  const primary = fitOptionalPieces(
    [model, mode, permission, ...(team ? [team] : [])],
    capabilities.columns,
    separator,
  );
  const usage = state.usage;
  const secondary: StatusPiece[] = [
    {
      id: 'token',
      text: usage
        ? `TOK ${compactNumber(usage.inputTokens)}↑ ${compactNumber(usage.outputTokens)}↓ ${compactNumber(usage.totalTokens)}Σ`
        : 'TOK —',
    },
    ...(usage && usage.cacheReadInputTokens > 0 ? [{
      id: 'cache', text: `CACHE ${compactNumber(usage.cacheReadInputTokens)}`, tone: 'success' as const,
    }] : []),
    ...(usage && state.contextWindow ? [{
      id: 'context', text: `CTX ${compactNumber(usage.totalTokens)}/${compactNumber(state.contextWindow)}`,
    }] : []),
    { id: 'session', text: `SESSION ${state.sessionId.slice(0, 8)}` },
    ...(state.activeSkills.length ? [{
      id: 'skills', text: `SKILL ${state.activeSkills.join(',')}`,
    }] : []),
    ...(state.backgroundTasks > 0 ? [{
      id: 'tasks', text: `BG ${state.backgroundTasks}`, tone: 'info' as const,
    }] : []),
    ...(state.team && (state.team.pendingApprovals > 0 || state.team.unreadMessages > 0) ? [{
      id: 'team-alerts',
      text: `TEAM ${state.team.pendingApprovals}审批 ${state.team.unreadMessages}未读`,
      tone: 'warning' as const,
    }] : []),
  ];
  return [primary, fitOptionalPieces(secondary, capabilities.columns, separator)];
}

export function statusLineText(
  pieces: readonly StatusPiece[],
  capabilities: TerminalCapabilities,
): string {
  return pieces.map(piece => piece.text).join(capabilities.unicode ? SEPARATOR : ASCII_SEPARATOR);
}

export interface StatusBarProps {
  state: StatusBarState;
  capabilities: TerminalCapabilities;
}

export function StatusBar({ state, capabilities }: StatusBarProps) {
  const lines = buildStatusLines(state, capabilities);
  const border = capabilities.unicode ? '─' : '-';
  const separator = capabilities.unicode ? SEPARATOR : ASCII_SEPARATOR;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>
        {border.repeat(capabilities.columns)}
      </Text>
      {lines.map((line, lineIndex) => (
        <Box key={lineIndex}>
          {line.map((piece, pieceIndex) => (
            <React.Fragment key={piece.id}>
              {pieceIndex > 0 ? (
                <Text color={capabilities.color ? BETTERCODE_THEME.border : undefined}>{separator}</Text>
              ) : undefined}
              <Text
                bold={piece.required}
                color={capabilities.color && piece.tone ? toneColor(piece.tone) : undefined}
              >
                {piece.text}
              </Text>
            </React.Fragment>
          ))}
        </Box>
      ))}
    </Box>
  );
}
