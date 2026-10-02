import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcContext } from '../core'

const mocks = vi.hoisted(() => ({ deliverTerminalAgentLaunchPrompt: vi.fn() }))

vi.mock('./agent-launch-terminal-prompt', () => ({
  deliverTerminalAgentLaunchPrompt: mocks.deliverTerminalAgentLaunchPrompt
}))

import { agentLaunchSurfaceFactory } from './agent-launch-surfaces'

const PROMPT = { text: 'review the change', delivery: 'submit' } as const

function factory() {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: terminal prompt delivery reads only `runtime` off the context, and the writer it calls is mocked.
  const context = { runtime: {} } as unknown as RpcContext
  return { context, surfaces: agentLaunchSurfaceFactory(context) }
}

describe('agent.launch terminal prompt delivery', () => {
  beforeEach(() => {
    mocks.deliverTerminalAgentLaunchPrompt.mockReset()
    mocks.deliverTerminalAgentLaunchPrompt.mockResolvedValue(true)
  })

  it('keeps one record for a terminal this launch started, with its own readiness budget', async () => {
    const { context, surfaces } = factory()

    const first = await surfaces.deliverTerminalPrompt!({
      handle: 'term_fresh',
      prompt: PROMPT,
      startedByThisLaunch: true
    })
    const replay = await surfaces.deliverTerminalPrompt!({
      handle: 'term_fresh',
      prompt: PROMPT,
      startedByThisLaunch: true
    })

    expect([first, replay]).toEqual([true, true])
    expect(mocks.deliverTerminalAgentLaunchPrompt).toHaveBeenCalledOnce()
    // No startup-dialog deadline: agent.launch's awaited receipt keeps its fail-fast contract.
    expect(mocks.deliverTerminalAgentLaunchPrompt).toHaveBeenCalledWith({
      runtime: context.runtime,
      handle: 'term_fresh',
      text: PROMPT.text
    })
  })

  it('writes each launch into a reused terminal, which owes nothing once per handle', async () => {
    const { surfaces } = factory()

    await surfaces.deliverTerminalPrompt!({ handle: 'term_reused', prompt: PROMPT })
    await surfaces.deliverTerminalPrompt!({ handle: 'term_reused', prompt: PROMPT })

    expect(mocks.deliverTerminalAgentLaunchPrompt).toHaveBeenCalledTimes(2)
  })
})
