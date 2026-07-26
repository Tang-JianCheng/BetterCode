import React, { useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PermissionChoice, PermissionRequest } from '../permission/types.js';

const RISK_LABELS = {
  read: '读取',
  write: '写入',
  execute: '执行命令',
} as const;

interface Props {
  request: PermissionRequest;
  onSelect: (choice: PermissionChoice) => void;
  disabled?: boolean;
}

export function PermissionPrompt({ request, onSelect, disabled = false }: Props) {
  const submitted = useRef(false);

  useInput(input => {
    if (disabled || submitted.current) return;
    const choices: Partial<Record<string, PermissionChoice>> = {
      d: 'deny',
      o: 'allow_once',
      s: 'allow_session',
      p: 'allow_permanent',
    };
    const choice = choices[input.toLowerCase()];
    if (!choice) return;
    submitted.current = true;
    onSelect(choice);
  }, { isActive: !disabled });

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>权限确认</Text>
      <Text>工具: {request.toolName} ({RISK_LABELS[request.risk]})</Text>
      <Text>目标: {request.target}</Text>
      <Text color="grey">授权规则: {request.proposedRule}</Text>
      {request.risk === 'execute' ? (
        <Text color="yellow">命令获准后将继承 BetterCode 进程的系统权限。</Text>
      ) : undefined}
      <Text>[d] 拒绝  [o] 仅本次  [s] 本会话  [p] 永久允许</Text>
    </Box>
  );
}
