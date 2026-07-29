import type {
  CommandCompletion,
  CommandDefinition,
} from './types.js';

const COMMAND_TOKEN = /^(?:[a-z][a-z0-9-]*|\?)$/u;

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function validateDefinition(definition: CommandDefinition): void {
  if (!COMMAND_TOKEN.test(normalizeToken(definition.name))) {
    throw new Error(`命令名称无效: ${definition.name}`);
  }
  if (!definition.description.trim()) throw new Error(`命令描述不能为空: ${definition.name}`);
  if (!definition.usage.trim()) throw new Error(`命令用法不能为空: ${definition.name}`);
  for (const alias of definition.aliases) {
    if (!COMMAND_TOKEN.test(normalizeToken(alias))) {
      throw new Error(`命令别名无效: ${alias}`);
    }
  }
}

export class CommandRegistry {
  private readonly definitions: CommandDefinition[] = [];
  private readonly index = new Map<string, CommandDefinition>();

  register(definition: CommandDefinition): void {
    validateDefinition(definition);
    const normalized: CommandDefinition = {
      ...definition,
      name: normalizeToken(definition.name),
      aliases: definition.aliases.map(normalizeToken),
      description: definition.description.trim(),
      usage: definition.usage.trim(),
      ...(definition.argumentHint?.trim()
        ? { argumentHint: definition.argumentHint.trim() }
        : {}),
    };
    const tokens = [normalized.name, ...normalized.aliases];
    if (new Set(tokens).size !== tokens.length) {
      throw new Error(`命令 ${normalized.name} 的名称或别名重复`);
    }
    for (const token of tokens) {
      const existing = this.index.get(token);
      if (existing) {
        throw new Error(`命令名称或别名冲突: ${token} (${existing.name} / ${normalized.name})`);
      }
    }
    this.definitions.push(normalized);
    for (const token of tokens) this.index.set(token, normalized);
  }

  get(name: string): CommandDefinition | undefined {
    return this.index.get(normalizeToken(name));
  }

  list(options: { includeHidden?: boolean } = {}): CommandDefinition[] {
    return this.definitions
      .filter(definition => options.includeHidden || !definition.hidden)
      .map(definition => ({ ...definition, aliases: [...definition.aliases] }));
  }

  complete(input: string): CommandCompletion[] {
    const value = input.trimStart();
    if (!value.startsWith('/')) return [];
    const token = value.slice(1);
    if (/\s/u.test(token)) return [];
    const query = token.toLowerCase();
    return this.definitions.flatMap(definition => {
      if (definition.hidden) return [];
      const matches = definition.name.startsWith(query) ||
        definition.aliases.some(alias => alias.startsWith(query));
      if (!matches) return [];
      const hint = definition.argumentHint ? ` ${definition.argumentHint}` : '';
      return [{
        name: definition.name,
        value: `/${definition.name} `,
        label: `/${definition.name}${hint}`,
        description: definition.description,
      }];
    });
  }
}
