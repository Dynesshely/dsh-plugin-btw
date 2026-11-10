/**
 * dsh-plugin-btw browser half: the `BTW` right-Sidebar tab.
 *
 * One tab type hosts one side thread. Its body binds the thread's Session
 * reference through the framework `SessionProvider` and renders the shared
 * `conversation.content` Factory with the Chat View pinned, so the side thread
 * gets the ordinary live stream, history paging, tool cards, approval cards,
 * and composer without a second transcript implementation.
 *
 * The browser half also opens the tab after `/btw`: the host has already
 * delivered the question, so the newest `BTW · …` child in the parent's
 * `subagentCatalog` projection is exactly the thread to reveal.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-btw',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Right-Sidebar tab-type identity (also the tab body slot key). */
    const TAB_ID = 'dsh-plugin-btw'
    /** Tab kind, used by `ctx.sidebarRight.openResource`. */
    const TAB_KIND = 'btw'
    /** Session-scoped Conversation slot hosted by one BTW tab. */
    const CONVERSATION_SLOT = 'sidebar.btw.conversation'
    /** Resource-address prefix for one side thread. */
    const ADDRESS_PREFIX = 'dsh-resource://btw/session/'
    /** Durable label prefix the host records for side threads. */
    const LABEL_PREFIX = 'BTW · '

    /**
     * Address one side thread together with the facts the tab needs to reopen it.
     * @param {{ id: string, label?: string }} entry - catalog entry.
     * @param {string} parentSessionId - the conversation that owns the thread.
     * @returns {string} canonical Sidebar resource address.
     */
    function buildAddress(entry, parentSessionId) {
      const query = new URLSearchParams({ parent: parentSessionId, mode: 'continuable' })
      if (typeof entry.label === 'string' && entry.label !== '') query.set('title', entry.label)
      return `${ADDRESS_PREFIX}${encodeURIComponent(entry.id)}?${query}`
    }

    /**
     * Parse one canonical side-thread address.
     * @param {string} value - possible resource address.
     * @returns {{ parentSessionId: string, childSessionId: string, mode: string, title?: string } | undefined}
     *   the encoded thread address, or undefined for another or malformed resource.
     */
    function parseAddress(value) {
      let url
      try {
        url = new URL(value)
      } catch (_invalidUrl) {
        return undefined
      }
      if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== 'btw') return undefined
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts.length !== 2 || parts[0] !== 'session') return undefined
      const parentSessionId = url.searchParams.get('parent')
      if (parentSessionId === null || parentSessionId === '') return undefined
      let childSessionId
      try {
        childSessionId = decodeURIComponent(parts[1])
      } catch (_invalidEncoding) {
        return undefined
      }
      if (childSessionId === undefined || childSessionId === '') return undefined
      const mode = url.searchParams.get('mode') === 'one-shot' ? 'one-shot' : 'continuable'
      const title = url.searchParams.get('title')
      return {
        parentSessionId,
        childSessionId,
        mode,
        ...(title === null || title === '' ? {} : { title }),
      }
    }

    /**
     * Resource provider: retain the side thread's Session while the tab needs it.
     * @param {object} sessions - `ctx.sessions`.
     * @returns {object} the `btw` protocol provider.
     */
    function btwResourceProvider(sessions) {
      return {
        protocol: 'btw',
        async *open(resourceAddress, { signal }) {
          const address = parseAddress(resourceAddress)
          if (address === undefined) {
            throw new Error(`dsh-plugin-btw: invalid side-thread address "${resourceAddress}"`)
          }
          if (signal.aborted) return
          const reference = sessions.retain(address, { source: 'btwThread', signal })
          try {
            yield { ok: true, value: { address, reference } }
            await new Promise((resolve) => {
              if (signal.aborted) resolve()
              else signal.addEventListener('abort', () => { resolve() }, { once: true })
            })
          } finally {
            reference.release()
          }
        },
      }
    }

    /**
     * Fixed Chat selection used by an embedded side-thread Conversation.
     * @param {object} props - Views owner props.
     * @returns {object} the chat conversation subtree.
     */
    function FixedChatView(props) {
      return h(React.Fragment, null, props.renderSlot('conversation.session', { view: 'chat' }))
    }

    /**
     * Render the shared Conversation content for one explicitly provided side thread.
     * @param {object} props - Conversation slot props.
     * @returns {object} the embedded conversation content.
     */
    function BtwConversation({
      sessionId, useSession, useConversation, useSessions, renderFactorySlot,
    }) {
      const session = useSession(value => value)
      const conversation = useConversation(value => value)
      const active = conversation.activeTargets.size > 0
        || (!session.blank && !session.awaitingFirstTurn)
        || session.running
      const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
      const summaryBlank = useSessions(state => state.byId[sessionId]?.blank)
      const parentAvailabilityPending = session.subagent?.address.mode === 'continuable'
        && session.subagent.parentAvailable === undefined
      const settling = (shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true)
        || parentAvailabilityPending
      const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
      const phase = settling ? 'settling' : hero ? 'hero' : 'active'
      return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
        slots: { views: FixedChatView },
      })
    }

    /**
     * Tab body: bind the resource's Session reference around the Conversation slot.
     * @param {object} props - tab body props.
     * @returns {object} the tab subtree.
     */
    function BtwTab({
      useResource, useTabInfo, SessionProvider, renderSlot,
    }) {
      const { tab } = useTabInfo()
      const resource = useResource(tab.contentId)
      return h('div', {
        'data-btw-tab': '',
        style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' },
      }, resource.value === undefined
        ? null
        : h(SessionProvider, { session: resource.value.reference },
          renderSlot(CONVERSATION_SLOT, {})))
    }

    /**
     * The newest `BTW · …` continuable thread in one parent's catalog projection.
     * @param {object} ctx - client root context.
     * @param {string} parentSessionId - the conversation that owns the thread.
     * @returns {object | undefined} the catalog entry to reveal.
     */
    function newestThreadEntry(ctx, parentSessionId) {
      const state = ctx.sessions.list.getSnapshot()
      const entries = state.projectionsBySession[parentSessionId]?.values?.subagentCatalog
      if (!Array.isArray(entries)) return undefined
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]
        if (entry === null || typeof entry !== 'object') continue
        if (entry.mode !== 'continuable') continue
        if (typeof entry.id !== 'string' || entry.id === '') continue
        if (typeof entry.label !== 'string' || !entry.label.startsWith(LABEL_PREFIX)) continue
        return entry
      }
      return undefined
    }

    /**
     * Reveal the side thread the host just delivered this question to.
     *
     * The host appends the parent catalog entry before the command returns, so
     * the entry is usually present immediately; a short retry covers the live
     * projection frame arriving a beat later.
     *
     * @param {object} ctx - client root context.
     * @param {string} parentSessionId - the conversation that issued `/btw`.
     * @returns {Promise<void>} completion after a reveal or after the retries give up.
     */
    async function revealThread(ctx, parentSessionId) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await ctx.sessions.refreshProjections(parentSessionId)
        } catch (_projectionFailure) {
          // Keep whatever catalog this Client already holds.
        }
        const entry = newestThreadEntry(ctx, parentSessionId)
        if (entry !== undefined) {
          ctx.sidebarRight.openResource(buildAddress(entry, parentSessionId), {
            kind: TAB_KIND,
            preferNewPane: true,
          })
          return
        }
        await new Promise(resolve => setTimeout(resolve, 400))
      }
      ctx.logger?.warn?.('dsh-plugin-btw: no side thread appeared after /btw')
    }

    /**
     * Register the resource provider, tab type, tab body, and Conversation slot.
     * @param {object} ctx - client root context.
     * @returns {void}
     */
    function registerBtwTab(ctx) {
      ctx.effect(
        () => ctx.resources.register(btwResourceProvider(ctx.sessions)),
        'dsh-plugin-btw: side-thread resources',
      )
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        patterns: [`${ADDRESS_PREFIX}**`],
        priority: 'extension',
        canOpen: address => parseAddress(address) !== undefined,
        title: address => parseAddress(address)?.title ?? 'BTW',
      }), 'dsh-plugin-btw: tab type')
      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
        name: 'sidebar.right.pane.tab',
        key: TAB_ID,
        children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } },
      }, BtwTab)), 'dsh-plugin-btw: tab body')
      ctx.effect(() => ctx.slots.inject(CONVERSATION_SLOT, () => ctx.slots.register({
        name: CONVERSATION_SLOT,
      }, BtwConversation)), 'dsh-plugin-btw: conversation content')
    }

    return {
      inject: ['sessions', 'slots', 'sidebarRight', 'sidebarRightTabs', 'resources'],
      /**
       * Client plugin body.
       * @param {object} ctx - client root context.
       * @returns {void}
       */
      apply(ctx) {
        registerBtwTab(ctx)
        ctx.effect(() => ctx.on('command/executed', (sessionId, commandName) => {
          if (commandName !== 'btw') return
          void revealThread(ctx, sessionId)
        }), 'dsh-plugin-btw: reveal the side thread after /btw')
      },
    }
  },
})
