/**
 * A chat assignee's dispatch preamble, owed as a turn.
 *
 * A PTY assignee has its preamble typed into its pane, where a busy agent queues it. A chat takes
 * input only as a turn, and a turn sent mid-turn folds into the running one, so the preamble is
 * stored as its Dispatch's one `dispatch_preamble_turns` row, which is not mail, and the structured
 * mail lane sends it as a plain send: it waits out a running turn or a question only a human can
 * answer, a chat at rest is started by the send itself, and it is found again at the chat's idle
 * edge or at startup. It may be sent only while its Dispatch is active; the row is dropped when the
 * Dispatch ends.
 */

import type { OrcaRuntimeService } from '../orca-runtime'
import { AGENT_PROMPT_EFFECT_TIMEOUT_MS } from '../../../shared/orchestration-timing-budgets'
import type { OrchestrationDb } from './db'

// No event announces a delivered turn, so worker-start polls its one row, bounded by its budget.
const PREAMBLE_TURN_POLL_MS = 250

export function queueDispatchPreambleTurn(
  runtime: Pick<OrcaRuntimeService, 'deliverPendingMessagesForHandle'>,
  db: OrchestrationDb,
  dispatchId: string,
  preamble: string
): void {
  db.putDispatchPreambleTurn(dispatchId, preamble)
  runtime.deliverPendingMessagesForHandle(`dispatch:${dispatchId}`)
}

export type DispatchPreambleTurnSettlement = 'delivered' | 'withdrawn' | 'in_doubt'

/**
 * worker-start's wait for a chat to take its preamble, under the budget a terminal gets to go idle.
 * Past it the turn is withdrawn when the chat certainly never got it, and the start fails as a busy
 * terminal's does. A send in flight then is waited out; one whose outcome is unknown may have
 * reached the chat, so it is reported in doubt, never as a failure that leaves a working chat.
 */
export async function settleDispatchPreambleTurn(
  db: OrchestrationDb,
  dispatchId: string,
  timeoutMs: number
): Promise<DispatchPreambleTurnSettlement> {
  const deadline = Date.now() + timeoutMs
  const sendDeadline = deadline + AGENT_PROMPT_EFFECT_TIMEOUT_MS
  for (;;) {
    const state = db.getDispatchPreambleTurn(dispatchId)?.state
    if (state === 'delivered') {
      return 'delivered'
    }
    if (state === undefined) {
      return 'withdrawn'
    }
    const now = Date.now()
    if (now >= deadline) {
      if (db.withdrawOwedDispatchPreambleTurn(dispatchId)) {
        return 'withdrawn'
      }
      const settled = db.getDispatchPreambleTurn(dispatchId)?.state
      if (settled === 'delivered') {
        return 'delivered'
      }
      if (settled === 'in_doubt' || now >= sendDeadline) {
        return 'in_doubt'
      }
    }
    await new Promise((resolve) => setTimeout(resolve, PREAMBLE_TURN_POLL_MS))
  }
}
