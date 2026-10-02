import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { RunRow, TaskRow } from '../../../../orchestration/types'
import type { WorkerStartModeReceipt } from '../../orchestration-worker-start-mode'
import { deliverWorkerDispatchPreamble } from './deliver-worker-dispatch-preamble'
import {
  settleDispatchPreambleTurn,
  type DispatchPreambleTurnSettlement
} from '../../../../orchestration/dispatch-preamble-turn'
import { isStructuredSessionAddress } from '../../../../structured-worker-identity'
import type { OrchestrationWorkerLaunchReceipt } from './worker-launch-preferences'
import {
  describeUnobservedWorkerTurnStart,
  observeWorkerTurnStart,
  type WorkerTurnStartObservation
} from './worker-start-turn-observation'
import {
  monitorWorkerSetup,
  type createStructuredWorkerSessionForWorktree,
  type WorkerEffect,
  type WorkerSetupReceipt
} from './worker-topology'

const CHAT_PREAMBLE_IN_DOUBT =
  'The dispatch preamble was sent to the chat as its next turn, but whether the chat took it could ' +
  'not be confirmed. If the worker reports, this Dispatch settles normally.'

/**
 * Delivers the dispatch preamble and settles the worker's start state on the strongest
 * evidence available: `ready` only with a positive turn-start (or a provider that cannot
 * prove one), `start_unknown` when observation is supported and nothing started.
 */
export async function deliverAndSettleWorkerStartReadiness(args: {
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  run: RunRow
  task: TaskRow
  dispatchId: string
  dispatchDepth: number
  structuredSession: Awaited<ReturnType<typeof createStructuredWorkerSessionForWorktree>> | null
  terminalHandle: string
  coordinatorHandle: string
  devMode: boolean | undefined
  requestId: string
  agent: string | null
  setupReceipt: WorkerSetupReceipt
  launchReceipt: OrchestrationWorkerLaunchReceipt
  mode: WorkerStartModeReceipt
  timeoutMs: number
  effects: WorkerEffect[]
  terminalRevealWarning: string | undefined
  /** Keeps the caller's failure receipt naming the stage that actually failed. */
  onStage: (stage: 'agent_readiness' | 'dispatch_input' | 'turn_observation') => void
}): Promise<unknown> {
  const { runtime, db, run, task, structuredSession, terminalHandle, effects } = args

  args.onStage('dispatch_input')
  const delivery = await deliverWorkerDispatchPreamble({
    runtime,
    db,
    structuredSession,
    terminalHandle,
    dispatchId: args.dispatchId,
    dispatchDepth: args.dispatchDepth,
    taskId: task.id,
    taskSpec: task.spec,
    coordinatorHandle: args.coordinatorHandle,
    devMode: args.devMode,
    requestId: args.requestId
  })
  const promptDelivery = delivery.prompt
  // A chat takes the preamble when its turn ends, which is its readiness: past the budget a busy
  // terminal gets to go idle, the start fails as that terminal's does, with nothing delivered.
  let chatTurn: DispatchPreambleTurnSettlement | undefined
  if (delivery.chatPreambleTurn) {
    args.onStage('agent_readiness')
    chatTurn = await settleDispatchPreambleTurn(db, args.dispatchId, args.timeoutMs)
    if (chatTurn === 'withdrawn') {
      throw new Error('Agent did not become ready (running).')
    }
  }
  effects.push({
    kind: 'dispatch_input',
    role: 'agent',
    id: terminalHandle,
    state: 'accepted'
  })

  args.onStage('turn_observation')
  // The write above was accepted without waiting on provider hooks; now demand the positive
  // evidence the receipt claims is observable. A worker whose turn never starts must not be
  // reported ready — a wedged agent and a working one looked identical before this gate.
  // A structured preamble send is its own evidence: acknowledged, or still held for its agent.
  // A chat's preamble turn started once its provider accepted it.
  const turnStart: WorkerTurnStartObservation =
    delivery.structuredTurnStart ??
    (chatTurn
      ? chatTurn === 'delivered'
        ? { verdict: 'observed' }
        : { verdict: 'unobserved', reason: CHAT_PREAMBLE_IN_DOUBT }
      : await observeWorkerTurnStart({ runtime, terminalHandle, prompt: promptDelivery }))
  const deliveredPrompt = turnStart.prompt ?? promptDelivery
  monitorWorkerSetup({
    runtime,
    db,
    runId: run.id,
    dispatchId: args.dispatchId,
    setupReceipt: args.setupReceipt,
    effects
  })
  // A worker report can settle the dispatch while turn observation is outstanding.
  const currentWorker = db.getWorkerDispatch(args.dispatchId)
  const alreadySettled = currentWorker && currentWorker.state !== 'starting'
  if (turnStart.verdict === 'unobserved' && !alreadySettled) {
    // Honest `unverifiable`: keep lifecycle authority and the terminal — the worker may
    // still recover and report (worker-report settlement reconnects a start_unknown worker) —
    // but never claim ready for a turn nobody observed.
    effects.push({
      kind: 'dispatch_input',
      role: 'agent',
      id: terminalHandle,
      state: 'turn_unobserved'
    })
    const reason = turnStart.reason ?? describeUnobservedWorkerTurnStart(args.agent)
    const worker = db.markWorkerStartUnknown(
      args.dispatchId,
      'turn_start_unobserved',
      reason,
      effects
    )
    return {
      runId: run.id,
      taskId: task.id,
      dispatchId: args.dispatchId,
      state: 'outcome_unknown',
      stage: worker.stage,
      turnStart: turnStart.verdict,
      lastError: reason,
      setup: args.setupReceipt,
      launch: args.launchReceipt,
      mode: args.mode,
      timeoutMs: args.timeoutMs,
      effects,
      ...(deliveredPrompt ? { prompt: deliveredPrompt } : {}),
      residualResources: JSON.parse(worker.residual_resources) as unknown[],
      nextCommands: [
        `orca orchestration worker-show --dispatch ${args.dispatchId} --json`,
        // A structured session, a minted worker or a chat, has no screen to read.
        ...(structuredSession || isStructuredSessionAddress(terminalHandle)
          ? []
          : [`orca terminal read --terminal ${terminalHandle} --screen`]),
        `orca orchestration worker-abandon --dispatch ${args.dispatchId} --json`
      ],
      ...(args.terminalRevealWarning ? { warning: args.terminalRevealWarning } : {})
    }
  }
  const worker = alreadySettled
    ? currentWorker
    : db.markWorkerDispatchReady(args.dispatchId, effects)
  // A completed task proves start succeeded; older callers use only 'ready' as start success.
  const reportedOutcome =
    worker.stage === 'settled' && (worker.state === 'succeeded' || worker.state === 'failed')
      ? worker.state
      : undefined
  return {
    runId: run.id,
    taskId: task.id,
    dispatchId: args.dispatchId,
    state: reportedOutcome ? 'ready' : worker.state,
    stage: worker.stage,
    ...(reportedOutcome ? { workerOutcome: reportedOutcome } : {}),
    turnStart: turnStart.verdict,
    setup: args.setupReceipt,
    launch: args.launchReceipt,
    mode: args.mode,
    timeoutMs: args.timeoutMs,
    effects,
    ...(deliveredPrompt ? { prompt: deliveredPrompt } : {}),
    residualResources: [],
    ...(args.terminalRevealWarning ? { warning: args.terminalRevealWarning } : {})
  }
}
