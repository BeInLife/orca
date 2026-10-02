/** How long the agent's composer may take to open before the host gives up on a launch prompt. */
export const HOST_LAUNCH_PROMPT_READY_TIMEOUT_MS = 60_000

/**
 * How long a startup dialog (folder trust, an update, a model migration) may hold a host-owned
 * launch prompt open. The person who just launched the agent is at the screen; reading and answering
 * such a dialog takes seconds, and five minutes also covers stepping away briefly, while still
 * bounding an obligation nobody will finish.
 */
export const HOST_LAUNCH_PROMPT_DIALOG_DEADLINE_MS = 5 * 60_000

/** How long a client watches for that delivery to end: every budget above, plus the paste itself. */
export const HOST_LAUNCH_PROMPT_OBSERVE_WINDOW_MS =
  HOST_LAUNCH_PROMPT_DIALOG_DEADLINE_MS + HOST_LAUNCH_PROMPT_READY_TIMEOUT_MS + 60_000
