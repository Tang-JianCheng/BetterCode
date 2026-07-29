import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const MAX_ENTRIES = 200;
const FILENAME = 'prompt_history.jsonl';

function historyFile(baseDir: string): string {
  return path.join(path.resolve(baseDir), '.bettercode', FILENAME);
}

export function load(baseDir: string): string[] {
  const file = historyFile(baseDir);
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .flatMap(line => {
        try {
          const value = JSON.parse(line) as { text?: unknown };
          return typeof value.text === 'string' && value.text.trim() ? [value.text] : [];
        } catch {
          return [];
        }
      })
      .slice(-MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function append(baseDir: string, text: string): void {
  const value = text.trim();
  if (!value) return;
  const entries = load(baseDir);
  if (entries.at(-1) === value) return;
  entries.push(value);
  const limited = entries.slice(-MAX_ENTRIES);
  const directory = path.dirname(historyFile(baseDir));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(
    historyFile(baseDir),
    `${limited.map(entry => JSON.stringify({ text: entry })).join('\n')}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}
