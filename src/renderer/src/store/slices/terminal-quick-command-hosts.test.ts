import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestStore } from './store-test-helpers'
import type { TerminalQuickCommand } from '../../../../shared/terminal-quick-command-types'
import { getDefaultSettings } from '../../../../shared/constants'
import {
  MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
  RUNTIME_PROTOCOL_VERSION,
  TERMINAL_QUICK_COMMANDS_RUNTIME_CAPABILITY
} from '../../../../shared/protocol-version'
import { TERMINAL_QUICK_COMMAND_LONG_PROMPTS_RUNTIME_CAPABILITY } from '../../../../shared/terminal-quick-command-capabilities'
import { LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../../../../shared/terminal-quick-commands'
import { getTerminalQuickCommandHostPromptMaxLength } from '@/lib/terminal-quick-command-host-prompt-limit'
import { clearRuntimeCompatibilityCacheForTests } from '@/runtime/runtime-rpc-client'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const savedCommand: TerminalQuickCommand = {
  id: 'remote-build',
  label: 'Remote build',
  action: 'terminal-command',
  command: 'pnpm build',
  appendEnter: true,
  scope: { type: 'global' }
}

function success(result: unknown) {
  return { id: 'rpc-1', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

function installRuntime(
  supported = true,
  extraCapabilities: string[] = []
): ReturnType<typeof vi.fn> {
  const call = vi.fn(({ method, params }: { method: string; params?: unknown }) => {
    if (method === 'status.get') {
      return Promise.resolve(
        success({
          runtimeId: 'runtime-1',
          graphStatus: 'ready',
          runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
          minCompatibleRuntimeClientVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
          capabilities: supported
            ? [TERMINAL_QUICK_COMMANDS_RUNTIME_CAPABILITY, ...extraCapabilities]
            : []
        })
      )
    }
    if (method === 'settings.getTerminalQuickCommands') {
      return Promise.resolve(success({ terminalQuickCommands: [savedCommand] }))
    }
    if (method === 'settings.updateTerminalQuickCommands') {
      const mutation = (params as { mutation: { command?: TerminalQuickCommand } }).mutation
      return Promise.resolve(
        success({ terminalQuickCommands: mutation.command ? [mutation.command] : [] })
      )
    }
    throw new Error(`Unexpected method: ${method}`)
  })
  vi.stubGlobal('window', { api: { runtimeEnvironments: { call } } })
  return call
}

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  vi.clearAllMocks()
})

describe('terminal quick command host collections', () => {
  it('loads a capability-gated remote host collection', async () => {
    const call = installRuntime()
    const store = createTestStore()

    await store.getState().loadRuntimeTerminalQuickCommands('env-1')

    expect(store.getState().runtimeTerminalQuickCommands.get('env-1')).toMatchObject({
      commands: [savedCommand],
      ready: true,
      supported: true
    })
    expect(call.mock.calls.map(([args]) => args.method)).toEqual([
      'status.get',
      'settings.getTerminalQuickCommands'
    ])
  })

  it('caps prompts only for a host that predates long prompts', async () => {
    const store = createTestStore()
    expect(getTerminalQuickCommandHostPromptMaxLength(store.getState(), 'local')).toBeNull()
    // An unprobed host is treated as an older one.
    expect(getTerminalQuickCommandHostPromptMaxLength(store.getState(), 'runtime:env-1')).toBe(
      LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH
    )

    installRuntime()
    await store.getState().loadRuntimeTerminalQuickCommands('env-1')
    expect(getTerminalQuickCommandHostPromptMaxLength(store.getState(), 'runtime:env-1')).toBe(
      LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH
    )

    clearRuntimeCompatibilityCacheForTests()
    installRuntime(true, [TERMINAL_QUICK_COMMAND_LONG_PROMPTS_RUNTIME_CAPABILITY])
    await store.getState().loadRuntimeTerminalQuickCommands('env-2')
    expect(getTerminalQuickCommandHostPromptMaxLength(store.getState(), 'runtime:env-2')).toBeNull()
  })

  it('degrades to local-only behavior for an older remote host', async () => {
    const call = installRuntime(false)
    const store = createTestStore()

    await store.getState().loadRuntimeTerminalQuickCommands('env-old')

    expect(store.getState().runtimeTerminalQuickCommands.get('env-old')).toMatchObject({
      commands: [],
      ready: true,
      supported: false
    })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('persists one atomic mutation to the owning remote host', async () => {
    const call = installRuntime()
    const store = createTestStore()
    await store.getState().loadRuntimeTerminalQuickCommands('env-1')
    const edited = { ...savedCommand, command: 'pnpm test' }

    await store.getState().upsertTerminalQuickCommand('runtime:env-1', edited)

    expect(store.getState().runtimeTerminalQuickCommands.get('env-1')?.commands).toEqual([edited])
    expect(call).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'settings.updateTerminalQuickCommands',
        params: { mutation: { type: 'upsert', command: edited } }
      })
    )
  })

  it('does not let an older load overwrite a concurrent mutation', async () => {
    let resolveLoad: (value: ReturnType<typeof success>) => void = () => undefined
    const staleLoad = new Promise<ReturnType<typeof success>>((resolve) => {
      resolveLoad = resolve
    })
    const edited = { ...savedCommand, command: 'pnpm test' }
    const call = vi.fn(({ method, params }: { method: string; params?: unknown }) => {
      if (method === 'status.get') {
        return Promise.resolve(
          success({
            runtimeId: 'runtime-1',
            graphStatus: 'ready',
            runtimeProtocolVersion: RUNTIME_PROTOCOL_VERSION,
            minCompatibleRuntimeClientVersion: MIN_COMPATIBLE_RUNTIME_CLIENT_VERSION,
            capabilities: [TERMINAL_QUICK_COMMANDS_RUNTIME_CAPABILITY]
          })
        )
      }
      if (method === 'settings.getTerminalQuickCommands') {
        return staleLoad
      }
      if (method === 'settings.updateTerminalQuickCommands') {
        return Promise.resolve(success({ terminalQuickCommands: [edited] }))
      }
      throw new Error(`Unexpected method: ${method} ${String(params)}`)
    })
    vi.stubGlobal('window', { api: { runtimeEnvironments: { call } } })
    const store = createTestStore()

    const load = store.getState().loadRuntimeTerminalQuickCommands('env-race', { force: true })
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'settings.getTerminalQuickCommands' })
      )
    )
    await store.getState().upsertTerminalQuickCommand('runtime:env-race', edited)
    resolveLoad(success({ terminalQuickCommands: [savedCommand] }))
    await load

    expect(store.getState().runtimeTerminalQuickCommands.get('env-race')?.commands).toEqual([
      edited
    ])
  })

  it('drops cached commands before revalidating a new connection', async () => {
    installRuntime()
    const store = createTestStore()
    await store.getState().loadRuntimeTerminalQuickCommands('env-1')

    store.getState().clearRuntimeEnvironmentStatus('env-1')
    const reload = store.getState().loadRuntimeTerminalQuickCommands('env-1')

    expect(store.getState().runtimeTerminalQuickCommands.get('env-1')).toMatchObject({
      commands: [],
      ready: false,
      supported: null
    })
    await reload
  })

  it('keeps Local Mac commands in the controlling client settings', async () => {
    const set = vi.fn(async (updates: { terminalQuickCommands: TerminalQuickCommand[] }) => updates)
    vi.stubGlobal('window', { api: { settings: { set } } })
    const store = createTestStore()
    store.setState({ settings: { ...getDefaultSettings('/tmp'), terminalQuickCommands: [] } })

    await store.getState().upsertTerminalQuickCommand('local', savedCommand)

    expect(set).toHaveBeenCalledWith({ terminalQuickCommands: [savedCommand] })
    expect(store.getState().settings?.terminalQuickCommands).toEqual([savedCommand])
  })
})
