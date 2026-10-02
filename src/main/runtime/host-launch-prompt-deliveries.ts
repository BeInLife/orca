import type { AgentSessionLaunchPromptDisposal } from '../../shared/agent-session-host-authority'

// Why: long enough for a client that reconnects to read the outcome, short enough that a settled
// record does not outlive any reason to ask; the delivery itself ends within its own budget.
const SETTLED_RECORD_RETENTION_MS = 10 * 60_000

type Delivery = {
  settled: Promise<AgentSessionLaunchPromptDisposal>
  outcome: AgentSessionLaunchPromptDisposal | null
}

/**
 * Launch prompts a host owes to terminals it started without them, keyed by terminal handle.
 *
 * The host starts the write itself, so it survives the client that asked for the launch; a client
 * only observes how it ended. One record per handle makes a retried or reclaimed create a no-op.
 * A record ends with its delivery (written, readiness timeout, or terminal gone), then expires.
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
        (delivered): AgentSessionLaunchPromptDisposal => ({
          outcome: delivered ? 'handed-to-terminal' : 'not-delivered'
        }),
        (): AgentSessionLaunchPromptDisposal => ({ outcome: 'not-delivered' })
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
   * A handle with no record — never owed one, or a host restart dropped it — under-claims as
   * `not-delivered`, the same rule `agent.launch` receipts follow.
   */
  async observe(handle: string, signal?: AbortSignal): Promise<AgentSessionLaunchPromptDisposal> {
    const delivery = this.deliveries.get(handle)
    if (!delivery) {
      return { outcome: 'not-delivered' }
    }
    if (delivery.outcome) {
      return delivery.outcome
    }
    if (!signal) {
      return await delivery.settled
    }
    return await new Promise((resolve, reject) => {
      const onAbort = (): void => reject(new Error('request_aborted'))
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      void delivery.settled.then((outcome) => {
        signal.removeEventListener('abort', onAbort)
        resolve(outcome)
      })
    })
  }
}

const deliveriesByOwner = new WeakMap<object, HostLaunchPromptDeliveries>()

/** The registry for one runtime, so its creates and its `terminal.wait` share it. */
export function hostLaunchPromptDeliveriesFor(owner: object): HostLaunchPromptDeliveries {
  let deliveries = deliveriesByOwner.get(owner)
  if (!deliveries) {
    deliveries = new HostLaunchPromptDeliveries()
    deliveriesByOwner.set(owner, deliveries)
  }
  return deliveries
}
