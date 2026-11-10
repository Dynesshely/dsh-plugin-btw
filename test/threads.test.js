import test from 'node:test'
import assert from 'node:assert/strict'

import { BTW_LABEL_PREFIX } from '../src/label.js'
import { newestBtwThread, threadIsIdle } from '../src/threads.js'

const thread = (id, extra = {}) => ({
  id,
  createdAt: 1,
  mode: 'continuable',
  label: `${BTW_LABEL_PREFIX}${id}`,
  ...extra,
})

test('newestBtwThread returns the last matching continuable entry', () => {
  const entries = [
    thread('session-a'),
    { id: 'session-other', createdAt: 2, mode: 'continuable', label: 'Some subagent' },
    thread('session-b'),
    { id: 'session-external', createdAt: 3, mode: 'external', label: `${BTW_LABEL_PREFIX}external` },
  ]
  assert.equal(newestBtwThread(entries)?.id, 'session-b')
})

test('newestBtwThread ignores one-shot, malformed, and unlabelled entries', () => {
  assert.equal(newestBtwThread([]), undefined)
  assert.equal(newestBtwThread(undefined), undefined)
  assert.equal(newestBtwThread([
    { id: 'session-one', createdAt: 1, mode: 'one-shot', label: `${BTW_LABEL_PREFIX}one` },
    { id: 'session-bad', createdAt: 2, mode: 'continuable', label: 'BTW without the separator' },
    { id: 'session-unknown', createdAt: 3, mode: 'unknown', label: `${BTW_LABEL_PREFIX}unknown` },
  ]), undefined)
})

test('threadIsIdle treats a cold thread as continuable and a running one as busy', () => {
  const idleCtx = { agents: { get: () => undefined } }
  assert.equal(threadIsIdle(idleCtx, 'session-cold'), true)

  const liveIdle = { agents: { get: () => ({ status: 'idle' }) } }
  assert.equal(threadIsIdle(liveIdle, 'session-live'), true)

  const liveRunning = { agents: { get: () => ({ status: 'running' }) } }
  assert.equal(threadIsIdle(liveRunning, 'session-running'), false)
})
