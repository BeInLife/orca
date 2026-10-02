// Which refused sends go back to the composer: only one the host provably never recorded.

import { describe, expect, it } from 'vitest'
import type { AgentJournalSubmission } from './agent-session-journal-types'
import { disposeStructuredAgentSessionSendResult } from './structured-agent-session-send-disposition'
import {
  createStructuredAgentSessionOutboxEntry,
  reconcileStructuredAgentSessionOutbox,
  type StructuredAgentSessionOutboxEntry
} from './structured-agent-session-outbox'

const entry: StructuredAgentSessionOutboxEntry = createStructuredAgentSessionOutboxEntry({
  clientMessageId: 'client-1',
  sessionId: 'session-1',
  text: 'hello',
  attachments: [],
  queuedAt: 1
})

function refuse(
  sent: StructuredAgentSessionOutboxEntry,
  code: 'agent_session_operation_conflict' | 'agent_session_conflict',
  returnToComposer = true
) {
  return disposeStructuredAgentSessionSendResult({
    entries: [sent],
    entry: sent,
    result: { ok: false, refusal: { code, message: code } },
    createOperationId: () => 'fresh-id',
    returnToComposer
  })
}

describe('a refused send and the composer', () => {
  it('returns a first attempt the host settled as refused', () => {
    const disposition = refuse(entry, 'agent_session_operation_conflict')

    expect(disposition.entries).toEqual([])
    expect(disposition.returned).toEqual({
      entry,
      refusal: { kind: 'refused', code: 'agent_session_operation_conflict' }
    })
  })

  it.each([
    ['an earlier attempt that may have landed', { ...entry, lastAttemptAt: 5 }],
    ['an attempt after doubt', { ...entry, retryAfterUnknownSubmittedAt: 5 }],
    ['a launch prompt, whose source sends it again', { ...entry, source: 'launch' as const }]
  ])('keeps %s', (_label, sent) => {
    const disposition = refuse(sent, 'agent_session_operation_conflict')

    expect(disposition.returned).toBeUndefined()
    expect(disposition.entries).toHaveLength(1)
  })

  it('keeps a refusal that does not prove the host never recorded it', () => {
    expect(refuse(entry, 'agent_session_conflict').returned).toBeUndefined()
  })

  it('keeps it where no composer shows the chat', () => {
    const disposition = refuse(entry, 'agent_session_operation_conflict', false)

    expect(disposition.returned).toBeUndefined()
    expect(disposition.entries).toMatchObject([{ clientMessageId: 'fresh-id', state: 'rejected' }])
  })
})

describe('a send the host lost track of', () => {
  const unknown = (recovered: boolean): AgentJournalSubmission => ({
    clientMessageId: 'client-1',
    fence: 1,
    payloadFingerprint: 'fingerprint',
    dispatchState: 'unknown',
    providerItemId: null,
    reason: 'host_restarted_before_acknowledgement',
    submittedAt: 1,
    resolvedAt: 2,
    ...(recovered ? { recovered: true as const } : {})
  })
  const inDoubt = { ...entry, state: 'unconfirmed' as const, lastAttemptAt: 1 }

  it('leaves the outbox once recovered: its row keeps the message and nothing can settle it', () => {
    expect(reconcileStructuredAgentSessionOutbox([inDoubt], [unknown(true)])).toEqual([])
  })

  it('waits while the host may still settle it', () => {
    expect(reconcileStructuredAgentSessionOutbox([inDoubt], [unknown(false)])).toEqual([inDoubt])
  })
})
