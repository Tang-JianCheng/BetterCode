import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { PathGuard } from '../tool/path-guard.js';
import { expandMcpTemplate, redactMcpMessage } from './redaction.js';
import type {
  LoadedMcpConfig,
  McpConfigLayer,
  McpDiagnostic,
  McpServerConfig,
} from './types.js';

export interface McpConfigLoaderOptions {
  userHome?: string;
  env?: NodeJS.ProcessEnv;
}

interface LayerResult {
  entries: Map<string, McpServerConfig | undefined>;
  diagnostics: McpDiagnostic[];
  secretValues: string[];
}

class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpConfigError';
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
  if (unknown.length > 0) throw new McpConfigError(`${context}包含未知字段: ${unknown.join(', ')}`);
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new McpConfigError(`${field}必须是字符串数组`);
  }
  return [...value];
}

function stringMap(value: unknown, field: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value) || Object.values(value).some(item => typeof item !== 'string')) {
    throw new McpConfigError(`${field}必须是字符串 map`);
  }
  return { ...(value as Record<string, string>) };
}

function compareText(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index].codePointAt(0)! - rightPoints[index].codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

export class McpConfigLoader {
  private readonly userHome: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly pathGuard: PathGuard;

  constructor(readonly rootDir: string, options: McpConfigLoaderOptions = {}) {
    this.userHome = options.userHome ?? homedir();
    this.env = options.env ?? process.env;
    this.pathGuard = new PathGuard(rootDir);
  }

  load(): LoadedMcpConfig {
    const userFile = path.join(this.userHome, '.bettercode', 'mcp.yaml');
    const compatibilityRelative = '.mcp.json';
    const projectRelative = path.join('.bettercode', 'mcp.yaml');
    const user = this.loadLayer('user', userFile);
    let compatibility: LayerResult;
    let project: LayerResult;
    try {
      const compatibilityFile = this.pathGuard.resolveForWrite(compatibilityRelative).absolute;
      compatibility = this.loadCompatibilityLayer(compatibilityFile);
    } catch (error) {
      compatibility = this.projectPathError(compatibilityRelative, error);
    }
    try {
      const projectFile = this.pathGuard.resolveForWrite(projectRelative).absolute;
      project = this.loadLayer('project', projectFile);
    } catch (error) {
      project = this.projectPathError(projectRelative, error);
    }

    const merged = new Map(user.entries);
    for (const [name, config] of compatibility.entries) merged.set(name, config);
    for (const [name, config] of project.entries) merged.set(name, config);
    const servers = [...merged.entries()]
      .filter((entry): entry is [string, McpServerConfig] => entry[1] !== undefined)
      .sort(([left], [right]) => compareText(left, right))
      .map(([, config]) => config);
    const diagnostics = [...user.diagnostics, ...compatibility.diagnostics, ...project.diagnostics]
      .sort((left, right) => compareText(
        `${left.layer ?? ''}\0${left.serverName ?? ''}\0${left.message}`,
        `${right.layer ?? ''}\0${right.serverName ?? ''}\0${right.message}`,
      ));
    return {
      servers,
      diagnostics,
      secretValues: [...new Set([
        ...user.secretValues,
        ...compatibility.secretValues,
        ...project.secretValues,
      ])],
    };
  }

  private projectPathError(relative: string, error: unknown): LayerResult {
    return {
      entries: new Map(),
      diagnostics: [{
        code: 'CONFIG_ERROR',
        message: redactMcpMessage(
          `项目 MCP 配置路径无效: ${error instanceof Error ? error.message : String(error)}`,
          [],
        ),
        layer: 'project',
        file: path.join(this.pathGuard.rootDir, relative),
      }],
      secretValues: [],
    };
  }

  private loadLayer(layer: McpConfigLayer, file: string): LayerResult {
    const result: LayerResult = {
      entries: new Map(),
      diagnostics: [],
      secretValues: [],
    };
    if (!existsSync(file)) return result;

    let raw: unknown;
    try {
      const document = parseDocument(readFileSync(file, 'utf8'), { uniqueKeys: true });
      if (document.errors.length > 0) {
        const positions = document.errors.map(error => {
          const position = error.linePos?.[0];
          return position ? `第 ${position.line} 行第 ${position.col} 列` : '位置未知';
        });
        throw new McpConfigError(`YAML 解析失败: ${positions.join('; ')}`);
      }
      raw = document.toJS();
      if (!isRecord(raw)) throw new McpConfigError('配置根节点必须是对象');
      assertOnlyKeys(raw, ['servers'], '配置根节点');
      if (raw.servers === undefined) return result;
      if (!isRecord(raw.servers)) throw new McpConfigError('servers 必须是 map');
    } catch (error) {
      result.diagnostics.push({
        code: 'CONFIG_ERROR',
        message: redactMcpMessage(error instanceof Error ? error.message : String(error), []),
        layer,
        file,
      });
      return result;
    }

    for (const [serverName, serverValue] of Object.entries(raw.servers as Record<string, unknown>)) {
      result.entries.set(serverName, undefined);
      try {
        if (!serverName.trim()) throw new McpConfigError('Server 名称不能为空');
        const parsed = this.parseServer(serverName, serverValue, layer, file, result.secretValues);
        result.entries.set(serverName, parsed);
      } catch (error) {
        const missing = error instanceof MissingEnvironmentError ? error.variables : undefined;
        result.diagnostics.push({
          code: missing ? 'ENV_MISSING' : 'CONFIG_ERROR',
          message: missing
            ? `缺少环境变量: ${missing.join(', ')}`
            : redactMcpMessage(error instanceof Error ? error.message : String(error), result.secretValues),
          layer,
          file,
          serverName,
        });
      }
    }
    return result;
  }

  private loadCompatibilityLayer(file: string): LayerResult {
    const result: LayerResult = {
      entries: new Map(),
      diagnostics: [],
      secretValues: [],
    };
    if (!existsSync(file)) return result;

    let servers: Record<string, unknown>;
    try {
      const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!isRecord(raw)) throw new McpConfigError('配置根节点必须是对象');
      if (!isRecord(raw.mcpServers)) throw new McpConfigError('mcpServers 必须是 map');
      servers = raw.mcpServers;
    } catch (error) {
      result.diagnostics.push({
        code: 'CONFIG_ERROR',
        message: redactMcpMessage(
          error instanceof SyntaxError
            ? 'JSON 解析失败'
            : error instanceof Error ? error.message : String(error),
          [],
        ),
        layer: 'project',
        file,
      });
      return result;
    }

    for (const [serverName, serverValue] of Object.entries(servers)) {
      result.entries.set(serverName, undefined);
      try {
        if (!serverName.trim()) throw new McpConfigError('Server 名称不能为空');
        const normalized = this.normalizeCompatibilityServer(serverValue);
        const parsed = this.parseServer(
          serverName,
          normalized,
          'project',
          file,
          result.secretValues,
        );
        result.entries.set(serverName, parsed);
      } catch (error) {
        const missing = error instanceof MissingEnvironmentError ? error.variables : undefined;
        result.diagnostics.push({
          code: missing ? 'ENV_MISSING' : 'CONFIG_ERROR',
          message: missing
            ? `缺少环境变量: ${missing.join(', ')}`
            : redactMcpMessage(
              error instanceof Error ? error.message : String(error),
              result.secretValues,
            ),
          layer: 'project',
          file,
          serverName,
        });
      }
    }
    return result;
  }

  private normalizeCompatibilityServer(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) throw new McpConfigError('Server 配置必须是对象');
    assertOnlyKeys(
      value,
      ['type', 'transport', 'command', 'args', 'env', 'url', 'headers'],
      '兼容 Server ',
    );
    if (
      value.type !== undefined
      && value.transport !== undefined
      && value.type !== value.transport
    ) {
      throw new McpConfigError('type 与 transport 不能冲突');
    }
    const declared = value.transport ?? value.type;
    const transport = declared ?? (
      value.url !== undefined ? 'http' : value.command !== undefined ? 'stdio' : undefined
    );
    if (transport === 'stdio') {
      return {
        transport,
        command: value.command,
        args: value.args,
        env: value.env,
      };
    }
    if (transport === 'http' || transport === 'streamable-http') {
      return {
        transport: 'http',
        url: value.url,
        headers: value.headers,
      };
    }
    throw new McpConfigError('type 或 transport 必须是 stdio、http 或 streamable-http');
  }

  private parseServer(
    name: string,
    value: unknown,
    layer: McpConfigLayer,
    file: string,
    allSecrets: string[],
  ): McpServerConfig {
    if (!isRecord(value)) throw new McpConfigError('Server 配置必须是对象');
    if (value.transport === 'stdio') {
      assertOnlyKeys(value, ['transport', 'command', 'args', 'env'], 'stdio Server ');
      if (typeof value.command !== 'string' || !value.command.trim()) {
        throw new McpConfigError('stdio command 必须是非空字符串');
      }
      const args = stringArray(value.args, 'stdio args');
      const expanded = this.expandMap(stringMap(value.env, 'stdio env'), allSecrets);
      return {
        name,
        layer,
        file,
        secretValues: expanded.secretValues,
        transport: 'stdio',
        command: value.command,
        args,
        env: expanded.values,
      };
    }
    if (value.transport === 'http') {
      assertOnlyKeys(value, ['transport', 'url', 'headers'], 'HTTP Server ');
      if (typeof value.url !== 'string') throw new McpConfigError('HTTP url 必须是字符串');
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(value.url);
      } catch {
        throw new McpConfigError('HTTP url 无效');
      }
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new McpConfigError('HTTP url 只支持 http 或 https');
      }
      const expanded = this.expandMap(stringMap(value.headers, 'HTTP headers'), allSecrets);
      return {
        name,
        layer,
        file,
        secretValues: expanded.secretValues,
        transport: 'http',
        url: parsedUrl.toString(),
        headers: expanded.values,
      };
    }
    throw new McpConfigError('transport 必须是 stdio 或 http');
  }

  private expandMap(
    source: Record<string, string>,
    allSecrets: string[],
  ): { values: Record<string, string>; secretValues: string[] } {
    const values: Record<string, string> = {};
    const secrets = new Set<string>();
    const missing = new Set<string>();
    for (const [key, template] of Object.entries(source)) {
      const expanded = expandMcpTemplate(template, this.env);
      values[key] = expanded.value;
      for (const secret of expanded.secretValues) secrets.add(secret);
      if (expanded.value) secrets.add(expanded.value);
      for (const variable of expanded.missing) missing.add(variable);
    }
    allSecrets.push(...secrets);
    if (missing.size > 0) throw new MissingEnvironmentError([...missing].sort());
    return { values, secretValues: [...secrets] };
  }
}

class MissingEnvironmentError extends Error {
  constructor(readonly variables: string[]) {
    super(`缺少环境变量: ${variables.join(', ')}`);
    this.name = 'MissingEnvironmentError';
  }
}
