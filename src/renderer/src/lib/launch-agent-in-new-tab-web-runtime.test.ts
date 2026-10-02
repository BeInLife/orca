import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toWebTerminalSurfaceTabId } from '../../../shared/terminal-surface-id'
import { TERMINAL_QUICK_COMMAND_LONG_PROMPTS_RUNTIME_CAPABILITY as LONG_PROMPTS } from '../../../shared/terminal-quick-command-capabilities'

const mocks = vi.hoisted(() => ({
  createTab: vi.fn(),
  closeTab: vi.fn(),
  createWebRuntimeSessionTerminal: vi.fn(),
  createWebRuntimeAgentSessionTerminalWithPrompt: vi.fn(),
  createWebRuntimeAgentSessionTerminal: vi.fn(),
  setActiveTabType: vi.fn(),
  toastMessage: vi.fn()
}))

const store = {
  activeRepoId: 'repo-1',
  activeWorktreeId: 'wt-1',
  settings: {
    agentCmdOverrides: {} as Record<string, string>,
    agentDefaultArgs: {} as Record<string, string>,
    agentDefaultEnv: {} as Record<string, Record<string, string>>,
    activeRuntimeEnvironmentId: 'web-runtime' as string | null
  },
  projects: [{ id: 'repo-1', localWindowsRuntimePreference: { kind: 'inherit-global' as const } }],
  repos: [{ id: 'repo-1', connectionId: null, path: '/repo' }],
  worktreesByRepo: {
    'repo-1': [
      {
        id: 'wt-1',
        repoId: 'repo-1',
        projectId: 'repo-1',
        path: '/repo/worktree',
        displayName: 'main'
      }
    ]
  },
  tabsByWorktree: { 'wt-1': [{ id: 'tab-1' }] as { id: string; launchAgent?: string }[] },
  openFiles: [] as { id: string; worktreeId: string }[],
  browserTabsByWorktree: {} as Record<string, { id: string }[]>,
  tabBarOrderByWorktree: {} as Record<string, string[]>,
  terminalLayoutsByTabId: {},
  ptyIdsByTabId: {},
  sshConnectionStates: new Map(),
  transientClearedAgentStatusConnectionIds: {},
  allWorktrees: vi.fn(() => store.worktreesByRepo['repo-1']),
  createTab: mocks.createTab,
  closeTab: mocks.closeTab,
  queueTabStartupCommand: vi.fn(),
  setActiveTabType: mocks.setActiveTabType,
  setTabBarOrder: vi.fn(),
  setAgentStatus: vi.fn(),
  seedNativeChatLaunchPrompt: vi.fn(),
  markNativeChatLaunchPromptFailed: vi.fn(),
  runtimeStatusByEnvironmentId: new Map<string, { status: { capabilities: string[] } }>()
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))
vi.mock('sonner', () => ({ toast: { message: mocks.toastMessage, error: vi.fn() } }))
vi.mock('@/components/tab-bar/reconcile-order', () => ({ reconcileTabOrder: vi.fn(() => []) }))
vi.mock('@/lib/agent-paste-draft', () => ({ pasteDraftWhenAgentReady: vi.fn() }))
vi.mock('@/lib/telemetry', () => ({
  track: vi.fn(),
  tuiAgentToAgentKind: (agent: string) => agent
}))
vi.mock('@/runtime/web-runtime-session', () => ({
  createWebRuntimeSessionTerminal: mocks.createWebRuntimeSessionTerminal,
  createWebRuntimeAgentSessionTerminalWithPrompt:
    mocks.createWebRuntimeAgentSessionTerminalWithPrompt,
  createWebRuntimeAgentSessionTerminal: mocks.createWebRuntimeAgentSessionTerminal,
  isWebRuntimeSessionActive: vi.fn(() => true),
  isWebTerminalSurfaceTabId: vi.fn(() => false)
}))

describe('launchAgentInNewTab paired web runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.settings = {
      agentCmdOverrides: {},
      agentDefaultArgs: {},
      agentDefaultEnv: {},
      activeRuntimeEnvironmentId: 'web-runtime'
    }
    store.tabsByWorktree = { 'wt-1': [{ id: 'tab-1' }] }
    mocks.createWebRuntimeSessionTerminal.mockResolvedValue({ status: 'created' })
    mocks.createWebRuntimeAgentSessionTerminal.mockResolvedValue({
      outcome: { status: 'created' },
      promptDelivered: true
    })
    store.runtimeStatusByEnvironmentId = new Map([
      ['web-runtime', { status: { capabilities: [LONG_PROMPTS] } }]
    ])
    mocks.createWebRuntimeAgentSessionTerminalWithPrompt.mockResolvedValue({
      outcome: { status: 'created' },
      promptDelivered: Promise.resolve(true)
    })
  })

  it('delegates agent quick launch to the host runtime', async () => {
    store.tabsByWorktree['wt-1'].push({ id: 'stale-agent-tab', launchAgent: 'claude' })
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    const result = launchAgentInNewTab({
      agent: 'claude',
      worktreeId: 'wt-1',
      groupId: 'group-1'
    })

    expect(result).toEqual(
      expect.objectContaining({
        surface: { kind: 'host-published' },
        pasteDraftAfterLaunch: false
      })
    )
    expect(mocks.createWebRuntimeSessionTerminal).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      environmentId: 'web-runtime',
      targetGroupId: 'group-1',
      activate: true,
      agentSessionKind: 'fresh',
      agent: 'claude',
      viewMode: 'terminal'
    })
    expect(mocks.createTab).not.toHaveBeenCalled()
    await Promise.resolve()
    // Why: host creation is async, so the user may be viewing another worktree by the time it lands.
    expect(mocks.setActiveTabType).toHaveBeenCalledExactlyOnceWith('terminal', 'wt-1')
    expect(mocks.closeTab).toHaveBeenCalledWith('stale-agent-tab', { reason: 'cleanup' })
  })

  it('forwards prompt launch env and captured config to the host runtime', async () => {
    store.settings.agentDefaultArgs = { codex: '--model gpt-5 --reasoning-effort high' }
    store.settings.agentDefaultEnv = { codex: { CODEX_PROFILE: 'captured' } }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    const result = launchAgentInNewTab({
      agent: 'codex',
      worktreeId: 'wt-1',
      prompt: 'fix the spinner',
      groupId: 'group-1'
    })

    expect(result).toEqual(
      expect.objectContaining({
        surface: { kind: 'host-published' },
        pasteDraftAfterLaunch: false
      })
    )
    // The host decides whether its command line carries the prompt and delivers it if not.
    expect(mocks.createWebRuntimeAgentSessionTerminalWithPrompt).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      environmentId: 'web-runtime',
      targetGroupId: 'group-1',
      activate: true,
      agentSessionKind: 'fresh',
      agent: 'codex',
      launchAgent: 'codex',
      command: "codex '--model' 'gpt-5' '--reasoning-effort' 'high' 'fix the spinner'",
      env: { CODEX_PROFILE: 'captured' },
      launchConfig: {
        agentCommand: "codex '--model' 'gpt-5' '--reasoning-effort' 'high'",
        agentArgs: '--model gpt-5 --reasoning-effort high',
        agentEnv: { CODEX_PROFILE: 'captured' }
      },
      startupCommandDelivery: 'shell-ready',
      prompt: 'fix the spinner',
      promptDelivery: 'auto-submit',
      viewMode: 'terminal'
    })
    expect(mocks.createTab).not.toHaveBeenCalled()
  })

  it('tells the user when the host could not deliver a deferred prompt', async () => {
    mocks.createWebRuntimeAgentSessionTerminalWithPrompt.mockResolvedValue({
      outcome: { status: 'created' },
      promptDelivered: Promise.resolve(false),
      hostTabId: 'host-tab-1'
    })
    store.tabsByWorktree['wt-1'].push({ id: toWebTerminalSurfaceTabId('host-tab-1') })
    const { launchAgentInWebHostTab } = await import('./launch-agent-web-host-tab')

    const delivery = await launchAgentInWebHostTab({
      agent: 'claude',
      worktreeId: 'wt-1',
      environmentId: 'web-runtime',
      startupPlan: {
        agent: 'claude',
        launchCommand: 'claude',
        expectedProcess: 'claude',
        followupPrompt: null,
        launchConfig: { agentCommand: 'claude', agentArgs: '', agentEnv: {} }
      },
      prompt: 'review the change',
      promptDelivery: 'auto-submit',
      pastePromptAfterReady: null,
      submitPastedPrompt: false
    })

    expect(delivery).toEqual({ delivered: false, failureNotified: true })
    expect(mocks.toastMessage).toHaveBeenCalledWith(expect.stringContaining("wasn't sent"))
  })

  it('shows the tab before the host has delivered, and stays quiet when the outcome is unknown', async () => {
    let settle: (delivered: boolean | null) => void = () => {}
    mocks.createWebRuntimeAgentSessionTerminalWithPrompt.mockResolvedValue({
      outcome: { status: 'created' },
      promptDelivered: new Promise<boolean | null>((resolve) => (settle = resolve))
    })
    const { launchAgentInWebHostTab } = await import('./launch-agent-web-host-tab')

    const delivery = launchAgentInWebHostTab({
      agent: 'claude',
      worktreeId: 'wt-1',
      environmentId: 'web-runtime',
      startupPlan: {
        agent: 'claude',
        launchCommand: 'claude',
        expectedProcess: 'claude',
        followupPrompt: null,
        launchConfig: { agentCommand: 'claude', agentArgs: '', agentEnv: {} }
      },
      prompt: 'review the change',
      promptDelivery: 'auto-submit',
      pastePromptAfterReady: null,
      submitPastedPrompt: false
    })
    await vi.waitFor(() => expect(mocks.setActiveTabType).toHaveBeenCalledWith('terminal', 'wt-1'))
    settle(null)

    await expect(delivery).resolves.toEqual({ delivered: false, failureNotified: false })
    expect(mocks.toastMessage).not.toHaveBeenCalled()
  })

  it.each([
    ['an older host', ['terminal.quick-commands.v1']],
    ['a host whose status is unverified', null]
  ])(
    'pastes a long prompt itself for %s, which would build it into the command',
    async (_label, caps) => {
      store.runtimeStatusByEnvironmentId = new Map(
        caps ? [['web-runtime', { status: { capabilities: caps } }]] : []
      )
      const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')
      const prompt = 'x'.repeat(7000)

      launchAgentInNewTab({ agent: 'claude', worktreeId: 'wt-1', prompt })

      expect(mocks.createWebRuntimeAgentSessionTerminal).toHaveBeenCalledWith(
        expect.objectContaining({ promptAfterReady: prompt, submitPrompt: true })
      )
      expect(mocks.createWebRuntimeAgentSessionTerminalWithPrompt).not.toHaveBeenCalled()
    }
  )

  it('hands a long prompt to a current host, with a prompt-free launch for its legacy route', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')
    const prompt = 'x'.repeat(7000)

    launchAgentInNewTab({ agent: 'claude', worktreeId: 'wt-1', prompt })

    expect(mocks.createWebRuntimeAgentSessionTerminalWithPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt,
        legacyCleanLaunch: expect.objectContaining({
          command: expect.not.stringContaining('xxx')
        })
      })
    )
  })

  it('stays quiet about a prompt whose tab the user already closed, as a local tab does', async () => {
    mocks.createWebRuntimeAgentSessionTerminalWithPrompt.mockResolvedValue({
      outcome: { status: 'created' },
      promptDelivered: Promise.resolve(false),
      hostTabId: 'host-tab-closed'
    })
    const { launchAgentInWebHostTab } = await import('./launch-agent-web-host-tab')

    const delivery = await launchAgentInWebHostTab({
      agent: 'claude',
      worktreeId: 'wt-1',
      environmentId: 'web-runtime',
      startupPlan: {
        agent: 'claude',
        launchCommand: 'claude',
        expectedProcess: 'claude',
        followupPrompt: null,
        launchConfig: { agentCommand: 'claude', agentArgs: '', agentEnv: {} }
      },
      prompt: 'review the change',
      promptDelivery: 'auto-submit',
      pastePromptAfterReady: null,
      submitPastedPrompt: false
    })

    expect(delivery).toEqual({ delivered: false, failureNotified: false })
    expect(mocks.toastMessage).not.toHaveBeenCalled()
  })

  it('leaves an agent with no prompt argument to its unsubmitted paste on an older host', async () => {
    store.runtimeStatusByEnvironmentId = new Map([
      ['web-runtime', { status: { capabilities: ['terminal.quick-commands.v1'] } }]
    ])
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({ agent: 'aider', worktreeId: 'wt-1', prompt: 'x'.repeat(7000) })

    expect(mocks.createWebRuntimeAgentSessionTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ submitPrompt: false })
    )
  })
})
