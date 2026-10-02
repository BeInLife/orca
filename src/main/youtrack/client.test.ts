import { describe, expect, it, vi } from 'vitest'

vi.mock('../network/http-client', () => ({ getMainHttpClient: vi.fn() }))
vi.mock('../network/proxy-settings', () => ({ ensureElectronProxyFromEnvironment: vi.fn() }))

const { buildIssueQuery } = await import('./client')

describe('buildIssueQuery', () => {
  it('maps presets to YouTrack queries sorted by update time', () => {
    expect(buildIssueQuery({ preset: 'assigned' })).toBe(
      'Assignee: me #Unresolved sort by: updated desc'
    )
    expect(buildIssueQuery({})).toBe('Assignee: me #Unresolved sort by: updated desc')
  })

  it('prefers a custom query and keeps its own sort', () => {
    expect(buildIssueQuery({ preset: 'done', query: ' project: APP ' })).toBe(
      'project: APP sort by: updated desc'
    )
    expect(buildIssueQuery({ query: 'project: APP sort by: priority' })).toBe(
      'project: APP sort by: priority'
    )
  })
})
