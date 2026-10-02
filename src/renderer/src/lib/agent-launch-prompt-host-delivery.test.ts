import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type FakeState = { ptyIdsByTabId: Record<string, string[]> }

const store = vi.hoisted(() => {
  let state: FakeState = { ptyIdsByTabId: {} }
  const listeners = new Set<(next: FakeState) => void>()
  return {
    getState: () => state,
    subscribe: (listener: (next: FakeState) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next: FakeState) {
      state = next
      listeners.forEach((listener) => listener(state))
    },
    reset() {
      state = { ptyIdsByTabId: {} }
      listeners.clear()
    }
  }
})

vi.mock('@/store', () => ({ useAppStore: store }))

import { deliverLaunchPromptThroughHost } from './agent-launch-prompt-host-delivery'

describe('deliverLaunchPromptThroughHost', () => {
  const deliverAgentLaunchPrompt = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    store.reset()
    deliverAgentLaunchPrompt.mockReset()
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      api: { pty: { deliverAgentLaunchPrompt } }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('waits for the tab’s PTY, then hands the prompt to the host writer', async () => {
    deliverAgentLaunchPrompt.mockResolvedValue(true)
    const onTimeout = vi.fn()

    const delivery = deliverLaunchPromptThroughHost({ tabId: 'tab-1', content: 'p', onTimeout })
    store.set({ ptyIdsByTabId: { 'tab-1': ['pty-1'] } })

    await expect(delivery).resolves.toBe(true)
    expect(deliverAgentLaunchPrompt).toHaveBeenCalledWith('pty-1', 'p')
    expect(onTimeout).not.toHaveBeenCalled()
  })

  it('reports a launch whose PTY never appeared', async () => {
    const onTimeout = vi.fn()

    const delivery = deliverLaunchPromptThroughHost({ tabId: 'tab-1', content: 'p', onTimeout })
    await vi.advanceTimersByTimeAsync(8000)

    await expect(delivery).resolves.toBe(false)
    expect(deliverAgentLaunchPrompt).not.toHaveBeenCalled()
    expect(onTimeout).toHaveBeenCalledOnce()
  })

  it('reports a prompt the host could not deliver', async () => {
    deliverAgentLaunchPrompt.mockResolvedValue(false)
    store.set({ ptyIdsByTabId: { 'tab-1': ['pty-1'] } })
    const onTimeout = vi.fn()

    await expect(
      deliverLaunchPromptThroughHost({ tabId: 'tab-1', content: 'p', onTimeout })
    ).resolves.toBe(false)
    expect(onTimeout).toHaveBeenCalledOnce()
  })
})
