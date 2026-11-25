# dsh-plugin-btw — design

## Goal

Give DeepSeek Harness a `/btw` command that asks an additional question (and, when needed, performs an additional operation) **without changing the main conversation's model context**. The exchange lives in a separate, durable, continuable thread shown in the right Sidebar.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Standalone plugin; **no dependency on `dsh-better-sidebar`** | Independent release and no private HTTP coupling. |
| D2 | Own right-Sidebar tab type (`btw`) | Own title, guide entry, resource lifecycle, and tab identity. |
| D3 | A side thread inherits everything the host gives a delegated child | Preset composition, model route, permission roots, working directory, tools. |
| D4 | `/btw` continues the **newest** thread when it is idle; `/btw new` forces a fresh one | Deterministic: host and browser resolve the same catalog entry. A busy newest thread means the new question starts its own thread instead of interleaving. |
| D5 | Release each activation when its turn settles; drop settlement notices of resumed continuations at the parent inbox | The runtime itself settles local activations when the child goes idle. The first activation is `caller` (silent), but a cold-resumed continuation is materialized with the runtime's default `parent` delivery, so its settlement must be filtered out of the parent conversation. |
| D6 | All artifacts in English | Product surfaces in this deployment are bilingual; code and docs stay English. |
| D7 | Send one activation spec carrying both `SubagentActivationSpec` generations, and declare `engines.dsh` | DSH 0.2.2-rc.2 flattened the spec (`parent`/`prompt` moved out of `request`), and npm `latest` already ships it. Both runtimes read only their own shape and check the exact parent before creating a child, so one spec serves old and new without a version probe; `engines.dsh` keeps unsupported runtimes from installing the plugin at all. |

## Architecture

```
┌──────────────── Host (src/) ────────────────┐      ┌──────── Browser (client.js) ─────────┐
│ commands.register("/btw")                   │      │ command/executed (client event)      │
│   └─ runBtw                                 │      │   └─ revealThread                    │
│      ├─ sessionProjections.snapshot(...)    │      │      ├─ sessions.refreshProjections  │
│      ├─ subagents.startActivation(fork)     │      │      ├─ read subagentCatalog view    │
│      │    label "BTW · …", delivery caller  │      │      └─ sidebarRight.openResource    │
│      └─ subagents.sendMessage(parent,child) │      │                                          │
└─────────────────────────────────────────────┘      │ `btw` resource provider retains the  │
                                                     │ child Session; tab body wraps the    │
                                                     │ shared conversation.content Factory  │
                                                     └──────────────────────────────────────┘
```

### Host half

- `src/index.js` registers the command. `recordInput: false` keeps the question out of the parent's command lifecycle record; the truncated question is only in the child's catalog label.
- `src/btw.js`:
  - continued thread → `ctx.subagents.sendMessage(parent, childId, [text], { signal })`; a resident activation receives the question directly, a cold one is resumed by the runtime.
  - new thread → `buildActivationSpec()` builds one spec that carries the flat shape (`parent`/`prompt`/`signal`) **and** the legacy nested `request` object, then calls `ctx.subagents.startActivation(spec)`. DSH `<= 0.2.2-rc.1` reads `request`; `>= 0.2.2-rc.2` reads the top-level fields and ignores `request`. The runtime releases the activation when the first turn settles. `package.json` declares `engines.dsh: ">=0.2.2-alpha.2 <0.3.0"`.
  - per-parent inbox filter → removes `subagent-settled` notices whose sender is one of the conversation's `BTW · …` threads, covering the `parent` delivery of every resumed continuation.
- `src/threads.js` selects the newest `BTW · ` **continuable** entry from `ctx.sessionProjections.snapshot(parent.session, ['subagentCatalog'])`, and probes liveness with `ctx.agents.get(id)?.status`.
- `src/label.js` holds the pure grammar (`new` flag), the label budget, and the boundary prompt.
- One plugin-lifetime `AbortController` cancels side work when the plugin unloads; the command invocation's own signal is **not** forwarded, because it aborts when the command RPC returns.

### Browser half

- `client.js` is a single `window.__ModuleLoader__.load({ id, factory(require) })` module (no build step). It requires only `react` from the frozen module table.
- `resources.register({ protocol: 'btw', open })` yields `{ address, reference }` and releases the `sessions.retain(...)` reference when the tab closes.
- `sidebarRightTabs.register({ id, kind: 'btw', patterns: ['dsh-resource://btw/**'], priority: 'extension', canOpen, title })` claims the address and supplies the tab title from the address (`?title=` carries the immutable catalog label).
- The tab body slot declares one session-scoped child slot (`sidebar.btw.conversation`), wraps the resource reference in `SessionProvider`, and renders that child slot. The child renders the **shared `conversation.content` Factory** with `variant: 'embedded'` and a fixed Chat View; live output, history paging, tool and approval cards, and the composer therefore come from the product implementation, not from the plugin.
- The Conversation slot injects `openWorkspace` and passes it as `onWorkspaceSelected` to the `conversation.content` Factory. DSH 0.2.3+ requires that input; earlier runtimes ignore the extra field, so the embedded Hero keeps working across both.
- `command/executed` is a browser-local Cordis event emitted after a host command is admitted; the listener refreshes the parent's projections and opens the newest `BTW · ` thread. Because the host delivers the question before the command returns, the reveal target is stable.

## DSH contracts relied on

| Contract | Where |
|---|---|
| Command registry, input claim grammar, log-only `command/run`/`command/done` | `packages/interaction/commands` |
| Model-surface whitelist (`system/message`, `user/message`, `assistant/message`, `tool/result` only) | `packages/session/session-format-v2-to-v3/src/payload.ts`, `packages/core/session/src/surface.ts` |
| `subagents.startActivation` (both spec generations), `sendMessage`, catalog projection, capacity | `packages/subagent/subagent/src/index.ts`, `projection-types.ts`; published `@deepseek-ai/dsh-subagent` 0.2.2-rc.1 vs 0.2.2-rc.2 |
| Fork provider seed = completed-turn prefix; inherited model/preset | `packages/subagent/subagent-fork-in-process/src/index.ts` |
| Session projection wire views (`subagentCatalog`) | `packages/session/session-projection` |
| Client resource providers, `useResource`, slot runtime | `packages/client/resources`, `packages/client/ui-slots` |
| Right Sidebar tab registry and tab body slot | `packages/client/ui-sidebar-right` |
| Embedded Conversation mounting pattern | `packages/client/ui-subagent/src/client/sidebar-chat/index.tsx` |
| `command/executed` client event | `packages/client/ui-commands/src/client/service.ts` |

## Invariants

1. The main Agent's model history contains no side-thread content: delivery is `caller`, and parent facts are log-only.
2. The side thread is a **direct, continuable** child of the conversation that issued `/btw`; it is therefore discoverable from that conversation's subagent catalog.
3. `/btw` never blocks on a model turn: the command result settles after delivery, not after the answer.
4. A side thread addressed by the panel is the same thread the question was delivered to (newest-single-thread rule).
5. No `subagent-settled` message from a `/btw` thread reaches the main Agent's inbox.
6. Plugin unload aborts live side work and releases resource references.

## Known limitations

- Only completed turns are inherited; an open main turn is invisible to the side thread.
- A continued question is an adjacent-Agent message, not a human-authored user message (host-side continuation has no public user-source channel for cold children).
- The native right Sidebar layout is in-memory, so tabs are not restored after reload.
- No configuration schema in v0.1 (provider, label prefix, boundary prompt are constants).

## Verification record (2026-11-25, compatibility fix)

| Check | Result |
|---|---|
| Published-version boundary | `@deepseek-ai/dsh-subagent` alpha.2/alpha.3/rc.1 use the nested spec; rc.2/rc.3/rc.4/rc.5/0.2.3-alpha.1/0.2.3-alpha.2 use the flat spec. The failure site on flat runtimes is `this.ctx.get('agents')?.get(spec.parent.id)`; an old-shaped spec yields exactly `TypeError: Cannot read properties of undefined (reading 'id')`. |
| Dual shape regression | `buildActivationSpec()` carries both `parent`/`prompt`/`signal` and `request: { parent, prompt, signal }`, with identical references; `test/compat.test.js` asserts it. |
| Error mapping | A `TypeError` becomes an actionable "incompatible subagent API" message; known admission codes keep their dedicated copy; unexpected failures are logged with a stack. |
| Local runtime (`0.2.2-alpha.2`, nested spec) | `/btw` opens a side thread, streams the answer, and the main conversation stays clean (see the 2026-11-10 record below). |
| Older/newer client parity | `onWorkspaceSelected` is passed from the injected `openWorkspace`; `0.2.2-rc.5` has no such input and ignores it; `0.2.3-alpha.2` requires it. |

## Verification record (2026-11-10, local Web profile)

| Check | Result |
|---|---|
| Host row active | `plugin_manager` reports `include:btw` enabled / `fiberPhase: active`; install applied without a restart |
| `/btw <question>` opens a thread | Right Sidebar auto-opens `BTW · <question>` and streams the answer (headless Chromium check) |
| `/btw new` opens another thread | A second tab appears and stays focused; tab titles come from the catalog labels |
| Continue reuses the newest idle thread | The newest thread gains a second turn; no extra tab |
| Main Chat carries no side content | Only `btw · Side thread opened.` / `btw · Question sent to the side thread.` rows; question and answer text absent |
| Main model context untouched | Parent Session log contains no `user/message` with source `subagent-settled`; the injected notice shows as one canceled inbox splice and one empty turn (no `step/start`, no `assistant/message`) |
| Console | No warnings or errors from the plugin in the browser console |
| Unit tests | `npm test` — 11 passing; `npm run check` — syntax OK |

## Verification plan

| Check | How |
|---|---|
| Pure logic | `npm test` (node:test) |
| Syntax/manifests | `npm run check`, JSON parse |
| Bundle install | Plugin manager install from this directory; confirm row `btw` is active |
| Command admission | `/btw` produces one command row; `/btw new` twice produces two catalog threads |
| Model isolation | Compare the main session's `request/context` before/after a side exchange; no side content |
| Panel | Right Sidebar opens the thread, streams the answer, accepts a follow-up, Stop works |
| Continuation | `/btw` again appends to the idle newest thread; while it runs, `/btw` opens a new thread |
| Capacity | New thread settles and its activation is disposed; a later `/btw` still cold-resumes it |
| Unload | Disabling the plugin aborts running side work without affecting the main turn |
