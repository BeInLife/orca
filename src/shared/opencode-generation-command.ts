import type { CommitMessagePlan } from './commit-message-plan'

export function mergeOpenCodeGenerationArgs(
  agentId: string,
  binary: string,
  prefixArgs: string[],
  args: string[]
): string[] {
  if (
    (agentId === 'opencode' || agentId === 'opencode2') &&
    /(?:^|[\\/])opencode2?(?:\.(?:cmd|exe))?$/i.test(binary) &&
    args[0] === 'run' &&
    !prefixArgs.includes('--')
  ) {
    return ['run', ...prefixArgs, ...args.slice(1)]
  }
  return [...prefixArgs, ...args]
}

export function openCodeVariantRetryPlan(
  plan: CommitMessagePlan,
  stderr: string
): CommitMessagePlan | null {
  // Retry only an argv rejection, which happens before a model turn starts.
  if (!stderr.includes('Unrecognized flag: --variant in command opencode run')) {
    return null
  }
  const variantIndex = plan.args.indexOf('--variant')
  const modelIndex = plan.args.findIndex((arg) => arg === '--model' || arg === '-m')
  const variant = plan.args[variantIndex + 1]
  const model = plan.args[modelIndex + 1]
  if (variantIndex === -1 || modelIndex === -1 || !variant || !model) {
    return null
  }
  const args = [...plan.args]
  args[modelIndex + 1] = `${model.split('#')[0]}#${variant}`
  args.splice(variantIndex, 2)
  return { ...plan, args }
}
