import { describe, expect, it } from 'vitest'
import { planLaunchAgentStartupPrompt } from './launch-agent-startup-prompt-plan'

function plan(prompt: string, platform: NodeJS.Platform, deliverOversizedPromptAfterReady = true) {
  return planLaunchAgentStartupPrompt({
    base: { agent: 'claude', cmdOverrides: {}, platform },
    prompt,
    promptDelivery: 'auto-submit',
    isFollowupPath: false,
    deliverOversizedPromptAfterReady
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
    // The host's agent-prompt writer delivers it, not the renderer's paste.
    expect(result.deliverPastedPromptThroughHost).toBe(true)
    expect(result.startupPlan?.launchCommand).not.toContain('Review this PR')
    expect(result.startupPlan?.followupPrompt).toBeNull()
  })

  it('judges Windows against cmd.exe, whatever the shell', () => {
    const prompt = 'x'.repeat(7700)
    const result = planLaunchAgentStartupPrompt({
      base: { agent: 'claude', cmdOverrides: {}, platform: 'win32', shell: 'powershell' },
      prompt,
      promptDelivery: 'auto-submit',
      isFollowupPath: false,
      deliverOversizedPromptAfterReady: true
    })

    expect(result.pasteDraftAfterLaunch).toBe(prompt)
  })

  it('leaves a paired host to decide, building the prompt into the command as before', () => {
    const prompt = 'Review this PR. '.repeat(1600)
    const result = plan(prompt, 'win32', false)

    expect(result.pasteDraftAfterLaunch).toBeNull()
    expect(result.startupPlan?.launchCommand).toContain('Review this PR')
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
