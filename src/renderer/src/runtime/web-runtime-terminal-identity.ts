import { parsePaneKey } from '../../../shared/stable-pane-id'
import type { AgentSessionLaunchPromptReceipt } from '../../../shared/agent-session-host-authority'
import type { CreatedAgentTerminalIdentity } from './web-runtime-session-types'

export function createdTerminalLeafId(terminal: CreatedAgentTerminalIdentity): string | undefined {
  const pane = parsePaneKey(terminal.paneKey ?? '')
  return pane && pane.tabId === terminal.tabId ? pane.leafId : undefined
}

/** Decode only the host terminal coordinates consumed by the paired renderer. */
export function readCreatedAgentTerminalIdentity(value: unknown): {
  terminal: CreatedAgentTerminalIdentity
  launchPrompt?: AgentSessionLaunchPromptReceipt
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

/** An outcome this build does not know is ignored, never guessed at (wire compatibility rule 4). */
function readLaunchPromptReceipt(value: unknown): AgentSessionLaunchPromptReceipt | undefined {
  const outcome =
    typeof value === 'object' && value !== null && 'outcome' in value ? value.outcome : undefined
  return outcome === 'pending' || outcome === 'not-delivered' ? { outcome } : undefined
}
