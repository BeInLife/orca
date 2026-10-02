import { describe, expect, it, vi } from 'vitest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { TerminalQuickCommand } from '../../../shared/terminal-quick-command-types'
import {
  MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH,
  MAX_QUICK_COMMANDS,
  MAX_TERMINAL_QUICK_COMMANDS_SERIALIZED_BYTES
} from '../../../shared/terminal-quick-commands'
import { REMOTE_RPC_MAX_CONTENT_BYTES } from '../../../shared/remote-rpc-content-budget'
import { WEBSOCKET_TRANSPORT_MAX_MESSAGE_BYTES } from '../../runtime/rpc/websocket-transport-limits'
import { updateSettings, type SettingsMutationOperations } from './settings-update'

function makeOperations(): SettingsMutationOperations {
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields updateSettings reads for this setting.
    state: { settings: { terminalQuickCommands: [] }, repos: [] } as unknown as PersistedState,
    bumpLocalWorktreeScanGeneration: vi.fn(),
    removeRetainedBlob: vi.fn(),
    scheduleSave: vi.fn(),
    notifySettingsChanged: vi.fn()
  }
}

function agentCommand(id: string, prompt: string): TerminalQuickCommand {
  return {
    id,
    label: id,
    action: 'agent-prompt',
    agent: 'claude',
    prompt,
    scope: { type: 'global' }
  }
}

// Local saves and paired saves both reach the store here, so this is the one place the bound holds.
describe('updateSettings terminalQuickCommands', () => {
  it('stores a prompt at the cap whole', () => {
    const prompt = 'x'.repeat(MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH)
    const saved = updateSettings(makeOperations(), {
      terminalQuickCommands: [agentCommand('review', prompt)]
    })

    expect(saved.terminalQuickCommands?.[0]).toMatchObject({ prompt })
  })

  it('refuses a prompt over the cap rather than trimming it', () => {
    const operations = makeOperations()

    expect(() =>
      updateSettings(operations, {
        terminalQuickCommands: [
          agentCommand('review', 'x'.repeat(MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH + 1))
        ]
      })
    ).toThrow(/"review" is 100,001 characters/)
    expect(operations.scheduleSave).not.toHaveBeenCalled()
  })

  it('refuses a list too large for one paired reply', () => {
    // Forty prompts of 2-byte characters at the cap total about 8 MB of JSON.
    const commands = Array.from({ length: MAX_QUICK_COMMANDS }, (_, index) =>
      agentCommand(`c${index}`, 'é'.repeat(MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH))
    )

    expect(() => updateSettings(makeOperations(), { terminalQuickCommands: commands })).toThrow(
      /Shorten or remove a prompt/
    )
  })
})

describe('the quick-command storage bound against the paired transports', () => {
  it('fits a saved list in one reply', () => {
    expect(MAX_TERMINAL_QUICK_COMMANDS_SERIALIZED_BYTES + 64 * 1024).toBeLessThanOrEqual(
      REMOTE_RPC_MAX_CONTENT_BYTES
    )
  })

  it('fits one saved command in an inbound frame at the worst JSON escape', () => {
    // Legacy E2EE frames are base64 of nonce + MAC + plaintext.
    const inboundPlaintextBytes = Math.floor(WEBSOCKET_TRANSPORT_MAX_MESSAGE_BYTES / 4) * 3 - 40
    const worstCasePromptBytes = MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH * 6
    const envelopeReserveBytes = 16 * 1024
    expect(worstCasePromptBytes + envelopeReserveBytes).toBeLessThanOrEqual(inboundPlaintextBytes)
  })
})
