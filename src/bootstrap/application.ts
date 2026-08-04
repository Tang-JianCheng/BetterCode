import path from 'node:path';
import os from 'node:os';
import { loadCcSwitchProviders } from '../cc-switch/loader.js';
import type { CcSwitchDiagnostic } from '../cc-switch/types.js';
import { loadConfig } from '../config/loader.js';
import { resolveProvider } from '../config/resolver.js';
import type { AppConfig, ProviderConfig } from '../config/types.js';
import { createProvider } from '../provider/factory.js';
import type { LLMProvider } from '../provider/types.js';
import { createCoreToolRegistry } from '../tool/factory.js';
import type { ToolRegistry } from '../tool/registry.js';
import { createPermissionManager, createPermissionManagerFactory } from '../permission/factory.js';
import type { PermissionMode } from '../permission/types.js';
import { createMcpManager } from '../mcp/factory.js';
import type { McpManager } from '../mcp/manager.js';
import type { McpStartupStatus } from '../mcp/types.js';
import { AgentTool } from '../subagent/agent-tool.js';
import { AgentDefinitionManager } from '../subagent/definition-manager.js';
import { SubAgentTaskManager } from '../subagent/task-manager.js';
import { SubAgentResultInbox } from '../subagent/result-inbox.js';
import { SubAgentRunner } from '../subagent/runner.js';
import { SubAgentCoordinator } from '../subagent/coordinator.js';
import { resolveSubAgentOptions } from '../subagent/types.js';
import { SkillManager } from '../skill/manager.js';
import { SkillRunner } from '../skill/runner.js';
import { createDefaultCommandRegistry } from '../command/builtins.js';
import { HookConfigLoader } from '../hook/config-loader.js';
import { compileHooks } from '../hook/compiler.js';
import { DefaultHookActionExecutor } from '../hook/action-executor.js';
import { JsonlHookLogger } from '../hook/logger.js';
import { HookManager } from '../hook/manager.js';
import { loadInstructions } from '../memory/instructions.js';
import { MemoryManager } from '../memory/manager.js';
import { ChatManager } from '../chat/manager.js';
import { resolveWorktreeOptions } from '../worktree/types.js';
import { WorktreePathGuard } from '../worktree/path-guard.js';
import { WorktreeMetadataStore } from '../worktree/metadata-store.js';
import { GitWorktreeClient } from '../worktree/git-client.js';
import { WorktreeInitializer } from '../worktree/initializer.js';
import { WorktreeManager } from '../worktree/manager.js';
import { WorktreeCleanupScheduler } from '../worktree/cleanup.js';
import { ProjectRuntimeFactory } from '../runtime/project-runtime.js';
import { TeamPathGuard } from '../team/path-guard.js';
import { TeamRepository } from '../team/repository.js';
import { TeamTaskService } from '../team/task-service.js';
import { TeamMailboxService } from '../team/mailbox-service.js';
import { TeamApprovalService } from '../team/approval-service.js';
import { MemberContextStore } from '../team/context-store.js';
import { OperationJournal } from '../team/operation-journal.js';
import { TeamIntegrationGit } from '../team/integration-git.js';
import { ShellIntegrationValidationRunner, TeamIntegrationManager } from '../team/integration-manager.js';
import { TeamCoordinator } from '../team/coordinator.js';
import { TeamLeadInbox } from '../team/lead-inbox.js';
import { TeamMemberRuntimeResolver } from '../team/member-runtime.js';
import { TeamMemberRunner } from '../team/member-runner.js';
import { TeamActorContext } from '../team/actor-context.js';
import { TeamWorkerHost } from '../team/worker-host.js';
import { readWorkerDescriptor, type TeamWorkerDescriptor } from '../team/worker-entry.js';
import { createTeamTools } from '../team/tools.js';
import type { TeamToolHandler } from '../team/tools.js';
import { TeamError } from '../team/errors.js';
import { resolveTeamOptions, type MemberActor } from '../team/types.js';
import { TeamBackendManager } from '../team/backend/manager.js';
import { TeamProcessRunner } from '../team/backend/process-runner.js';
import { TmuxBackend } from '../team/backend/tmux.js';
import { WezTermBackend } from '../team/backend/wezterm.js';
import { ITerm2Backend } from '../team/backend/iterm2.js';
import { ConfiguredTerminalBackend } from '../team/backend/configured.js';
import { CoroutineBackend } from '../team/backend/coroutine.js';
import type { SpawnMemberInput } from '../team/backend/types.js';
import { CoordinatorShellPolicy } from '../team/coordinator-shell.js';

export interface ApplicationArguments {
  providerName?: string;
  configPath: string;
  permissionMode: PermissionMode;
  workerDescriptorPath?: string;
}

export interface BetterCodeApplication {
  readonly provider: LLMProvider;
  readonly chatManager?: ChatManager;
  readonly skillManager: SkillManager;
  readonly mcpStatus: McpStartupStatus;
  readonly agentDiagnostics: ReturnType<AgentDefinitionManager['getSnapshot']>['diagnostics'];
  readonly ccSwitchStatus: readonly CcSwitchDiagnostic[];
  readonly workerHost?: TeamWorkerHost;
  readonly workerDescriptor?: TeamWorkerDescriptor;
  close(): Promise<void>;
}

export interface CreateApplicationOptions extends ApplicationArguments {
  rootDir?: string;
  userHome?: string;
  environment?: NodeJS.ProcessEnv;
}

type CloseAction = () => void | Promise<void>;

export class ApplicationLifecycle {
  private readonly actions: CloseAction[] = [];
  private closed = false;

  add(action: CloseAction): void {
    if (this.closed) throw new Error('应用生命周期已经关闭');
    this.actions.push(action);
  }

  async close(onError: (error: unknown) => void = () => {}): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const action of this.actions.reverse()) {
      try {
        await action();
      } catch (error) {
        onError(error);
      }
    }
  }
}

export function parseApplicationArguments(argv: readonly string[]): ApplicationArguments {
  let providerName: string | undefined;
  let configPath = './config.yaml';
  let permissionMode: PermissionMode = 'default';
  let workerDescriptorPath: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (token === '--provider' || token === '-p') {
      providerName = requiredValue(token, value);
      index += 1;
    } else if (token === '--config' || token === '-c') {
      configPath = requiredValue(token, value);
      index += 1;
    } else if (token === '--permission-mode') {
      const mode = requiredValue(token, value);
      if (!isPermissionMode(mode)) throw new Error('permission-mode 必须是 strict、default 或 allow');
      permissionMode = mode;
      index += 1;
    } else if (token === '--team-worker') {
      workerDescriptorPath = requiredValue(token, value);
      index += 1;
    } else {
      throw new Error(`未知参数: ${token}`);
    }
  }
  return {
    ...(providerName ? { providerName } : {}),
    configPath,
    permissionMode,
    ...(workerDescriptorPath ? { workerDescriptorPath } : {}),
  };
}

export function resolveWorkerProvider(config: AppConfig, requestedName?: string): ProviderConfig {
  if (requestedName) {
    const selected = config.providers.find(provider => provider.name === requestedName);
    if (!selected) throw new Error(`Worker 找不到指定 Provider: ${requestedName}`);
    return selected;
  }
  const defaults = config.providers.filter(provider => provider.default);
  if (defaults.length === 1) return defaults[0];
  if (config.providers.length === 1) return config.providers[0];
  throw new Error('Worker 模式不能交互选择 Provider，请在配置中设置唯一 default Provider');
}

export function registerTeamDispatchTools(registry: ToolRegistry, handler: TeamToolHandler): void {
  for (const tool of createTeamTools(handler)) registry.register(tool);
}

export async function createApplication(options: CreateApplicationOptions): Promise<BetterCodeApplication> {
  const lifecycle = new ApplicationLifecycle();
  let built: BetterCodeApplication | undefined;
  try {
    const environment = options.environment ?? process.env;
    const userHome = options.userHome ?? os.homedir();
    const bootstrapGuard = new TeamPathGuard(options.userHome);
    const bootstrapRepository = new TeamRepository(bootstrapGuard);
    const workerDescriptor = options.workerDescriptorPath
      ? readWorkerDescriptor(options.workerDescriptorPath, bootstrapGuard, bootstrapRepository)
      : undefined;
    const rootDir = path.resolve(workerDescriptor?.projectRoot ?? options.rootDir ?? process.cwd());
    const configPath = path.resolve(rootDir, workerDescriptor?.configPath ?? options.configPath);
    const appConfig = loadConfig(configPath);
    const ccSwitchStatus: CcSwitchDiagnostic[] = [];
    if (!workerDescriptor) {
      const imported = loadCcSwitchProviders(appConfig, {
        userHome,
        environment,
      });
      ccSwitchStatus.push(...imported.diagnostics);
    }
    const selectedConfig = workerDescriptor
      ? resolveWorkerProvider(appConfig, options.providerName)
      : await resolveProvider(appConfig, options.providerName);
    const provider = createProvider(selectedConfig);
    const providerCache = new Map<string, LLMProvider>([[selectedConfig.name, provider]]);
    const providerResolver = {
      has: (name: string) => appConfig.providers.some(item => item.name === name),
      resolve: (name: string) => {
        const cached = providerCache.get(name);
        if (cached) return cached;
        const config = appConfig.providers.find(item => item.name === name);
        if (!config) throw new Error(`未找到角色指定的 Provider 配置: ${name}`);
        const created = createProvider(config);
        providerCache.set(name, created);
        return created;
      },
    };

    const toolRegistry = createCoreToolRegistry(rootDir);
    const mcpManager = createMcpManager(rootDir, { userHome: options.userHome });
    lifecycle.add(() => closeMcp(mcpManager));
    const mcpStatus = await mcpManager.initialize(toolRegistry);
    toolRegistry.register(new AgentTool(), { system: true });

    const teamGuard = workerDescriptor ? bootstrapGuard : new TeamPathGuard(options.userHome);
    const teamRepository = workerDescriptor ? bootstrapRepository : new TeamRepository(teamGuard);
    const actorContext = new TeamActorContext();
    let teamCoordinator: TeamCoordinator | undefined;
    let chatManager: ChatManager | undefined;
    const fixedWorkerActor: MemberActor | undefined = workerDescriptor ? {
      kind: 'member',
      team: workerDescriptor.team,
      member: workerDescriptor.member,
      generation: workerDescriptor.generation,
    } : undefined;
    const teamHandler = {
      execute: async (...args: Parameters<ReturnType<TeamCoordinator['toolHandler']>['execute']>) => {
        if (!teamCoordinator) throw new TeamError('TEAM_STATE_ERROR', '团队协调器尚未初始化');
        return teamCoordinator.toolHandler(() =>
          actorContext.current() ?? fixedWorkerActor ?? teamCoordinator?.leadActor(chatManager?.getSessionId() ?? ''),
        ).execute(...args);
      },
    };
    registerTeamDispatchTools(toolRegistry, teamHandler);

    const commandTokens = createDefaultCommandRegistry()
      .list({ includeHidden: true })
      .flatMap(command => [command.name, ...command.aliases]);
    const skillManager = new SkillManager(toolRegistry, rootDir, {
      providerNames: appConfig.providers.map(item => item.name),
      reservedCommandNames: commandTokens,
      ...(options.userHome ? { userHome: options.userHome } : {}),
    });
    skillManager.initialize();
    skillManager.startWatching();
    lifecycle.add(() => skillManager.close());

    const resolvedSubagents = resolveSubAgentOptions(appConfig.subagents);
    const agentDefinitionManager = new AgentDefinitionManager(toolRegistry, rootDir, {
      modelAliases: appConfig.agent_models,
      providerNames: appConfig.providers.map(item => item.name),
      deniedTools: resolvedSubagents.deniedTools,
      ...(options.userHome ? { userHome: options.userHome } : {}),
    });
    const agentSnapshot = agentDefinitionManager.initialize();
    agentDefinitionManager.startWatching();
    lifecycle.add(() => agentDefinitionManager.close());
    const unsubscribeSkillDefinitions = skillManager.subscribe(() => agentDefinitionManager.reload());
    lifecycle.add(unsubscribeSkillDefinitions);

    const permissionManager = createPermissionManager(toolRegistry, options.permissionMode, { userHome: options.userHome });
    const permissionFactory = createPermissionManagerFactory(toolRegistry, { userHome: options.userHome });
    const projectRuntimeFactory = new ProjectRuntimeFactory(toolRegistry, permissionFactory, { userHome: options.userHome });
    const worktree = await createWorktreeServices(rootDir, appConfig, lifecycle);
    const repositoryIdentity = worktree.identity ?? await inspectRepository(rootDir);
    const resolvedTeams = resolveTeamOptions(appConfig.teams, environment);
    const tasks = new TeamTaskService(teamGuard, teamRepository);
    let mailbox: TeamMailboxService;
    mailbox = new TeamMailboxService(teamGuard, teamRepository, resolvedTeams.mailbox, {
      wake: (team, member) => teamCoordinator?.wake(team, member) ?? Promise.reject(new Error('团队协调器尚未初始化')),
    });
    const approvals = new TeamApprovalService(teamGuard, teamRepository, tasks, mailbox);
    const contexts = new MemberContextStore(teamGuard);
    const runtimeResolver = new TeamMemberRuntimeResolver(toolRegistry, agentDefinitionManager, providerResolver);
    const memberRunner = new TeamMemberRunner({
      runtimeFactory: projectRuntimeFactory,
      runtimeResolver,
      repository: teamRepository,
      tasks,
      mailbox,
      approvals,
      contexts,
      journal: (team, member) => new OperationJournal(teamGuard, team, member, resolvedTeams.mailbox),
      ...(worktree.manager ? { worktrees: worktree.manager } : {}),
      actorContext,
    });
    const workerHosts = new Map<string, TeamWorkerHost>();
    const createHost = (descriptor: TeamWorkerDescriptor, paneId?: string) => new TeamWorkerHost({
      descriptor,
      guard: teamGuard,
      repository: teamRepository,
      mailbox,
      runtime: resolvedTeams.runtime,
      ...(paneId ? { paneId } : {}),
      operation: {
        runOnce: async signal => {
          const member = teamRepository.getMember(descriptor.team, descriptor.member);
          if (!member?.currentTaskId) return;
          await memberRunner.run({
            team: descriptor.team,
            member: descriptor.member,
            taskId: member.currentTaskId,
            provider,
            signal,
          });
        },
      },
    });
    const coroutine = new CoroutineBackend({
      run: async (input: SpawnMemberInput, signal: AbortSignal) => {
        const descriptor = readWorkerDescriptor(input.context.workerDescriptor, teamGuard, teamRepository);
        const host = createHost(descriptor);
        workerHosts.set(input.context.workerDescriptor, host);
        try {
          await host.start(signal);
        } finally {
          workerHosts.delete(input.context.workerDescriptor);
        }
      },
      wake: async input => {
        const host = workerHosts.get(input.context.workerDescriptor);
        if (!host) throw new TeamError('TEAM_BACKEND_UNAVAILABLE', '协程成员 Worker 尚未运行');
        host.wake();
      },
    });
    const processRunner = new TeamProcessRunner();
    const backends = new TeamBackendManager([
      new TmuxBackend(processRunner),
      new WezTermBackend(processRunner),
      new ITerm2Backend(processRunner),
      ...resolvedTeams.customTerminals.map(config => new ConfiguredTerminalBackend(config, processRunner)),
      coroutine,
    ]);
    const unavailableIntegrations = {
      start: async () => { throw new TeamError('TEAM_INTEGRATION_ERROR', '当前项目不支持 Git Worktree 集成'); },
      status: () => { throw new TeamError('TEAM_INTEGRATION_ERROR', '当前项目不支持 Git Worktree 集成'); },
      continue: async () => { throw new TeamError('TEAM_INTEGRATION_ERROR', '当前项目不支持 Git Worktree 集成'); },
      abort: async () => { throw new TeamError('TEAM_INTEGRATION_ERROR', '当前项目不支持 Git Worktree 集成'); },
    };
    const integrations = worktree.manager
      ? new TeamIntegrationManager(
          teamGuard,
          teamRepository,
          tasks,
          worktree.manager,
          new TeamIntegrationGit(processRunner),
          resolvedTeams.integration,
          new ShellIntegrationValidationRunner(),
        )
      : unavailableIntegrations;
    const coordinatorShell = new CoordinatorShellPolicy(() => ({
      leadRoot: rootDir,
      memberRoots: teamRepository.list()
        .flatMap(snapshot => snapshot.members.map(member => member.rootDir))
        .filter(memberRoot => memberRoot !== rootDir),
    }));
    teamCoordinator = new TeamCoordinator({
      projectRoot: rootDir,
      repositoryId: repositoryIdentity.repositoryId,
      configPath,
      resolved: resolvedTeams,
      definitions: agentDefinitionManager,
      repository: teamRepository,
      tasks,
      mailbox,
      approvals,
      integrations,
      backends,
      guard: teamGuard,
      ...(worktree.manager ? { worktrees: worktree.manager } : {}),
      authorizeCoordinatorCommand: (command, cwd) => coordinatorShell.authorize(command, cwd),
    });
    lifecycle.add(() => teamCoordinator?.close());
    const leadInbox = new TeamLeadInbox(mailbox);

    let workerHost: TeamWorkerHost | undefined;
    if (workerDescriptor) {
      workerHost = createHost(workerDescriptor, environment.BETTERCODE_TEAM_PANE_ID);
    } else {
      let hookManager: HookManager | undefined;
      let subAgentCoordinator: SubAgentCoordinator | undefined;
      const taskManager = new SubAgentTaskManager(
        resolvedSubagents.foregroundTimeoutMs,
        resolvedSubagents.retainedTasks,
      );
      const resultInbox = new SubAgentResultInbox();
      const subAgentRunner = new SubAgentRunner(toolRegistry, permissionFactory, {
        hookManager: () => hookManager,
        skillManager,
        projectRuntimeFactory,
        ...(worktree.manager ? { worktreeManager: worktree.manager } : {}),
      });
      subAgentCoordinator = new SubAgentCoordinator(
        toolRegistry,
        agentDefinitionManager,
        providerResolver,
        subAgentRunner,
        taskManager,
        resultInbox,
        resolvedSubagents,
        { defaultProvider: () => provider },
      );
      lifecycle.add(() => subAgentCoordinator?.close());
      const loadedHooks = new HookConfigLoader(rootDir, { userHome: options.userHome }).load();
      hookManager = new HookManager(
        rootDir,
        compileHooks(loadedHooks),
        new DefaultHookActionExecutor(rootDir, {
          runHookAgent: input => subAgentCoordinator!.runHookAgent(input),
        }),
        new JsonlHookLogger(rootDir, loadedHooks.secretValues),
      );
      lifecycle.add(() => hookManager?.close());
      const supplemental = {
        customInstructions: loadInstructions(rootDir, { userHome: options.userHome }),
        longTermMemory: new MemoryManager(rootDir, { userHome: options.userHome }).buildSystemReminder(),
      };
      const skillRunner = new SkillRunner(
        toolRegistry,
        permissionManager,
        skillManager,
        providerResolver,
        { supplemental, hooks: hookManager },
      );
      chatManager = new ChatManager(
        toolRegistry,
        permissionManager,
        {},
        supplemental,
        {},
        { autoExtract: true, userHome: options.userHome },
        { manager: skillManager, runner: skillRunner },
        hookManager,
        { coordinator: subAgentCoordinator, inbox: resultInbox },
        { coordinator: teamCoordinator, inbox: leadInbox },
      );
      lifecycle.add(() => chatManager?.close());
      await hookManager.startSystem(chatManager.getSessionId(), 'startup');
      await hookManager.startSession(chatManager.getSessionId(), 'startup');
    }

    built = {
      provider,
      chatManager,
      skillManager,
      mcpStatus,
      agentDiagnostics: agentSnapshot.diagnostics,
      ccSwitchStatus,
      workerHost,
      workerDescriptor,
      close: () => lifecycle.close(error => {
        console.error(`[应用清理] ${error instanceof Error ? error.message : String(error)}`);
      }),
    };
    return built;
  } catch (error) {
    await lifecycle.close(() => {});
    throw error;
  }
}

async function createWorktreeServices(
  rootDir: string,
  appConfig: AppConfig,
  lifecycle: ApplicationLifecycle,
): Promise<{
  manager?: WorktreeManager;
  identity?: Awaited<ReturnType<GitWorktreeClient['inspectRepository']>>;
}> {
  try {
    const resolved = resolveWorktreeOptions(appConfig.worktrees);
    const guard = new WorktreePathGuard(rootDir);
    const metadata = new WorktreeMetadataStore(guard);
    const git = new GitWorktreeClient();
    const identity = await git.inspectRepository(rootDir);
    const manager = new WorktreeManager(guard, metadata, git, new WorktreeInitializer(guard, git, resolved));
    await manager.initialize();
    lifecycle.add(() => manager.close());
    const cleanup = new WorktreeCleanupScheduler(manager, metadata, resolved.retentionMs, resolved.cleanupIntervalMs);
    cleanup.start();
    lifecycle.add(() => cleanup.close());
    return { manager, identity };
  } catch (error) {
    console.error(`[Worktree] 隔离能力不可用: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

async function inspectRepository(rootDir: string) {
  try {
    return await new GitWorktreeClient().inspectRepository(rootDir);
  } catch {
    return { mainRoot: rootDir, commonGitDir: rootDir, repositoryId: rootDir };
  }
}

async function closeMcp(manager: McpManager): Promise<void> {
  const diagnostics = await manager.close();
  for (const diagnostic of diagnostics) {
    const source = diagnostic.serverName ? ` ${diagnostic.serverName}` : '';
    console.error(`[MCP${source}] ${diagnostic.message}`);
  }
}

function requiredValue(option: string, value: string | undefined): string {
  if (!value || value.startsWith('-')) throw new Error(`${option} 缺少参数`);
  return value;
}

function isPermissionMode(value: string): value is PermissionMode {
  return value === 'strict' || value === 'default' || value === 'allow';
}
