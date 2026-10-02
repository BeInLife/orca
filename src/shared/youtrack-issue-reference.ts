const ISSUE_ID_RE = /^[A-Za-z][A-Za-z0-9_]*-\d+$/
const ISSUE_PATH_RE = /\/issue\/([A-Za-z][A-Za-z0-9_]*-\d+)(?:\/|$)/

/** Reads a YouTrack issue ID from a bare ID ("proj-81") or an issue URL on the connected instance. */
export function parseYouTrackIssueReference(value: string, baseUrl: string | null): string | null {
  const trimmed = value.trim()
  if (ISSUE_ID_RE.test(trimmed)) {
    return trimmed.toUpperCase()
  }
  if (!baseUrl || !/^https?:\/\//i.test(trimmed)) {
    return null
  }
  try {
    const url = new URL(trimmed)
    const base = new URL(baseUrl)
    const basePath = base.pathname.replace(/\/+$/, '')
    // Why: only URLs on the connected instance; other trackers' URLs share the ID shape.
    if (url.origin !== base.origin || !url.pathname.startsWith(`${basePath}/`)) {
      return null
    }
    const match = ISSUE_PATH_RE.exec(url.pathname.slice(basePath.length))
    return match ? match[1].toUpperCase() : null
  } catch {
    return null
  }
}
