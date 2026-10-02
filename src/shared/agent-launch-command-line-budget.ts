import { getTerminalInputByteLength } from './terminal-input'

/** cmd.exe's own documented command-line ceiling. */
export const CMD_EXE_COMMAND_LINE_MAX_CHARS = 8191
// Why: an npm/pnpm `.cmd` shim re-enters cmd.exe with its interpreter and script paths ahead of
// the arguments; two MAX_PATH paths plus the `cmd.exe /d /s /c ""…""` wrapper fit in this reserve.
const WINDOWS_SHIM_PREFIX_RESERVE_CHARS = 540
export const WINDOWS_LAUNCH_COMMAND_MAX_WEIGHTED_CHARS =
  CMD_EXE_COMMAND_LINE_MAX_CHARS - WINDOWS_SHIM_PREFIX_RESERVE_CHARS
/** Text a launch carries in its environment (drafts, Hermes queries) shares this block budget. */
export const LAUNCH_ENV_MAX_CHARS = 24_000
// Why: Linux refuses any one argument or env string over MAX_ARG_STRLEN (32 pages); macOS's
// ARG_MAX is larger. Measuring the whole quoted line over-counts the prompt, so this stays safe.
const POSIX_INLINE_ARGUMENT_LIMIT_BYTES = 128 * 1024

/**
 * The cmd.exe line a Windows launch command can become: each `"` and `\` may be escaped once
 * more when PowerShell or MSYS hands the line to cmd.exe for a `.cmd` shim.
 */
export function windowsWeightedCommandLength(command: string): number {
  let length = command.length
  for (let index = 0; index < command.length; index += 1) {
    const code = command.charCodeAt(index)
    if (code === 0x22 || code === 0x5c) {
      length += 1
    }
  }
  return length
}

/**
 * Whether a launch command carrying a prompt or draft inline will start on this platform.
 *
 * Windows is judged against cmd.exe whatever the shell: nothing at plan time can rule out a
 * `.cmd` shim (an npm install without a `.ps1`, an agent command override, an SSH host whose
 * default shell is cmd), and a shim re-enters cmd.exe and its line ceiling.
 */
export function launchCommandFits(args: {
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
  const envChars = envEntries.reduce(
    (total, [key, value]) => total + key.length + value.length + 2,
    0
  )
  return (
    windowsWeightedCommandLength(args.command) <= WINDOWS_LAUNCH_COMMAND_MAX_WEIGHTED_CHARS &&
    envChars <= LAUNCH_ENV_MAX_CHARS
  )
}

// Why: drafts keep the threshold they had before prompts got the cmd.exe rule; changing draft
// launches is outside this rule's purpose.
const WIN32_INLINE_DRAFT_LIMIT_CHARS = 24_000

/** Whether a launch command carrying a draft (unsent composer text) fits, by the draft rule. */
export function draftLaunchCommandFits(args: {
  command: string
  env?: Record<string, string>
  platform: NodeJS.Platform
}): boolean {
  if (args.platform !== 'win32') {
    return true
  }
  const envChars = Object.entries(args.env ?? {}).reduce(
    (total, [key, value]) => total + key.length + value.length,
    0
  )
  return args.command.length + envChars <= WIN32_INLINE_DRAFT_LIMIT_CHARS
}
