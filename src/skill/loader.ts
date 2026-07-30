import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { extractSkillName, parseSkillDocument } from './parser.js';
import { loadDedicatedTools } from './tool-loader.js';
import type { LoadedSkills, SkillDefinition, SkillDiagnostic, SkillScope } from './types.js';

interface Candidate {
  scope: SkillScope;
  file: string;
  fallbackName: string;
  rank: number;
  content: string;
  name: string;
}

export interface SkillLoaderOptions {
  userHome?: string;
  builtinDirectory?: string;
}

const DEFAULT_BUILTIN_DIRECTORY = fileURLToPath(new URL('../../skills/', import.meta.url));

function candidates(directory: string, scope: SkillScope, rank: number): Candidate[] {
  if (!existsSync(directory)) return [];
  const files = fg.sync(['*.md', '*/SKILL.md'], { cwd: directory, absolute: true }).sort();
  return files.map(file => {
    const content = readFileSync(file, 'utf8');
    const fallbackName = path.basename(file) === 'SKILL.md'
      ? path.basename(path.dirname(file))
      : path.basename(file, path.extname(file));
    return {
      scope,
      file,
      fallbackName,
      rank,
      content,
      name: extractSkillName(content, fallbackName),
    };
  });
}

export class SkillLoader {
  readonly directories: Readonly<Record<SkillScope, string>>;

  constructor(rootDir: string, options: SkillLoaderOptions = {}) {
    this.directories = {
      builtin: path.resolve(options.builtinDirectory ?? DEFAULT_BUILTIN_DIRECTORY),
      user: path.join(path.resolve(options.userHome ?? homedir()), '.bettercode', 'skills'),
      project: path.join(path.resolve(rootDir), '.bettercode', 'skills'),
    };
  }

  load(): LoadedSkills {
    const all = [
      ...candidates(this.directories.builtin, 'builtin', 0),
      ...candidates(this.directories.user, 'user', 1),
      ...candidates(this.directories.project, 'project', 2),
    ];
    const groups = new Map<string, Candidate[]>();
    for (const candidate of all) {
      const group = groups.get(candidate.name) ?? [];
      group.push(candidate);
      groups.set(candidate.name, group);
    }

    const skills = new Map<string, SkillDefinition>();
    const disabledNames = new Set<string>();
    const diagnostics: SkillDiagnostic[] = [];
    for (const name of [...groups.keys()].sort()) {
      const group = groups.get(name)!;
      const highestRank = Math.max(...group.map(candidate => candidate.rank));
      const highest = group.filter(candidate => candidate.rank === highestRank);
      const selected = highest[0];
      if (highest.length > 1) {
        disabledNames.add(name);
        diagnostics.push({
          scope: selected.scope,
          file: selected.file,
          name,
          code: 'DUPLICATE_SKILL',
          message: `同一层存在重复 Skill: ${name}`,
        });
        continue;
      }
      try {
        const parsed = parseSkillDocument(selected.content);
        const dedicatedTools = loadDedicatedTools(path.dirname(selected.file));
        skills.set(parsed.metadata.name, {
          ...parsed.metadata,
          scope: selected.scope,
          entryPath: selected.file,
          directory: path.dirname(selected.file),
          body: parsed.body,
          dedicatedTools,
        });
      } catch (error) {
        disabledNames.add(name);
        diagnostics.push({
          scope: selected.scope,
          file: selected.file,
          name,
          code: 'INVALID_SKILL',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { skills, disabledNames, diagnostics };
  }
}
