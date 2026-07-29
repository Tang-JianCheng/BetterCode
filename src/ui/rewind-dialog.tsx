import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Snapshot } from '../filehistory/filehistory.js';
import type { RewindMode } from '../chat/manager.js';

export interface RewindAction {
  snapshotIndex: number;
  mode: RewindMode;
}

interface Props {
  snapshots: readonly Snapshot[];
  onSelect: (action: RewindAction) => void;
  onCancel: () => void;
}

const ACTIONS: Array<{ mode: RewindMode; label: string }> = [
  { mode: 'code_and_conversation', label: '恢复代码与对话' },
  { mode: 'conversation_only', label: '仅恢复对话' },
  { mode: 'code_only', label: '仅恢复代码' },
];

export function RewindDialog({ snapshots, onSelect, onCancel }: Props) {
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
    <Box flexDirection="column">
      <Text bold>{phase === 'snapshot' ? '选择回滚检查点' : '选择恢复范围'}</Text>
      {phase === 'snapshot' ? visible.map(({ snapshot, index }) => (
        <Text key={`${snapshot.timestamp}-${index}`} color={index === snapshotIndex ? 'cyan' : undefined}>
          {index === snapshotIndex ? '> ' : '  '}
          {new Date(snapshot.timestamp).toLocaleString()} - {snapshot.userText}
        </Text>
      )) : (
        <>
          {[...ACTIONS.map(action => action.label), '取消'].map((label, index) => (
            <Text key={label} color={index === actionIndex ? 'cyan' : undefined}>
              {index === actionIndex ? '> ' : '  '}{label}
            </Text>
          ))}
        </>
      )}
      <Text color="grey">上下键选择，Enter 确认，Esc 返回</Text>
    </Box>
  );
}
