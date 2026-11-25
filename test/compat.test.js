import test from 'node:test'
import assert from 'node:assert/strict'

import { buildActivationSpec, describeFailure } from '../src/btw.js'

const parent = { id: 'session-parent' }
const signal = new AbortController().signal

test('activation spec carries both runtime generations', () => {
  const spec = buildActivationSpec(parent, 'why is the cache cold?', signal)

  // DSH >= 0.2.2-rc.2 reads the flat spec.
  assert.equal(spec.parent, parent)
  assert.equal(spec.signal, signal)
  assert.equal(spec.delivery, 'caller')
  assert.equal(spec.provider, 'fork')
  assert.ok(spec.label.startsWith('BTW · '))
  assert.equal(spec.prompt[0].type, 'text')
  assert.match(spec.prompt[0].text, /why is the cache cold\?$/)

  // DSH <= 0.2.2-rc.1 reads the nested request; newer runtimes ignore it.
  assert.equal(spec.request.parent, parent)
  assert.equal(spec.request.signal, signal)
  assert.equal(spec.request.prompt, spec.prompt)
})

test('activation spec keeps the prompt and signal references identical', () => {
  const spec = buildActivationSpec(parent, 'same question', signal)
  assert.equal(spec.request.prompt, spec.prompt)
  assert.equal(spec.request.parent, spec.parent)
  assert.equal(spec.request.signal, spec.signal)
})

test('an unexpected TypeError becomes an actionable compatibility message', () => {
  const text = describeFailure(new TypeError("Cannot read properties of undefined (reading 'id')"))
  assert.match(text, /incompatible subagent API/)
  assert.match(text, /Update dsh-plugin-btw or DeepSeek Harness/)
  assert.ok(!text.startsWith('/btw failed: Cannot read properties'))
})

test('known admission failures keep their dedicated copy', () => {
  assert.match(describeFailure({ code: 'ACTIVATION_LIMIT_REACHED' }), /capacity limit/)
  assert.match(describeFailure({ code: 'UNAUTHORIZED' }), /agent is no longer live/)
})

test('unstructured failures keep the raw diagnostic', () => {
  assert.equal(describeFailure(new Error('boom')), '/btw failed: boom')
})
