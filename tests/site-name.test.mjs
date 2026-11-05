// The cross-owner overwrite guard in deploy: two repos with the same basename must never share a Netlify
// site. The live site's llms.txt is the ownership record. Real resolveSiteName, injectable fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSiteName } from '../tools/deploy.mjs';

const site = { ssl_url: 'https://foo-explainer.netlify.app' };
const serving = (text, ok = true) => async (url) => {
  assert.equal(url, 'https://foo-explainer.netlify.app/llms.txt');
  return { ok, text: async () => text };
};

test('another owner\'s live page is NOT overwritten: deploy goes to <owner>-<name>', async () => {
  const r = await resolveSiteName({ name: 'foo-explainer', ownerName: 'Attacker/foo', site,
    fetchImpl: serving('# foo\nSource: https://github.com/upstream/foo\n') });
  assert.equal(r.name, 'attacker-foo-explainer');
  assert.equal(r.incumbent, 'upstream/foo');
});

test('the same owner redeploys onto the same site (case-insensitive, .git suffix ignored)', async () => {
  const r = await resolveSiteName({ name: 'foo-explainer', ownerName: 'UpStream/Foo', site,
    fetchImpl: serving('Source: https://github.com/upstream/foo.git') });
  assert.deepEqual(r, { name: 'foo-explainer', incumbent: null });
});

test('no existing site, no owner, an unreachable probe or an llms.txt with no repo URL: nothing to protect', async () => {
  const never = async () => { throw new Error('must not probe'); };
  assert.equal((await resolveSiteName({ name: 'foo-explainer', ownerName: 'a/foo', site: null, fetchImpl: never })).name, 'foo-explainer');
  assert.equal((await resolveSiteName({ name: 'foo-explainer', ownerName: null, site, fetchImpl: never })).name, 'foo-explainer');
  const down = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal((await resolveSiteName({ name: 'foo-explainer', ownerName: 'a/foo', site, fetchImpl: down })).name, 'foo-explainer');
  assert.equal((await resolveSiteName({ name: 'foo-explainer', ownerName: 'a/foo', site, fetchImpl: serving('', false) })).name, 'foo-explainer');
  assert.equal((await resolveSiteName({ name: 'foo-explainer', ownerName: 'a/foo', site, fetchImpl: serving('no links here') })).name, 'foo-explainer');
});

test('the probe falls back to <name>.netlify.app when the site record has no ssl_url', async () => {
  let seen;
  await resolveSiteName({ name: 'bar-explainer', ownerName: 'a/bar', site: {}, fetchImpl: async (u) => { seen = u; return { ok: false }; } });
  assert.equal(seen, 'https://bar-explainer.netlify.app/llms.txt');
});
