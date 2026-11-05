// The honest note in the delivery email. A page that was refused at the plain-reading check, or never
// graded, must not be described with a quality verdict nothing measured (review D3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { disclosureNotes, restLine, esc } from '../src/disclosure.mjs';

const card = (score) => [{ device: 'mobile(390)', gateA: { A1: score, A2: score }, gateB: { B1: score } }];

test('D3: a pre-check refusal with no scorecard says it stopped at the reading check and is ungraded', () => {
  const { ungradedNote, belowBarNote } = disclosureNotes(
    { belowBar: true, graderUnavailable: false, gateRefusal: 'INV-24 reads above age 15: a 41-word sentence', weakest: { label: 'being readable with zero prior knowledge', score: null } }, []);
  assert.match(ungradedNote, /stopped at our plain-reading check, before the visual grade/);
  assert.match(ungradedNote, /INV-24 reads above age 15: a 41-word sentence/);
  assert.match(ungradedNote, /ungraded/);
  assert.equal(belowBarNote, '', 'no below-bar verdict: nothing was measured');
  assert.doesNotMatch(ungradedNote + belowBarNote, /solid but not our best work/);
});

test('a refusal reason is HTML-escaped', () => {
  const { ungradedNote } = disclosureNotes({ gateRefusal: 'INV-20 unexplained acronym(s): <b>X</b>' }, []);
  assert.doesNotMatch(ungradedNote, /<b>X<\/b>/);
  assert.match(ungradedNote, /&lt;b&gt;X&lt;\/b&gt;/);
  assert.equal(esc('"&<>'), '&quot;&amp;&lt;&gt;');
});

test('a grader outage keeps its own ungraded note', () => {
  const { ungradedNote, belowBarNote } = disclosureNotes({ belowBar: true, graderUnavailable: true }, []);
  assert.match(ungradedNote, /we could not grade this one/);
  assert.equal(belowBarNote, '');
});

test('a graded below-bar page names the weakest area and describes the rest from the real scores', () => {
  const pub = { belowBar: true, weakest: { label: 'the diagrams and imagery', score: 58, device: 'mobile(390)' } };
  const { ungradedNote, belowBarNote } = disclosureNotes(pub, card(90));
  assert.equal(ungradedNote, '');
  assert.match(belowBarNote, /<b>the diagrams and imagery<\/b> — graded 58 out of 100 on mobile\(390\); the rest of the page scored well/);
});

test('restLine never claims the rest is fine when several areas are weak', () => {
  assert.match(restLine(card(40)), /^3 areas came in under our bar, and the page averaged 40 out of 100/);
  assert.equal(restLine(card(90)), 'the rest of the page scored well');
  assert.equal(restLine(card(75)), 'the rest of the page is solid but not our best work');
  assert.equal(restLine([]), 'the rest of the page is solid but not our best work');
});

test('a gate refusal that ALSO has a scorecard is treated as graded (no ungraded note)', () => {
  const { ungradedNote } = disclosureNotes({ gateRefusal: 'INV-20 x', belowBar: true, weakest: { label: 'x' } }, card(80));
  assert.equal(ungradedNote, '');
});
