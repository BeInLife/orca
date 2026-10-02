import { ipcMain } from 'electron'
import {
  addComment,
  connect,
  disconnect,
  getComments,
  getIssue,
  getStateOptions,
  getStatus,
  listIssues,
  setState
} from '../youtrack/client'
import {
  createIssue,
  getProjectFields,
  listProjects,
  resetYouTrackMetadataCaches,
  updateField
} from '../youtrack/issue-mutations'
import { isRawRecord } from '../youtrack/issue-mapping'
import type {
  YouTrackFieldInput,
  YouTrackIssuePreset,
  YouTrackListIssuesArgs,
  YouTrackStateOption
} from '../../shared/youtrack-types'

const VALID_PRESETS: readonly YouTrackIssuePreset[] = ['assigned', 'reported', 'open', 'done']

function readPreset(value: unknown): YouTrackIssuePreset | undefined {
  return VALID_PRESETS.find((preset) => preset === value)
}
// YouTrack readable ids look like PROJ-123; anything else never reaches the URL path.
const ISSUE_ID_RE = /^[A-Za-z0-9_.]+-\d+$/

function readIssueId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : ''
  return ISSUE_ID_RE.test(id) ? id : null
}

function readProjectId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : ''
  // YouTrack entity ids look like "0-12".
  return /^\d+-\d+$/.test(id) ? id : null
}

function readFieldInput(value: unknown): YouTrackFieldInput | null {
  if (!isRawRecord(value) || typeof value.name !== 'string' || !Array.isArray(value.values)) {
    return null
  }
  const values = value.values.filter((entry): entry is string => typeof entry === 'string')
  return values.length === value.values.length && values.length <= 200
    ? { name: value.name, values: values.map((entry) => entry.slice(0, 20_000)) }
    : null
}

function readStateOption(value: unknown): YouTrackStateOption | null {
  if (!isRawRecord(value)) {
    return null
  }
  const { id, label, kind } = value
  if (typeof id !== 'string' || typeof label !== 'string') {
    return null
  }
  return kind === 'value' || kind === 'event' ? { id, label, kind } : null
}

const invalidIssue = { ok: false, error: 'A valid YouTrack issue id is required.' } as const

/** Registers every `youtrack:*` IPC handler on the main process. */
export function registerYouTrackHandlers(): void {
  ipcMain.handle('youtrack:status', () => getStatus())

  ipcMain.handle(
    'youtrack:connect',
    async (_event, args: { baseUrl?: unknown; token?: unknown; allowInsecureTls?: unknown }) => {
      if (typeof args?.baseUrl !== 'string' || typeof args?.token !== 'string') {
        return { ok: false, error: 'YouTrack URL and token are required.' }
      }
      return connect({
        baseUrl: args.baseUrl,
        token: args.token,
        allowInsecureTls: args.allowInsecureTls === true
      })
    }
  )

  ipcMain.handle('youtrack:disconnect', () => {
    disconnect()
    resetYouTrackMetadataCaches()
  })

  ipcMain.handle('youtrack:listIssues', async (_event, args?: YouTrackListIssuesArgs) => {
    const preset = readPreset(args?.preset)
    return listIssues({
      preset,
      query: typeof args?.query === 'string' ? args.query.slice(0, 2000) : undefined,
      limit: typeof args?.limit === 'number' ? args.limit : undefined
    })
  })

  ipcMain.handle('youtrack:getIssue', async (_event, args: { idReadable?: unknown }) => {
    const id = readIssueId(args?.idReadable)
    return id ? getIssue(id) : invalidIssue
  })

  ipcMain.handle('youtrack:getComments', async (_event, args: { idReadable?: unknown }) => {
    const id = readIssueId(args?.idReadable)
    return id ? getComments(id) : invalidIssue
  })

  ipcMain.handle(
    'youtrack:addComment',
    async (_event, args: { idReadable?: unknown; text?: unknown }) => {
      const id = readIssueId(args?.idReadable)
      if (!id) {
        return invalidIssue
      }
      if (typeof args?.text !== 'string' || !args.text.trim()) {
        return { ok: false, error: 'Comment text is required.' }
      }
      return addComment(id, args.text.trim())
    }
  )

  ipcMain.handle('youtrack:getStateOptions', async (_event, args: { idReadable?: unknown }) => {
    const id = readIssueId(args?.idReadable)
    return id ? getStateOptions(id) : invalidIssue
  })

  ipcMain.handle(
    'youtrack:setState',
    async (_event, args: { idReadable?: unknown; option?: unknown }) => {
      const id = readIssueId(args?.idReadable)
      const option = readStateOption(args?.option)
      if (!id || !option) {
        return { ok: false, error: 'Issue id and target state are required.' }
      }
      return setState({ idReadable: id, option })
    }
  )

  ipcMain.handle('youtrack:listProjects', async (_event, args?: { force?: unknown }) =>
    listProjects(args?.force === true)
  )

  ipcMain.handle(
    'youtrack:getProjectFields',
    async (_event, args: { projectId?: unknown; force?: unknown }) => {
      const projectId = readProjectId(args?.projectId)
      return projectId
        ? getProjectFields(projectId, args?.force === true)
        : { ok: false, error: 'A project is required.' }
    }
  )

  ipcMain.handle(
    'youtrack:updateField',
    async (_event, args: { idReadable?: unknown; projectId?: unknown; field?: unknown }) => {
      const id = readIssueId(args?.idReadable)
      const projectId = readProjectId(args?.projectId)
      const field = readFieldInput(args?.field)
      if (!id || !projectId || !field) {
        return { ok: false, error: 'Issue, project, and field are required.' }
      }
      return updateField({ idReadable: id, projectId, field })
    }
  )

  ipcMain.handle('youtrack:createIssue', async (_event, args: unknown) => {
    if (!isRawRecord(args)) {
      return { ok: false, error: 'Issue details are required.' }
    }
    const projectId = readProjectId(args.projectId)
    const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
    if (!projectId || !summary) {
      return { ok: false, error: 'Project and summary are required.' }
    }
    const fields = Array.isArray(args.fields) ? args.fields.map(readFieldInput) : []
    if (fields.some((field) => field === null)) {
      return { ok: false, error: 'Invalid field values.' }
    }
    return createIssue({
      projectId,
      summary: summary.slice(0, 1000),
      description: typeof args.description === 'string' ? args.description : undefined,
      fields: fields.filter((field) => field !== null)
    })
  })
}
