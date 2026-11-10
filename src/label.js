/**
 * Pure `/btw` input handling: the command grammar, the durable thread label,
 * and the boundary prompt prefixed to a side thread's first question.
 *
 * Nothing here touches a Cordis context, a Session, or an Agent, so both the
 * host plugin and its tests can import it directly.
 *
 * @module dsh-plugin-btw/label
 */

/** Durable label prefix that marks one Session as a `/btw` side thread. */
export const BTW_LABEL_PREFIX = 'BTW · '

/** Longest durable thread label, matching the subagent-label budget. */
export const BTW_LABEL_MAX_CHARS = 48

/** Copy shown when the command carries no question. */
export const BTW_USAGE = 'Usage: /btw [new] <question>'

/**
 * Split `rawInput` into the optional `new` flag and the question itself.
 *
 * @param rawInput - command text after the registered name, separator included.
 * @returns whether a fresh thread was requested, and the remaining question.
 */
export function parseBtwInput(rawInput) {
  const trimmed = String(rawInput ?? '').trim()
  if (trimmed === '') return { forceNew: false, question: '' }
  const flag = /^new(?:\s+|$)/u.exec(trimmed)
  if (flag === null) return { forceNew: false, question: trimmed }
  return { forceNew: true, question: trimmed.slice(flag[0].length).trim() }
}

/**
 * Build the durable label recorded in the parent catalog for one side thread.
 * The first line of the question is truncated to keep catalog rows readable.
 *
 * @param question - the question that opened the thread.
 * @returns the `BTW · …` label.
 */
export function buildBtwLabel(question) {
  const firstLine = String(question ?? '').split(/\r?\n/u, 1)[0]?.trim() ?? ''
  const budget = BTW_LABEL_MAX_CHARS - [...BTW_LABEL_PREFIX].length
  const body = [...firstLine].slice(0, budget).join('').trim()
  return body === '' ? `${BTW_LABEL_PREFIX}(untitled)` : `${BTW_LABEL_PREFIX}${body}`
}

/**
 * Build the side thread's first user message.
 *
 * The inherited completed-turn prefix is reference context: the prompt tells
 * the child not to continue the main conversation's work, so a side question
 * cannot silently resume a plan or a tool chain from the main thread.
 *
 * @param question - the question that opened the thread.
 * @returns the complete first-message text.
 */
export function buildSideThreadPrompt(question) {
  return [
    'Side conversation boundary.',
    '',
    'Everything before this boundary is inherited history from the main conversation: its completed turns and the decisions it already made. It is reference context only, not your current task. Do not continue, execute, or complete any instructions, plans, tool calls, approvals, or edits from before this boundary. Only the question after this boundary is this side conversation\'s active instruction.',
    '',
    'This is a side conversation. Your answer is shown in a side panel and is never delivered into the main conversation. Use tools when the question genuinely requires them.',
    '',
    'Question:',
    String(question ?? '').trim(),
  ].join('\n')
}
