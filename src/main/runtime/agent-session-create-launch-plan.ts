import type {
  RuntimeCreateAgentSessionRequest,
  RuntimeCreateAgentSessionResult
} from '../../shared/agent-session-host-authority'
import type { AgentStartupPlanInputs } from '../../shared/agent-startup-plan-inputs'
import {
  agentPromptRidesLaunchCommand,
  buildAgentDraftLaunchPlan,
  buildAgentStartupPlan,
  type AgentDraftLaunchPlan,
  type AgentStartupPlan
} from '../../shared/tui-agent-startup'

/**
 * The launch `terminal.createAgentSession` spawns, and what becomes of a prompt it cannot carry.
 *
 * The host plans every create with deferral: it owns this PTY and its writer, so a prompt the
 * command line cannot carry is the host's to deliver after ready, never the caller's.
 */
export function planAgentSessionCreateLaunch(
  startupArgs: AgentStartupPlanInputs,
  request: Pick<RuntimeCreateAgentSessionRequest, 'agent' | 'prompt' | 'promptDelivery'>
): {
  startup: AgentStartupPlan | AgentDraftLaunchPlan | null
  owedLaunchPrompt: string | undefined
  draftNotCarried: boolean
} {
  const isDraft = request.promptDelivery === 'draft'
  const draft = isDraft
    ? buildAgentDraftLaunchPlan({ ...startupArgs, draft: request.prompt ?? '' })
    : null
  if (draft) {
    return { startup: draft, owedLaunchPrompt: undefined, draftNotCarried: false }
  }
  const startup = buildAgentStartupPlan({
    ...startupArgs,
    // A draft the command cannot carry starts clean; the caller pastes it, unsent.
    prompt: isDraft ? '' : (request.prompt ?? ''),
    allowEmptyPromptLaunch: true,
    deliverOversizedPromptAfterReady: true
  })
  // Only an argv agent's prompt is owed: callers paste a no-argument agent's prompt themselves.
  const owedLaunchPrompt =
    !isDraft && startup?.followupPrompt && agentPromptRidesLaunchCommand(request.agent)
      ? startup.followupPrompt
      : undefined
  return { startup, owedLaunchPrompt, draftNotCarried: isDraft && startup !== null }
}

export function launchPromptReceipt(
  owedLaunchPrompt: string | undefined,
  draftNotCarried: boolean | undefined
): Pick<RuntimeCreateAgentSessionResult, 'launchPrompt'> {
  if (owedLaunchPrompt) {
    return { launchPrompt: { outcome: 'pending' } }
  }
  return draftNotCarried ? { launchPrompt: { outcome: 'not-delivered' } } : {}
}
