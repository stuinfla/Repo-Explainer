// A hero scene that satisfies the strict contract (tools/diagrams/scene.mjs): ONE 400-wide scene for phone and desktop.
// The default render is the finished static state; motion lives under prefers-reduced-motion: no-preference.
export function validScene(id = 'hs') {
  return `<svg xmlns="http://www.w3.org/2000/svg" id="${id}" viewBox="0 0 400 440" width="400" height="440" role="img" aria-labelledby="${id}-t ${id}-d">
<title id="${id}-t">Edits stay small and undoable</title>
<desc id="${id}-d">The original model stays locked. A copy is edited in small steps, each step leaves a receipt, and one step is undone exactly.</desc>
<style>
#${id}{background:#0d1114;fill:#eef2ee}
#${id} text{font-family:ui-sans-serif,system-ui,sans-serif;font-size:16px}
#${id} .cap{font-size:18px;font-weight:600}
#${id} .cell{fill:#1c252b}
#${id} .hit{fill:#d9f24a}
@media (prefers-reduced-motion:no-preference){
  #${id} .hit{animation:${id}-pulse 10s ease infinite both}
  @keyframes ${id}-pulse{0%,20%{opacity:0;transform:scale(.6)}30%,90%{opacity:1;transform:none}100%{opacity:0}}
}
</style>
<rect id="${id}-bg" x="0" y="0" width="400" height="440" fill="#0d1114"/>
<text x="20" y="34" class="cap">The original never changes</text>
<rect class="cell" x="20" y="50" width="160" height="110" rx="8"/>
<text x="20" y="196" class="cap">A copy gets small edits</text>
<rect class="cell" x="220" y="50" width="160" height="110" rx="8"/>
<rect class="hit" x="250" y="80" width="40" height="40" rx="6"/>
<text x="20" y="240">Receipt 1: three numbers changed</text>
<text x="20" y="270">Receipt 2: undone, exact match</text>
<text x="20" y="320" class="cap">Only the reviewer can approve</text>
</svg>`;
}
