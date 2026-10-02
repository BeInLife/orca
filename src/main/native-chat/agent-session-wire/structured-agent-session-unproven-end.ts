// An end the adapter could not prove. The child may still be running, so the host keeps it and owes
// its stop: nothing writes to it or starts beside it until a retry proves the exit or the exit
// itself is seen, and a message sent meanwhile waits under the wind-down row.

import type { StructuredAgentSessionEndUnprovenEvent } from './structured-agent-session-adapter'
import type {
  StructuredAgentSessionHostSession,
  StructuredAgentSessionProviderChildIdentity
} from './structured-agent-session-host-types'
import {
  pendingProviderChildWindDown,
  sameProviderChild
} from './structured-agent-session-provider-child'

export type StructuredAgentSessionUnprovenEndContext = {
  sessions: Map<string, StructuredAgentSessionHostSession>
  publishStatus?: (sessionId: string) => void
  wakeDelivery?: (sessionId: string) => void
  serialize: <T>(sessionId: string, task: () => Promise<T>) => Promise<T>
}

/** For a caller inside the session's serialize. A report for any other child is stale. */
export function recordUnprovenStructuredAgentSessionEndUnderSerialize(
  context: Omit<StructuredAgentSessionUnprovenEndContext, 'serialize'>,
  sessionId: string,
  ended: StructuredAgentSessionProviderChildIdentity
): void {
  const session = context.sessions.get(sessionId)
  const child = session?.child
  if (!session || !child || !sameProviderChild(child, ended)) {
    return
  }
  const cursor = session.journal.cursor()
  // A stop already owed for this child keeps its cause and ask; the end only adds that it failed.
  const owed = pendingProviderChildWindDown(session)
  session.owesProviderChildWindDown = owed
    ? { ...owed, failedAt: cursor }
    : {
        generation: child.generation,
        fence: child.fence,
        cause: 'host-stop',
        requestedAt: cursor,
        failedAt: cursor
      }
  context.publishStatus?.(sessionId)
  context.wakeDelivery?.(sessionId)
}

export function recordUnprovenStructuredAgentSessionEnd(
  context: StructuredAgentSessionUnprovenEndContext,
  event: StructuredAgentSessionEndUnprovenEvent
): Promise<void> {
  return context.serialize(event.sessionId, async () =>
    recordUnprovenStructuredAgentSessionEndUnderSerialize(context, event.sessionId, {
      generation: event.acquisitionGeneration,
      fence: event.fence
    })
  )
}

/** Whether an exit of `child` is what the stop owed for it was waiting on. */
export function structuredAgentSessionOwedStopAwaitsExit(
  session: Pick<StructuredAgentSessionHostSession, 'child' | 'owesProviderChildWindDown'>,
  child: StructuredAgentSessionProviderChildIdentity
): boolean {
  const owed = pendingProviderChildWindDown(session)
  return owed !== undefined && sameProviderChild(owed, child)
}
