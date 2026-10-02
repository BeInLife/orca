import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { YouTrackComment, YouTrackIssue } from '../../shared/youtrack-types'
import type { CommandHandler } from '../dispatch'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRepeatedStringFlag,
  getRequiredStringFlag,
  getRequiredStringFlagAllowingEmpty
} from '../flags'
import { printResult } from '../format'
import { buildLinearCurrentContext } from '../linear-request-builders'
import { RuntimeClientError } from '../runtime-client'
import {
  formatYouTrackComment,
  formatYouTrackIssue,
  formatYouTrackIssueList,
  formatYouTrackIssueSaved
} from '../youtrack-format'

const PRESETS = ['assigned', 'reported', 'open', 'done'] as const
const WRITE_TIMEOUT_MS = 60_000

type IssueTarget = { id?: string; current?: ReturnType<typeof buildLinearCurrentContext> }

function buildIssueTarget(
  flags: Map<string, string | boolean>,
  cwd: string,
  remote: boolean
): IssueTarget {
  const id = getOptionalStringFlag(flags, 'id')
  if (flags.get('current') === true) {
    if (id) {
      throw new RuntimeClientError('invalid_argument', 'Use either an issue ID or --current')
    }
    return { current: buildLinearCurrentContext(cwd, remote) }
  }
  if (!id) {
    throw new RuntimeClientError('invalid_argument', 'Pass an issue ID or --current')
  }
  return { id }
}

async function readBody(
  flags: Map<string, string | boolean>,
  cwd: string,
  required: boolean
): Promise<string | undefined> {
  if (flags.has('body') && flags.has('body-file')) {
    throw new RuntimeClientError('invalid_argument', 'Use either --body or --body-file, not both')
  }
  if (flags.has('body')) {
    return getRequiredStringFlagAllowingEmpty(flags, 'body')
  }
  if (flags.has('body-file')) {
    const path = getRequiredStringFlag(flags, 'body-file')
    if (path === '-') {
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.from(chunk))
      }
      return Buffer.concat(chunks).toString('utf8')
    }
    return readFile(isAbsolute(path) ? path : join(cwd, path), 'utf8')
  }
  if (required) {
    throw new RuntimeClientError('invalid_argument', 'Missing --body or --body-file')
  }
  return undefined
}

/** "Name=Value" pairs; repeating a name builds a multi-value field. */
function parseFieldFlags(entries: string[]): { name: string; values: string[] }[] {
  const byName = new Map<string, string[]>()
  for (const entry of entries) {
    const separator = entry.indexOf('=')
    if (separator <= 0) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--field must look like Name=Value: ${entry}`
      )
    }
    const name = entry.slice(0, separator).trim()
    byName.set(name, [...(byName.get(name) ?? []), entry.slice(separator + 1)])
  }
  return [...byName].map(([name, values]) => ({ name, values }))
}

export const YOUTRACK_HANDLERS: Record<string, CommandHandler> = {
  'youtrack issue': async ({ flags, client, cwd, json }) => {
    const response = await client.call<{ issue: YouTrackIssue; comments?: YouTrackComment[] }>(
      'youtrack.issue',
      { ...buildIssueTarget(flags, cwd, client.isRemote), comments: flags.get('comments') === true }
    )
    printResult(response, json, formatYouTrackIssue)
  },
  'youtrack list': async ({ flags, client, json }) => {
    const preset = getOptionalStringFlag(flags, 'preset')
    if (preset && !PRESETS.some((value) => value === preset)) {
      throw new RuntimeClientError(
        'invalid_argument',
        `--preset must be one of ${PRESETS.join(', ')}`
      )
    }
    const response = await client.call<{ issues: YouTrackIssue[] }>('youtrack.list', {
      preset,
      query: getOptionalStringFlag(flags, 'query'),
      limit: getOptionalPositiveIntegerFlag(flags, 'limit')
    })
    printResult(response, json, formatYouTrackIssueList)
  },
  'youtrack comment add': async ({ flags, client, cwd, json }) => {
    const text = (await readBody(flags, cwd, true)) ?? ''
    const response = await client.call<{ idReadable: string; comment: YouTrackComment }>(
      'youtrack.commentAdd',
      { ...buildIssueTarget(flags, cwd, client.isRemote), text },
      { timeoutMs: WRITE_TIMEOUT_MS }
    )
    printResult(response, json, formatYouTrackComment)
  },
  'youtrack state set': async ({ flags, client, cwd, json }) => {
    const response = await client.call<{ issue: YouTrackIssue }>(
      'youtrack.stateSet',
      {
        ...buildIssueTarget(flags, cwd, client.isRemote),
        state: getRequiredStringFlag(flags, 'to')
      },
      { timeoutMs: WRITE_TIMEOUT_MS }
    )
    printResult(response, json, formatYouTrackIssueSaved)
  },
  'youtrack field set': async ({ flags, client, cwd, json }) => {
    const values = getRepeatedStringFlag(flags, 'value')
    const clear = flags.get('clear') === true
    if (clear === values.length > 0) {
      throw new RuntimeClientError('invalid_argument', 'Pass --value (repeatable) or --clear')
    }
    const response = await client.call<{ issue: YouTrackIssue }>(
      'youtrack.fieldSet',
      {
        ...buildIssueTarget(flags, cwd, client.isRemote),
        name: getRequiredStringFlag(flags, 'name'),
        values
      },
      { timeoutMs: WRITE_TIMEOUT_MS }
    )
    printResult(response, json, formatYouTrackIssueSaved)
  },
  'youtrack create': async ({ flags, client, cwd, json }) => {
    const response = await client.call<{ issue: YouTrackIssue }>(
      'youtrack.create',
      {
        project: getRequiredStringFlag(flags, 'project'),
        summary: getRequiredStringFlag(flags, 'summary'),
        description: await readBody(flags, cwd, false),
        fields: parseFieldFlags(getRepeatedStringFlag(flags, 'field'))
      },
      { timeoutMs: WRITE_TIMEOUT_MS }
    )
    printResult(response, json, formatYouTrackIssueSaved)
  }
}
