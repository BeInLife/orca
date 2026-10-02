import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { RpcRequest } from './core'
import { RpcDispatcher } from './dispatcher'
import { TERMINAL_METHODS } from './methods/terminal'

function makeRequest(params: unknown): RpcRequest {
  return { id: 'request', authToken: 'token', method: 'terminal.send', params }
}

function makeRuntime(overrides: Partial<OrcaRuntimeService>): OrcaRuntimeService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dispatcher reaches only the stubbed members, and each test asserts the calls made.
  return { getRuntimeId: () => 'test-runtime', ...overrides } as OrcaRuntimeService
}

describe('terminal.send launchPrompt', () => {
  it('writes a deferred launch prompt through the host launch writer for any agent', async () => {
    const sendTerminal = vi.fn()
    const isTerminalRunningSettledPromptAgent = vi.fn().mockResolvedValue(false)
    const waitForTerminal = vi.fn().mockResolvedValue({ satisfied: true, status: 'idle' })
    const sendTerminalAgentPrompt = vi
      .fn()
      .mockResolvedValue({ handle: 'terminal-1', accepted: true, bytesWritten: 20 })
    const runtime = makeRuntime({
      resolveLiveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-1' }),
      getDriver: vi.fn().mockReturnValue({ kind: 'idle' }),
      isTerminalRunningSettledPromptAgent,
      waitForTerminal,
      sendTerminal,
      sendTerminalAgentPrompt
    })
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest({ terminal: 'terminal-1', text: 'line one\nline two', launchPrompt: true })
    )

    expect(response).toMatchObject({ ok: true, result: { send: { accepted: true } } })
    expect(waitForTerminal).toHaveBeenCalledWith(
      'terminal-1',
      expect.objectContaining({
        condition: 'tui-idle'
      })
    )
    expect(sendTerminalAgentPrompt).toHaveBeenCalledWith(
      'terminal-1',
      'line one\nline two',
      expect.objectContaining({ inputKind: 'launch' })
    )
    // Never the raw text-plus-Enter write a plain send takes for agents other than Claude/Codex.
    expect(sendTerminal).not.toHaveBeenCalled()
    expect(isTerminalRunningSettledPromptAgent).not.toHaveBeenCalled()
  })

  it('answers not accepted when the agent never became ready', async () => {
    const sendTerminalAgentPrompt = vi.fn()
    const runtime = makeRuntime({
      resolveLiveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-1' }),
      getDriver: vi.fn().mockReturnValue({ kind: 'idle' }),
      waitForTerminal: vi.fn().mockResolvedValue({ satisfied: false, status: 'timeout' }),
      sendTerminalAgentPrompt
    })
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest({ terminal: 'terminal-1', text: 'review', launchPrompt: true })
    )

    expect(response).toMatchObject({ ok: true, result: { send: { accepted: false } } })
    expect(sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })

  it('refuses launchPrompt combined with a submit of its own', async () => {
    const runtime = makeRuntime({
      resolveLiveLeafForHandle: vi.fn().mockReturnValue({ ptyId: 'pty-1' }),
      getDriver: vi.fn().mockReturnValue({ kind: 'idle' })
    })
    const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest({ terminal: 'terminal-1', text: 'review', enter: true, launchPrompt: true })
    )

    expect(response.ok).toBe(false)
  })
})
