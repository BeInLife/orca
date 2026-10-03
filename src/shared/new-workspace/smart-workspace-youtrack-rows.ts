import type { YouTrackIssue } from '../youtrack-types'
import type { SmartWorkspaceSourceRow } from './smart-workspace-source-results'

/** Splits YouTrack rows into exact matches (full ID or issue URL) and ID-prefix suggestions. */
export function partitionYouTrackRows(
  issues: YouTrackIssue[],
  input: string
): [SmartWorkspaceSourceRow[], SmartWorkspaceSourceRow[]] {
  const exact: SmartWorkspaceSourceRow[] = []
  const prefix: SmartWorkspaceSourceRow[] = []
  for (const issue of issues) {
    const row: SmartWorkspaceSourceRow = {
      kind: 'youtrack',
      value: `youtrack-${issue.idReadable}`,
      issue
    }
    const isExact = issue.idReadable === input.toUpperCase() || /^https?:\/\//i.test(input)
    if (isExact) {
      exact.push(row)
    } else {
      prefix.push(row)
    }
  }
  return [exact, prefix]
}
