import { describe, expect, it } from 'vitest'
import { buildAgentDraftLaunchPlan, buildAgentStartupPlan } from './tui-agent-startup'
import { WINDOWS_LAUNCH_COMMAND_MAX_WEIGHTED_CHARS } from './agent-launch-command-line-budget'

// Shape of the reported 7,008-character review prompt: prose lines, no double quotes.
const REVIEW_PROMPT = Array.from(
  { length: 100 },
  (_, line) => `Line ${line}: review the change and report each finding with evidence.`
)
  .join('\n')
  .padEnd(7008, '.')
  .slice(0, 7008)

describe('a startup prompt the launch command cannot carry', () => {
  it('rides the Windows launch command at the reported length', () => {
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt: REVIEW_PROMPT,
      cmdOverrides: {},
      platform: 'win32',
      deliverOversizedPromptAfterReady: true
    })
    expect(REVIEW_PROMPT).toHaveLength(7008)
    expect(plan?.followupPrompt).toBeNull()
    expect(plan?.launchCommand).toContain('Line 99')
  })

  it('becomes a clean launch plus a followup when the caller delivers after ready', () => {
    const prompt = 'p'.repeat(WINDOWS_LAUNCH_COMMAND_MAX_WEIGHTED_CHARS)
    const clean = buildAgentStartupPlan({
      agent: 'claude',
      prompt: '',
      cmdOverrides: {},
      platform: 'win32',
      allowEmptyPromptLaunch: true
    })
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt,
      cmdOverrides: {},
      platform: 'win32',
      deliverOversizedPromptAfterReady: true
    })
    expect(plan?.followupPrompt).toBe(prompt)
    expect(plan?.launchCommand).toBe(clean?.launchCommand)
  })

  it('applies the POSIX per-argument limit', () => {
    const prompt = 'p'.repeat(128 * 1024)
    const plan = buildAgentStartupPlan({
      agent: 'codex',
      prompt,
      cmdOverrides: {},
      platform: 'linux',
      deliverOversizedPromptAfterReady: true
    })
    expect(plan?.followupPrompt).toBe(prompt)
    expect(plan?.launchCommand).not.toContain('ppp')
  })

  it('keeps building inline for callers that have not opted in', () => {
    const prompt = 'p'.repeat(WINDOWS_LAUNCH_COMMAND_MAX_WEIGHTED_CHARS)
    const plan = buildAgentStartupPlan({
      agent: 'claude',
      prompt,
      cmdOverrides: {},
      platform: 'win32'
    })
    expect(plan?.followupPrompt).toBeNull()
    expect(plan?.launchCommand).toContain(prompt)
  })

  it('delivers an oversized Hermes query after ready instead of refusing it', () => {
    const prompt = 'q'.repeat(24_000)
    expect(
      buildAgentStartupPlan({ agent: 'hermes', prompt, cmdOverrides: {}, platform: 'win32' })
    ).toBeNull()
    const plan = buildAgentStartupPlan({
      agent: 'hermes',
      prompt,
      agentArgs: '--yolo',
      cmdOverrides: {},
      platform: 'win32',
      deliverOversizedPromptAfterReady: true
    })
    expect(plan?.followupPrompt).toBe(prompt)
    // The clean launch keeps the configured args the query plan would have re-applied.
    expect(plan?.launchCommand).toContain('--yolo')
    expect(Object.values(plan?.env ?? {}).join('')).not.toContain('qqq')
  })

  it('leaves drafts on their own pre-existing rule: Windows to 24,000, POSIX unbounded', () => {
    const draftOf = (length: number, platform: NodeJS.Platform) =>
      buildAgentDraftLaunchPlan({
        agent: 'claude',
        draft: 'd'.repeat(length),
        cmdOverrides: {},
        platform
      })

    // Over the prompt rule's cmd.exe budget, still carried on `--prefill` as before.
    const windowsDraft = draftOf(10_000, 'win32')
    expect(windowsDraft?.launchCommand).toContain('--prefill')
    expect(windowsDraft?.launchCommand).toContain('d'.repeat(10_000))
    expect(draftOf(24_000, 'win32')).toBeNull()
    expect(draftOf(200 * 1024, 'darwin')?.launchCommand).toContain('--prefill')
  })
})
