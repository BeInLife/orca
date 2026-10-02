import { TERMINAL_QUICK_COMMAND_LONG_PROMPTS_RUNTIME_CAPABILITY } from '../../../shared/terminal-quick-command-capabilities'
import type { TuiAgent } from '../../../shared/tui-agent'
import { runtimeEnvironmentSupportsCapability } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import type { CreateWebRuntimeSessionTerminalArgs } from './web-runtime-session-types'

/**
 * Whether this create asks the host to start the agent clean when its command line cannot carry
 * the prompt. Decided once per create, before any attempt, so a replay sends the same payload.
 */
export async function negotiateLaunchPromptDeferral(
  args: CreateWebRuntimeSessionTerminalArgs,
  environmentId: string
): Promise<boolean> {
  if (args.deferOversizedPrompt !== true || !args.prompt || args.promptDelivery === 'draft') {
    return false
  }
  // Why gate on the host: its create params are strict, so a host predating the field refuses it.
  return await runtimeEnvironmentSupportsCapability(
    environmentId,
    TERMINAL_QUICK_COMMAND_LONG_PROMPTS_RUNTIME_CAPABILITY
  ).catch(() => false)
}

/** `terminal.createAgentSession` params for a fresh agent, before the operation id is stamped. */
export function freshAgentSessionCreateParams(
  args: CreateWebRuntimeSessionTerminalArgs,
  launch: {
    agent: TuiAgent
    agentArgsOverride: string | null | undefined
    keyboardOptions: { terminalKittyKeyboardProtocol?: true }
    deferOversizedPrompt: boolean
  }
) {
  return {
    ...launch.keyboardOptions,
    worktree: toRuntimeWorktreeSelector(args.worktreeId),
    agent: launch.agent,
    ...(args.prompt ? { prompt: args.prompt } : {}),
    ...(args.promptDelivery ? { promptDelivery: args.promptDelivery } : {}),
    ...(launch.deferOversizedPrompt ? { deferOversizedPrompt: true as const } : {}),
    ...(launch.agentArgsOverride !== undefined ? { agentArgs: launch.agentArgsOverride } : {}),
    ...(args.launchPreferences ? { launchPreferences: args.launchPreferences } : {}),
    ...(args.cwd ? { startupCwd: args.cwd } : {}),
    ...(args.viewMode ? { viewMode: args.viewMode } : {}),
    presentation: 'background' as const
  }
}

/** The terminal a deferring host started without the prompt, which this caller still owes it. */
export function deferredLaunchPromptOf(
  environmentId: string,
  terminal: { handle?: string; startupPromptDeferred?: true }
): { environmentId: string; terminal: string } | undefined {
  return terminal.startupPromptDeferred && terminal.handle
    ? { environmentId, terminal: terminal.handle }
    : undefined
}
