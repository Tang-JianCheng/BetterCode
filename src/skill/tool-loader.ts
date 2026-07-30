import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { parse as parseYaml } from 'yaml';
import type { JsonSchema, Tool, ToolEffect, ToolPermissionProfile } from '../tool/types.js';
import { SkillScriptTool } from './script-tool.js';

const TOOL_NAME = /^[a-z][a-z0-9_]*$/u;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function inside(root: string, target: string, label: string): string {
  const resolvedRoot = realpathSync(root);
  const resolved = realpathSync(target);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} 不能位于 Skill 目录外`);
  return resolved;
}

function parsePermission(value: unknown): ToolPermissionProfile {
  const permission = object(value, '专属工具 permission');
  const risk = permission.risk;
  if (risk !== 'read' && risk !== 'write' && risk !== 'execute') throw new Error('专属工具 permission.risk 无效');
  if (permission.targetKind === 'arguments') return { targetKind: 'arguments', risk };
  const targetKind = permission.targetKind;
  if (targetKind !== 'path' && targetKind !== 'command' && targetKind !== 'glob' && targetKind !== 'value') {
    throw new Error('专属工具 permission.targetKind 无效');
  }
  if (typeof permission.targetArgument !== 'string' || !permission.targetArgument.trim()) {
    throw new Error('专属工具 permission.targetArgument 不能为空');
  }
  const pathIntent = permission.pathIntent;
  if (pathIntent !== undefined && pathIntent !== 'existing' && pathIntent !== 'write' && pathIntent !== 'glob') {
    throw new Error('专属工具 permission.pathIntent 无效');
  }
  return {
    targetKind,
    targetArgument: permission.targetArgument.trim(),
    risk,
    ...(typeof permission.defaultTarget === 'string' ? { defaultTarget: permission.defaultTarget } : {}),
    ...(pathIntent ? { pathIntent } : {}),
  };
}

export function loadDedicatedTools(skillDirectory: string): Tool[] {
  const toolsDirectory = path.join(skillDirectory, 'tools');
  if (!existsSync(toolsDirectory)) return [];
  const files = fg.sync('*.tool.yaml', { cwd: toolsDirectory, absolute: true }).sort();
  const names = new Set<string>();
  return files.map(file => {
    const metadataPath = inside(skillDirectory, file, '专属工具元信息');
    const parsed = object(parseYaml(readFileSync(metadataPath, 'utf8')), '专属工具元信息');
    const allowedFields = new Set(['name', 'description', 'schema', 'script', 'effect', 'permission']);
    for (const key of Object.keys(parsed)) {
      if (!allowedFields.has(key)) throw new Error(`专属工具元信息包含未知字段: ${key}`);
    }
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    if (!TOOL_NAME.test(name)) throw new Error(`专属工具名称无效: ${name}`);
    if (names.has(name)) throw new Error(`专属工具名称重复: ${name}`);
    names.add(name);
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
    if (!description) throw new Error(`专属工具 ${name} 的 description 不能为空`);
    if (typeof parsed.schema !== 'string' || typeof parsed.script !== 'string') {
      throw new Error(`专属工具 ${name} 必须声明 schema 和 script`);
    }
    const schemaPath = inside(skillDirectory, path.resolve(path.dirname(metadataPath), parsed.schema), 'Schema');
    const scriptPath = inside(skillDirectory, path.resolve(path.dirname(metadataPath), parsed.script), '脚本');
    if (path.extname(scriptPath) !== '.mjs') throw new Error(`专属工具 ${name} 的脚本必须是 .mjs`);
    let schema: JsonSchema;
    try {
      schema = object(JSON.parse(readFileSync(schemaPath, 'utf8')), `专属工具 ${name} Schema`);
    } catch (error) {
      throw new Error(`专属工具 ${name} Schema 无效: ${error instanceof Error ? error.message : String(error)}`);
    }
    const effect: ToolEffect = parsed.effect === 'read_only' || parsed.effect === 'side_effect'
      ? parsed.effect
      : (() => { throw new Error(`专属工具 ${name} 的 effect 无效`); })();
    return new SkillScriptTool(
      name,
      description,
      schema,
      effect,
      parsePermission(parsed.permission),
      scriptPath,
    );
  });
}
