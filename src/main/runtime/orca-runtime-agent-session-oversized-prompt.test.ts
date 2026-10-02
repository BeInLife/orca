import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeCreateAgentSessionRequest } from '../../shared/agent-session-host-authority'
import { OrcaRuntimeService } from './orca-runtime'
import { buildAgentDraftLaunchPlan } from '../../shared/tui-agent-startup'
import { resolveAgentStartupPlanInputs } from '../../shared/agent-startup-plan-inputs'
import { RpcDispatcher } from './rpc/dispatcher'
import { TERMINAL_METHODS } from './rpc/methods/terminal'
import { HOST_LAUNCH_PROMPT_DIALOG_DEADLINE_MS } from '../../shared/host-launch-prompt-budget'

const mocks = vi.hoisted(() => ({ deliverTerminalAgentLaunchPrompt: vi.fn() }))

vi.mock('./rpc/methods/agent-launch-terminal-prompt', () => ({
  deliverTerminalAgentLaunchPrompt: mocks.deliverTerminalAgentLaunchPrompt
}))

// Over the 128 KiB per-argument limit every POSIX host shares, so it never rides argv here.
const OVERSIZED_PROMPT = 'p'.repeat(130 * 1024)

function request(
  overrides: Partial<RuntimeCreateAgentSessionRequest> = {}
): RuntimeCreateAgentSessionRequest {
  return {
    clientOperationId: `${Date.now()}-0123456789abcdef0123456789abcdef`,
    worktree: 'id:worktree-1',
    agent: 'claude',
    prompt: OVERSIZED_PROMPT,
    promptDelivery: 'auto-submit',
    presentation: 'background',
    ...overrides
  }
}

function createRuntime(
  workspace: { id: string; path: string; connectionId: string | null } = {
    id: 'worktree-1',
    path: '/tmp/worktree-1',
    connectionId: null
  }
) {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: createAgentSession reads only these four settings from the store before the stubbed spawn.
  const runtime = new OrcaRuntimeService({
    getSettings: () => ({
      disabledTuiAgents: [],
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {}
    })
  } as never)
  Object.assign(runtime, {
    resolveTerminalWorkspaceLaunchScope: vi.fn(async () => workspace),
    executionOwnerSupportsAgentSessionOperation: vi.fn(async () => true)
  })
  return runtime
}

function stubSpawn(runtime: OrcaRuntimeService) {
  return vi.spyOn(runtime, 'createTerminal').mockResolvedValue({
    handle: 'term_oversized',
    worktreeId: 'worktree-1',
    title: null
  })
}

async function observeLaunchPrompt(
  runtime: OrcaRuntimeService,
  terminal: string,
  timeoutMs?: number
) {
  const dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_METHODS })
  return await dispatcher.dispatch({
    id: 'wait',
    authToken: 'token',
    method: 'terminal.wait',
    params: { terminal, for: 'launch-prompt', ...(timeoutMs ? { timeoutMs } : {}) }
  })
}

describe('a paired create handed a prompt its launch command cannot carry', () => {
  beforeEach(() => {
    mocks.deliverTerminalAgentLaunchPrompt.mockReset()
    mocks.deliverTerminalAgentLaunchPrompt.mockResolvedValue(true)
  })

  it('starts the agent clean, replies at once, and delivers the prompt itself', async () => {
    const runtime = createRuntime()
    const createTerminal = stubSpawn(runtime)
    let finishReadiness: (delivered: boolean) => void = () => {}
    mocks.deliverTerminalAgentLaunchPrompt.mockReturnValue(
      new Promise<boolean>((resolve) => (finishReadiness = resolve))
    )

    const created = await runtime.createAgentSession(request())

    // The reply does not wait for the agent's TUI; the pane can mount and take a trust answer.
    expect(created.launchPrompt).toEqual({ outcome: 'pending' })
    expect(createTerminal.mock.calls[0]?.[1]?.command).not.toContain('ppp')
    expect(mocks.deliverTerminalAgentLaunchPrompt).toHaveBeenCalledWith({
      runtime,
      handle: 'term_oversized',
      text: OVERSIZED_PROMPT,
      // A person may still be answering a startup dialog when the reply has already returned.
      startupDialogDeadlineMs: HOST_LAUNCH_PROMPT_DIALOG_DEADLINE_MS
    })

    const observed = observeLaunchPrompt(runtime, 'term_oversized')
    finishReadiness(true)
    await expect(observed).resolves.toMatchObject({
      ok: true,
      result: {
        wait: { condition: 'launch-prompt', launchPrompt: { outcome: 'handed-to-terminal' } }
      }
    })
  })

  it('reports a delivery that did not land, read-only and as often as asked', async () => {
    const runtime = createRuntime()
    stubSpawn(runtime)
    mocks.deliverTerminalAgentLaunchPrompt.mockResolvedValue(false)

    await runtime.createAgentSession(request())

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(observeLaunchPrompt(runtime, 'term_oversized')).resolves.toMatchObject({
        result: { wait: { satisfied: false, launchPrompt: { outcome: 'not-delivered' } } }
      })
    }
    expect(mocks.deliverTerminalAgentLaunchPrompt).toHaveBeenCalledOnce()
  })

  it('delivers once for a replayed create, and not at all for a prompt that fits', async () => {
    const runtime = createRuntime()
    const createTerminal = stubSpawn(runtime)
    const replayed = request()

    await runtime.createAgentSession(replayed)
    await expect(runtime.createAgentSession(replayed)).resolves.toMatchObject({
      disposition: 'replayed',
      launchPrompt: { outcome: 'pending' }
    })
    expect(mocks.deliverTerminalAgentLaunchPrompt).toHaveBeenCalledOnce()

    const fits = await runtime.createAgentSession(
      request({
        clientOperationId: `${Date.now()}-fedcba9876543210fedcba9876543210`,
        prompt: 'review'
      })
    )
    expect(fits.launchPrompt).toBeUndefined()
    expect(createTerminal.mock.calls.at(-1)?.[1]?.command).toContain('review')
    expect(mocks.deliverTerminalAgentLaunchPrompt).toHaveBeenCalledOnce()
  })

  it('keeps delivering after the client that asked disconnects', async () => {
    const runtime = createRuntime()
    stubSpawn(runtime)
    const disconnect = new AbortController()

    await runtime.createAgentSession(request(), { signal: disconnect.signal })
    disconnect.abort()

    await expect(observeLaunchPrompt(runtime, 'term_oversized')).resolves.toMatchObject({
      result: {
        wait: { condition: 'launch-prompt', launchPrompt: { outcome: 'handed-to-terminal' } }
      }
    })
  })

  it('reports no record as unknown, never as not delivered', async () => {
    const runtime = createRuntime()

    const observed = await observeLaunchPrompt(runtime, 'term_never_owed')

    expect(observed.ok).toBe(false)
    expect(JSON.stringify(observed)).toContain('launch_prompt_unknown')
  })

  it('answers with the delivery alone, no invented terminal state, and honours timeoutMs', async () => {
    const runtime = createRuntime()
    stubSpawn(runtime)
    mocks.deliverTerminalAgentLaunchPrompt.mockReturnValue(new Promise<boolean>(() => {}))
    await runtime.createAgentSession(request())

    const timedOut = await observeLaunchPrompt(runtime, 'term_oversized', 50)
    expect(timedOut.ok).toBe(false)
    expect(JSON.stringify(timedOut)).toContain('timeout')

    mocks.deliverTerminalAgentLaunchPrompt.mockResolvedValue(true)
    const other = createRuntime()
    stubSpawn(other)
    await other.createAgentSession(request())
    const settled = await observeLaunchPrompt(other, 'term_oversized')
    expect(settled).toMatchObject({ ok: true })
    expect(settled).toHaveProperty('result.wait', {
      handle: 'term_oversized',
      condition: 'launch-prompt',
      satisfied: true,
      launchPrompt: { outcome: 'handed-to-terminal' }
    })
  })

  it('drops the prompt from the create ledger once the spawn has the record', async () => {
    const runtime = createRuntime()
    stubSpawn(runtime)

    await runtime.createAgentSession(request())

    const [operation] = Reflect.get(runtime, 'agentSessionCreateOperations').values()
    expect(operation.reclaim).not.toHaveProperty('owedLaunchPrompt', OVERSIZED_PROMPT)
    expect(operation.reclaim.owedLaunchPrompt).toBeUndefined()
  })

  it('builds a draft exactly as before, on the draft rule, with nothing owed', async () => {
    const runtime = createRuntime()
    const createTerminal = stubSpawn(runtime)
    // A darwin client sends the draft; the host builds for its own Windows command line.
    Object.assign(runtime, { getAgentLaunchPlatformForWorkspace: vi.fn(() => 'win32') })
    const draft = 'd'.repeat(10_000)

    const created = await runtime.createAgentSession(
      request({ prompt: draft, promptDelivery: 'draft' })
    )

    expect(created.launchPrompt).toBeUndefined()
    const expected = buildAgentDraftLaunchPlan({
      ...resolveAgentStartupPlanInputs({
        agent: 'claude',
        settings: { agentCmdOverrides: {}, agentDefaultArgs: {}, agentDefaultEnv: {} },
        platform: 'win32',
        isRemote: false
      }),
      draft
    })
    expect(createTerminal.mock.calls[0]?.[1]?.command).toBe(expected?.launchCommand)
    expect(createTerminal.mock.calls[0]?.[1]?.command).toContain('--prefill')
    expect(mocks.deliverTerminalAgentLaunchPrompt).not.toHaveBeenCalled()
  })

  it('still delivers the prompt to a PTY a lost spawn left behind, once', async () => {
    const runtime = createRuntime({
      id: 'worktree-1',
      path: '/remote/worktree-1',
      connectionId: 'ssh-1'
    })
    const handleByPtyId = new Map<string, string>()
    const listProcesses = vi.fn()
    Object.assign(runtime, {
      ptyController: { listProcesses },
      adoptControllerTerminalHandle: vi.fn((ptyId: string, handle: string) => {
        handleByPtyId.set(ptyId, handle)
      }),
      recordPtyWorktree: vi.fn((ptyId: string, worktreeId: string) => ({
        ptyId,
        worktreeId,
        title: null
      })),
      issuePtyHandle: vi.fn((pty: { ptyId: string }) => handleByPtyId.get(pty.ptyId))
    })
    const lostSpawn = Object.assign(new Error('execution_owner_unavailable'), {
      agentSessionOperationOutcome: 'unknown' as const
    })
    const createTerminal = vi
      .spyOn(runtime, 'createTerminal')
      .mockImplementation(async (_worktree, opts) => {
        opts?.onPtySpawnCommitted?.()
        throw lostSpawn
      })
    const lost = request()
    await expect(runtime.createAgentSession(lost, { clientId: 'device-a' })).rejects.toThrow(
      lostSpawn.message
    )
    const orphanHandle = createTerminal.mock.calls[0]?.[1]?.preAllocatedHandle
    listProcesses.mockResolvedValue([
      {
        id: 'ssh-1:pty2:e:1',
        cwd: '/remote/worktree-1',
        title: 'claude',
        worktreeId: 'worktree-1',
        terminalHandle: orphanHandle
      }
    ])

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(
        runtime.createAgentSession(lost, { clientId: 'device-a' })
      ).resolves.toMatchObject({
        disposition: 'replayed',
        terminal: { handle: orphanHandle },
        launchPrompt: { outcome: 'pending' }
      })
    }
    expect(mocks.deliverTerminalAgentLaunchPrompt).toHaveBeenCalledOnce()
    expect(mocks.deliverTerminalAgentLaunchPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ handle: orphanHandle, text: OVERSIZED_PROMPT })
    )
  })
})
