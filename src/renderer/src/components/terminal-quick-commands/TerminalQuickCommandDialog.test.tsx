// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalQuickCommand } from '../../../../shared/terminal-quick-command-types'
import { LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH } from '../../../../shared/terminal-quick-commands'
import { TerminalQuickCommandDialog } from './TerminalQuickCommandDialog'

const mountedRoots: Root[] = []

async function renderDialog(
  command: TerminalQuickCommand,
  props: {
    defaultAdvancedOpen?: boolean
    agentPromptMaxLength?: number | null
    onSave?: (command: TerminalQuickCommand) => void
  } = {}
): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)

  await act(async () => {
    root.render(
      <TerminalQuickCommandDialog
        open={true}
        mode="add"
        command={command}
        repos={[]}
        defaultAdvancedOpen={props.defaultAdvancedOpen}
        agentPromptMaxLength={props.agentPromptMaxLength}
        onOpenChange={vi.fn()}
        onSave={props.onSave ?? vi.fn()}
      />
    )
  })
}

function findAnimatedRowContaining(text: string): HTMLElement {
  const row = Array.from(document.body.querySelectorAll<HTMLElement>('[aria-hidden]')).find(
    (element) => element.textContent?.includes(text)
  )
  if (!row) {
    throw new Error(`Could not find animated row containing ${text}`)
  }
  return row
}

describe('TerminalQuickCommandDialog animation structure', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { userAgent: 'Macintosh' })
  })

  afterEach(async () => {
    await act(async () => {
      for (const root of mountedRoots.splice(0)) {
        root.unmount()
      }
    })
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('selects all text in editable fields with Cmd+A', async () => {
    await renderDialog({
      id: 'qc-select-all',
      label: 'Start dev server',
      action: 'terminal-command',
      command: 'npm run dev',
      appendEnter: true,
      scope: { type: 'global' }
    })

    const fields = [
      document.body.querySelector<HTMLInputElement>('input'),
      document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="Command"]')
    ]

    for (const field of fields) {
      expect(field).not.toBeNull()
      if (!field) {
        continue
      }
      field.setSelectionRange(field.value.length, field.value.length)
      await act(async () => {
        field.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'a',
            code: 'KeyA',
            metaKey: true,
            bubbles: true,
            cancelable: true
          })
        )
      })

      expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length])
    }
  })

  it('keeps agent-only fields mounted as collapsed animated rows in terminal mode', async () => {
    await renderDialog({
      id: 'qc-1',
      label: 'Start dev server',
      action: 'terminal-command',
      command: 'npm run dev',
      appendEnter: true,
      scope: { type: 'global' }
    })

    const agentRow = findAnimatedRowContaining('Agent')

    expect(agentRow.getAttribute('aria-hidden')).toBe('true')
    expect(agentRow.className).toContain('transition-[grid-template-rows]')
    expect(agentRow.className).toContain('grid-rows-[0fr]')
  })

  it('shows append enter in the editor footer for terminal commands', async () => {
    await renderDialog({
      id: 'qc-2',
      label: 'Start dev server',
      action: 'terminal-command',
      command: 'npm run dev',
      appendEnter: true,
      scope: { type: 'global' }
    })

    expect(document.body.textContent).toContain('Append Enter — run immediately')
    expect(document.body.textContent).not.toContain('Supports /goal, skills, paths')
  })

  it('hides append enter and shows agent toolbar hint in agent mode', async () => {
    await renderDialog({
      id: 'qc-3',
      label: 'Investigate',
      action: 'agent-prompt',
      agent: 'claude',
      prompt: 'Look into the build',
      scope: { type: 'global' }
    })

    expect(document.body.textContent).toContain('Supports /goal, skills, paths')
    expect(document.body.textContent).not.toContain('Append Enter — run immediately')
  })

  it('shows scope summary on the collapsed advanced toggle', async () => {
    await renderDialog({
      id: 'qc-4',
      label: 'Start dev server',
      action: 'terminal-command',
      command: 'npm run dev',
      appendEnter: true,
      scope: { type: 'global' }
    })

    expect(document.body.textContent).toMatch(/Advanced\s*·\s*Global/)
  })

  it('opens the advanced section when defaultAdvancedOpen is true', async () => {
    await renderDialog(
      {
        id: 'qc-5',
        label: 'Start dev server',
        action: 'terminal-command',
        command: 'npm run dev',
        appendEnter: true,
        scope: { type: 'global' }
      },
      { defaultAdvancedOpen: true }
    )

    const advancedToggle = document.body.querySelector('[aria-expanded="true"]')
    expect(advancedToggle?.textContent).toContain('Advanced')
    expect(document.body.textContent).not.toMatch(/Advanced\s*·\s*Global/)
  })

  it('refuses to save a prompt over an older host cap instead of truncating it', async () => {
    const onSave = vi.fn()
    await renderDialog(
      {
        id: 'qc-6',
        label: 'Review',
        action: 'agent-prompt',
        agent: 'claude',
        prompt: 'x'.repeat(LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH + 1),
        scope: { type: 'global' }
      },
      { onSave, agentPromptMaxLength: LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH }
    )

    const save = Array.from(document.body.querySelectorAll('button')).find((button) =>
      button.textContent?.startsWith('Save')
    )
    expect(save?.disabled).toBe(true)
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      'too long for this host'
    )
    expect(document.body.querySelector('textarea')?.getAttribute('aria-invalid')).toBe('true')

    const textarea = document.body.querySelector('textarea')!
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })
      )
    })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves a prompt at an older host cap in full', async () => {
    const onSave = vi.fn()
    const prompt = 'x'.repeat(LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH)
    await renderDialog(
      {
        id: 'qc-7',
        label: 'Review',
        action: 'agent-prompt',
        agent: 'claude',
        prompt,
        scope: { type: 'global' }
      },
      { onSave, agentPromptMaxLength: LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH }
    )

    expect(document.body.textContent).toContain('characters')
    expect(document.body.querySelector('[role="alert"]')).toBeNull()
    const textarea = document.body.querySelector('textarea')!
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })
      )
    })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ prompt }))
  })

  it('saves a long prompt with no limit or counter when the host has no cap', async () => {
    const onSave = vi.fn()
    const prompt = 'x'.repeat(LEGACY_MAX_QUICK_COMMAND_AGENT_PROMPT_LENGTH * 3)
    await renderDialog(
      {
        id: 'qc-8',
        label: 'Review',
        action: 'agent-prompt',
        agent: 'claude',
        prompt,
        scope: { type: 'global' }
      },
      { onSave }
    )

    expect(document.body.textContent).not.toContain('characters')
    expect(document.body.textContent).toContain('Drag corner to resize')
    const textarea = document.body.querySelector('textarea')!
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true })
      )
    })
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ prompt }))
  })
})
