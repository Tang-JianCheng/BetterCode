import type { ToolRegistry } from '../tool/registry.js';
import { createMcpToolName } from './naming.js';
import { redactMcpMessage } from './redaction.js';
import { McpSdkSession } from './sdk-session.js';
import { McpToolAdapter } from './tool-adapter.js';
import {
  McpStartupError,
  type LoadedMcpConfig,
  type McpDiagnostic,
  type McpRemoteTool,
  type McpServerConfig,
  type McpServerToolListing,
  type McpSession,
  type McpSessionFactory,
  type McpSessionOptions,
  type McpStartupStatus,
} from './types.js';

export interface McpManagerOptions {
  sessionFactory?: McpSessionFactory;
  connectTimeoutMs?: number;
  discoveryTimeoutMs?: number;
  callTimeoutMs?: number;
  maxStderrBytes?: number;
}

interface DiscoveredServer {
  config: McpServerConfig;
  session: McpSession;
  tools: McpRemoteTool[];
}

const DEFAULT_OPTIONS: Omit<McpSessionOptions, 'rootDir'> = {
  // 连接/发现默认放宽到 60s：stdio Server 首次 npx 下载、远程 Server 握手都可能超过 10s。
  connectTimeoutMs: 60_000,
  discoveryTimeoutMs: 60_000,
  callTimeoutMs: 60_000,
  maxStderrBytes: 8_192,
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class McpManager {
  private readonly sessionFactory: McpSessionFactory;
  private readonly sessionOptions: McpSessionOptions;
  private readonly sessions = new Map<string, McpSession>();
  private readonly serverTools = new Map<string, McpServerToolListing>();
  private status: McpStartupStatus;
  private initializePromise?: Promise<McpStartupStatus>;
  private closePromise?: Promise<readonly McpDiagnostic[]>;
  private closed = false;

  constructor(
    private readonly rootDir: string,
    private readonly loaded: LoadedMcpConfig,
    options: McpManagerOptions = {},
  ) {
    this.sessionOptions = {
      rootDir,
      connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_OPTIONS.connectTimeoutMs,
      discoveryTimeoutMs: options.discoveryTimeoutMs ?? DEFAULT_OPTIONS.discoveryTimeoutMs,
      callTimeoutMs: options.callTimeoutMs ?? DEFAULT_OPTIONS.callTimeoutMs,
      maxStderrBytes: options.maxStderrBytes ?? DEFAULT_OPTIONS.maxStderrBytes,
    };
    this.sessionFactory = options.sessionFactory
      ?? ((config, sessionOptions) => new McpSdkSession(config, sessionOptions));
    this.status = {
      configuredServers: loaded.servers.length,
      connectedServers: 0,
      registeredTools: 0,
      diagnostics: [...loaded.diagnostics],
    };
  }

  initialize(registry: ToolRegistry, signal?: AbortSignal): Promise<McpStartupStatus> {
    if (this.initializePromise) return this.initializePromise;
    if (this.closed) return Promise.resolve(this.getStatus());
    this.initializePromise = this.initializeInternal(registry, signal);
    return this.initializePromise;
  }

  getStatus(): McpStartupStatus {
    return {
      ...this.status,
      diagnostics: [...this.status.diagnostics],
    };
  }

  /** /mcp 命令数据源：按名称排序的 Server 及工具清单。 */
  listServerTools(): readonly McpServerToolListing[] {
    return [...this.serverTools.values()]
      .sort((left, right) => compareText(left.name, right.name))
      .map(item => ({
        ...item,
        tools: [...item.tools].sort((left, right) => compareText(left.name, right.name)),
      }));
  }

  close(): Promise<readonly McpDiagnostic[]> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeInternal();
    return this.closePromise;
  }

  private async initializeInternal(
    registry: ToolRegistry,
    signal?: AbortSignal,
  ): Promise<McpStartupStatus> {
    const settled = await Promise.all(this.loaded.servers.map(config => (
      this.discoverServer(config, signal)
    )));
    const discovered = settled.filter((item): item is DiscoveredServer => item !== undefined);
    discovered.sort((left, right) => compareText(left.config.name, right.config.name));
    for (const item of discovered) this.sessions.set(item.config.name, item.session);

    // 记录每个 Server 的工具清单（含失败 server，connected=false），供 /mcp 展示。
    const byName = new Map(discovered.map(item => [item.config.name, item] as const));
    for (const config of this.loaded.servers) {
      const item = byName.get(config.name);
      this.serverTools.set(config.name, {
        name: config.name,
        transport: config.transport,
        connected: item !== undefined,
        tools: item ? [...item.tools] : [],
      });
    }

    let registeredTools = 0;
    for (const item of discovered) {
      const tools = [...item.tools].sort((left, right) => compareText(left.name, right.name));
      for (const remote of tools) {
        const localName = createMcpToolName(item.config.name, remote.name);
        if (registry.get(localName)) {
          this.addDiagnostic({
            code: 'TOOL_NAME_CONFLICT',
            message: `MCP 工具本地名称冲突: ${localName}`,
            serverName: item.config.name,
            toolName: remote.name,
          });
          continue;
        }
        try {
          registry.register(new McpToolAdapter(localName, item.config.name, remote, item.session));
          registeredTools += 1;
        } catch (error) {
          this.addDiagnostic({
            code: registry.get(localName) ? 'TOOL_NAME_CONFLICT' : 'TOOL_SCHEMA_ERROR',
            message: redactMcpMessage(
              `MCP 工具注册失败: ${error instanceof Error ? error.message : String(error)}`,
              item.config.secretValues,
            ),
            serverName: item.config.name,
            toolName: remote.name,
          });
        }
      }
    }
    this.status = {
      configuredServers: this.loaded.servers.length,
      connectedServers: discovered.length,
      registeredTools,
      diagnostics: [...this.status.diagnostics],
    };
    return this.getStatus();
  }

  private async discoverServer(
    config: McpServerConfig,
    signal?: AbortSignal,
  ): Promise<DiscoveredServer | undefined> {
    let session: McpSession;
    try {
      // per-server timeout_ms 覆盖全局连接/发现超时（例如首次下载慢的 stdio Server）
      session = this.sessionFactory(
        config,
        config.timeoutMs === undefined
          ? this.sessionOptions
          : { ...this.sessionOptions, connectTimeoutMs: config.timeoutMs, discoveryTimeoutMs: config.timeoutMs },
      );
    } catch (error) {
      this.addDiagnostic({
        code: 'TRANSPORT_ERROR',
        message: this.safeMessage(error, config),
        serverName: config.name,
      });
      return undefined;
    }
    try {
      await session.connect(signal);
    } catch (error) {
      this.addDiagnostic({
        code: error instanceof McpStartupError ? error.diagnosticCode : 'INITIALIZE_ERROR',
        message: this.safeMessage(error, config),
        serverName: config.name,
      });
      await this.closeFailedSession(session, config);
      return undefined;
    }
    try {
      const tools = await session.listTools(signal);
      return { config, session, tools };
    } catch (error) {
      this.addDiagnostic({
        code: 'DISCOVERY_ERROR',
        message: this.safeMessage(error, config),
        serverName: config.name,
      });
      await this.closeFailedSession(session, config);
      return undefined;
    }
  }

  private async closeFailedSession(session: McpSession, config: McpServerConfig): Promise<void> {
    try {
      await session.close();
    } catch (error) {
      this.addDiagnostic({
        code: 'CLOSE_ERROR',
        message: this.safeMessage(error, config),
        serverName: config.name,
      });
    }
  }

  private async closeInternal(): Promise<readonly McpDiagnostic[]> {
    this.closed = true;
    await this.initializePromise;
    const diagnostics: McpDiagnostic[] = [];
    const entries = [...this.sessions.entries()];
    const settled = await Promise.allSettled(entries.map(([, session]) => session.close()));
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') return;
      const [serverName] = entries[index];
      const config = this.loaded.servers.find(item => item.name === serverName);
      diagnostics.push({
        code: 'CLOSE_ERROR',
        message: redactMcpMessage(
          result.reason instanceof Error ? result.reason.message : String(result.reason),
          config?.secretValues ?? this.loaded.secretValues,
        ),
        serverName,
      });
    });
    if (diagnostics.length > 0) {
      this.status = {
        ...this.status,
        diagnostics: [...this.status.diagnostics, ...diagnostics],
      };
    }
    return diagnostics;
  }

  private safeMessage(error: unknown, config: McpServerConfig): string {
    return redactMcpMessage(
      error instanceof Error ? error.message : String(error),
      [...this.loaded.secretValues, ...config.secretValues],
    );
  }

  private addDiagnostic(diagnostic: McpDiagnostic): void {
    this.status = {
      ...this.status,
      diagnostics: [...this.status.diagnostics, diagnostic],
    };
  }
}
