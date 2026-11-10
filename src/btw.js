/**
 * `/btw` execution: resolve the target side thread, deliver the question, and
 * keep the main conversation's model context untouched.
 *
 * A new thread is a continuable subagent child whose seed is the parent's
 * completed-turn prefix (the `fork` provider), delivered with `caller`
 * delivery so the parent receives no completion notice.
 *
 * The first activation is `caller` delivery, so the parent receives no
 * completion notice. Any later question — `/btw` or the side panel's own
 * composer — cold-resumes the durable child, and the runtime materializes a
 * resumed activation with its default `parent` delivery. That settlement would
 * be injected into the main conversation as a user message, so every parent
 * Agent this plugin serves gets an inbox filter that drops settlement notices
 * from its `BTW · …` threads. The main model context therefore stays clean;
 * the suppressed notice leaves an empty turn boundary (no step, no model
 * call).
 *
 * @module dsh-plugin-btw/btw
 */

import {
  BTW_LABEL_PREFIX, BTW_USAGE, buildBtwLabel, buildSideThreadPrompt, parseBtwInput,
} from './label.js'
import { newestBtwThread, threadIsIdle } from './threads.js'

/** Provider that seeds a child with the parent's completed-turn prefix. */
const PROVIDER = 'fork'

/** Result copy: a fresh thread was created. */
const OPENED = 'Side thread opened.'

/** Result copy: an idle thread received the question. */
const CONTINUED = 'Question sent to the side thread.'

/** Plugin-scoped state: one inbox filter per parent Agent. */
export function createRuntimeState() {
  return {
    /** parent session id → notice filter registration. */
    filters: new Map(),
    disposed: false,
  }
}

/**
 * Run one `/btw` invocation.
 *
 * @param {object} ctx - host context carrying `subagents`, `agents`, and `sessionProjections`.
 * @param {object} state - plugin runtime state.
 * @param {object} invocation - registered-command invocation (exact live Agent + raw input).
 * @param {AbortSignal} signal - plugin-lifetime cancellation for the side work.
 * @returns {Promise<{ kind: 'success', text: string } | { kind: 'error', text: string }>} command result.
 */
export async function runBtw(ctx, state, invocation, signal) {
  const parsed = parseBtwInput(invocation.rawInput)
  if (parsed.question === '') return { kind: 'error', text: BTW_USAGE }
  const parent = invocation.agent
  try {
    installNoticeFilter(ctx, state, parent)
    const reused = parsed.forceNew ? undefined : reusableThread(ctx, parent)
    if (reused !== undefined) {
      await ctx.subagents.sendMessage(
        parent,
        reused.id,
        [{ type: 'text', text: parsed.question }],
        { signal },
      )
      return { kind: 'success', text: CONTINUED }
    }
    const activation = await ctx.subagents.startActivation({
      provider: PROVIDER,
      label: buildBtwLabel(parsed.question),
      request: {
        parent,
        prompt: [{ type: 'text', text: buildSideThreadPrompt(parsed.question) }],
        signal,
      },
      signal,
      delivery: 'caller',
    })
    // The runtime settles a local activation on its own once the child finishes
    // its turn; observe the promise so a later rejection is never unhandled.
    void activation.result.catch(() => {})
    return { kind: 'success', text: OPENED }
  } catch (error) {
    return { kind: 'error', text: describeFailure(error) }
  }
}

/**
 * Dispose every per-Agent inbox listener this plugin installed.
 *
 * @param {object} state - plugin runtime state.
 * @returns {void}
 */
export function disposeRuntimeState(state) {
  state.disposed = true
  for (const filter of state.filters.values()) {
    try {
      filter.dispose()
    } catch (_listenerFailure) {
      // A retired Agent scope may already own the listener teardown.
    }
  }
  state.filters.clear()
}

/**
 * The newest `/btw` thread when it can accept this question.
 *
 * @param {object} ctx - host context.
 * @param {object} parent - the live Agent that issued the command.
 * @returns {object | undefined} the catalog entry to continue, or undefined to open a fresh thread.
 */
function reusableThread(ctx, parent) {
  const newest = newestBtwThread(catalogOf(ctx, parent))
  if (newest === undefined) return undefined
  return threadIsIdle(ctx, newest.id) ? newest : undefined
}

/**
 * Read the parent's current `subagentCatalog` view.
 *
 * @param {object} ctx - host context.
 * @param {object} parent - the live Agent whose conversation owns the threads.
 * @returns {readonly object[] | undefined} catalog entries, or undefined when unavailable.
 */
function catalogOf(ctx, parent) {
  try {
    return ctx.sessionProjections.snapshot(parent.session, ['subagentCatalog']).values.subagentCatalog
  } catch (_projectionFailure) {
    return undefined
  }
}

/**
 * Drop settlement notices from this conversation's `/btw` threads.
 *
 * Installed once per parent Agent for the plugin's lifetime. A resumed child is
 * materialized with the runtime's default `parent` delivery and would otherwise
 * inject its settlement as a user message into the main conversation.
 *
 * @param {object} ctx - host context.
 * @param {object} state - plugin runtime state.
 * @param {object} parent - the live Agent that owns the threads.
 * @returns {void}
 */
function installNoticeFilter(ctx, state, parent) {
  const existing = state.filters.get(parent.id)
  if (existing !== undefined && existing.agent === parent) return
  if (existing !== undefined) {
    try {
      existing.dispose()
    } catch (_listenerFailure) {
      // The previous Agent scope retired with its listener.
    }
  }
  const dispose = parent.ctx.on('agent/inbox/inserted', ({ message }) => {
    if (state.disposed) return
    const source = message?.source
    if (source === null || typeof source !== 'object') return
    if (source.kind !== 'subagent-settled') return
    const senderSessionId = source.senderSessionId
    if (typeof senderSessionId !== 'string' || senderSessionId === '') return
    if (!isBtwThread(ctx, parent, senderSessionId)) return
    try {
      parent.inbox.remove(message.id)
    } catch (_inboxFailure) {
      // Removing best-effort: never let the filter disturb the parent runtime.
    }
  })
  state.filters.set(parent.id, { agent: parent, dispose })
}

/**
 * Whether a child Session is one of this conversation's `/btw` threads.
 *
 * @param {object} ctx - host context.
 * @param {object} parent - the live Agent whose catalog is read.
 * @param {string} childId - sender Session identity from the notice.
 * @returns {boolean} true when the catalog records a `BTW · …` thread with that id.
 */
function isBtwThread(ctx, parent, childId) {
  const catalog = catalogOf(ctx, parent)
  if (!Array.isArray(catalog)) return false
  return catalog.some(entry => entry !== null
    && typeof entry === 'object'
    && entry.id === childId
    && typeof entry.label === 'string'
    && entry.label.startsWith(BTW_LABEL_PREFIX))
}

/**
 * Render a thrown activation failure as one user-facing line.
 *
 * @param {unknown} error - thrown value.
 * @returns {string} the command result text.
 */
function describeFailure(error) {
  const code = error !== null && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : ''
  if (code === 'ACTIVATION_LIMIT_REACHED') {
    return 'Cannot open a side thread: the subagent capacity limit is reached. Finish or dismiss a thread and retry.'
  }
  if (code === 'UNAUTHORIZED') {
    return 'Cannot open a side thread: this conversation\'s agent is no longer live.'
  }
  const message = error instanceof Error ? error.message : String(error)
  return `/btw failed: ${message}`
}
