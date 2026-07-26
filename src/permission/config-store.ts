import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Document, parseDocument } from 'yaml';
import type { PermissionTargetKind } from '../tool/types.js';
import { PathGuard } from '../tool/path-guard.js';
import { parsePermissionRule } from './rule-parser.js';
import type {
  PermissionDiagnostic,
  PermissionRule,
  PermissionRuleLayer,
  RawPermissionRule,
} from './types.js';

type PersistentLayer = Exclude<PermissionRuleLayer, 'session'>;

export interface LoadedPermissionConfig {
  rules: Record<PersistentLayer, PermissionRule[]>;
  diagnostics: PermissionDiagnostic[];
}

export interface PersistedLocalRules {
  added: PermissionRule;
  rules: PermissionRule[];
}

export class PermissionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new PermissionConfigError(`${context} 包含未知字段: ${unknown.join(', ')}`);
  }
}

function parseRawConfig(value: unknown): RawPermissionRule[] {
  if (!isRecord(value)) throw new PermissionConfigError('权限配置根节点必须是对象');
  assertOnlyKeys(value, ['version', 'rules'], '权限配置');
  if (value.version !== 1) throw new PermissionConfigError('权限配置 version 必须是 1');
  if (value.rules === undefined) return [];
  if (!Array.isArray(value.rules)) throw new PermissionConfigError('权限配置 rules 必须是数组');

  return value.rules.map((entry, index) => {
    if (!isRecord(entry)) throw new PermissionConfigError(`第 ${index + 1} 条规则必须是对象`);
    assertOnlyKeys(entry, ['effect', 'expression'], `第 ${index + 1} 条规则`);
    if (entry.effect !== 'allow' && entry.effect !== 'deny') {
      throw new PermissionConfigError(`第 ${index + 1} 条规则 effect 必须是 allow 或 deny`);
    }
    if (typeof entry.expression !== 'string' || !entry.expression.trim()) {
      throw new PermissionConfigError(`第 ${index + 1} 条规则 expression 必须是非空字符串`);
    }
    return { effect: entry.effect, expression: entry.expression };
  });
}

export class PermissionConfigStore {
  readonly paths: Readonly<Record<PersistentLayer, string>>;
  private readonly pathGuard: PathGuard;

  constructor(
    readonly rootDir: string,
    private readonly knownTools: ReadonlyMap<string, PermissionTargetKind>,
    userHome = homedir(),
  ) {
    this.pathGuard = new PathGuard(rootDir);
    this.paths = {
      user: path.join(userHome, '.bettercode', 'permissions.yaml'),
      project: path.join(rootDir, '.bettercode', 'permissions.yaml'),
      local: path.join(rootDir, '.bettercode', 'permissions.local.yaml'),
    };
  }

  load(): LoadedPermissionConfig {
    const loaded: LoadedPermissionConfig = {
      rules: { user: [], project: [], local: [] },
      diagnostics: [],
    };
    for (const layer of ['user', 'project', 'local'] as const) {
      const result = this.loadLayer(layer);
      loaded.rules[layer] = result.rules;
      if (result.diagnostic) loaded.diagnostics.push(result.diagnostic);
    }
    return loaded;
  }

  async appendLocalAllow(expression: string): Promise<PersistedLocalRules> {
    let file: string;
    try {
      file = this.resolveProjectConfigPath('local');
    } catch (error) {
      throw new PermissionConfigError(
        `项目本地权限配置超出项目边界: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let document: Document;
    let rawRules: RawPermissionRule[];

    if (existsSync(file)) {
      document = this.parseDocument(file);
      rawRules = parseRawConfig(document.toJS());
    } else {
      document = new Document({ version: 1, rules: [] });
      rawRules = [];
    }

    const existingIndex = rawRules.findIndex(
      rule => rule.effect === 'allow' && rule.expression === expression,
    );
    if (existingIndex >= 0) {
      const rules = this.compileRules(rawRules, 'local');
      return { added: rules[existingIndex], rules };
    }

    const candidate: RawPermissionRule = { effect: 'allow', expression };
    const added = parsePermissionRule(candidate, 'local', rawRules.length, this.knownTools);
    if (document.get('rules') === undefined) document.set('rules', []);
    document.addIn(['rules'], candidate);
    const nextRules = [...rawRules, candidate];
    parseRawConfig(document.toJS());

    const directory = path.dirname(file);
    const temporary = path.join(directory, `.permissions.${process.pid}.${randomUUID()}.tmp`);
    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(temporary, document.toString(), 'utf8');
      renameSync(temporary, file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw new PermissionConfigError(
        `写入项目本地权限配置失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { added, rules: this.compileRules(nextRules, 'local') };
  }

  private loadLayer(layer: PersistentLayer): {
    rules: PermissionRule[];
    diagnostic?: PermissionDiagnostic;
  } {
    let file = this.paths[layer];
    try {
      if (layer !== 'user') file = this.resolveProjectConfigPath(layer);
      if (!existsSync(file)) return { rules: [] };
      const document = this.parseDocument(file);
      return { rules: this.compileRules(parseRawConfig(document.toJS()), layer) };
    } catch (error) {
      return {
        rules: [],
        diagnostic: {
          layer,
          file,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private resolveProjectConfigPath(layer: 'project' | 'local'): string {
    const filename = layer === 'project' ? 'permissions.yaml' : 'permissions.local.yaml';
    return this.pathGuard.resolveForWrite(path.join('.bettercode', filename)).absolute;
  }

  private parseDocument(file: string): Document {
    const document = parseDocument(readFileSync(file, 'utf8'));
    if (document.errors.length > 0) {
      const locations = document.errors.map(error => {
        const position = error.linePos?.[0];
        return position ? `第 ${position.line} 行第 ${position.col} 列` : '位置未知';
      });
      throw new PermissionConfigError(
        `YAML 解析失败: ${locations.join('; ')}`,
      );
    }
    return document;
  }

  private compileRules(rawRules: RawPermissionRule[], layer: PersistentLayer): PermissionRule[] {
    return rawRules.map((rule, index) => {
      try {
        return parsePermissionRule(rule, layer, index, this.knownTools);
      } catch (error) {
        throw new PermissionConfigError(
          `第 ${index + 1} 条规则无效: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  }
}
