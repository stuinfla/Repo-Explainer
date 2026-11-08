// assemble-page refuses a page that lacks its generated imagery, and never lets another visual hide it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBuild, assemble, cleanup } from './helpers/assemble-fixture.mjs';

const refused = (mutate, re) => {
  const dir = makeBuild({ mutate });
  try {
    const r = assemble(dir);
    assert.equal(r.status, 1, 'must be refused');
    assert.match(r.stderr, re);
    assert.equal(r.html, null, 'no page is written');
  } finally { cleanup(dir); }
};

test('no generated hero image → refused', () => refused((c) => { delete c.visuals.hero; }, /visuals\.hero \(MANDATORY generated image\)/));
test('no generated section images → refused', () => refused((c) => { delete c.visuals.sections; }, /at least one generated section image is MANDATORY/));
test('section images that are neither problem nor use-case → refused', () => refused((c) => { c.visuals.sections[0].id = 'misc'; c.visuals.sections[0].role = 'decoration'; }, /must include a visible problem or use-case generated image/));

test('the generated problem image is visible in the problem section', () => {
  const dir = makeBuild();
  try {
    const r = assemble(dir);
    assert.equal(r.status, 0, r.stderr);
    const problem = r.html.match(/<details class="section" id="problem"[\s\S]*?<\/details>/)[0];
    assert.match(problem, /assets\/problem\.png/);
  } finally { cleanup(dir); }
});
