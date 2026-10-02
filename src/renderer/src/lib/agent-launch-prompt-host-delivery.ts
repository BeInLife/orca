import { useAppStore } from '@/store'

// Why: matches the renderer paste's spawn budget; a PTY missing this long means the launch failed.
const PTY_SPAWN_TIMEOUT_MS = 8000

/**
 * Hands a launch prompt the command line could not carry to the host's agent-prompt writer —
 * the one `agent.launch` and paired hosts use (TUI-ready wait, one bracketed paste, Enter after
 * the paste is ingested) — once the tab's PTY exists. `onTimeout` fires for every failure.
 */
export async function deliverLaunchPromptThroughHost(args: {
  tabId: string
  content: string
  onTimeout?: () => void
}): Promise<boolean> {
  const ptyId = await waitForTabPtyId(args.tabId, PTY_SPAWN_TIMEOUT_MS)
  const delivered = ptyId
    ? await window.api.pty.deliverAgentLaunchPrompt(ptyId, args.content).catch(() => false)
    : false
  if (!delivered) {
    args.onTimeout?.()
  }
  return delivered
}

function waitForTabPtyId(tabId: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | null = null
    let timer: number | null = null
    let settled = false
    const finish = (ptyId: string | null): void => {
      if (settled) {
        return
      }
      settled = true
      unsubscribe?.()
      if (timer !== null) {
        window.clearTimeout(timer)
      }
      resolve(ptyId)
    }
    const read = (state: ReturnType<typeof useAppStore.getState>): void => {
      const ptyId = state.ptyIdsByTabId[tabId]?.[0]
      if (ptyId) {
        finish(ptyId)
      }
    }
    timer = window.setTimeout(() => finish(null), timeoutMs)
    unsubscribe = useAppStore.subscribe(read)
    read(useAppStore.getState())
  })
}
