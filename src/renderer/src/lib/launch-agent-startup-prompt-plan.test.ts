import { describe, expect, it } from 'vitest'
import { planLaunchAgentStartupPrompt } from './launch-agent-startup-prompt-plan'

function plan(prompt: string, platform: NodeJS.Platform) {
  return planLaunchAgentStartupPrompt({
    base: { agent: 'claude', cmdOverrides: {}, platform },
    prompt,
    promptDelivery: 'auto-submit',
    isFollowupPath: false
  })
}

describe('planLaunchAgentStartupPrompt', () => {
  it('carries a prompt that fits the command line on the launch command', () => {
    const result = plan('Review this PR', 'win32')

    expect(result.pasteDraftAfterLaunch).toBeNull()
    expect(result.startupPlan?.launchCommand).toContain('Review this PR')
  })

  it('pastes and submits a prompt too long for a Windows command line after the agent starts', () => {
    const prompt = 'Review this PR. '.repeat(1600)
    const result = plan(prompt, 'win32')

    expect(result.pasteDraftAfterLaunch).toBe(prompt)
    expect(result.submitPastedPrompt).toBe(true)
    expect(result.startupPlan?.launchCommand).not.toContain('Review this PR')
  })

  it('keeps the same prompt on the launch command where the shell can take it', () => {
    const prompt = 'Review this PR. '.repeat(1600)
    const result = plan(prompt, 'linux')

    expect(result.pasteDraftAfterLaunch).toBeNull()
    expect(result.startupPlan?.launchCommand).toContain('Review this PR')
  })

  it('pastes a prompt past the per-argument limit on Linux and macOS', () => {
    const prompt = 'x'.repeat(200 * 1024)
    const result = plan(prompt, 'darwin')

    expect(result.pasteDraftAfterLaunch).toBe(prompt)
    expect(result.submitPastedPrompt).toBe(true)
  })
})
