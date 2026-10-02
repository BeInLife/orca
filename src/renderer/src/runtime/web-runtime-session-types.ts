import type {
  AgentProviderSessionMetadata,
  SleepingAgentLaunchConfig
} from '../../../shared/agent-session-resume'
import type {
  AgentLaunchPreferences,
  AgentPromptDelivery
} from '../../../shared/agent-session-host-authority'
import type { StartupCommandDelivery } from '../../../shared/codex-startup-delivery'
import type { RuntimeTerminalCreate } from '../../../shared/runtime-types'
import type { TuiAgent } from '../../../shared/tui-agent'

export type WebRuntimeTerminalCreateOutcome =
  | { status: 'created' }
  | { status: 'failed'; message: string }

export type CreateWebRuntimeSessionTerminalArgs = {
  worktreeId: string
  environmentId?: string | null
  afterTabId?: string
  targetGroupId?: string
  command?: string
  cwd?: string
  env?: Record<string, string>
  envToDelete?: string[]
  startupCommandDelivery?: StartupCommandDelivery
  launchConfig?: SleepingAgentLaunchConfig
  launchToken?: string
  agent?: TuiAgent
  launchAgent?: TuiAgent
  /** The command already encodes the complete agent startup and prompt-delivery plan. */
  preparedAgentCommand?: boolean
  agentSessionKind?: 'fresh' | 'resume'
  prompt?: string
  promptDelivery?: AgentPromptDelivery
  /** This caller delivers a prompt the host's launch command cannot carry (see the reply). */
  deferOversizedPrompt?: boolean
  /** Explicit CLI override; omission leaves the remote host's defaults authoritative. */
  agentArgs?: string | null
  launchPreferences?: AgentLaunchPreferences
  providerSession?: AgentProviderSessionMetadata
  viewMode?: 'terminal' | 'chat'
  activate?: boolean
  selectWorktree?: boolean
}

export type CreatedWebRuntimeSessionTerminal = {
  outcome: WebRuntimeTerminalCreateOutcome
  hostTabId?: string
  /** The host started the agent without the prompt; the caller delivers it to this terminal. */
  deferredLaunchPrompt?: { environmentId: string; terminal: string }
}

export type CreatedAgentTerminalIdentity = Pick<
  RuntimeTerminalCreate,
  'tabId' | 'paneKey' | 'startupPromptDeferred'
> & {
  leafId?: string
  handle?: string
}
