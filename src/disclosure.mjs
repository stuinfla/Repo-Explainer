// disclosure.mjs — the honest note in the delivery email (ADR-0011 D2). Pure, so it is unit-tested.
// Tone: lead with "it is live and yours"; name the weakest thing in words a requester understands (never
// "B5"); never assert a quality claim nothing measured; offer the re-run. No apology, no hedging.

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// What to say about the rest of the page. It must describe the REAL shape of the scorecard: a half-broken
// render must not be announced as "one area let it down, the rest is fine".
export function restLine(scorecard) {
  const axes = (scorecard || []).flatMap((d) => [...Object.values(d.gateA || {}), ...Object.values(d.gateB || {})])
    .filter((n) => typeof n === 'number');
  const weakAxisCount = axes.filter((n) => n < 70).length;
  const mean = axes.length ? axes.reduce((a, b) => a + b, 0) / axes.length : null;
  if (weakAxisCount > 1) {
    return `${weakAxisCount} areas came in under our bar${typeof mean === 'number' ? `, and the page averaged ${Math.round(mean)} out of 100` : ''} — this one needs another pass more than most`;
  }
  if (typeof mean === 'number' && mean >= 82) return 'the rest of the page scored well';
  return 'the rest of the page is solid but not our best work';
}

// Returns the two optional HTML notes. A page that was never vision-graded gets a note that says so; it
// never gets a quality verdict ("below the level we love", "the rest is solid") that nothing measured.
export function disclosureNotes(publish, scorecard) {
  const w = publish?.weakest || null;
  if (publish?.gateRefusal && !(scorecard || []).length) {
    return { ungradedNote: `
<div style="border-left:3px solid #7a8aa0;background:#f2f5f8;padding:12px 16px;margin:0 0 20px;border-radius:0 4px 4px 0">
  <p style="margin:0 0 8px;font-weight:600;color:#42536b">Note — this one stopped at our plain-reading check, before the visual grade.</p>
  <p style="margin:0;color:#42536b">The page is built and live, but the opening sections did not pass our check that a curious 15-year-old can follow them
  (${esc(publish.gateRefusal)}), so the visual grade never ran and the rest of the page is ungraded — no scorecard below.
  If the opening reads hard to you, reply and I'll rewrite it and grade it properly. No charge.</p>
</div>`, belowBarNote: '' };
  }
  const ungradedNote = publish?.graderUnavailable ? `
<div style="border-left:3px solid #7a8aa0;background:#f2f5f8;padding:12px 16px;margin:0 0 20px;border-radius:0 4px 4px 0">
  <p style="margin:0 0 8px;font-weight:600;color:#42536b">Note — we could not grade this one.</p>
  <p style="margin:0;color:#42536b">The page is built and live, but our independent quality critic was unavailable when it finished,
  so it went out ungraded rather than sit undelivered. That means we genuinely don't know how it scored — no scorecard below.
  If anything looks off, reply and I'll rebuild and grade it properly. No charge.</p>
</div>` : '';
  const belowBarNote = (publish?.belowBar && !publish?.graderUnavailable) ? `
<div style="border-left:3px solid #d9822b;background:#fdf6ee;padding:12px 16px;margin:0 0 20px;border-radius:0 4px 4px 0">
  <p style="margin:0 0 8px;font-weight:600;color:#8a5620">Honest note — this one came through below the level we love.</p>
  <p style="margin:0;color:#5c4630">It's live and it's yours, and everything in it is real. The part that let it down was
  <b>${esc(w?.label || 'one area of the page')}</b>${typeof w?.score === 'number' ? ` — graded ${esc(w.score)} out of 100${w.device ? ` on ${esc(w.device)}` : ''}` : ''}; ${esc(restLine(scorecard))}.
  Have a look, and if that matters for how you plan to use it, just reply to this email and I'll rebuild it with a different approach. No charge.</p>
</div>` : '';
  return { ungradedNote, belowBarNote };
}
