// INV-24 ReadsAtFifteen (ADR-0006 v1.2.0) — the deterministic reading-level gate.
//
// THE MISS IT EXISTS TO CATCH: the owner scored two shipped pages 6.5/10 — "it still feels like it's
// asking me to geek out versus bringing it back to my level ... the whole point of this is to explain
// it like somebody is 15". Measured on those pages: mcp-studio grade 11.0 (25-word sentences), ruos
// grade 16.3 (39-word sentences). INV-20 passed both, because every acronym WAS glossed: the barrier
// was sentence SHAPE, which no rail measured. These tests pin the measurement itself — a gate whose
// arithmetic is wrong is worse than no gate, because it certifies the thing it cannot see.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingStats, findReadabilityViolations, syllablesIn, READS_AT_FIFTEEN } from '../tools/quality-grade.mjs';

test('syllable counting is sane on the words these pages actually use', () => {
  for (const [w, n] of [['the', 1], ['router', 2], ['breathing', 2], ['desktop', 2], ['assistant', 3]]) {
    assert.equal(syllablesIn(w), n, `${w} should count ${n}`);
  }
});

test('teen-level copy passes: short sentences, common words', () => {
  const text = 'Your WiFi can already tell if you are breathing. It works through walls and in the dark. '
    + 'There is no camera in the room. There is nothing to wear on your wrist. The router notices you.';
  const st = readingStats(text);
  assert.ok(st.grade <= READS_AT_FIFTEEN.maxGrade, `expected <= ${READS_AT_FIFTEEN.maxGrade}, got ${st.grade}`);
  assert.deepEqual(findReadabilityViolations(text), []);
});

test('REGRESSION: the real ruos sentence shape FAILS the gate', () => {
  // Shape lifted from the page the owner rejected: one 39-word sentence of common words.
  const text = 'ruOS is a complete Linux desktop, sitting in the cloud and running all of the time, on which '
    + 'somebody has already installed a full set of agent tools, which means that the same computer that you '
    + 'could look at yourself is also a computer that an assistant is able to drive on your behalf. '
    + 'It is reachable from a browser.';
  const st = readingStats(text);
  assert.ok(st.longest > READS_AT_FIFTEEN.maxSentenceWords, `fixture must contain an over-long sentence, got ${st.longest}`);
  const v = findReadabilityViolations(text);
  assert.ok(v.length > 0, 'a 39-word sentence must be caught');
  assert.ok(v.some((x) => /\d+-word sentence/.test(x)), 'the violation must name the over-long sentence');
});

test('jargon-free but dense prose still FAILS — vocabulary was never the whole problem', () => {
  // Every word here is ordinary. Only the shape is wrong, which is exactly what INV-20 cannot see.
  const text = 'When the person in the room moves even a little, the signal that is already there changes in '
    + 'small ways that the system is able to notice, and those changes are what it uses to work out where the '
    + 'person is standing and whether they are breathing in a normal way or not.';
  assert.ok(findReadabilityViolations(text).length > 0, 'plain words in a 55-word sentence must still fail');
});

test('empty or near-empty text never fabricates a violation', () => {
  assert.deepEqual(findReadabilityViolations(''), []);
  assert.deepEqual(findReadabilityViolations('Hi.'), []);
});
