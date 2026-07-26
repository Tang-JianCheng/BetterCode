import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionRuleEngine } from './rule-engine.js';
import { parsePermissionRule } from './rule-parser.js';
import type { PermissionEffect, PermissionRuleLayer } from './types.js';

const knownTools = new Map([['read_file', 'path']] as const);

function rule(
  effect: PermissionEffect,
  expression: string,
  layer: PermissionRuleLayer,
  order = 0,
) {
  return parsePermissionRule({ effect, expression }, layer, order, knownTools);
}

test('rule engine applies session, local, project and user priority', () => {
  const engine = new PermissionRuleEngine();
  engine.replaceLayer('user', [rule('deny', 'read_file(*)', 'user')]);
  engine.replaceLayer('project', [rule('allow', 'read_file(*)', 'project')]);
  engine.replaceLayer('local', [rule('deny', 'read_file(*)', 'local')]);
  engine.replaceLayer('session', [rule('allow', 'read_file(*)', 'session')]);

  assert.equal(engine.match('read_file', 'a.ts')?.effect, 'allow');
  engine.clearSessionRules();
  assert.equal(engine.match('read_file', 'a.ts')?.effect, 'deny');
  engine.replaceLayer('local', []);
  assert.equal(engine.match('read_file', 'a.ts')?.effect, 'allow');
  engine.replaceLayer('project', []);
  assert.equal(engine.match('read_file', 'a.ts')?.effect, 'deny');
});

test('rule engine selects the most specific rule then the latest declaration', () => {
  const engine = new PermissionRuleEngine();
  engine.replaceLayer('project', [
    rule('deny', 'read_file', 'project', 0),
    rule('allow', 'read_file(src/**)', 'project', 1),
    rule('deny', 'read_file(src/special/**)', 'project', 2),
    rule('allow', 'read_file(src/special/file.ts)', 'project', 3),
  ]);
  assert.equal(engine.match('read_file', 'src/special/file.ts')?.effect, 'allow');
  assert.equal(engine.match('read_file', 'src/special/other.ts')?.effect, 'deny');
  assert.equal(engine.match('read_file', 'src/other.ts')?.effect, 'allow');
  assert.equal(engine.match('read_file', 'README.md')?.effect, 'deny');

  engine.replaceLayer('project', [
    rule('allow', 'read_file(src/*.ts)', 'project', 0),
    rule('deny', 'read_file(src/*.ts)', 'project', 1),
  ]);
  assert.equal(engine.match('read_file', 'src/index.ts')?.effect, 'deny');
  assert.deepEqual(engine.countByLayer(), { user: 0, project: 2, local: 0, session: 0 });
});
