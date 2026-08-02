import React, { useRef, useState } from 'react';
import { useInput } from 'ink';
import type { PermissionChoice, PermissionRequest } from '../permission/types.js';
import type { TerminalCapabilities } from './capabilities.js';
import { detectTerminalCapabilities } from './capabilities.js';
import { InteractionPanel, moveInteractionIndex } from './interaction-panel.js';

const RISK_LABELS = {
  read: '读取',
  write: '写入',
  execute: '执行命令',
} as const;

interface Props {
  request: PermissionRequest;
  onSelect: (choice: PermissionChoice) => void;
  disabled?: boolean;
  capabilities?: TerminalCapabilities;
}

const OPTIONS: Array<{
  value: PermissionChoice;
  label: string;
  shortcut: string;
  description: string;
}> = [
  { value: 'deny', label: '拒绝', shortcut: 'd', description: '让 Agent 调整方案' },
  { value: 'allow_once', label: '仅本次允许', shortcut: 'o', description: '只放行当前调用' },
  { value: 'allow_session', label: '本会话允许', shortcut: 's', description: '本会话复用规则' },
  { value: 'allow_permanent', label: '永久允许', shortcut: 'p', description: '写入本地规则' },
];

export function PermissionPrompt({
  request,
  onSelect,
  disabled = false,
  capabilities = detectTerminalCapabilities(),
}: Props) {
  const submitted = useRef(false);
  const [selectedIndex, setSelectedIndex] = useState(1);

  const submit = (choice: PermissionChoice) => {
    if (disabled || submitted.current) return;
    submitted.current = true;
    onSelect(choice);
  };

  useInput((input, key) => {
    if (disabled || submitted.current) return;
    if (key.upArrow || key.downArrow) {
      setSelectedIndex(index => moveInteractionIndex(
        index,
        OPTIONS.length,
        key.upArrow ? 'up' : 'down',
      ));
      return;
    }
    if (key.return) {
      submit(OPTIONS[selectedIndex].value);
      return;
    }
    if (key.escape) {
      submit('deny');
      return;
    }
    const choices: Partial<Record<string, PermissionChoice>> = {
      d: 'deny',
      o: 'allow_once',
      s: 'allow_session',
      p: 'allow_permanent',
    };
    const choice = choices[input.toLowerCase()];
    if (!choice) return;
    submit(choice);
  }, { isActive: !disabled });

  return (
    <InteractionPanel
      title="权限确认"
      tone="warning"
      capabilities={capabilities}
      selectedIndex={selectedIndex}
      details={[
        `工具: ${request.toolName}（${RISK_LABELS[request.risk]}）`,
        `目标: ${request.target}`,
        `授权规则: ${request.proposedRule}`,
        ...(request.risk === 'execute'
          ? ['命令获准后将继承 BetterCode 进程的系统权限。']
          : []),
      ]}
      options={OPTIONS}
      footer="上下键选择 · Enter 确认 · Esc 拒绝 · 也可按 d/o/s/p"
    />
  );
}
