import { randomUUID } from 'node:crypto';
import { isToolFailure } from '../tool/errors.js';
import {
  createToolError,
  type Tool,
  type ToolCall,
} from '../tool/types.js';
import { matchDangerousCommand } from './command-blacklist.js';
import { PermissionConfigError, PermissionConfigStore } from './config-store.js';
import { PermissionRuleEngine } from './rule-engine.js';
import { createExactPermissionExpression, parsePermissionRule } from './rule-parser.js';
import { SandboxPolicy } from './sandbox.js';
import type {
  PermissionAuthorization,
  PermissionAuthorizeOptions,
  PermissionChoice,
  PermissionDecisionSource,
  PermissionDiagnostic,
  PermissionMode,
  PermissionRequest,
  PermissionRuleLayer,
  PermissionStatus,
} from './types.js';

const RULE_SOURCE: Record<PermissionRuleLayer, PermissionDecisionSource> = {
  session: 'session_rule',
  local: 'local_rule',
  project: 'project_rule',
  user: 'user_rule',
};

const VALID_CHOICES = new Set<PermissionChoice>([
  'deny',
  'allow_once',
  'allow_session',
  'allow_permanent',
]);

function denied(
  source: PermissionDecisionSource,
  code: 'DANGEROUS_COMMAND' | 'PERMISSION_DENIED' | 'PERMISSION_CANCELLED' |
    'PERMISSION_UNAVAILABLE' | 'PERMISSION_CONFIG_ERROR' | 'PATH_OUTSIDE_ROOT' |
    'INVALID_ARGUMENTS',
  message: string,
  metadata: Record<string, string | number | boolean | null> = {},
  requestId?: string,
  choice?: PermissionChoice,
): PermissionAuthorization {
  return {
    allowed: false,
    source,
    result: createToolError(code, message, { source, ...metadata }),
    ...(requestId ? { requestId } : {}),
    ...(choice ? { choice } : {}),
  };
}

export class PermissionManager {
  private diagnostics: readonly PermissionDiagnostic[];

  constructor(
    private mode: PermissionMode,
    private readonly sandbox: SandboxPolicy,
    private readonly rules: PermissionRuleEngine,
    private readonly store: PermissionConfigStore,
    diagnostics: readonly PermissionDiagnostic[] = [],
  ) {
    this.diagnostics = [...diagnostics];
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  clearSessionRules(): void {
    this.rules.clearSessionRules();
  }

  getStatus(): PermissionStatus {
    return {
      mode: this.mode,
      ruleCounts: this.rules.countByLayer(),
      diagnostics: [...this.diagnostics],
    };
  }

  async authorize(
    call: ToolCall,
    tool: Tool,
    options: PermissionAuthorizeOptions,
  ): Promise<PermissionAuthorization> {
    if (tool.permission.targetKind === 'command') {
      const rawCommand = call.arguments[tool.permission.targetArgument];
      if (typeof rawCommand === 'string') {
        const dangerous = matchDangerousCommand(rawCommand);
        if (dangerous) {
          return denied(
            'blacklist',
            'DANGEROUS_COMMAND',
            `${dangerous.description}，该限制不能通过权限规则或人工确认放开`,
            { category: dangerous.category },
          );
        }
      }
    }

    let target: string;
    try {
      target = this.sandbox.resolveSubject(tool, call.arguments).target;
    } catch (error) {
      if (isToolFailure(error)) {
        const code = error.code === 'PATH_OUTSIDE_ROOT' ? 'PATH_OUTSIDE_ROOT' : 'INVALID_ARGUMENTS';
        return denied('sandbox', code, error.message);
      }
      return denied('sandbox', 'INVALID_ARGUMENTS', '无法解析工具权限目标');
    }

    const matched = this.rules.match(call.name, target);
    if (matched) {
      const source = RULE_SOURCE[matched.rule.layer];
      if (matched.effect === 'allow') return { allowed: true, source };
      return denied(
        source,
        'PERMISSION_DENIED',
        `权限规则拒绝工具调用: ${matched.rule.expression}`,
        { rule: matched.rule.expression },
      );
    }

    if (this.mode === 'strict') {
      return denied('mode', 'PERMISSION_DENIED', '严格模式拒绝未被规则明确允许的工具调用');
    }
    if (this.mode === 'allow') return { allowed: true, source: 'mode' };
    if (!options.decider) {
      return denied('user', 'PERMISSION_UNAVAILABLE', '当前调用需要用户确认，但没有可用的权限决策器');
    }

    const proposedRule = createExactPermissionExpression(call.name, target);
    const request: PermissionRequest = {
      id: randomUUID(),
      toolCallId: call.id,
      toolName: call.name,
      target,
      proposedRule,
      risk: tool.permission.risk,
      projectRoot: this.store.rootDir,
    };
    options.onRequest(request);

    const choice = await this.waitForDecision(request, options);
    if (choice === 'cancelled') {
      return denied(
        'user',
        'PERMISSION_CANCELLED',
        '等待权限确认时任务已取消',
        { requestId: request.id },
        request.id,
      );
    }
    if (choice === 'unavailable') {
      return denied(
        'user',
        'PERMISSION_UNAVAILABLE',
        '权限决策器未能返回有效决定',
        { requestId: request.id },
        request.id,
      );
    }
    if (choice === 'deny') {
      return denied(
        'user',
        'PERMISSION_DENIED',
        '用户拒绝了当前工具调用',
        { requestId: request.id },
        request.id,
        choice,
      );
    }
    if (choice === 'allow_session') {
      const order = this.rules.countByLayer().session;
      this.rules.addSessionRule(parsePermissionRule(
        { effect: 'allow', expression: proposedRule },
        'session',
        order,
        new Map([[call.name, tool.permission.targetKind]]),
      ));
    }
    if (choice === 'allow_permanent') {
      try {
        const persisted = await this.store.appendLocalAllow(proposedRule);
        this.rules.replaceLayer('local', persisted.rules);
      } catch (error) {
        const message = error instanceof PermissionConfigError ? error.message : String(error);
        return denied(
          'user',
          'PERMISSION_CONFIG_ERROR',
          message,
          { requestId: request.id },
          request.id,
          choice,
        );
      }
    }

    return {
      allowed: true,
      source: 'user',
      requestId: request.id,
      choice,
    };
  }

  private async waitForDecision(
    request: PermissionRequest,
    options: PermissionAuthorizeOptions,
  ): Promise<PermissionChoice | 'cancelled' | 'unavailable'> {
    if (options.signal.aborted) return 'cancelled';

    let onAbort: (() => void) | undefined;
    const cancellation = new Promise<'cancelled'>(resolve => {
      onAbort = () => resolve('cancelled');
      options.signal.addEventListener('abort', onAbort, { once: true });
    });
    const decision = Promise.resolve()
      .then(() => options.decider!(request, options.signal))
      .then(choice => VALID_CHOICES.has(choice) ? choice : 'unavailable' as const)
      .catch(() => 'unavailable' as const);

    try {
      return await Promise.race([decision, cancellation]);
    } finally {
      if (onAbort) options.signal.removeEventListener('abort', onAbort);
    }
  }
}
