import { useEffect, useMemo, useState } from 'react'
import type { YouTrackIssue } from '../../../../shared/youtrack-types'
import {
  parseYouTrackIssueIdPrefix,
  parseYouTrackIssueReference
} from '../../../../shared/youtrack-issue-reference'
import { useYouTrackStore } from './youtrack-store'
import { useYouTrackVisible } from './use-youtrack-visible'

const LOOKUP_DEBOUNCE_MS = 250
const ASSIGNED_CACHE_TTL_MS = 60_000
const MAX_SUGGESTIONS = 8

// Why module-level: reopening the dialog or retyping a prefix reuses one fetch per minute.
let assignedCache: { at: number; issues: YouTrackIssue[] } | null = null
let assignedInFlight: Promise<YouTrackIssue[]> | null = null

function loadAssignedIssues(): Promise<YouTrackIssue[]> {
  const api = window.api?.youtrack
  if (!api) {
    return Promise.resolve([])
  }
  if (assignedCache && Date.now() - assignedCache.at < ASSIGNED_CACHE_TTL_MS) {
    return Promise.resolve(assignedCache.issues)
  }
  assignedInFlight ??= api
    .listIssues({ preset: 'assigned', limit: 100 })
    .then((result) => {
      const issues = result.ok ? result.issues : []
      assignedCache = { at: Date.now(), issues }
      return issues
    })
    .finally(() => {
      assignedInFlight = null
    })
  return assignedInFlight
}

/**
 * YouTrack issues for the create-worktree Smart field: a typed ID or issue URL once YouTrack
 * confirms it, then the viewer's open assigned issues whose ID starts with the typed prefix.
 */
export function useYouTrackIssueSuggestions(value: string, enabled: boolean): YouTrackIssue[] {
  const connected = useYouTrackStore((s) => s.status.connected)
  const statusChecked = useYouTrackStore((s) => s.statusChecked)
  const baseUrl = useYouTrackStore((s) => s.status.baseUrl)
  const checkStatus = useYouTrackStore((s) => s.checkStatus)
  const [resolved, setResolved] = useState<YouTrackIssue | null>(null)
  const [assigned, setAssigned] = useState<YouTrackIssue[]>([])
  // Why: hiding YouTrack in Settings → Tasks must also stop it querying from Create worktree.
  const visible = useYouTrackVisible()
  const active = enabled && connected && visible
  const issueId = active ? parseYouTrackIssueReference(value, baseUrl) : null
  const prefix = active ? parseYouTrackIssueIdPrefix(value) : null

  useEffect(() => {
    if (enabled && visible && !statusChecked) {
      void checkStatus()
    }
  }, [checkStatus, enabled, statusChecked, visible])

  useEffect(() => {
    if (!prefix) {
      return
    }
    let cancelled = false
    void loadAssignedIssues().then((issues) => {
      if (!cancelled) {
        setAssigned(issues)
      }
    })
    return () => {
      cancelled = true
    }
  }, [prefix])

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
  const exact =
    resolved && issueId && resolved.idReadable.toUpperCase() === issueId ? resolved : null
  // Why memo: the Smart field keys effects on its rows, so a fresh array per render would loop.
  return useMemo(() => {
    const suggestions = prefix
      ? assigned.filter(
          (issue) =>
            issue.idReadable.toUpperCase().startsWith(prefix) &&
            issue.idReadable !== exact?.idReadable
        )
      : []
    return [...(exact ? [exact] : []), ...suggestions].slice(0, MAX_SUGGESTIONS)
  }, [assigned, exact, prefix])
}
