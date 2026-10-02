import type { TerminalLaunchPromptDisposal } from '../../shared/agent-launch-intent'
import { AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS } from '../../shared/agent-session-host-authority'
import type { OrcaRuntimeService } from './orca-runtime'

/** The runtime that writes launch prompts into its terminals, and so owns their records. */
export type LaunchPromptWritingRuntime = Pick<
  OrcaRuntimeService,
  'waitForTerminal' | 'sendTerminalAgentPrompt'
>

// Why the create ledger's age: a replayed create re-sends its `pending` reply for that long, so the
// record it points at must still answer; it holds only an outcome, never the prompt.
const SETTLED_RECORD_RETENTION_MS = AGENT_SESSION_MAX_NEW_OPERATION_AGE_MS

/** No record: never owed a prompt, expired, or lost to a host restart. Unknown, never a failure. */
export const LAUNCH_PROMPT_UNKNOWN_ERROR = 'launch_prompt_unknown'

type Delivery = {
  settled: Promise<TerminalLaunchPromptDisposal>
  outcome: TerminalLaunchPromptDisposal | null
}

/**
 * Launch prompts a host owes to terminals it started without them, keyed by terminal handle.
 *
 * The host starts the write itself, so it survives the client that asked for the launch; a client
 * only observes how it ended. One record per handle makes a retried or reclaimed create a no-op.
 * A record ends with its delivery (written, a deadline, or the terminal gone), then expires.
 */
export class HostLaunchPromptDeliveries {
  private readonly deliveries = new Map<string, Delivery>()

  /** Starts `deliver` for this terminal unless a delivery for it already exists. */
  start(handle: string, deliver: () => Promise<boolean>): void {
    if (this.deliveries.has(handle)) {
      return
    }
    const delivery: Delivery = {
      outcome: null,
      settled: deliver().then(
        (delivered): TerminalLaunchPromptDisposal => ({
          outcome: delivered ? 'handed-to-terminal' : 'not-delivered'
        }),
        (): TerminalLaunchPromptDisposal => ({ outcome: 'not-delivered' })
      )
    }
    this.deliveries.set(handle, delivery)
    void delivery.settled.then((outcome) => {
      delivery.outcome = outcome
      const expiry = setTimeout(() => {
        if (this.deliveries.get(handle) === delivery) {
          this.deliveries.delete(handle)
        }
      }, SETTLED_RECORD_RETENTION_MS)
      expiry.unref?.()
    })
  }

  /**
   * How this terminal's launch prompt delivery ended, waiting for it if it has not. Read-only.
   * Rejects with `launch_prompt_unknown` when there is no record, and `timeout` past `timeoutMs`.
   */
  async observe(
    handle: string,
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<TerminalLaunchPromptDisposal> {
    const delivery = this.deliveries.get(handle)
    if (!delivery) {
      throw new Error(LAUNCH_PROMPT_UNKNOWN_ERROR)
    }
    if (delivery.outcome) {
      return delivery.outcome
    }
    const { signal, timeoutMs } = options
    return await new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (): void => {
        signal?.removeEventListener('abort', onAbort)
        if (timer !== undefined) {
          clearTimeout(timer)
        }
      }
      const onAbort = (): void => {
        finish()
        reject(new Error('request_aborted'))
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (typeof timeoutMs === 'number' && timeoutMs > 0) {
        timer = setTimeout(() => {
          finish()
          reject(new Error('timeout'))
        }, timeoutMs)
      }
      void delivery.settled.then((outcome) => {
        finish()
        resolve(outcome)
      })
    })
  }
}

const deliveriesByOwner = new WeakMap<LaunchPromptWritingRuntime, HostLaunchPromptDeliveries>()

/** The registry for one runtime, so its creates and its `terminal.wait` share it. */
export function hostLaunchPromptDeliveriesFor(
  owner: LaunchPromptWritingRuntime
): HostLaunchPromptDeliveries {
  let deliveries = deliveriesByOwner.get(owner)
  if (!deliveries) {
    deliveries = new HostLaunchPromptDeliveries()
    deliveriesByOwner.set(owner, deliveries)
  }
  return deliveries
}
