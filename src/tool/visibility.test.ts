import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveVisibleTools } from './visibility.js';

const all = [
  'read_file', 'write_file', 'run_command', 'agent', 'load_skill',
  'team_status', 'team_member', 'team_task', 'team_message', 'team_approval', 'team_integrate',
];
const sideEffects = new Set(['write_file', 'run_command', 'team_member', 'team_task', 'team_message', 'team_approval', 'team_integrate']);
const effectOf = (name: string) => sideEffects.has(name) ? 'side_effect' as const : 'read_only' as const;

test('未激活团队与普通成员使用不同工具作用域', () => {
  const ordinary = resolveVisibleTools({ allNames: all, effectOf, mode: 'act' });
  assert.equal([...ordinary].some(name => name.startsWith('team_')), false);
  const member = resolveVisibleTools({
    allNames: all, effectOf, mode: 'act', team: { active: true, actor: 'member' },
  });
  assert.equal(member.has('team_status'), true);
  assert.equal(member.has('team_task'), true);
  assert.equal(member.has('team_member'), false);
  assert.equal(member.has('team_integrate'), false);
});

test('Coordinator 移除普通副作用但保留受限 Shell 与团队编排', () => {
  const names = resolveVisibleTools({
    allNames: all,
    effectOf,
    mode: 'act',
    team: { active: true, actor: 'lead', coordinator: true },
  });
  assert.equal(names.has('read_file'), true);
  assert.equal(names.has('write_file'), false);
  assert.equal(names.has('agent'), false);
  assert.equal(names.has('run_command'), true);
  assert.equal(names.has('team_member'), true);
  assert.equal(names.has('team_integrate'), true);
});

test('Plan Mode 与 Skill 白名单不会重新放开已拒绝工具', () => {
  const names = resolveVisibleTools({
    allNames: all,
    effectOf,
    skillNames: new Set(['read_file', 'write_file', 'team_status']),
    mode: 'plan',
    team: { active: true, actor: 'lead' },
  });
  assert.equal(names.has('read_file'), true);
  assert.equal(names.has('write_file'), false);
  assert.equal(names.has('team_status'), true);
  assert.equal(names.has('team_member'), true);
});
