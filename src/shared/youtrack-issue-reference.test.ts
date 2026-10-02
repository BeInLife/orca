import { describe, expect, it } from 'vitest'
import { parseYouTrackIssueIdPrefix, parseYouTrackIssueReference } from './youtrack-issue-reference'
import { buildSmartWorkspaceSourceRows } from './new-workspace/smart-workspace-source-results'
import type { YouTrackIssue } from './youtrack-types'

const BASE = 'https://yt.example.com/youtrack'

describe('parseYouTrackIssueReference', () => {
  it('reads bare IDs in any case', () => {
    expect(parseYouTrackIssueReference(' proj-81 ', null)).toBe('PROJ-81')
    expect(parseYouTrackIssueReference('PROJ', BASE)).toBeNull()
    expect(parseYouTrackIssueReference('fix login', BASE)).toBeNull()
  })

  it('reads issue URLs only from the connected instance', () => {
    expect(parseYouTrackIssueReference(`${BASE}/issue/PROJ-81/some-slug`, BASE)).toBe('PROJ-81')
    expect(parseYouTrackIssueReference(`${BASE}/issue/proj-81`, BASE)).toBe('PROJ-81')
    expect(parseYouTrackIssueReference('https://other.example.com/issue/PROJ-81', BASE)).toBeNull()
    expect(
      parseYouTrackIssueReference('https://acme.atlassian.net/browse/PROJ-81', BASE)
    ).toBeNull()
  })
})

describe('parseYouTrackIssueIdPrefix', () => {
  it('accepts project prefixes with or without digits', () => {
    expect(parseYouTrackIssueIdPrefix('proj-')).toBe('PROJ-')
    expect(parseYouTrackIssueIdPrefix(' proj-8 ')).toBe('PROJ-8')
    expect(parseYouTrackIssueIdPrefix('proj')).toBeNull()
    expect(parseYouTrackIssueIdPrefix('fix-login')).toBeNull()
  })
})

describe('buildSmartWorkspaceSourceRows with a YouTrack issue', () => {
  const issue: YouTrackIssue = {
    id: '2-81',
    idReadable: 'PROJ-81',
    summary: 'Tests',
    url: `${BASE}/issue/PROJ-81`,
    project: { id: '0-16', shortName: 'PROJ', name: 'Project' },
    state: null,
    stateFieldName: null,
    assignee: null,
    reporter: null,
    priority: null,
    type: null,
    fields: [],
    tags: [],
    links: [],
    unresolvedBlockerCount: 0,
    resolved: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z'
  }
  const base = {
    branches: [],
    githubItems: [],
    gitlabAvailable: false,
    gitlabItems: [],
    linearAvailable: false,
    linearIssues: [],
    resultLimit: 10,
    value: 'PROJ-81'
  }

  it('puts the resolved issue first in smart mode', () => {
    const rows = buildSmartWorkspaceSourceRows({ ...base, mode: 'smart', youtrackIssues: [issue] })
    expect(rows.map((row) => row.kind)).toEqual(['youtrack', 'use-name'])
  })

  it('leaves other modes alone', () => {
    const rows = buildSmartWorkspaceSourceRows({ ...base, mode: 'github', youtrackIssues: [issue] })
    expect(rows.some((row) => row.kind === 'youtrack')).toBe(false)
  })
})
