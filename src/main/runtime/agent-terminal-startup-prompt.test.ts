/**
 * The launch command a terminal create builds when the launch hands it a prompt.
 *
 * This is the argv half of terminal prompt delivery, and the reason it is worth pinning is that
 * its failure mode is silent: `buildAgentStartupPlan` answers a prompt it cannot fold by returning
 * a bare command plus a `followupPrompt`, and this resolver returns options, not a live PTY, so the
 * create must report the deferral or the agent would start with no prompt and no error anywhere.
 */

import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

function runtimeWithAgentLaunch(): {
  runtime: OrcaRuntimeService
  spawn: ReturnType<typeof vi.fn>
} {
  const runtime = new OrcaRuntimeService()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver under test is a protected member; the assertion names only the two internals this stub replaces, each of which is assigned before the create reaches it.
  const internal = runtime as unknown as {
    store: { getSettings: () => Record<string, unknown> }
    resolveTerminalWorkspaceLaunchScope: (selector: string) => Promise<unknown>
  }
  internal.store = { getSettings: () => ({}) }
  vi.spyOn(internal, 'resolveTerminalWorkspaceLaunchScope').mockResolvedValue({
    id: 'wt-1',
    path: '/repo/app',
    connectionId: null,
    repo: null,
    folderWorkspace: null
  })
  const spawn = vi.fn().mockResolvedValue({ id: 'pty-1' })
  runtime.setPtyController({
    spawn,
    write: () => true,
    kill: () => true,
    getForegroundProcess: async () => null
  })
  return { runtime, spawn }
}

/** The command the PTY was actually spawned with, or '' when nothing was spawned. */
function spawnedCommand(spawn: ReturnType<typeof vi.fn>): string {
  const command = spawn.mock.calls[0]?.[0]?.command
  return typeof command === 'string' ? command : ''
}

describe('a terminal create that is handed a launch prompt', () => {
  it('folds an argv agent’s prompt into the command it spawns', async () => {
    const { runtime, spawn } = runtimeWithAgentLaunch()

    await runtime.createTerminal('id:wt-1', {
      startupAgent: 'claude',
      startupPrompt: 'summarize the diff'
    })

    expect(spawnedCommand(spawn)).toContain('summarize the diff')
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ launchAgent: 'claude' }))
  })

  it('still builds a bare agent launch when no prompt is handed to it', async () => {
    const { runtime, spawn } = runtimeWithAgentLaunch()

    await runtime.createTerminal('id:wt-1', { startupAgent: 'claude' })

    expect(spawnedCommand(spawn)).toContain('claude')
    expect(spawnedCommand(spawn)).not.toContain('summarize')
  })

  it('reports a prompt the agent takes only after start instead of dropping it', async () => {
    const { runtime, spawn } = runtimeWithAgentLaunch()

    // `aider` takes its prompt after start, so there is no argument to fold it into; the create
    // starts the agent clean and says so, and the caller delivers the text into the live PTY.
    const created = await runtime.createTerminal('id:wt-1', {
      startupAgent: 'aider',
      startupPrompt: 'summarize the diff'
    })

    expect(created.startupPromptDeferred).toBe(true)
    expect(spawnedCommand(spawn)).not.toContain('summarize the diff')
  })

  it('reports a prompt too long for the host command line instead of spawning it inline', async () => {
    const { runtime, spawn } = runtimeWithAgentLaunch()
    const prompt = 'p'.repeat(130 * 1024)

    const created = await runtime.createTerminal('id:wt-1', {
      startupAgent: 'claude',
      startupPrompt: prompt
    })

    expect(created.startupPromptDeferred).toBe(true)
    expect(spawnedCommand(spawn)).toContain('claude')
    expect(spawnedCommand(spawn)).not.toContain('ppp')
  })

  it('reports nothing deferred when the command carries the prompt', async () => {
    const { runtime } = runtimeWithAgentLaunch()

    const created = await runtime.createTerminal('id:wt-1', {
      startupAgent: 'claude',
      startupPrompt: 'summarize the diff'
    })

    expect(created.startupPromptDeferred).toBeUndefined()
  })

  it('names the created terminal by its PTY, so a host write can reach a renderer-spawned pane', async () => {
    const { runtime } = runtimeWithAgentLaunch()

    const created = await runtime.createTerminal('id:wt-1', { startupAgent: 'claude' })

    expect(runtime.resolveTerminalHandleForPty('pty-1')).toBe(created.handle)
    expect(runtime.resolveTerminalHandleForPty('pty-unknown')).toBeNull()
  })
})
