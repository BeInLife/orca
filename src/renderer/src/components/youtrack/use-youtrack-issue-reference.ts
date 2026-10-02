import { useEffect, useState } from 'react'
import type { YouTrackIssue } from '../../../../shared/youtrack-types'
import { parseYouTrackIssueReference } from '../../../../shared/youtrack-issue-reference'
import { useYouTrackStore } from './youtrack-store'

const LOOKUP_DEBOUNCE_MS = 250

/** Resolves a typed YouTrack ID or issue URL to the issue, once YouTrack confirms it exists. */
export function useYouTrackIssueReference(value: string, enabled: boolean): YouTrackIssue | null {
  const connected = useYouTrackStore((s) => s.status.connected)
  const statusChecked = useYouTrackStore((s) => s.statusChecked)
  const baseUrl = useYouTrackStore((s) => s.status.baseUrl)
  const checkStatus = useYouTrackStore((s) => s.checkStatus)
  const [resolved, setResolved] = useState<YouTrackIssue | null>(null)
  const issueId = enabled && connected ? parseYouTrackIssueReference(value, baseUrl) : null

  useEffect(() => {
    if (enabled && !statusChecked) {
      void checkStatus()
    }
  }, [checkStatus, enabled, statusChecked])

  useEffect(() => {
    const api = window.api?.youtrack
    if (!issueId || !api) {
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void api.getIssue({ idReadable: issueId }).then((result) => {
        if (!cancelled && result.ok) {
          setResolved(result.issue)
        }
      })
    }, LOOKUP_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [issueId])

  // Why: a lookup for an earlier ID must not surface once the input moved on.
  return resolved && issueId && resolved.idReadable.toUpperCase() === issueId ? resolved : null
}
