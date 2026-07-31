import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { extractAgentDefinitionName, parseAgentDefinitionDocument } from './parser.js';
import type {
  AgentDefinition,
  AgentDefinitionDiagnostic,
  AgentDefinitionScope,
  LoadedAgentDefinitions,
} from './types.js';

interface DirectorySource {
  scope: AgentDefinitionScope;
  path: string;
  rank: number;
}

interface Candidate extends DirectorySource {
  file: string;
  fallbackName: string;
  content: string;
  name: string;
}

export interface AgentDefinitionLoaderOptions {
  userHome?: string;
  builtinDirectory?: string;
  pluginDirectories?: readonly string[];
}

const DEFAULT_BUILTIN_DIRECTORY = fileURLToPath(new URL('../../agents/', import.meta.url));

export class AgentDefinitionLoader {
  readonly directories: readonly DirectorySource[];

  constructor(rootDir: string, options: AgentDefinitionLoaderOptions = {}) {
    this.directories = [
      ...(options.pluginDirectories ?? []).map(directory => ({
        scope: 'plugin' as const,
        path: path.resolve(directory),
        rank: 0,
      })),
      {
        scope: 'builtin',
        path: path.resolve(options.builtinDirectory ?? DEFAULT_BUILTIN_DIRECTORY),
        rank: 1,
      },
      {
        scope: 'user',
        path: path.join(path.resolve(options.userHome ?? homedir()), '.bettercode', 'agents'),
        rank: 2,
      },
      {
        scope: 'project',
        path: path.join(path.resolve(rootDir), '.bettercode', 'agents'),
        rank: 3,
      },
    ];
  }

  load(): LoadedAgentDefinitions {
    const groups = new Map<string, Candidate[]>();
    for (const directory of this.directories) {
      if (!existsSync(directory.path)) continue;
      const files = fg.sync(['*.md', '*/AGENT.md'], {
        cwd: directory.path,
        absolute: true,
        onlyFiles: true,
      }).sort();
      for (const file of files) {
        const content = readFileSync(file, 'utf8');
        const fallbackName = path.basename(file) === 'AGENT.md'
          ? path.basename(path.dirname(file))
          : path.basename(file, path.extname(file));
        const candidate: Candidate = {
          ...directory,
          file,
          fallbackName,
          content,
          name: extractAgentDefinitionName(content, fallbackName),
        };
        const group = groups.get(candidate.name) ?? [];
        group.push(candidate);
        groups.set(candidate.name, group);
      }
    }

    const definitions = new Map<string, AgentDefinition>();
    const disabledNames = new Set<string>();
    const diagnostics: AgentDefinitionDiagnostic[] = [];
    for (const name of [...groups.keys()].sort()) {
      const group = groups.get(name)!;
      const highestRank = Math.max(...group.map(candidate => candidate.rank));
      const selected = group.filter(candidate => candidate.rank === highestRank);
      const candidate = selected[0];
      if (selected.length > 1) {
        disabledNames.add(name);
        diagnostics.push({
          scope: candidate.scope,
          file: candidate.file,
          name,
          code: 'DUPLICATE_DEFINITION',
          message: `同一来源层存在重复 Agent: ${name}`,
        });
        continue;
      }
      try {
        const parsed = parseAgentDefinitionDocument(candidate.content);
        definitions.set(parsed.metadata.name, {
          ...parsed.metadata,
          scope: candidate.scope,
          entryPath: candidate.file,
          body: parsed.body,
        });
      } catch (error) {
        disabledNames.add(name);
        diagnostics.push({
          scope: candidate.scope,
          file: candidate.file,
          name,
          code: 'INVALID_DEFINITION',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { definitions, disabledNames, diagnostics };
  }

  fingerprint(): string {
    return this.directories.map(directory => {
      if (!existsSync(directory.path)) return `${directory.path}:missing`;
      const files = fg.sync(['*.md', '*/AGENT.md'], {
        cwd: directory.path,
        absolute: true,
        onlyFiles: true,
      }).sort();
      return `${directory.path}:${files.map(file => {
        const stat = statSync(file);
        return `${path.relative(directory.path, file)}:${stat.size}:${stat.mtimeMs}`;
      }).join('|')}`;
    }).join('\n');
  }
}
