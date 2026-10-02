import { describe, expect, it, vi } from 'vitest'
import type { RuntimeCreateAgentSessionRequest } from '../../shared/agent-session-host-authority'
import { CreateAgentSessionParams } from '../../shared/rpc-contract/agent-session-params'
import { OrcaRuntimeService } from './orca-runtime'

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

function createRuntime() {
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
    resolveTerminalWorkspaceLaunchScope: vi.fn(async () => ({
      id: 'worktree-1',
      path: '/tmp/worktree-1',
      connectionId: null
    })),
    executionOwnerSupportsAgentSessionOperation: vi.fn(async () => true)
  })
  const createTerminal = vi.spyOn(runtime, 'createTerminal').mockResolvedValue({
    handle: 'term_oversized',
    worktreeId: 'worktree-1',
    title: null
  })
  return { runtime, createTerminal }
}

describe('a paired create handed a prompt its launch command cannot carry', () => {
  it('starts the agent clean and tells an opted-in caller to deliver the prompt', async () => {
    const { runtime, createTerminal } = createRuntime()

    const created = await runtime.createAgentSession(request({ deferOversizedPrompt: true }))

    expect(created.terminal.startupPromptDeferred).toBe(true)
    expect(createTerminal.mock.calls[0]?.[1]?.command).not.toContain('ppp')
  })

  it('keeps building the prompt into the command for a caller that has not opted in', async () => {
    const { runtime, createTerminal } = createRuntime()

    const created = await runtime.createAgentSession(request())

    // Old clients and the other create call sites deliver nothing themselves.
    expect(created.terminal.startupPromptDeferred).toBeUndefined()
    expect(createTerminal.mock.calls[0]?.[1]?.command).toContain('ppp')
  })

  it('accepts the opt-in only as a literal true', () => {
    const base = { ...request(), prompt: 'review' }
    expect(
      CreateAgentSessionParams.safeParse({ ...base, deferOversizedPrompt: true }).success
    ).toBe(true)
    expect(
      CreateAgentSessionParams.safeParse({ ...base, deferOversizedPrompt: false }).success
    ).toBe(false)
  })
})
