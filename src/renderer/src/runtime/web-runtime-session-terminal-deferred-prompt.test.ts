import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWebRuntimeAgentSessionTerminalWithPrompt } from './web-runtime-session'
import { resetWebSessionCloseIntentForTests } from './web-session-close-intent'
import {
  ENVIRONMENT_ID,
  FOCUS_LEAF_ID,
  WORKTREE_ID,
  makeSnapshot,
  resetTerminalCreateEnvironment,
  stubTerminalCreateEnvironment
} from './web-runtime-session-test-harness'
import { TERMINAL_QUICK_COMMAND_LONG_PROMPTS_RUNTIME_CAPABILITY } from '../../../shared/terminal-quick-command-capabilities'

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

function stubHost(options: { capabilities: string[]; deferred: boolean; sendAccepted?: boolean }) {
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
          capabilities: ['agent-session.host-authority.v1', ...options.capabilities]
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
            paneKey: `host-tab-long:${FOCUS_LEAF_ID}`,
            ...(options.deferred ? { startupPromptDeferred: true } : {})
          },
          disposition: 'created'
        }
      }
    }
    if (request.method === 'terminal.send') {
      return {
        id: 'send',
        ok: true,
        result: {
          send: { handle: 'term_long', accepted: options.sendAccepted ?? true, bytesWritten: 6 }
        }
      }
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
  launchAgent: 'claude' as const,
  agentSessionKind: 'fresh' as const,
  prompt: 'review',
  promptDelivery: 'auto-submit' as const
}

describe('a paired launch whose host defers the prompt', () => {
  beforeEach(() => stubTerminalCreateEnvironment(mocks))
  afterEach(() => resetTerminalCreateEnvironment())

  it('opts in on a long-prompt host and has its writer deliver the deferred prompt', async () => {
    const runtimeCall = stubHost({
      capabilities: [TERMINAL_QUICK_COMMAND_LONG_PROMPTS_RUNTIME_CAPABILITY],
      deferred: true
    })

    await expect(createWebRuntimeAgentSessionTerminalWithPrompt(LAUNCH)).resolves.toEqual({
      outcome: { status: 'created' },
      promptDelivered: true
    })

    expect(calls(runtimeCall, 'terminal.createAgentSession')[0]?.params).toMatchObject({
      prompt: 'review',
      deferOversizedPrompt: true
    })
    expect(calls(runtimeCall, 'terminal.send').map((request) => request.params)).toEqual([
      expect.objectContaining({ terminal: 'term_long', text: 'review', launchPrompt: true })
    ])
  })

  it('reports an undelivered prompt so the caller can say so', async () => {
    stubHost({
      capabilities: [TERMINAL_QUICK_COMMAND_LONG_PROMPTS_RUNTIME_CAPABILITY],
      deferred: true,
      sendAccepted: false
    })

    await expect(createWebRuntimeAgentSessionTerminalWithPrompt(LAUNCH)).resolves.toEqual({
      outcome: { status: 'created' },
      promptDelivered: false
    })
  })

  it('never sends the opt-in or a launch prompt to a host that predates them', async () => {
    const runtimeCall = stubHost({ capabilities: [], deferred: false })

    await expect(createWebRuntimeAgentSessionTerminalWithPrompt(LAUNCH)).resolves.toEqual({
      outcome: { status: 'created' },
      promptDelivered: true
    })

    // Its create schema is strict, so the field would fail the whole launch.
    expect(calls(runtimeCall, 'terminal.createAgentSession')[0]?.params).not.toHaveProperty(
      'deferOversizedPrompt'
    )
    expect(calls(runtimeCall, 'terminal.send')).toEqual([])
  })
})
