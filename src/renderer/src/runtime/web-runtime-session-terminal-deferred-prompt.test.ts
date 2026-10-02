import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createWebRuntimeAgentSessionTerminalWithLaunchDraft,
  createWebRuntimeAgentSessionTerminalWithPrompt
} from './web-runtime-session'
import { resetWebSessionCloseIntentForTests } from './web-session-close-intent'
import {
  ENVIRONMENT_ID,
  FOCUS_LEAF_ID,
  WORKTREE_ID,
  makeSnapshot,
  resetTerminalCreateEnvironment,
  stubTerminalCreateEnvironment
} from './web-runtime-session-test-harness'
import { LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../../../shared/terminal-quick-commands'

const mocks = vi.hoisted(() => ({
  getState: vi.fn(),
  setState: vi.fn(),
  subscribe: vi.fn(),
  setActiveWorktree: vi.fn(),
  createBrowserTab: vi.fn(),
  closeEmptyGroup: vi.fn(),
  moveUnifiedTabToGroup: vi.fn(),
  setRemoteBrowserPageHandle: vi.fn(),
  focusBrowserTabInWorktree: vi.fn(),
  applyWebSessionTabsSnapshot: vi.fn(),
  decideWebSessionTabsSnapshot: vi.fn(() => ({ apply: true, settlesHostMirror: true })),
  getWebSessionTabsTrackingGeneration: vi.fn(() => 0),
  acceptReplayedWebSessionTabsSnapshot: vi.fn(),
  resolveHostSessionTabIdForWebSessionTab: vi.fn(),
  trackTerminalPaneSplit: vi.fn(),
  deliverLaunchPromptToAgentTab: vi.fn(),
  seedNativeChatLaunchDraftForAgentTab: vi.fn(),
  getRuntimeEnvironmentIdForWorktree: vi.fn(),
  hasMaterializedWebRuntimeBrowserPage: vi.fn()
}))

vi.mock('../store', () => ({
  useAppStore: {
    getState: mocks.getState,
    setState: mocks.setState,
    subscribe: mocks.subscribe
  }
}))

vi.mock('./web-session-tabs-sync', () => ({
  acceptReplayedWebSessionTabsSnapshot: mocks.acceptReplayedWebSessionTabsSnapshot,
  applyWebSessionTabsSnapshot: mocks.applyWebSessionTabsSnapshot,
  decideWebSessionTabsSnapshot: mocks.decideWebSessionTabsSnapshot,
  getWebSessionTabsTrackingGeneration: mocks.getWebSessionTabsTrackingGeneration,
  applyWebSessionTabsStorePatch: (buildPatch: (state: unknown) => unknown) => {
    mocks.setState(buildPatch)
    // The production caller invokes the returned settle receipt.
    return () => {}
  },
  resolveHostSessionTabIdForWebSessionTab: mocks.resolveHostSessionTabIdForWebSessionTab
}))

vi.mock('@/lib/feature-education-telemetry', () => ({
  trackTerminalPaneSplit: mocks.trackTerminalPaneSplit
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: mocks.getRuntimeEnvironmentIdForWorktree
}))

vi.mock('@/lib/agent-launch-prompt-delivery', () => ({
  deliverLaunchPromptToAgentTab: mocks.deliverLaunchPromptToAgentTab,
  seedNativeChatLaunchDraftForAgentTab: mocks.seedNativeChatLaunchDraftForAgentTab
}))

vi.mock('./web-runtime-browser-materialization', () => ({
  hasMaterializedWebRuntimeBrowserPage: mocks.hasMaterializedWebRuntimeBrowserPage
}))

afterEach(() => resetWebSessionCloseIntentForTests())

type RuntimeRequest = { method: string; params?: Record<string, unknown> }

const HOST_AUTHORITY = 'agent-session.host-authority.v1'

function stubHost(options: {
  capabilities?: string[]
  launchPrompt?: { outcome: string }
  waitReplies?: (() => unknown)[]
}) {
  const waitReplies = [...(options.waitReplies ?? [])]
  const runtimeCall = vi.fn(async (request: RuntimeRequest) => {
    if (request.method === 'status.get') {
      return {
        id: 'status',
        ok: true,
        result: {
          runtimeId: 'runtime-1',
          graphStatus: 'ready',
          runtimeProtocolVersion: 3,
          minCompatibleRuntimeClientVersion: 2,
          capabilities: options.capabilities ?? [HOST_AUTHORITY]
        }
      }
    }
    if (request.method === 'terminal.createAgentSession') {
      return {
        id: 'create',
        ok: true,
        result: {
          terminal: {
            handle: 'term_long',
            worktreeId: WORKTREE_ID,
            tabId: 'host-tab-long',
            paneKey: `host-tab-long:${FOCUS_LEAF_ID}`
          },
          disposition: 'created',
          ...(options.launchPrompt ? { launchPrompt: options.launchPrompt } : {})
        }
      }
    }
    if (request.method === 'session.tabs.createTerminal') {
      return {
        id: 'legacy',
        ok: true,
        result: { tab: { id: 'host-tab-long', leafId: FOCUS_LEAF_ID } }
      }
    }
    if (request.method === 'terminal.wait') {
      const next = waitReplies.shift()
      if (!next) {
        throw new Error('no scripted wait reply')
      }
      return { id: 'wait', ok: true, result: next() }
    }
    return { id: 'list', ok: true, result: makeSnapshot() }
  })
  vi.stubGlobal('window', { api: { runtimeEnvironments: { call: runtimeCall } } })
  return runtimeCall
}

function calls(runtimeCall: ReturnType<typeof stubHost>, method: string): RuntimeRequest[] {
  return runtimeCall.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method)
}

const LAUNCH = {
  worktreeId: WORKTREE_ID,
  environmentId: ENVIRONMENT_ID,
  agent: 'claude' as const,
  launchAgent: 'claude' as const,
  agentSessionKind: 'fresh' as const,
  command: "claude 'review'",
  prompt: 'review',
  promptDelivery: 'auto-submit' as const
}

describe('a paired launch whose host delivers the prompt itself', () => {
  beforeEach(() => stubTerminalCreateEnvironment(mocks))
  afterEach(() => resetTerminalCreateEnvironment())

  it('only watches the host deliver it: a read-only wait, never a write', async () => {
    const runtimeCall = stubHost({
      launchPrompt: { outcome: 'pending' },
      waitReplies: [() => ({ wait: { launchPrompt: { outcome: 'handed-to-terminal' } } })]
    })

    const created = await createWebRuntimeAgentSessionTerminalWithPrompt(LAUNCH)

    expect(created.outcome).toEqual({ status: 'created' })
    await expect(created.promptDelivered).resolves.toBe(true)
    expect(calls(runtimeCall, 'terminal.createAgentSession')[0]?.params).not.toHaveProperty(
      'deferOversizedPrompt'
    )
    expect(calls(runtimeCall, 'terminal.wait').map((request) => request.params)).toEqual([
      expect.objectContaining({ terminal: 'term_long', for: 'launch-prompt' })
    ])
    expect(calls(runtimeCall, 'terminal.send')).toEqual([])
    expect(mocks.deliverLaunchPromptToAgentTab).not.toHaveBeenCalled()
  })

  it('reports a delivery the host could not complete', async () => {
    stubHost({
      launchPrompt: { outcome: 'pending' },
      waitReplies: [() => ({ wait: { launchPrompt: { outcome: 'not-delivered' } } })]
    })

    const created = await createWebRuntimeAgentSessionTerminalWithPrompt(LAUNCH)
    await expect(created.promptDelivered).resolves.toBe(false)
  })

  it('asks again after a dropped observation, and says unknown rather than failed', async () => {
    const dropped = (): never => {
      throw new Error('connection closed')
    }
    const runtimeCall = stubHost({
      launchPrompt: { outcome: 'pending' },
      waitReplies: [dropped, () => ({ wait: { launchPrompt: { outcome: 'handed-to-terminal' } } })]
    })
    await expect(
      (await createWebRuntimeAgentSessionTerminalWithPrompt(LAUNCH)).promptDelivered
    ).resolves.toBe(true)
    expect(calls(runtimeCall, 'terminal.wait')).toHaveLength(2)

    stubHost({ launchPrompt: { outcome: 'pending' }, waitReplies: [dropped, dropped, dropped] })
    await expect(
      (await createWebRuntimeAgentSessionTerminalWithPrompt(LAUNCH)).promptDelivered
    ).resolves.toBeNull()
  })

  it('does nothing more when the command carried the prompt, as an older host always does', async () => {
    const runtimeCall = stubHost({})

    const created = await createWebRuntimeAgentSessionTerminalWithPrompt(LAUNCH)

    await expect(created.promptDelivered).resolves.toBe(true)
    expect(calls(runtimeCall, 'terminal.wait')).toEqual([])
  })

  it('keeps a long prompt off a legacy create route and pastes it once the agent is ready', async () => {
    const runtimeCall = stubHost({ capabilities: [] })
    const prompt = 'x'.repeat(LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH + 1)

    const created = await createWebRuntimeAgentSessionTerminalWithPrompt({
      ...LAUNCH,
      prompt,
      command: `claude '${prompt}'`,
      legacyCleanLaunch: { command: 'claude' }
    })

    await expect(created.promptDelivered).resolves.toBe(true)
    expect(calls(runtimeCall, 'session.tabs.createTerminal')[0]?.params).toMatchObject({
      command: 'claude'
    })
    expect(mocks.deliverLaunchPromptToAgentTab).toHaveBeenCalledWith(
      expect.objectContaining({ content: prompt, submit: true })
    )
  })

  it('pastes a draft the host could not carry, unsent, instead of seeding it as delivered', async () => {
    stubHost({ launchPrompt: { outcome: 'not-delivered' } })

    await createWebRuntimeAgentSessionTerminalWithLaunchDraft({
      ...LAUNCH,
      promptDelivery: 'draft',
      launchDraft: 'review'
    })

    expect(mocks.deliverLaunchPromptToAgentTab).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'review', submit: false })
    )
    expect(mocks.seedNativeChatLaunchDraftForAgentTab).not.toHaveBeenCalled()
  })
})
