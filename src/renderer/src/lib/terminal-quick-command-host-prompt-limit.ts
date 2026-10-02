import type { AppState } from '@/store/types'
import { LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../../../shared/terminal-quick-commands'
import { parseExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'

/** The host's agent-prompt cap; `null` means none. An unprobed host is treated as an older one. */
export function getTerminalQuickCommandHostPromptMaxLength(
  state: Pick<AppState, 'runtimeTerminalQuickCommands'>,
  hostId: ExecutionHostId
): number | null {
  const parsed = parseExecutionHostId(hostId)
  if (!parsed || parsed.kind !== 'runtime') {
    return null
  }
  return state.runtimeTerminalQuickCommands.get(parsed.environmentId)?.acceptsLongPrompts === true
    ? null
    : LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH
}
