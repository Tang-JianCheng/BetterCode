import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChatManager } from '../chat/manager.js';
import { createPermissionManager } from '../permission/factory.js';
import type { LLMProvider, ProviderRequest } from '../provider/types.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import { createToolSuccess } from '../tool/types.js';
import { TeamToolPolicy } from './tool-policy.js';
import { TeamLeadInbox } from './lead-inbox.js';
import { createTeamTools } from './tools.js';
import type { LeadActor, TeamMessage } from './types.js';
import type { TeamCoordinator } from './coordinator.js';

test('ChatManager 组合团队工具、Lead 提示与通知指令', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-team-chat-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = createCoreToolRegistry(root);
  for (const tool of createTeamTools({ execute: async () => createToolSuccess('ok') })) registry.register(tool);
  const actor: LeadActor = { kind: 'lead', team: 'alpha', sessionId: 'session', generation: 1 };
  let active = true;
  const coordinator = {
    active: () => active ? { team: { name: 'alpha', generation: 1 } } : undefined,
    status: () => active ? {
      active: true, team: { name: 'alpha', generation: 1 }, members: [], tasks: [],
      coordinator: { active: false }, pendingApprovals: 0, unreadMessages: 1,
    } : { active: false, coordinator: { active: false } },
    promptContent: () => ({ activeSkills: [{ name: 'BetterCode Team Lead', content: '团队 alpha' }] }),
    leadActor: () => active ? actor : undefined,
    toolPolicy: () => new TeamToolPolicy({ actor: () => active ? actor : undefined }),
    subscribe: () => () => {},
  } as unknown as TeamCoordinator;
  const message = {
    id: 'm1', type: 'member_idle', sender: 'alice', recipient: 'lead', body: '任务完成', summary: '完成',
    timestamp: new Date().toISOString(), read: false, taskId: 'task-1',
  } as TeamMessage;
  let unread = [message];
  const inbox = new TeamLeadInbox({ unread: () => unread, markRead: async () => { unread = []; } });
  const requests: ProviderRequest[] = [];
  const provider: LLMProvider = {
    name: 'fake', model: 'fake', contextWindow: 128_000, contextWindowIsDefault: false,
    chat: async (request, emit) => {
      requests.push(structuredClone(request));
      emit({ type: 'text_delta', content: '收到' });
      emit({ type: 'done', content: '' });
    },
  };
  const chat = new ChatManager(
    registry,
    createPermissionManager(registry, 'allow'),
    {}, {}, {}, { autoExtract: false, sessionPersistence: false }, {}, undefined, {},
    { coordinator, inbox },
  );
  t.after(() => chat.close());
  for await (const _event of chat.run('检查团队状态', provider)) {}
  assert.ok(requests[0]?.tools.some(tool => tool.name === 'team_task'));
  assert.ok(requests[0]?.messages.some(item => item.role === 'instruction' && item.instructionKind === 'team_notification'));
  assert.match(requests[0]?.messages.find(item => item.role === 'instruction' && /Team Lead/.test(item.content))?.content ?? '', /alpha/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(unread.length, 0);

  active = false;
  for await (const _event of chat.run('普通任务', provider)) {}
  assert.equal(requests[1]?.tools.some(tool => tool.name.startsWith('team_')), false);
});

test('ChatManager 本地团队命令直接调用协调器', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'bettercode-team-command-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = createCoreToolRegistry(root);
  const calls: string[] = [];
  const coordinator = {
    listTeams: () => [],
    status: () => ({ active: false }),
    createTeam: (name: string) => { calls.push(`create:${name}`); return { team: { name } }; },
    useTeam: (name: string) => { calls.push(`use:${name}`); return { team: { name } }; },
    archiveTeam: async (name: string) => { calls.push(`archive:${name}`); return { team: { name, state: 'archived' } }; },
    restoreTeam: (name: string) => { calls.push(`restore:${name}`); return { team: { name, state: 'active' } }; },
    active: () => undefined,
    promptContent: () => ({}),
    toolPolicy: () => new TeamToolPolicy({ actor: () => undefined }),
    subscribe: () => () => {},
  } as unknown as TeamCoordinator;
  const chat = new ChatManager(
    registry, createPermissionManager(registry, 'allow'), {}, {}, {},
    { autoExtract: false, sessionPersistence: false }, {}, undefined, {}, { coordinator },
  );
  t.after(() => chat.close());
  await chat.manageTeam('create alpha');
  await chat.manageTeam('use alpha');
  await chat.manageTeam('archive alpha');
  await chat.manageTeam('restore alpha');
  assert.deepEqual(calls, ['create:alpha', 'use:alpha', 'archive:alpha', 'restore:alpha']);
  await assert.rejects(() => chat.manageTeam('create'), /用法/);
});
