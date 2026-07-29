import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export const MAX_INCLUDE_DEPTH = 5;

export interface InstructionSource {
  path: string;
  content: string;
}

export interface InstructionLoadOptions {
  userHome?: string;
}

function findGitRoot(workDir: string): string {
  let current = path.resolve(workDir);
  while (true) {
    if (existsSync(path.join(current, '.git'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(workDir);
    current = parent;
  }
}

function projectDirectories(workDir: string): string[] {
  const root = findGitRoot(workDir);
  const target = path.resolve(workDir);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return [target];
  const directories = [root];
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    directories.push(current);
  }
  return directories;
}

function parseInclude(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('@') || trimmed.startsWith('@@') || /\s/u.test(trimmed)) return undefined;
  const value = trimmed.slice(1);
  if (value.startsWith('./') || value.startsWith('../') || value.startsWith('~/') || value.startsWith('/')) {
    return value;
  }
  return undefined;
}

function resolveInclude(value: string, baseDir: string, userHome: string): string {
  if (value.startsWith('~/')) return path.resolve(userHome, value.slice(2));
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve(baseDir, value);
}

function expandIncludes(
  content: string,
  baseDir: string,
  userHome: string,
  seen: Set<string>,
  depth: number,
): string {
  let inCodeBlock = false;
  return content.split(/\r?\n/u).map(line => {
    if (/^\s*(```|~~~)/u.test(line)) {
      inCodeBlock = !inCodeBlock;
      return line;
    }
    if (inCodeBlock) return line;
    const include = parseInclude(line);
    if (!include || depth >= MAX_INCLUDE_DEPTH) return line;
    const file = resolveInclude(include, baseDir, userHome);
    if (seen.has(file) || !existsSync(file)) return line;
    try {
      seen.add(file);
      const nested = readFileSync(file, 'utf8');
      return [
        `<!-- included from ${include} -->`,
        expandIncludes(nested, path.dirname(file), userHome, seen, depth + 1),
      ].join('\n');
    } catch {
      return line;
    }
  }).join('\n');
}

export function discoverInstructions(
  workDir: string,
  options: InstructionLoadOptions = {},
): InstructionSource[] {
  const target = path.resolve(workDir);
  const userHome = path.resolve(options.userHome ?? homedir());
  const candidates = [
    path.join(userHome, '.bettercode/BETTERCODE.md'),
    path.join(userHome, '.bettercode/AGENTS.md'),
    ...projectDirectories(target).flatMap(directory => [
      path.join(directory, 'BETTERCODE.md'),
      path.join(directory, 'AGENTS.md'),
    ]),
    path.join(target, '.bettercode/INSTRUCTIONS.md'),
    path.join(target, 'BETTERCODE.local.md'),
  ];
  const sources: InstructionSource[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const file = path.resolve(candidate);
    if (seen.has(file) || !existsSync(file)) continue;
    try {
      seen.add(file);
      sources.push({
        path: file,
        content: expandIncludes(
          readFileSync(file, 'utf8'),
          path.dirname(file),
          userHome,
          seen,
          0,
        ),
      });
    } catch {
      // 单个指令文件失败时继续加载其他层级。
    }
  }
  return sources;
}

export function loadInstructions(
  workDir: string,
  options: InstructionLoadOptions = {},
): string {
  return discoverInstructions(workDir, options)
    .map(source => `<!-- instructions from ${source.path} -->\n${source.content}`)
    .join('\n\n---\n\n');
}
