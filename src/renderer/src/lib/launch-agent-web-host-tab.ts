import { toast } from 'sonner'
import { useAppStore } from '@/store'
import {
  createWebRuntimeAgentSessionTerminal,
  createWebRuntimeAgentSessionTerminalWithLaunchDraft,
  createWebRuntimeAgentSessionTerminalWithPrompt,
  createWebRuntimeSessionTerminal,
  isWebTerminalSurfaceTabId
} from '@/runtime/web-runtime-session'
import { toWebTerminalSurfaceTabId } from '@/runtime/web-terminal-surface-id'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'
import type { Tab } from '../../../shared/tab-types'
import type { CreateWebRuntimeSessionTerminalArgs } from '@/runtime/web-runtime-session-types'
import type { TuiAgent } from '../../../shared/tui-agent'
import type { AgentPromptDelivery } from '../../../shared/agent-session-host-authority'
import { translate } from '@/i18n/i18n'
import { toAgentLaunchPreferences } from '../../../shared/agent-launch-preferences'
import { showPromptNotSentNotice } from '@/lib/launch-agent-paste-timeout-notice'

function removeStaleLocalAgentTabsForWebHostLaunch(worktreeId: string): void {
  const state = useAppStore.getState()
  for (const tab of state.tabsByWorktree[worktreeId] ?? []) {
    if (tab.launchAgent && !isWebTerminalSurfaceTabId(tab.id)) {
      // Why: pruning a stale local agent tab is a system close — keep it out of
      // the Cmd+Shift+T reopen stack.
      state.closeTab(tab.id, { reason: 'cleanup' })
    }
  }
}

/**
 * Launch an agent terminal on the web runtime host instead of a local tab.
 *
 * Why: paired web tabs are host-owned, so this path never creates a local tab
 * (callers return tabId: null). Local-only agent tabs cannot be closed because
 * close routes through session.tabs.close on the host, so prune them before
 * the host snapshot.
 */
export function launchAgentInWebHostTab(args: {
  agent: TuiAgent
  worktreeId: string
  environmentId: string | null
  groupId?: string
  cwd?: string | null
  startupPlan: AgentStartupPlan
  prompt: string
  promptDelivery: 'auto-submit' | 'draft' | 'submit-after-ready'
  pastePromptAfterReady: string | null
  submitPastedPrompt: boolean
  agentArgs?: string | null
  viewMode?: Tab['viewMode']
  /** The launch without its prompt, for a host route that cannot defer a long one. */
  legacyCleanLaunch?: CreateWebRuntimeSessionTerminalArgs['legacyCleanLaunch']
  onPromptDelivered?: () => void
}): Promise<{ delivered: boolean; failureNotified: boolean }> {
  const {
    agent,
    worktreeId,
    environmentId,
    groupId,
    cwd,
    startupPlan,
    prompt,
    promptDelivery,
    pastePromptAfterReady,
    submitPastedPrompt,
    agentArgs,
    viewMode,
    legacyCleanLaunch,
    onPromptDelivered
  } = args
  const hasPrompt = prompt.length > 0
  const launchPreferences = toAgentLaunchPreferences(startupPlan.sessionOptions)
  const structuredPromptDelivery: AgentPromptDelivery =
    promptDelivery === 'draft' ? 'draft' : 'auto-submit'
  removeStaleLocalAgentTabsForWebHostLaunch(worktreeId)
  const launch = {
    worktreeId,
    environmentId,
    targetGroupId: groupId,
    activate: true,
    ...(cwd?.trim() ? { cwd } : {}),
    ...(viewMode ? { viewMode } : {}),
    agentSessionKind: 'fresh',
    ...(hasPrompt
      ? {
          launchAgent: agent,
          command: startupPlan.launchCommand,
          ...(startupPlan.env ? { env: startupPlan.env } : {}),
          launchConfig: startupPlan.launchConfig,
          ...(startupPlan.startupCommandDelivery
            ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
            : {})
        }
      : { agent }),
    ...(hasPrompt && pastePromptAfterReady === null ? { prompt } : {}),
    ...(hasPrompt && pastePromptAfterReady === null
      ? { promptDelivery: structuredPromptDelivery }
      : {}),
    ...(agentArgs !== undefined ? { agentArgs } : {}),
    ...(launchPreferences ? { launchPreferences } : {})
  } as const

  const handleCreation = ({
    outcome,
    promptDelivered
  }: {
    outcome: Awaited<ReturnType<typeof createWebRuntimeSessionTerminal>>
    promptDelivered: boolean
  }): { delivered: boolean; failureNotified: boolean } => {
    // Why: created means the host accepted the launch, not that a local tab
    // exists; keep pruning stale local rows until the snapshot mirrors.
    removeStaleLocalAgentTabsForWebHostLaunch(worktreeId)
    if (outcome.status === 'failed') {
      toast.error(
        outcome.message ||
          translate(
            'auto.lib.launch.agent.in.new.tab.11cce5cc77',
            'Could not launch {{value0}} in a new terminal.',
            { value0: agent }
          )
      )
      return { delivered: false, failureNotified: true }
    }
    useAppStore.getState().setActiveTabType('terminal', worktreeId)
    if (hasPrompt && promptDelivered) {
      onPromptDelivered?.()
    }
    return { delivered: promptDelivered, failureNotified: false }
  }

  if (pastePromptAfterReady !== null) {
    return createWebRuntimeAgentSessionTerminal({
      ...launch,
      agent,
      promptAfterReady: pastePromptAfterReady,
      submitPrompt: submitPastedPrompt,
      forcePromptPaste: true
    }).then(({ outcome, promptDelivered, hostTabId }) => {
      const result = handleCreation({ outcome, promptDelivered })
      return outcome.status === 'failed' || promptDelivered
        ? result
        : notifyPromptNotSent(agent, submitPastedPrompt, worktreeId, hostTabId)
    })
  }
  if (hasPrompt && promptDelivery === 'draft') {
    // Why: the draft rode in on the launch command, so no paste runs and
    // nothing else seeds the chat-composer copy for this host class.
    return createWebRuntimeAgentSessionTerminalWithLaunchDraft({
      ...launch,
      agent,
      launchDraft: prompt
    }).then((outcome) => handleCreation({ outcome, promptDelivered: outcome.status === 'created' }))
  }
  if (hasPrompt) {
    return createWebRuntimeAgentSessionTerminalWithPrompt({
      ...launch,
      agent,
      prompt,
      ...(legacyCleanLaunch ? { legacyCleanLaunch } : {})
    }).then(async ({ outcome, promptDelivered, hostTabId }) => {
      // The tab shows now; how its prompt delivery ends is reported when it settles.
      const created = handleCreation({ outcome, promptDelivered: false })
      if (outcome.status === 'failed') {
        return created
      }
      const delivered = await promptDelivered
      if (delivered) {
        onPromptDelivered?.()
        return { delivered: true, failureNotified: false }
      }
      // Unknown (the outcome could not be read) is not reported as a failure it may not be.
      return delivered === false
        ? notifyPromptNotSent(agent, true, worktreeId, hostTabId)
        : { delivered: false, failureNotified: false }
    })
  }
  return createWebRuntimeSessionTerminal(launch).then((outcome) =>
    handleCreation({ outcome, promptDelivered: false })
  )
}

function notifyPromptNotSent(
  agent: TuiAgent,
  submitted: boolean,
  worktreeId: string,
  hostTabId: string | undefined
): { delivered: false; failureNotified: boolean } {
  // Why: as for a local tab, a tab the user already closed needs no notice about its prompt.
  const tabId = hostTabId ? toWebTerminalSurfaceTabId(hostTabId) : null
  const tabClosed =
    tabId !== null &&
    !(useAppStore.getState().tabsByWorktree[worktreeId] ?? []).some((tab) => tab.id === tabId)
  if (tabClosed) {
    return { delivered: false, failureNotified: false }
  }
  showPromptNotSentNotice(agent, submitted)
  return { delivered: false, failureNotified: true }
}
