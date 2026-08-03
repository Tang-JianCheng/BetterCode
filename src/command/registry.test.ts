import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandRegistry } from './registry.js';
import type { CommandDefinition } from './types.js';

function command(name: string, aliases: string[] = [], hidden = false): CommandDefinition {
  return {
    name,
    aliases,
    hidden,
    description: `${name} 描述`,
    usage: `/${name}`,
    type: 'local',
    handler() {},
  };
}

test('注册中心在启动阶段拒绝名称和别名冲突', () => {
  const registry = new CommandRegistry();
  registry.register(command('help', ['h']));
  assert.throws(() => registry.register(command('help')), /冲突.*help/u);
  assert.throws(() => registry.register(command('history', ['h'])), /冲突.*h/u);
  assert.throws(() => new CommandRegistry().register(command('test', ['test'])), /重复/u);
});

test('注册中心大小写不敏感并保持可见命令顺序', () => {
  const registry = new CommandRegistry();
  registry.register(command('Help', ['H']));
  registry.register(command('secret', [], true));
  assert.equal(registry.get('HELP')?.name, 'help');
  assert.equal(registry.get('h')?.name, 'help');
  assert.deepEqual(registry.list().map(item => item.name), ['help']);
  assert.deepEqual(registry.list({ includeHidden: true }).map(item => item.name), ['help', 'secret']);
});

test('补全支持别名前缀、稳定多候选并排除隐藏命令', () => {
  const registry = new CommandRegistry();
  registry.register(command('session', ['resume', 'r']));
  registry.register(command('review', ['rv']));
  registry.register(command('rewind', [], true));
  assert.deepEqual(registry.complete('/ses').map(item => item.name), ['session']);
  assert.deepEqual(registry.complete('/r').map(item => item.name), ['session', 'review']);
  assert.deepEqual(registry.complete('/ses')[0]?.aliases, ['resume', 'r']);
  assert.equal(registry.complete('/rew').some(item => item.name === 'rewind'), false);
  assert.deepEqual(registry.complete('普通输入'), []);
  assert.deepEqual(registry.complete('/session arg'), []);
});
