import { describe, expect, it } from 'vitest'
import {
  CMD_EXE_COMMAND_LINE_MAX_CHARS,
  launchCommandFits,
  LAUNCH_ENV_MAX_CHARS,
  WINDOWS_LAUNCH_COMMAND_MAX_WEIGHTED_CHARS,
  windowsWeightedCommandLength
} from './agent-launch-command-line-budget'

describe('launch command line budget', () => {
  it('keeps the Windows budget below cmd.exe with room for a shim prefix', () => {
    expect(WINDOWS_LAUNCH_COMMAND_MAX_WEIGHTED_CHARS).toBeLessThan(CMD_EXE_COMMAND_LINE_MAX_CHARS)
    expect(CMD_EXE_COMMAND_LINE_MAX_CHARS - WINDOWS_LAUNCH_COMMAND_MAX_WEIGHTED_CHARS).toBe(540)
  })

  it('counts each double quote and backslash twice on Windows', () => {
    expect(windowsWeightedCommandLength('ab')).toBe(2)
    expect(windowsWeightedCommandLength('"a\\b"')).toBe(8)
  })

  it('judges Windows against cmd.exe whatever the quoting grew to', () => {
    const plain = 'x'.repeat(WINDOWS_LAUNCH_COMMAND_MAX_WEIGHTED_CHARS)
    expect(launchCommandFits({ command: plain, platform: 'win32' })).toBe(true)
    expect(launchCommandFits({ command: `${plain}x`, platform: 'win32' })).toBe(false)
    // The raw length fits; the re-escaped cmd.exe line would not.
    const quoted = '"'.repeat(WINDOWS_LAUNCH_COMMAND_MAX_WEIGHTED_CHARS / 2 + 1)
    expect(quoted.length).toBeLessThan(WINDOWS_LAUNCH_COMMAND_MAX_WEIGHTED_CHARS)
    expect(launchCommandFits({ command: quoted, platform: 'win32' })).toBe(false)
  })

  it('budgets Windows environment text separately from the command line', () => {
    const value = 'd'.repeat(LAUNCH_ENV_MAX_CHARS - 'DRAFT'.length - 2)
    expect(launchCommandFits({ command: 'agent', env: { DRAFT: value }, platform: 'win32' })).toBe(
      true
    )
    expect(
      launchCommandFits({ command: 'agent', env: { DRAFT: `${value}d` }, platform: 'win32' })
    ).toBe(false)
  })

  it('limits each POSIX argument or env string to 128 KiB', () => {
    const limit = 128 * 1024
    expect(launchCommandFits({ command: 'x'.repeat(limit - 1), platform: 'linux' })).toBe(true)
    expect(launchCommandFits({ command: 'x'.repeat(limit), platform: 'linux' })).toBe(false)
    // UTF-8 bytes, not UTF-16 units.
    expect(
      launchCommandFits({ command: '界'.repeat(Math.ceil(limit / 3)), platform: 'darwin' })
    ).toBe(false)
    expect(
      launchCommandFits({ command: 'agent', env: { K: 'v'.repeat(limit) }, platform: 'linux' })
    ).toBe(false)
  })
})
