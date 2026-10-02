// Why: older hosts lack the targeted settings RPCs and strip agentPrompt from
// terminal creation, so mobile must hide Quick Commands unless both are present.
export const TERMINAL_QUICK_COMMANDS_RUNTIME_CAPABILITY = 'terminal.quick-commands.v1' as const
// Why: prompts used to be capped at 6,000 characters. A host advertising this stores prompts up to
// MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH; a client advertising it can read them, so the host
// withholds longer prompts from older clients, which reject a whole list holding one. A client
// also reads it as "this host defers a launch prompt its command line cannot carry"; retiring it
// retires the client paste rules that stand in for older hosts (pairedHostMustPasteLongPrompt,
// legacyAgentLaunchFor). Transitional once no supported release lacks it.
export const TERMINAL_QUICK_COMMAND_LONG_PROMPTS_RUNTIME_CAPABILITY =
  'terminal.quick-commands.long-prompts.v1' as const

export const TERMINAL_QUICK_COMMAND_RUNTIME_CAPABILITIES = [
  TERMINAL_QUICK_COMMANDS_RUNTIME_CAPABILITY,
  TERMINAL_QUICK_COMMAND_LONG_PROMPTS_RUNTIME_CAPABILITY
] as const
