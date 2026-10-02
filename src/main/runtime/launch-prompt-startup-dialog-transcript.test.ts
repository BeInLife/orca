/**
 * A host-owned launch prompt held by Claude's first-launch trust dialog, replayed from the captured
 * transcript in which a person answered it (`__fixtures__/claude-dialog-trust-workspace-answered`).
 *
 * The capture is split where the dialog has finished painting and before the keypress that answers
 * it, so the runtime's real readiness rules see the dialog first and the composer after.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTranscriptPane, TRANSCRIPT_PANE_PTY_ID } from './agent-transcript-pane-test-harness'
import { deliverTerminalAgentLaunchPrompt } from './rpc/methods/agent-launch-terminal-prompt'
import { HOST_LAUNCH_PROMPT_DIALOG_DEADLINE_MS } from '../../shared/host-launch-prompt-budget'

const CAPTURE = 'claude-dialog-trust-workspace-answered'
// The dialog's terminal queries end its paint; the answer's repaint starts with this charset reset.
const ANSWER_STARTS_AT = '\x1b(B\x0f'

function readCapture(): { dialog: string; answer: string; size: { cols: number; rows: number } } {
  const base = join(__dirname, '__fixtures__', CAPTURE)
  const data = readFileSync(`${base}.txt`, 'utf8')
  const meta: { cols: number; rows: number } = JSON.parse(readFileSync(`${base}.meta.json`, 'utf8'))
  const split = data.indexOf(ANSWER_STARTS_AT, data.indexOf('cancel'))
  return {
    dialog: data.slice(0, split),
    answer: data.slice(split),
    size: { cols: meta.cols, rows: meta.rows }
  }
}

async function paneShowingTheDialog() {
  const { dialog, answer, size } = readCapture()
  const pane = await createTranscriptPane({
    paneTitle: 'Claude Code',
    foregroundProcess: 'claude',
    launchAgent: 'claude',
    size,
    data: ''
  })
  // Pane creation awaits real timers; replay and polling use the virtual clock.
  vi.useFakeTimers()
  const write = (text: string): void => {
    const bytes = Buffer.from(text, 'utf8')
    const decoder = new TextDecoder()
    for (let offset = 0; offset < bytes.length; offset += 1024) {
      pane.runtime.onPtyData(
        TRANSCRIPT_PANE_PTY_ID,
        decoder.decode(bytes.subarray(offset, offset + 1024), { stream: true }),
        Date.now()
      )
    }
  }
  write(dialog)
  const send = vi
    .spyOn(pane.runtime, 'sendTerminalAgentPrompt')
    .mockResolvedValue({ handle: pane.handle, accepted: true, bytesWritten: 1 })
  return {
    ...pane,
    send,
    answerDialog: () => write(answer),
    exitAgent: () => pane.runtime.onPtyExit(TRANSCRIPT_PANE_PTY_ID, 0)
  }
}

describe('a host-owned launch prompt held by a startup dialog', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits while the dialog is up, never pastes into it, and delivers once it is answered', async () => {
    const pane = await paneShowingTheDialog()
    const settled = vi.fn()
    const delivery = deliverTerminalAgentLaunchPrompt({
      runtime: pane.runtime,
      handle: pane.handle,
      text: 'review the change',
      startupDialogDeadlineMs: HOST_LAUNCH_PROMPT_DIALOG_DEADLINE_MS
    })
    void delivery.then(settled)

    // A person reads the dialog for half a minute; nothing may land in it meanwhile.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(pane.send).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()

    pane.answerDialog()
    await vi.advanceTimersByTimeAsync(15_000)

    await expect(delivery).resolves.toBe(true)
    expect(pane.send).toHaveBeenCalledOnce()
    expect(pane.send).toHaveBeenCalledWith(
      pane.handle,
      'review the change',
      expect.objectContaining({ inputKind: 'launch' })
    )
  })

  it('gives up at the deadline when nobody answers, still without pasting', async () => {
    const pane = await paneShowingTheDialog()
    const delivery = deliverTerminalAgentLaunchPrompt({
      runtime: pane.runtime,
      handle: pane.handle,
      text: 'review the change',
      startupDialogDeadlineMs: HOST_LAUNCH_PROMPT_DIALOG_DEADLINE_MS
    })

    await vi.advanceTimersByTimeAsync(HOST_LAUNCH_PROMPT_DIALOG_DEADLINE_MS + 5_000)

    await expect(delivery).resolves.toBe(false)
    expect(pane.send).not.toHaveBeenCalled()
  })

  it('does not paste when the agent exits while the dialog wait is paused', async () => {
    const pane = await paneShowingTheDialog()
    const waitForTerminal = pane.runtime.waitForTerminal.bind(pane.runtime)
    const firstWait = vi.fn()
    // The agent exits as soon as the first wait reports the dialog, before the re-check runs.
    vi.spyOn(pane.runtime, 'waitForTerminal').mockImplementationOnce(async (handle, options) => {
      const wait = await waitForTerminal(handle, options)
      firstWait(wait)
      pane.exitAgent()
      return wait
    })
    const delivery = deliverTerminalAgentLaunchPrompt({
      runtime: pane.runtime,
      handle: pane.handle,
      text: 'review the change',
      startupDialogDeadlineMs: HOST_LAUNCH_PROMPT_DIALOG_DEADLINE_MS
    })
    await vi.advanceTimersByTimeAsync(15_000)

    expect(firstWait).toHaveBeenCalledWith(
      expect.objectContaining({ satisfied: false, blockedReason: 'agent-trust-workspace' })
    )
    await expect(delivery).resolves.toBe(false)
    expect(pane.send).not.toHaveBeenCalled()
  })

  it('does not paste for agent.launch into an agent that exited after the dialog was answered', async () => {
    const pane = await paneShowingTheDialog()
    pane.answerDialog()
    await vi.advanceTimersByTimeAsync(15_000)
    pane.exitAgent()
    const delivery = deliverTerminalAgentLaunchPrompt({
      runtime: pane.runtime,
      handle: pane.handle,
      text: 'review the change'
    })
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(delivery).resolves.toBe(false)
    expect(pane.send).not.toHaveBeenCalled()
  })

  it('keeps agent.launch failing fast on a dialog when no deadline is given', async () => {
    const pane = await paneShowingTheDialog()
    const delivery = deliverTerminalAgentLaunchPrompt({
      runtime: pane.runtime,
      handle: pane.handle,
      text: 'review the change'
    })

    await vi.advanceTimersByTimeAsync(5_000)

    await expect(delivery).resolves.toBe(false)
    expect(pane.send).not.toHaveBeenCalled()
  })
})
