/**
 * dsh-plugin-btw host half: the `/btw` command and its side-thread lifecycle.
 *
 * `/btw <question>` opens a continuable child Session seeded with the parent's
 * completed-turn prefix and renders in the right Sidebar. `/btw new <question>`
 * forces a fresh thread; the bare form continues the newest `/btw` thread when
 * that thread is idle.
 *
 * The main conversation is not model-visible affected: the registered command
 * records no input, its lifecycle events are log-only, the child is delivered
 * with `caller` delivery (no parent completion notice), and the only durable
 * parent fact is the parent-owned `subagent/catalog` entry that makes the
 * thread discoverable.
 *
 * @module dsh-plugin-btw
 */

import { runBtw } from './btw.js'

export const name = 'dsh-plugin-btw'

/** Services required to register the command and open a side thread. */
export const inject = ['commands', 'subagents', 'agents', 'sessionProjections']

/**
 * Register the `/btw` command.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - host plugin context.
 * @returns {void}
 */
export function apply(ctx) {
  const lifetime = new AbortController()
  ctx.effect(() => () => {
    lifetime.abort(new Error('dsh-plugin-btw was unloaded'))
  }, 'dsh-plugin-btw: abort side work on unload')

  ctx.effect(() => ctx.commands.register({
    name: 'btw',
    description: 'Ask a side question in a separate thread without touching this conversation',
    recordInput: false,
    input: { hint: 'Side question… (prefix "new" to force a new thread)' },
    handler: invocation => runBtw(ctx, invocation, lifetime.signal),
  }), 'dsh-plugin-btw: /btw command')
}
