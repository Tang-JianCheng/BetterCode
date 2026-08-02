import React, { useMemo, useState } from 'react';
import { useInput } from 'ink';
import type { Snapshot } from '../filehistory/filehistory.js';
import type { RewindMode } from '../chat/manager.js';
import type { TerminalCapabilities } from './capabilities.js';
import { detectTerminalCapabilities } from './capabilities.js';
import { InteractionPanel } from './interaction-panel.js';

export interface RewindAction {
  snapshotIndex: number;
  mode: RewindMode;
}

interface Props {
  snapshots: readonly Snapshot[];
  onSelect: (action: RewindAction) => void;
  onCancel: () => void;
  capabilities?: TerminalCapabilities;
}

const ACTIONS: Array<{ mode: RewindMode; label: string }> = [
  { mode: 'code_and_conversation', label: '恢复代码与对话' },
  { mode: 'conversation_only', label: '仅恢复对话' },
  { mode: 'code_only', label: '仅恢复代码' },
];

export function RewindDialog({
  snapshots,
  onSelect,
  onCancel,
  capabilities = detectTerminalCapabilities(),
}: Props) {
  const [phase, setPhase] = useState<'snapshot' | 'action'>('snapshot');
  const [snapshotIndex, setSnapshotIndex] = useState(Math.max(0, snapshots.length - 1));
  const [actionIndex, setActionIndex] = useState(0);
  const visible = useMemo(() => {
    const start = Math.max(0, Math.min(snapshotIndex - 4, snapshots.length - 9));
    return snapshots.slice(start, start + 9).map((snapshot, offset) => ({
      snapshot,
      index: start + offset,
    }));
  }, [snapshotIndex, snapshots]);

  useInput((_input, key) => {
    if (key.escape) {
      if (phase === 'action') setPhase('snapshot');
      else onCancel();
      return;
    }
    if (key.upArrow) {
      if (phase === 'snapshot') setSnapshotIndex(index => Math.max(0, index - 1));
      else setActionIndex(index => Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      if (phase === 'snapshot') {
        setSnapshotIndex(index => Math.min(snapshots.length - 1, index + 1));
      } else {
        setActionIndex(index => Math.min(ACTIONS.length, index + 1));
      }
      return;
    }
    if (!key.return) return;
    if (phase === 'snapshot') {
      setPhase('action');
    } else if (actionIndex === ACTIONS.length) {
      onCancel();
    } else {
      onSelect({ snapshotIndex, mode: ACTIONS[actionIndex].mode });
    }
  });

  return (
    <InteractionPanel
      title={phase === 'snapshot' ? '选择回滚检查点' : '选择恢复范围'}
      tone="warning"
      capabilities={capabilities}
      selectedIndex={phase === 'snapshot'
        ? Math.max(0, visible.findIndex(item => item.index === snapshotIndex))
        : actionIndex}
      details={phase === 'action' ? [
        `检查点: ${new Date(snapshots[snapshotIndex].timestamp).toLocaleString()}`,
        snapshots[snapshotIndex].userText,
      ] : []}
      options={phase === 'snapshot'
        ? visible.map(({ snapshot, index }) => ({
          value: String(index),
          label: `${new Date(snapshot.timestamp).toLocaleString()} · ${snapshot.userText}`,
        }))
        : [...ACTIONS.map(action => ({ value: action.mode, label: action.label })), {
          value: 'cancel', label: '取消',
        }]}
      footer="上下键选择 · Enter 确认 · Esc 返回"
    />
  );
}
