import type { TuiAgent } from '../../../shared/tui-agent'
import {
  deliverLaunchPromptToAgentTab,
  seedNativeChatLaunchDraftForAgentTab
} from '../lib/agent-launch-prompt-delivery'
import { createWebRuntimeSessionTerminalResult } from './web-runtime-terminal-create-operation'
import { toWebTerminalSurfaceTabId } from './web-terminal-surface-id'
import { callRuntimeRpc } from './runtime-rpc-client'
import { HOST_LAUNCH_PROMPT_OBSERVE_WINDOW_MS } from '../../../shared/host-launch-prompt-budget'
import type {
  CreateWebRuntimeSessionTerminalArgs,
  WebRuntimeTerminalCreateOutcome
} from './web-runtime-session-types'

const LAUNCH_PROMPT_OBSERVE_ATTEMPTS = 3
// Mirrors the host's `launch_prompt_unknown` refusal; this module cannot import main.
const LAUNCH_PROMPT_UNKNOWN_ERROR = 'launch_prompt_unknown'
// Why the host's whole window: a delivery waiting out a startup dialog is slow, not failed.
const LAUNCH_PROMPT_OBSERVE_RPC_TIMEOUT_MS = HOST_LAUNCH_PROMPT_OBSERVE_WINDOW_MS + 15_000

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
  hostTabId?: string
}> {
  const created = await createWebRuntimeSessionTerminalResult(args)
  if (created.outcome.status === 'failed') {
    return { outcome: created.outcome, promptDelivered: Promise.resolve(false) }
  }
  const hostTabId = created.hostTabId ? { hostTabId: created.hostTabId } : {}
  const followUp = created.launchPromptFollowUp
  if (followUp?.kind === 'host-delivering') {
    return {
      outcome: created.outcome,
      promptDelivered: observeHostLaunchPrompt(followUp.environmentId, followUp.terminal),
      ...hostTabId
    }
  }
  if (followUp?.kind === 'unknown') {
    return { outcome: created.outcome, promptDelivered: Promise.resolve(null), ...hostTabId }
  }
  if (followUp?.kind === 'client-paste') {
    return {
      outcome: created.outcome,
      ...hostTabId,
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
  return { outcome: created.outcome, promptDelivered: Promise.resolve(true), ...hostTabId }
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
        { terminal, for: 'launch-prompt', timeoutMs: HOST_LAUNCH_PROMPT_OBSERVE_WINDOW_MS },
        { timeoutMs: LAUNCH_PROMPT_OBSERVE_RPC_TIMEOUT_MS }
      )
      const outcome = result.wait?.launchPrompt?.outcome
      if (outcome === 'handed-to-terminal' || outcome === 'not-delivered') {
        return outcome === 'handed-to-terminal'
      }
      return null
    } catch (error) {
      // The host holds no record (it restarted, or it expired): unknown, so asking again is moot.
      if (error instanceof Error && error.message.includes(LAUNCH_PROMPT_UNKNOWN_ERROR)) {
        return null
      }
      // Otherwise observing never writes, so asking again cannot deliver the prompt twice.
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
  hostTabId?: string
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
  return { outcome: created.outcome, promptDelivered, hostTabId: created.hostTabId }
}

/**
 * Launch a web-host agent terminal whose draft already rode in on the launch
 * command (argv prefill). No post-ready paste runs for that delivery, so seed
 * the chat-composer copy here once the mirrored host tab id is known.
 */
export async function createWebRuntimeAgentSessionTerminalWithLaunchDraft(
  args: CreateWebRuntimeSessionTerminalArgs & {
    agent: TuiAgent
    launchDraft: string
  }
): Promise<WebRuntimeTerminalCreateOutcome> {
  const created = await createWebRuntimeSessionTerminalResult(args)
  if (created.outcome.status !== 'failed' && created.hostTabId) {
    seedNativeChatLaunchDraftForAgentTab({
      tabId: toWebTerminalSurfaceTabId(created.hostTabId),
      agent: args.agent,
      text: args.launchDraft
    })
  }
  return created.outcome
}
