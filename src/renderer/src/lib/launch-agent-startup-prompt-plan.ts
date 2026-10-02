import {
  buildAgentDraftLaunchPlan,
  buildAgentStartupPlan,
  type AgentStartupPlan
} from '@/lib/tui-agent-startup'

type StartupPlanBase = Omit<
  Parameters<typeof buildAgentStartupPlan>[0],
  'prompt' | 'allowEmptyPromptLaunch'
>

export type LaunchAgentStartupPromptPlan = {
  startupPlan: AgentStartupPlan | null
  /** Text to paste once the TUI is ready; null when the launch command already carries it. */
  pasteDraftAfterLaunch: string | null
  submitPastedPrompt: boolean
  /** The command could not carry the prompt, so the host's agent-prompt writer delivers it. */
  deliverPastedPromptThroughHost: boolean
}

/**
 * Decide how a new-tab launch delivers its prompt: argv/flag agents fold it
 * into the launch command, while followup and generated launches start clean
 * and paste after the TUI is ready.
 */
export function planLaunchAgentStartupPrompt(args: {
  base: StartupPlanBase
  /** Already trimmed. */
  prompt: string
  promptDelivery: 'auto-submit' | 'draft' | 'submit-after-ready'
  isFollowupPath: boolean
  /** Set when this host's writer delivers what the launch command cannot carry (local launches). */
  deliverOversizedPromptAfterReady: boolean
}): LaunchAgentStartupPromptPlan {
  const { base, prompt, promptDelivery, isFollowupPath, deliverOversizedPromptAfterReady } = args
  const hasPrompt = prompt.length > 0
  const launchEmpty = (): AgentStartupPlan | null =>
    buildAgentStartupPlan({ ...base, prompt: '', allowEmptyPromptLaunch: true })
  const pasteAfterReady = (submit: boolean): LaunchAgentStartupPromptPlan => ({
    startupPlan: launchEmpty(),
    pasteDraftAfterLaunch: prompt,
    submitPastedPrompt: submit,
    deliverPastedPromptThroughHost: false
  })

  if (hasPrompt && promptDelivery === 'submit-after-ready') {
    // Why: multi-line generated prompts are too large for a shell argv, so launch clean then paste+submit in the TUI.
    return pasteAfterReady(true)
  }
  if (hasPrompt && promptDelivery === 'draft') {
    const draftLaunchPlan = buildAgentDraftLaunchPlan({ ...base, draft: prompt })
    if (!draftLaunchPlan) {
      return pasteAfterReady(false)
    }
    return {
      startupPlan: {
        agent: draftLaunchPlan.agent,
        launchCommand: draftLaunchPlan.launchCommand,
        expectedProcess: draftLaunchPlan.expectedProcess,
        followupPrompt: null,
        launchConfig: draftLaunchPlan.launchConfig,
        ...(draftLaunchPlan.sessionOptions
          ? { sessionOptions: draftLaunchPlan.sessionOptions }
          : {}),
        ...(draftLaunchPlan.startupCommandDelivery
          ? { startupCommandDelivery: draftLaunchPlan.startupCommandDelivery }
          : {}),
        ...(draftLaunchPlan.env ? { env: draftLaunchPlan.env } : {})
      },
      pasteDraftAfterLaunch: null,
      submitPastedPrompt: false,
      deliverPastedPromptThroughHost: false
    }
  }
  if (hasPrompt && isFollowupPath) {
    return pasteAfterReady(false)
  }
  const startupPlan = buildAgentStartupPlan({
    ...base,
    prompt: hasPrompt ? prompt : '',
    allowEmptyPromptLaunch: !hasPrompt,
    deliverOversizedPromptAfterReady
  })
  if (hasPrompt && startupPlan?.followupPrompt) {
    // Why: too long for the host's command line; the plan launched clean and the host writes it.
    return {
      startupPlan: { ...startupPlan, followupPrompt: null },
      pasteDraftAfterLaunch: prompt,
      submitPastedPrompt: true,
      deliverPastedPromptThroughHost: true
    }
  }
  return {
    startupPlan,
    pasteDraftAfterLaunch: null,
    submitPastedPrompt: false,
    deliverPastedPromptThroughHost: false
  }
}
