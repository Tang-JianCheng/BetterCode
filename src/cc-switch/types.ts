import type { ProviderConfig } from '../config/types.js';

/** cc_switch.claude 线配置覆盖项 */
export interface CcSwitchClaudeConfig {
  name?: string;
  model?: string;
  thinking?: boolean;
  context_window?: number;
}

/** config.yaml 中的 cc_switch 顶层配置 */
export interface CcSwitchConfig {
  enabled: boolean;
  claude?: CcSwitchClaudeConfig;
}

export interface CcSwitchDiagnostic {
  line: 'claude' | 'config';
  severity: 'info' | 'warning' | 'error';
  message: string;
}

export interface CcSwitchImportResult {
  provider?: ProviderConfig;
  diagnostics: CcSwitchDiagnostic[];
}
