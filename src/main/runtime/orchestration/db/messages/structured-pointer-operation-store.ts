import type { OrchestrationDb } from '../orchestration-db'

/** The live agent-session operation id backing one structured worker mailbox's pointer send. */
export type StructuredPointerOperationRow = {
  mailbox_handle: string
  session_id: string
  operation_id: string
  batch_fingerprint: string
  minted_at_ms: number
}

export function getStructuredPointerOperation(
  this: OrchestrationDb,
  mailboxHandle: string
): StructuredPointerOperationRow | undefined {
  return this.db
    .prepare('SELECT * FROM structured_pointer_operations WHERE mailbox_handle = ?')
    .get(mailboxHandle) as StructuredPointerOperationRow | undefined
}

export function putStructuredPointerOperation(
  this: OrchestrationDb,
  row: StructuredPointerOperationRow
): void {
  this.db
    .prepare(
      `INSERT INTO structured_pointer_operations
         (mailbox_handle, session_id, operation_id, batch_fingerprint, minted_at_ms)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(mailbox_handle) DO UPDATE SET
         session_id = excluded.session_id, operation_id = excluded.operation_id,
         batch_fingerprint = excluded.batch_fingerprint, minted_at_ms = excluded.minted_at_ms`
    )
    .run(
      row.mailbox_handle,
      row.session_id,
      row.operation_id,
      row.batch_fingerprint,
      row.minted_at_ms
    )
}

export function deleteStructuredPointerOperation(
  this: OrchestrationDb,
  mailboxHandle: string
): void {
  this.db
    .prepare('DELETE FROM structured_pointer_operations WHERE mailbox_handle = ?')
    .run(mailboxHandle)
}

/** Every send of orchestration's still on record for a session: mail pointers and preambles. */
export function listStructuredPointerOperationIds(
  this: OrchestrationDb,
  sessionId: string
): Set<string> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the SELECT names exactly this column.
  const rows = this.db
    .prepare(
      `SELECT operation_id FROM structured_pointer_operations WHERE session_id = ?
       UNION SELECT operation_id FROM dispatch_preamble_turns
        WHERE session_id = ? AND operation_id IS NOT NULL`
    )
    .all(sessionId, sessionId) as { operation_id: string }[]
  return new Set(rows.map((row) => row.operation_id))
}

export type StructuredPointerOperationStoreMethods = {
  listStructuredPointerOperationIds: typeof listStructuredPointerOperationIds
  getStructuredPointerOperation: typeof getStructuredPointerOperation
  putStructuredPointerOperation: typeof putStructuredPointerOperation
  deleteStructuredPointerOperation: typeof deleteStructuredPointerOperation
}

export function attachStructuredPointerOperationStore(ctor: { prototype: object }): void {
  Object.assign(ctor.prototype, {
    listStructuredPointerOperationIds,
    getStructuredPointerOperation,
    putStructuredPointerOperation,
    deleteStructuredPointerOperation
  })
}
