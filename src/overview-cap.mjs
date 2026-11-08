// overview-cap.mjs — the hard length cap for the NotebookLM overview video (owner standard: under 90 seconds).
// The ffprobe duration of the downloaded file is the gate; a video that fails it is discarded, never shipped.
export const MAX_SECONDS = 90;

/** True only for a real, positive duration within the cap. NaN, 0, negatives and over-cap all fail. */
export const withinCap = (durationSec, cap = MAX_SECONDS) => Number.isFinite(durationSec) && durationSec > 0 && durationSec <= cap;
