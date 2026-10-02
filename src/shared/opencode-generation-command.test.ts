import { describe, expect, it } from 'vitest'
import { planCommitMessageGeneration } from './commit-message-plan'
import { openCodeVariantRetryPlan } from './opencode-generation-command'

const rejection = 'Unrecognized flag: --variant in command opencode run'
describe('OpenCode generation commands', () => {
  it.each(['opencode', 'opencode.exe', 'opencode.cmd', 'opencode2'])(
    'keeps run before launch flags for %s',
    (binary) => {
      const result = planCommitMessageGeneration(
        { agentId: 'opencode', model: 'default', agentCommandOverride: `${binary} --auto` },
        'PROMPT'
      )
      expect(result).toMatchObject({
        ok: true,
        plan: {
          args: ['run', '--auto', '--agent', 'build', '--format', 'json'],
          stdinPayload: 'PROMPT',
          outputFormat: 'opencode-json'
        }
      })
    }
  )

  it('keeps explicit formatted output recipes on their requested output format', () => {
    const result = planCommitMessageGeneration(
      { agentId: 'opencode', model: 'default', agentArgs: '--format default' },
      'PROMPT'
    )
    if (!result.ok) {
      throw new Error(result.error)
    }
    expect(result.plan.outputFormat).toBeUndefined()
  })

  it('retries only the precise v2 argv rejection, retaining the prompt and selected model', () => {
    const result = planCommitMessageGeneration(
      { agentId: 'opencode', model: 'fixture/chat', thinkingLevel: 'high' },
      'PROMPT'
    )
    if (!result.ok) {
      throw new Error(result.error)
    }
    expect(openCodeVariantRetryPlan(result.plan, rejection)).toMatchObject({
      args: ['run', '--model', 'fixture/chat#high', '--agent', 'build', '--format', 'json'],
      stdinPayload: 'PROMPT'
    })
    expect(openCodeVariantRetryPlan(result.plan, 'provider rejected the request')).toBeNull()
    expect(openCodeVariantRetryPlan(result.plan, 'Unrecognized flag: --other')).toBeNull()
  })
})
