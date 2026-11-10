import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BTW_LABEL_MAX_CHARS, BTW_LABEL_PREFIX, BTW_USAGE,
  buildBtwLabel, buildSideThreadPrompt, parseBtwInput,
} from '../src/label.js'

test('parseBtwInput keeps a plain question and does not force a new thread', () => {
  assert.deepEqual(parseBtwInput('  why does this read twice?  '), {
    forceNew: false,
    question: 'why does this read twice?',
  })
})

test('parseBtwInput strips a leading new flag', () => {
  assert.deepEqual(parseBtwInput('  new   what changed?'), {
    forceNew: true,
    question: 'what changed?',
  })
  assert.deepEqual(parseBtwInput('new'), { forceNew: true, question: '' })
})

test('parseBtwInput treats a word starting with new as a question', () => {
  assert.deepEqual(parseBtwInput('newer files are ignored?'), {
    forceNew: false,
    question: 'newer files are ignored?',
  })
})

test('parseBtwInput reports an empty question', () => {
  assert.deepEqual(parseBtwInput('   '), { forceNew: false, question: '' })
  assert.deepEqual(parseBtwInput(undefined), { forceNew: false, question: '' })
})

test('buildBtwLabel prefixes the first line and keeps the budget', () => {
  const label = buildBtwLabel('first line\nsecond line')
  assert.equal(label, `${BTW_LABEL_PREFIX}first line`)
  const long = buildBtwLabel('x'.repeat(200))
  assert.ok([...long].length <= BTW_LABEL_MAX_CHARS)
  assert.ok(long.startsWith(BTW_LABEL_PREFIX))
  assert.ok(long.endsWith('x'))
})

test('buildBtwLabel falls back for an empty question', () => {
  assert.equal(buildBtwLabel('   '), `${BTW_LABEL_PREFIX}(untitled)`)
})

test('buildSideThreadPrompt marks the boundary and carries the question verbatim', () => {
  const prompt = buildSideThreadPrompt('why is the cache cold?')
  assert.ok(prompt.startsWith('Side conversation boundary.'))
  assert.ok(prompt.includes('never delivered into the main conversation'))
  assert.ok(prompt.endsWith('why is the cache cold?'))
})

test('usage copy names both spellings', () => {
  assert.ok(BTW_USAGE.includes('/btw [new]'))
})
