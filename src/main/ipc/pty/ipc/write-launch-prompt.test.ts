import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, args: unknown) => unknown>(),
  deliverTerminalAgentLaunchPrompt: vi.fn()
}))

vi.mock('../../pty-host-bindings', () => ({
  getPtyIpc: () => ({
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    handle: (channel: string, handler: (event: unknown, args: unknown) => unknown) =>
      mocks.handlers.set(channel, handler)
  })
}))

vi.mock('./write-input', () => ({
  createPtyWriteInput: () => ({
    writePtyInput: vi.fn(),
    writePtyInputAccepted: vi.fn(),
    isPtyWritePayload: () => true,
    isPtyViewportClaimPayload: () => true,
    isPtyWriteEventFromMainWindow: (event: { fromMainWindow?: boolean }) =>
      event.fromMainWindow === true
  })
}))

vi.mock('../../../runtime/rpc/methods/agent-launch-terminal-prompt', () => ({
  deliverTerminalAgentLaunchPrompt: mocks.deliverTerminalAgentLaunchPrompt
}))

import { installPtyWriteIpcHandlers } from './write'
import { HOST_LAUNCH_PROMPT_DIALOG_DEADLINE_MS } from '../../../../shared/host-launch-prompt-budget'

describe('pty:deliverAgentLaunchPrompt', () => {
  const resolveTerminalHandleForPty = vi.fn()
  const runtime = { resolveTerminalHandleForPty }

  beforeEach(() => {
    mocks.handlers.clear()
    mocks.deliverTerminalAgentLaunchPrompt.mockReset()
    resolveTerminalHandleForPty.mockReset()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler under test reaches only resolveTerminalHandleForPty and passes the runtime to the mocked writer.
    installPtyWriteIpcHandlers({ runtime: runtime as never })
  })

  const invoke = (event: unknown, args: unknown): unknown =>
    mocks.handlers.get('pty:deliverAgentLaunchPrompt')!(event, args)

  it('writes a local launch prompt through the host agent-prompt writer', async () => {
    resolveTerminalHandleForPty.mockReturnValue('term_local')
    mocks.deliverTerminalAgentLaunchPrompt.mockResolvedValue(true)

    await expect(
      invoke({ fromMainWindow: true }, { id: 'pty-1', text: 'long prompt' })
    ).resolves.toEqual({ outcome: 'handed-to-terminal' })
    expect(mocks.deliverTerminalAgentLaunchPrompt).toHaveBeenCalledWith({
      runtime,
      handle: 'term_local',
      text: 'long prompt',
      startupDialogDeadlineMs: HOST_LAUNCH_PROMPT_DIALOG_DEADLINE_MS
    })

    // The same terminal keeps one record, so asking again cannot paste twice.
    await expect(
      invoke({ fromMainWindow: true }, { id: 'pty-1', text: 'long prompt' })
    ).resolves.toEqual({ outcome: 'handed-to-terminal' })
    expect(mocks.deliverTerminalAgentLaunchPrompt).toHaveBeenCalledOnce()
  })

  it('answers not-delivered without writing for another window or an unknown PTY', async () => {
    resolveTerminalHandleForPty.mockReturnValue(null)
    const notDelivered = { outcome: 'not-delivered' }

    for (const [event, args] of [
      [{ fromMainWindow: false }, { id: 'pty-1', text: 'p' }],
      [{ fromMainWindow: true }, { id: 'pty-1', text: 'p' }],
      [{ fromMainWindow: true }, { id: '', text: 'p' }]
    ]) {
      await expect(invoke(event, args)).resolves.toEqual(notDelivered)
    }
    expect(mocks.deliverTerminalAgentLaunchPrompt).not.toHaveBeenCalled()
  })
})
