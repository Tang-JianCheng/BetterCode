import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { PathGuard } from '../tool/path-guard.js';
import type { HookLayer, LoadedHookConfig, LoadedRawHookRule } from './types.js';

const ENV_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu;

export class HookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HookConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
  const unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) throw new HookConfigError(`${context}包含未知字段: ${unknown.join(', ')}`);
}

function expandEnvironment(
  value: unknown,
  env: NodeJS.ProcessEnv,
  secrets: Set<string>,
): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_PATTERN, (_match, variable: string) => {
      const replacement = env[variable];
      if (replacement === undefined) throw new HookConfigError(`缺少环境变量: ${variable}`);
      if (replacement) secrets.add(replacement);
      return replacement;
    });
  }
  if (Array.isArray(value)) return value.map(item => expandEnvironment(item, env, secrets));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      expandEnvironment(item, env, secrets),
    ]));
  }
  return value;
}

export interface HookConfigLoaderOptions {
  userHome?: string;
  env?: NodeJS.ProcessEnv;
}

export class HookConfigLoader {
  private readonly userHome: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly pathGuard: PathGuard;

  constructor(readonly rootDir: string, options: HookConfigLoaderOptions = {}) {
    this.userHome = options.userHome ?? homedir();
    this.env = options.env ?? process.env;
    this.pathGuard = new PathGuard(rootDir);
  }

  load(): LoadedHookConfig {
    const files: Array<{ layer: HookLayer; file: string }> = [{
      layer: 'user',
      file: path.join(this.userHome, '.bettercode', 'hooks.yaml'),
    }];
    for (const [layer, relative] of [
      ['project', path.join('.bettercode', 'hooks.yaml')],
      ['local', path.join('.bettercode', 'hooks.local.yaml')],
    ] as const) {
      try {
        files.push({ layer, file: this.pathGuard.resolveForWrite(relative).absolute });
      } catch (error) {
        throw new HookConfigError(
          `${layer === 'project' ? '项目共享' : '项目本地'} Hook 配置路径无效: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const rules: LoadedRawHookRule[] = [];
    const secrets = new Set<string>();
    for (const source of files) {
      rules.push(...this.loadLayer(source.layer, source.file, secrets));
    }
    return { rules, secretValues: [...secrets] };
  }

  private loadLayer(layer: HookLayer, file: string, secrets: Set<string>): LoadedRawHookRule[] {
    if (!existsSync(file)) return [];
    let raw: unknown;
    try {
      const document = parseDocument(readFileSync(file, 'utf8'), { uniqueKeys: true });
      if (document.errors.length) {
        const positions = document.errors.map(error => {
          const position = error.linePos?.[0];
          return position ? `第 ${position.line} 行第 ${position.col} 列` : '位置未知';
        });
        throw new HookConfigError(`YAML 解析失败: ${positions.join('; ')}`);
      }
      raw = document.toJS();
      if (!isRecord(raw)) throw new HookConfigError('配置根节点必须是对象');
      onlyKeys(raw, ['version', 'hooks'], '配置根节点');
      if (raw.version !== 1) throw new HookConfigError('配置 version 必须是 1');
      if (raw.hooks === undefined) return [];
      if (!Array.isArray(raw.hooks)) throw new HookConfigError('hooks 必须是数组');
    } catch (error) {
      throw new HookConfigError(
        `${layer} Hook 配置 ${file} 无效: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return (raw.hooks as unknown[]).map((entry, index) => {
      if (!isRecord(entry)) {
        throw new HookConfigError(`${layer} Hook 配置 ${file} 第 ${index + 1} 条规则必须是对象`);
      }
      let value = { ...entry };
      const action = value.action;
      if (isRecord(action) && action.type === 'http') {
        value = { ...value, action: expandEnvironment(action, this.env, secrets) };
      }
      return {
        source: { layer, file, index, id: `${layer}:${index}` },
        value,
      };
    });
  }
}
