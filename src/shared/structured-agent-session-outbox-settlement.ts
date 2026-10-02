// Which outbox sends settle without the user's Retry: one the host provably never recorded, one it
// lost track of for good, and one still being confirmed under its own id.

import type { AgentJournalSubmission } from './agent-session-journal-types'
import {
  agentSessionOwnerVerdictAllowsFreshOperationId,
  agentSessionRefusalOperationState
} from './agent-session-refusal-retry'
import type { AgentSessionWriteRefusal } from './agent-session-write-failure'
import type { StructuredAgentSessionOutboxEntry } from './structured-agent-session-outbox'

/** Whether this refusal proves the host never recorded the message under any attempt: a settled
 *  refusal, or an exited owner that runs nothing under the old id, of a send with no earlier
 *  attempt and no doubt. Only then may its id rotate or its text go back to the composer. */
export function structuredAgentSessionRefusalProvesUnsent(
  entry: StructuredAgentSessionOutboxEntry,
  refusal: AgentSessionWriteRefusal,
  retainOperationId = false
): boolean {
  const refusalSettled = agentSessionRefusalOperationState(refusal.code) === 'settled-rejected'
  const ownerExited =
    refusal.code === 'agent_session_ownership_unknown' &&
    agentSessionOwnerVerdictAllowsFreshOperationId(refusal.details?.ownerVerdict)
  return (
    (refusalSettled || ownerExited) &&
    !retainOperationId &&
    entry.state !== 'unconfirmed' &&
    entry.retryAfterUnknownSubmittedAt === null
  )
}

/** A send the host recorded and then lost track of across its own restart: whether the agent got
 *  it can never be known, and a resend under its id only replays that. */
export function structuredAgentSessionSubmissionOutcomeLost(
  submission: AgentJournalSubmission | undefined
): boolean {
  return submission?.dispatchState === 'unknown' && submission.recovered === true
}

/** Whether an entry in doubt is still being settled without the user: the unconfirmed probe
 *  resends it under its id until the journal answers, and a live `unknown` row settles on the
 *  host. One the user retried, or a Stop outlived, waits on the user instead. */
export function structuredAgentSessionEntryConfirmingByItself(
  entry: StructuredAgentSessionOutboxEntry
): boolean {
  return (
    entry.state === 'unconfirmed' &&
    entry.retryAfterUnknownSubmittedAt === null &&
    entry.outlivedStop !== true
  )
}
