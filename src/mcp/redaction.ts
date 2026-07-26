const TEMPLATE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu;
const REDACTION_MARKER = '[REDACTED]';
const DEFAULT_MAX_MESSAGE_LENGTH = 500;

export interface ExpandedMcpTemplate {
  value: string;
  secretValues: string[];
  missing: string[];
}

export function expandMcpTemplate(
  value: string,
  env: NodeJS.ProcessEnv,
): ExpandedMcpTemplate {
  const secrets = new Set<string>();
  const missing = new Set<string>();
  const expanded = value.replace(TEMPLATE_PATTERN, (_match, variable: string) => {
    const replacement = env[variable];
    if (replacement === undefined) {
      missing.add(variable);
      return '';
    }
    if (replacement.length > 0) secrets.add(replacement);
    return replacement;
  });

  if (expanded.length > 0 && expanded !== value && missing.size === 0) {
    secrets.add(expanded);
  }

  return {
    value: expanded,
    secretValues: [...secrets],
    missing: [...missing].sort(),
  };
}

export function redactMcpMessage(
  message: string,
  secretValues: readonly string[],
  maxLength = DEFAULT_MAX_MESSAGE_LENGTH,
): string {
  const secrets = [...new Set(secretValues.filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  let redacted = message;
  for (const secret of secrets) redacted = redacted.replaceAll(secret, REDACTION_MARKER);
  redacted = redacted.replace(/[\r\n\t\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/gu, ' ');
  if (redacted.length <= maxLength) return redacted;
  return `${redacted.slice(0, Math.max(0, maxLength - 3))}...`;
}
