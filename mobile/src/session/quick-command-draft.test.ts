import { describe, expect, it } from 'vitest'
import { LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../terminal/quick-commands'
import {
  createEmptyQuickCommandDraft,
  draftToQuickCommand,
  isQuickCommandDraftPromptTooLong,
  type QuickCommandDraft
} from './quick-command-draft'

function agentDraft(prompt: string): QuickCommandDraft {
  return {
    ...createEmptyQuickCommandDraft({ type: 'global' }),
    label: 'Review',
    action: 'agent-prompt',
    agent: 'claude',
    prompt
  }
}

describe('quick command drafts', () => {
  it('saves a long prompt whole when the host has no cap', () => {
    const prompt = 'x'.repeat(LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH * 2)

    expect(draftToQuickCommand(agentDraft(prompt), null)).toMatchObject({ prompt })
  })

  it('refuses rather than trims a prompt over an older host cap', () => {
    const draft = agentDraft('x'.repeat(LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH + 1))

    expect(
      isQuickCommandDraftPromptTooLong(draft, LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH)
    ).toBe(true)
    expect(draftToQuickCommand(draft, LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH)).toBeNull()
  })
})
