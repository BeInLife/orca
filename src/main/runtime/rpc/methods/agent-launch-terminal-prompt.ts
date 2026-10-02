/**
 * Host-side delivery of a launch's initial text to the terminal agent the launch just started.
 *
 * The twin of `agent-launch-structured-prompt`, and it exists for the same reason: `agent.launch`
 * created a terminal and reported the text as undelivered, which was only workable while the
 * surface that could paste — the desktop renderer's own pane — was also the one issuing the launch.
 * Mobile, the CLI and orchestration got an agent and no prompt. The host owns the PTY, so it can
 * write into one whether or not any window is open on it.
 *
 * This is the half argv cannot serve. A prompt the built launch command can carry rides it instead,
 * in the process's argv at exec time with no readiness race. What reaches here is a prompt the
 * command could not carry — the agent takes no prompt argument, or the text is too long for the
 * host's command line — and a reused terminal, whose process was already running before this launch
 * existed. `agent.launch`, `terminal.createAgentSession` and local desktop launches all write here.
 *
 * Nothing here writes to a PTY itself. `sendTerminalAgentPrompt` is the runtime's one agent-prompt
 * writer: it frames the text as a bracketed paste so multi-line and special-character content is
 * not read as keystrokes, serializes concurrent submissions per PTY, pins the lifecycle generation
 * so a respawn cannot inherit the previous incarnation's text, and applies the per-agent submit
 * timing. It routes to local, WSL and SSH transports alike. Orchestration's worker dispatch
 * delivers a preamble through exactly this pair of calls.
 */

import { randomUUID } from 'node:crypto'
import { isAgentPromptStalledError } from '../../agent-prompt-submission-verification'
import type { LaunchPromptWritingRuntime } from '../../host-launch-prompt-deliveries'
import { HOST_LAUNCH_PROMPT_READY_TIMEOUT_MS } from '../../../../shared/host-launch-prompt-budget'

// How soon a launch held by a startup dialog looks again for the composer.
const STARTUP_DIALOG_RECHECK_MS = 1_000

/**
 * Whether the text reached the pane.
 *
 * `false` is the answer for every failure, on the same rule the structured twin follows: a launch
 * whose agent is already running must not fail because its text did not land — the caller can
 * resend under `not-delivered`, but it cannot un-create a workspace.
 *
 * A stalled submission is deliberately `true`. The stall is raised by the verifier that runs AFTER
 * the write, so it proves only that a turn start went unobserved, never that the paste is missing.
 * Reporting it as undelivered would invite a resend that pastes the whole prompt a second time into
 * an agent already working on it — the failure `coordinator-task-dispatch` documents at its own
 * send. Here the usual preference flips: under-claiming normally costs one wasted resend, but a
 * resend into a live TUI costs a duplicate turn.
 */
export async function deliverTerminalAgentLaunchPrompt(args: {
  runtime: LaunchPromptWritingRuntime
  handle: string
  text: string
  /**
   * How long a startup dialog may hold the delivery open while a person answers it. Unset, a dialog
   * ends the delivery at once — `agent.launch`'s awaited receipt keeps that contract.
   */
  startupDialogDeadlineMs?: number
}): Promise<boolean> {
  if (args.text.trim().length === 0) {
    return false
  }
  try {
    if (!(await waitForLaunchComposer(args))) {
      return false
    }
    const sent = await args.runtime.sendTerminalAgentPrompt(args.handle, args.text, {
      inputKind: 'launch',
      // Paired: together these take the queued path, which settles an unobserved turn start into
      // an `input_accepted` receipt rather than raising it. Without the id the write is verified
      // strictly and a slow first turn throws.
      acceptQueued: true,
      requestId: randomUUID(),
      // The launch reply should not wait out a turn that has already been handed over; what the
      // agent does with the text is the pane's to show, and no receipt arm claims it.
      observationTimeoutMs: 0
    })
    return sent.accepted
  } catch (error) {
    if (isAgentPromptStalledError(error)) {
      return true
    }
    console.warn(
      '[agent-launch] the terminal agent started, its launch prompt was not delivered',
      error
    )
    return false
  }
}

/**
 * Whether the agent's composer opened. A startup dialog is never pasted into: that would answer
 * whatever question is on screen with the prompt. With a dialog deadline the wait re-arms while
 * the dialog is up — answering it repaints the screen, and the next wait sees the composer — and
 * the composer gets a fresh readiness budget once the dialog is gone.
 */
async function waitForLaunchComposer(args: {
  runtime: LaunchPromptWritingRuntime
  handle: string
  startupDialogDeadlineMs?: number
}): Promise<boolean> {
  const dialogDeadline = Date.now() + (args.startupDialogDeadlineMs ?? 0)
  let readyBy = Date.now() + HOST_LAUNCH_PROMPT_READY_TIMEOUT_MS
  for (;;) {
    const wait = await args.runtime.waitForTerminal(args.handle, {
      condition: 'tui-idle',
      timeoutMs: Math.max(1, readyBy - Date.now())
    })
    // Why before `satisfied`: a wait on an exited pane re-reads its last screen, which can look ready.
    if (wait?.status === 'exited') {
      console.warn('[agent-launch] the terminal agent exited; its launch prompt was not delivered')
      return false
    }
    if (!wait || wait.satisfied) {
      return true
    }
    // Only a startup dialog holds the delivery open, and only until its deadline.
    if (!wait.blockedReason || Date.now() >= dialogDeadline) {
      console.warn(
        `[agent-launch] the terminal agent did not become ready (${wait.blockedReason ?? wait.status}); its launch prompt was not delivered`
      )
      return false
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(STARTUP_DIALOG_RECHECK_MS, dialogDeadline - Date.now()))
    )
    readyBy = Math.max(readyBy, Date.now() + HOST_LAUNCH_PROMPT_READY_TIMEOUT_MS)
  }
}
