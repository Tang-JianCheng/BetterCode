import type {
  PermissionRule,
  PermissionRuleLayer,
  RuleMatch,
} from './types.js';

const LAYER_ORDER: readonly PermissionRuleLayer[] = ['session', 'local', 'project', 'user'];

const KIND_SCORE = {
  tool: 1,
  glob: 2,
  exact: 3,
} as const;

function compareRules(left: PermissionRule, right: PermissionRule): number {
  const kindDifference = KIND_SCORE[right.patternKind] - KIND_SCORE[left.patternKind];
  if (kindDifference !== 0) return kindDifference;
  const literalDifference = right.literalLength - left.literalLength;
  if (literalDifference !== 0) return literalDifference;
  return right.order - left.order;
}

export class PermissionRuleEngine {
  private readonly layers: Record<PermissionRuleLayer, PermissionRule[]> = {
    user: [],
    project: [],
    local: [],
    session: [],
  };

  replaceLayer(layer: PermissionRuleLayer, rules: readonly PermissionRule[]): void {
    this.layers[layer] = [...rules];
  }

  addSessionRule(rule: PermissionRule): void {
    this.layers.session.push(rule);
  }

  clearSessionRules(): void {
    this.layers.session = [];
  }

  match(toolName: string, target: string): RuleMatch | undefined {
    for (const layer of LAYER_ORDER) {
      const matches = this.layers[layer]
        .filter(rule => rule.toolName === toolName && rule.matches(target))
        .sort(compareRules);
      const rule = matches[0];
      if (rule) return { effect: rule.effect, rule };
    }
    return undefined;
  }

  countByLayer(): Readonly<Record<PermissionRuleLayer, number>> {
    return {
      user: this.layers.user.length,
      project: this.layers.project.length,
      local: this.layers.local.length,
      session: this.layers.session.length,
    };
  }
}
