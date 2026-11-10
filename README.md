# dsh-plugin-btw

`/btw` asks a **side question** in DeepSeek Harness without touching the main conversation: the question and answer live in a separate thread rendered in the **right Sidebar**, and the main Agent never sees them.

```
main conversation                     right sidebar
─────────────────                     ─────────────
…                                     ┌───────────────────────────────┐
> /btw why is the cache cold?         │ BTW · why is the cache cold?  │
  (one log-only command row)          │                               │
…                                     │ > why is the cache cold?      │
                                      │ answer streams here …         │
                                      │ [composer: follow up]         │
                                      └───────────────────────────────┘
```

## Requirements

- DeepSeek Harness with the Web surface (`dsh web` / Desktop Web profile).
- A composed `subagents` service with the **`fork`** provider (`@deepseek-ai/dsh-subagent-fork-in-process`, `providerName: fork`), which the `@deepseek-ai/dsh-base` bundle mounts by default.
- Session persistence, because a side thread is a durable child Session.

## Install

```bash
dsh plugin install /absolute/path/to/dsh-plugin-btw
```

or let the harness install the bundle from this directory through its plugin manager. The bundle inserts one host row (`btw`); the browser half ships in the same package (`dsh.client`).

After installation the plugin inventory shows **By the way** with this package's icon.

## Usage

| Command | Behavior |
|---|---|
| `/btw <question>` | Continue the **newest `/btw` thread** of this conversation when it is idle; otherwise open a new thread. |
| `/btw new <question>` | Always open a new thread. |
| `/btw` | Shows the usage hint; nothing is sent. |

The right Sidebar opens the target thread automatically after the command. The thread's composer stays available for follow-ups; its Stop button cancels the running side turn only.

The thread is also reachable later from the conversation header's subagent catalog (it is a continuable direct child), even after the tab is closed or the page is reloaded.

## What "does not touch the main conversation" means

- **Model context** — the main Agent's prompts never contain the side question or answer. The child is delivered with `caller` delivery, so the parent receives no completion notice. The only durable parent facts are log-only events: the command lifecycle (`command/run` / `command/done`) and one `subagent/catalog` entry.
- **Chat stream** — the main Chat shows one `/btw` command row (no question text; the command records no input).
- **Files and tools** — *not* isolated. The side thread inherits the main conversation's preset, model, permission roots, and working directory, so it may read and change the same workspace. That is intentional: `/btw` can also perform a small side operation.
- **Approvals** — approvals raised by the side thread render in its own tab, not in the main chat.

## Behavior details and limits

- **Completed turns only.** The side thread's inherited seed ends at the main conversation's last completed turn. Work the main Agent is doing *right now* (an open turn, including an in-flight tool call) is not visible to the side thread.
- **Token cost.** Each new thread inherits the completed-turn prefix, so its first request costs about as much as the main conversation's context. The shared prefix is friendly to provider prompt caches. Follow-ups reuse the thread and cost only their own turn.
- **Subagent capacity.** A new thread is a live subagent child. The plugin releases its activation as soon as the first turn settles, so idle threads do not hold the `maxActiveSubagents` slot; a follow-up cold-resumes the durable child. A short burst of many *simultaneously running* threads can still hit the capacity limit, which `/btw` reports as a friendly error.
- **Continued questions are adjacent-Agent messages.** When `/btw` continues an idle thread, the question is delivered through the subagent continuation channel (the only host-side channel that can cold-resume a direct child), so the side transcript attributes it to the parent Agent rather than to a typed human message. Questions that open a thread are ordinary user messages.
- **Tab layout is in-memory.** The native right Sidebar keeps its layout in memory; after a page reload the tab is not restored. Reopen the thread from the subagent catalog, or ask `/btw` again to reveal it.
- **No configuration yet.** Provider (`fork`), label prefix, and the boundary prompt are constants in `src/`.

## Development

Plain ESM host code plus one hand-written browser module (no build step).

```bash
npm test          # node:test — pure command/label/thread logic
npm run check     # syntax-check every runtime file
```

Design notes and the DSH extension points this plugin relies on: [docs/DESIGN.md](docs/DESIGN.md).

## License

MIT
