import { getTerminalInputByteLength } from './terminal-input'

const WIN32_INLINE_LAUNCH_LIMIT_CHARS = 24_000
// Why: Linux refuses any one argument or env string over MAX_ARG_STRLEN (32 pages); macOS's
// ARG_MAX is larger. Measuring the whole quoted line over-counts the prompt, so this stays safe.
const POSIX_INLINE_ARGUMENT_LIMIT_BYTES = 128 * 1024

/**
 * Whether a launch command carrying a prompt or draft inline will start on this platform.
 * When it will not, callers launch clean and use the post-ready paste instead.
 */
export function agentLaunchCommandFitsPlatform(args: {
  command: string
  env?: Record<string, string>
  platform: NodeJS.Platform
}): boolean {
  const envEntries = Object.entries(args.env ?? {})
  if (args.platform !== 'win32') {
    return [args.command, ...envEntries.map(([key, value]) => `${key}=${value}`)].every(
      (text) => getTerminalInputByteLength(text) < POSIX_INLINE_ARGUMENT_LIMIT_BYTES
    )
  }
  const envChars = envEntries.reduce((total, [key, value]) => total + key.length + value.length, 0)
  // Why: Windows CreateProcess/env blocks have tight length ceilings.
  return args.command.length + envChars <= WIN32_INLINE_LAUNCH_LIMIT_CHARS
}
