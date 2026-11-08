// ask-token.mjs — the credential an explainer page carries so the central ask service will answer for it.
//
// token = base64url(host) + "." + base64url(HMAC-SHA256(secret, host))
//
// The page is public, so the token is public — that is fine: it only proves "this host is one of ours".
// Verification lives in the service (ask-service/netlify/functions/ask.mjs verifyToken); this side only signs.
// The service never trusts text from the browser; it fetches that host's own published index, so a copied
// token buys nothing beyond asking questions about that one site, under that site's daily cap.
import crypto from 'node:crypto';

const b64u = (b) => Buffer.from(b).toString('base64url');
const mac = (secret, host) => crypto.createHmac('sha256', secret).update(host).digest('base64url');

/** A valid host is a bare lowercase hostname — no scheme, port, path or credentials. */
export const isHost = (h) => typeof h === 'string' && h.length <= 120 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h);

export function signAskToken(host, secret) {
  if (!isHost(host)) throw new Error(`not a bare hostname: ${host}`);
  if (!secret || String(secret).length < 24) throw new Error('ASK_SIGNING_SECRET must be at least 24 characters');
  return `${b64u(host)}.${mac(secret, host)}`;
}
