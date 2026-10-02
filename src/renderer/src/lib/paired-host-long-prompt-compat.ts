import type { AppState } from '@/store/types'
import { buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import type { CreateWebRuntimeSessionTerminalArgs } from '@/runtime/web-runtime-session-types'
import { lastVerifiedRuntimeStatus } from '../../../shared/runtime-host-status'
import { LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../../../shared/terminal-quick-commands'
import { TERMINAL_QUICK_COMMAND_LONG_PROMPTS_RUNTIME_CAPABILITY } from '../../../shared/terminal-quick-command-capabilities'

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
  environmentId: string,
  prompt: string
): boolean {
  if (prompt.length <= LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH) {
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
  prompt: string
): { legacyCleanLaunch?: CreateWebRuntimeSessionTerminalArgs['legacyCleanLaunch'] } {
  if (prompt.length <= LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH) {
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
