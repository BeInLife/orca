import type { AppState } from '@/store/types'
import { isWebRuntimeSessionActive } from '@/runtime/web-runtime-session'
import { buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import { agentPromptRidesLaunchCommand } from '../../../shared/tui-agent-startup'
import type { TuiAgent } from '../../../shared/tui-agent'
import type { CreateWebRuntimeSessionTerminalArgs } from '@/runtime/web-runtime-session-types'
import { lastVerifiedRuntimeStatus } from '../../../shared/runtime-host-status'
import { LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../../../shared/terminal-quick-commands'
import { TERMINAL_QUICK_COMMAND_LONG_PROMPTS_RUNTIME_CAPABILITY } from '../../../shared/terminal-quick-command-capabilities'

type LaunchPromptDelivery = 'auto-submit' | 'draft' | 'submit-after-ready'

/**
 * Whether a paired host may receive this prompt on its launch command. A host without long-prompt
 * support builds the command with no fit check, and its quick commands never exceeded the legacy
 * cap, so a longer prompt is pasted by this client once the agent is ready instead. An unverified
 * host counts as older: guessing wrong here would put the prompt on its command line.
 * TEMPORARY: remove with the 6,000-character withholding, once no supported release lacks
 * `terminal.quick-commands.long-prompts.v1`.
 */
export function pairedHostMustPasteLongPrompt(
  state: Partial<Pick<AppState, 'runtimeStatusByEnvironmentId'>>,
  launch: {
    /** The paired host's environment, or null for a launch this process runs itself. */
    environmentId: string | null
    prompt: string
    promptDelivery: LaunchPromptDelivery
    agent: TuiAgent
  }
): boolean {
  const { environmentId, prompt, promptDelivery, agent } = launch
  // Only a submitted prompt that would ride the command line moves: drafts keep their route, and an
  // agent with no prompt argument is already pasted unsubmitted after start.
  if (
    environmentId === null ||
    promptDelivery !== 'auto-submit' ||
    !agentPromptRidesLaunchCommand(agent) ||
    prompt.length <= LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH
  ) {
    return false
  }
  const capabilities = lastVerifiedRuntimeStatus(
    state.runtimeStatusByEnvironmentId?.get(environmentId)
  )?.capabilities
  return capabilities?.includes(TERMINAL_QUICK_COMMAND_LONG_PROMPTS_RUNTIME_CAPABILITY) !== true
}

/**
 * The prompt-free launch a paired host's legacy create route runs instead, for a prompt longer than
 * older builds stored: that route takes the client's command verbatim, with no fit check.
 * TEMPORARY, with the same removal condition as above.
 */
export function pairedHostLegacyCleanLaunch(
  base: Omit<Parameters<typeof buildAgentStartupPlan>[0], 'prompt' | 'allowEmptyPromptLaunch'>,
  prompt: string,
  promptDelivery: LaunchPromptDelivery
): { legacyCleanLaunch?: CreateWebRuntimeSessionTerminalArgs['legacyCleanLaunch'] } {
  if (
    promptDelivery !== 'auto-submit' ||
    prompt.length <= LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH
  ) {
    return {}
  }
  const clean = buildAgentStartupPlan({ ...base, prompt: '', allowEmptyPromptLaunch: true })
  return clean
    ? {
        legacyCleanLaunch: {
          command: clean.launchCommand,
          ...(clean.env ? { env: clean.env } : {}),
          ...(clean.startupCommandDelivery
            ? { startupCommandDelivery: clean.startupCommandDelivery }
            : {})
        }
      }
    : {}
}

/**
 * Who carries a prompt the launch command cannot: this process's host writer for a local launch,
 * the paired host for its own launches, and this client's paste for a host that cannot defer.
 */
export function launchPromptCarriers(
  state: Partial<Pick<AppState, 'runtimeStatusByEnvironmentId'>>,
  runtimeEnvironmentId: string | null,
  prompt: string,
  promptDelivery: LaunchPromptDelivery,
  agent: TuiAgent
): { deliverOversizedPromptAfterReady: boolean; pastePromptAfterReady: boolean } {
  return {
    // Why: a paired host plans its own command line; this process owns only local launches.
    deliverOversizedPromptAfterReady: runtimeEnvironmentId === null,
    pastePromptAfterReady: pairedHostMustPasteLongPrompt(state, {
      environmentId: isWebRuntimeSessionActive(runtimeEnvironmentId) ? runtimeEnvironmentId : null,
      prompt,
      promptDelivery,
      agent
    })
  }
}
