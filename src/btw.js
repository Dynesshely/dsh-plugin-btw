/**
 * `/btw` execution: resolve the target side thread, deliver the question, and
 * keep the main conversation's model context untouched.
 *
 * A new thread is a continuable subagent child whose seed is the parent's
 * completed-turn prefix (the `fork` provider). Delivery is `caller`, so the
 * parent Agent receives no completion notice. A continued thread is delivered
 * through the adjacent-Agent message channel, which also cold-resumes an idle
 * child whose activation was already released.
 *
 * @module dsh-plugin-btw/btw
 */

import {
  BTW_USAGE, buildBtwLabel, buildSideThreadPrompt, parseBtwInput,
} from './label.js'
import { newestBtwThread, threadIsIdle } from './threads.js'

/** Provider that seeds a child with the parent's completed-turn prefix. */
const PROVIDER = 'fork'

/** Result copy: a fresh thread was created. */
const OPENED = 'Side thread opened.'

/** Result copy: an idle thread received the question. */
const CONTINUED = 'Question sent to the side thread.'

/**
 * Run one `/btw` invocation.
 *
 * @param {object} ctx - host context carrying `subagents`, `agents`, and `sessionProjections`.
 * @param {object} invocation - registered-command invocation (exact live Agent + raw input).
 * @param {AbortSignal} signal - plugin-lifetime cancellation for the side work.
 * @returns {Promise<{ kind: 'success', text: string } | { kind: 'error', text: string }>} command result.
 */
export async function runBtw(ctx, invocation, signal) {
  const parsed = parseBtwInput(invocation.rawInput)
  if (parsed.question === '') return { kind: 'error', text: BTW_USAGE }
  const parent = invocation.agent
  try {
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
    releaseAfterFirstTurn(activation)
    return { kind: 'success', text: OPENED }
  } catch (error) {
    return { kind: 'error', text: describeFailure(error) }
  }
}

/**
 * The newest `/btw` thread when it can accept this question.
 *
 * @param {object} ctx - host context.
 * @param {object} parent - the live Agent that issued the command.
 * @returns {object | undefined} the catalog entry to continue, or undefined to open a fresh thread.
 */
function reusableThread(ctx, parent) {
  const snapshot = ctx.sessionProjections.snapshot(parent.session, ['subagentCatalog'])
  const newest = newestBtwThread(snapshot.values.subagentCatalog)
  if (newest === undefined) return undefined
  return threadIsIdle(ctx, newest.id) ? newest : undefined
}

/**
 * Release the activation's capacity slot as soon as its first turn settles.
 * Later questions cold-resume the same durable child through `sendMessage`.
 *
 * @param {{ result: Promise<unknown>, dispose: () => Promise<void> }} activation - accepted activation.
 * @returns {void}
 */
function releaseAfterFirstTurn(activation) {
  const release = () => { activation.dispose().catch(() => {}) }
  void activation.result.then(release, release)
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
