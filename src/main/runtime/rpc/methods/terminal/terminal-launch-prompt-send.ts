import type { z } from 'zod'
import type { RuntimeTerminalSend } from '../../../../../shared/runtime-types'
import { InvalidArgumentError } from '../../core'
import type { OrcaRuntimeService } from '../../../orca-runtime'
import { deliverTerminalAgentLaunchPrompt } from '../agent-launch-terminal-prompt'
import type { TerminalSend } from './unary-schemas'

/**
 * `terminal.send` with `launchPrompt`: the launch text a create deferred, written by the same host
 * writer `agent.launch` uses (TUI-ready wait, one bracketed paste, launch input), never the raw
 * text-plus-Enter path a plain send takes for agents other than Claude and Codex.
 */
export async function sendTerminalLaunchPrompt(
  runtime: Pick<OrcaRuntimeService, 'waitForTerminal' | 'sendTerminalAgentPrompt'>,
  params: z.infer<typeof TerminalSend>
): Promise<RuntimeTerminalSend> {
  if (
    !params.text?.trim() ||
    params.enter === true ||
    params.interrupt === true ||
    params.agentPrompt === true ||
    params.inputKind !== undefined ||
    params.requireAgentStatus !== undefined ||
    params.waitSubmitMs !== undefined ||
    params.resolvedLaunchDraft !== undefined
  ) {
    throw new InvalidArgumentError('Invalid terminal launch prompt')
  }
  const delivered = await deliverTerminalAgentLaunchPrompt({
    runtime,
    handle: params.terminal,
    text: params.text
  })
  return {
    handle: params.terminal,
    accepted: delivered,
    bytesWritten: delivered ? Buffer.byteLength(params.text, 'utf8') : 0
  }
}
