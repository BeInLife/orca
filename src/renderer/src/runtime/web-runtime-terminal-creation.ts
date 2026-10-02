import type { TuiAgent } from '../../../shared/tui-agent'
import {
  deliverLaunchPromptToAgentTab,
  seedNativeChatLaunchDraftForAgentTab
} from '../lib/agent-launch-prompt-delivery'
import { createWebRuntimeSessionTerminalResult } from './web-runtime-terminal-create-operation'
import { toWebTerminalSurfaceTabId } from './web-terminal-surface-id'
import { callRuntimeRpc } from './runtime-rpc-client'
import type { RuntimeTerminalSend } from '../../../shared/runtime-types'
import type {
  CreateWebRuntimeSessionTerminalArgs,
  WebRuntimeTerminalCreateOutcome
} from './web-runtime-session-types'

// Why: the host waits up to 60 s for the agent's TUI before it writes, then for the paste to ingest.
const LAUNCH_PROMPT_DELIVERY_TIMEOUT_MS = 90_000

export async function createWebRuntimeSessionTerminal(
  args: CreateWebRuntimeSessionTerminalArgs
): Promise<WebRuntimeTerminalCreateOutcome> {
  return (await createWebRuntimeSessionTerminalResult(args)).outcome
}

/**
 * Creates a host agent terminal with its prompt, letting the host start the agent clean when its
 * command line cannot carry the prompt, then has the host's own writer deliver it once ready.
 */
export async function createWebRuntimeAgentSessionTerminalWithPrompt(
  args: CreateWebRuntimeSessionTerminalArgs & { prompt: string }
): Promise<{ outcome: WebRuntimeTerminalCreateOutcome; promptDelivered: boolean }> {
  const created = await createWebRuntimeSessionTerminalResult({
    ...args,
    deferOversizedPrompt: true
  })
  if (created.outcome.status === 'failed') {
    return { outcome: created.outcome, promptDelivered: false }
  }
  const deferred = created.deferredLaunchPrompt
  if (!deferred) {
    return { outcome: created.outcome, promptDelivered: true }
  }
  try {
    // Never reaches a host that predates `launchPrompt`: only newer hosts reply with a deferral.
    const result = await callRuntimeRpc<{ send: RuntimeTerminalSend }>(
      { kind: 'environment', environmentId: deferred.environmentId },
      'terminal.send',
      { terminal: deferred.terminal, text: args.prompt, launchPrompt: true },
      { timeoutMs: LAUNCH_PROMPT_DELIVERY_TIMEOUT_MS }
    )
    return { outcome: created.outcome, promptDelivered: result.send.accepted === true }
  } catch {
    return { outcome: created.outcome, promptDelivered: false }
  }
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
