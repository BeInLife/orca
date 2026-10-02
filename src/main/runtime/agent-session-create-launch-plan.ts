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
} {
  // Drafts keep their own rule and contract: a draft that does not fit is refused, as before.
  if (request.promptDelivery === 'draft') {
    return {
      startup: buildAgentDraftLaunchPlan({ ...startupArgs, draft: request.prompt ?? '' }),
      owedLaunchPrompt: undefined
    }
  }
  const startup = buildAgentStartupPlan({
    ...startupArgs,
    prompt: request.prompt ?? '',
    allowEmptyPromptLaunch: true,
    deliverOversizedPromptAfterReady: true
  })
  // Only an argv agent's prompt is owed: callers paste a no-argument agent's prompt themselves.
  const owedLaunchPrompt =
    startup?.followupPrompt && agentPromptRidesLaunchCommand(request.agent)
      ? startup.followupPrompt
      : undefined
  return { startup, owedLaunchPrompt }
}

export function launchPromptReceipt(
  owedLaunchPrompt: string | undefined
): Pick<RuntimeCreateAgentSessionResult, 'launchPrompt'> {
  return owedLaunchPrompt ? { launchPrompt: { outcome: 'pending' } } : {}
}
