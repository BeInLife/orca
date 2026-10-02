import type { AppState } from '@/store/types'
import {
  MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH,
  terminalQuickCommandAgentPromptMaxLength
} from '../../../shared/terminal-quick-commands'
import { parseExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import { lastVerifiedRuntimeStatus } from '../../../shared/runtime-host-status'

/** The agent-prompt cap of the host a quick command is saved on, read from its live status. */
export function getTerminalQuickCommandHostPromptMaxLength(
  state: Pick<AppState, 'runtimeStatusByEnvironmentId'>,
  hostId: ExecutionHostId
): number {
  const parsed = parseExecutionHostId(hostId)
  if (!parsed || parsed.kind !== 'runtime') {
    return MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH
  }
  return terminalQuickCommandAgentPromptMaxLength(
    lastVerifiedRuntimeStatus(state.runtimeStatusByEnvironmentId.get(parsed.environmentId))
      ?.capabilities
  )
}
