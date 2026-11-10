/**
 * Pure side-thread selection over the parent Session's `subagentCatalog`
 * projection, plus the liveness probe that decides whether the newest thread
 * may be continued.
 *
 * Selection is deliberately "the newest `/btw` thread only": the host and the
 * browser half both resolve the same entry from the same catalog order, so the
 * panel that opens is always the thread the question was delivered to.
 *
 * @module dsh-plugin-btw/threads
 */

import { BTW_LABEL_PREFIX } from './label.js'

/**
 * The newest `BTW · …` continuable child in one catalog view.
 *
 * @param entries - `subagentCatalog` wire view, in parent event order.
 * @returns the newest matching entry, or undefined when this parent has none.
 */
export function newestBtwThread(entries) {
  if (!Array.isArray(entries)) return undefined
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry === null || typeof entry !== 'object') continue
    if (entry.mode !== 'continuable') continue
    if (typeof entry.id !== 'string' || entry.id === '') continue
    if (typeof entry.label !== 'string' || !entry.label.startsWith(BTW_LABEL_PREFIX)) continue
    return entry
  }
  return undefined
}

/**
 * Whether one thread can take a new question now.
 *
 * A thread with no live Agent is cold: continuing it resumes its Agent, which
 * counts as idle. A live thread is idle exactly when its Agent reports `idle`.
 *
 * @param ctx - host context carrying the Agent registry.
 * @param threadId - child Session identity.
 * @returns true when the thread may be continued.
 */
export function threadIsIdle(ctx, threadId) {
  const agent = ctx.agents.get(threadId)
  return agent === undefined || agent.status === 'idle'
}
