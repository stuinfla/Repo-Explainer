// src/outreach-mail.mjs — the maintainer email DRAFT and who it would go to (pure helpers).
//
// The maintainer is never mailed automatically. The draft is mailed to the OWNER as a review copy
// (src/smtp.mjs) so they can forward it if they choose. Copy never vouches for itself.

export function pickMaintainerEmail(commits) {
  const bad = /noreply|no-reply|users\.noreply\.github\.com|\[bot\]|bot@|dependabot|renovate|github-actions/i;
  const counts = new Map();
  for (const c of Array.isArray(commits) ? commits : []) {
    const email = (c?.commit?.author?.email || c?.author?.email || '').trim().toLowerCase();
    if (!email || bad.test(email) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    counts.set(email, (counts.get(email) || 0) + 1);
  }
  let best = null;
  for (const [email, n] of counts) if (!best || n > best.n) best = { email, n };
  return best ? best.email : null;
}

export function renderEmail({ name, to, liveUrl, issueUrl, fromName, contact }) {
  const body = [
    'Hi,',
    '',
    `I built an independent visual explainer for ${name}: ${liveUrl}`,
    issueUrl ? `I also left a short note on the project's issue tracker so it is not only in your inbox: ${issueUrl}` : '',
    '',
    'It is a static page and the source is public. Nothing is asked of you, and you are free to ignore this.',
    '',
    `— ${fromName}`,
    contact && String(contact).trim() ? String(contact).trim() : '',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  return { to, subject: `A visual explainer of ${name}`, body };
}
