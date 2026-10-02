import type { TuiAgent } from '../../../shared/tui-agent'
import {
  deliverLaunchPromptToAgentTab,
  seedNativeChatLaunchDraftForAgentTab
} from '../lib/agent-launch-prompt-delivery'
import { createWebRuntimeSessionTerminalResult } from './web-runtime-terminal-create-operation'
import { toWebTerminalSurfaceTabId } from './web-terminal-surface-id'
import { callRuntimeRpc } from './runtime-rpc-client'
import type {
  CreateWebRuntimeSessionTerminalArgs,
  WebRuntimeTerminalCreateOutcome
} from './web-runtime-session-types'

// Why: the host's own delivery ends within 60 s of readiness plus the paste's ingest; this only
// bounds how long one observation may sit on a dead connection before it is asked again.
const LAUNCH_PROMPT_OBSERVE_TIMEOUT_MS = 120_000
const LAUNCH_PROMPT_OBSERVE_ATTEMPTS = 3

export async function createWebRuntimeSessionTerminal(
  args: CreateWebRuntimeSessionTerminalArgs
): Promise<WebRuntimeTerminalCreateOutcome> {
  return (await createWebRuntimeSessionTerminalResult(args)).outcome
}

/**
 * Creates a host agent terminal with its prompt. The host decides whether the launch command can
 * carry it; when it cannot, the host delivers it itself and this only watches how that ends.
 * `promptDelivered` settles after the terminal exists: true, false, or null when the outcome
 * could not be read.
 */
export async function createWebRuntimeAgentSessionTerminalWithPrompt(
  args: CreateWebRuntimeSessionTerminalArgs & { agent: TuiAgent; prompt: string }
): Promise<{
  outcome: WebRuntimeTerminalCreateOutcome
  promptDelivered: Promise<boolean | null>
}> {
  const created = await createWebRuntimeSessionTerminalResult(args)
  if (created.outcome.status === 'failed') {
    return { outcome: created.outcome, promptDelivered: Promise.resolve(false) }
  }
  const followUp = created.launchPromptFollowUp
  if (followUp?.kind === 'host-delivering') {
    return {
      outcome: created.outcome,
      promptDelivered: observeHostLaunchPrompt(followUp.environmentId, followUp.terminal)
    }
  }
  if (followUp?.kind === 'client-paste') {
    return {
      outcome: created.outcome,
      promptDelivered: created.hostTabId
        ? deliverLaunchPromptToAgentTab({
            tabId: toWebTerminalSurfaceTabId(created.hostTabId),
            content: args.prompt,
            agent: args.agent,
            submit: true,
            forcePaste: true
          })
        : Promise.resolve(false)
    }
  }
  return { outcome: created.outcome, promptDelivered: Promise.resolve(true) }
}

/**
 * Reads how the host's delivery of a launch prompt ended. Read-only, so a dropped connection is
 * simply asked again; only a host that replied `pending` is asked, which an older host never does.
 */
async function observeHostLaunchPrompt(
  environmentId: string,
  terminal: string
): Promise<boolean | null> {
  for (let attempt = 0; attempt < LAUNCH_PROMPT_OBSERVE_ATTEMPTS; attempt += 1) {
    try {
      const result = await callRuntimeRpc<{ wait?: { launchPrompt?: { outcome?: unknown } } }>(
        { kind: 'environment', environmentId },
        'terminal.wait',
        { terminal, for: 'launch-prompt' },
        { timeoutMs: LAUNCH_PROMPT_OBSERVE_TIMEOUT_MS }
      )
      const outcome = result.wait?.launchPrompt?.outcome
      if (outcome === 'handed-to-terminal' || outcome === 'not-delivered') {
        return outcome === 'handed-to-terminal'
      }
      return null
    } catch {
      // Observing never writes, so asking again cannot deliver the prompt twice.
    }
  }
  return null
}

export async function createWebRuntimeAgentSessionTerminal(
  args: CreateWebRuntimeSessionTerminalArgs & {
    agent: TuiAgent
    promptAfterReady: string
    submitPrompt: boolean
    forcePromptPaste: boolean
  }
): Promise<{
  outcome: WebRuntimeTerminalCreateOutcome
  promptDelivered: boolean
}> {
  const created = await createWebRuntimeSessionTerminalResult(args)
  if (created.outcome.status === 'failed' || !created.hostTabId) {
    return { outcome: created.outcome, promptDelivered: false }
  }

  const promptDelivered = await deliverLaunchPromptToAgentTab({
    tabId: toWebTerminalSurfaceTabId(created.hostTabId),
    content: args.promptAfterReady,
    agent: args.agent,
    submit: args.submitPrompt,
    forcePaste: args.forcePromptPaste
  })
  return { outcome: created.outcome, promptDelivered }
}

/**
 * Launch a web-host agent terminal with a draft. When the draft rode in on the launch command
 * (argv prefill) no paste runs, so seed the chat-composer copy once the host tab id is known;
 * when the host's command line could not carry it, paste it unsent once the agent is ready.
 */
export async function createWebRuntimeAgentSessionTerminalWithLaunchDraft(
  args: CreateWebRuntimeSessionTerminalArgs & {
    agent: TuiAgent
    launchDraft: string
  }
): Promise<WebRuntimeTerminalCreateOutcome> {
  const created = await createWebRuntimeSessionTerminalResult(args)
  if (created.outcome.status === 'failed' || !created.hostTabId) {
    return created.outcome
  }
  const tabId = toWebTerminalSurfaceTabId(created.hostTabId)
  if (created.launchPromptFollowUp?.kind === 'client-paste') {
    void deliverLaunchPromptToAgentTab({
      tabId,
      content: args.launchDraft,
      agent: args.agent,
      submit: false,
      forcePaste: true
    }).catch((error) => console.error('Draft delivery failed after launch', error))
  } else {
    seedNativeChatLaunchDraftForAgentTab({ tabId, agent: args.agent, text: args.launchDraft })
  }
  return created.outcome
}
