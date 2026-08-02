import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { TerminalCapabilities } from './capabilities.js';
import { truncateDisplay } from './capabilities.js';
import { MascotMark } from './mascot.js';
import { BETTERCODE_THEME } from './theme.js';

export type ActivityStage =
  | 'preparing'
  | 'requesting_model'
  | 'thinking'
  | 'checking_permissions'
  | 'waiting_permission'
  | 'executing_tool'
  | 'compacting_context'
  | 'backgrounding';

export interface ActivityState {
  stage: ActivityStage;
  label: string;
  iteration?: number;
  maxIterations?: number;
  toolName?: string;
  startedAt: number;
}

const UNICODE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const ASCII_FRAMES = ['|', '/', '-', '\\'] as const;

export function activityFrame(index: number, capabilities: TerminalCapabilities): string {
  if (!capabilities.motion) return capabilities.unicode ? '·' : '.';
  const frames = capabilities.unicode ? UNICODE_FRAMES : ASCII_FRAMES;
  return frames[index % frames.length];
}

export interface ActivityIndicatorProps {
  activity: ActivityState;
  capabilities: TerminalCapabilities;
}

export function ActivityIndicator({ activity, capabilities }: ActivityIndicatorProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  useEffect(() => {
    if (!capabilities.motion) return undefined;
    const timer = setInterval(() => setFrameIndex(index => index + 1), 100);
    return () => clearInterval(timer);
  }, [capabilities.motion]);

  const iteration = activity.iteration === undefined
    ? ''
    : ` ${activity.iteration}${activity.maxIterations ? `/${activity.maxIterations}` : ''}`;
  const suffix = activity.toolName ? ` · ${activity.toolName}` : '';
  const content = truncateDisplay(
    `${activity.label}${iteration}${suffix}`,
    Math.max(12, capabilities.columns - 10),
    capabilities.unicode ? '…' : '...',
  );
  return (
    <Box>
      <MascotMark tone={activity.stage === 'waiting_permission' ? 'warning' : 'info'} capabilities={capabilities} />
      <Text color={capabilities.color ? BETTERCODE_THEME.accent : undefined}>
        {' '}{activityFrame(frameIndex, capabilities)}
      </Text>
      <Text color={capabilities.color ? BETTERCODE_THEME.muted : undefined}> {content}</Text>
    </Box>
  );
}
