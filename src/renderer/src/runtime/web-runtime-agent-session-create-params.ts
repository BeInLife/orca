import type { AgentSessionLaunchPromptReceipt } from '../../../shared/agent-session-host-authority'
import { LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../../../shared/terminal-quick-commands'
import type { TuiAgent } from '../../../shared/tui-agent'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import { toHostSessionTabId } from './web-terminal-surface-id'
import type {
  CreateWebRuntimeSessionTerminalArgs,
  CreatedWebRuntimeSessionTerminal
} from './web-runtime-session-types'

/** `terminal.createAgentSession` params for a fresh agent, before the operation id is stamped. */
export function freshAgentSessionCreateParams(
  args: CreateWebRuntimeSessionTerminalArgs,
  launch: {
    agent: TuiAgent
    agentArgsOverride: string | null | undefined
    keyboardOptions: { terminalKittyKeyboardProtocol?: true }
  }
) {
  return {
    ...launch.keyboardOptions,
    worktree: toRuntimeWorktreeSelector(args.worktreeId),
    agent: launch.agent,
    ...(args.prompt ? { prompt: args.prompt } : {}),
    ...(args.promptDelivery ? { promptDelivery: args.promptDelivery } : {}),
    ...(launch.agentArgsOverride !== undefined ? { agentArgs: launch.agentArgsOverride } : {}),
    ...(args.launchPreferences ? { launchPreferences: args.launchPreferences } : {}),
    ...(args.cwd ? { startupCwd: args.cwd } : {}),
    ...(args.viewMode ? { viewMode: args.viewMode } : {}),
    presentation: 'background' as const
  }
}

/**
 * The launch a legacy `session.tabs.createTerminal` should run. That route builds no plan on the
 * host, so a prompt longer than older builds could store must not ride the client-built command.
 * TEMPORARY: remove with the 6,000-character withholding, once no supported release lacks
 * `terminal.quick-commands.long-prompts.v1` and host agent-session creates.
 */
export function legacyAgentLaunchFor(args: CreateWebRuntimeSessionTerminalArgs): {
  command: CreateWebRuntimeSessionTerminalArgs['command']
  env: CreateWebRuntimeSessionTerminalArgs['env']
  startupCommandDelivery: CreateWebRuntimeSessionTerminalArgs['startupCommandDelivery']
  clientOwesLaunchPrompt: boolean
} {
  const clean = args.legacyCleanLaunch
  if (clean && (args.prompt?.length ?? 0) > LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH) {
    return {
      command: clean.command,
      env: clean.env,
      startupCommandDelivery: clean.startupCommandDelivery,
      clientOwesLaunchPrompt: true
    }
  }
  return {
    command: args.command,
    env: args.env,
    startupCommandDelivery: args.startupCommandDelivery,
    clientOwesLaunchPrompt: false
  }
}

/** What the caller still owes, or watches, for a created terminal's launch prompt. */
export function launchPromptFollowUpOf(
  environmentId: string,
  terminal: { handle?: string },
  launchPrompt: AgentSessionLaunchPromptReceipt | undefined,
  clientOwesLaunchPrompt: boolean
): CreatedWebRuntimeSessionTerminal['launchPromptFollowUp'] {
  if (clientOwesLaunchPrompt) {
    return { kind: 'client-paste' }
  }
  if (launchPrompt?.outcome === 'not-delivered') {
    return { kind: 'client-paste' }
  }
  return launchPrompt?.outcome === 'pending' && terminal.handle
    ? { kind: 'host-delivering', environmentId, terminal: terminal.handle }
    : undefined
}

/** `session.tabs.createTerminal` params for an agent launch on a host without agent-session creates. */
export function legacyAgentCreateTerminalParams(
  args: CreateWebRuntimeSessionTerminalArgs,
  launch: ReturnType<typeof legacyAgentLaunchFor>
) {
  return {
    worktree: toRuntimeWorktreeSelector(args.worktreeId),
    afterTabId: args.afterTabId ? toHostSessionTabId(args.afterTabId) : undefined,
    targetGroupId: args.targetGroupId,
    command: launch.command,
    cwd: args.cwd,
    ...(launch.env ? { env: launch.env } : {}),
    ...(args.envToDelete ? { envToDelete: args.envToDelete } : {}),
    startupCommandDelivery: launch.startupCommandDelivery,
    ...(args.launchConfig ? { launchConfig: args.launchConfig } : {}),
    ...(args.launchToken ? { launchToken: args.launchToken } : {}),
    ...(args.agent ? { agent: args.agent } : {}),
    ...(args.launchAgent ? { launchAgent: args.launchAgent } : {}),
    ...(args.viewMode ? { viewMode: args.viewMode } : {}),
    // Why: old hosts understand activate:false; new hosts use select/navigation for caller-local focus.
    activate: false,
    select: args.activate !== false,
    navigation: 'caller' as const
  }
}
