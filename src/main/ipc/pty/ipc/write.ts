import type { PtyRendererDelivery } from '../session'
import { getPtyIpc } from '../../pty-host-bindings'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import { createPtyWriteInput } from './write-input'
import type { TerminalLaunchPromptDisposal } from '../../../../shared/agent-launch-intent'
import { deliverTerminalAgentLaunchPrompt } from '../../../runtime/rpc/methods/agent-launch-terminal-prompt'
import { hostLaunchPromptDeliveriesFor } from '../../../runtime/host-launch-prompt-deliveries'
import { HOST_LAUNCH_PROMPT_DIALOG_DEADLINE_MS } from '../../../../shared/host-launch-prompt-budget'

function isLaunchPromptPayload(args: unknown): args is { id: string; text: string } {
  return (
    typeof args === 'object' &&
    args !== null &&
    'id' in args &&
    typeof args.id === 'string' &&
    args.id.length > 0 &&
    'text' in args &&
    typeof args.text === 'string'
  )
}

export function installPtyWriteIpcHandlers(deps: {
  mainWindow?: PtyRendererDelivery
  runtime?: OrcaRuntimeService
}): void {
  const ipcMain = getPtyIpc()
  const { runtime } = deps
  const {
    writePtyInput,
    writePtyInputAccepted,
    isPtyWritePayload,
    isPtyViewportClaimPayload,
    isPtyWriteEventFromMainWindow
  } = createPtyWriteInput(deps)

  const hostViewportClaimTails = new Map<string, Promise<boolean>>()

  ipcMain.on('pty:write', (event, args: unknown) => {
    if (!isPtyWriteEventFromMainWindow(event) || !isPtyWritePayload(args)) {
      return
    }
    const claimTail = hostViewportClaimTails.get(args.id)
    if (claimTail) {
      void claimTail.then((claimed) => (claimed ? writePtyInput(args) : false))
      return
    }
    writePtyInput(args)
  })
  ipcMain.handle('pty:writeAccepted', (event, args: unknown): boolean | Promise<boolean> => {
    if (!isPtyWriteEventFromMainWindow(event) || !isPtyWritePayload(args)) {
      return false
    }
    const claimTail = hostViewportClaimTails.get(args.id)
    return claimTail
      ? claimTail.then((claimed) => (claimed ? writePtyInputAccepted(args) : false))
      : writePtyInputAccepted(args)
  })

  ipcMain.handle(
    'pty:deliverAgentLaunchPrompt',
    async (event, args: unknown): Promise<TerminalLaunchPromptDisposal> => {
      if (!isPtyWriteEventFromMainWindow(event) || !runtime || !isLaunchPromptPayload(args)) {
        return { outcome: 'not-delivered' }
      }
      const handle = runtime.resolveTerminalHandleForPty(args.id)
      if (!handle) {
        return { outcome: 'not-delivered' }
      }
      // Same writer and record as a paired create: a repeated request cannot paste twice, and a
      // person can answer a startup dialog before the prompt lands.
      const deliveries = hostLaunchPromptDeliveriesFor(runtime)
      const text = args.text
      deliveries.start(handle, () =>
        deliverTerminalAgentLaunchPrompt({
          runtime,
          handle,
          text,
          startupDialogDeadlineMs: HOST_LAUNCH_PROMPT_DIALOG_DEADLINE_MS
        })
      )
      return await deliveries.observe(handle)
    }
  )

  ipcMain.removeAllListeners('pty:claimViewport')
  ipcMain.on('pty:claimViewport', (event, args: unknown) => {
    if (!isPtyWriteEventFromMainWindow(event) || !runtime || !isPtyViewportClaimPayload(args)) {
      return
    }
    const prior = hostViewportClaimTails.get(args.id)
    // Why: two panes can mirror one PTY — never let a later no-op claim replace the in-flight resize that the following host input must await.
    const claim = (
      prior
        ? prior.then(
            () => runtime.claimRemoteDesktopHost(args.id, args.cols, args.rows),
            () => runtime.claimRemoteDesktopHost(args.id, args.cols, args.rows)
          )
        : runtime.claimRemoteDesktopHost(args.id, args.cols, args.rows)
    ).catch((error) => {
      // Why: a failed claim silently discards every gated keystroke for this pane.
      console.error('[pty] remote desktop host claim failed; gated input will be discarded', error)
      return false
    })
    hostViewportClaimTails.set(args.id, claim)
    void claim.then(() => {
      if (hostViewportClaimTails.get(args.id) === claim) {
        hostViewportClaimTails.delete(args.id)
      }
    })
  })
}
