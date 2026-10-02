import { parsePaneKey } from '../../../shared/stable-pane-id'
import type { PendingLaunchPrompt } from '../../../shared/agent-launch-intent'
import type { CreatedAgentTerminalIdentity } from './web-runtime-session-types'

export function createdTerminalLeafId(terminal: CreatedAgentTerminalIdentity): string | undefined {
  const pane = parsePaneKey(terminal.paneKey ?? '')
  return pane && pane.tabId === terminal.tabId ? pane.leafId : undefined
}

/** Decode only the host terminal coordinates consumed by the paired renderer. */
export function readCreatedAgentTerminalIdentity(value: unknown): {
  terminal: CreatedAgentTerminalIdentity
  launchPrompt?: LaunchPromptReplyState
} {
  if (typeof value !== 'object' || value === null || !('terminal' in value)) {
    throw new Error('Host returned an invalid agent terminal result')
  }
  const terminal = value.terminal
  if (typeof terminal !== 'object' || terminal === null) {
    throw new Error('Host returned an invalid agent terminal identity')
  }
  const tabId = 'tabId' in terminal ? terminal.tabId : undefined
  const paneKey = 'paneKey' in terminal ? terminal.paneKey : undefined
  if (
    (tabId !== undefined && typeof tabId !== 'string') ||
    (paneKey !== undefined && paneKey !== null && typeof paneKey !== 'string')
  ) {
    throw new Error('Host returned invalid agent terminal coordinates')
  }
  const handle = 'handle' in terminal && typeof terminal.handle === 'string' ? terminal.handle : ''
  const launchPrompt =
    'launchPrompt' in value ? readLaunchPromptReceipt(value.launchPrompt) : undefined
  return {
    terminal: { tabId, paneKey, ...(handle ? { handle } : {}) },
    ...(launchPrompt ? { launchPrompt } : {})
  }
}

/** A reply's launch prompt state; one this build cannot read is unknown, never "carried". */
export type LaunchPromptReplyState = PendingLaunchPrompt | { outcome: 'unrecognized' }

// Why not ignore it (wire rule 4): absence means the command carried the prompt, so treating an
// arm a newer host sends as absent would report a delivery nobody confirmed.
function readLaunchPromptReceipt(value: unknown): LaunchPromptReplyState | undefined {
  if (value === undefined) {
    return undefined
  }
  const outcome =
    typeof value === 'object' && value !== null && 'outcome' in value ? value.outcome : undefined
  return outcome === 'pending' ? { outcome } : { outcome: 'unrecognized' }
}
