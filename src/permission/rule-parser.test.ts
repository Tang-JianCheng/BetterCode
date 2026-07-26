import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createExactPermissionExpression,
  parsePermissionRule,
} from './rule-parser.js';

const knownTools = new Map([
  ['read_file', 'path'],
  ['run_command', 'command'],
] as const);

function parse(effect: 'allow' | 'deny', expression: string) {
  return parsePermissionRule({ effect, expression }, 'project', 0, knownTools);
}

test('permission parser supports tool, exact and glob expressions', () => {
  const tool = parse('allow', 'read_file');
  const exact = parse('deny', 'read_file(src/index.ts)');
  const glob = parse('allow', 'run_command(git *)');

  assert.equal(tool.patternKind, 'tool');
  assert.equal(tool.matches('anything'), true);
  assert.equal(exact.patternKind, 'exact');
  assert.equal(exact.matches('src/index.ts'), true);
  assert.equal(exact.matches('other/src/index.ts'), false);
  assert.equal(glob.patternKind, 'glob');
  assert.equal(glob.matches('git status'), true);
  assert.equal(glob.matches('git add src/index.ts'), true);
  assert.equal(glob.matches('sudo git status'), false);
});

test('permission parser handles parentheses and exact escaping', () => {
  const command = 'node -e "console.log(1)"';
  assert.equal(parse('allow', `run_command(${command})`).matches(command), true);

  const target = String.raw`src/[id]/*.ts`;
  const expression = createExactPermissionExpression('read_file', target);
  const exact = parse('allow', expression);
  assert.equal(exact.patternKind, 'exact');
  assert.equal(exact.matches(target), true);
  assert.equal(exact.matches('src/x/file.ts'), false);

  const literalSyntax = parse('allow', 'read_file(src/{a,b}/@(file).ts)');
  assert.equal(literalSyntax.patternKind, 'exact');
  assert.equal(literalSyntax.matches('src/{a,b}/@(file).ts'), true);
  assert.equal(literalSyntax.matches('src/a/file.ts'), false);
});

test('permission parser rejects malformed and unknown rules', () => {
  assert.throws(() => parse('allow', ''), /不能为空/);
  assert.throws(() => parse('allow', 'read_file('), /括号不完整/);
  assert.throws(() => parse('allow', 'read_file()'), /模式不能为空/);
  assert.throws(() => parse('allow', 'unknown(*)'), /未知工具/);
  assert.throws(() => parsePermissionRule(
    { effect: 'maybe' as 'allow', expression: 'read_file' },
    'user',
    0,
    knownTools,
  ), /effect 无效/);
});

test('permission parser keeps offline MCP rules dormant and matches JSON slashes', () => {
  const toolName = 'mcp_server_tool_deadbeef';
  const exactTarget = '{"path":"src/a.ts","value":"[*]"}';
  const exactExpression = createExactPermissionExpression(toolName, exactTarget);
  const exact = parsePermissionRule(
    { effect: 'allow', expression: exactExpression },
    'local',
    0,
    knownTools,
  );
  const glob = parsePermissionRule(
    { effect: 'allow', expression: `${toolName}(*src/*.ts*)` },
    'local',
    1,
    knownTools,
  );

  assert.equal(exact.patternKind, 'exact');
  assert.equal(exact.matches(exactTarget), true);
  assert.equal(glob.matches('{"path":"src/a.ts"}'), true);
  assert.throws(() => parsePermissionRule(
    { effect: 'allow', expression: 'mcp_not_valid(*)' },
    'local',
    2,
    knownTools,
  ), /未知工具/u);
});
