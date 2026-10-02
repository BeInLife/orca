import { defineMethod } from '../core'
import {
  YouTrackCommentAdd,
  YouTrackFieldSet,
  YouTrackIssueCreate,
  YouTrackIssueList,
  YouTrackIssueRead,
  YouTrackStateSet
} from '../../../../shared/rpc-contract/youtrack-agent-params'
import {
  addYouTrackCommentForAgents,
  createYouTrackIssueForAgents,
  listYouTrackIssuesForAgents,
  readYouTrackIssueForAgents,
  setYouTrackFieldForAgents,
  setYouTrackStateForAgents
} from '../../../youtrack/agent-access'

// Why runtime RPC: `orca youtrack` reaches the desktop host that holds the YouTrack token.
export const YOUTRACK_METHODS = [
  defineMethod({
    name: 'youtrack.issue',
    params: YouTrackIssueRead,
    handler: async (params, { runtime }) => readYouTrackIssueForAgents(params, runtime)
  }),
  defineMethod({
    name: 'youtrack.list',
    params: YouTrackIssueList,
    handler: async (params) => listYouTrackIssuesForAgents(params)
  }),
  defineMethod({
    name: 'youtrack.commentAdd',
    params: YouTrackCommentAdd,
    handler: async (params, { runtime }) => addYouTrackCommentForAgents(params, runtime)
  }),
  defineMethod({
    name: 'youtrack.stateSet',
    params: YouTrackStateSet,
    handler: async (params, { runtime }) => setYouTrackStateForAgents(params, runtime)
  }),
  defineMethod({
    name: 'youtrack.fieldSet',
    params: YouTrackFieldSet,
    handler: async (params, { runtime }) => setYouTrackFieldForAgents(params, runtime)
  }),
  defineMethod({
    name: 'youtrack.create',
    params: YouTrackIssueCreate,
    handler: async (params) => createYouTrackIssueForAgents(params)
  })
]
